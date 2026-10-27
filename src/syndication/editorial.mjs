/**
 * The editorial gate: deterministic pre-post checks on one rendition's words.
 *
 * It answers one question per check -- may this text go out under this brand -- and never rewrites.
 * Nothing here calls a model, reads a clock or touches the network: links are checked from a
 * `linkStatus` map that a separate, recorded step fills in (apps/brand-presence.mjs `links`).
 *
 * The gate plugs into `gateRendition` as its `voiceCheck`:
 *     const voiceCheck = createVoiceCheck({ profiles, items, phrases, ruleSet, linkStatus });
 *     gateRendition(rendition, { ..., voiceCheck });
 * and returns `{pass, notes}` exactly as the engine expects. `editorialReport` returns the full
 * structured result (check ids, levels, metrics) that the provenance record keeps.
 *
 * Checks (ids): length, readability, banned-phrase, style, claim-source, claim-status, links,
 * alt-text, disclosure-ai, disclosure-provenance, secrets. A `refuse` stops the post; a `note` is
 * advice. Quoted text, code spans and URLs are masked before prose checks (the PTGAE rule that
 * quotations are not house prose).
 */
import { graphemeCount, looksSecret, niOfBytes, niOfJson } from './canonical.mjs';

export const GATE_VERSION = 'editorial-gate/1';

/** PTGAE claim-status labels; a claim carries exactly one. */
export const CLAIM_STATUSES = Object.freeze(['Observed', 'Measured', 'Inferred', 'Hypothesis', 'Model', 'Proposed', 'Required', 'Intended', 'Simulated', 'Unverified', 'Disputed', 'Deprecated', 'Unknown']);
/** Statuses that must be visible in the sentence they cover, because they change what the reader may conclude. */
const STATUS_MUST_SHOW = new Set(['Hypothesis', 'Model', 'Proposed', 'Intended', 'Simulated', 'Unverified', 'Disputed', 'Unknown']);

export const DEFAULT_PROFILE = Object.freeze({
  readability: { maxAvgSentenceWords: 22, maxSentenceWords: 40, maxGradeLevel: 14 },
  emoji: { max: 0 },
  exclamations: { max: 0 },
  dashes: { maxEmDash: 1 },
  capitals: { allow: ['JSON', 'HTTP', 'HTTPS', 'HTML', 'YAML', 'OAUTH', 'WCAG', 'SHA256', 'UTF8', 'ASCII', 'CHANGES', 'README', 'NOTE', 'NIST', 'DNSSEC', 'DNS', 'CVE', 'CVSS', 'LLM', 'LLMS', 'AGENT', 'FOUR', 'WIT', 'ACK', 'ATT', 'TUFTE', 'CAIRN', 'SIGNGRAPH', 'PTGAE', 'NSIDC', 'UNFPA', 'CITATION', 'REQUIRED', 'PAYMENT', 'ISSN', 'ORCID', 'SPDX', 'RFC', 'SIGSTORE', 'DSSE', 'SYNTHID', 'C2PA'] },
  hashtags: { max: 2 },
  linkHosts: ['561.group', 'github.com', 'koios.news', 'doi.org', 'arxiv.org', 'zenodo.org', 'registry.561.group'],
  aiTextDisclosure: { pattern: '\\b(?:AI[- ]drafted|drafted (?:by|with) (?:an? )?(?:AI|agent)|written (?:by|with) (?:an? )?(?:AI|agent)|AI[- ]generated|AI[- ]assisted)\\b', line: 'Drafted by an AI agent.' },
  forbiddenPatterns: [],
});

const SHORTENERS = new Set(['bit.ly', 't.co', 'tinyurl.com', 'goo.gl', 'ow.ly', 'buff.ly', 'is.gd', 'lnkd.in', 'rebrand.ly', 'cutt.ly', 'shorturl.at', 't.ly', 'rb.gy']);
const URL_RE = /https?:\/\/[^\s<>"'\])]+/gu;
const PROVENANCE_RE = /https:\/\/561\.group\/(?:v|verify)\/[A-Za-z0-9_%.\-]+/u;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const HASHTAG_RE = /(?:^|\s)#[\p{L}\p{N}_]+/gu;

const merge = (base, over) => {
  if (over === undefined || over === null) return base;
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over;
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) out[key] = merge(base[key], value);
  return out;
};
export const profileFor = (profiles, brand) => merge(DEFAULT_PROFILE, profiles?.[brand] ?? {});

/** Compile the phrase list once; each rule is case-insensitive and Unicode-aware. */
export function compilePhrases(document) {
  if (document?.type !== 'EditorialPhraseList') throw new TypeError('not an EditorialPhraseList');
  const rules = document.rules.map((rule) => {
    if (!['refuse', 'note'].includes(rule.severity)) throw new TypeError(`phrase rule ${rule.id}: severity refuse | note`);
    return Object.freeze({ ...rule, regex: new RegExp(rule.pattern, 'giu') });
  });
  return Object.freeze({ version: document.version, rules: Object.freeze(rules), digest: niOfJson(document) });
}

/** Replace quotations, code spans, URLs, hashtags and mentions with spaces so prose checks see only our own prose. */
export function maskForProse(text) {
  return text
    .replace(/`[^`\n]*`/gu, (m) => ' '.repeat(m.length))
    .replace(/"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’/gu, (m) => ' '.repeat(m.length))
    .replace(URL_RE, (m) => ' '.repeat(m.length))
    .replace(/(?:^|\s)[#@][\p{L}\p{N}_]+/gu, (m) => ' '.repeat(m.length));
}

const ABBREVIATIONS = /\b(?:e\.g|i\.e|vs|etc|approx|no|fig|eq|dr|mr|ms|mrs|st|inc|ltd|co|v|cf|al)\.$/iu;

/** Split into sentences without a model: terminal punctuation, then a space and an uppercase letter, digit or quote. */
export function splitSentences(text) {
  const flat = text.replace(/\r/gu, '').replace(/\n{2,}/gu, ' \u0001 ').replace(/\n/gu, ' ');
  const pieces = [];
  let current = '';
  const tokens = flat.split(/(\s+)/u);
  for (let i = 0; i < tokens.length; i++) {
    current += tokens[i];
    const word = tokens[i].trim();
    if (word === '\u0001') { current = current.replace('\u0001', ''); if (current.trim()) pieces.push(current.trim()); current = ''; continue; }
    if (/[.!?]["')\]]*$/u.test(word) && !ABBREVIATIONS.test(word)) {
      const next = tokens.slice(i + 1).find((t) => t.trim() !== '');
      if (next === undefined || /^["'(\[]?[\p{Lu}\p{N}]/u.test(next) || next === '\u0001') { if (current.trim()) pieces.push(current.trim()); current = ''; }
    }
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces;
}

export const wordsOf = (text) => text.match(/[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu) ?? [];

function syllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/gu, '');
  if (w.length === 0) return 1;
  if (w.length <= 3) return 1;
  const stripped = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/u, '').replace(/^y/u, '');
  return Math.max(1, (stripped.match(/[aeiouy]{1,2}/gu) ?? []).length);
}

export function readabilityOf(prose) {
  const sentences = splitSentences(prose).filter((s) => wordsOf(s).length > 0);
  const words = sentences.flatMap(wordsOf);
  if (sentences.length === 0 || words.length === 0) return { sentences: 0, words: 0, avgSentenceWords: 0, longestSentenceWords: 0, gradeLevel: 0 };
  const counts = sentences.map((s) => wordsOf(s).length);
  const syl = words.reduce((sum, word) => sum + syllables(word), 0);
  const avg = words.length / sentences.length;
  const grade = 0.39 * avg + 11.8 * (syl / words.length) - 15.59;
  return { sentences: sentences.length, words: words.length, avgSentenceWords: Math.round(avg * 10) / 10, longestSentenceWords: Math.max(...counts), gradeLevel: Math.round(grade * 10) / 10 };
}

const STOP = new Set(['the', 'a', 'an', 'of', 'to', 'in', 'on', 'and', 'or', 'for', 'is', 'are', 'was', 'were', 'it', 'its', 'that', 'this', 'with', 'as', 'by', 'at', 'from', 'be', 'has', 'have', 'had', 'we', 'our', 'not', 'no']);
const contentTokens = (text) => wordsOf(text.toLowerCase()).filter((w) => !STOP.has(w));

const CHECKABLE_CUES = /\b(?:first|only|all|every|never|always|ever|most|fewer|faster|slower|better|best|worst|nobody|everyone|released?|shipped|published|merged|launched|added|removed|fixed|passes|passed|failed|measured|found|showed|shows|reduces?|reduced|increases?|increased|cuts?|ran|runs|tested|verified|proved|proves|demonstrated|announced|reports?|live|deployed|supports?|handles?|prevents?|detects?)\b/iu;

/** A sentence is checkable when a reader could be wrong about it: it has a number, a date, a comparison or an event. */
export function isCheckableSentence(sentence) {
  const bare = sentence.replace(/\b561(?= Group|\.group)/gu, '').replace(/\b(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day\b/gu, '');
  return /\d/u.test(bare) || CHECKABLE_CUES.test(bare);
}

const numbersIn = (text) => (text.replace(/\b561(?= Group|\.group)/gu, '').match(/\d[\d.,]*/gu) ?? []).map((n) => n.replace(/[.,]+$/u, ''));

/** A claim covers a sentence when its content words overlap and every number in the sentence is a number in the claim. */
const covers = (claimText, sentence) => {
  const claimNumbers = new Set(numbersIn(claimText));
  if (numbersIn(sentence).some((n) => !claimNumbers.has(n))) return false;
  const a = contentTokens(claimText);
  const b = contentTokens(sentence);
  if (a.length === 0 || b.length === 0) return false;
  const setA = new Set(a); const setB = new Set(b);
  const aInB = a.filter((t) => setB.has(t)).length / setA.size;
  const bInA = b.filter((t) => setA.has(t)).length / setB.size;
  return aInB >= 0.8 || (bInA >= 0.8 && b.length >= 4);
};

const hostOf = (url) => { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } };
const hostAllowed = (host, allow) => allow.some((entry) => host === entry || host.endsWith(`.${entry}`));
const trimUrl = (url) => url.replace(/[.,;:!?]+$/u, '');

export const urlsIn = (text) => [...new Set((text.match(URL_RE) ?? []).map(trimUrl))];

const checkLink = (url, { profile, linkStatus, requireLinkStatus, provenanceMode }) => {
  const out = [];
  const host = hostOf(url);
  if (!host) return [{ id: 'links', level: 'refuse', message: `not a valid URL: ${url}` }];
  if (!url.startsWith('https://')) out.push({ id: 'links', level: 'refuse', message: `not https: ${url}` });
  if (SHORTENERS.has(host)) out.push({ id: 'links', level: 'refuse', message: `link shortener hides the destination: ${host}` });
  if (/[?&](?:utm_[a-z]+|fbclid|gclid|mc_eid|igshid)=/iu.test(url)) out.push({ id: 'links', level: 'refuse', message: `tracking parameter in ${url}` });
  if (!hostAllowed(host, profile.linkHosts)) out.push({ id: 'links', level: 'note', message: `host ${host} is not in the brand's usual link hosts` });
  if (PROVENANCE_RE.test(url) && provenanceMode === 'design') return out; // verification page not live yet; the CLI says so
  const status = linkStatus?.[url];
  if (!status) out.push({ id: 'links', level: requireLinkStatus ? 'refuse' : 'note', message: `link not checked: ${url}` });
  else if (!(status.status >= 200 && status.status < 400)) out.push({ id: 'links', level: 'refuse', message: `link answers ${status.status ?? 'no response'}: ${url}` });
  return out;
};

/**
 * @param {object} rendition   an engine Rendition ({text, title, platform, brand, link, media, itemNi, disclosure})
 * @param {object} context
 * @param {object} [context.profile]      brand voice profile (merged over DEFAULT_PROFILE)
 * @param {object} [context.item]         the ContentItem, with optional `claims`, `sources`, `ai`
 * @param {object} context.phrases        compilePhrases(...) result
 * @param {object} [context.ruleSet]      admitted PlatformRuleSet, for the platform's text limit
 * @param {object} [context.linkStatus]   { [url]: { status, checkedAt } } from a recorded link check
 * @param {boolean} [context.requireLinkStatus]  live posting: an unchecked link refuses
 * @param {'design'|'live'} [context.provenanceMode]  'design' until the verification page answers
 * @param {'post'|'profile'} [context.kind]  'profile' checks copy that is not a post (a bio, a banner line, a pinned text, an About page): the field's own
 *   `maxGraphemes` replaces the post limit, no provenance footer is required (the decision record carries the copy's provenance), and the ownership line is required
 */
export function editorialReport(rendition, { profile: given, item, phrases, ruleSet, linkStatus = {}, requireLinkStatus = false, provenanceMode = 'live', kind = 'post', maxGraphemes }) {
  const profile = merge(DEFAULT_PROFILE, given ?? {});
  const checks = [];
  const add = (id, level, message, extra = {}) => checks.push({ id, level, message, ...extra });
  const text = rendition.text ?? '';
  const title = rendition.title ?? '';
  const both = `${title}\n${text}`;

  // length: the platform's limit, tightened by the brand's own
  const rule = ruleSet?.rules?.[rendition.platform];
  const limit = kind === 'profile' ? (maxGraphemes ?? Infinity) : Math.min(rule?.text?.maxGraphemes ?? Infinity, profile.platformMax?.[rendition.platform] ?? Infinity);
  const length = graphemeCount(text);
  if (Number.isFinite(limit) && length > limit) add('length', 'refuse', `${length} graphemes exceeds ${limit} for ${rendition.platform}`);
  if (rule?.text?.titleMaxGraphemes && title && graphemeCount(title) > rule.text.titleMaxGraphemes) add('length', 'refuse', `title exceeds ${rule.text.titleMaxGraphemes} graphemes`);
  if (text.trim() === '') add('length', 'refuse', 'empty text');

  // secrets
  if (looksSecret(both)) add('secrets', 'refuse', 'secret-shaped text');

  // prose checks run on masked text
  const prose = maskForProse(both);
  const metrics = { graphemes: length, ...readabilityOf(prose) };
  const read = profile.readability;
  if (metrics.longestSentenceWords > read.maxSentenceWords) add('readability', 'refuse', `a sentence has ${metrics.longestSentenceWords} words; the limit is ${read.maxSentenceWords}`);
  if (metrics.avgSentenceWords > read.maxAvgSentenceWords) add('readability', 'refuse', `average sentence length ${metrics.avgSentenceWords} words exceeds ${read.maxAvgSentenceWords}`);
  if (metrics.gradeLevel > read.maxGradeLevel) add('readability', 'note', `Flesch-Kincaid grade ${metrics.gradeLevel} is above ${read.maxGradeLevel}; PTGAE treats grade as advice, not a target`);

  for (const phrase of [...phrases.rules, ...profile.forbiddenPatterns.map((pattern, i) => ({ id: `brand-forbidden-${i + 1}`, severity: 'refuse', category: 'brand', message: 'Brand-forbidden phrase.', regex: new RegExp(pattern, 'giu') }))]) {
    phrase.regex.lastIndex = 0;
    const match = phrase.regex.exec(prose);
    if (match) add('banned-phrase', phrase.severity, `${phrase.category}: "${match[0].trim()}" -- ${phrase.message}`, { rule: phrase.id });
  }

  // style: emoji, exclamations, hashtags, dashes, shouting
  const emoji = (both.match(EMOJI_RE) ?? []).length;
  if (emoji > profile.emoji.max) add('style', 'refuse', `${emoji} emoji; the limit is ${profile.emoji.max}`);
  const bangs = (prose.match(/!/gu) ?? []).length;
  if (bangs > profile.exclamations.max) add('style', 'refuse', `${bangs} exclamation mark(s); the limit is ${profile.exclamations.max}`);
  const tags = (text.match(HASHTAG_RE) ?? []).length;
  const tagMax = Math.min(profile.hashtags.max, rule?.hashtags?.max ?? Infinity);
  if (tags > tagMax) add('style', 'refuse', `${tags} hashtags; the limit is ${tagMax}`);
  const dashes = (prose.match(/—| -- |–/gu) ?? []).length;
  if (dashes > profile.dashes.maxEmDash) add('style', 'refuse', `${dashes} dashes; the limit is ${profile.dashes.maxEmDash}`);
  const allowCaps = new Set(profile.capitals.allow);
  // Shouting is a run of two or more capitalized words, or a single long capitalized word that is not a known acronym. A lone acronym or file name is not shouting.
  const capsWords = (prose.match(/\b\p{Lu}{2,}(?:[-_]\p{Lu}{2,})*\b/gu) ?? []).filter((w) => !allowCaps.has(w));
  const runs = prose.match(/\b\p{Lu}{3,}(?:\s+\p{Lu}{2,})+\b/gu) ?? [];
  const shoutingRuns = runs.filter((run) => { const words = run.split(/\s+/u); return words.some((w) => !allowCaps.has(w)) && (words.length >= 3 || words.some((w) => w.length >= 5 && !allowCaps.has(w))); });
  if (shoutingRuns.length > 0) add('style', 'refuse', `capitals read as shouting: ${shoutingRuns.join(' | ')}`);
  else if (capsWords.some((w) => w.length >= 5)) add('style', 'note', `capitalized word(s) not in the brand's acronym list: ${[...new Set(capsWords.filter((w) => w.length >= 5))].join(', ')}`);

  // links
  const urls = urlsIn(text);
  const sourceUrls = (item?.claims ?? []).map((claim) => claim.sourceUrl).filter(Boolean);
  for (const url of new Set([...urls, ...sourceUrls])) checks.push(...checkLink(url, { profile, linkStatus, requireLinkStatus, provenanceMode }));
  if (kind === 'post' && rule?.linkBack === 'required' && rendition.link && !text.includes(rendition.link)) add('links', 'refuse', 'missing link back to the canonical page');

  // claims: every checkable sentence is covered by a declared, sourced claim
  const claims = item?.claims ?? [];
  const sourceSet = new Set((item?.sources ?? []).map((source) => source.url));
  for (const claim of claims) {
    if (!claim.id || !claim.text) add('claim-source', 'refuse', 'a claim needs an id and its text');
    if (!CLAIM_STATUSES.includes(claim.status)) add('claim-status', 'refuse', `claim ${claim.id}: status must be one of ${CLAIM_STATUSES.join(', ')}`);
    if (!claim.sourceUrl || !/^https:\/\//u.test(claim.sourceUrl)) add('claim-source', 'refuse', `claim ${claim.id}: needs an https sourceUrl`);
    else if (sourceSet.size > 0 && !sourceSet.has(claim.sourceUrl)) add('claim-source', 'refuse', `claim ${claim.id}: sourceUrl is not listed in the item's sources`);
  }
  const sentences = splitSentences(maskForProse(text)).filter((s) => wordsOf(s).length >= 3);
  for (const sentence of sentences) {
    const original = sentence;
    if (!isCheckableSentence(original)) continue;
    const claim = claims.find((entry) => (!entry.appliesTo || entry.appliesTo.includes(rendition.platform)) && covers(entry.text, original));
    if (!claim) { add('claim-source', 'refuse', `no sourced claim covers: "${original.slice(0, 90)}"`); continue; }
    if (STATUS_MUST_SHOW.has(claim.status) && !new RegExp(`\\b${claim.status}\\b`, 'iu').test(text)) add('claim-status', 'refuse', `claim ${claim.id} is ${claim.status}; the post must say so`);
  }

  // alt text
  for (const media of rendition.media ?? []) {
    const alt = (media.alt ?? '').trim();
    if (alt === '') add('alt-text', 'refuse', `media ${media.ni} has no alt text`);
    else if (alt.length < 20) add('alt-text', 'refuse', `alt text for ${media.ni} is shorter than 20 characters`);
    else if (alt.length > 1000) add('alt-text', 'refuse', `alt text for ${media.ni} is longer than 1000 characters`);
    else if (/^(?:image|picture|photo|graphic|screenshot)\s+of\b/iu.test(alt) || /\.(?:png|jpe?g|gif|webp|mp4)$/iu.test(alt) || /^ni:/u.test(alt)) add('alt-text', 'refuse', `alt text for ${media.ni} is a file name or opens with "image of"; describe what is shown`);
  }

  // disclosure
  const aiText = item?.ai?.textGenerated === true;
  if ((aiText || rendition.media?.some((m) => m.aiGenerated)) && !new RegExp(profile.aiTextDisclosure.pattern, 'iu').test(text) && !(rendition.disclosure?.applied && rendition.disclosure?.line && text.includes(rendition.disclosure.line))) {
    add('disclosure-ai', 'refuse', `AI-made text or media needs a plain disclosure such as "${profile.aiTextDisclosure.line}"`);
  }
  if (kind === 'post' && !PROVENANCE_RE.test(text)) add('disclosure-provenance', 'refuse', 'no link to the public provenance record (https://561.group/v/<id>)');
  if (kind === 'profile' && !new RegExp(profile.ownershipLinePattern ?? 'operated by Morgan Sennhauser', 'iu').test(text)) add('disclosure-ownership', 'refuse', 'the profile must say who operates the brand ("Operated by Morgan Sennhauser")');

  const refusals = checks.filter((c) => c.level === 'refuse');
  return {
    gate: GATE_VERSION,
    kind,
    textNi: niOfBytes(Buffer.from(text, 'utf8')),
    phrasesDigest: phrases.digest,
    profileDigest: niOfJson(profile),
    pass: refusals.length === 0,
    checks,
    metrics,
    summary: { refusals: refusals.length, notes: checks.length - refusals.length },
  };
}

/** The engine-shaped hook: `(rendition) => { pass, notes }`. */
export function createVoiceCheck({ profiles, items = {}, phrases, ruleSet, linkStatus = {}, requireLinkStatus = false, provenanceMode = 'live' }) {
  return function voiceCheck(rendition) {
    const report = editorialReport(rendition, { profile: profileFor(profiles, rendition.brand), item: items[rendition.itemNi], phrases, ruleSet, linkStatus, requireLinkStatus, provenanceMode });
    return { pass: report.pass, notes: report.checks.filter((c) => c.level === 'refuse').map((c) => `${c.id}: ${c.message}`), report };
  };
}
