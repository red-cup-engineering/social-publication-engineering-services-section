import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { probeHandlePlan } from '../src/syndication/handles.mjs';

const plan = () => ({ type: 'BrandPlatformPlan', platforms: {
  example: {
    bluesky: { wave: 1, handleCandidates: ['example.bsky.social', 'example.org'] },
    x: { wave: 2, handleCandidates: ['sample'] },
    mastodon: { wave: 'human-only', handleCandidates: ['manual'] },
  },
} });

test('original multi-brand plan preserves exact names, original public evidence and no reservations', async () => {
  const calls = [];
  const out = await probeHandlePlan(plan(), {
    checkedOn: '2026-10-30', pauseMs: 0,
    probe: async (platform, name, args) => {
      calls.push({ platform, name, ...args.options });
      return { result: platform === 'x' ? 'not-probed' : 'free-looking', evidence: { how: 'synthetic public-only probe' } };
    },
  });
  assert.equal(out.type, 'HandleChecks');
  assert.equal(out.results.length, 3);
  assert.equal(out.results[0].handle, 'example.bsky.social');
  assert.equal(out.results[0].result, 'free-looking');
  assert.equal(out.results[2].result, 'not-probed');
  assert.deepEqual(calls.map(c => c.platform), ['bluesky', 'bluesky', 'x']);
  assert.equal(calls[0].domain, 'example.bsky.social');
  assert.equal(calls[1].domain, 'example.org');
  assert.ok(out.method.includes('not a reservation'));
});

test('invalid plans, invented observation dates, invalid probe outcomes and malformed candidates refuse', async () => {
  for (const args of [
    { plan: {}, options: { checkedOn: '2026-10-30' } },
    { plan: plan(), options: { checkedOn: 'yesterday' } },
    { plan: plan(), options: { checkedOn: '2026-10-30', pauseMs: -1 } },
    { plan: { platforms: { example: { x: { handleCandidates: 'not a list' } } } }, options: { checkedOn: '2026-10-30' } },
    { plan: { platforms: { example: { x: { handleCandidates: [''] } } } }, options: { checkedOn: '2026-10-30' } },
  ]) {
    await assert.rejects(probeHandlePlan(args.plan, args.options), TypeError);
  }
  await assert.rejects(probeHandlePlan(plan(), {
    checkedOn: '2026-10-30', pauseMs: 0, probe: async () => ({ result: 'certainly-free' }),
  }), /no admissible outcome/u);
});

test('native CLI reads a no-public-probe plan; output admits no account effect', () => {
  const dir = mkdtempSync(join(tmpdir(), 'handle-plan-'));
  const source = join(dir, 'plan.json'), out = join(dir, 'checks.json');
  writeFileSync(source, JSON.stringify({ platforms: { example: { x: {
    wave: 2, handleCandidates: ['synthetic-account'],
  } } } }));
  const cli = new URL('../apps/brand-presence.mjs', import.meta.url).pathname;
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000 });
  const actual = run('handles-plan', '--plan', source, '--out', out, '--pause-ms', '0', '--checked-on', '2026-10-30');
  assert.equal(actual.status, 0, actual.stderr);
  assert.equal(JSON.parse(actual.stdout).reservations, 0);
  assert.equal(JSON.parse(actual.stdout).counts['not-probed'], 1);
  assert.equal(JSON.parse(readFileSync(out, 'utf8')).results[0].result, 'not-probed');
  const refused = run('handles-plan', '--out', out);
  assert.equal(refused.status, 3);
  assert.match(refused.stderr, /refused/u);
});
