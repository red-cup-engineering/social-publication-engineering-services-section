/**
 * Provenance for a posted rendition's words (and, by reference, its media).
 *
 * The media manifest in provenance.mjs says what a file is. This module says the same for a text
 * post: which exact words, from which source and commit, drafted by which tools and models, passing
 * which gate, with which claims and sources, and what the Group chose to disclose about its private
 * sources. It is the same `ProvenanceManifest` (`561-provenance/1`), signed and verified by the same
 * functions, with a `post` section added. Everything under `post` is covered by the signature.
 *
 * What a post carries:  `Provenance: https://561.group/v/<12 characters>` as its last line.
 * What the record holds: the digest of the post WITHOUT that line (a text cannot contain its own
 * hash), so anyone can strip the line, hash the rest and compare. The 12 characters are the first
 * characters of that digest's base64url form; they only find the record, the full digest checks it.
 *
 * Text cannot carry a C2PA manifest (the 2.3+ invisible-Unicode embedding is fragile), so the
 * address-and-record is the primary text provenance; media get a C2PA plan chained onto any upstream
 * manifest (Google's included) and are never re-encoded here.
 */
import { buildManifest, signManifest, verifyManifest } from './provenance.mjs';
import { hexOfNi, niOfBytes, niOfJson } from './canonical.mjs';

export const POST_SCHEMA = '561-provenance-post/1';
export const SHORT_BASE = 'https://561.group/v/';
export const SHORT_ID_LENGTH = 12;
const FOOTER_RE = /(?:^|\n)[ \t]*(?:Provenance:[ \t]*)?https:\/\/561\.group\/v\/([A-Za-z0-9_-]{12})[ \t]*$/u;
const COMMIT_RE = /^[0-9a-f]{40}$/u;

export const IPTC = Object.freeze({
  generated: 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia',
  composite: 'http://cv.iptc.org/newscodes/digitalsourcetype/compositeWithTrainedAlgorithmicMedia',
  algorithmic: 'http://cv.iptc.org/newscodes/digitalsourcetype/algorithmicMedia',
  digitalCreation: 'http://cv.iptc.org/newscodes/digitalsourcetype/digitalCreation',
});

/** The words as posted, minus the trailing provenance line, and the short id that line carries (or null). */
export function splitProvenanceFooter(text) {
  const match = FOOTER_RE.exec(text);
  if (!match) return { payload: text.replace(/\s+$/u, ''), shortId: null };
  return { payload: text.slice(0, match.index).replace(/\s+$/u, ''), shortId: match[1] };
}

export const payloadNi = (payload) => niOfBytes(Buffer.from(payload, 'utf8'));
export const shortIdOf = (ni) => { hexOfNi(ni); return ni.split(';')[1].slice(0, SHORT_ID_LENGTH); };
export const shortUrlOf = (ni) => `${SHORT_BASE}${shortIdOf(ni)}`;

/** The line a rendition must end with once its payload is final. */
export const footerFor = (payload) => `Provenance: ${shortUrlOf(payloadNi(payload.replace(/\s+$/u, '')))}`;

/** Heuristic scan for an embedded C2PA/JUMBF manifest in a media file's bytes. It never edits the file. */
export function detectEmbeddedCredentials(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) return 'unknown';
  const jumbf = bytes.includes(Buffer.from('jumb')) || bytes.includes(Buffer.from('caBX'));
  return jumbf && bytes.includes(Buffer.from('c2pa')) ? 'present' : 'absent';
}

/**
 * A c2patool-shaped plan to chain OUR manifest onto the upstream one. Nothing is signed here.
 * With `--parent`, c2patool records the upstream file as a parentOf ingredient (and an opened action);
 * the upstream manifest, SynthID watermark and metadata stay inside the parent file, which is archived unmodified.
 */
export function c2paPlanFor(media, { brand, brandUrl, recordUrl, manifestNi, claimGenerator = { name: '561 Group social-publication', version: '0.4.0' }, edits = [] }) {
  const ai = media.aiGenerated === true;
  const sourceType = ai ? (edits.length > 0 ? IPTC.generated : IPTC.generated) : IPTC.digitalCreation;
  return {
    applicable: true,
    status: 'unsigned-design',
    verifiedAgainstTool: false,
    note: 'Definition follows the c2patool manifest-definition shape (claim_generator_info, assertions). Untested against a live c2patool in this repository: run it on a copy first. Signing needs the Group signing certificate (an owner decision, see the provenance specification).',
    upstream: { ni: media.originalNi ?? null, c2pa: media.upstream?.c2pa ?? 'unknown', synthid: media.upstream?.synthid ?? 'unknown', archive: 'the unmodified original stays in the archive; never re-encode it' },
    definition: {
      claim_generator_info: [claimGenerator],
      title: media.ni,
      assertions: [
        { label: 'c2pa.actions.v2', data: { actions: edits.map((edit) => ({ action: edit.action, softwareAgent: { name: claimGenerator.name }, description: edit.description ?? null })), } },
        { label: 'stds.schema-org.CreativeWork', data: { '@context': 'https://schema.org', '@type': 'CreativeWork', author: [{ '@type': 'Organization', name: brand, url: brandUrl }], publisher: { '@type': 'Organization', name: '561 Group', url: 'https://561.group' } } },
        { label: 'group.561.provenance', data: { record: recordUrl, manifest: manifestNi } },
      ],
    },
    iptc: { DigitalSourceType: sourceType },
    commands: [
      `exiftool -XMP-iptcExt:DigitalSourceType=${sourceType} <copy-of-derivative>   # before signing`,
      'c2patool <derivative> -m manifest.json --parent <archived-original> -o <signed-out> --force   # sign last, as a child of the upstream manifest',
      'c2patool <signed-out>   # read back; the upstream manifest must still appear as the parent',
    ],
  };
}

const req = (cond, what) => { if (!cond) throw new TypeError(what); };

/**
 * @param {object} input
 * @param {object} input.rendition  engine Rendition; its text must end with the provenance footer for its payload
 * @param {object} input.item       ContentItem (claims, sources, ai optional)
 * @param {object} input.source     { repository, visibility: 'public'|'private', commit, path, publicArtifacts: [url] }
 * @param {object} input.authoring  { office, duty, skill, character, ai: {textGenerated, role, tools:[{name, vendor, model, version, role}]}, humanReview: {state, by, at} }
 * @param {object} input.report     editorialReport(...) result
 * @param {object} [input.disclosureDecision]  required when source.visibility is 'private'
 * @param {object[]} [input.media]  [{ni, mediaType, aiGenerated, originalNi, upstream:{c2pa, synthid}, edits:[]}]
 * @param {object} input.issuer     { id, keyId }
 * @param {string} input.issuedAt   ISO instant
 */
export function buildPostManifest({ rendition, item, source, authoring, report, disclosureDecision = null, media = [], issuer, issuedAt }) {
  const { payload, shortId } = splitProvenanceFooter(rendition.text);
  req(shortId !== null, 'rendition text must end with its provenance line (use footerFor)');
  const ni = payloadNi(payload);
  req(shortIdOf(ni) === shortId, 'provenance line does not match the payload digest');
  req(['public', 'private'].includes(source?.visibility), 'source.visibility: public | private');
  req(source.commit === null || COMMIT_RE.test(source.commit ?? ''), 'source.commit: 40 hex characters or null');
  req(typeof source.repository === 'string' && /^https:\/\//u.test(source.repository), 'source.repository: an https URL');
  req(report?.gate && typeof report.pass === 'boolean', 'a gate report is required');
  req(report.pass === true, 'the editorial gate must pass before a provenance record is built');
  if (source.visibility === 'private') req(disclosureDecision && disclosureDecision.rule && Array.isArray(disclosureDecision.disclosed) && Array.isArray(disclosureDecision.withheld), 'a private source needs a disclosure decision (rule, disclosed, withheld, decidedBy, at)');
  const tools = authoring?.ai?.tools ?? [];
  const aiText = authoring?.ai?.textGenerated === true;
  const aiMedia = media.some((entry) => entry.aiGenerated);
  if (aiText) req(tools.length > 0 && tools.every((tool) => tool.name && tool.model), 'AI text names each tool and model that touched it');
  const reviewed = authoring?.humanReview?.state === 'reviewed';
  if (reviewed) req(authoring.humanReview.by && authoring.humanReview.at, 'a human review names who and when');
  const kind = aiText || aiMedia ? (reviewed ? 'mixed' : 'ai-generated') : 'human';
  const label = aiText || aiMedia ? (rendition.disclosure?.line ?? 'Drafted by an AI agent.') : null;
  const base = buildManifest({
    subject: { ni, mediaType: 'text/plain; charset=utf-8', bytes: Buffer.byteLength(payload, 'utf8') },
    content: { itemNi: item.id, canonicalUrl: item.canonicalUrl },
    generator: { kind, tool: tools.map((t) => t.name).join(' + ') || null, model: tools.map((t) => t.model).join(' + ') || null, generationNi: null },
    ingredients: [{ ni: item.source.ni, mediaType: 'text/html', bytes: null, embeddedCredentials: 'absent', archive: source.commit ? `${source.repository}@${source.commit}` : source.repository }],
    actions: [],
    disclosure: { aiGenerated: kind !== 'human', label },
    issuer,
    issuedAt,
  });
  const recordUrl = shortUrlOf(ni);
  const manifest = {
    ...base,
    verify: { ...base.verify, shortUrl: recordUrl },
    post: {
      schema: POST_SCHEMA,
      renditionId: rendition.id ?? null,
      accountId: rendition.accountId ?? null,
      platform: rendition.platform,
      brand: rendition.brand,
      payload: { digest: ni, hex: hexOfNi(ni), definition: 'the rendition text without its final provenance line, trailing whitespace trimmed, UTF-8', characters: [...payload].length, language: rendition.language ?? 'en' },
      source: {
        repository: source.repository, visibility: source.visibility, commit: source.commit ?? null, path: source.path ?? null,
        publicArtifacts: source.publicArtifacts ?? [],
        statement: source.visibility === 'private'
          ? 'The source repository is private. The commit is recorded here so the Group can show the exact source on request; the public artifacts above are what any reader can check.'
          : 'The source repository is public; the commit above can be read by anyone.',
      },
      authorship: {
        office: authoring.office ?? null, duty: authoring.duty ?? null, skill: authoring.skill ?? null, character: authoring.character ?? null,
        ai: { textGenerated: aiText, role: authoring.ai?.role ?? (aiText ? 'drafted' : 'none'), tools: tools.map((tool) => ({ name: tool.name, vendor: tool.vendor ?? null, model: tool.model, version: tool.version ?? null, role: tool.role ?? 'drafting' })) },
        humanReview: { state: reviewed ? 'reviewed' : 'none', by: authoring.humanReview?.by ?? null, at: authoring.humanReview?.at ?? null },
      },
      editorial: { gate: report.gate, phrasesDigest: report.phrasesDigest, profileDigest: report.profileDigest, reportDigest: niOfJson(report), pass: report.pass, checks: [...new Set(report.checks.map((c) => `${c.id}:${c.level}`))].sort(), metrics: report.metrics },
      claims: (item.claims ?? []).map((claim) => ({ id: claim.id, text: claim.text, status: claim.status, sourceUrl: claim.sourceUrl, sourceNi: claim.sourceNi ?? null, locator: claim.locator ?? null })),
      disclosureDecision,
      media: media.map((entry) => ({
        ni: entry.ni, mediaType: entry.mediaType, aiGenerated: entry.aiGenerated === true, manifestNi: entry.manifestNi ?? null,
        upstream: { ni: entry.originalNi ?? null, c2pa: entry.upstream?.c2pa ?? 'unknown', synthid: entry.upstream?.synthid ?? 'unknown' },
        c2pa: c2paPlanFor(entry, { brand: rendition.brand, brandUrl: item.canonicalUrl, recordUrl, manifestNi: null, edits: entry.edits ?? [] }),
      })),
      corrections: { policy: 'A correction is a new record that names this one; this record is never edited.', supersededBy: null },
    },
  };
  return manifest;
}

export const signPostManifest = (manifest, options) => signManifest(manifest, options);

/**
 * Verify a post manifest. With `postedText` (what the platform shows) it also recomputes the payload digest.
 * @returns {{valid:boolean, problems:string[]}}
 */
export function verifyPostManifest(manifest, { publicKeys = {}, postedText } = {}) {
  const base = verifyManifest(manifest, { publicKeys });
  const problems = [...base.problems];
  const post = manifest?.post;
  if (post?.schema !== POST_SCHEMA) problems.push('not a post provenance record');
  else {
    if (manifest.subject.ni !== post.payload.digest) problems.push('subject address differs from payload digest');
    if (manifest.verify.shortUrl !== shortUrlOf(post.payload.digest)) problems.push('short URL does not derive from the payload digest');
    if (postedText !== undefined) {
      const { payload, shortId } = splitProvenanceFooter(postedText);
      if (shortId !== shortIdOf(post.payload.digest)) problems.push('posted text carries a different provenance id');
      if (payloadNi(payload) !== post.payload.digest) problems.push('posted words do not match the recorded digest');
    }
    if (post.authorship.ai.textGenerated && manifest.generator.kind === 'human') problems.push('AI text recorded as human');
    if (post.source.visibility === 'private' && !post.disclosureDecision) problems.push('private source without a disclosure decision');
    if (post.editorial.pass !== true) problems.push('editorial gate did not pass');
    for (const claim of post.claims) if (!/^https:\/\//u.test(claim.sourceUrl ?? '')) problems.push(`claim ${claim.id} has no https source`);
  }
  return { valid: problems.length === 0, problems };
}
