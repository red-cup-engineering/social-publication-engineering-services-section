/**
 * ContentItem -> per-account Renditions.
 *
 * ContentItem (interface the content owners target):
 *   { id: ni, brand, section, kind: 'paper'|'note'|'product'|'place'|'curriculum'|'video'|'report'|'post',
 *     title, summary, canonicalUrl, language?, tags?: [string], priority?: 0..1,
 *     source: { path?, ni },                       // the canonical page/paper bytes' address
 *     media?: [{ role: 'short'|'video'|'infographic'|'slides'|'audio'|'report'|'hero', ni, mediaType,
 *                width?, height?, durationSec?, aiGenerated: boolean, generator?, alt?, originalNi?, manifestNi? }] }
 *
 * A Rendition is what one account posts: text within the platform's limit, the link back to the
 * canonical page, alt text for every image, the AI-content disclosure the platform requires or
 * offers, and a provenance slot (our signed manifest address and the public verification URL).
 * Writing quality is the voice owner's: `copy` is a hook; the default is a plain deterministic
 * template and says so (`copyOrigin: 'template'`) so the gate and reviewers know.
 */
import { graphemeCount, niOfJson, truncateGraphemes } from './canonical.mjs';
import { verificationUrl } from './provenance.mjs';
import { ASPECTS } from './compositor.mjs';
import { ruleFor } from './platform-rules.mjs';

const KINDS = new Set(['paper', 'note', 'product', 'place', 'curriculum', 'video', 'report', 'post']);

export function admitContentItem(item) {
  for (const field of ['id', 'brand', 'section', 'title', 'summary', 'canonicalUrl']) if (typeof item?.[field] !== 'string' || item[field] === '') throw new TypeError(`content item: ${field}`);
  if (!KINDS.has(item.kind)) throw new TypeError(`content item ${item.id}: kind ${[...KINDS].join(' | ')}`);
  if (!/^https:\/\//u.test(item.canonicalUrl)) throw new TypeError(`content item ${item.id}: canonicalUrl must be https`);
  if (!item.source?.ni) throw new TypeError(`content item ${item.id}: source.ni (content address of the canonical bytes)`);
  // Claim references are source-owned NI addresses, not assertions generated
  // from social copy. Unlinked media may have no claim list; if supplied,
  // every distinct consequential claim must be traceable at live receiving.
  if (item.claimRefs !== undefined &&
      (!Array.isArray(item.claimRefs) ||
       new Set(item.claimRefs).size !== item.claimRefs.length ||
       !item.claimRefs.every(ref => typeof ref === 'string' &&
         /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u.test(ref)))) {
    throw new TypeError(`content item ${item.id}: claimRefs must be distinct source NI addresses`);
  }
  for (const media of item.media ?? []) {
    if (!media.ni || !media.mediaType || typeof media.aiGenerated !== 'boolean') throw new TypeError(`content item ${item.id}: media needs ni, mediaType and aiGenerated`);
  }
  return Object.freeze({ tags: [], priority: 0.5, language: 'en', media: [], ...structuredClone(item) });
}

const aspectOf = (media) => {
  if (!media.width || !media.height) return null;
  const ratio = media.width / media.height;
  return Object.entries(ASPECTS).find(([, [w, h]]) => Math.abs(w / h - ratio) < 0.02)?.[0] ?? null;
};

const ROLE_ORDER = { short: 0, video: 1, infographic: 2, slides: 3, hero: 4, audio: 5, report: 6 };

/** Which of an item's media this platform can carry, best first. Video wins where the platform takes it. */
export function mediaFor(item, rule) {
  const picks = [];
  for (const media of [...item.media].sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.ni.localeCompare(b.ni))) {
    const isVideo = media.mediaType.startsWith('video/');
    const isImage = media.mediaType.startsWith('image/');
    const aspect = aspectOf(media);
    if (isVideo && rule.media.video.aspects.length > 0 && (media.durationSec ?? 0) <= rule.media.video.maxSeconds && (aspect === null || rule.media.video.aspects.includes(aspect))) picks.push({ media, aspect, as: 'video' });
    else if (isImage && rule.media.image.maxPerPost > 0 && (aspect === null || rule.media.image.aspects.includes(aspect))) picks.push({ media, aspect, as: 'image' });
  }
  // One video, or up to the platform's image count; never both on a platform that mixes badly.
  const video = picks.find((pick) => pick.as === 'video');
  if (video) return [video];
  return picks.filter((pick) => pick.as === 'image').slice(0, Math.min(rule.media.image.maxPerPost, 4));
}

const camel = (tag) => tag.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((word) => word[0].toUpperCase() + word.slice(1)).join('');
// A hashtag is a short topic name: tags longer than two words or 24 characters are not offered as hashtags.
const hashtagsFor = (item, rule) => item.tags.filter((tag) => tag.trim().split(/\s+/u).length <= 2).map(camel).filter((tag) => tag.length >= 3 && tag.length <= 24).slice(0, rule.hashtags.max).map((tag) => `#${tag}`);

/** The default template: no hype, no invented claim, title and the item's own summary, then the link. */
export function templateCopy(item, rule, { disclosureLine, hashtags }) {
  const link = item.canonicalUrl;
  if (rule.text.linkOnly) return link;
  const tail = [hashtags.join(' '), disclosureLine].filter(Boolean).join('\n');
  const budget = rule.text.maxGraphemes - graphemeCount(link) - graphemeCount(tail) - 4;
  const lead = /[.?!\u2026]$/u.test(item.title) ? item.title : `${item.title}.`;
  const body = budget > graphemeCount(lead) + 20 ? `${lead} ${truncateGraphemes(item.summary, budget - graphemeCount(lead) - 1)}` : truncateGraphemes(lead, Math.max(10, budget));
  return [body, link, tail].filter(Boolean).join('\n\n');
}

/**
 * @param {object} item  an admitted ContentItem
 * @param {object} context { accounts, ruleSet, now, copy?: (item, platform, defaults) => string | {text, title?} }
 */
export function renditionsFor(item, { accounts, ruleSet, copy, verifyBase }) {
  const renditions = [];
  for (const account of accounts) {
    if (account.brand !== item.brand) continue;
    if (!account.sections.includes('*') && !account.sections.includes(item.section)) continue;
    const rule = ruleFor(ruleSet, account.platform);
    const media = mediaFor(item, rule);
    const aiMedia = media.filter((pick) => pick.media.aiGenerated);
    // A post that links to an AI-generated work (a YouTube video made with Notebook, say) discloses it too.
    const disclosure = aiMedia.length === 0 && item.linkedWorkAiGenerated !== true ? { applied: false, mechanism: rule.aiDisclosure.mechanism, apiField: null, label: null, line: null } : {
      applied: true, mechanism: rule.aiDisclosure.mechanism,
      apiField: rule.aiDisclosure.mechanism === 'api-field' ? rule.aiDisclosure.apiField : null,
      label: rule.aiDisclosure.textLabel,
      // The text label is always present for AI media: where the platform also offers a native label, both are used.
      line: rule.aiDisclosure.mechanism === 'none' ? null : rule.aiDisclosure.textLabel,
    };
    const hashtags = hashtagsFor(item, rule);
    const defaults = { disclosureLine: disclosure.line, hashtags };
    const written = copy ? copy(item, account.platform, defaults) : null;
    const text = typeof written === 'string' ? written : written?.text ?? templateCopy(item, rule, defaults);
    const body = {
      itemNi: item.id, accountId: account.id, platform: account.platform, brand: account.brand, section: item.section, kind: item.kind,
      text, title: written?.title ?? (rule.text.titleMaxGraphemes ? truncateGraphemes(item.title, rule.text.titleMaxGraphemes) : null),
      link: item.canonicalUrl, language: item.language,
      sourceNi: item.source.ni,
      ...(item.claimRefs === undefined ? {} : { claimRefs: Object.freeze([...item.claimRefs]) }),
      media: media.map((pick) => ({ ni: pick.media.ni, as: pick.as, role: pick.media.role, aspect: pick.aspect, mediaType: pick.media.mediaType, aiGenerated: pick.media.aiGenerated, alt: pick.media.alt ?? null, manifestNi: pick.media.manifestNi ?? null, originalNi: pick.media.originalNi ?? null })),
      disclosure,
      copyOrigin: written ? 'voice-hook' : 'template',
    };
    const id = niOfJson(body);
    renditions.push(Object.freeze({
      id, ...body, priority: item.priority,
      provenance: { required: aiMedia.length > 0, manifestNis: aiMedia.map((pick) => pick.media.manifestNi).filter(Boolean), verifyUrl: verificationUrl(id, verifyBase), signedByUs: false },
    }));
  }
  return renditions;
}
