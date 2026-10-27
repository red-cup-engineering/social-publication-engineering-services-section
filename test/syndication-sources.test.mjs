import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { admitAccountRegistry, admitContentItem, admitPlatformRuleSet, gateRendition, itemsFromYouTubeInventory, planSchedule, renditionsFor } from '../src/syndication/index.mjs';

const ruleSet = admitPlatformRuleSet(JSON.parse(readFileSync(new URL('../content/platform-rules.seed.json', import.meta.url), 'utf8')));
const upload = (id, title, description, extra = {}) => ({
  id, etag: `etag-${id}`, status: { privacyStatus: 'public' }, statistics: { viewCount: '10' }, contentDetails: { duration: 'PT9M' },
  snippet: { title, description, publishedAt: '2026-10-01T00:00:00Z', tags: ['climate change', 'cities', 'models', 'extra'] }, ...extra,
});
const inventory = {
  observedAt: '2026-10-09T00:00:00Z',
  uploads: [
    upload('LESSON00001', 'Miami climate: what the data shows', 'What does objective model-driven data actually reveal about the climate of Miami? This lesson looks past headlines to the numbers. It ends with what to check yourself.'),
    upload('SHORT000001', '#MiamiClimate #CMIP6', 'The full lesson: https://youtu.be/LESSON00001\n\nWhat does objective model-driven data actually reveal about Miami?', { statistics: { viewCount: '400' }, contentDetails: { duration: 'PT9S' } }),
    upload('SHORT000002', '#Orphan', 'The full lesson: https://youtu.be/MISSING0001\n\nA short whose lesson is not public.', { contentDetails: { duration: 'PT9S' } }),
    { ...upload('PRIVATE0001', 'Private draft', 'A private upload that must never be offered to anyone.'), status: { privacyStatus: 'private' } },
  ],
};

test('YouTube inventory becomes content items: public lessons only, Shorts ride with their lesson', () => {
  const items = itemsFromYouTubeInventory(inventory, { brand: 'lenticule-science', section: 'science' });
  assert.deepEqual(items.map((item) => item.meta.youtubeId), ['LESSON00001']);
  const [item] = items;
  assert.equal(item.canonicalUrl, 'https://www.youtube.com/watch?v=LESSON00001');
  assert.equal(item.meta.shortId, 'SHORT000001');
  assert.equal(item.meta.views, 410, 'the lesson earns its Short’s reach');
  assert.ok(!/https?:|#/u.test(item.summary));
  assert.equal(item.tags.length, 3);
  assert.ok(item.linkedWorkAiGenerated);
  assert.ok(admitContentItem(item));
});

test('planned accounts are awaiting-account, not scheduled, and never reach live posting', () => {
  const [item] = itemsFromYouTubeInventory(inventory, { brand: 'lenticule-science', section: 'science' });
  const registry = admitAccountRegistry({ type: 'AccountRegistry', version: 1, accounts: [
    { id: 'science@bluesky', brand: 'lenticule-science', platform: 'bluesky', handle: 'lenticule.science', kind: 'organization', automation: { botDisclosed: true }, credentialRef: { scheme: 'store', name: 'bluesky/science' }, timezone: 'America/Chicago', state: 'planned', sections: ['science'] },
  ] });
  const renditions = renditionsFor(admitContentItem(item), { accounts: registry.accounts, ruleSet });
  const plan = planSchedule({ renditions, registry, ruleSet, startMs: Date.parse('2026-10-26T00:00:00Z'), days: 7 });
  assert.equal(plan.entries[0].status, 'awaiting-account');
  assert.ok(plan.entries[0].at, 'the time is still planned so the owner sees the cadence');
  const gate = gateRendition(renditions[0], { account: registry.accounts[0], ruleSet, nowMs: Date.parse('2026-10-26T15:00:00Z'), live: true });
  assert.equal(gate.pass, false);
  assert.ok(gate.holds.some((reason) => /planned/u.test(reason)));
  assert.ok(renditions[0].text.includes('AI-generated media'), 'a post linking an AI-made video says so');
});
