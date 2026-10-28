import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  admitAccount, admitAccountRegistry, admitContentItem, admitPlatformRuleSet, allocationMultiplier, assertNoSecrets, authorizedFetchFor, buildManifest,
  canonicalJson, channelFacts, defaultVoiceCheck, dryRunAdapter, effectiveLimits, ffmpegArgs, gateRendition, graphemeCount, hexOfNi, holdAccount, limitCheck,
  looksSecret, niOfBytes, niOfJson, planComposition, planSchedule, readingsFromYouTubeInventory, redact, renderSvg, renditionsFor, runDue, signManifest,
  summarize, verifyManifest, assertPlanAllowed, manualPacket, ruleFor,
} from '../src/syndication/index.mjs';

const ruleSet = admitPlatformRuleSet(JSON.parse(readFileSync(new URL('../content/platform-rules.seed.json', import.meta.url), 'utf8')));
const TZ = 'America/Chicago';

const account = (id, platform, extra = {}) => ({
  id, brand: '561-group', platform, handle: `@${id}`, did: 'did:plc:abcdefghijklmnopqrstuvwx', kind: 'organization', automation: { botDisclosed: true },
  credentialRef: { scheme: 'env', name: `CRED_${id.replace(/\W/gu, '_').toUpperCase()}` }, timezone: TZ, state: 'active', sections: ['*'],
  approval: { firstPostApprovedAt: '2026-10-25T00:00:00Z', approvedBy: 'owner' }, ...extra,
});
const registryOf = (...accounts) => admitAccountRegistry({ type: 'AccountRegistry', version: 1, accounts });

const sourceNi = niOfBytes(Buffer.from('canonical page'));
const item = (n, extra = {}) => admitContentItem({
  id: niOfJson({ n }), brand: '561-group', section: 'science', kind: 'paper', title: `Paper number ${n}`,
  summary: 'A plain summary of what the paper shows and the one result a reader can check for themselves.', canonicalUrl: `https://science.561.group/papers/${n}`,
  tags: ['climate', 'research', 'open', 'extra'], source: { ni: sourceNi }, priority: 0.5, ...extra,
});

test('canonical JSON and ni addresses do not depend on key order, and ni round-trips to hex', () => {
  assert.equal(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] }), canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
  const ni = niOfBytes(Buffer.from('x'));
  assert.match(ni, /^ni:\/\/\/sha-256;[A-Za-z0-9_-]{43}$/u);
  assert.equal(hexOfNi(ni).length, 64);
  assert.equal(graphemeCount('a\u{1F469}‍\u{1F52C}b'), 3);
});

test('secrets are detected, redacted and refused in registries', () => {
  assert.ok(looksSecret('Bearer abcdefghijklmnopqrstuvwxyz0123456789'));
  assert.ok(looksSecret('refresh_token=1//0abcdefghijkl'));
  assert.equal(redact('failed with Bearer abcdefghijklmnopqrstuvwxyz0123456789 now'), 'failed with [redacted] now');
  assert.throws(() => assertNoSecrets({ account: { token: 'x' } }), /secret-bearing field/u);
  assert.throws(() => admitAccount({ ...account('a@bluesky', 'bluesky'), password: 'hunter2hunter2' }), /secret-bearing field/u);
  assert.throws(() => admitAccount({ ...account('a@bluesky', 'bluesky'), handle: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }), /secret-shaped/u);
});

test('the seed rule set is admitted and refuses rules it does not have', () => {
  assert.equal(ruleSet.status, 'seed-unverified');
  assert.equal(ruleFor(ruleSet, 'bluesky').text.maxGraphemes, 300);
  assert.throws(() => ruleFor(ruleSet, 'myspace'), /no platform rule/u);
  assert.throws(() => admitPlatformRuleSet({ type: 'PlatformRuleSet', version: 1, status: 'verified', rules: { x: { platform: 'x', text: { maxGraphemes: 1 }, hashtags: { max: 1 }, automation: { mode: 'anything' } } } }), /automation.mode/u);
});

test('accounts: holds state their reason, limits only tighten, credential errors never leak', async () => {
  assert.throws(() => admitAccount({ ...account('a', 'bluesky'), state: 'held' }), /states why/u);
  const rule = ruleFor(ruleSet, 'bluesky');
  assert.equal(effectiveLimits(rule, { limits: { perDay: 100, minGapMinutes: 5 } }).perDay, rule.limits.perAccount.perDay);
  assert.equal(effectiveLimits(rule, { limits: { perDay: 1 } }).perDay, 1);
  const bad = account('b@bluesky', 'bluesky');
  await assert.rejects(authorizedFetchFor(bad, { env: () => { throw new Error('boom Bearer abcdefghijklmnopqrstuvwxyz0123456789'); } }), (error) => !/abcdefghijklmnopqrstuvwxyz/u.test(error.message));
  const fetchCap = await authorizedFetchFor(bad, { env: () => async () => { throw new Error('refresh_token=1//0abcdefghijklmnop'); } });
  await assert.rejects(fetchCap('https://example.test'), (error) => !/1\/\/0abc/u.test(error.message));
  const held = holdAccount(registryOf(bad), bad.id, 'platform answered 403', '2026-10-26T00:00:00Z');
  assert.equal(held.accounts[0].state, 'held');
});

test('provenance: sign, verify, detect tampering and missing disclosure', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const original = Buffer.from('original notebook video bytes');
  const derivative = Buffer.from('branded derivative bytes');
  const manifest = buildManifest({
    subject: { ni: niOfBytes(derivative), mediaType: 'video/mp4', bytes: derivative.length }, content: { itemNi: item(1).id, canonicalUrl: 'https://science.561.group/papers/1' },
    generator: { kind: 'ai-generated', tool: 'gemini-notebook', model: null },
    ingredients: [{ ni: niOfBytes(original), mediaType: 'video/mp4', bytes: original.length, embeddedCredentials: 'present', archive: 'file:originals/ab/abcd' }],
    actions: [{ action: 'c2pa.cropped' }, { action: 'c2pa.placed' }], disclosure: { aiGenerated: true, label: 'AI-generated media' },
    issuer: { id: '561 Group', keyId: 'k1' }, issuedAt: '2026-10-26T00:00:00Z',
  });
  assert.equal(verifyManifest(manifest, { publicKeys: { k1: publicKey } }).problems[0], 'unsigned');
  const signed = signManifest(manifest, { keyId: 'k1', privateKey });
  assert.deepEqual(verifyManifest(signed, { publicKeys: { k1: publicKey }, bytes: derivative, originalBytes: original }), { valid: true, problems: [] });
  assert.equal(signed.invisibleProvenance.embeddedCredentials, 'original-archived-derivative-references-it');
  assert.match(signed.verify.url, /^https:\/\/561\.group\/verify\//u);
  const tampered = structuredClone(signed); tampered.disclosure.label = 'nothing';
  assert.ok(verifyManifest(tampered, { publicKeys: { k1: publicKey } }).problems.includes('signature does not verify'));
  assert.ok(verifyManifest(signed, { publicKeys: { k1: publicKey }, bytes: Buffer.from('other') }).problems.includes('posted file does not match subject address'));
  assert.throws(() => buildManifest({ subject: { ni: niOfBytes(derivative), mediaType: 'video/mp4' }, content: {}, generator: { kind: 'ai-generated' }, disclosure: { aiGenerated: false }, issuer: { id: 'x', keyId: 'k' }, issuedAt: 'x' }), /must be disclosed/u);
  assert.throws(() => buildManifest({ subject: { ni: niOfBytes(derivative), mediaType: 'video/mp4' }, content: {}, generator: { kind: 'human' }, actions: [{ action: 'c2pa.watermark_removed' }], disclosure: {}, issuer: { id: 'x', keyId: 'k' }, issuedAt: 'x' }), /undeclarable action/u);
});

const brand = { id: '561-group', name: '561 Group', lockupText: '561 Group', background: '#101820', foreground: '#ffffff', accent: '#c0392b' };
const videoSource = { ni: niOfBytes(Buffer.from('v')), mediaType: 'video/mp4', width: 1920, height: 1080, aiGenerated: true, visibleMark: { kind: 'notebooklm-wordmark', rect: { x: 0.78, y: 0.91, w: 0.2, h: 0.07 } } };

test('compositor: reframes 16:9 to 9:16, covers only the declared visible mark, is deterministic', () => {
  const plan = planComposition({ source: videoSource, target: { aspect: '9:16', maxWidth: 1080 }, brand, focus: { x: 0.9, y: 0.5 } });
  const crop = plan.steps.find((step) => step.op === 'crop').rect;
  assert.ok(Math.abs(crop.width / crop.height - 9 / 16) < 0.01);
  assert.equal(plan.target.width, crop.width);
  assert.ok(plan.declaredActions.includes('c2pa.cropped'));
  assert.deepEqual(plan, planComposition({ source: videoSource, target: { aspect: '9:16', maxWidth: 1080 }, brand, focus: { x: 0.9, y: 0.5 } }));
  assert.equal(plan.provenance.invisibleWatermarks, 'untouched');
  const square = planComposition({ source: videoSource, target: { aspect: '16:9' }, brand });
  const cover = square.steps.find((step) => step.op === 'cover-visible-mark');
  assert.ok(cover && cover.rect.width > 0, 'a 16:9 -> 16:9 plan keeps the mark in frame and covers it');
  const noMark = planComposition({ source: { ...videoSource, visibleMark: undefined }, target: { aspect: '1:1' }, brand });
  assert.ok(!noMark.steps.some((step) => step.op === 'cover-visible-mark'));
});

test('compositor refuses anything that removes or defeats provenance, or covers more than a logo', () => {
  const plan = planComposition({ source: videoSource, target: { aspect: '16:9' }, brand });
  for (const op of ['strip-metadata', 'remove-c2pa', 'denoise', 'inpaint-watermark', 'defeat-synthid', 'screen-record', 'upscale-diffusion']) {
    assert.throws(() => planComposition({ source: videoSource, target: { aspect: '16:9' }, brand, extraSteps: [{ op }] }), /refused/u, op);
  }
  assert.throws(() => assertPlanAllowed({ ...plan, steps: [{ op: 'cover-visible-mark', rect: { x: 0, y: 0, width: plan.target.width, height: plan.target.height }, fill: '#000' }] }), /larger than 12%/u);
  assert.throws(() => assertPlanAllowed({ ...plan, steps: [{ op: 'cover-visible-mark', rect: { x: 0, y: 0, width: 10, height: 10 }, fill: '#000' }] }, { ...videoSource, visibleMark: undefined }), /nothing declared/u);
  assert.throws(() => assertPlanAllowed({ ...plan, provenance: { ...plan.provenance, invisibleWatermarks: 'altered' } }), /untouched/u);
});

test('compositor renderers keep metadata and emit our branding', () => {
  const plan = planComposition({ source: videoSource, target: { aspect: '9:16', maxWidth: 1080 }, brand, captions: [{ from: 0, to: 3, text: 'Hello' }] });
  const args = ffmpegArgs(plan, { input: 'in.mp4', output: 'out.mp4', lockupPng: 'lockup.png' });
  assert.ok(args.join(' ').includes('-map_metadata 0'));
  assert.ok(!args.includes('-an') && !args.join(' ').includes('map_metadata -1'));
  assert.ok(args.join(' ').includes('crop='));
  const still = planComposition({ source: { ...videoSource, mediaType: 'image/png' }, target: { aspect: '1:1', maxWidth: 1080 }, brand });
  const svg = renderSvg(still, { imageHref: 'source.png' });
  assert.match(svg, /<text[^>]*>561 Group<\/text>/u);
  assert.match(svg, /<rect/u);
});

test('renditions: right limit, link back, hashtags capped, AI disclosure, brand and section filtering', () => {
  const registry = registryOf(account('g@bluesky', 'bluesky'), account('g@mastodon', 'mastodon'), account('other@bluesky', 'bluesky', { brand: 'red-cup-engineering' }), account('eng@bluesky', 'bluesky', { sections: ['engineering'] }));
  const subject = item(1, { linkedWorkAiGenerated: true });
  const renditions = renditionsFor(subject, { accounts: registry.accounts, ruleSet });
  assert.deepEqual(renditions.map((r) => r.accountId).sort(), ['g@bluesky', 'g@mastodon']);
  for (const rendition of renditions) {
    assert.ok(graphemeCount(rendition.text) <= ruleFor(ruleSet, rendition.platform).text.maxGraphemes, rendition.platform);
    assert.ok(rendition.text.includes(subject.canonicalUrl));
    assert.ok(rendition.text.includes('AI-generated media'));
    assert.ok((rendition.text.match(/#\w+/gu) ?? []).length <= ruleFor(ruleSet, rendition.platform).hashtags.max);
    assert.equal(rendition.copyOrigin, 'template');
  }
  assert.equal(renditions[0].id, renditionsFor(subject, { accounts: registry.accounts, ruleSet })[0].id, 'rendition ids are deterministic');
});

test('gate: alt text, disclosure, manifests, editorial lint, holds, duplicates, owner approval', () => {
  const acct = admitAccount(account('g@bluesky', 'bluesky'));
  const withImage = item(2, { media: [{ role: 'infographic', ni: niOfBytes(Buffer.from('img')), mediaType: 'image/png', width: 1080, height: 1080, aiGenerated: true }] });
  const [rendition] = renditionsFor(withImage, { accounts: [acct], ruleSet });
  const base = { account: acct, ruleSet, nowMs: Date.parse('2026-10-26T15:00:00Z') };
  const verdict = gateRendition(rendition, base);
  assert.ok(verdict.refusals.some((reason) => /no alt text/u.test(reason)));
  assert.ok(verdict.holds.some((reason) => /awaiting provenance manifest/u.test(reason)));
  assert.ok(defaultVoiceCheck({ text: 'This revolutionary trick is guaranteed!! LIKE AND SUBSCRIBE' }).notes.length >= 3);
  const plain = renditionsFor(item(3), { accounts: [acct], ruleSet })[0];
  assert.equal(gateRendition(plain, base).pass, true);
  assert.ok(gateRendition({ ...plain, text: 'no link here' }, base).refusals.includes('missing link back to the canonical page'));
  assert.ok(gateRendition(plain, { ...base, history: [{ accountId: acct.id, textHash: createHashHex(plain.text), at: '2026-10-20T00:00:00Z', status: 'posted' }] }).refusals.some((r) => /duplicate window/u.test(r)));
  const held = admitAccount(account('h@bluesky', 'bluesky', { state: 'held', hold: { reason: 'rate limited', since: 'x' } }));
  assert.ok(gateRendition({ ...plain, accountId: held.id }, { ...base, account: held }).holds[0].includes('held'));
  const unapproved = admitAccount(account('u@bluesky', 'bluesky', { approval: { firstPostApprovedAt: null, approvedBy: null } }));
  assert.ok(gateRendition({ ...plain, accountId: unapproved.id }, { ...base, account: unapproved, live: true }).holds.some((r) => /owner/u.test(r)));
  assert.equal(gateRendition({ ...plain, accountId: unapproved.id }, { ...base, account: unapproved, live: false }).pass, true);
  const notBot = admitAccount(account('n@bluesky', 'bluesky', { automation: { botDisclosed: false } }));
  assert.ok(gateRendition({ ...plain, accountId: notBot.id }, { ...base, account: notBot }).refusals.some((r) => /disclose that it is automated/u.test(r)));
});
import { createHash } from 'node:crypto';
const createHashHex = (text) => createHash('sha256').update(text).digest('hex');

test('schedule: windows, per-day and gap limits, deterministic stagger, manual and held accounts isolated', () => {
  const registry = registryOf(
    account('a@bluesky', 'bluesky'), account('b@bluesky', 'bluesky'), account('held@mastodon', 'mastodon', { state: 'held', hold: { reason: 'rate limited', since: 'x' } }),
    account('m@mastodon', 'mastodon'), account('r@reddit', 'reddit', { automation: { botDisclosed: false } }),
  );
  const items = Array.from({ length: 12 }, (_, n) => item(n + 10, { priority: (12 - n) / 12 }));
  const renditions = items.flatMap((entry) => renditionsFor(entry, { accounts: registry.accounts, ruleSet }));
  const startMs = Date.parse('2026-10-26T00:00:00Z');
  const plan = planSchedule({ renditions, registry, ruleSet, startMs, days: 14 });
  const again = planSchedule({ renditions, registry, ruleSet, startMs, days: 14 });
  assert.deepEqual(plan, again);
  const mine = (id) => plan.entries.filter((entry) => entry.accountId === id && entry.at);
  const rule = ruleFor(ruleSet, 'bluesky');
  const times = mine('a@bluesky').map((entry) => Date.parse(entry.at));
  assert.ok(times.length > 0);
  for (let i = 1; i < times.length; i += 1) assert.ok(times[i] - times[i - 1] >= rule.limits.perAccount.minGapMinutes * 60_000);
  const perDay = new Map();
  for (const entry of mine('a@bluesky')) perDay.set(entry.at.slice(0, 10), (perDay.get(entry.at.slice(0, 10)) ?? 0) + 1);
  assert.ok([...perDay.values()].every((n) => n <= rule.limits.perAccount.perDay));
  for (const entry of mine('a@bluesky')) { const weekday = new Date(entry.at).getUTCDay(); assert.ok([1, 2, 3, 4, 5, 6].includes(weekday)); }
  assert.notEqual(mine('a@bluesky')[0].at, mine('b@bluesky')[0].at, 'accounts on one platform do not fire together');
  assert.ok(plan.entries.filter((entry) => entry.accountId === 'held@mastodon' && entry.at).every((entry) => entry.status === 'held'));
  assert.ok(plan.entries.filter((entry) => entry.accountId === 'r@reddit' && entry.at).every((entry) => entry.status === 'manual'));
  assert.ok(plan.entries.filter((entry) => entry.accountId === 'm@mastodon' && entry.at).every((entry) => entry.status === 'scheduled'));
  const withoutHeld = planSchedule({ renditions: renditions.filter((r) => r.accountId !== 'held@mastodon'), registry: registryOf(...registry.accounts.filter((a) => a.id !== 'held@mastodon')), ruleSet, startMs, days: 14 });
  assert.deepEqual(withoutHeld.entries.filter((entry) => entry.accountId === 'a@bluesky'), plan.entries.filter((entry) => entry.accountId === 'a@bluesky'), "one account's hold never changes another's plan");
  const manual = manualPacket(renditions.find((r) => r.accountId === 'r@reddit'), registry.accounts[4], ruleFor(ruleSet, 'reddit'), '2026-10-27T15:00:00Z');
  assert.ok(manual.checklist.length >= 3);
});

test('schedule continues from the journal rather than restarting', () => {
  const registry = registryOf(account('a@bluesky', 'bluesky'));
  const renditions = [item(40), item(41)].flatMap((entry) => renditionsFor(entry, { accounts: registry.accounts, ruleSet }));
  const startMs = Date.parse('2026-10-26T00:00:00Z');
  const fresh = planSchedule({ renditions, registry, ruleSet, startMs, days: 3 });
  const first = Date.parse(fresh.entries[0].at);
  const continued = planSchedule({ renditions, registry, ruleSet, startMs, days: 3, journal: [{ accountId: 'a@bluesky', status: 'posted', at: new Date(first).toISOString() }] });
  assert.ok(Date.parse(continued.entries[0].at) >= first + ruleFor(ruleSet, 'bluesky').limits.perAccount.minGapMinutes * 60_000);
  const rule = ruleFor(ruleSet, 'bluesky');
  assert.equal(limitCheck(registry.accounts[0], rule, [{ accountId: 'a@bluesky', status: 'posted', at: '2026-10-26T14:30:00Z' }], Date.parse('2026-10-26T15:00:00Z')).ok, false);
});

const sourceReleaseFixture = niOfBytes(Buffer.from('source-authorized-release-fixture'));
const qualifiedSourceFixture = ({ canonicalUrl, itemNi, sourceNi, nowMs }) => ({
  type: 'SocialSourceReadback', version: 1, canonicalUrl, itemNi, sourceNi,
  publicationStatus: 'stable', publiclyReadable: true,
  releaseRef: sourceReleaseFixture, observedAt: new Date(nowMs).toISOString(),
  claims: [],
});
async function cycle({ accounts, adapters, live = false, journal = [], resolvers,
  readCurrentSource = qualifiedSourceFixture, contentItem = item(60) }) {
  const registry = registryOf(...accounts);
  const renditions = [contentItem].flatMap((entry) => renditionsFor(entry, { accounts: registry.accounts, ruleSet }));
  const plan = planSchedule({ renditions, registry, ruleSet, startMs: Date.parse('2026-10-26T00:00:00Z'), days: 2 });
  // Tuesday 10:30 in Chicago: inside every seed window used below, after every first slot.
  return runDue({ entries: plan.entries, renditions: new Map(renditions.map((r) => [r.id, r])), registry, ruleSet, adapters, resolvers, journal, nowMs: Date.parse('2026-10-27T15:30:00Z'), live, readCurrentSource });
}
const okFetch = () => async () => ({});
const adapterThat = (platform, behaviour) => ({ platform, live: true, validate: () => ({ ok: true, problems: [] }), publish: behaviour });

test('publish: dry run by default and never calls the adapter', async () => {
  let called = 0;
  const adapters = { bluesky: adapterThat('bluesky', async () => { called += 1; return { externalId: 'x', url: null }; }) };
  const outcome = await cycle({ accounts: [account('a@bluesky', 'bluesky')], adapters, live: false, resolvers: { env: okFetch } });
  assert.equal(called, 0);
  assert.ok(outcome.results.every((line) => line.status === 'dry-run'));
});

test('publish: live needs the owner approval, and a failing account never blocks the others', async () => {
  const accounts = [
    account('ok@bluesky', 'bluesky'), account('limited@mastodon', 'mastodon'), account('forbidden@x', 'x'), account('fresh@linkedin', 'linkedin', { approval: { firstPostApprovedAt: null, approvedBy: null } }), account('nocred@facebook-page', 'facebook-page'),
  ];
  const err = (status, message) => Object.assign(new Error(message), { status, retryAfterSeconds: 600 });
  const adapters = {
    bluesky: adapterThat('bluesky', async () => ({ externalId: 'at://did/app.bsky.feed.post/1', url: 'https://bsky.app/x' })),
    mastodon: adapterThat('mastodon', async () => { throw err(429, 'slow down'); }),
    x: adapterThat('x', async () => { throw err(403, 'forbidden Bearer abcdefghijklmnopqrstuvwxyz0123456789'); }),
    linkedin: adapterThat('linkedin', async () => ({ externalId: 'urn:li:share:1' })),
    'facebook-page': adapterThat('facebook-page', async () => ({ externalId: 'fb1' })),
  };
  const resolvers = { env: (name) => { if (name.includes('FACEBOOK')) throw new Error('no such credential Bearer abcdefghijklmnopqrstuvwxyz0123456789'); return okFetch(); } };
  const outcome = await cycle({ accounts, adapters, live: true, resolvers });
  const status = (id) => outcome.results.filter((line) => line.accountId === id).map((line) => line.status);
  assert.deepEqual(status('ok@bluesky'), ['posted']);
  assert.deepEqual(status('limited@mastodon'), ['rate-limited']);
  assert.deepEqual(status('forbidden@x'), ['held']);
  assert.deepEqual(status('fresh@linkedin'), ['held'], 'no owner approval, no live post');
  assert.deepEqual(status('nocred@facebook-page'), ['held']);
  assert.equal(outcome.registry.accounts.find((a) => a.id === 'forbidden@x').state, 'held');
  assert.equal(outcome.registry.accounts.find((a) => a.id === 'limited@mastodon').state, 'active', 'a rate limit backs off, it does not hold');
  assert.equal(outcome.registry.accounts.find((a) => a.id === 'ok@bluesky').state, 'active');
  assert.ok(!JSON.stringify(outcome).includes('abcdefghijklmnopqrstuvwxyz'), 'secrets never reach results or journal');
});

test('publish: server errors retry then hold, other 4xx are refused and never retried', async () => {
  const flaky = adapterThat('bluesky', async () => { throw Object.assign(new Error('upstream'), { status: 503 }); });
  const first = await cycle({ accounts: [account('a@bluesky', 'bluesky')], adapters: { bluesky: flaky }, live: true, resolvers: { env: okFetch } });
  assert.equal(first.results[0].status, 'retry');
  const prior = [1, 2].map(() => ({ accountId: 'a@bluesky', renditionId: first.results[0].renditionId, status: 'retry', at: '2026-10-20T00:00:00Z' }));
  const third = await cycle({ accounts: [account('a@bluesky', 'bluesky')], adapters: { bluesky: flaky }, live: true, journal: prior, resolvers: { env: okFetch } });
  assert.equal(third.results[0].status, 'held');
  const bad = adapterThat('bluesky', async () => { throw Object.assign(new Error('invalid record'), { status: 400 }); });
  const rejected = await cycle({ accounts: [account('a@bluesky', 'bluesky')], adapters: { bluesky: bad }, live: true, resolvers: { env: okFetch } });
  assert.equal(rejected.results[0].status, 'refused');
  assert.equal(rejected.registry.accounts[0].state, 'active');
});

test('publish: manual-only platforms are never driven', async () => {
  const outcome = await cycle({ accounts: [account('r@reddit', 'reddit', { automation: { botDisclosed: false } })], adapters: { reddit: dryRunAdapter('reddit') }, live: true, resolvers: { env: okFetch } });
  assert.equal(outcome.results.length, 0, 'manual entries are not due');
});

test('measurement: outside responses outweigh reach; thin cells stay neutral; YouTube inventories become readings', () => {
  const readings = [];
  for (let i = 0; i < 6; i += 1) readings.push({ accountId: 'a', platform: 'bluesky', section: 'science', kind: 'paper', externalId: `s${i}`, at: '2026-10-30T00:00:00Z', views: 100, clicks: 10, replies: 2 });
  for (let i = 0; i < 6; i += 1) readings.push({ accountId: 'b', platform: 'mastodon', section: 'engineering', kind: 'note', externalId: `e${i}`, at: '2026-10-30T00:00:00Z', views: 1000, clicks: 0 });
  readings.push({ accountId: 'c', platform: 'x', section: 'operations', kind: 'product', externalId: 'o1', at: '2026-10-30T00:00:00Z', views: 100, clicks: 1 });
  const feedback = summarize(readings);
  assert.ok(feedback.cells.section.science.multiplier > feedback.cells.section.engineering.multiplier);
  assert.equal(feedback.cells.section.operations.multiplier, 1, 'one post teaches nothing');
  assert.ok(feedback.cells.section.science.multiplier <= 2 && feedback.cells.section.engineering.multiplier >= 0.5);
  assert.ok(allocationMultiplier(feedback, { section: 'science', kind: 'paper', platforms: ['bluesky'] }) > 1);
  const later = summarize([...readings, { ...readings[0], at: '2026-11-02T00:00:00Z', views: 999, clicks: 99 }]);
  assert.equal(later.posts, feedback.posts, 'a later cumulative reading replaces the earlier one');
  const inventory = { observedAt: '2026-10-09T00:00:00Z', uploads: [{ id: 'v1', status: { privacyStatus: 'public' }, statistics: { viewCount: '12' }, snippet: { publishedAt: '2026-10-01T00:00:00Z', title: 't' } }, { id: 'v2', status: { privacyStatus: 'private' }, statistics: { viewCount: '99' }, snippet: {} }] };
  const fromYoutube = readingsFromYouTubeInventory(inventory, { accountId: 'yt' });
  assert.equal(fromYoutube.length, 1);
  assert.equal(channelFacts(fromYoutube, { nowMs: Date.parse('2026-10-10T00:00:00Z') }).postsInWindow, 1);
});
