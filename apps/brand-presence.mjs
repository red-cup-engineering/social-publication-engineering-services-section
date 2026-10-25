#!/usr/bin/env node
/**
 * Brand-presence operator CLI: the deterministic steps behind opening and keeping a brand's public
 * accounts. It posts nothing, signs up for nothing and holds no credential.
 *
 *   gate        run the editorial gate over a PostCandidateSet (exit 3 on any refusal)
 *   finalize    append each rendition's provenance line (idempotent) and write the file back
 *   links       check every URL a PostCandidateSet uses and record the answers
 *   provenance  build (and, with --key, sign) a provenance record per rendition
 *   verify      verify a provenance record, optionally against the text as posted
 *   handle      probe a handle on a platform (read-only)
 *   rules       check the verified PlatformRuleSet against its dated terms records
 *   drift       re-fetch a terms record's pages and compare hashes
 *   keygen      make a TEST-ONLY Ed25519 key (production keys are an owner decision and are never made here)
 *
 * PostCandidateSet: { type:'PostCandidateSet', version:1, brand, items:[ContentItem + {claims, sources, ai,
 *   authoring, repository, disclosureDecision, renditions:[{platform, text, title?, media?}]}] }
 * Exit codes: 0 ok, 3 refusal or failed verification, 2 usage error.
 */
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, chmodSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { admitPlatformRuleSet } from '../src/syndication/platform-rules.mjs';
import { niOfJson } from '../src/syndication/canonical.mjs';
import { compilePhrases, editorialReport, profileFor, urlsIn } from '../src/syndication/editorial.mjs';
import { buildPostManifest, footerFor, signPostManifest, splitProvenanceFooter, verifyPostManifest } from '../src/syndication/post-provenance.mjs';
import { PROBES, probeHandle } from '../src/syndication/handles.mjs';
import { checkEvidence, driftCheck, mergeRuleSets } from '../src/syndication/rules-evidence.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const content = join(here, '..', 'content');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const fail = (message, code = 2) => { process.stderr.write(`${message}\n`); process.exit(code); };

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const flags = {};
  const positional = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      const name = rest[i].slice(2);
      if (i + 1 < rest.length && !rest[i + 1].startsWith('--')) flags[name] = rest[++i]; else flags[name] = true;
    } else positional.push(rest[i]);
  }
  return { command, flags, positional };
}

export function loadRuleSet(flags = {}) {
  const seed = readJson(flags.seed ?? join(content, 'platform-rules.seed.json'));
  const verified = readJson(flags.verified ?? join(content, 'platform-rules.verified.json'));
  return { seed, verified, merged: admitPlatformRuleSet(mergeRuleSets(seed, verified)) };
}
export const loadPhrases = (flags = {}) => compilePhrases(readJson(flags.phrases ?? join(content, 'editorial', 'phrases.json')));
export function loadProfiles(path) {
  if (!path) return {};
  const stat = readdirSyncSafe(path);
  if (stat === null) { const one = readJson(path); return one.brand ? { [one.brand]: one['x-voice-profile'] ?? one } : one; }
  const out = {};
  for (const name of stat.filter((f) => /\.(?:jsonld|json)$/u.test(f))) {
    const doc = readJson(join(path, name));
    const id = doc.identifier ?? doc.brand;
    if (id && doc['x-voice-profile']) out[id] = doc['x-voice-profile'];
  }
  return out;
}
function readdirSyncSafe(path) { try { return readdirSync(path); } catch { return null; } }

/** PostCandidateSet -> engine-shaped { item, renditions } pairs. Text is used exactly as written. */
export function expand(set) {
  if (set?.type !== 'PostCandidateSet') throw new TypeError('not a PostCandidateSet');
  return set.items.map((raw) => {
    const { renditions = [], ...item } = raw;
    return {
      item,
      renditions: renditions.map((r) => {
        const aiMedia = (r.media ?? []).some((m) => m.aiGenerated);
        const body = { itemNi: item.id, accountId: `${item.brand}@${r.platform}`, platform: r.platform, brand: item.brand, section: item.section, kind: item.kind, text: r.text, title: r.title ?? null, link: item.canonicalUrl, language: item.language ?? 'en', media: (r.media ?? []).map((m) => ({ ni: m.ni, as: m.as ?? 'image', mediaType: m.mediaType ?? 'image/png', aiGenerated: m.aiGenerated === true, alt: m.alt ?? null })), disclosure: { applied: aiMedia, mechanism: 'text-label', apiField: null, label: aiMedia ? 'AI-generated media' : null, line: aiMedia ? 'AI-generated media' : null } };
        return { id: niOfJson(body), ...body };
      }),
    };
  });
}

const timeoutFetch = async (url) => {
  const opts = { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; 561-group-brand-presence/1.0; +https://561.group)' }, signal: AbortSignal.timeout(30_000) };
  let response = await fetch(url, { ...opts, method: 'HEAD' });
  if (response.status >= 400 || response.status === 405) response = await fetch(url, { ...opts, method: 'GET' });
  return response;
};

async function main() {
  const { command, flags, positional } = parseArgs(process.argv.slice(2));
  const nowMs = flags.now ? Date.parse(flags.now) : Date.now();
  switch (command) {
    case 'gate': {
      const set = readJson(positional[0] ?? fail('usage: gate <PostCandidateSet.json> [--profiles dir|file] [--links links.json] [--require-links] [--provenance-mode design|live]'));
      const { merged } = loadRuleSet(flags);
      const phrases = loadPhrases(flags);
      const profiles = loadProfiles(flags.profiles);
      const linkStatus = flags.links ? readJson(flags.links) : {};
      let refused = 0; const reports = [];
      for (const { item, renditions } of expand(set)) {
        for (const rendition of renditions) {
          const report = editorialReport(rendition, { profile: profileFor(profiles, rendition.brand), item, phrases, ruleSet: merged, linkStatus, requireLinkStatus: Boolean(flags['require-links']), provenanceMode: flags['provenance-mode'] ?? 'live' });
          const rule = merged.rules[rendition.platform];
          if (!rule) { report.checks.push({ id: 'platform-rule', level: 'refuse', message: `no platform rule for ${rendition.platform}` }); report.pass = false; }
          else if (rule.automation.mode === 'prohibited') { report.checks.push({ id: 'platform-rule', level: 'refuse', message: `${rendition.platform} prohibits automation and generated text` }); report.pass = false; }
          if (!report.pass) refused++;
          reports.push({ item: item.id, platform: rendition.platform, pass: report.pass, metrics: report.metrics, checks: report.checks });
        }
      }
      process.stdout.write(`${JSON.stringify({ gate: 'editorial-gate/1', brand: set.brand, renditions: reports.length, refused, reports }, null, 2)}\n`);
      process.exit(refused === 0 ? 0 : 3);
      break;
    }
    case 'finalize': {
      const path = positional[0] ?? fail('usage: finalize <PostCandidateSet.json>');
      const set = readJson(path);
      for (const item of set.items) for (const r of item.renditions ?? []) {
        const { payload } = splitProvenanceFooter(r.text);
        r.text = `${payload}\n\n${footerFor(payload)}`;
      }
      writeFileSync(path, `${JSON.stringify(set, null, 2)}\n`);
      process.stdout.write(`finalized ${set.items.reduce((n, i) => n + (i.renditions?.length ?? 0), 0)} renditions\n`);
      break;
    }
    case 'links': {
      const set = readJson(positional[0] ?? fail('usage: links <PostCandidateSet.json> > links.json'));
      const urls = new Set();
      for (const raw of set.items) {
        urlsIn(`${raw.canonicalUrl} ${(raw.renditions ?? []).map((r) => r.text).join(' ')}`).forEach((u) => urls.add(u));
        (raw.claims ?? []).forEach((c) => c.sourceUrl && urls.add(c.sourceUrl));
        (raw.sources ?? []).forEach((s) => s.url && urls.add(s.url));
      }
      const out = {};
      for (const url of [...urls].sort()) {
        if (/^https:\/\/561\.group\/(?:v|verify)\//u.test(url)) { out[url] = { status: null, note: 'provenance record URL; the verification page is not live yet', checkedAt: new Date(nowMs).toISOString() }; continue; }
        try { const r = await timeoutFetch(url); out[url] = { status: r.status, finalUrl: r.url, checkedAt: new Date(nowMs).toISOString() }; }
        catch (error) { out[url] = { status: null, error: String(error.message).slice(0, 100), checkedAt: new Date(nowMs).toISOString() }; }
      }
      process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
      break;
    }
    case 'provenance': {
      const set = readJson(positional[0] ?? fail('usage: provenance <PostCandidateSet.json> --out dir [--key private.pem --key-id id] [--issued-at ISO]'));
      const outDir = flags.out ?? fail('--out dir is required');
      const { merged } = loadRuleSet(flags);
      const phrases = loadPhrases(flags);
      const profiles = loadProfiles(flags.profiles);
      const linkStatus = flags.links ? readJson(flags.links) : {};
      mkdirSync(outDir, { recursive: true });
      const issuedAt = flags['issued-at'] ?? new Date(nowMs).toISOString();
      const key = flags.key ? createPrivateKey(readFileSync(flags.key, 'utf8')) : null;
      const written = [];
      for (const { item, renditions } of expand(set)) for (const rendition of renditions) {
        const report = editorialReport(rendition, { profile: profileFor(profiles, rendition.brand), item, phrases, ruleSet: merged, linkStatus, requireLinkStatus: false, provenanceMode: flags['provenance-mode'] ?? 'live' });
        const manifest = buildPostManifest({
          rendition, item, report,
          source: item.repository, authoring: item.authoring, disclosureDecision: item.disclosureDecision ?? null,
          media: (item.mediaProvenance ?? []), issuer: { id: item.authoring?.issuer ?? '561-group', keyId: flags['key-id'] ?? 'unsigned' }, issuedAt,
        });
        const final = key ? signPostManifest(manifest, { keyId: flags['key-id'] ?? fail('--key-id is required with --key'), privateKey: key }) : manifest;
        const name = `${final.verify.shortUrl.split('/').pop()}.json`;
        writeFileSync(join(outDir, name), `${JSON.stringify(final, null, 2)}\n`);
        written.push({ file: name, platform: rendition.platform, signed: Boolean(final.signature), pass: report.pass });
      }
      process.stdout.write(`${JSON.stringify(written, null, 2)}\n`);
      break;
    }
    case 'verify': {
      const manifest = readJson(positional[0] ?? fail('usage: verify <manifest.json> [--keys keys.json] [--text posted.txt]'));
      const publicKeys = flags.keys ? readJson(flags.keys) : {};
      const result = verifyPostManifest(manifest, { publicKeys, postedText: flags.text ? readFileSync(flags.text, 'utf8') : undefined });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exit(result.valid ? 0 : 3);
      break;
    }
    case 'handle': {
      const platform = flags.platform ?? fail('usage: handle --platform P --name N [--instance host]');
      if (!(platform in PROBES)) fail(`no probe table entry for ${platform}; known: ${Object.keys(PROBES).join(', ')}`);
      const result = await probeHandle(platform, flags.name ?? fail('--name is required'), { options: { instance: flags.instance, domain: flags.domain } });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      break;
    }
    case 'rules': {
      const recordsDir = positional[0] ?? fail('usage: rules <platform-terms-records dir>');
      const records = {};
      for (const f of readdirSync(recordsDir).filter((n) => n.endsWith('.json'))) { const d = readJson(join(recordsDir, f)); if (d.id) records[d.id] = d; }
      const { verified, merged } = loadRuleSet(flags);
      const result = checkEvidence(verified, records, { nowMs });
      process.stdout.write(`${JSON.stringify({ status: merged.status, platforms: Object.keys(merged.rules).length, ...result }, null, 2)}\n`);
      process.exit(result.problems.length === 0 && result.stale.length === 0 ? 0 : 3);
      break;
    }
    case 'drift': {
      const record = readJson(positional[0] ?? fail('usage: drift <platform-terms record.json>'));
      const results = await driftCheck(record);
      process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
      process.exit(results.some((r) => r.state === 'changed') ? 3 : 0);
      break;
    }
    case 'keygen': {
      if (!flags['test-only']) fail('refused: this command makes a TEST-ONLY key. Production signing keys are an owner decision (custody, certificate, rotation) and are never generated here. Pass --test-only to continue.', 3);
      const out = flags.out ?? fail('--out prefix is required');
      const { privateKey, publicKey } = generateKeyPairSync('ed25519');
      writeFileSync(`${out}.private.pem`, privateKey.export({ type: 'pkcs8', format: 'pem' }));
      chmodSync(`${out}.private.pem`, 0o600);
      writeFileSync(`${out}.public.pem`, publicKey.export({ type: 'spki', format: 'pem' }));
      process.stdout.write(`test key written: ${resolve(out)}.{private,public}.pem (use a key id that starts with "test-")\n`);
      break;
    }
    default:
      fail('commands: gate | finalize | links | provenance | verify | handle | rules | drift | keygen');
  }
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => fail(String(error.stack ?? error), 2));
