# Community observations as native Cells

`@red-cup-engineering/social-publication-services-section/community-evidence`
is the pure interpretation boundary shared by software forges and social
platforms. GitHub is one observation provider. The existing publication adapters
continue to own transport; this module reads no clock, fetches no URL, creates no
account and publishes no post.

## Source and requirement contracts

The Draft 2020-12 schemas in `schemas/` describe the transport documents. The
interpreter enforces finite JSON, bounded input, source chronology, distinct
requirement identities and native SignCell admission in addition to the schema's
declarative shape. Format annotations alone are not a validation or authenticity
claim. Each observation has a source URL, observation time, provider and explicit
coverage. Page provenance retains original observation and later cache-validation
times. Repository visibility is retained when supplied.

```js
import {
  communityEvidence, assessCommunityRequirements,
  defaultForgeCommunityRequirements, compareCommunityAssessments,
} from '@red-cup-engineering/social-publication-services-section/community-evidence';

const evidence = communityEvidence(batch);
const assessment = assessCommunityRequirements({
  batch,
  requirements: defaultForgeCommunityRequirements(batch.subject),
});
const next = assessCommunityRequirements({ batch: nextBatch, previous: assessment });
const change = compareCommunityAssessments(assessment, next);
```

`batch` is `forge.community-observations.v1` with `subject`, `observedAt`,
`observations`, and an empty `effects` array. An observation contains `subject`,
`predicate`, `status`, `source`, and, when observed, `value`. Unknown observations
require a reason and assert no value. Source coverage is `{complete, scope,
reason?}`. An optional `stance: 'against'` denies that exact observed value.

Every source occurrence is a native Cell. Known claims, requirement definitions,
requirement evaluations and candidate actions are also native Cells produced
through the original `@red-cup-engineering/signcraft/cell` export. SignCell's
canonical CBOR/NI identity, evidence union, immutable carrier retention and FOUR
section reading supply the data semantics. There is no second hash codec or
parallel evidence journal in this interpreter.

Atomic requirements name a source predicate and one operation: `equals`,
`at-least`, `includes`, or `nonempty`. They retain a stable id, title, subject,
priority, proposed action and optional source URLs. The result has the original
FOUR readings: `held`, `denied`, `contested`, or `unknown`. These mean what the
supplied evidence supports, opposes, supports and opposes, or does not establish.
They do not independently authenticate a source or prove that the world has
changed.

An empty incomplete collection cannot establish absence. A member of a partial
collection can establish membership or nonemptiness; partial equality and
numeric totals remain unknown. Denying `count = 10` does not establish `count >=
20`. Missing permission, a failed endpoint and unknown license data remain
unknown rather than becoming false, zero, or an invented license.

## Repeated observation and practical candidates

The snapshot instant scopes the property claim. Two incompatible tellings
within one snapshot retain both sources and can make a requirement contested.
Passing `previous` for that same snapshot joins its source occurrences. A later
snapshot creates a separate evaluation and a change report; ordinary count or
metadata changes over time are not automatically contradictions. Changes in the
requirement itself are reported separately from improvement in observations.

The default profile reads README, description, topics, license and contributing
conditions. Callers may supply market-derived requirements using the same
contract. No star-count target is a default success condition.

The existing GitHub vocabulary for sampled open issues, pull requests and
releases also produces bounded candidates. A work item unchanged for at least
30 days yields a review candidate, and an affirmatively non-draft release with a
publication timestamp at or before the snapshot yields an announcement
preparation candidate. Each candidate retains the original source evidence and
coverage; a sampled page never claims to be a complete estate inventory. The
logical candidate id survives later observation snapshots, allowing the owning
work service to deduplicate admission. Candidates do not create issues, send
messages, merge changes or grant publication authority.

## Acceptance and limits

Verification covers unknown versus denied data, canonical replay under source
permutation, opposing evidence, incomplete coverage, later observations,
requirement changes, malformed data, immutable provenance and sampled work
candidates using the authentic SignCraft supplier. It does not claim live
provider authorization, automatic repair, customer acquisition, economic
settlement or superiority to a competitor. The operating consumer must bind
these candidates to its existing Work and authorized repair/publishing owners,
then observe the next snapshot to determine the result.

This finite evidence join is an explicit use of native Cell semantics. It does
not claim that a JSON field, a source URL or a candidate task is itself a sheaf,
topological face, Heyting proof or independently accepted service.
