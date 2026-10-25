/**
 * PlatformRuleSet: per-platform terms-of-service and automation rules as data.
 *
 * The brand/account thread owns the verified rule set; the engine consumes this interface only.
 * A rule never says what to write, it says what the platform admits and how often.
 *
 * Interface (see content/platform-rules.seed.json for a complete example):
 *   { type: 'PlatformRuleSet', version, status: 'seed-unverified' | 'partially-verified' | 'verified', rules: { [platform]: PlatformRule } }
 *   PlatformRule = {
 *     platform, checkedOn: ISO date | null,
 *     text: { maxGraphemes, titleMaxGraphemes? }, hashtags: { max },
 *     media: { image: { aspects, maxBytes, maxPerPost, altTextRequired }, video: { aspects, maxSeconds, maxBytes } },
 *     automation: { mode: 'api-allowed' | 'api-allowed-bot-disclosed' | 'manual-only' | 'prohibited', note },
 *     aiDisclosure: { required, offered, mechanism: 'api-field' | 'platform-ui-label' | 'text-label' | 'none', apiField, textLabel },
 *     limits: { perAccount: { perHour, perDay, minGapMinutes }, perPlatform?: { perDay } },
 *     windows: [{ days: [0..6 (Sunday=0)], startHour, endHour }]  // in the account's own timezone
 *     duplicates: { blockSameTextWithinDays }, linkBack: 'required' | 'optional',
 *     cadence?: { targetPerDay }   // how loud we choose to be inside the hard limits; an account may lower it
 *   }
 */
const MODES = new Set(['api-allowed', 'api-allowed-bot-disclosed', 'manual-only', 'prohibited']);
const MECHANISMS = new Set(['api-field', 'platform-ui-label', 'text-label', 'none']);

const positive = (value, what) => { if (!(Number.isInteger(value) && value >= 0)) throw new TypeError(`${what}: a non-negative integer`); return value; };

export function admitPlatformRule(rule, key) {
  if (rule === null || typeof rule !== 'object') throw new TypeError(`rule ${key}: an object`);
  if (rule.platform !== key) throw new TypeError(`rule ${key}: platform must equal its key`);
  positive(rule.text?.maxGraphemes, `${key}.text.maxGraphemes`);
  positive(rule.hashtags?.max, `${key}.hashtags.max`);
  if (!MODES.has(rule.automation?.mode)) throw new TypeError(`${key}.automation.mode: ${[...MODES].join(' | ')}`);
  if (!MECHANISMS.has(rule.aiDisclosure?.mechanism)) throw new TypeError(`${key}.aiDisclosure.mechanism: ${[...MECHANISMS].join(' | ')}`);
  if (rule.aiDisclosure.mechanism === 'api-field' && !rule.aiDisclosure.apiField) throw new TypeError(`${key}.aiDisclosure.apiField is required for an api-field mechanism`);
  const per = rule.limits?.perAccount;
  positive(per?.perHour, `${key}.limits.perAccount.perHour`); positive(per?.perDay, `${key}.limits.perAccount.perDay`); positive(per?.minGapMinutes, `${key}.limits.perAccount.minGapMinutes`);
  if (!Array.isArray(rule.windows) || rule.windows.length === 0) throw new TypeError(`${key}.windows: at least one posting window`);
  for (const window of rule.windows) {
    if (!Array.isArray(window.days) || window.days.some((day) => !(Number.isInteger(day) && day >= 0 && day <= 6))) throw new TypeError(`${key}.windows.days: integers 0..6`);
    if (!(Number.isInteger(window.startHour) && Number.isInteger(window.endHour) && window.startHour >= 0 && window.endHour <= 24 && window.startHour < window.endHour)) throw new TypeError(`${key}.windows: startHour < endHour within 0..24`);
  }
  if (rule.cadence !== undefined) positive(rule.cadence.targetPerDay, `${key}.cadence.targetPerDay`);
  if (!['required', 'optional'].includes(rule.linkBack)) throw new TypeError(`${key}.linkBack: required | optional`);
  return Object.freeze(structuredClone(rule));
}

export function admitPlatformRuleSet(document) {
  if (document?.type !== 'PlatformRuleSet' || typeof document.rules !== 'object') throw new TypeError('not a PlatformRuleSet');
  if (!['seed-unverified', 'partially-verified', 'verified'].includes(document.status)) throw new TypeError('PlatformRuleSet.status: seed-unverified | partially-verified | verified');
  const rules = Object.fromEntries(Object.entries(document.rules).map(([key, rule]) => [key, admitPlatformRule(rule, key)]));
  return Object.freeze({ version: document.version, status: document.status, rules: Object.freeze(rules) });
}

export function ruleFor(ruleSet, platform) {
  const rule = ruleSet.rules[platform];
  if (!rule) throw new RangeError(`no platform rule for ${platform}; the engine refuses to post where it has no rule`);
  return rule;
}

/** Whether the platform admits this account to be driven by the engine at all. */
export function automationAdmission(rule, account) {
  const { mode } = rule.automation;
  if (mode === 'prohibited') return { automated: false, reason: `${rule.platform} prohibits automation` };
  if (mode === 'manual-only') return { automated: false, reason: `${rule.platform} is manual-only: ${rule.automation.note}` };
  if (mode === 'api-allowed-bot-disclosed' && account.automation?.botDisclosed !== true) return { automated: false, reason: `${rule.platform} requires the account to disclose that it is automated; account ${account.id} does not` };
  return { automated: true, reason: null };
}
