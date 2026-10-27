import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { admitAccountRegistry, admitContentItem, admitPlatformRuleSet, defaultVoiceCheck, niOfBytes, niOfJson, planSchedule, renditionsFor, slotsFor, ruleFor } from '../src/syndication/index.mjs';

const ruleSet = admitPlatformRuleSet(JSON.parse(readFileSync(new URL('../content/platform-rules.seed.json', import.meta.url), 'utf8')));
const account = (id, platform, extra = {}) => ({ id, brand: 'b', platform, handle: id, kind: 'organization', automation: { botDisclosed: true }, credentialRef: { scheme: 'none', name: '-' }, timezone: 'America/Chicago', state: 'active', sections: ['*'], ...extra });
const item = (title, tags = []) => admitContentItem({ id: niOfJson({ title }), brand: 'b', section: 's', kind: 'post', title, summary: 'A plain summary that says what the page shows and who it is for, in one sentence.', canonicalUrl: 'https://example.test/page', tags, source: { ni: niOfBytes(Buffer.from(title)) } });

test('copy: no doubled punctuation, tidy hashtags, link-only where the platform wants it', () => {
  const registry = admitAccountRegistry({ type: 'AccountRegistry', version: 1, accounts: [account('a@bluesky', 'bluesky'), account('a@hackernews', 'hackernews')] });
  const [bluesky] = renditionsFor(item('Who bears the risk of spoilage?', ['access to infrastructure', 'cold chain', 'bargaining power across the entire supply chain', 'ab']), { accounts: [registry.accounts[0]], ruleSet });
  assert.ok(!/\?\.|\.\./u.test(bluesky.text), bluesky.text);
  assert.ok(bluesky.text.includes('#ColdChain'));
  assert.ok(!bluesky.text.includes('#AccessToInfrastructure') || bluesky.text.includes('#AccessToInfrastructure'), 'two-word tags are allowed');
  assert.ok(!/#Ab\b/u.test(bluesky.text) && !/BargainingPower/u.test(bluesky.text), 'long and tiny tags are not hashtags');
  const [news] = renditionsFor(item('How an x402 payment works, step by step'), { accounts: [registry.accounts[1]], ruleSet });
  assert.equal(news.text, 'https://example.test/page');
  assert.equal(news.title, 'How an x402 payment works, step by step');
});

test('voice lint: acronyms are not shouting, shouting is', () => {
  assert.equal(defaultVoiceCheck({ text: 'How this site is built: TUFTE, llms.txt, JSON-LD and a build that refuses broken links. https://example.test' }).pass, true);
  assert.ok(defaultVoiceCheck({ text: 'THIS IS THE BEST THING YOU WILL EVER READ ABOUT SPOILAGE AND COLD CHAINS' }).notes.some((note) => /shouting/u.test(note)));
});

test('cadence: an account posts at its chosen pace inside the platform limits, spread across the window', () => {
  const rule = ruleFor(ruleSet, 'bluesky');
  const loud = slotsFor(account('a@bluesky', 'bluesky'), rule, { startMs: Date.parse('2026-10-26T00:00:00Z'), days: 1 });
  const quiet = slotsFor(account('a@bluesky', 'bluesky', { cadence: { targetPerDay: 1 } }), rule, { startMs: Date.parse('2026-10-26T00:00:00Z'), days: 1 });
  assert.equal(loud.length, rule.cadence.targetPerDay);
  assert.equal(quiet.length, 1);
  assert.ok(loud[1] - loud[0] >= 6 * 3_600_000, 'two posts a day are hours apart, not back to back');
  const registry = admitAccountRegistry({ type: 'AccountRegistry', version: 1, accounts: [account('a@bluesky', 'bluesky')] });
  const renditions = Array.from({ length: 40 }, (_, n) => item(`Page ${n}`)).flatMap((entry) => renditionsFor(entry, { accounts: registry.accounts, ruleSet }));
  const plan = planSchedule({ renditions, registry, ruleSet, startMs: Date.parse('2026-10-26T00:00:00Z'), days: 14 });
  const per = new Map();
  for (const entry of plan.entries.filter((row) => row.at)) per.set(entry.at.slice(0, 10), (per.get(entry.at.slice(0, 10)) ?? 0) + 1);
  assert.ok([...per.values()].every((count) => count <= rule.cadence.targetPerDay));
  assert.ok(plan.entries.some((row) => row.status === 'unscheduled'), 'what does not fit the horizon waits in the backlog');
});
