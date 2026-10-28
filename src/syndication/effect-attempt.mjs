/**
 * A prepared outbound effect belongs to ONE original account/rendition/slot and
 * the independently received public release. The address is deterministic and
 * does not depend on an API response or on a clock read at retry time.
 *
 * A prepared effect does NOT grant posting authority. A trusted runtime must
 * reserve it durably and uniquely BEFORE any platform write. An ambiguous
 * platform result must never authorize another attempt automatically.
 */
import { niOfJson, sha256Hex } from './canonical.mjs';

const NI = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const isNi = value => typeof value === 'string' && NI.test(value);
const isUtc = value => typeof value === 'string' && UTC.test(value) &&
  Number.isFinite(Date.parse(value)) &&
  (new Date(value).toISOString() === value ||
   new Date(value).toISOString().replace(/\.000Z$/u, 'Z') === value);

export function prepareSocialEffect({ entry, account, rendition, sourceWitness } = {}) {
  if (entry?.status !== 'scheduled' || !isUtc(entry.at) ||
      typeof entry.renditionId !== 'string' || !isNi(entry.renditionId) ||
      typeof entry.accountId !== 'string' || !entry.accountId ||
      typeof account?.id !== 'string' || account.id !== entry.accountId ||
      account.platform !== entry.platform ||
      rendition?.id !== entry.renditionId || rendition.accountId !== account.id ||
      rendition.platform !== account.platform ||
      typeof rendition.text !== 'string' || !rendition.text ||
      !isNi(rendition.sourceNi) ||
      sourceWitness?.allowed !== true || !isNi(sourceWitness.releaseRef) ||
      sourceWitness.sourceNi !== rendition.sourceNi) {
    throw new TypeError('Exact scheduled effect, account, edition and received public release required');
  }
  const body = Object.freeze({
    type: 'SocialPublicationEffectAttempt', version: 1,
    accountId: account.id, platform: account.platform,
    renditionId: rendition.id, sourceNi: rendition.sourceNi,
    releaseRef: sourceWitness.releaseRef, scheduledAt: entry.at,
    textHash: sha256Hex(rendition.text),
  });
  return Object.freeze({ id: niOfJson(body), ...body });
}

/** Receipts for unresolved effects must be settled, never treated as a clear queue. */
export function unresolvedSocialEffects(history = [], { accountId, renditionId } = {}) {
  if (!Array.isArray(history)) throw new TypeError('Original journal must be an array');
  const relevant = history.filter(row => row?.accountId === accountId && row.renditionId === renditionId);
  const posted = new Set(relevant.filter(row => row.status === 'posted' &&
    isNi(row.effectId)).map(row => row.effectId));
  const unsafe = relevant.filter(row =>
    (row.status === 'effect-reserved' &&
      (!isNi(row.effectId) || !posted.has(row.effectId))) ||
    row.status === 'outcome-unknown' ||
    (['posted', 'retry', 'rate-limited'].includes(row.status) &&
      !isNi(row.effectId)));
  return Object.freeze(unsafe.map(row => Object.freeze({
    status: row.status, effectId: isNi(row.effectId) ? row.effectId : null,
    at: typeof row.at === 'string' ? row.at : null,
  })));
}

export function hasSocialEffectAttempt(history = [], attempt) {
  if (!isNi(attempt?.id)) throw new TypeError('Effect attempt NI required');
  return history.some(row => row?.effectId === attempt.id &&
    ['effect-reserved', 'posted', 'outcome-unknown', 'retry', 'rate-limited'].includes(row.status));
}

/** A source-verified durable reservation acknowledgement, NOT a publication receipt. */
export function admitSocialEffectReservation(result, attempt) {
  if (result?.reserved !== true || result.effectId !== attempt?.id) {
    throw new TypeError('Effect must have a matching durable, unique reservation');
  }
  return Object.freeze({ reserved: true, effectId: attempt.id });
}
