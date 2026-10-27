/**
 * The pre-post gate. A rendition goes out only if every check passes; a failure is a `refusal`
 * (this rendition cannot go, fix it) or a `hold` (it may go later: awaiting the owner, a manifest,
 * an account in good standing). Nothing here posts; it only decides.
 *
 * Inputs the other threads own and the gate consumes:
 *   - ruleSet (platform rules), account registry entries, a voice/editorial check (`voiceCheck`),
 *   - provenance manifests for AI media (`manifests` keyed by media ni), verified by `verifyManifest`.
 */
import { graphemeCount, looksSecret, niOfBytes, sha256Hex } from './canonical.mjs';
import { automationAdmission, ruleFor } from './platform-rules.mjs';
import { verifyManifest } from './provenance.mjs';
import { isPostable } from './accounts.mjs';

const HYPE = /\b(?:revolutionary|game[- ]?changing|mind[- ]?blowing|you (?:won't|wont) believe|guaranteed|100% (?:safe|proven)|secret (?:trick|method)|act now|limited time|going viral)\b/iu;
const BAIT = /\b(?:like and subscribe|follow (?:for|4) follow|f4f|rt if|retweet if|share if you|tag (?:a )?friends?|giveaway|dm (?:me )?for)\b/iu;
const EMOJI = /\p{Extended_Pictographic}/gu;

/** The default editorial lint. The voice owner replaces this with its own check of the same shape. */
export function defaultVoiceCheck(rendition) {
  const notes = [];
  const text = rendition.text;
  if (HYPE.test(text)) notes.push('hype language');
  if (BAIT.test(text)) notes.push('engagement bait or fake-engagement request');
  if ((text.match(/!/gu) ?? []).length > 1) notes.push('more than one exclamation mark');
  if ((text.match(EMOJI) ?? []).length > 2) notes.push('more than two emoji');
  const letters = text.replace(/[^\p{L}]/gu, '');
  if (letters.length > 40 && text.replace(/[^\p{Lu}]/gu, '').length / letters.length > 0.35) notes.push('shouting (mostly capitals)');
  if (/\s{3,}/u.test(text.replace(/\n/gu, ' '))) notes.push('stray whitespace');
  return { pass: notes.length === 0, notes };
}

/**
 * @param {object} rendition
 * @param {object} context
 * @param {object} context.account
 * @param {object} context.ruleSet
 * @param {object} [context.manifests]   { [mediaNi]: ProvenanceManifest }
 * @param {{[keyId:string]:string}} [context.publicKeys]
 * @param {Function} [context.voiceCheck] (rendition) => { pass, notes }
 * @param {object[]} [context.history]    prior journal entries { accountId, textHash, at, status }
 * @param {number} context.nowMs
 * @param {boolean} [context.live]        true only when about to publish for real
 * @returns {{ pass: boolean, refusals: string[], holds: string[] }}
 */
export function gateRendition(rendition, { account, ruleSet, manifests = {}, publicKeys = {}, voiceCheck = defaultVoiceCheck, history = [], nowMs, live = false }) {
  const refusals = [];
  const holds = [];
  const rule = ruleFor(ruleSet, rendition.platform);
  if (account.id !== rendition.accountId) refusals.push('rendition belongs to a different account');
  if (!isPostable(account)) holds.push(`account ${account.id} is ${account.state}${account.hold ? `: ${account.hold.reason}` : ''}`);
  const admission = automationAdmission(rule, account);
  if (!admission.automated) refusals.push(`not automatable: ${admission.reason}`);
  if (graphemeCount(rendition.text) > rule.text.maxGraphemes) refusals.push(`text exceeds ${rule.text.maxGraphemes} graphemes`);
  if (rendition.title && rule.text.titleMaxGraphemes && graphemeCount(rendition.title) > rule.text.titleMaxGraphemes) refusals.push('title too long');
  if (looksSecret(rendition.text)) refusals.push('secret-shaped text');
  if (rule.linkBack === 'required' && !rendition.text.includes(rendition.link)) refusals.push('missing link back to the canonical page');
  const tags = rendition.text.match(/(?:^|\s)#[\p{L}\p{N}_]+/gu) ?? [];
  if (tags.length > rule.hashtags.max) refusals.push(`more than ${rule.hashtags.max} hashtags`);
  for (const media of rendition.media) {
    if (rule.media.image.altTextRequired && media.as === 'image' && !media.alt) refusals.push(`image ${media.ni} has no alt text`);
    if (media.aiGenerated && !rendition.disclosure.applied) refusals.push('AI-generated media without the AI-content disclosure');
  }
  if (rendition.disclosure.applied) {
    if (rule.aiDisclosure.mechanism === 'api-field' && !rendition.disclosure.apiField) refusals.push(`platform label ${rule.aiDisclosure.apiField} not set`);
    if (rule.aiDisclosure.mechanism !== 'none' && !rendition.text.includes(rule.aiDisclosure.textLabel) && rendition.platform !== 'youtube') refusals.push('AI-content text label missing');
  }
  if (rendition.provenance.required) {
    for (const media of rendition.media.filter((entry) => entry.aiGenerated)) {
      const manifest = manifests[media.ni];
      if (!manifest) { holds.push(`awaiting provenance manifest for ${media.ni}`); continue; }
      const verdict = verifyManifest(manifest, { publicKeys });
      if (!verdict.valid) holds.push(`manifest for ${media.ni} does not verify: ${verdict.problems.join('; ')}`);
      else if (manifest.subject.ni !== media.ni) refusals.push(`manifest subject does not match media ${media.ni}`);
    }
  }
  const verdict = voiceCheck(rendition);
  if (!verdict.pass) refusals.push(`editorial check: ${verdict.notes.join('; ')}`);
  const textHash = sha256Hex(rendition.text);
  const window = rule.duplicates.blockSameTextWithinDays * 86_400_000;
  if (window > 0 && history.some((entry) => entry.accountId === account.id && entry.textHash === textHash && entry.status === 'posted' && nowMs - Date.parse(entry.at) < window)) refusals.push('same text already posted from this account inside the duplicate window');
  if (live && !account.approval.firstPostApprovedAt) holds.push('awaiting the owner’s approval of the first live post on this account');
  void niOfBytes;
  return { pass: refusals.length === 0 && holds.length === 0, refusals, holds };
}
