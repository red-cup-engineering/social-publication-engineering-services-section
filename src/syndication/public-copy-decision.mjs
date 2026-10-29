/**
 * Original brand-presence public-copy decision receiver.
 * Source-input -> exact content-NI check -> declarative human handoff.
 *
 * Engineering owns deterministic behavior; a brand/enterprise owns its own
 * decision, public words, source locator, recipient and authority. This port
 * neither edits a public account nor acknowledges that a human applied it.
 */
import { niOfBytes } from './canonical.mjs';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const filled = value => typeof value === 'string' && value.trim().length > 0;
const fail = message => { throw new TypeError(`public-copy decision refused: ${message}`); };
const validLocator = value => filled(value) && !value.startsWith('/') &&
  !value.split('/').some(part => part === '..' || part === '.' || part === '') &&
  !/[\\\r\n]/u.test(value);

export function literalPublicCopyNi(text) {
  if (typeof text !== 'string' || !text.isWellFormed() ||
      Buffer.byteLength(text, 'utf8') > 100_000)
    fail('copy text must be bounded well-formed UTF-8');
  return niOfBytes(Buffer.from(text, 'utf8'));
}

/**
 * No filesystem, network, identity, credential or approval side effect.
 * The caller supplies the original exact source file locator AND bytes;
 * neither a chosen ID nor a claimed passed gate is sufficient in isolation.
 */
export function verifyPublicCopyDecision({ decision, copy, copyLocator }) {
  if (!object(decision) || !object(copy)) fail('decision and public-copy source required');
  if (!validLocator(copyLocator)) fail('exact source locator required');
  if (decision.kind !== 'decision' || copy.kind !== 'public-copy' ||
      !filled(decision.id) || !filled(copy.id) || decision.id !== copy.id)
    fail('source kind or decision identity inconsistent');
  for (const key of ['recorded-on', 'office', 'duty', 'skill', 'standing', 'question', 'rationale'])
    if (!filled(decision[key])) fail('incomplete decision record');
  if (!object(decision.authority) || !filled(decision.authority.basis) ||
      !object(decision.reversal) || typeof decision.reversal.reversible !== 'boolean' ||
      (decision.reversal.reversible && !filled(decision.reversal.how)))
    fail('authority or reversal missing');
  if (!Array.isArray(decision.sources) ||
      !decision.sources.some(source => source?.role === 'produced' &&
          source.locator === copyLocator))
    fail('produced source locator mismatch');
  if (!Array.isArray(decision.options) || decision.options.length < 2 ||
      decision.options.length > 16 || !filled(decision.chosen) ||
      new Set(decision.options.map(o => o?.id)).size !== decision.options.length ||
      !decision.options.every(o => filled(o?.id)) ||
      decision.options.filter(o => o.id === decision.chosen).length !== 1)
    fail('incomplete or ambiguous decision options');
  if (!Array.isArray(copy.options) || copy.options.length < 2 ||
      copy.options.length > 16 || !object(copy.chosen) ||
      copy.chosen.id !== decision.chosen || !filled(copy.chosen.textNi) ||
      new Set(copy.options.map(o => o?.id)).size !== copy.options.length)
    fail('copy options and decision selection disagree');
  const chosen = copy.options.filter(o => o?.id === decision.chosen);
  if (chosen.length !== 1 || !object(chosen[0].candidate) ||
      chosen[0].candidate.type !== 'CopyCandidate' ||
      chosen[0].gate?.pass !== true || !object(chosen[0].gate.report))
    fail('chosen source copy lacks an admitted editorial gate');
  const text = chosen[0].candidate.text;
  const textNi = literalPublicCopyNi(text);
  if (chosen[0].gate.report.textNi !== textNi || copy.chosen.textNi !== textNi)
    fail('chosen UTF-8 bytes disagree with editorial gate or content address');
  if (!filled(copy.brand) || chosen[0].candidate.brand !== copy.brand ||
      !filled(copy.platform) || chosen[0].candidate.platform !== copy.platform)
    fail('candidate is not the decision brand and platform');
  return Object.freeze({
    kind: 'social.public-copy-decision-check.v1',
    valid: true,
    decisionId: decision.id,
    copyLocator,
    selectedOption: decision.chosen,
    textNi,
    verifiedCompletion: false,
    receivingBoundary: 'Source and editorial decision only; account-holder effect, public readback and Work assent remain separate.',
  });
}

/** Caller supplies all local identity, provenance and recipient parameters. */
export function publicCopyHandoff({
  decision, copy, copyLocator, recipientCharacterIds, sourceRepository,
  decisionRecordLocator, recordKind = 'group-human-handoff',
}) {
  const check = verifyPublicCopyDecision({ decision, copy, copyLocator });
  if (!Array.isArray(recipientCharacterIds) || recipientCharacterIds.length === 0 ||
      recipientCharacterIds.length > 20 ||
      !recipientCharacterIds.every(filled) ||
      new Set(recipientCharacterIds).size !== recipientCharacterIds.length)
    fail('explicit unique authorized recipients required');
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/iu.test(sourceRepository ?? '') ||
      !validLocator(decisionRecordLocator) ||
      !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(recordKind ?? ''))
    fail('original source repository and exact decision locator required');
  for (const key of ['handoffTitle', 'handoffRationale', 'handoffEntryLabel',
                      'successTitle', 'successBody'])
    if (!filled(copy[key])) fail('source-owned handoff presentation incomplete');
  if (!Array.isArray(copy.handoffSteps) || copy.handoffSteps.length === 0 ||
      copy.handoffSteps.length > 20 || !copy.handoffSteps.every(filled))
    fail('source-owned handoff steps incomplete');
  const selected = copy.options.find(o => o.id === decision.chosen);
  return {
    recordKind, schemaVersion: 1, handoffId: `apply-${decision.id}`,
    sourceForm: 'specific-handoff', interactionKind: 'browser-assisted-account-setup',
    recipientCharacterIds: [...recipientCharacterIds],
    presentation: {
      title: copy.handoffTitle,
      rationale: `${copy.handoffRationale} Decision: ${decision.id}. Content address of the words: ${check.textNi}.`,
      entry: { label: copy.handoffEntryLabel },
      steps: [...copy.handoffSteps,
        `Paste exactly this text:\n\n${selected.candidate.text}`,
        'Save the profile, then return to this step and mark it done. The house reads the page back and compares it with the content address above.'],
      assistanceHint: 'The account holder logs in; an assistant shows the exact decided words without receiving credentials.',
    },
    expectedOutcome: { custodyDescription: 'No account credentials in the handoff; the principal retains login custody.' },
    expectedDownstreamEffects: ['the public profile reads as decided', 'a separate source-qualified change/readback record'],
    proposedSuccessCopy: { title: copy.successTitle, body: copy.successBody },
    templateParameterNames: [],
    sourceProvenance: {
      sourceRepository, decisionRecord: decisionRecordLocator,
      publicCopyRecord: copyLocator,
      interpretation: 'A source-qualified human handoff, not credential intake, a public edit, a completed Work Move or independent acceptance.',
    },
    verifiedCompletion: false,
  };
}
