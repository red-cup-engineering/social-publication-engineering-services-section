import test from "node:test";
import assert from "node:assert/strict";
import { address, admitCell, cellSetAddress } from "@red-cup-engineering/signcraft/cell";
import { communityEvidence, assessCommunityRequirements, defaultForgeCommunityRequirements, compareCommunityAssessments } from "../src/community-evidence.mjs";

const subject = "urn:github:repository:123";
const at = "2026-10-27T00:00:00.000Z";
const source = (overrides = {}) => ({ url: "https://api.github.com/repos/example/project", observedAt: at,
  provider: "github", repositoryId: 123, repository: "example/project", visibility: "public",
  coverage: { complete: true, scope: "one-repository" }, ...overrides });
const observation = (predicate, value, overrides = {}) => ({ subject, predicate, value, status: "observed", source: source(), ...overrides });
const batch = (observations, observedAt = at) => ({ kind: "forge.community-observations.v1", subject, observedAt, observations, effects: [] });
const requirement = (overrides = {}) => ({ id: "description", title: "Repository description", subject,
  predicate: "repository.description", operator: "nonempty", priority: 70,
  action: { kind: "improve", description: "Describe the project." }, ...overrides });
const read = (observations, requirements = [requirement()], rest = {}) => assessCommunityRequirements({ batch: batch(observations), requirements, ...rest });

test("native Cells retain provenance and unavailable evidence never becomes a zero", () => {
  const input = batch([{ subject, predicate: "repository.stars", status: "unknown", reason: "permission-denied", source: source() }]);
  const evidence = communityEvidence(input);
  assert.equal(evidence.cells.length, 1);
  assert.equal(evidence.observations[0].claimCellAddress, null);
  assert.equal(evidence.observations[0].observation.reason, "permission-denied");
  for (const cell of evidence.cells) assert.equal(address(admitCell(cell)), address(cell));
  assert.equal(evidence.id, cellSetAddress(evidence.cells));
  assert.deepEqual(evidence.effects, []);
});

test("an absent known value opposes its requirement while unavailable data stays unknown", () => {
  assert.equal(read([observation("repository.description", "")]).requirements[0].reading, "denied");
  assert.equal(read([{ subject, predicate: "repository.description", status: "unknown", reason: "request-failed", source: source() }]).requirements[0].reading, "unknown");
  assert.equal(read([]).requirements[0].reading, "unknown");
});

test("duplicate and reordered source occurrences preserve canonical evidence and assessment identity", () => {
  const left = observation("repository.description", "A working project");
  const right = observation("repository.topics", ["mathematics"]);
  assert.equal(communityEvidence(batch([left, right])).id, communityEvidence(batch([right, left, left])).id);
  assert.equal(read([left, right]).id, read([right, left, left]).id);
});

test("conflicting sources remain contested with both witness lanes", () => {
  const result = read([observation("repository.description", ""), observation("repository.description", "Described", { source: source({ url: "https://api.github.com/repos/example/project?view=other" }) })]);
  assert.equal(result.requirements[0].reading, "contested");
  assert.equal(result.requirements[0].cell.for.length, 1);
  assert.equal(result.requirements[0].cell.against.length, 1);
  assert.equal(result.recommendations[0].kind, "reconcile");
});

test("empty partial samples do not establish absence but an observed member can establish existence", () => {
  const partial = source({ coverage: { complete: false, scope: "first-page", reason: "page-budget" } });
  const rule = requirement({ predicate: "repository.topics" });
  assert.equal(read([observation("repository.topics", [], { source: partial })], [rule]).requirements[0].reading, "unknown");
  assert.equal(read([observation("repository.topics", ["math"], { source: partial })], [rule]).requirements[0].reading, "held");
  const exact = requirement({ operator: "equals", expected: [], predicate: "repository.topics" });
  assert.equal(read([observation("repository.topics", [], { source: partial })], [exact]).requirements[0].reading, "unknown");
});

test("partial numeric observations cannot masquerade as complete totals", () => {
  const partial = source({ coverage: { complete: false, scope: "sample" } });
  const rule = requirement({ predicate: "repository.stars", operator: "at-least", expected: 10 });
  assert.equal(read([observation("repository.stars", 20, { source: partial })], [rule]).requirements[0].reading, "unknown");
  assert.equal(read([observation("repository.stars", 20)], [rule]).requirements[0].reading, "held");
});

test("denying an exact number does not prove another inequality", () => {
  const value = observation("repository.stars", 10, { stance: "against" });
  assert.equal(read([value], [requirement({ predicate: "repository.stars", operator: "at-least", expected: 20 })]).requirements[0].reading, "unknown");
  assert.equal(read([value], [requirement({ predicate: "repository.stars", operator: "equals", expected: 10 })]).requirements[0].reading, "denied");
});

test("same-snapshot continuation joins witnesses rather than overwriting contradictory evidence", () => {
  const previous = read([observation("repository.description", "")]);
  const next = read([observation("repository.description", "Now described")], [requirement()], { previous });
  assert.equal(next.requirements[0].reading, "contested");
  assert.equal(previous.requirements[0].reading, "denied");
  assert.equal(next.changes[0].disposition, "conflict-observed");
});

test("later observations provide a transition without manufacturing a same-snapshot contradiction", () => {
  const previous = read([observation("repository.description", "")]);
  const later = "2026-10-28T00:00:00.000Z";
  const next = assessCommunityRequirements({ batch: batch([observation("repository.description", "Description", { source: source({ observedAt: later }) })], later), requirements: [requirement()], previous });
  assert.equal(next.requirements[0].reading, "held");
  assert.equal(compareCommunityAssessments(previous, next).changes[0].disposition, "supported-by-new-observation");
  assert.equal(next.requirements[0].cell.against.length, 0);
  assert.notEqual(next.requirements[0].cellAddress, previous.requirements[0].cellAddress);
});

test("a changed requirement is reported separately from observed improvement", () => {
  const rows = [observation("repository.stars", 10)];
  const previous = read(rows, [requirement({ predicate: "repository.stars", operator: "at-least", expected: 20 })]);
  const next = read(rows, [requirement({ predicate: "repository.stars", operator: "at-least", expected: 5 })]);
  assert.equal(compareCommunityAssessments(previous, next).changes[0].disposition, "requirement-changed");
});

test("sampled stale work and release observations form bounded candidates without claiming complete inventory", () => {
  const partial = source({ coverage: { complete: false, scope: "first-page" } });
  const observations = [
    observation("repository.open-issues-sample", [{ id: 4, url: "https://github.com/example/project/issues/4", updatedAt: "2026-08-01T00:00:00.000Z" }], { source: partial }),
    observation("repository.open-pulls-sample", [{ id: 5, url: "https://github.com/example/project/pull/5", updatedAt: "2026-08-01T00:00:00.000Z", draft: false }], { source: partial }),
    observation("repository.releases-sample", [{ id: 6, url: "https://github.com/example/project/releases/tag/v1", draft: false, publishedAt: "2026-10-26T00:00:00.000Z" }, { id: 7, url: "https://github.com/example/project/releases/tag/private", draft: true }], { source: partial }),
  ];
  const result = read(observations, []);
  assert.deepEqual(result.activities.map(x => x.kind), ["review-pull-request", "triage-issue", "prepare-release-announcement"]);
  assert.equal(result.activities.every(x => x.coverage.complete === false && x.effects.length === 0), true);
  assert.equal(result.activities.find(x => x.kind === "prepare-release-announcement").publication, "not-performed");
});

test("release preparation needs affirmative public state and a past publication instant", () => {
  const cases = [
    { url: "https://github.com/example/project/releases/tag/unknown" },
    { url: "https://github.com/example/project/releases/tag/no-date", draft: false },
    { url: "https://github.com/example/project/releases/tag/no-state", publishedAt: at },
    { url: "https://github.com/example/project/releases/tag/future", draft: false, publishedAt: "2027-01-01T00:00:00.000Z" },
    { url: "https://github.com/example/project/releases/tag/draft", draft: true, publishedAt: at },
  ];
  assert.deepEqual(read([observation("repository.releases-sample", cases)], []).activities, []);
});

test("all fields and cached page provenance survive native immutable source retention", () => {
  const raw = observation("repository.topics", ["math"], { source: source({ pages: [{ url: "https://api.github.com/repos/example/project/topics", observedAt: at, validatedAt: at }] }) });
  const result = communityEvidence(batch([raw]));
  raw.value.push("forged-after-admission");
  raw.source.pages[0].url = "https://example.com/changed";
  assert.deepEqual(result.observations[0].observation.value, ["math"]);
  assert.equal(result.observations[0].observation.source.pages[0].url, "https://api.github.com/repos/example/project/topics");
  assert.throws(() => result.observations[0].observation.value.push("mutation"), TypeError);
});

test("malformed identities, values, effects and chronology refuse at the boundary", () => {
  assert.throws(() => communityEvidence(batch([observation("repository.stars", Infinity)])), TypeError);
  assert.throws(() => communityEvidence({ ...batch([]), effects: [{ method: "POST" }] }), TypeError);
  assert.throws(() => communityEvidence(batch([observation("repository.stars", 1, { status: "unknown", reason: "absent" })])), TypeError);
  assert.throws(() => communityEvidence(batch([observation("repository.stars", 1, { subject: "other" })])), TypeError);
  assert.throws(() => communityEvidence(batch([observation("repository.stars", 1, { source: source({ observedAt: "2027-01-01T00:00:00Z" }) })])), TypeError);
  assert.throws(() => read([], [requirement(), requirement()]), TypeError);
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => communityEvidence(batch([observation("repository.unknown", cycle)])), TypeError);
});

test("changing a received assessment without changing its canonical content refuses comparison", () => {
  const result = read([]);
  const forged = structuredClone(result); forged.requirements[0].reading = "held";
  assert.throws(() => compareCommunityAssessments(result, forged), /canonical identity/u);
});

test("cached source timestamps retain observation age without permitting time reversal", () => {
  const observedAt = "2026-10-26T00:00:00.000Z";
  const value = observation("repository.description", "A cached description", { source: source({ observedAt, validatedAt: at }) });
  const result = communityEvidence(batch([value]));
  assert.equal(result.observations[0].observation.source.observedAt, observedAt);
  assert.equal(result.observations[0].observation.source.validatedAt, at);
  value.source.validatedAt = "2026-10-25T00:00:00.000Z";
  assert.throws(() => communityEvidence(batch([value])), /cache validation/u);
});

test("untrusted JavaScript accessors refuse without invoking them", () => {
  let invoked = false;
  const value = {};
  Object.defineProperty(value, "secret", { enumerable: true, get() { invoked = true; return "effect"; } });
  assert.throws(() => communityEvidence(batch([observation("repository.metadata", value)])), /accessor/u);
  assert.equal(invoked, false);
});

test("the reusable default profile asks for discoverability and contribution conditions", () => {
  const profiles = defaultForgeCommunityRequirements(subject);
  assert.deepEqual(profiles.map(x => x.predicate).sort(), ["repository.contributing", "repository.description", "repository.license", "repository.readme", "repository.topics"]);
  assert.equal(profiles.every(x => !x.predicate.includes("stars") && !x.predicate.includes("followers")), true);
  assert.equal(read([], profiles).recommendations.every(x => x.kind === "observe"), true);
});
