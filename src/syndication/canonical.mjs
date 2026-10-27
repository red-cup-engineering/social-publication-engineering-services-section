/**
 * Shared primitives for the syndication engine: canonical JSON, ni: content addresses, grapheme
 * counts, secret detection and redaction. Pure; no clock, no filesystem, no network.
 */
import { createHash } from 'node:crypto';

/** Deterministic JSON: object keys sorted, undefined dropped, no whitespace. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry === undefined ? null : entry)).join(',')}]`;
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

const base64url = (buffer) => buffer.toString('base64').replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');

/** `ni:///sha-256;<base64url digest>` of bytes (RFC 6920 form used across the house). */
export const niOfBytes = (bytes) => `ni:///sha-256;${base64url(createHash('sha256').update(bytes).digest())}`;

/** The ni: address of a JSON value's canonical form. */
export const niOfJson = (value) => niOfBytes(Buffer.from(canonicalJson(value), 'utf8'));

/** Hex sha-256 carried by an ni: address, for comparison with file digests. */
export function hexOfNi(ni) {
  const match = /^ni:\/\/\/sha-256;([A-Za-z0-9_-]{43})$/u.exec(ni ?? '');
  if (!match) throw new TypeError(`not a sha-256 ni address: ${ni}`);
  return Buffer.from(match[1].replace(/-/gu, '+').replace(/_/gu, '/') + '=', 'base64').toString('hex');
}

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
export const graphemeCount = (text) => [...segmenter.segment(text)].length;

/** Truncate to `limit` graphemes at a word boundary, adding an ellipsis when cut. */
export function truncateGraphemes(text, limit) {
  if (graphemeCount(text) <= limit) return text;
  const parts = [...segmenter.segment(text)].map((entry) => entry.segment);
  let cut = parts.slice(0, Math.max(0, limit - 1)).join('');
  const lastSpace = cut.lastIndexOf(' ');
  if (lastSpace > cut.length * 0.6) cut = cut.slice(0, lastSpace);
  return `${cut.replace(/[\s,;:.\-]+$/u, '')}…`;
}

// Shapes of things that must never appear in a post, a log line or a queue file.
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/u,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/u,
  /\bAIza[0-9A-Za-z_-]{30,}\b/u,
  /\bya29\.[0-9A-Za-z_-]{20,}\b/u,
  /\bAKIA[0-9A-Z]{16}\b/u,
  /\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/u,
  /\b(?:password|passwd|secret|client_secret|refresh_token|access_token|api[_-]?key)\s*[:=]\s*\S{8,}/iu,
];

export const looksSecret = (text) => typeof text === 'string' && SECRET_PATTERNS.some((pattern) => pattern.test(text));

/** Replace secret-shaped substrings with a marker; used on every error message and log line. */
export function redact(text) {
  let out = String(text ?? '');
  for (const pattern of SECRET_PATTERNS) out = out.replace(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`), '[redacted]');
  return out;
}

/** Field names that mean "this holds a secret value"; registries must carry references instead. */
export const SECRET_FIELD = /^(?:password|passwd|secret|token|access_?token|refresh_?token|api_?key|private_?key|client_?secret|authorization|cookie)$/iu;

/** Throw if any key anywhere in `value` is a secret-bearing field name or any string is secret-shaped. */
export function assertNoSecrets(value, path = '$') {
  if (typeof value === 'string') {
    if (looksSecret(value)) throw new TypeError(`${path}: secret-shaped value; hold a credential reference, never a value`);
    return;
  }
  if (value === null || typeof value !== 'object') return;
  for (const [key, inner] of Object.entries(value)) {
    if (SECRET_FIELD.test(key)) throw new TypeError(`${path}.${key}: secret-bearing field; hold a credential reference, never a value`);
    assertNoSecrets(inner, `${path}.${key}`);
  }
}

export const instantMs = (value, what = 'instant') => {
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(ms)) throw new TypeError(`${what}: an ISO instant`);
  return ms;
};
export const iso = (ms) => new Date(ms).toISOString();
