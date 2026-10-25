import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
  admitAccount, admitContentItem, admitPlatformRuleSet, buildPostManifest, checkEvidence, compilePhrases, createVoiceCheck, detectEmbeddedCredentials, driftCheck,
  editorialReport, footerFor, gateRendition, isCheckableSentence, mergeRuleSets, niOfBytes, niOfJson, payloadNi, probeHandle, readabilityOf, renditionsFor,
  signPostManifest, splitProvenanceFooter, splitSentences, verifyPostManifest, c2paPlanFor, shortIdOf,
} from '../src/syndication/index.mjs';

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const phrases = compilePhrases(read('../content/editorial/phrases.json'));
const seed = read('../content/platform-rules.seed.json');
const verified = read('../content/platform-rules.verified.json');
const ruleSet = admitPlatformRuleSet(mergeRuleSets(seed, verified));
const CANON = 'https://engineering.561.group/notes/example';
const SRC = 'https://github.com/red-cup-engineering/example/pull/1';

const item = (extra = {}) => ({
  id: niOfJson({ n: 1 }), brand: 'red-cup-engineering', section: 'engineering', kind: 'note', title: 'A title', summary: 'A summary.', canonicalUrl: CANON, source: { ni: niOfBytes(Buffer.from('page')) },
  sources: [{ url: SRC, title: 'PR 1' }],
  claims: [{ id: 'c1', text: 'The test suite passes 21 tests.', status: 'Measured', sourceUrl: SRC }],
  ai: { textGenerated: true }, ...extra,
});
const withFooter = (body) => `${body}\n\n${footerFor(body)}`;
const rend = (text, extra = {}) => ({ id: 'r1', itemNi: item().id, accountId: 'red-cup-engineering@bluesky', platform: 'bluesky', brand: 'red-cup-engineering', link: CANON, media: [], disclosure: { applied: false }, text, ...extra });
const good = () => withFooter(`The analyzer test suite passes 21 tests. Drafted by an AI agent. ${CANON}`);
const report = (text, it = item(), extra = {}) => editorialReport(rend(text), { item: it, phrases, ruleSet, linkStatus: { [CANON]: { status: 200 }, [SRC]: { status: 200 } }, ...extra });
const ids = (r) => r.checks.filter((c) => c.level === 'refuse').map((c) => c.id);

test('a plain, sourced, disclosed, linked post passes', () => {
  const r = report(good());
  assert.deepEqual(r.checks.filter((c) => c.level === 'refuse'), []);
  assert.equal(r.pass, true);
});

test('hype, AI-tell and PTGAE phrases are refused; quotations are not house prose', () => {
  const bad = ['We are thrilled to announce a game-changing, seamless platform.', 'It is important to note that this plays a crucial role.', 'It is not just a tool, it is a way to delve into data.'];
  for (const sentence of bad) assert.ok(ids(report(withFooter(`${sentence} Drafted by an AI agent. ${CANON}`))).includes('banned-phrase'), sentence);
  const quoted = withFooter(`The reviewer wrote "a groundbreaking result" in the thread. Drafted by an AI agent. ${CANON}`);
  assert.ok(!ids(report(quoted)).includes('banned-phrase'));
});

test('style limits: emoji, exclamations, shouting, dashes and hashtags', () => {
  const r = report(withFooter(`Now live! \u{1F680} NOTHING ELSE LIKE IT — really — truly #one #two #three. Drafted by an AI agent. ${CANON}`));
  assert.ok(ids(r).includes('style'));
  assert.ok(r.checks.filter((c) => c.id === 'style').length >= 4);
});

test('readability counts sentences and refuses a very long one', () => {
  assert.equal(splitSentences('It works. See e.g. the docs. Version 1.2 ships Monday.').length, 3);
  const long = `${Array.from({ length: 50 }, () => 'word').join(' ')}.`;
  assert.ok(readabilityOf(long).longestSentenceWords === 50);
  assert.ok(ids(report(withFooter(`${long} Drafted by an AI agent. ${CANON}`))).includes('readability'));
});

test('every checkable sentence needs a sourced claim, and claim status must show', () => {
  assert.equal(isCheckableSentence('The suite passes 21 tests.'), true);
  assert.equal(isCheckableSentence('We write about engineering.'), false);
  assert.equal(isCheckableSentence('561 Group builds software.'), false);
  const unsourced = report(withFooter(`The tool cut build time by 40 percent. Drafted by an AI agent. ${CANON}`));
  assert.ok(ids(unsourced).includes('claim-source'));
  const hypo = item({ claims: [{ id: 'c1', text: 'The method reduces build time by 40 percent.', status: 'Hypothesis', sourceUrl: SRC }] });
  assert.ok(ids(report(withFooter(`The method reduces build time by 40 percent. Drafted by an AI agent. ${CANON}`), hypo)).includes('claim-status'));
  assert.ok(!ids(report(withFooter(`Hypothesis: the method reduces build time by 40 percent. Drafted by an AI agent. ${CANON}`), hypo)).includes('claim-status'));
  const unlisted = item({ claims: [{ id: 'c1', text: 'The test suite passes 21 tests.', status: 'Measured', sourceUrl: 'https://example.org/other' }] });
  assert.ok(ids(report(good(), unlisted)).includes('claim-source'));
  const badStatus = item({ claims: [{ id: 'c1', text: 'The test suite passes 21 tests.', status: 'Certain', sourceUrl: SRC }] });
  assert.ok(ids(report(good(), badStatus)).includes('claim-status'));
});

test('links: https only, no shorteners or tracking, unchecked links refuse when required, dead links refuse', () => {
  assert.ok(ids(report(withFooter(`See http://engineering.561.group/a and https://bit.ly/x and ${CANON}?utm_source=x. Drafted by an AI agent.`))).includes('links'));
  const required = report(good(), item(), { linkStatus: {}, requireLinkStatus: true });
  assert.ok(ids(required).includes('links'));
  const dead = report(good(), item(), { linkStatus: { [CANON]: { status: 404 }, [SRC]: { status: 200 } } });
  assert.ok(ids(dead).includes('links'));
  const design = report(good(), item(), { linkStatus: { [CANON]: { status: 200 }, [SRC]: { status: 200 } }, requireLinkStatus: true, provenanceMode: 'design' });
  assert.ok(!ids(design).includes('links'));
});

test('alt text, AI disclosure and provenance link are required', () => {
  const media = { ni: niOfBytes(Buffer.from('img')), as: 'image', alt: 'image of x.png' };
  const r = editorialReport(rend(good(), { media: [media] }), { item: item(), phrases, ruleSet, linkStatus: { [CANON]: { status: 200 }, [SRC]: { status: 200 } } });
  assert.ok(ids(r).includes('alt-text'));
  assert.ok(ids(report(`The analyzer test suite passes 21 tests. ${CANON}`)).includes('disclosure-provenance'));
  assert.ok(ids(report(withFooter(`The analyzer test suite passes 21 tests. ${CANON}`))).includes('disclosure-ai'));
});

test('length uses the platform rule and the brand cap', () => {
  const longText = withFooter(`${'Plain words here. '.repeat(25)}${CANON}`);
  assert.ok(ids(report(longText)).includes('length'));
  const r = editorialReport(rend(good()), { profile: { platformMax: { bluesky: 40 } }, item: item(), phrases, ruleSet, linkStatus: {} });
  assert.ok(ids(r).includes('length'));
});

test('the voice hook plugs into the engine gate', () => {
  const rule = ruleSet.rules.bluesky;
  const contentItem = admitContentItem(item());
  const account = admitAccount({ id: 'rc@bluesky', brand: 'red-cup-engineering', platform: 'bluesky', handle: 'x.bsky.social', kind: 'organization', automation: { botDisclosed: true }, credentialRef: { scheme: 'none', name: 'none' }, timezone: 'America/Chicago', state: 'active', sections: ['*'], approval: { firstPostApprovedAt: '2026-10-25T00:00:00Z', approvedBy: 'owner' } });
  const copy = () => withFooter(`The analyzer test suite passes 21 tests. Drafted by an AI agent. ${CANON}`);
  const [rendition] = renditionsFor(contentItem, { accounts: [account], ruleSet, copy });
  const voiceCheck = createVoiceCheck({ profiles: {}, items: { [contentItem.id]: contentItem }, phrases, ruleSet, linkStatus: { [CANON]: { status: 200 }, [SRC]: { status: 200 } } });
  const verdict = gateRendition(rendition, { account, ruleSet, voiceCheck, nowMs: Date.parse('2026-10-26T15:00:00Z') });
  assert.deepEqual(verdict.refusals, []);
  const hype = renditionsFor(contentItem, { accounts: [account], ruleSet, copy: () => withFooter(`A revolutionary leap. ${CANON}`) })[0];
  assert.ok(gateRendition(hype, { account, ruleSet, voiceCheck, nowMs: 0 }).refusals.some((m) => m.startsWith('editorial check')));
  assert.equal(rule.text.maxGraphemes, 300);
});

test('prohibited platforms get no gate pass from the CLI table: hackernews is prohibited', () => {
  assert.equal(ruleSet.rules.hackernews.automation.mode, 'prohibited');
  assert.equal(ruleSet.rules.linkedin.automation.mode, 'manual-only');
});

const authoring = { office: 'chief-marketing-officer', duty: 'syndicate-the-groups-work-on-public-channels', skill: 'gate-a-public-post', character: 'bare-cedar-fog-claude', ai: { textGenerated: true, role: 'drafted', tools: [{ name: 'Claude Code', vendor: 'Anthropic', model: 'claude-sonnet-5-5', version: null, role: 'drafting' }] }, humanReview: { state: 'none' } };
const repo = { repository: 'https://github.com/red-cup-engineering/example', visibility: 'public', commit: 'a'.repeat(40), path: 'README.md', publicArtifacts: [SRC] };
const kp = generateKeyPairSync('ed25519');
const pub = kp.publicKey.export({ type: 'spki', format: 'pem' });

test('footer round trip: payload excludes the provenance line and the id derives from its digest', () => {
  const body = `Plain words. ${CANON}`;
  const text = withFooter(body);
  const { payload, shortId } = splitProvenanceFooter(text);
  assert.equal(payload, body);
  assert.equal(shortId, shortIdOf(payloadNi(body)));
  assert.equal(splitProvenanceFooter(body).shortId, null);
});

test('post manifest: builds, signs, verifies, detects tampering, requires disclosure for private sources', () => {
  const text = good();
  const r = rend(text);
  const rep = report(text);
  const build = (over = {}) => buildPostManifest({ rendition: r, item: item(), source: repo, authoring, report: rep, issuer: { id: '561-group', keyId: 'test-key-1' }, issuedAt: '2026-10-25T00:00:00Z', ...over });
  const manifest = signPostManifest(build(), { keyId: 'test-key-1', privateKey: kp.privateKey });
  assert.deepEqual(verifyPostManifest(manifest, { publicKeys: { 'test-key-1': pub }, postedText: text }), { valid: true, problems: [] });
  assert.equal(manifest.generator.kind, 'ai-generated');
  assert.equal(manifest.post.authorship.ai.tools[0].model, 'claude-sonnet-5-5');
  const tampered = verifyPostManifest(manifest, { publicKeys: { 'test-key-1': pub }, postedText: text.replace('21', '22') });
  assert.equal(tampered.valid, false);
  const edited = structuredClone(manifest); edited.post.source.commit = 'b'.repeat(40);
  assert.equal(verifyPostManifest(edited, { publicKeys: { 'test-key-1': pub } }).valid, false);
  assert.throws(() => build({ source: { ...repo, visibility: 'private' } }), /disclosure decision/u);
  assert.doesNotThrow(() => build({ source: { ...repo, visibility: 'private' }, disclosureDecision: { rule: 'disclosure-defaults-to-privacy', disclosed: ['commit'], withheld: ['repository contents'], decidedBy: 'owner', at: '2026-10-25' } }));
  assert.throws(() => build({ authoring: { ...authoring, ai: { textGenerated: true, tools: [] } } }), /names each tool and model/u);
  assert.throws(() => build({ report: report(good().replace('21', '22')) }), /must pass/u);
  assert.equal(verifyPostManifest(build(), { publicKeys: {} }).valid, false);
});

test('media: embedded credentials are detected without touching bytes; C2PA plan chains onto the upstream and says it is unsigned', () => {
  const withManifest = Buffer.concat([Buffer.from('....jumb....c2pa....'), Buffer.alloc(10)]);
  assert.equal(detectEmbeddedCredentials(withManifest), 'present');
  assert.equal(detectEmbeddedCredentials(Buffer.from('plain')), 'absent');
  const plan = c2paPlanFor({ ni: niOfBytes(Buffer.from('d')), aiGenerated: true, originalNi: niOfBytes(Buffer.from('o')), upstream: { c2pa: 'present', synthid: 'declared' } }, { brand: 'Causeway Services', brandUrl: 'https://koios.news', recordUrl: 'https://561.group/v/abcdefghijkl', manifestNi: null, edits: [{ action: 'c2pa.cropped' }] });
  assert.equal(plan.status, 'unsigned-design');
  assert.equal(plan.verifiedAgainstTool, false);
  assert.match(plan.commands.join('\n'), /--parent/u);
  assert.match(plan.upstream.archive, /never re-encode/u);
});

test('handle probes classify responses and never guess for unprobeable platforms', async () => {
  const fake = (status, body = '') => async () => new Response(body, { status });
  assert.equal((await probeHandle('bluesky', 'x', { fetchImpl: fake(400) })).result, 'free-looking');
  assert.equal((await probeHandle('bluesky', 'x', { fetchImpl: fake(200, '{}') })).result, 'taken');
  assert.equal((await probeHandle('hackernews', 'x', { fetchImpl: fake(200, 'null') })).result, 'free-looking');
  assert.equal((await probeHandle('github', 'x', { fetchImpl: fake(429) })).result, 'unknown');
  assert.equal((await probeHandle('x', 'x', { fetchImpl: () => { throw new Error('must not be called'); } })).result, 'not-probed');
  assert.equal((await probeHandle('tiktok', 'x', { fetchImpl: () => { throw new Error('must not be called'); } })).result, 'not-probed');
  assert.equal((await probeHandle('devto', 'x', { fetchImpl: fake(404) })).result, 'free-looking');
  assert.equal((await probeHandle('github', 'x', { fetchImpl: () => { throw new Error('offline'); } })).result, 'unknown');
});

test('rule evidence: merge keeps seed platforms, checks records, flags staleness and disagreement', async () => {
  assert.equal(ruleSet.status, 'partially-verified');
  assert.equal(ruleSet.rules['facebook-page'].checkedOn, null);
  const record = { id: 'platform-terms-bluesky', 'observed-on': '2026-10-24', rules: { 'content-limits': { status: 'verified', data: { 'post-chars': 300 } }, 'automation-api': { value: 'allowed' } }, 'hard-rule-conflicts': [] };
  const only = { ...verified, rules: { bluesky: verified.rules.bluesky } };
  const ok = checkEvidence(only, { 'platform-terms-bluesky': record }, { nowMs: Date.parse('2026-10-25') });
  assert.deepEqual([ok.problems, ok.stale], [[], []]);
  const old = checkEvidence(only, { 'platform-terms-bluesky': record }, { nowMs: Date.parse('2027-03-01') });
  assert.equal(old.stale.length, 1);
  const wrong = checkEvidence(only, { 'platform-terms-bluesky': { ...record, rules: { ...record.rules, 'content-limits': { status: 'verified', data: { 'post-chars': 250 } } } } }, { nowMs: Date.parse('2026-10-25') });
  assert.ok(wrong.problems.length > 0);
  const missing = checkEvidence(only, {}, { nowMs: 0 });
  assert.match(missing.problems[0], /not found/u);
  const prohibits = checkEvidence({ rules: { bluesky: verified.rules.bluesky } }, { 'platform-terms-bluesky': { ...record, rules: { ...record.rules, 'automation-api': { value: 'no' } } } }, { nowMs: Date.parse('2026-10-25') });
  assert.ok(prohibits.problems.some((p) => /automation/u.test(p)));
  const drift = await driftCheck({ sources: [{ id: 's1', url: 'https://example.org/t', fetch: { kind: 'raw-bytes', sha256: 'x'.repeat(64) } }, { id: 's2', url: 'https://example.org/u', fetch: { kind: 'unreachable' } }] }, { fetchImpl: async () => new Response('terms') });
  assert.deepEqual(drift.map((d) => d.state), ['changed', 'not-hashable']);
});

test('CLI: keygen refuses to make production keys; handle refuses unknown platforms', () => {
  const cli = new URL('../apps/brand-presence.mjs', import.meta.url).pathname;
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
  const refused = run('keygen', '--out', '/tmp/should-not-exist');
  assert.equal(refused.status, 3);
  assert.match(refused.stderr, /owner decision/u);
  assert.equal(run('handle', '--platform', 'myspace', '--name', 'x').status, 2);
});

test('regressions found by the exemplar writers: numbers end sentences, lone acronyms are not shouting, business metrics are refused', () => {
  assert.equal(splitSentences('The suite ran in 2026. The count is 415. Nothing else changed.').length, 3);
  const acronym = report(withFooter(`The file is named CITATION.cff and the header is PAYMENT-REQUIRED. Drafted by an AI agent. ${CANON}`));
  assert.ok(!ids(acronym).includes('style'));
  assert.ok(isCheckableSentence('Compute is priced by the second.') === false);
  for (const claim of ['The Group has paying customers and growing revenue.', 'Koios.News has 4,000 subscribers.', 'We serve many clients.']) assert.ok(ids(report(withFooter(`${claim} Drafted by an AI agent. ${CANON}`))).includes('banned-phrase'), claim);
  assert.ok(!ids(report(withFooter(`The Group has no customers and no revenue. Drafted by an AI agent. ${CANON}`))).includes('banned-phrase'));
});
