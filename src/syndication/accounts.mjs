/**
 * AccountRegistry: many brands x many platforms, each account independent.
 *
 * Interface the brand/account thread targets:
 *   { type: 'AccountRegistry', version, accounts: [Account] }
 *   Account = {
 *     id,                          // stable, e.g. 'koios-news@bluesky'
 *     brand,                       // '561-group' | 'red-cup-engineering' | 'lenticule-science' | 'coesite-operations' | 'causeway-services' | ...
 *     platform,                    // key into the PlatformRuleSet
 *     handle, origin?,             // public identity (no secrets)
 *     kind: 'organization' | 'service' | 'personal',
 *     automation: { botDisclosed: boolean },
 *     credentialRef: { scheme: 'env' | 'file' | 'store' | 'none', name },   // a NAME, never a value
 *     timezone,                    // IANA, for posting windows
 *     state: 'planned' | 'active' | 'held' | 'suspended',
 *     hold?: { reason, since },    // set while state === 'held'
 *     approval: { firstPostApprovedAt: ISO | null, approvedBy: string | null },   // the owner approves first live posts
 *     limits?: partial override of PlatformRule.limits.perAccount (only stricter values are honoured),
 *     sections: [string]           // services sections this account speaks for
 *   }
 * Credentials stay in the credential store; this registry holds only references. A secret value or a
 * secret-bearing field name anywhere in the registry is refused.
 */
import { assertNoSecrets, redact } from './canonical.mjs';

const STATES = new Set(['planned', 'active', 'held', 'suspended']);
const KINDS = new Set(['organization', 'service', 'personal']);
const SCHEMES = new Set(['env', 'file', 'store', 'none']);

export function admitAccount(account) {
  assertNoSecrets(account, 'account');
  const need = (field) => { if (typeof account[field] !== 'string' || account[field] === '') throw new TypeError(`account: ${field}`); };
  ['id', 'brand', 'platform', 'handle', 'timezone'].forEach(need);
  if (!KINDS.has(account.kind)) throw new TypeError(`account ${account.id}: kind ${[...KINDS].join(' | ')}`);
  if (!STATES.has(account.state)) throw new TypeError(`account ${account.id}: state ${[...STATES].join(' | ')}`);
  if (!SCHEMES.has(account.credentialRef?.scheme) || typeof account.credentialRef?.name !== 'string') throw new TypeError(`account ${account.id}: credentialRef { scheme, name }`);
  if (account.state === 'held' && !account.hold?.reason) throw new TypeError(`account ${account.id}: a held account states why`);
  try { new Intl.DateTimeFormat('en', { timeZone: account.timezone }); } catch { throw new TypeError(`account ${account.id}: timezone must be an IANA zone`); }
  return Object.freeze({ sections: [], automation: { botDisclosed: false }, approval: { firstPostApprovedAt: null, approvedBy: null }, ...structuredClone(account) });
}

export function admitAccountRegistry(document) {
  if (document?.type !== 'AccountRegistry' || !Array.isArray(document.accounts)) throw new TypeError('not an AccountRegistry');
  const accounts = document.accounts.map(admitAccount);
  if (new Set(accounts.map((account) => account.id)).size !== accounts.length) throw new TypeError('account ids are distinct');
  return Object.freeze({ version: document.version, accounts: Object.freeze(accounts) });
}

/** The limits that bind an account: the platform's, tightened (never loosened) by the account's own. */
export function effectiveLimits(rule, account) {
  const base = rule.limits.perAccount;
  const own = account.limits ?? {};
  return Object.freeze({
    perHour: Math.min(base.perHour, own.perHour ?? Infinity),
    perDay: Math.min(base.perDay, own.perDay ?? Infinity),
    minGapMinutes: Math.max(base.minGapMinutes, own.minGapMinutes ?? 0),
  });
}

/**
 * Credential custody. The registry names a credential; a resolver the host supplies turns the
 * name into an `authorizedFetch` capability. The engine never reads, logs or stores the value:
 * errors that cross this boundary are redacted before anyone sees them.
 *
 * @param {object} account
 * @param {{[scheme:string]: (name:string, account:object) => Promise<Function>|Function}} resolvers
 */
export async function authorizedFetchFor(account, resolvers) {
  if (account.credentialRef.scheme === 'none') throw new Error(`account ${account.id} holds no credential`);
  const resolve = resolvers?.[account.credentialRef.scheme];
  if (typeof resolve !== 'function') throw new Error(`no credential resolver for scheme ${account.credentialRef.scheme}`);
  let capability;
  try { capability = await resolve(account.credentialRef.name, account); } catch (error) { throw new Error(`credential ${account.credentialRef.scheme}:${account.credentialRef.name} unavailable: ${redact(error.message)}`); }
  if (typeof capability !== 'function') throw new TypeError(`credential resolver for ${account.id} must return an authorizedFetch function`);
  return async (...args) => {
    try { return await capability(...args); } catch (error) { throw new Error(redact(error.message)); }
  };
}

/** A held or suspended account is skipped; it never blocks the others. */
export const isPostable = (account) => account.state === 'active';

/** Return a copy of the registry with one account held (immutable update; the caller persists it). */
export function holdAccount(registry, id, reason, at) {
  if (!reason) throw new TypeError('a hold states its reason');
  return Object.freeze({ ...registry, accounts: Object.freeze(registry.accounts.map((account) => (account.id === id ? Object.freeze({ ...account, state: 'held', hold: { reason: redact(reason), since: at } }) : account))) });
}
