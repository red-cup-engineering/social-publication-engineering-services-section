/**
 * Platform rules are only as good as the terms they were read from. This module keeps the rule set
 * honest in three ways, all without a network except `driftCheck`:
 *   mergeRuleSets   verified rules replace seed rules platform by platform; the merged set says so
 *   checkEvidence   every verified rule names a dated platform-terms record, its numbers agree with
 *                   that record, and the record is not older than the review interval
 *   driftCheck      re-fetch each recorded source page and compare its hash with the one recorded,
 *                   to tell a person that a platform's terms may have changed (pages that render
 *                   dynamically change often; a changed hash is a prompt to re-read, not a finding)
 */
import { createHash } from 'node:crypto';

export const REVIEW_INTERVAL_DAYS = 90;

export function mergeRuleSets(seed, verified) {
  const rules = { ...seed.rules, ...verified.rules };
  const allVerified = Object.values(rules).every((rule) => rule.checkedOn);
  return { type: 'PlatformRuleSet', version: Math.max(seed.version, verified.version), status: allVerified ? 'verified' : 'partially-verified', because: `${verified.because} (merged over the seed ${seed.version}).`, rules };
}

const recordIdOf = (rule) => rule['x-evidence']?.record;

/**
 * @param {object} ruleSet     a PlatformRuleSet (verified or merged)
 * @param {{[recordId:string]: object}} records   platform-terms records keyed by their `id`
 * @param {{nowMs:number}} options
 * @returns {{problems:string[], stale:string[], unverified:{[platform:string]:string[]}}}
 */
export function checkEvidence(ruleSet, records, { nowMs }) {
  const problems = [];
  const stale = [];
  const unverified = {};
  for (const [platform, rule] of Object.entries(ruleSet.rules)) {
    if (!rule.checkedOn) { unverified[platform] = ['entire rule (seed)']; continue; }
    const id = recordIdOf(rule);
    const record = records[id];
    if (!record) { problems.push(`${platform}: evidence record ${id} not found`); continue; }
    if (record['observed-on'] !== rule['x-evidence'].observedOn) problems.push(`${platform}: rule observedOn ${rule['x-evidence'].observedOn} differs from record ${record['observed-on']}`);
    if (rule.checkedOn !== record['observed-on']) problems.push(`${platform}: checkedOn ${rule.checkedOn} differs from record ${record['observed-on']}`);
    const ageDays = (nowMs - Date.parse(record['observed-on'])) / 86_400_000;
    if (ageDays > REVIEW_INTERVAL_DAYS) stale.push(`${platform}: terms observed ${record['observed-on']} (${Math.floor(ageDays)} days ago)`);
    const limits = record.rules?.['content-limits'];
    const postChars = limits?.data?.['post-chars'];
    if (limits?.status === 'verified' && Number.isInteger(postChars) && rule.text.maxGraphemes > postChars) problems.push(`${platform}: text.maxGraphemes ${rule.text.maxGraphemes} exceeds the verified platform limit ${postChars}`);
    if (limits?.status === 'verified' && Number.isInteger(postChars) && rule.text.maxGraphemes !== postChars) problems.push(`${platform}: text.maxGraphemes ${rule.text.maxGraphemes} differs from the record's ${postChars}`);
    const auto = record.rules?.['automation-api']?.value;
    if (['no', 'prohibited'].includes(String(auto).toLowerCase()) && !['prohibited', 'manual-only'].includes(rule.automation.mode)) problems.push(`${platform}: the record says automation is "${auto}" but the rule allows it`);
    for (const conflict of record['hard-rule-conflicts'] ?? []) if (/prohibit/iu.test(conflict) && rule.automation.mode.startsWith('api-allowed')) problems.push(`${platform}: record lists a hard-rule conflict: ${conflict.slice(0, 120)}`);
    unverified[platform] = Object.entries(rule['x-evidence'].fields ?? {}).filter(([, status]) => !['verified', 'own-policy'].includes(status)).map(([field, status]) => `${field} (${status})`);
  }
  return { problems, stale, unverified };
}

/** Re-fetch every raw-bytes source and compare hashes. `fetchImpl` is injectable for tests. */
export async function driftCheck(record, { fetchImpl = globalThis.fetch, userAgent = 'Mozilla/5.0 (compatible; 561-group-brand-presence/1.0; +https://561.group)' } = {}) {
  const results = [];
  for (const source of record.sources ?? []) {
    if (source.fetch?.kind !== 'raw-bytes' || !source.fetch.sha256) { results.push({ id: source.id, url: source.url, state: 'not-hashable', reason: `recorded as ${source.fetch?.kind}` }); continue; }
    try {
      const response = await fetchImpl(source.url, { redirect: 'follow', headers: { 'user-agent': userAgent }, signal: AbortSignal.timeout(40_000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      results.push({ id: source.id, url: source.url, state: sha256 === source.fetch.sha256 ? 'unchanged' : 'changed', http: response.status, sha256, recorded: source.fetch.sha256 });
    } catch (error) { results.push({ id: source.id, url: source.url, state: 'unreachable', reason: String(error.message).slice(0, 120) }); }
  }
  return results;
}
