/**
 * Credential-free public Bluesky post readback for the existing SocialPublicationReceipt.
 * An accepted createRecord result is NOT the same as an independently observed public
 * AppView record. This supplies the latter, without granting permission to post.
 *
 * This is one bounded public observation, not PDS verification, syndication to all
 * followers, evidence of human readership, scientific acceptance, or an editorial grant.
 * Original publication authority and source-currentness remain with the publisher.
 *
 * Lexicon: https://github.com/bluesky-social/atproto/blob/main/lexicons/app/bsky/feed/getPosts.json
 */
import { niOfJson, sha256Hex } from './canonical.mjs';
import { niDigest } from '../index.mjs';
import { blueskyIntentForRendition } from './adapters.mjs';

export const BLUESKY_PUBLIC_POST_ENDPOINT = 'https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts';
export const BLUESKY_POST_READBACK_MAX_BYTES = 131_072;
const NI = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;
const AT_POST = /^at:\/\/(did:[a-z0-9]+:[A-Za-z0-9._:%-]+)\/app\.bsky\.feed\.post\/([A-Za-z0-9._~-]{1,128})$/u;
const CID = /^b[a-z2-7]{16,200}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;
const own = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identity = value => { const { id, ...body } = value; return NI.test(id) && niOfJson(body) === id; };

function validPublicCanonical(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.href === value;
  } catch { return false; }
}

function validUtc(value) {
  return typeof value === 'string' && UTC.test(value) && Number.isFinite(Date.parse(value));
}

/**
 * Bind an exact immutable submitted CID, publisher intent and ni-addressed
 * submission receipt to the original account DID, before any public network read.
 */
export function admitBlueskyPostExpectation({ intent, receipt, publishedCid, repoDid } = {}) {
  if (!own(intent) || intent.type !== 'SocialPublicationIntent' || intent.version !== 1 ||
      !identity(intent) || !validPublicCanonical(intent.canonicalUrl) ||
      typeof intent.text !== 'string' || !intent.text.trim() ||
      Buffer.byteLength(intent.text) > 3000) {
    throw new TypeError('A source-addressed HTTPS public publication intent is required');
  }
  if (!own(receipt) || receipt.type !== 'SocialPublicationReceipt' || receipt.version !== 1 ||
      receipt.provider !== 'bluesky' || receipt.intent !== intent.id ||
      !identity(receipt) || !validUtc(receipt.observedAt) ||
      typeof receipt.externalId !== 'string') {
    throw new TypeError('An exact source-addressed Bluesky submission receipt is required');
  }
  const match = AT_POST.exec(receipt.externalId);
  if (!match || match[1] !== repoDid || typeof publishedCid !== 'string' || !CID.test(publishedCid)) {
    throw new TypeError('Submission must identify the original repository DID, AT post URI and CID');
  }
  return Object.freeze({
    kind: '561-group.social.bluesky-post-expectation.v1',
    intentNi: intent.id, receiptNi: receipt.id, sourceUrl: intent.canonicalUrl,
    text: intent.text, repoDid, uri: receipt.externalId, cid: publishedCid,
  });
}

/** Read only a bounded, explicitly JSON, nonredirecting public response. */
async function boundedPublicJson(response) {
  if (response?.status !== 200 || !/\bapplication\/json\b/iu.test(response.headers?.get('content-type') ?? '') ||
      Number(response.headers?.get('content-length') ?? 0) > BLUESKY_POST_READBACK_MAX_BYTES ||
      !response.body || typeof response.body.getReader !== 'function') {
    await response?.body?.cancel?.().catch(() => {});
    throw new TypeError('Public AppView returned no admissible JSON response');
  }
  const reader = response.body.getReader();
  let total = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new TypeError('Unexpected public response data');
      total += value.byteLength;
      if (total > BLUESKY_POST_READBACK_MAX_BYTES) throw new TypeError('Public response exceeded byte cap');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** A full URL token in post text, rather than a substring of a different URL. */
function exactTextLink(text, canonical) {
  return (text.match(/https?:\/\/[^\s<>"']+/gu) ?? [])
    .some(value => value.replace(/[),.!?;]+$/u, '') === canonical);
}

/**
 * Independently observe the single AT URI through the public Bluesky AppView.
 * 'public-record-match' only means this AppView returned the exact author,
 * record CID, copy and original canonical link at this observation instant.
 * Missing, delayed, hidden or blocked posts are 'not-observed', NOT deleted.
 */
export async function readBlueskyPostReceipt({ intent, receipt, publishedCid, repoDid } = {}, {
  fetchImpl = globalThis.fetch, observedAt = new Date().toISOString(),
} = {}) {
  const expected = admitBlueskyPostExpectation({ intent, receipt, publishedCid, repoDid });
  if (typeof fetchImpl !== 'function' || !validUtc(observedAt))
    throw new TypeError('Public readback needs a fetch function and exact UTC observation time');
  const source = BLUESKY_PUBLIC_POST_ENDPOINT + '?uris=' + encodeURIComponent(expected.uri);
  const common = Object.freeze({
    kind: '561-group.social.bluesky-post-readback.v1',
    intentNi: expected.intentNi, receiptNi: expected.receiptNi,
    uri: expected.uri, expectedDid: expected.repoDid, expectedCid: expected.cid,
    source, observedAt, readOnly: true, verifiedCompletion: false,
    receivingBoundary: 'Exact public AppView observation only; PDS, editorial, source, recipient and Work receiving remain separate.',
  });
  let payload;
  try {
    const response = await fetchImpl(source, {
      method: 'GET', credentials: 'omit', redirect: 'manual',
      headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8_000),
    });
    payload = await boundedPublicJson(response);
  } catch {
    return Object.freeze({ ...common, standing: 'unavailable', reason: 'public-appview-unavailable' });
  }
  if (!own(payload) || !Array.isArray(payload.posts) || payload.posts.length > 1)
    return Object.freeze({ ...common, standing: 'unavailable', reason: 'public-post-response-invalid' });
  if (payload.posts.length === 0)
    return Object.freeze({ ...common, standing: 'not-observed', reason: 'public-appview-returned-no-post' });
  const post = payload.posts[0];
  if (!own(post) || post.uri !== expected.uri || post.author?.did !== expected.repoDid)
    return Object.freeze({ ...common, standing: 'identity-conflict', reason: 'AT-URI-or-author-DID-mismatch' });
  if (post.cid !== expected.cid)
    return Object.freeze({ ...common, standing: 'revision-conflict', reason: 'public-CID-differs-from-submission' });
  if (!own(post.record) || post.record.$type !== 'app.bsky.feed.post' ||
      typeof post.record.text !== 'string' || !post.record.text.isWellFormed())
    return Object.freeze({ ...common, standing: 'unavailable', reason: 'public-record-invalid' });
  if (post.record.text !== expected.text)
    return Object.freeze({ ...common, standing: 'content-conflict', reason: 'public-copy-differs-from-intent' });
  const external = post.record.embed?.$type === 'app.bsky.embed.external' ? post.record.embed.external?.uri : undefined;
  const sourceLink = external === expected.sourceUrl ? 'external-card' :
    exactTextLink(post.record.text, expected.sourceUrl) ? 'visible-text' : null;
  if (!sourceLink)
    return Object.freeze({ ...common, standing: 'source-link-missing', reason: 'public-record-does-not-carry-exact-canonical-URL' });
  return Object.freeze({
    ...common, standing: 'public-record-match', observedCid: post.cid,
    canonicalLinkCarriedBy: sourceLink, publicTextBytes: Buffer.byteLength(post.record.text),
    identityQualification: 'exact-AT-URI-author-DID-CID-copy-and-canonical-link',
  });
}


/**
 * Consume the *original* runDue posted journal, exact rendition and originating
 * account without inventing a transport receipt from an operator's guesses.
 * Legacy journal entries lacking the actual adapter's NI-addressed provider
 * receipt remain held. They cannot be retrospectively upgraded by assumption.
 */
export function admitBlueskyJournalPost({ rendition, account, journalEntry } = {}) {
  if (!own(rendition) || !own(account) || !own(journalEntry) ||
      rendition.platform !== 'bluesky' || account.platform !== 'bluesky' ||
      typeof account.id !== 'string' || !account.id ||
      journalEntry.status !== 'posted' || journalEntry.platform !== 'bluesky' ||
      journalEntry.accountId !== account.id || rendition.accountId !== account.id ||
      journalEntry.renditionId !== rendition.id ||
      typeof rendition.text !== 'string' || typeof rendition.sourceNi !== 'string' ||
      !NI.test(rendition.sourceNi) || journalEntry.sourceNi !== rendition.sourceNi ||
      !NI.test(journalEntry.releaseRef) ||
      journalEntry.textHash !== sha256Hex(rendition.text) ||
      !validUtc(journalEntry.at)) {
    throw new TypeError('Original posted journal, account and rendition are not exactly bound');
  }
  if (!own(journalEntry.transportReceipt) ||
      journalEntry.intentNi === undefined || !NI.test(journalEntry.intentNi) ||
      typeof journalEntry.externalId !== 'string' ||
      typeof journalEntry.externalCid !== 'string' ||
      journalEntry.transportReceipt.responseDigest !== niDigest({
        uri: journalEntry.externalId, cid: journalEntry.externalCid,
      }) ||
      journalEntry.transportReceipt.externalId !== journalEntry.externalId) {
    throw new TypeError('Original publisher transport receipt and CID are missing or changed');
  }
  const intent = blueskyIntentForRendition(rendition);
  if (intent.id !== journalEntry.intentNi) {
    throw new TypeError('Queued rendition no longer matches the actually published intent');
  }
  const original = {
    intent, receipt: journalEntry.transportReceipt,
    publishedCid: journalEntry.externalCid, repoDid: account.did,
  };
  admitBlueskyPostExpectation(original); // enforce the complete original receipt NI
  return Object.freeze(original);
}

/** Credential-free independent observation of the exact originally journaled post. */
export async function readBlueskyJournalPost(journalSource, options = {}) {
  const original = admitBlueskyJournalPost(journalSource);
  return readBlueskyPostReceipt(original, options);
}
