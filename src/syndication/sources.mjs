/**
 * Adapters from the house's existing content stores to ContentItems. They only read what the
 * owner section already keeps; nothing is generated or invented here.
 */
import { niOfBytes, niOfJson, truncateGraphemes } from './canonical.mjs';

const clean = (text) => text
  .replace(/https?:\/\/\S+/gu, '')
  .replace(/#[\p{L}\p{N}_]+/gu, '')
  .replace(/^The full lesson:\s*/imu, '')
  .replace(/\s+/gu, ' ')
  .trim();

const firstSentences = (text, limit) => {
  const sentences = clean(text).match(/[^.!?]+[.!?]+(?:\s|$)/gu) ?? [clean(text)];
  let out = '';
  for (const sentence of sentences) { if ((out + sentence).length > limit) break; out += sentence; }
  return (out || truncateGraphemes(clean(text), limit)).trim();
};

const seconds = (iso) => {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u.exec(iso ?? '');
  return match ? Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0) : null;
};

/**
 * ContentItems from a YouTube channel inventory (the Data API upload listing the YouTube section
 * keeps under the house state directory). Only public uploads. A Short that names its full lesson
 * ("The full lesson: https://youtu.be/ID") is not offered separately when the lesson itself is a
 * public upload: the lesson is the item and the Short is a media of it.
 *
 * @param {object} inventory
 * @param {{brand:string, section:string, kind?:string, hashtagOf?:(tag)=>string}} options
 */
export function itemsFromYouTubeInventory(inventory, { brand, section, kind = 'video', topTags = 3 }) {
  const uploads = (inventory.uploads ?? []).filter((upload) => upload.status?.privacyStatus === 'public');
  const byId = new Map(uploads.map((upload) => [upload.id, upload]));
  const items = [];
  const maxViews = Math.max(1, ...uploads.map((upload) => Number(upload.statistics?.viewCount ?? 0)));
  for (const upload of uploads) {
    const description = upload.snippet?.description ?? '';
    const lessonId = /youtu\.be\/([\w-]{11})/u.exec(description)?.[1];
    if (lessonId && byId.has(lessonId)) continue; // the Short rides with its lesson
    const duration = seconds(upload.contentDetails?.duration);
    const title = upload.snippet.title.startsWith('#') ? null : upload.snippet.title;
    const summary = firstSentences(description, 220);
    if (!title || summary.length < 40) continue;
    const published = upload.snippet.publishedAt;
    const canonicalUrl = `https://www.youtube.com/watch?v=${upload.id}`;
    const shortId = [...byId.values()].find((candidate) => candidate.id !== upload.id && new RegExp(`youtu\\.be/${upload.id}`, 'u').test(candidate.snippet?.description ?? ''))?.id ?? null;
    const views = Number(upload.statistics?.viewCount ?? 0) + Number(byId.get(shortId)?.statistics?.viewCount ?? 0);
    items.push({
      id: niOfJson({ youtube: upload.id }), brand, section, kind, title: truncateGraphemes(title, 100), summary,
      canonicalUrl, language: upload.snippet.defaultAudioLanguage?.slice(0, 2) ?? 'en',
      tags: (upload.snippet.tags ?? []).slice(0, topTags).map((tag) => tag.trim()),
      source: { ni: niOfBytes(Buffer.from(`${upload.id}:${upload.etag ?? ''}`)), path: `youtube:${upload.id}` },
      // Reach already earned and recency, both bounded, make an item more worth another channel.
      priority: Number((0.4 + 0.3 * (views / maxViews) + 0.3 * (Date.parse(published) > Date.parse('2026-09-01') ? 1 : 0.3)).toFixed(3)),
      linkedWorkAiGenerated: true, media: [],
      meta: { youtubeId: upload.id, shortId, durationSec: duration, publishedAt: published, views },
    });
  }
  return items;
}

const feedDate = (value) => { const ms = Date.parse(value); return Number.isFinite(ms) ? ms : null; };

/**
 * ContentItems from feed entries (the web-syndication section's feed model, or any list of
 * `{ title, url, date, summary }`). `contentNi` maps a URL to the content address of the page's
 * bytes when the caller has fetched them; an entry whose page was not fetched is refused, because
 * an item with no content address cannot carry provenance.
 *
 * @param {object[]} entries
 * @param {{brand:string, section:string, kind?:string, contentNi:(url:string)=>string|undefined, skipUrls?:Set<string>, now?:number}} options
 */
export function itemsFromFeed(entries, { brand, section, kind = 'post', contentNi, skipUrls = new Set(), maxAgeDays = 60, nowMs }) {
  const dated = entries.filter((entry) => entry.url && entry.title && !skipUrls.has(entry.url) && /^https:\/\//u.test(entry.url)).map((entry) => ({ ...entry, ms: feedDate(entry.date) }));
  const newest = Math.max(...dated.map((entry) => entry.ms ?? 0), 1);
  const seen = new Set();
  const items = [];
  for (const entry of dated.sort((a, b) => (b.ms ?? 0) - (a.ms ?? 0))) {
    if (seen.has(entry.url)) continue;
    seen.add(entry.url);
    if (nowMs && entry.ms && nowMs - entry.ms > maxAgeDays * 86_400_000) continue;
    const summary = firstSentences(entry.summary ?? '', 240);
    const source = contentNi(entry.url);
    if (!source || summary.length < 40) continue;
    const isRoot = new URL(entry.url).pathname === '/';
    items.push({
      id: niOfJson({ url: entry.url }), brand, section, kind: isRoot ? 'product' : kind, title: truncateGraphemes(entry.title.replace(/\s+/gu, ' '), 110), summary,
      canonicalUrl: entry.url, language: 'en', tags: [], source: { ni: source, path: entry.url },
      // Newer first; a site's own front page last, since it describes the site rather than adds to it.
      priority: Number((isRoot ? 0.2 : 0.5 + 0.5 * Math.max(0, Math.min(1, ((entry.ms ?? 0) - (newest - 30 * 86_400_000)) / (30 * 86_400_000)))).toFixed(3)),
      linkedWorkAiGenerated: false, media: [], meta: { publishedAt: entry.ms ? new Date(entry.ms).toISOString() : null },
    });
  }
  return items;
}
