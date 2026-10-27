/**
 * Original public-profile receiving for the existing Group brand-presence service.
 * A typed public-copy decision is the sole authority for expected text, DID,
 * prior observation and content address. Public Bluesky AppView is a source
 * observation ONLY. No login, posting, receipt/discharge, Work or credential.
 */
import { niOfBytes } from './canonical.mjs';

export const BLUESKY_PUBLIC_PROFILE_ENDPOINT = 'https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile';
export const PROFILE_READBACK_MAX_BYTES = 32_768;
const NI = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;
const DID = /^did:plc:[a-z2-7]{24}$/u;
const HANDLE = /^(?=.{3,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/u;
const own = value => value && typeof value === 'object' && !Array.isArray(value);
const publicSource = actor => BLUESKY_PUBLIC_PROFILE_ENDPOINT + '?actor=' + encodeURIComponent(actor);

/** Hash literal Unicode UTF-8 bytes. Do not trim, case-fold or normalize text. */
export function profileCopyNi(value) {
  if (typeof value !== 'string' || !value.isWellFormed() || value.length > 4096)
    throw new TypeError('Profile text must be bounded, well-formed Unicode');
  return niOfBytes(Buffer.from(value, 'utf8'));
}

/** Consume the original Group public-copy record, not a query-selected quote. */
export function admitBlueskyProfileDecision(record) {
  if (!own(record) || record.kind !== 'public-copy' || record.platform !== 'bluesky' ||
      record.field !== 'description (profile bio)' ||
      typeof record.id !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+$/u.test(record.id) ||
      typeof record.brand !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(record.brand) ||
      typeof record.account !== 'string' ||
      !own(record.chosen) || typeof record.chosen.id !== 'string' || !NI.test(record.chosen.textNi) ||
      !Array.isArray(record.options) || record.options.length < 2 || record.options.length > 16 ||
      !own(record.observed) || typeof record.observed.text !== 'string' ||
      !NI.test(record.observed.textNi))
    throw new TypeError('Original Bluesky copy decision is not admitted');
  const identity = /^@([^ ()]+) \((did:plc:[a-z2-7]{24})\)$/u.exec(record.account);
  if (!identity || !HANDLE.test(identity[1]) || !DID.test(identity[2]) ||
      record.observed.source !== publicSource(identity[1]) ||
      profileCopyNi(record.observed.text) !== record.observed.textNi)
    throw new TypeError('Original account or prior observation is inconsistent');
  const chosen = record.options.filter(row => row?.id === record.chosen.id);
  if (chosen.length !== 1 || chosen[0].candidate?.type !== 'CopyCandidate' ||
      chosen[0].candidate?.platform !== 'bluesky' ||
      chosen[0].candidate?.field !== 'description' ||
      chosen[0].candidate?.brand !== record.brand ||
      chosen[0].gate?.pass !== true ||
      chosen[0].gate?.report?.textNi !== record.chosen.textNi ||
      profileCopyNi(chosen[0].candidate?.text) !== record.chosen.textNi)
    throw new TypeError('Chosen public copy lacks original passed gate and matching bytes');
  return Object.freeze({
    kind: '561-group.social.bluesky-profile-expectation.v1',
    decisionId: record.id, brand: record.brand, actor: identity[1], did: identity[2],
    originalSource: publicSource(identity[1]), expectedText: chosen[0].candidate.text,
    expectedNi: record.chosen.textNi, previousNi: record.observed.textNi,
  });
}

/** Read at most 32KiB of an unauthenticated, nonredirecting AppView response. */
async function readBoundedPublicJson(response) {
  if (response?.status !== 200 ||
      !/\bapplication\/json\b/iu.test(response.headers?.get('content-type') ?? '') ||
      (Number(response.headers?.get('content-length') ?? 0) > PROFILE_READBACK_MAX_BYTES) ||
      !response.body || typeof response.body.getReader !== 'function') {
    // Refusing a response must release even a nonconsumed HTTP body.
    await response?.body?.cancel?.().catch(() => {});
    throw new TypeError('Public profile could not be admitted');
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const {done,value} = await reader.read();
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new TypeError('Unexpected public response data');
      total += value.byteLength;
      if (total > PROFILE_READBACK_MAX_BYTES) throw new TypeError('Public response exceeded byte cap');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk,offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
}

/**
 * One public observation, immutable readout. text-match is NOT receipt,
 * independent PDS confirmation, account-holder authorization or Work acceptance.
 */
export async function readBlueskyProfileDecision(record, {
  fetchImpl = globalThis.fetch, observedAt = new Date().toISOString(),
} = {}) {
  const expected = admitBlueskyProfileDecision(record); // refuse before network
  if (typeof fetchImpl !== 'function' || typeof observedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u.test(observedAt) ||
      !Number.isFinite(Date.parse(observedAt)))
    throw new TypeError('Original profile read needs a reader and an observed UTC time');
  const common = Object.freeze({
    kind:'561-group.social.bluesky-profile-readback.v1', decisionId:expected.decisionId,
    actor:expected.actor, expectedDid:expected.did, expectedNi:expected.expectedNi,
    previousNi:expected.previousNi, observedAt, source:expected.originalSource,
    readOnly:true, verifiedCompletion:false,
    receivingBoundary:'Public AppView observation; independent account-holder, PDS and Work acceptance are separate.',
  });
  let profile;
  try {
    const response = await fetchImpl(expected.originalSource, {
      method:'GET', credentials:'omit', redirect:'manual',
      headers:{accept:'application/json'}, signal:AbortSignal.timeout(8_000),
    });
    profile = await readBoundedPublicJson(response);
  } catch {
    return Object.freeze({...common,standing:'unavailable',reason:'public-source-unavailable'});
  }
  if (!own(profile) || typeof profile.did !== 'string' || typeof profile.handle !== 'string' ||
      (profile.description !== undefined &&
        (typeof profile.description !== 'string' || profile.description.length > 4096 ||
         !profile.description.isWellFormed())))
    return Object.freeze({...common,standing:'unavailable',reason:'public-profile-invalid'});
  if (profile.did !== expected.did || profile.handle !== expected.actor)
    return Object.freeze({...common,standing:'identity-conflict',reason:'pinned-DID-or-handle-mismatch'});
  const description = profile.description ?? '';
  const observedNi = profileCopyNi(description);
  const standing = description === expected.expectedText && observedNi === expected.expectedNi
    ? 'text-match' : observedNi === expected.previousNi
    ? 'previous-text-visible' : 'text-mismatch';
  return Object.freeze({...common,standing,observedNi,
    observedLength:[...description].length,
    publicDescription:description,
    identityQualification:'source-pinned-DID-and-exact-handle',
    ...(profile.indexedAt && typeof profile.indexedAt === 'string' &&
      /^\d{4}-\d{2}-\d{2}T/u.test(profile.indexedAt) ?
      {profileIndexedAt:profile.indexedAt} : {}),
  });
}
