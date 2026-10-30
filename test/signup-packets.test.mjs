import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { composeSignupPackets, renderSignupPackets } from '../src/syndication/signup-packets.mjs';

const sources = () => ({
  brands: { example: {
    identifier: 'example', '@id': 'source:example', name: 'Example Organization',
    'x-profile': {
      'bio-long': 'A source-qualified example research group.',
      'bio-short': 'Example research group.',
      'display-name': 'Example Organization', link: 'https://example.org',
      avatar: 'https://example.org/avatar', banner: 'https://example.org/banner',
    },
    'x-ownership-disclosure': { line: 'Operated by the synthetic account holder.' },
    'x-ai-disclosure': { 'account-line': 'Copy drafted with AI assistance.' },
  } },
  terms: { bluesky: {
    id: 'terms-example-bluesky', 'observed-on': '2026-10-10',
    'worth-it': 'review', 'brand-fit': { example: { fit: 'review', reason: 'synthetic' } },
    rules: {
      'content-limits': { data: { 'bio-chars': 120, 'display-name-chars': 80 } },
      'profile-spec': { data: { 'handle-max': 32 } },
      'bot-label': { status: 'partial', value: 'unconfirmed' },
      'automation-api': { status: 'unverified', value: 'manual-only' },
    },
    sources: [{ id: 'terms-page', title: 'Synthetic terms', url: 'https://example.org/terms', kind: 'html' }],
    'owner-signup-steps': ['An account holder reviews actual current registration steps.'],
  } },
  plan: { type: 'BrandPlatformPlan', 'skipped-everywhere': {},
    platforms: { example: { bluesky: {
      wave: 1, kind: 'organization', why: 'Synthetic source-selected channel.',
      handleCandidates: ['example'], ownerDecision: 'An original owner must decide.',
    } } },
  },
  handleChecks: { type: 'HandleChecks', results: [
    { brand: 'example', platform: 'bluesky', handle: 'example', result: 'free-looking', checkedOn: '2026-10-10' },
  ] },
  policy: { before: ['Review current terms and confirm the account holder.'],
    after: ['Secure the account.', 'Record custody with original owner.', 'Do not post until expressly approved.'],
    readiness: ['Read the profile back from outside.'], mustNot: ['Do not automate registration.'],
    credentialRefs: { example: { bluesky: { scheme: 'none', name: 'synthetic-uninstalled' } } },
    handleChecksLocator: 'synthetic-handle-checks.json',
  },
});

test('original source shape composes a proposed, account-holder-only signup packet', () => {
  const [doc] = composeSignupPackets(sources());
  assert.equal(doc.type, 'BrandSignupPackets');
  assert.equal(doc.status, 'proposed');
  assert.equal(doc.completed, false);
  assert.equal(doc.packets[0].account.recommendedHandle, 'example');
  assert.equal(doc.packets[0].account.bio.fits, true);
  assert.equal(doc.packets[0].termsRecord, 'terms-example-bluesky');
  assert.equal(doc.packets[0].steps.before.length, 1);
  assert.deepEqual(doc.packets[0].mustNot, ['Do not automate registration.']);
  assert.match(renderSignupPackets(doc), /not a reservation/u);
  assert.match(renderSignupPackets(doc), /No account action has been performed/u);
});

test('a missing terms record or too-small display/bio limit cannot claim readiness', () => {
  const missing = sources();
  missing.terms = {};
  const [doc] = composeSignupPackets(missing);
  assert.equal(doc.completed, false);
  assert.equal(doc.packets[0].account, undefined);
  assert.match(doc.packets[0].problems[0], /no platform-terms record/u);
  const bad = sources();
  bad.terms.bluesky.rules['content-limits'].data['bio-chars'] = 8;
  bad.terms.bluesky.rules['content-limits'].data['display-name-chars'] = 3;
  const [short] = composeSignupPackets(bad);
  assert.ok(short.packets[0].problems.some(x => x.includes('short bio')));
  assert.ok(short.packets[0].problems.some(x => x.includes('display name')));
});

test('invalid source/owner instructions refuse, with no inferred authority or account effects', () => {
  const cases = [
    () => ({ ...sources(), policy: null }),
    () => ({ ...sources(), handleChecks: { results: {} } }),
    () => ({ ...sources(), brands: {} }),
    () => ({ ...sources(), plan: { platforms: {} } }),
    () => ({ ...sources(), plan: { platforms: { '../escape': {} } } }),
    () => ({ ...sources(), policy: { before: [], after: [], readiness: [], mustNot: [] } }),
  ];
  for (const bad of cases) assert.throws(() => composeSignupPackets(bad()), TypeError);
});

test('existing CLI: exact synthetic files in, JSON and Markdown out, missing policy refuses', () => {
  const root = mkdtempSync(join(tmpdir(), 'signup-packets-'));
  const brands = join(root, 'brands'), terms = join(root, 'terms'), output = join(root, 'output');
  mkdirSync(brands); mkdirSync(terms);
  const fixture = sources();
  const write = (p, v) => writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
  write(join(brands, 'example.jsonld'), fixture.brands.example);
  write(join(terms, 'bluesky.json'), fixture.terms.bluesky);
  for (const f of ['plan', 'handleChecks', 'policy']) write(join(root, f + '.json'), fixture[f]);
  const original = readFileSync(join(brands, 'example.jsonld'), 'utf8');
  const cli = new URL('../apps/brand-presence.mjs', import.meta.url).pathname;
  const args = ['signup-packets', '--brands', brands, '--terms', terms,
    '--plan', join(root, 'plan.json'), '--handles', join(root, 'handleChecks.json'),
    '--policy', join(root, 'policy.json'), '--out', output];
  const run = (...values) => spawnSync(process.execPath, [cli, ...values], { encoding: 'utf8', timeout: 10000 });
  const good = run(...args);
  assert.equal(good.status, 0, good.stderr);
  assert.deepEqual(JSON.parse(good.stdout).brands, [{ brand: 'example', packets: 1, problems: 0 }]);
  assert.equal(JSON.parse(readFileSync(join(output, 'example.json'))).completed, false);
  assert.match(readFileSync(join(output, 'example.md'), 'utf8'), /proposed/u);
  assert.equal(readFileSync(join(brands, 'example.jsonld'), 'utf8'), original);
  const bad = run(...args.filter((_, i) => ![args.indexOf('--policy'), args.indexOf('--policy') + 1].includes(i)));
  assert.equal(bad.status, 3, bad.stderr);
  assert.match(bad.stderr, /refused/u);
});
