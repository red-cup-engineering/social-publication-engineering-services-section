/**
 * Provenance manifests: our own signed account of what a posted file is and where it came from,
 * carried beside (never instead of) whatever the generating platform embedded in the original.
 *
 * What this beats, not just meets:
 *  - the platform's invisible provenance (SynthID, C2PA content credentials, metadata) is never
 *    touched: the unmodified original is archived by content address and named as the ingredient of
 *    every derivative, so the chain from a post back to Google's own credentials stays intact;
 *  - every derivative gets a detached Ed25519-signed manifest (C2PA-shaped assertions: ingredient,
 *    actions) that anyone can verify against a published key, plus a public verification URL;
 *  - the AI-content disclosure is part of the signed statement, not just a caption.
 *
 * A re-encode or crop normally cannot carry the original's embedded manifest across. That is stated
 * in the manifest (`embeddedCredentials`) instead of hidden: the original, with its credentials, is
 * archived and addressed, and the derivative says it is a derivative.
 */
import { createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { canonicalJson, hexOfNi, niOfBytes, niOfJson, sha256Hex } from './canonical.mjs';

export const MANIFEST_VERSION = '561-provenance/1';
export const VERIFY_BASE = 'https://561.group/verify/';

/** Editing actions a derivative may declare; each is a C2PA action name. */
export const DECLARABLE_ACTIONS = Object.freeze(['c2pa.cropped', 'c2pa.resized', 'c2pa.placed', 'c2pa.transcoded', 'c2pa.edited.captioned']);

export const verificationUrl = (ni, base = VERIFY_BASE) => `${base}${encodeURIComponent(ni)}`;

/**
 * @param {object} input
 * @param {{ni:string, mediaType:string, bytes:number}} input.subject  what is posted
 * @param {object} input.content   { itemNi, canonicalUrl }
 * @param {object} input.generator { kind: 'ai-generated'|'human'|'mixed', tool?, model?, generationNi? }
 * @param {object[]} [input.ingredients]  { ni, mediaType, bytes, embeddedCredentials: 'present'|'absent'|'unknown', archive }
 * @param {object[]} [input.actions]      { action, parameters? } with action in DECLARABLE_ACTIONS
 * @param {object} input.disclosure       { aiGenerated: boolean, label: string }
 * @param {object} input.issuer           { id, keyId }
 * @param {string} input.issuedAt         ISO instant (caller's clock)
 */
export function buildManifest({ subject, content, generator, ingredients = [], actions = [], disclosure, issuer, issuedAt, verifyBase = VERIFY_BASE }) {
  for (const field of ['ni', 'mediaType']) if (typeof subject?.[field] !== 'string') throw new TypeError(`manifest subject.${field}`);
  if (!['ai-generated', 'human', 'mixed'].includes(generator?.kind)) throw new TypeError('manifest generator.kind: ai-generated | human | mixed');
  if (generator.kind !== 'human' && disclosure?.aiGenerated !== true) throw new TypeError('AI-generated or mixed media must be disclosed (disclosure.aiGenerated)');
  if (generator.kind !== 'human' && !disclosure.label) throw new TypeError('the disclosure carries its label text');
  for (const entry of actions) if (!DECLARABLE_ACTIONS.includes(entry.action)) throw new RangeError(`undeclarable action ${entry.action}`);
  for (const ingredient of ingredients) {
    if (!['present', 'absent', 'unknown'].includes(ingredient.embeddedCredentials)) throw new TypeError('ingredient.embeddedCredentials: present | absent | unknown');
    hexOfNi(ingredient.ni);
  }
  if (generator.kind !== 'human' && ingredients.length === 0 && generator.tool) throw new TypeError('a derivative of generated media names its original as an ingredient');
  return {
    type: 'ProvenanceManifest',
    version: MANIFEST_VERSION,
    subject: { ni: subject.ni, mediaType: subject.mediaType, bytes: subject.bytes ?? null },
    content: { itemNi: content?.itemNi ?? null, canonicalUrl: content?.canonicalUrl ?? null },
    generator: { kind: generator.kind, tool: generator.tool ?? null, model: generator.model ?? null, generationNi: generator.generationNi ?? null },
    ingredients: ingredients.map((ingredient) => ({
      relationship: 'parentOf', ni: ingredient.ni, mediaType: ingredient.mediaType, bytes: ingredient.bytes ?? null,
      embeddedCredentials: ingredient.embeddedCredentials, archive: ingredient.archive ?? null,
    })),
    actions: actions.map((entry) => ({ action: entry.action, softwareAgent: entry.softwareAgent ?? '561-group/social-publication', parameters: entry.parameters ?? {} })),
    invisibleProvenance: {
      statement: 'No step in this derivation removes, alters or attempts to defeat invisible watermarks (e.g. SynthID), content credentials (C2PA) or embedded metadata of the original. The original is archived unmodified.',
      embeddedCredentials: ingredients.some((ingredient) => ingredient.embeddedCredentials === 'present') ? 'original-archived-derivative-references-it' : 'none-known',
    },
    disclosure: { aiGenerated: disclosure?.aiGenerated === true, label: disclosure?.label ?? null },
    verify: { url: verificationUrl(subject.ni, verifyBase), manifestNi: null },
    issuer: { id: issuer.id, keyId: issuer.keyId },
    issuedAt,
    signature: null,
  };
}

const signingBytes = (manifest) => Buffer.from(canonicalJson({ ...manifest, signature: null, verify: { ...manifest.verify, manifestNi: null } }), 'utf8');

/**
 * Sign a manifest with an Ed25519 private key (PEM string or KeyObject) the caller holds in custody.
 * The key is used and dropped; it is never placed on the manifest or in an error.
 */
export function signManifest(manifest, { keyId, privateKey }) {
  const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
  if (key.asymmetricKeyType !== 'ed25519') throw new TypeError('manifests are signed with Ed25519');
  const value = cryptoSign(null, signingBytes(manifest), key).toString('base64url');
  const signed = { ...manifest, signature: { alg: 'Ed25519', keyId, value } };
  signed.verify = { ...signed.verify, manifestNi: niOfJson({ ...signed, verify: { ...signed.verify, manifestNi: null } }) };
  return signed;
}

/**
 * Verify a manifest.
 * @param {object} manifest
 * @param {{publicKeys: {[keyId:string]: string|KeyObject}, bytes?: Buffer, originalBytes?: Buffer}} options
 *   `bytes` checks the posted file against subject.ni; `originalBytes` checks the first ingredient.
 * @returns {{valid:boolean, problems:string[]}}
 */
export function verifyManifest(manifest, { publicKeys = {}, bytes, originalBytes } = {}) {
  const problems = [];
  if (manifest?.type !== 'ProvenanceManifest' || manifest.version !== MANIFEST_VERSION) return { valid: false, problems: ['not a 561 provenance manifest'] };
  if (!manifest.signature) problems.push('unsigned');
  else {
    const material = publicKeys[manifest.signature.keyId];
    if (!material) problems.push(`unknown signing key ${manifest.signature.keyId}`);
    else {
      const key = typeof material === 'string' ? createPublicKey(material) : material;
      let ok = false;
      try { ok = cryptoVerify(null, signingBytes(manifest), key, Buffer.from(manifest.signature.value, 'base64url')); } catch { ok = false; }
      if (!ok) problems.push('signature does not verify');
    }
    const expected = niOfJson({ ...manifest, verify: { ...manifest.verify, manifestNi: null } });
    if (manifest.verify?.manifestNi !== expected) problems.push('manifest address does not match its content');
  }
  if (bytes && niOfBytes(bytes) !== manifest.subject.ni) problems.push('posted file does not match subject address');
  if (originalBytes) {
    const first = manifest.ingredients[0];
    if (!first) problems.push('no ingredient to compare the original with');
    else if (niOfBytes(originalBytes) !== first.ni) problems.push('original file does not match ingredient address');
  }
  if (manifest.generator.kind !== 'human' && manifest.disclosure.aiGenerated !== true) problems.push('AI-generated media without disclosure');
  return { valid: problems.length === 0, problems };
}

/** Hex digest helper for archive layout (`<root>/<first two hex>/<hex>`). */
export const archiveName = (ni) => { const hex = hexOfNi(ni); return `${hex.slice(0, 2)}/${hex}`; };
export { sha256Hex };
