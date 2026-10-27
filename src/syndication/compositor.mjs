/**
 * Deterministic compositor: reframes generated media to a channel's shape and applies our own
 * branding. It emits a PLAN (pure data) and renders it two ways: an SVG frame for stills and an
 * ffmpeg argument list for video. Same input, byte-identical plan and arguments.
 *
 * What it MAY do to our own generated output:
 *   crop / reframe, scale, pad, cover Google's visible logo or wordmark with an opaque panel,
 *   place our own lockup, burn in captions, transcode at ordinary quality.
 * What it MUST NOT do (rule: ai-generated-media-keeps-its-invisible-provenance):
 *   strip, alter or try to defeat invisible provenance -- SynthID watermarks, C2PA content
 *   credentials, embedded metadata -- or run any step whose purpose is to make AI-generated media
 *   undetectable. Steps are checked against an allow-list; anything else is refused, and so is a
 *   cover over a region the source has not declared to be a visible mark.
 * The unmodified original stays archived by content address; the manifest (provenance.mjs) names it
 * as the derivative's ingredient.
 */
import { canonicalJson, niOfJson } from './canonical.mjs';

export const ALLOWED_OPS = Object.freeze(['crop', 'scale', 'pad', 'cover-visible-mark', 'overlay-lockup', 'caption', 'transcode']);
const FORBIDDEN_NAME = /(strip|scrub|remove|erase|defeat|evade|launder|spoof|forge)[-_ ]?(meta|c2pa|credential|watermark|synthid|provenance)|denois|inpaint|adversar|diffus|add[-_ ]?noise|re-?sample|screen[-_ ]?record|re-?record/iu;

export const ASPECTS = Object.freeze({ '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5], '16:9': [16, 9] });
const ACTION_OF = { crop: 'c2pa.cropped', scale: 'c2pa.resized', pad: 'c2pa.resized', 'cover-visible-mark': 'c2pa.placed', 'overlay-lockup': 'c2pa.placed', caption: 'c2pa.edited.captioned', transcode: 'c2pa.transcoded' };

const even = (value) => Math.max(2, Math.round(value / 2) * 2);

/** Largest centred (or focus-anchored) crop of the source with the target's aspect. */
export function cropFor(source, aspect, focus = { x: 0.5, y: 0.5 }) {
  const [aw, ah] = ASPECTS[aspect] ?? (() => { throw new RangeError(`unknown aspect ${aspect}`); })();
  const sourceRatio = source.width / source.height;
  const targetRatio = aw / ah;
  let width = source.width;
  let height = source.height;
  if (sourceRatio > targetRatio) width = even(source.height * targetRatio); else height = even(source.width / targetRatio);
  const x = Math.min(source.width - width, Math.max(0, Math.round(focus.x * source.width - width / 2)));
  const y = Math.min(source.height - height, Math.max(0, Math.round(focus.y * source.height - height / 2)));
  return { x, y, width, height };
}

const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const asPixels = (rect, size) => ({ x: Math.round(rect.x * size.width), y: Math.round(rect.y * size.height), width: Math.round(rect.w * size.width), height: Math.round(rect.h * size.height) });

/**
 * @param {object} input
 * @param {object} input.source  { ni, mediaType, width, height, durationSec?, aiGenerated, visibleMark?: { kind, rect: {x,y,w,h} fractions of the source frame } }
 * @param {object} input.target  { aspect, maxWidth }
 * @param {object} input.brand   { id, name, lockupText, background, foreground, accent }
 * @param {object[]} [input.captions]  [{ from, to, text }] seconds (video) or one { text } (still)
 * @param {object[]} [input.extraSteps] steps a caller wants added; each is checked like the built-in ones
 * @param {{x:number,y:number}} [input.focus]
 */
export function planComposition({ source, target, brand, captions = [], extraSteps = [], focus }) {
  if (!source?.ni || !(source.width > 0 && source.height > 0)) throw new TypeError('source needs ni, width, height');
  const steps = [];
  const crop = cropFor(source, target.aspect, focus);
  const cropped = crop.width !== source.width || crop.height !== source.height;
  if (cropped) steps.push({ op: 'crop', rect: crop });
  const [aw, ah] = ASPECTS[target.aspect];
  const outWidth = even(Math.min(target.maxWidth ?? crop.width, crop.width));
  const out = { width: outWidth, height: even((outWidth * ah) / aw) };
  if (out.width !== crop.width || out.height !== crop.height) steps.push({ op: 'scale', width: out.width, height: out.height });
  // Cover Google's visible mark only where the source declares one, and only if the crop kept it in frame.
  if (source.visibleMark) {
    const mark = asPixels(source.visibleMark.rect, source);
    if (intersects(mark, crop)) {
      const inCrop = { x: Math.max(0, mark.x - crop.x), y: Math.max(0, mark.y - crop.y), width: mark.width, height: mark.height };
      const k = out.width / crop.width;
      steps.push({ op: 'cover-visible-mark', markKind: source.visibleMark.kind, rect: { x: Math.round(inCrop.x * k), y: Math.round(inCrop.y * k), width: even(inCrop.width * k), height: even(inCrop.height * k) }, fill: brand.background });
    }
  }
  steps.push({ op: 'overlay-lockup', brand: brand.id, text: brand.lockupText ?? brand.name, position: 'bottom-left', height: even(out.height * 0.045), foreground: brand.foreground, accent: brand.accent });
  if (captions.length > 0) steps.push({ op: 'caption', captions: captions.map((caption) => ({ ...caption })), foreground: brand.foreground, background: brand.background });
  if (source.mediaType?.startsWith('video/')) steps.push({ op: 'transcode', container: 'mp4', videoCodec: 'h264', audioCodec: 'aac', crf: 20, keepAudio: true });
  steps.push(...extraSteps);
  const plan = {
    type: 'CompositionPlan',
    version: 1,
    source: { ni: source.ni, mediaType: source.mediaType, width: source.width, height: source.height, aiGenerated: source.aiGenerated === true },
    target: { aspect: target.aspect, ...out },
    brand: brand.id,
    steps,
    declaredActions: [...new Set(steps.map((step) => ACTION_OF[step.op]).filter(Boolean))],
    provenance: {
      originalArchivedUnmodified: true,
      invisibleWatermarks: 'untouched',
      embeddedCredentials: source.mediaType?.startsWith('video/') || source.mediaType?.startsWith('image/') ? 'not carried across by re-encode; original archived and referenced as ingredient' : 'n/a',
    },
  };
  assertPlanAllowed(plan, source);
  return Object.freeze({ ...plan, ni: niOfJson(plan) });
}

/** Refuse any plan that strays outside the allow-list. Called by planComposition and by anyone handed a plan. */
export function assertPlanAllowed(plan, source = null) {
  for (const step of plan.steps) {
    if (FORBIDDEN_NAME.test([step.op, ...Object.keys(step)].join(' '))) throw new RangeError(`refused: step ${step.op} looks like an attempt to remove or defeat provenance`);
    if (!ALLOWED_OPS.includes(step.op)) throw new RangeError(`refused: operation ${step.op} is not on the compositor's allow-list (${ALLOWED_OPS.join(', ')})`);
    if (step.op === 'cover-visible-mark') {
      if (source && !source.visibleMark) throw new RangeError('refused: nothing declared as a visible mark to cover; the compositor covers only declared logos and wordmarks');
      const area = step.rect.width * step.rect.height;
      if (area > plan.target.width * plan.target.height * 0.12) throw new RangeError('refused: a visible-mark cover larger than 12% of the frame is content removal, not logo coverage');
    }
  }
  if (plan.provenance?.originalArchivedUnmodified !== true) throw new RangeError('refused: the original must be archived unmodified');
  if (plan.provenance?.invisibleWatermarks !== 'untouched') throw new RangeError('refused: invisible watermarks must be untouched');
  return true;
}

const esc = (text) => String(text).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;');

/** SVG rendering of a still: the (cropped) source image, the cover panel, our lockup, a caption line. */
export function renderSvg(plan, { imageHref }) {
  const { width, height } = plan.target;
  const crop = plan.steps.find((step) => step.op === 'crop')?.rect ?? { x: 0, y: 0, width: plan.source.width, height: plan.source.height };
  const k = width / crop.width;
  const parts = [`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`];
  parts.push(`<svg x="0" y="0" width="${width}" height="${height}" viewBox="${crop.x} ${crop.y} ${crop.width} ${crop.height}" preserveAspectRatio="none"><image href="${esc(imageHref)}" width="${plan.source.width}" height="${plan.source.height}"/></svg>`);
  for (const step of plan.steps) {
    if (step.op === 'cover-visible-mark') parts.push(`<rect x="${step.rect.x}" y="${step.rect.y}" width="${step.rect.width}" height="${step.rect.height}" fill="${esc(step.fill)}"/>`);
    if (step.op === 'overlay-lockup') {
      const size = step.height;
      parts.push(`<g><rect x="0" y="${height - size * 1.6}" width="${Math.round(width * 0.5)}" height="${Math.round(size * 1.6)}" fill="${esc(step.accent)}" opacity="0.92"/><text x="${Math.round(size * 0.5)}" y="${height - size * 0.5}" font-family="Inter, Arial, sans-serif" font-size="${size}" font-weight="600" fill="${esc(step.foreground)}">${esc(step.text)}</text></g>`);
    }
    if (step.op === 'caption' && step.captions[0]) parts.push(`<text x="${Math.round(width / 2)}" y="${Math.round(height * 0.88)}" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="${Math.round(height * 0.035)}" fill="${esc(step.foreground)}" stroke="${esc(step.background)}" stroke-width="2" paint-order="stroke">${esc(step.captions[0].text)}</text>`);
  }
  parts.push('</svg>');
  void k;
  return parts.join('\n');
}

/**
 * ffmpeg arguments for the plan's video steps. `-map_metadata 0` copies the original's container
 * metadata across rather than dropping it; nothing here asks ffmpeg to remove anything.
 */
export function ffmpegArgs(plan, { input, output, lockupPng }) {
  const filters = [];
  for (const step of plan.steps) {
    if (step.op === 'crop') filters.push(`crop=${step.rect.width}:${step.rect.height}:${step.rect.x}:${step.rect.y}`);
    if (step.op === 'scale') filters.push(`scale=${step.width}:${step.height}:flags=lanczos`);
    if (step.op === 'cover-visible-mark') filters.push(`drawbox=x=${step.rect.x}:y=${step.rect.y}:w=${step.rect.width}:h=${step.rect.height}:color=${step.fill.replace('#', '0x')}:t=fill`);
  }
  const lockup = plan.steps.find((step) => step.op === 'overlay-lockup');
  const args = ['-hide_banner', '-nostdin', '-y', '-i', input];
  const chain = filters.join(',');
  if (lockupPng && lockup) {
    args.push('-i', lockupPng, '-filter_complex', `[0:v]${chain || 'null'}[base];[base][1:v]overlay=x=0:y=H-h[out]`, '-map', '[out]', '-map', '0:a?');
  } else {
    args.push('-vf', chain || 'null');
  }
  const transcode = plan.steps.find((step) => step.op === 'transcode');
  args.push('-map_metadata', '0', '-c:v', 'libx264', '-crf', String(transcode?.crf ?? 20), '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', output);
  return args;
}

export { canonicalJson };
