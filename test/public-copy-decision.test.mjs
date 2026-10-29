import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { literalPublicCopyNi, verifyPublicCopyDecision, publicCopyHandoff } from '../src/syndication/public-copy-decision.mjs';

const locator = 'data/records/public-copy-records/synthetic-decision.json';
const text = 'Example cooperative research. Operated by Example Organization. AI-assisted copy.';
const ni = literalPublicCopyNi(text);
const fixture = () => ({
  decision: {
    id: 'synthetic-decision', kind: 'decision', 'recorded-on': '2026-10-20',
    office: 'synthetic-marketing-office', duty: 'synthetic-public-copy',
    skill: 'synthetic-decide', standing: 'method-applied-without-incumbency',
    sources: [{ role: 'produced', locator }], question: 'Which copy?',
    options: [{ id: 'keep' }, { id: 'adopt' }], chosen: 'adopt',
    rationale: 'Selected by the synthetic authorized example.',
    authority: { basis: 'synthetic test, no real authority' },
    reversal: { reversible: true, how: 'revisit the synthetic decision' },
  },
  copy: {
    id: 'synthetic-decision', kind: 'public-copy',
    brand: 'synthetic-brand', platform: 'bluesky',
    options: [
      { id: 'keep', candidate: { type: 'CopyCandidate', brand: 'synthetic-brand', platform: 'bluesky', text: 'Previous.' }, gate: { pass: false } },
      { id: 'adopt', candidate: { type: 'CopyCandidate', brand: 'synthetic-brand', platform: 'bluesky', text }, gate: { pass: true, report: { textNi: ni } } },
    ],
    chosen: { id: 'adopt', textNi: ni },
    handoffTitle: 'Apply synthetic copy', handoffRationale: 'Synthetic source decision.',
    handoffEntryLabel: 'Example synthetic page', handoffSteps: ['Visit the synthetic profile.'],
    successTitle: 'Example', successBody: 'Synthetic example, not a real account receipt.',
  },
});

const options = {
  copyLocator: locator, sourceRepository: 'example-org/example-service',
  decisionRecordLocator: 'data/records/decision-records/synthetic-decision.json',
  recipientCharacterIds: ['synthetic-recipient'],
};

test('the source-qualified choice and byte address produce only a non-completing handoff', () => {
  const { decision, copy } = fixture();
  const check = verifyPublicCopyDecision({ decision, copy, copyLocator: locator });
  assert.equal(check.valid, true);
  assert.equal(check.verifiedCompletion, false);
  assert.equal(check.textNi, ni);
  const handoff = publicCopyHandoff({ decision, copy, ...options });
  assert.equal(handoff.verifiedCompletion, false);
  assert.equal(handoff.interactionKind, 'browser-assisted-account-setup');
  assert.deepEqual(handoff.recipientCharacterIds, ['synthetic-recipient']);
  assert.equal(handoff.sourceProvenance.publicCopyRecord, locator);
  assert.ok(handoff.presentation.steps.some(s => s.includes(text)));
  assert.equal(handoff.presentation.steps.join(' ').includes('credentialRef'), false);
});

test('exact refused cases: source, authority, editorial gate, bytes and choice identity', () => {
  const changes = [
    [x => { x.decision.sources[0].locator = 'different.json'; }, /source locator/u],
    [x => { delete x.decision.authority; }, /authority/u],
    [x => { x.decision.reversal.how = ''; }, /reversal/u],
    [x => { x.decision.options = [{ id: 'adopt' }]; }, /decision options/u],
    [x => { x.copy.options[1].gate.pass = false; }, /editorial gate/u],
    [x => { x.copy.options[1].gate.report.textNi = 'ni:///sha-256;tampered'; }, /UTF-8 bytes/u],
    [x => { x.copy.options[1].candidate.text += ' changed'; }, /UTF-8 bytes/u],
    [x => { x.copy.options[1].candidate.brand = 'not-our-brand'; }, /brand and platform/u],
    [x => { x.copy.chosen.id = 'keep'; }, /selection disagree/u],
    [x => { x.decision.options.push({ id: 'adopt' }); }, /decision options/u],
  ];
  for (const [edit, error] of changes) {
    const input = fixture(); edit(input);
    assert.throws(() => verifyPublicCopyDecision({ ...input, copyLocator: locator }), error);
  }
  assert.throws(() => verifyPublicCopyDecision({ ...fixture(), copyLocator: '../other.json' }), /locator/u);
  assert.throws(() => literalPublicCopyNi('\uD800'), /well-formed/u);
  assert.throws(() => literalPublicCopyNi('a'.repeat(100_001)), /bounded/u);
});

test('no receiver, invented power, or invalid source may fabricate the packet', () => {
  const input = fixture();
  assert.throws(() => publicCopyHandoff({ ...input, ...options, recipientCharacterIds: [] }), /recipients/u);
  assert.throws(() => publicCopyHandoff({ ...input, ...options, recipientCharacterIds: ['same', 'same'] }), /recipients/u);
  assert.throws(() => publicCopyHandoff({ ...input, ...options, sourceRepository: 'not-an-owned-repo' }), /repository/u);
  assert.throws(() => publicCopyHandoff({ ...input, ...options, decisionRecordLocator: '../../outside' }), /locator/u);
  delete input.copy.handoffTitle;
  assert.throws(() => publicCopyHandoff({ ...input, ...options }), /presentation/u);
});

test('real CLI: synthetic success and mismatch exit 3, no account action or input mutation', () => {
  const root = mkdtempSync(join(tmpdir(), 'public-copy-decision-'));
  const { decision, copy } = fixture();
  const decisionFile = join(root, 'decision.json');
  const copyFile = join(root, 'copy.json');
  const output = join(root, 'handoff.json');
  writeFileSync(decisionFile, JSON.stringify(decision));
  writeFileSync(copyFile, JSON.stringify(copy));
  const before = [readFileSync(decisionFile), readFileSync(copyFile)];
  const cli = new URL('../apps/brand-presence.mjs', import.meta.url).pathname;
  const run = (...extra) => spawnSync(process.execPath, [cli, ...extra], { encoding: 'utf8', timeout: 5000 });
  const checked = run('decision-check', decisionFile, copyFile, '--copy-locator', locator);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).valid, true);
  const handed = run('decision-handoff', decisionFile, copyFile,
    '--copy-locator', locator, '--out', output,
    '--recipients', 'synthetic-recipient', '--source-repo', 'example-org/example-service',
    '--decision-locator', options.decisionRecordLocator);
  assert.equal(handed.status, 0, handed.stderr);
  assert.equal(JSON.parse(readFileSync(output)).verifiedCompletion, false);
  assert.deepEqual([readFileSync(decisionFile), readFileSync(copyFile)], before);
  copy.options[1].candidate.text += ' silently changed';
  writeFileSync(copyFile, JSON.stringify(copy));
  const refused = run('decision-handoff', decisionFile, copyFile,
    '--copy-locator', locator, '--out', output,
    '--recipients', 'synthetic-recipient', '--source-repo', 'example-org/example-service',
    '--decision-locator', options.decisionRecordLocator);
  assert.equal(refused.status, 3, refused.stderr);
  assert.match(refused.stderr, /refused/u);
});
