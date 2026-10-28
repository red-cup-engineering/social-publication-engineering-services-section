/**
 * Publishing one cycle: due entries are grouped by account and each account runs on its own
 * track. A failure, a rate-limit answer or a hold on one account is recorded against that account
 * and nothing else. Real posting needs three things at once: `live: true` from the operator, an
 * adapter that declares itself live-capable, and the owner's recorded approval of the first live
 * post on that account. Otherwise the adapter is asked only to validate, and the cycle is a dry run.
 *
 * Adapter interface:
 *   { platform, live: boolean,
 *     validate(rendition, account) -> { ok, problems[] },
 *     publish(rendition, { account, authorizedFetch, signal }) -> { externalId, url } }
 * Errors carry `status` (HTTP-like) and optionally `retryAfterSeconds`:
 *   429 -> back off this account until Retry-After (account stays active);
 *   401/403 -> hold the account (a person must look: credential, permission, or platform action);
 *   5xx / network -> retry later, up to maxAttempts, then hold;
 *   other 4xx -> the platform rejected this rendition: refused, never retried.
 */
import { redact, sha256Hex } from './canonical.mjs';
import { authorizedFetchFor, holdAccount } from './accounts.mjs';
import { gateRendition } from './gate.mjs';
import { dueEntries, limitCheck } from './schedule.mjs';
import { ruleFor } from './platform-rules.mjs';
import { qualifySocialSourceReadback } from './source-currentness.mjs';

const MAX_ATTEMPTS = 3;

/** An adapter that never touches the network: validates and reports what it would post. */
export const dryRunAdapter = (platform) => Object.freeze({
  platform, live: false,
  validate: () => ({ ok: true, problems: [] }),
  publish: async (rendition) => ({ externalId: `dry-run:${sha256Hex(rendition.id).slice(0, 12)}`, url: null }),
});

/**
 * @param {object} input
 * @param {object[]} input.entries         schedule entries
 * @param {Map|object} input.renditions    id -> rendition
 * @param {object} input.registry
 * @param {object} input.ruleSet
 * @param {{[platform:string]: object}} input.adapters
 * @param {{[scheme:string]: Function}} input.resolvers credential resolvers
 * @param {object[]} input.journal         prior journal lines (read-only here)
 * @param {number} input.nowMs
 * @param {boolean} [input.live]
 * @param {object} [input.manifests]
 * @param {object} [input.publicKeys]
 * @param {Function} [input.voiceCheck]
 * @param {Function} [input.readCurrentSource] trusted publisher readback port (mandatory for live effects)
 * @returns {Promise<{results: object[], journal: object[], registry: object, perAccount: object}>}
 */
export async function runDue({ entries, renditions, registry, ruleSet, adapters, resolvers = {}, journal = [], nowMs, live = false, manifests = {}, publicKeys = {}, voiceCheck, maxPerAccount = 1, readCurrentSource }) {
  const byId = renditions instanceof Map ? renditions : new Map(Object.entries(renditions));
  const due = dueEntries(entries, nowMs);
  const accountIds = [...new Set(due.map((entry) => entry.accountId))].sort();
  let working = registry;
  const newJournal = [];
  const results = [];

  const track = async (accountId) => {
    const out = { accountId, results: [], journal: [], hold: null };
    const account = working.accounts.find((candidate) => candidate.id === accountId);
    if (!account) return out;
    const rule = ruleFor(ruleSet, account.platform);
    const adapter = adapters[account.platform];
    const history = [...journal, ...newJournal.filter((line) => line.accountId === accountId)];
    let published = 0;
    for (const entry of due.filter((candidate) => candidate.accountId === accountId)) {
      if (published >= maxPerAccount) break;
      const rendition = byId.get(entry.renditionId);
      const record = (status, detail = {}) => {
        const line = { accountId, renditionId: entry.renditionId, platform: account.platform, at: new Date(nowMs).toISOString(), status, textHash: rendition ? sha256Hex(rendition.text) : null, ...detail };
        out.journal.push(line); out.results.push(line);
        return line;
      };
      if (!rendition) { record('refused', { reason: 'rendition missing from the queue' }); continue; }
      if (!adapter) { record('refused', { reason: `no adapter installed for ${account.platform}` }); continue; }
      const gate = gateRendition(rendition, { account, ruleSet, manifests, publicKeys, voiceCheck, history, nowMs, live });
      if (gate.refusals.length > 0) { record('refused', { reason: gate.refusals.join('; ') }); continue; }
      if (gate.holds.length > 0) { record('held', { reason: gate.holds.join('; ') }); continue; }
      const limits = limitCheck(account, rule, history.filter((line) => line.status === 'posted'), nowMs);
      if (!limits.ok) { record('deferred', { reason: limits.reasons.join('; ') }); continue; }
      const check = adapter.validate(rendition, account);
      if (!check.ok) { record('refused', { reason: `adapter validation: ${check.problems.join('; ')}` }); continue; }
      if (!live || !adapter.live) { record('dry-run', { externalId: null }); continue; }
      // Source-readback is a privileged, source-owned READ port. A scheduled
      // rendition is never itself evidence of present editorial admissibility.
      // Recheck after platform/account gates and before credential resolution
      // or any remote posting effect. Missing provider or stale edition holds
      // this rendition only; unrelated accounts and posts may proceed.
      if (typeof readCurrentSource !== 'function') {
        record('held', { reason: 'publisher-source-readback-capability-not-installed' });
        continue;
      }
      let sourceWitness;
      try {
        const readback = await readCurrentSource(Object.freeze({
          canonicalUrl: rendition.link, itemNi: rendition.itemNi,
          sourceNi: rendition.sourceNi, accountId: account.id,
          platform: account.platform, nowMs,
        }));
        sourceWitness = qualifySocialSourceReadback({ rendition, readback, nowMs });
      } catch (error) {
        record('held', { reason: 'publisher-source-readback-unavailable: ' + redact(error.message ?? String(error)) });
        continue;
      }
      if (!sourceWitness.allowed) {
        record('held', { reason: sourceWitness.reason });
        continue;
      }
      let capability;
      try { capability = await authorizedFetchFor(account, resolvers); } catch (error) {
        out.hold = `credential unavailable: ${redact(error.message)}`;
        record('held', { reason: out.hold });
        break;
      }
      try {
        const receipt = await adapter.publish(rendition, { account, authorizedFetch: capability });
        record('posted', { externalId: receipt.externalId, url: receipt.url ?? null,
          ...(account.platform === 'bluesky' && typeof receipt.cid === 'string' ? { externalCid: receipt.cid } : {}),
          ...(account.platform === 'bluesky' && receipt.transportReceipt ? {
            intentNi: receipt.intentNi,
            transportReceipt: receipt.transportReceipt,
          } : {}),
          sourceNi: sourceWitness.sourceNi, releaseRef: sourceWitness.releaseRef,
          sourceObservedAt: sourceWitness.observedAt, sourceClaimsChecked: sourceWitness.claimsChecked });
        published += 1;
      } catch (error) {
        const message = redact(error.message);
        const status = Number(error.status ?? 0);
        if (status === 429) { record('rate-limited', { reason: message, retryAfterSeconds: error.retryAfterSeconds ?? 900, retryNotBefore: new Date(nowMs + (error.retryAfterSeconds ?? 900) * 1000).toISOString() }); break; }
        if (status === 401 || status === 403) { out.hold = `platform answered ${status}: ${message}`; record('held', { reason: out.hold }); break; }
        if (status >= 500 || status === 0) {
          const attempts = history.filter((line) => line.renditionId === entry.renditionId && line.status === 'retry').length + 1;
          if (attempts >= MAX_ATTEMPTS) { out.hold = `platform failed ${attempts} times: ${message}`; record('held', { reason: out.hold }); break; }
          record('retry', { reason: message, attempts }); break;
        }
        record('refused', { reason: `platform rejected the post (${status}): ${message}` });
      }
    }
    return out;
  };

  // Accounts run concurrently; each is a separate track, and a thrown error stays on its track.
  const settled = await Promise.all(accountIds.map((id) => track(id).catch((error) => ({ accountId: id, results: [{ accountId: id, status: 'error', reason: redact(error.message) }], journal: [], hold: `track failed: ${redact(error.message)}` }))));
  const perAccount = {};
  for (const outcome of settled) {
    newJournal.push(...outcome.journal);
    results.push(...outcome.results);
    perAccount[outcome.accountId] = { posted: outcome.results.filter((line) => line.status === 'posted').length, statuses: outcome.results.map((line) => line.status), hold: outcome.hold };
    if (outcome.hold) working = holdAccount(working, outcome.accountId, outcome.hold, new Date(nowMs).toISOString());
  }
  return { results, journal: newJournal, registry: working, perAccount };
}
