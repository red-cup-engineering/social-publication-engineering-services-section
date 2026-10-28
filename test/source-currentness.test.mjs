import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifySocialSourceReadback, MAX_SOURCE_READBACK_AGE_MS } from '../src/syndication/source-currentness.mjs';

const ni = (character) => 'ni:///sha-256;' + character.repeat(43);
const nowMs = Date.parse('2026-10-28T15:00:00Z');
const rendition = { itemNi: ni('a'), sourceNi: ni('b'), link: 'https://science.561.group/research/example/', claimRefs: [ni('c')] };
const readback = { type: 'SocialSourceReadback', version: 1, canonicalUrl: rendition.link,
  itemNi: rendition.itemNi, sourceNi: rendition.sourceNi,
  publicationStatus: 'stable', publiclyReadable: true,
  observedAt: '2026-10-28T14:59:59Z', releaseRef: ni('d'),
  claims: [{ ref: ni('c'), disposition: 'current', evidenceRef: ni('e') }] };
const verify = (a = {}) => qualifySocialSourceReadback({ rendition, readback, nowMs, ...a });

test('an exact fresh public source and all current named claims may proceed to the authorized transport', () => {
  assert.deepEqual(verify(), { allowed: true, sourceNi: rendition.sourceNi,
    releaseRef: ni('d'), observedAt: '2026-10-28T14:59:59Z', claimsChecked: 1 });
  assert.equal(Object.isFrozen(verify()), true);
  assert.equal(verify({ readback: { ...readback, publicationStatus: 'active' } }).allowed, true);
});

test('missing original readback, missing release identity, or fake source identities hold', () => {
  for (const report of [null, {}, { ...readback, releaseRef: null },
    { ...readback, canonicalUrl: 'https://wrong.example/' },
    { ...readback, itemNi: ni('x') }, { ...readback, sourceNi: ni('y') }]) {
    assert.equal(verify({ readback: report }).allowed, false);
  }
  assert.match(verify({ rendition: { ...rendition, sourceNi: undefined } }).reason, /source-lineage/u);
});

test('potential, withdrawn, corrected/retracted, hidden, and unknown sources never requeue', () => {
  for (const status of ['potential', 'absurd', 'withdrawn', 'corrected', 'unknown', null]) {
    assert.equal(verify({ readback: { ...readback, publicationStatus: status } }).allowed, false, String(status));
  }
  assert.equal(verify({ readback: { ...readback, publiclyReadable: false } }).allowed, false);
});

test('freshness is exact UTC, forward-looking timestamps and stale receipts hold', () => {
  assert.equal(MAX_SOURCE_READBACK_AGE_MS, 900000);
  for (const observedAt of ['2026-10-28T14:44:59Z', '2026-10-28T15:00:01Z',
    '2026-10-28T14:59:59+00:00', '2026-02-30T12:00:00Z', 'not-a-date', null]) {
    assert.equal(verify({ readback: { ...readback, observedAt } }).allowed, false, String(observedAt));
  }
  assert.equal(verify({ readback: { ...readback, observedAt: '2026-10-28T14:45:00Z' } }).allowed, true);
});

test('mixed document cannot circulate stale statistics under still-current definitions', () => {
  const extra = ni('f');
  const expanded = { ...rendition, claimRefs: [ni('c'), extra] };
  const reported = { ...readback, claims: [...readback.claims,
    { ref: extra, disposition: 'superseded', evidenceRef: ni('g') }] };
  assert.equal(verify({ rendition: expanded, readback: reported }).allowed, false);
  assert.equal(verify({ rendition: expanded, readback: {
    ...reported, claims: reported.claims.map(x => x.ref === extra ? { ...x, disposition: 'current' } : x),
  } }).allowed, true);
});

test('claim lists cannot silently omit material claims or counterfeit evidence', () => {
  assert.match(verify({ readback: { ...readback, claims: [] } }).reason, /consequential-claim/u);
  assert.equal(verify({ readback: { ...readback, claims: [
    { ref: ni('c'), disposition: 'current', evidenceRef: null } ] } }).allowed, false);
  assert.equal(verify({ readback: { ...readback, claims: [readback.claims[0], readback.claims[0]] } }).allowed, false);
  assert.equal(verify({ rendition: { ...rendition, claimRefs: [ni('c'), ni('c')] } }).allowed, false);
});

test('nonfactual media without linked claim references still requires a qualified exact source edition', () => {
  const r = { ...rendition, claimRefs: [] };
  assert.deepEqual(verify({ rendition: r, readback: { ...readback, claims: undefined } }).claimsChecked, 0);
  assert.equal(verify({ rendition: r, readback: { ...readback, sourceNi: ni('x') } }).allowed, false);
});
