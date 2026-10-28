#!/usr/bin/env node
/**
 * syndicate: the operator CLI of the syndication engine. Files in, files out; never posts unless
 * `due --live` is given AND the account carries the owner's approval AND credentials resolve.
 * Live operation ALSO requires a fresh, trusted publisher readCurrentSource
 * capability supplied by the original host. This standalone CLI has no such
 * connected source reader; --live therefore records held, not a social post.
 * Do not treat a stale JSON queue or a --live flag as publisher approval.
 *
 *   syndicate plan     --items ITEMS.json --accounts ACCOUNTS.json --start ISO --days N --out DIR [--rules RULES.json] [--journal JOURNAL.jsonl]
 *   syndicate due      --queue DIR --now ISO [--live] [--journal JOURNAL.jsonl]       (dry run unless --live)
 *   syndicate feedback --readings READINGS.json
 *   syndicate verify   --manifest MANIFEST.json --keys KEYS.json [--file POSTED] [--original ORIGINAL]
 *   syndicate readback --queue DIR --accounts ACCOUNTS.json --account ACCOUNT_ID --rendition RENDITION_NI --receipt RECEIPT_NI [--journal JOURNAL.jsonl]
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  admitAccountRegistry, admitContentItem, admitPlatformRuleSet, automationAdmission, blueskyAdapter, dryRunAdapter, gateRendition,
  manualPacket, niOfBytes, niOfJson, planSchedule, readBlueskyJournalPost, renditionsFor, ruleFor, runDue, summarize, verifyManifest,
} from '../src/syndication/index.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`); };
const readJsonl = (path) => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []);

function options(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) { const key = argv[i].slice(2); out[key] = argv[i + 1] === undefined || argv[i + 1].startsWith('--') ? true : argv[++i]; } else out._.push(argv[i]);
  }
  return out;
}
const need = (opts, name) => { if (opts[name] === undefined || opts[name] === true) throw new Error(`--${name} is required`); return opts[name]; };

export function plan(opts) {
  const ruleSet = admitPlatformRuleSet(readJson(opts.rules ?? join(here, '..', 'content', 'platform-rules.seed.json')));
  const registry = admitAccountRegistry(readJson(need(opts, 'accounts')));
  const items = readJson(need(opts, 'items')).items.map(admitContentItem);
  const startMs = Date.parse(need(opts, 'start'));
  const days = Number(need(opts, 'days'));
  const journal = opts.journal ? readJsonl(opts.journal) : [];
  const renditions = items.flatMap((item) => renditionsFor(item, { accounts: registry.accounts, ruleSet }));
  const schedule = planSchedule({ renditions, registry, ruleSet, startMs, days, journal });
  const byId = new Map(renditions.map((rendition) => [rendition.id, rendition]));
  const accountOf = new Map(registry.accounts.map((account) => [account.id, account]));
  const gateReport = [];
  const out = need(opts, 'out');
  for (const entry of schedule.entries) {
    const rendition = byId.get(entry.renditionId);
    const account = accountOf.get(entry.accountId);
    const rule = ruleFor(ruleSet, account.platform);
    const automated = automationAdmission(rule, account).automated;
    const gate = gateRendition(rendition, { account, ruleSet, nowMs: startMs, live: false });
    // A manual-only platform is never driven by the engine, so "not automatable" is its route, not a defect.
    const refusals = automated ? gate.refusals : gate.refusals.filter((reason) => !reason.startsWith('not automatable'));
    gateReport.push({ renditionId: rendition.id, accountId: account.id, at: entry.at, status: entry.status, route: automated ? 'api' : 'manual', refusals, holds: gate.holds });
    if (!automated && entry.at) writeJson(join(out, 'manual', account.id, `${entry.at.slice(0, 10)}-${rendition.id.slice(-8)}.json`), manualPacket(rendition, account, rule, entry.at));
  }
  for (const account of registry.accounts) {
    writeJson(join(out, 'queues', `${account.id}.json`), { account: account.id, platform: account.platform, state: account.state, entries: schedule.entries.filter((entry) => entry.accountId === account.id) });
  }
  mkdirSync(out, { recursive: true });
  const slotted = new Set(schedule.entries.filter((entry) => entry.at).map((entry) => `${entry.accountId}|${entry.renditionId}`));
  const lines = (list) => (list.length === 0 ? '' : `${list.map((rendition) => JSON.stringify(rendition)).join('\n')}\n`);
  writeFileSync(join(out, 'renditions.jsonl'), lines(renditions.filter((rendition) => slotted.has(`${rendition.accountId}|${rendition.id}`))));
  writeFileSync(join(out, 'backlog.jsonl'), lines(renditions.filter((rendition) => !slotted.has(`${rendition.accountId}|${rendition.id}`))));
  writeJson(join(out, 'schedule.json'), schedule);
  writeJson(join(out, 'gate-report.json'), gateReport);
  writeFileSync(join(out, 'plan.md'), planMarkdown({ registry, schedule, byId, gateReport, startMs, days, ruleSet }));
  return { renditions: renditions.length, scheduledOrPlanned: slotted.size, backlog: renditions.length - slotted.size, entries: schedule.entries.length, accounts: schedule.accounts, gateRefusals: gateReport.filter((row) => row.refusals.length).length };
}

export function planMarkdown({ registry, schedule, byId, gateReport, startMs, days, ruleSet }) {
  const lines = [`# Posting plan`, '', `Window: ${new Date(startMs).toISOString().slice(0, 10)} for ${days} days. Rule set: ${ruleSet.status}. Nothing here has been posted.`, ''];
  for (const account of registry.accounts) {
    const entries = schedule.entries.filter((entry) => entry.accountId === account.id);
    const summary = schedule.accounts[account.id];
    lines.push(`## ${account.id} (${account.platform}, ${account.state})`, '', `scheduled ${summary.scheduled}, manual ${summary.manual}, held ${summary.held}, unscheduled ${summary.unscheduled}${summary.error ? `, error: ${summary.error}` : ''}`, '');
    for (const entry of entries) {
      const rendition = byId.get(entry.renditionId);
      const gate = gateReport.find((row) => row.renditionId === entry.renditionId && row.accountId === entry.accountId);
      lines.push(`- ${entry.at ?? 'unscheduled'} [${entry.status}] ${rendition.title ?? rendition.text.split('\n')[0].slice(0, 80)} -> ${rendition.link}${gate.refusals.length ? ` (gate: ${gate.refusals.join('; ')})` : ''}${gate.holds.length ? ` (hold: ${gate.holds.join('; ')})` : ''}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

export async function due(opts) {
  const queue = need(opts, 'queue');
  const ruleSet = admitPlatformRuleSet(readJson(opts.rules ?? join(here, '..', 'content', 'platform-rules.seed.json')));
  const registry = admitAccountRegistry(readJson(need(opts, 'accounts')));
  const entries = readJson(join(queue, 'schedule.json')).entries;
  const renditions = new Map(readJsonl(join(queue, 'renditions.jsonl')).map((rendition) => [rendition.id, rendition]));
  const journalPath = opts.journal ?? join(queue, 'journal.jsonl');
  const live = opts.live === true;
  const adapters = {};
  for (const account of registry.accounts) adapters[account.platform] = dryRunAdapter(account.platform);
  if (live) adapters.bluesky = blueskyAdapter({ loadBytes: async () => { throw new Error('image bytes loader not configured'); } });
  const resolvers = { env: (name) => { const value = process.env[name]; if (!value) throw new Error(`environment credential ${name} is not set`); return (url, init = {}) => fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${value}` } }); } };
  const outcome = await runDue({ entries, renditions, registry, ruleSet, adapters, resolvers, journal: readJsonl(journalPath), nowMs: Date.parse(need(opts, 'now')), live });
  for (const line of outcome.journal) appendFileSync(journalPath, `${JSON.stringify(line)}\n`);
  return { live, perAccount: outcome.perAccount, results: outcome.results.map(({ accountId, renditionId, status, reason }) => ({ accountId, renditionId, status, reason })) };
}


/**
 * Read the exact originally journaled Bluesky publication through public
 * AppView, append a separate immutable observation to the same original
 * journal, and do not claim audience delivery or change publication status.
 * The explicit receipt NI disambiguates retries, revisions and requeues.
 */
export async function readback(opts, { fetchImpl = globalThis.fetch, observedAt = new Date().toISOString() } = {}) {
  const queue = need(opts, 'queue');
  const registry = admitAccountRegistry(readJson(need(opts, 'accounts')));
  const accountId = need(opts, 'account');
  const renditionId = need(opts, 'rendition');
  const receiptNi = need(opts, 'receipt');
  const account = registry.accounts.find(row => row.id === accountId);
  if (!account || account.platform !== 'bluesky') throw new Error('Original Bluesky account is not admitted');
  const rendition = readJsonl(join(queue, 'renditions.jsonl')).filter(row => row.id === renditionId && row.accountId === accountId);
  if (rendition.length !== 1) throw new Error('Exactly one original account rendition is required');
  const journalPath = opts.journal ?? join(queue, 'journal.jsonl');
  const history = readJsonl(journalPath);
  const posted = history.filter(row => row.status === 'posted' &&
    row.accountId === accountId && row.renditionId === renditionId &&
    row.transportReceipt?.id === receiptNi);
  if (posted.length !== 1) throw new Error('Exactly one original bound transport receipt is required; legacy or ambiguous posts are held');
  const observation = await readBlueskyJournalPost({
    rendition: rendition[0], account, journalEntry: posted[0],
  }, { fetchImpl, observedAt });
  const event = Object.freeze({
    status: 'public-readback', accountId, platform: 'bluesky',
    renditionId, transportReceiptNi: receiptNi, at: observation.observedAt,
    observation,
  });
  const observationNi = niOfJson(event);
  if (!history.some(row => row.status === 'public-readback' && row.observationNi === observationNi)) {
    appendFileSync(journalPath, JSON.stringify({ observationNi, ...event }) + '\n');
  }
  return { observationNi, standing: observation.standing, observation, readOnly: true };
}

async function main(argv) {
  const [command, ...rest] = argv;
  const opts = options(rest);
  const print = (value) => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  if (command === 'plan') print(plan(opts));
  else if (command === 'due') print(await due(opts));
  else if (command === 'readback') print(await readback(opts));
  else if (command === 'feedback') print(summarize(readJson(need(opts, 'readings'))));
  else if (command === 'verify') {
    const verdict = verifyManifest(readJson(need(opts, 'manifest')), { publicKeys: readJson(need(opts, 'keys')), bytes: opts.file ? readFileSync(opts.file) : undefined, originalBytes: opts.original ? readFileSync(opts.original) : undefined });
    print(verdict);
    if (!verdict.valid) process.exitCode = 1;
  } else { process.stderr.write('usage: syndicate plan|due|readback|feedback|verify (see file header)\n'); process.exitCode = 2; }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2)).catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
void automationAdmission; void niOfBytes;
