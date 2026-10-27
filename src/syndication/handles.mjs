/**
 * Handle availability: read-only, unauthenticated probes of public pages and APIs.
 *
 * It never signs up, logs in, solves a challenge or tries a blocked endpoint twice. A probe answers
 * one of:
 *   taken         the platform shows an existing account or page of that name
 *   free-looking  the platform answered "no such account"; this is NOT a reservation, and the
 *                 sign-up form is the only authority (reserved words, retired and suspended names)
 *   unknown       the answer cannot distinguish taken from free (login wall, bot block, HTTP 200 for every name)
 *   not-probed    no public check exists; the owner checks inside the sign-up flow
 * The probe table and what each endpoint was seen to return on 2026-10-24 come from the dated
 * platform-terms records (handle-check sections).
 */
export const HANDLE_RESULTS = Object.freeze(['taken', 'free-looking', 'unknown', 'not-probed']);

const jsonBody = async (response) => { try { return JSON.parse(await response.text()); } catch { return undefined; } };

/** platform -> { describe, url(name, opts), classify(response, helpers) } */
export const PROBES = Object.freeze({
  bluesky: {
    describe: 'GET public.api.bsky.app resolveHandle; 200 resolves (taken), 400 does not resolve',
    url: (name, { domain } = {}) => `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(domain ?? `${name}.bsky.social`)}`,
    classify: (response) => (response.status === 200 ? 'taken' : response.status === 400 ? 'free-looking' : 'unknown'),
  },
  mastodon: {
    describe: 'GET <instance>/api/v1/accounts/lookup; 200 taken, 404 no local account',
    url: (name, { instance = 'mastodon.social' } = {}) => `https://${instance}/api/v1/accounts/lookup?acct=${encodeURIComponent(name)}`,
    classify: (response) => (response.status === 200 ? 'taken' : response.status === 404 ? 'free-looking' : 'unknown'),
  },
  github: {
    describe: 'GET github.com/<name>; 200 taken, 404 free (users and organizations share one namespace). api.github.com is not used.',
    url: (name) => `https://github.com/${encodeURIComponent(name)}`,
    classify: (response) => (response.status === 200 ? 'taken' : response.status === 404 ? 'free-looking' : 'unknown'),
  },
  youtube: {
    describe: 'GET youtube.com/@<handle>; 200 taken, 404 no channel',
    url: (name) => `https://www.youtube.com/@${encodeURIComponent(name)}`,
    classify: (response) => (response.status === 200 ? 'taken' : response.status === 404 ? 'free-looking' : 'unknown'),
  },
  linkedin: {
    describe: 'GET linkedin.com/company/<slug>; 404 no Page. Other statuses (999, authwall) are unknown. No bypass is attempted.',
    url: (name) => `https://www.linkedin.com/company/${encodeURIComponent(name)}`,
    classify: (response) => (response.status === 404 ? 'free-looking' : response.status === 200 ? 'unknown' : 'unknown'),
  },
  hackernews: {
    describe: 'GET hacker-news.firebaseio.com/v0/user/<name>.json; body null means no such user (case-sensitive)',
    url: (name) => `https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(name)}.json`,
    classify: async (response) => { if (response.status !== 200) return 'unknown'; const body = await jsonBody(response); return body === null ? 'free-looking' : body && typeof body === 'object' ? 'taken' : 'unknown'; },
  },
  devto: {
    describe: 'GET dev.to/api/users/by_username (users) and /api/organizations/<name>; 404 free, 200 taken. The two share one namespace in practice (unverified).',
    url: (name) => `https://dev.to/api/users/by_username?url=${encodeURIComponent(name)}`,
    alsoUrl: (name) => `https://dev.to/api/organizations/${encodeURIComponent(name)}`,
    classify: (response) => (response.status === 200 ? 'taken' : response.status === 404 ? 'free-looking' : 'unknown'),
  },
  huggingface: {
    describe: 'GET huggingface.co/<name>; 200 taken (organization or user), 404 free',
    url: (name) => `https://huggingface.co/${encodeURIComponent(name)}`,
    classify: (response) => (response.status === 200 ? 'taken' : response.status === 404 ? 'free-looking' : 'unknown'),
  },
  substack: {
    describe: 'GET <name>.substack.com; 404 subdomain unclaimed (may also be reserved)',
    url: (name) => `https://${encodeURIComponent(name)}.substack.com/`,
    classify: (response) => (response.status === 404 ? 'free-looking' : response.status >= 200 && response.status < 400 ? 'taken' : 'unknown'),
  },
  hashnode: {
    describe: 'GET <name>.hashnode.dev; 404 blog subdomain free',
    url: (name) => `https://${encodeURIComponent(name)}.hashnode.dev/`,
    classify: (response) => (response.status === 404 ? 'free-looking' : response.status >= 200 && response.status < 400 ? 'taken' : 'unknown'),
  },
  zenodo: {
    describe: 'GET zenodo.org/api/communities/<slug>; 404 likely free. Rate limited: a 429 is unknown.',
    url: (name) => `https://zenodo.org/api/communities/${encodeURIComponent(name)}`,
    classify: (response) => (response.status === 200 ? 'taken' : response.status === 404 && !response.headers.get('retry-after') ? 'free-looking' : 'unknown'),
  },
  wikidata: {
    describe: 'GET wikidata.org api.php list=users; a "missing" entry means no such username (not a notability finding)',
    url: (name) => `https://www.wikidata.org/w/api.php?action=query&list=users&ususers=${encodeURIComponent(name)}&format=json`,
    classify: async (response) => { if (response.status !== 200) return 'unknown'; const body = await jsonBody(response); const user = body?.query?.users?.[0]; return user ? ('missing' in user ? 'free-looking' : 'taken') : 'unknown'; },
  },
  npm: {
    describe: 'No reliable unauthenticated scope or organization probe (npmjs.com blocks bots; the registry 404s for free and used scopes alike). Check the Create Organization form.',
    url: null,
  },
  x: { describe: 'No public availability endpoint; x.com serves a script shell. Check inside the sign-up flow.', url: null },
  instagram: { describe: 'Login wall. Check inside the sign-up flow.', url: null },
  threads: { describe: 'Threads names are Instagram names; login wall. Check inside the sign-up flow.', url: null },
  tiktok: { describe: 'HTTP 200 for every name; not informative. Check inside the sign-up flow.', url: null },
  reddit: { describe: 'Unauthenticated requests are blocked (403). Check inside the sign-up flow.', url: null },
  medium: { describe: '403 to bots. Check in a browser.', url: null },
  'product-hunt': { describe: '403 to bots; and a brand account cannot post there.', url: null },
});

export async function probeHandle(platform, name, { fetchImpl = globalThis.fetch, options = {}, userAgent = 'Mozilla/5.0 (compatible; 561-group-brand-presence/1.0; +https://561.group)' } = {}) {
  const probe = PROBES[platform];
  if (!probe) return { platform, name, result: 'not-probed', evidence: { describe: `no probe for ${platform}` } };
  if (!probe.url) return { platform, name, result: 'not-probed', evidence: { describe: probe.describe } };
  const attempts = [];
  const urls = [probe.url(name, options), ...(probe.alsoUrl ? [probe.alsoUrl(name)] : [])];
  let results = [];
  for (const url of urls) {
    let response;
    try { response = await fetchImpl(url, { redirect: 'follow', headers: { 'user-agent': userAgent, accept: '*/*' }, signal: AbortSignal.timeout(20_000) }); }
    catch (error) { attempts.push({ url, error: String(error.message).slice(0, 120) }); results.push('unknown'); continue; }
    const result = await probe.classify(response);
    attempts.push({ url, http: response.status, result });
    results.push(result);
  }
  // Taken anywhere is taken; free-looking only if every probe says so.
  const result = results.includes('taken') ? 'taken' : results.every((r) => r === 'free-looking') ? 'free-looking' : 'unknown';
  return { platform, name, result, evidence: { describe: probe.describe, attempts } };
}

/** Handle candidates for a brand: the plain slug, the dashed slug, and the short form; platform syntax filters apply. */
export function candidatesFor(brand, { maxLength = 30, extra = [] } = {}) {
  const base = brand.toLowerCase().replace(/[^a-z0-9]+/gu, ' ').trim();
  const words = base.split(' ');
  const set = new Set([words.join(''), words.join('-'), words.join('_'), ...extra]);
  return [...set].filter((name) => name.length >= 2 && name.length <= maxLength);
}
