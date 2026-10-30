import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const cli = new URL('../apps/brand-presence.mjs', import.meta.url).pathname;
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 10000 });

test('original post gate rejects wrong/empty candidate sets without finalizing mutable files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-post-'));
  const brands = join(dir, 'brands'), links = join(dir, 'links.json'), candidate = join(dir, 'candidate.json');
  mkdirSync(brands); writeFileSync(links, '{}');
  const invalid = '{"type":"SomeOtherDocument","items":[]}';
  writeFileSync(candidate, invalid);
  const args = ['gate-post', '--candidates', candidate, '--brands', brands, '--links', links, '--finalize'];
  const wrong = run(...args);
  assert.equal(wrong.status, 3, wrong.stderr);
  assert.match(wrong.stderr, /refused/u);
  assert.equal(readFileSync(candidate, 'utf8'), invalid);
  writeFileSync(candidate, '{"type":"PostCandidateSet","items":[]}');
  const empty = run(...args);
  assert.equal(empty.status, 3, empty.stderr);
  assert.equal(readFileSync(candidate, 'utf8'), '{"type":"PostCandidateSet","items":[]}');
});

test('original provenance workflow refuses unwitnessed source before writing any manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'provenance-build-'));
  const profiles = join(dir, 'brands'), links = join(dir, 'links.json');
  const candidates = join(dir, 'candidates.json'), out = join(dir, 'out');
  mkdirSync(profiles); writeFileSync(links, '{}');
  writeFileSync(candidates, '{"type":"PostCandidateSet","items":[]}');
  const args = ['provenance-build', '--candidates', candidates, '--brands', profiles,
    '--links', links, '--out', out, '--key-id', 'production-key-1'];
  const noOriginal = run(...args);
  assert.equal(noOriginal.status, 3, noOriginal.stderr);
  assert.match(noOriginal.stderr, /refused/u);
  assert.equal(existsSync(out), false);
});

test('platform-specific current-rule selector refuses unverified platform, not a live posting permission', () => {
  const dir = mkdtempSync(join(tmpdir(), 'platform-terms-'));
  const bad = run('rules', dir, '--platform', 'unrecognized-synthetic-platform', '--live');
  assert.equal(bad.status, 3, bad.stderr);
  assert.match(bad.stderr, /no verified rule/u);
});
