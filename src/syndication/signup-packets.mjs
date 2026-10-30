/**
 * Original Red Cup Engineering supplier for deterministic signup-packet composition.
 * Ported from the existing Group brand-presence Work (red-cup #11).
 * Caller-supplied brand, terms, handles and owner policy are data; no network, accounts,
 * login, Terms acceptance, credential creation or live posting is performed here.
 *
 * A packet is a *proposal*, not proof that a platform accepts the handle or an account exists.
 */
export function composeSignupPackets({ brands, terms, plan, handleChecks, policy, brandOnly } = {}) {
  if (!brands || typeof brands !== 'object' || !terms || typeof terms !== 'object' ||
      !plan || !plan.platforms || typeof plan.platforms !== 'object' ||
      !handleChecks || !Array.isArray(handleChecks.results) || !policy || typeof policy !== 'object') {
    throw new TypeError('source brands, platform terms, plan, HandleChecks and owner policy are required');
  }
  for (const [key, length] of [['before', 1], ['after', 3], ['readiness', 1], ['mustNot', 1]]) {
    if (!Array.isArray(policy[key]) || policy[key].length < length ||
        policy[key].some((step) => typeof step !== 'string' || !step.trim())) {
      throw new TypeError('owner policy.' + key + ' must supply nonempty original instructions');
    }
  }
  const handles = handleChecks.results;
  if (Object.keys(plan.platforms).length === 0) throw new TypeError('plan has no brands');
  for (const brandId of Object.keys(plan.platforms)) {
    if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(brandId)) throw new TypeError('unsafe source brand identifier');
  }
const field = (record, key) => record.rules?.[key] ?? {};
const dataOf = (record, key) => field(record, key).data ?? {};

function pickBio(brand, limit) {
  const long = brand['x-profile']['bio-long'];
  const short = brand['x-profile']['bio-short'];
  if (!limit || long.length <= limit) return { text: long, chars: long.length, limit: limit ?? null, fits: true };
  if (short.length <= limit) return { text: short, chars: short.length, limit, fits: true };
  return { text: short, chars: short.length, limit, fits: false, problem: `the short bio is ${short.length} characters and the limit is ${limit}; the owner shortens it` };
}

function handleChoices(brandId, platform, entry) {
  const checks = handles.filter((h) => h.brand === brandId && h.platform === platform);
  const spec = null; void spec;
  return (entry.handleCandidates ?? []).map((candidate) => {
    const check = checks.find((c) => c.handle === candidate);
    return { handle: candidate, result: check?.result ?? 'not-checked', checkedOn: check?.checkedOn ?? null, evidence: check ? { how: check.evidence?.describe ?? null, http: check.evidence?.attempts?.map((a) => a.http ?? a.error) ?? [] } : null };
  });
}

const GENERIC_BEFORE = policy.before;
const GENERIC_AFTER = policy.after;
const READINESS = policy.readiness;
const MUST_NOT = policy.mustNot;

function packetFor(brandId, platform, entry) {
  const brand = brands[brandId];
  const record = terms[platform];
  const base = { type: 'SignupPacket', version: 1, brand: brandId, platform, status: 'proposed', wave: entry.wave, kind: entry.kind, why: entry.why };
  if (!record) return { ...base, problems: [`no platform-terms record for ${platform}`] };
  const content = dataOf(record, 'content-limits');
  const spec = dataOf(record, 'profile-spec');
  const nameLimit = content['display-name-chars'] ?? null;
  const bio = pickBio(brand, content['bio-chars'] ?? null);
  const problems = [];
  if (!bio.fits) problems.push(bio.problem);
  if (nameLimit && brand['x-profile']['display-name'].length > nameLimit) problems.push(`display name is longer than ${nameLimit}`);
  const choices = handleChoices(brandId, platform, entry);
  const usable = choices.filter((c) => c.result === 'free-looking' && (!spec['handle-max'] || c.handle.length <= spec['handle-max']));
  const sources = (record.sources ?? []).map((s) => ({ id: s.id, title: s.title, url: s.url, kind: s.kind, sha256: s.fetch?.sha256 ?? null, fetchKind: s.fetch?.kind }));
  const rule = (key) => { const f = field(record, key); return { value: f.value ?? null, status: f.status ?? 'not-stated', detail: f.detail ?? null, source: f.source ?? null }; };
  return {
    ...base,
    observedOn: record['observed-on'],
    termsRecord: record.id,
    platformWorthIt: record['worth-it'],
    platformFit: record['brand-fit']?.[brandId] ?? null,
    account: {
      kind: entry.kind,
      displayName: brand['x-profile']['display-name'],
      handleChoices: choices,
      recommendedHandle: usable[0]?.handle ?? null,
      instance: entry.instance ?? null,
      bio,
      ownershipLine: brand['x-ownership-disclosure'].line,
      aiDisclosureLine: brand['x-ai-disclosure']['account-line'],
      link: brand['x-profile'].link,
      avatar: brand['x-profile'].avatar,
      banner: brand['x-profile'].banner,
      platformProfileSpec: spec,
      platformContentLimits: content,
      whereOwnershipFits: field(record, 'disclosure-affordances').detail ?? null,
      botLabel: rule('bot-label'),
      credentialRef: policy.credentialRefs?.[brandId]?.[platform] ?? { scheme: 'none', name: 'not-selected' },
    },
    platformRules: Object.fromEntries(['organization-accounts', 'account-creation', 'automation-api', 'ai-content-disclosure', 'multiple-accounts', 'coordinated-behavior', 'self-promotion', 'api-cost'].map((k) => [k, rule(k)])),
    hardRuleConflicts: record['hard-rule-conflicts'] ?? [],
    ownerDecisions: [entry.ownerDecision, entry.structure].filter(Boolean),
    existingAccount: entry.existingAccount ?? null,
    steps: entry.existingSteps ? { before: [], onThePlatform: entry.existingSteps, after: GENERIC_AFTER.slice(0, 1).concat(GENERIC_AFTER.slice(2)), readinessBeforeFirstPost: READINESS } : { before: GENERIC_BEFORE, onThePlatform: record['owner-signup-steps'] ?? [], after: GENERIC_AFTER, readinessBeforeFirstPost: READINESS },
    mustNot: MUST_NOT,
    openQuestions: record['open-questions'] ?? [],
    sources,
    problems,
  };
}


  const documents = [];
  for (const [brandId, platforms] of Object.entries(plan.platforms)) {
    if (brandOnly && brandOnly !== brandId) continue;
    if (!brands[brandId]) throw new TypeError('brand has no original record: ' + brandId);
    if (!platforms || typeof platforms !== 'object') throw new TypeError('malformed brand platform entries');
    const packets = [];
    const notPlanned = [];
    for (const [platform, entry] of Object.entries(platforms)) {
      if (!entry || typeof entry !== 'object') throw new TypeError('malformed platform plan entry');
      if (['skip', 'deferred'].includes(entry.wave)) notPlanned.push({ platform, wave: entry.wave, why: entry.why });
      else packets.push(packetFor(brandId, platform, entry));
    }
    documents.push({
      type: 'BrandSignupPackets', version: 1, brand: brandId,
      displayName: brands[brandId].name, status: 'proposed',
      completed: false,
      composedFrom: {
        plan: plan.type, termsRecords: packets.map((p) => p.termsRecord).filter(Boolean),
        handleChecks: policy.handleChecksLocator ?? null,
        brandRecord: brands[brandId]['@id'],
      },
      skippedEverywhere: plan['skipped-everywhere'] ?? {},
      notPlannedForThisBrand: notPlanned, packets,
    });
  }
  if (!documents.length) throw new TypeError('no matching brand plan');
  return documents;
}

export function renderSignupPackets(doc) {
  const out = [];
  const q = (s) => String(s ?? '').replace(/\|/gu, '\\|');
  out.push(`# ${doc.displayName}: sign-up packets`, '', `Status: proposed, composed from supplied dated platform-terms records and handle checks. No account action has been performed. Every packet requires an authorized account holder for terms acceptance and verification. Packets are ordered by wave.`, '');
  const order = { 1: 0, exists: 1, 2: 2, 3: 3, 'human-only': 4 };
  for (const p of [...doc.packets].sort((a, b) => (order[a.wave] ?? 9) - (order[b.wave] ?? 9))) {
    out.push(`## ${p.platform} (wave ${p.wave})`, '', p.why, '');
    if (p.problems?.length) out.push(`Problems: ${p.problems.join('; ')}`, '');
    if (!p.account) { out.push('No platform-terms record exists for this platform.', ''); continue; }
    out.push(`- Terms record: \`${p.termsRecord}\`, observed ${p.observedOn}; platform verdict: ${p.platformWorthIt}; fit for this brand: ${p.platformFit?.fit} (${p.platformFit?.reason}).`);
    out.push(`- Account kind: ${p.account.kind}. Display name: **${p.account.displayName}**.`);
    out.push(`- Handles (a free-looking handle is not a reservation): ${p.account.handleChoices.length ? p.account.handleChoices.map((c) => `\`${c.handle}\` ${c.result}${c.checkedOn ? ` (${c.checkedOn})` : ''}`).join('; ') : 'none to check'}. Recommended: ${p.account.recommendedHandle ? `\`${p.account.recommendedHandle}\`` : 'none yet'}.`);
    if (p.account.instance) out.push(`- Server: ${p.account.instance} (owner decision).`);
    out.push(`- Bio (${p.account.bio.chars}${p.account.bio.limit ? ` of ${p.account.bio.limit}` : ''} characters): ${p.account.bio.text}`);
    out.push(`- Ownership line: ${p.account.ownershipLine} AI-disclosure line: ${p.account.aiDisclosureLine} Where it fits on this platform: ${q(p.account.whereOwnershipFits)}`);
    out.push(`- Link: ${p.account.link}. Avatar: ${p.account.avatar} Banner: ${p.account.banner}`);
    out.push(`- Automated-account label: ${p.account.botLabel.value} (${p.account.botLabel.status}). ${p.account.botLabel.detail ?? ''}`);
    out.push(`- Organization accounts: ${p.platformRules['organization-accounts'].value} (${p.platformRules['organization-accounts'].status}). Multiple accounts: ${p.platformRules['multiple-accounts'].value} (${p.platformRules['multiple-accounts'].status}). Coordinated behavior: ${p.platformRules['coordinated-behavior'].value} (${p.platformRules['coordinated-behavior'].status}).`);
    out.push(`- AI-content rule: ${p.platformRules['ai-content-disclosure'].value} (${p.platformRules['ai-content-disclosure'].status}). ${p.platformRules['ai-content-disclosure'].detail ?? ''}`);
    if (p.existingAccount) out.push(`- Existing account found: ${p.existingAccount.handle} (${p.existingAccount.did}), ${p.existingAccount.postsCount} posts, ${p.existingAccount.followersCount} follower(s), observed ${p.existingAccount.observedOn}.`);
    if (p.ownerDecisions.length) out.push('', '**Before you start:**', ...p.ownerDecisions.map((d) => `- ${d}`));
    if (p.hardRuleConflicts.length) out.push('', '**Conflicts with the account holder's rules:**', ...p.hardRuleConflicts.map((d) => `- ${d}`));
    out.push('', '**Steps for the owner**', '', 'Before:', ...(p.steps.before.length ? p.steps.before.map((s, i) => `${i + 1}. ${s}`) : ['(nothing: the account exists)']), '', 'On the platform (steps marked [unverified flow] were not confirmed against the live sign-up):', ...p.steps.onThePlatform.map((s, i) => `${i + 1}. ${s}`), '', 'After:', ...p.steps.after.map((s, i) => `${i + 1}. ${s}`), '', 'Before the first post:', ...p.steps.readinessBeforeFirstPost.map((s) => `- ${s}`), '');
    out.push('Sources read:', ...p.sources.map((s) => `- ${s.title}: ${s.url}${s.sha256 ? ` (sha256 ${s.sha256.slice(0, 16)}...)` : ''}`), '');
  }
  out.push('## Not planned for this brand', '', ...doc.notPlannedForThisBrand.map((n) => `- ${n.platform} (${n.wave}): ${n.why}`), ...Object.entries(doc.skippedEverywhere).map(([k, v]) => `- ${k}: ${v}`), '');
  return `${out.join('\n')}\n`;
}
