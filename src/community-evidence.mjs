/** Provider-neutral community observations and requirement readings over native SignCraft Cells.
 * The caller observes; this pure interpreter preserves the evidence and derives candidates.
 * A source's testimony is not independent authentication, a publish grant, or a world fact.
 */
import {
  address, cell, cellSet, cellSetAddress, coincides, retainedCarrier,
  sectionReading, semanticId,
} from "@red-cup-engineering/signcraft/cell";

const MAX_OBSERVATIONS = 512;
const MAX_REQUIREMENTS = 64;
const own = (x, key) => Object.hasOwn(x, key);
const record = x => x !== null && typeof x === "object" && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const text = (x, label, limit = 512) => {
  if (typeof x !== "string" || !x.trim() || x.length > limit || /[\u0000-\u001f\u007f]/u.test(x))
    throw new TypeError(`${label} must be bounded, nonempty text`);
  return x;
};
const instant = (x, label) => {
  text(x, label, 40);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/u.exec(x);
  if (!parts || !Number.isFinite(Date.parse(x))) throw new TypeError(`${label} must be a zoned RFC 3339 instant`);
  const [, year, month, day, hour, minute, second, , zone] = parts;
  const calendar = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
  if (calendar.getUTCFullYear() !== Number(year) || calendar.getUTCMonth() + 1 !== Number(month) || calendar.getUTCDate() !== Number(day) ||
      Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59 ||
      zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) throw new TypeError(`${label} has an invalid calendar date or time`);
  return new Date(x).toISOString();
};
const url = (x, label) => {
  text(x, label, 4096);
  const parsed = new URL(x);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new TypeError(`${label} must be an HTTPS URL without credentials`);
  return parsed.href;
};
function jsonValue(value) {
  const active = new WeakSet();
  let nodes = 0;
  function visit(x, depth) {
    if (++nodes > 50000 || depth > 24) throw new RangeError("community input exceeds its finite value budget");
    if (x === null || typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x))) return;
    if (typeof x === "string") { if (x.length > 20000) throw new RangeError("community text exceeds its value budget"); return; }
    if ((!record(x) && !Array.isArray(x)) || active.has(x)) throw new TypeError("community input requires acyclic finite JSON values");
    active.add(x);
    for (const key of Reflect.ownKeys(x)) {
      if (typeof key !== "string") throw new TypeError("community input cannot contain symbolic properties");
      const descriptor = Object.getOwnPropertyDescriptor(x, key);
      if (!Object.hasOwn(descriptor, "value")) throw new TypeError("community input cannot invoke accessor properties");
      visit(descriptor.value, depth + 1);
    }
    active.delete(x);
  }
  visit(value, 0);
  return value;
}
function only(x, keys, label) {
  if (!record(x) || Object.keys(x).some(key => !keys.includes(key))) throw new TypeError(`${label} has an unrecognized shape`);
}
const ordered = values => [...values].sort((a, b) => {
  const left = semanticId(a), right = semanticId(b);
  return left < right ? -1 : left > right ? 1 : 0;
});
const unique = values => [...new Map(values.map(value => [semanticId(value), value])).values()];

function admittedBatch(input) {
  jsonValue(input);
  only(input, ["kind", "subject", "observedAt", "observations", "effects"], "community batch");
  if (input.kind !== "forge.community-observations.v1" || !Array.isArray(input.observations) || input.observations.length > MAX_OBSERVATIONS ||
      !Array.isArray(input.effects) || input.effects.length !== 0) throw new TypeError("bounded effect-free community observations required");
  const subject = text(input.subject, "batch subject"), observedAt = instant(input.observedAt, "batch observedAt");
  const observations = input.observations.map(row => {
    only(row, ["subject", "predicate", "value", "status", "stance", "source", "reason"], "community observation");
    if (!["observed", "unknown"].includes(row.status) || ![undefined, "for", "against"].includes(row.stance)) throw new TypeError("observation status/stance is not admitted");
    if (row.status === "observed" && !own(row, "value")) throw new TypeError("an observed value must be present");
    if (row.status === "unknown" && own(row, "value") && row.value !== null) throw new TypeError("unknown observations cannot assert a value");
    if (row.subject !== subject) throw new TypeError("one community snapshot must refer to its declared subject");
    text(row.predicate, "observation predicate");
    only(row.source, ["url", "observedAt", "validatedAt", "provider", "repositoryId", "repository", "visibility", "coverage", "pages"], "observation source");
    const source = { ...row.source, url: url(row.source.url, "source URL"), observedAt: instant(row.source.observedAt, "source observedAt"), provider: text(row.source.provider, "provider", 80) };
    if (Date.parse(source.observedAt) > Date.parse(observedAt)) throw new TypeError("source observation cannot occur after the batch snapshot");
    if (own(source, "validatedAt")) {
      source.validatedAt = instant(source.validatedAt, "source validatedAt");
      if (Date.parse(source.validatedAt) > Date.parse(observedAt) || Date.parse(source.validatedAt) < Date.parse(source.observedAt))
        throw new TypeError("source cache validation must follow its observation and precede the snapshot");
    }
    if (own(source, "repositoryId") && !(typeof source.repositoryId === "string" && source.repositoryId.length > 0 || Number.isSafeInteger(source.repositoryId) && source.repositoryId > 0)) throw new TypeError("repositoryId must be a nonempty identifier");
    if (own(source, "repository")) text(source.repository, "repository");
    if (own(source, "visibility") && !["public", "private", "internal"].includes(source.visibility)) throw new TypeError("unknown source visibility");
    if (own(source, "pages")) {
      if (!Array.isArray(source.pages) || source.pages.length > 32) throw new TypeError("source pages must be bounded");
      source.pages = source.pages.map(page => {
        only(page, ["url", "observedAt", "validatedAt"], "source page");
        const next = { url: url(page.url, "page URL"), observedAt: instant(page.observedAt, "page observedAt") };
        if (own(page, "validatedAt")) next.validatedAt = instant(page.validatedAt, "page validatedAt");
        if ([next.observedAt, next.validatedAt].filter(Boolean).some(at => Date.parse(at) > Date.parse(observedAt)) ||
            next.validatedAt && Date.parse(next.validatedAt) < Date.parse(next.observedAt)) throw new TypeError("page provenance is not chronologically possible within the snapshot");
        return next;
      });
    }
    only(source.coverage, ["complete", "scope", "reason"], "source coverage");
    if (typeof source.coverage.complete !== "boolean") throw new TypeError("coverage.complete must be explicit");
    text(source.coverage.scope, "coverage scope");
    if (own(source.coverage, "reason")) text(source.coverage.reason, "coverage reason", 2000);
    if (row.status === "unknown" && !own(row, "reason")) throw new TypeError("unknown observations require a reason");
    if (own(row, "reason")) text(row.reason, "observation reason", 2000);
    return { subject, predicate: row.predicate, status: row.status, source,
      ...(row.status === "observed" ? { value: row.value, stance: row.stance ?? "for" } : {}),
      ...(own(row, "reason") ? { reason: row.reason } : {}) };
  });
  return retainedCarrier({ kind: input.kind, subject, observedAt, observations: ordered(unique(observations)), effects: [] });
}

/** Canonical knowledge join. Known, denied and unavailable values retain separate source occurrences. */
export function communityEvidence(input) {
  const batch = admittedBatch(input), scope = { subject: batch.subject, observedAt: batch.observedAt };
  const sourceCells = [], claimCells = [], observations = [];
  for (const observation of batch.observations) {
    const source = cell(observation.source, "reports-community-observation", observation,
      { for: [{ provider: observation.source.provider, url: observation.source.url, observedAt: observation.source.observedAt }] });
    const sourceCellAddress = address(source), id = semanticId(observation);
    sourceCells.push(source);
    const witness = { observation: id, sourceCellAddress, source: observation.source };
    let claimCellAddress = null;
    if (observation.status === "observed") {
      const claim = cell(scope, observation.predicate, observation.value,
        observation.stance === "against" ? { against: [witness] } : { for: [witness] });
      claimCells.push(claim); claimCellAddress = address(claim);
    }
    observations.push({ id, sourceCellAddress, claimCellAddress, observation });
  }
  const cells = cellSet([...sourceCells, ...claimCells]);
  return retainedCarrier({ kind: "social.community-evidence.v1", id: cellSetAddress(cells),
    subject: batch.subject, observedAt: batch.observedAt, batch, observations, cells,
    claimReading: sectionReading(claimCells), sourceStanding: "caller-observed-not-independently-authenticated", effects: [] });
}

/** A reusable forge profile: no target number of stars or other purchased/ranked engagement. */
export function defaultForgeCommunityRequirements(subject) {
  text(subject, "requirement subject");
  return retainedCarrier([
    ["repository-readme", "Make the repository understandable", "repository.readme", 100, "Document purpose, installation, a working example and the support route."],
    ["repository-description", "Describe the repository's purpose", "repository.description", 80, "Write a precise public repository description."],
    ["repository-topics", "Make relevant discovery possible", "repository.topics", 70, "Assign topics that accurately describe the project's domain and capabilities."],
    ["repository-license", "State the reuse terms", "repository.license", 90, "Identify and document the authorized license; do not infer a license from availability."],
    ["repository-contributing", "Provide a contribution route", "repository.contributing", 75, "Explain how to report problems, propose changes and run relevant checks."],
  ].map(([id, title, predicate, priority, description]) => ({ id, title, subject, predicate,
    operator: "nonempty", priority, action: { kind: "improve", description },
    sourceUrls: ["https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions"] })));
}

function admittedRequirements(input, subject) {
  if (!Array.isArray(input) || input.length > MAX_REQUIREMENTS) throw new TypeError("requirements must be a bounded array");
  jsonValue(input);
  const ids = new Set();
  return input.map(raw => {
    only(raw, ["id", "title", "subject", "predicate", "operator", "expected", "priority", "action", "sourceUrls", "sourceContract"], "community requirement");
    const id = text(raw.id, "requirement id");
    if (ids.has(id) || raw.subject !== subject) throw new TypeError("requirements must have distinct identities for this subject");
    ids.add(id);
    text(raw.title, "requirement title"); text(raw.predicate, "requirement predicate");
    if (!["equals", "at-least", "includes", "nonempty"].includes(raw.operator)) throw new TypeError("requirement operator is not admitted");
    if (raw.operator !== "nonempty" && !own(raw, "expected")) throw new TypeError("requirement expected value is missing");
    if (raw.operator === "at-least" && !(typeof raw.expected === "number" && Number.isFinite(raw.expected))) throw new TypeError("at-least requires a finite numeric expectation");
    if (raw.operator === "nonempty" && own(raw, "expected")) throw new TypeError("nonempty has no expected operand");
    const priority = raw.priority ?? 50;
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) throw new TypeError("priority must be an integer from 0 to 100");
    only(raw.action, ["kind", "description"], "requirement action");
    text(raw.action.kind, "action kind", 80); text(raw.action.description, "action description", 2000);
    if (own(raw, "sourceContract")) {
      only(raw.sourceContract, ["kind", "path", "role"], "source contract");
      if (raw.sourceContract.kind !== "repository-file" || !["documentation", "runtime-schema", "source-code", "configuration"].includes(raw.sourceContract.role))
        throw new TypeError("source contract requires a declared repository-file role");
      text(raw.sourceContract.path, "source contract path");
    }
    const sourceUrls = raw.sourceUrls ?? [];
    if (!Array.isArray(sourceUrls) || sourceUrls.length > 32) throw new TypeError("requirement sources must be bounded");
    return retainedCarrier({ ...raw, priority, sourceUrls: [...new Set(sourceUrls.map(value => url(value, "requirement source")))].sort() });
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

function matches(value, requirement) {
  switch (requirement.operator) {
    case "equals": return coincides(value, requirement.expected);
    case "at-least": return typeof value === "number" ? value >= requirement.expected : null;
    case "includes": return Array.isArray(value) ? value.some(item => coincides(item, requirement.expected))
      : typeof value === "string" && typeof requirement.expected === "string" ? value.includes(requirement.expected) : null;
    case "nonempty": return value === null ? false : typeof value === "boolean" ? value
      : typeof value === "string" ? value.trim().length > 0 : Array.isArray(value) ? value.length > 0
      : record(value) ? Object.keys(value).length > 0 : null;
    default: throw new TypeError("unknown comparison");
  }
}
function candidate(subject, kind, target, description, priority, evidence, extra = {}) {
  const logical = { subject, kind, target };
  return { id: semanticId(logical), ...logical, description, priority, evidence: [...new Set(evidence)].sort(),
    ...extra, status: "candidate", effects: [] };
}
function sampleCandidates(evidence) {
  const candidates = [], now = Date.parse(evidence.observedAt), staleMs = 30 * 86400000;
  for (const entry of evidence.observations) {
    const row = entry.observation;
    if (row.status !== "observed" || row.stance === "against" || !Array.isArray(row.value)) continue;
    if (!["repository.open-issues-sample", "repository.open-pulls-sample", "repository.releases-sample"].includes(row.predicate)) continue;
    for (const item of row.value.slice(0, 100)) {
      if (!record(item) || typeof item.url !== "string") continue;
      let target;
      try { target = url(item.url, "sample item URL"); } catch { continue; }
      const sourceEvidence = [entry.sourceCellAddress];
      if (row.predicate === "repository.releases-sample") {
        let published;
        try { published = Date.parse(instant(item.publishedAt, "release publishedAt")); } catch { continue; }
        if (item.draft !== false || published > now) continue;
        candidates.push(candidate(evidence.subject, "prepare-release-announcement", target,
          "Prepare a source-linked release announcement through the existing publication owner.", 40, sourceEvidence,
          { coverage: row.source.coverage, publication: "not-performed" }));
      } else {
        let updated;
        try { updated = Date.parse(instant(item.updatedAt, "work updatedAt")); } catch { continue; }
        if (updated > now || now - updated < staleMs) continue;
        const issue = row.predicate === "repository.open-issues-sample";
        candidates.push(candidate(evidence.subject, issue ? "triage-issue" : "review-pull-request", target,
          issue ? "Review the unresolved issue and determine its next useful engineering action."
            : "Review the unchanged pull request against its current branch and requirements.",
          issue ? 65 : 85, sourceEvidence, { staleDays: Math.floor((now - updated) / 86400000), coverage: row.source.coverage }));
      }
    }
  }
  return unique(candidates).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

function assessmentIdentity(body) { return semanticId(body); }
function admittedAssessment(value) {
  if (!record(value) || value.kind !== "social.community-assessment.v1" || !Array.isArray(value.requirements) || !value.evidence?.batch)
    throw new TypeError("original community assessment required");
  const { id, ...body } = value;
  if (id !== assessmentIdentity(body)) throw new TypeError("community assessment differs from its canonical identity");
  return value;
}

/** Repeatable evidence settlement. Same-snapshot revisions join; a later snapshot is compared, never silently merged. */
export function assessCommunityRequirements({ batch, requirements, previous } = {}) {
  let admitted = admittedBatch(batch);
  if (previous !== undefined) {
    admittedAssessment(previous);
    if (previous.subject !== admitted.subject) throw new TypeError("previous assessment belongs to another subject");
    if (Date.parse(previous.observedAt) > Date.parse(admitted.observedAt)) throw new TypeError("assessment cannot move backwards in time");
    if (previous.observedAt === admitted.observedAt) admitted = admittedBatch({ ...admitted,
      observations: unique([...previous.evidence.batch.observations, ...admitted.observations]) });
  }
  const evidence = communityEvidence(admitted);
  const declarations = admittedRequirements(requirements ?? defaultForgeCommunityRequirements(evidence.subject), evidence.subject);
  const scope = { subject: evidence.subject, observedAt: evidence.observedAt }, requirementCells = [], records = [], recommendations = [];
  for (const requirement of declarations) {
    const definitionAddress = semanticId(requirement), forSide = [], againstSide = [], unknownEvidence = [];
    const rows = evidence.observations.filter(entry => entry.observation.predicate === requirement.predicate);
    for (const entry of rows) {
      const row = entry.observation;
      let result = row.status === "observed" ? matches(row.value, requirement) : null;
      if (row.stance === "against") result = requirement.operator === "equals" && result === true ? false : null;
      // An incomplete collection can witness existence or membership, but
      // cannot establish absence, exact equality, or a complete numeric total.
      if (!row.source.coverage.complete &&
          !(["nonempty", "includes"].includes(requirement.operator) && result === true && row.stance !== "against")) result = null;
      const witness = { observation: entry.id, sourceCellAddress: entry.sourceCellAddress, requirement: definitionAddress };
      if (result === true) forSide.push(witness);
      else if (result === false) againstSide.push(witness);
      else unknownEvidence.push(entry.sourceCellAddress);
    }
    const decision = cell(scope, "satisfies-community-requirement", definitionAddress, { for: forSide, against: againstSide });
    const reading = sectionReading([decision]).entries[0].reading;
    const definition = cell(requirement.id, "defines-community-requirement", requirement,
      { for: [{ sourceUrls: requirement.sourceUrls, standing: "caller-declared-requirement" }] });
    requirementCells.push(definition, decision);
    const sources = rows.map(entry => entry.sourceCellAddress).sort();
    const record = { id: requirement.id, definitionAddress, requirement, reading, cell: decision, cellAddress: address(decision),
      evidence: sources, unknownEvidence: [...new Set(unknownEvidence)].sort() };
    records.push(record);
    const kind = reading === "unknown" ? "observe" : reading === "contested" ? "reconcile" : reading === "denied" ? "improve" : "monitor";
    const description = reading === "unknown" ? `Obtain evidence for ${requirement.title}.`
      : reading === "contested" ? `Reconcile the conflicting source claims for ${requirement.title}.`
      : reading === "denied" ? requirement.action.description : `Continue observing ${requirement.title}.`;
    recommendations.push(candidate(evidence.subject, kind, requirement.id, description, requirement.priority, sources,
      { requirement: requirement.id, reading, proposedAction: requirement.action.kind, requirementCellAddress: address(decision) }));
  }
  const activities = sampleCandidates(evidence);
  const recommendationCells = [...recommendations, ...activities].map(item => cell(scope, "candidate-community-action", item,
    { for: item.evidence.map(sourceCellAddress => ({ sourceCellAddress })) }));
  const cells = cellSet([...evidence.cells, ...requirementCells, ...recommendationCells]);
  const body = retainedCarrier({ kind: "social.community-assessment.v1", subject: evidence.subject, observedAt: evidence.observedAt,
    evidence, requirements: records, recommendations: recommendations.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id)),
    activities, cells, cellSetAddress: cellSetAddress(cells),
    changes: previous === undefined ? null : comparisonRows(previous, { subject: evidence.subject, observedAt: evidence.observedAt, requirements: records }),
    sourceStanding: evidence.sourceStanding, effects: [] });
  return retainedCarrier({ id: assessmentIdentity(body), ...body });
}

function comparisonRows(previous, next) {
  if (previous.subject !== next.subject) throw new TypeError("cannot compare different community subjects");
  const before = new Map(previous.requirements.map(row => [row.id, row])), after = new Map(next.requirements.map(row => [row.id, row]));
  return [...new Set([...before.keys(), ...after.keys()])].sort().map(id => {
    const a = before.get(id), b = after.get(id);
    return { id, before: a?.reading ?? null, after: b?.reading ?? null,
      definitionChanged: Boolean(a && b && a.definitionAddress !== b.definitionAddress),
      evidenceChanged: !a || !b || !coincides(a.evidence, b.evidence),
      disposition: !a ? "introduced" : !b ? "retired" : a.definitionAddress !== b.definitionAddress ? "requirement-changed"
        : a.reading === b.reading ? "unchanged" : b.reading === "held" ? "supported-by-new-observation"
        : b.reading === "contested" ? "conflict-observed" : b.reading === "unknown" ? "evidence-unavailable" : "unmet-observed" };
  });
}

/** A source-backed change report, not a completed engineering task or attributed causal effect. */
export function compareCommunityAssessments(previous, next) {
  admittedAssessment(previous); admittedAssessment(next);
  if (Date.parse(next.observedAt) < Date.parse(previous.observedAt)) throw new TypeError("comparison cannot move backwards in time");
  return retainedCarrier({ kind: "social.community-assessment-comparison.v1", subject: next.subject,
    previous: previous.id, next: next.id, sameSnapshot: previous.observedAt === next.observedAt,
    changes: comparisonRows(previous, next), effects: [] });
}
