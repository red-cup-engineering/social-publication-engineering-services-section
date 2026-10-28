/**
 * Recheck an accepted public source at the very last boundary before an
 * outbound social effect. This is a pure verdict over a reading returned by
 * the original publisher's trusted, independently configured read capability;
 * it does not fetch, authenticate, authorize publication, or verify the truth
 * of a research claim. A scheduled draft or old source never self-authorizes.
 */
export const MAX_SOURCE_READBACK_AGE_MS = 15 * 60 * 1000;

const NI = /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u;
const isNi = value => typeof value === 'string' && NI.test(value);
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const hold = (reason) => Object.freeze({ allowed: false, reason });
const instant = (value) => {
  if (typeof value !== 'string' || !UTC.test(value)) return NaN;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return NaN;
  const canonical = new Date(parsed).toISOString();
  return value === canonical || value === canonical.replace(/\.000Z$/u, 'Z') ? parsed : NaN;
};

/** A read from the publisher is distinct from a source's editorial decision,
 * and neither implies that a feed subscriber or social user received it.
 * Missing, ambiguous, stale, contested or superseded evidence is a hold.
 * When a rendition names consequential claims, each must have a matching
 * current assessment and a separately named original evidence reference.
 */
export function qualifySocialSourceReadback({ rendition, readback, nowMs } = {}) {
  if (!rendition || !isNi(rendition.itemNi) || !isNi(rendition.sourceNi)
    || typeof rendition.link !== 'string' || !rendition.link.startsWith('https://')) {
    return hold('queued-rendition-lacks-exact-source-lineage');
  }
  if (!Number.isFinite(nowMs)) return hold('distribution-clock-unavailable');
  if (!readback || readback.type !== 'SocialSourceReadback' || readback.version !== 1) {
    return hold('publisher-source-readback-unavailable');
  }
  if (readback.canonicalUrl !== rendition.link || readback.itemNi !== rendition.itemNi
    || readback.sourceNi !== rendition.sourceNi) {
    return hold('queued-source-no-longer-matches-current-public-edition');
  }
  if (!['active', 'stable'].includes(readback.publicationStatus)
    || readback.publiclyReadable !== true) {
    return hold('source-not-currently-admitted-for-public-circulation');
  }
  if (!isNi(readback.releaseRef)) {
    return hold('publisher-release-receipt-not-identified');
  }
  const observedMs = instant(readback.observedAt);
  if (!Number.isFinite(observedMs) || observedMs > nowMs
    || nowMs - observedMs > MAX_SOURCE_READBACK_AGE_MS) {
    return hold('publisher-source-readback-too-old-or-invalid');
  }
  const claims = rendition.claimRefs ?? [];
  if (!Array.isArray(claims) || new Set(claims).size !== claims.length
    || !claims.every(ref => typeof ref === 'string' && ref.trim())) {
    return hold('queued-claim-references-invalid');
  }
  if (claims.length > 0) {
    if (!Array.isArray(readback.claims)) return hold('claim-assessment-unavailable');
    const byRef = new Map();
    for (const claim of readback.claims) {
      if (typeof claim?.ref !== 'string' || byRef.has(claim.ref)) {
        return hold('ambiguous-claim-assessment');
      }
      byRef.set(claim.ref, claim);
    }
    for (const ref of claims) {
      const observation = byRef.get(ref);
      if (observation?.disposition !== 'current' || !isNi(observation.evidenceRef)) {
        return hold('consequential-claim-needs-current-source-evidence');
      }
    }
  }
  return Object.freeze({ allowed: true, sourceNi: rendition.sourceNi,
    releaseRef: readback.releaseRef, observedAt: readback.observedAt,
    claimsChecked: claims.length });
}
