# Corrected research should not become an evergreen social post

**Engineering and public-knowledge note — October 28, 2026.** Source-ready technical documentation, not an installed publishing service, approved research article, external publication, or achieved competitive benchmark.

A scientific explanation can remain useful after its statistics expire. A 2023 forecast can be historically informative without becoming a correct 2026 prediction. A retracted article can remain readable because its correction must remain visible. A scheduled social rendition does not inherit permanent editorial authority from the day it was drafted, and an evergreen repeat queue is not an editor.

The original 561 Group sequence is **source claims → evidence → accepted public edition → audience-specific rendition → scheduled intention → live source recheck → provider attempt → independent public readback → community outcome → correction and settlement**. This change closes one precise source-currentness seam; it does not manufacture the rest of the journey.

## Original source implementation

Red Cup's existing [Social Publication Engineering service](https://github.com/red-cup-engineering/social-publication-engineering-services-section) already has the account/rules/approval system, platform-native providers, ContentItem, Rendition, queue, `gateRendition` and `runDue`. No second scheduler, identity registry, social bot or Content Mill was built.

`renditionsFor` now carries the original `itemNi` and `sourceNi` into the deterministic rendition, with optional distinct, source-owned `claimRefs`. A source change may produce a different rendition identity. Old queue records without the exact source revision are held for reconstruction, not silently approved.

The new pure `qualifySocialSourceReadback` requires a trusted, fresh read result from the **original publisher** before a live effect. `runDue` invokes this read **after** the existing account, policy, rate, editorial and media gates, but **before** resolving account credentials or making a network request. A bad or unavailable source holds only that rendition; independent qualified accounts remain eligible.

A source reader must return:

`SocialSourceReadback`, version `1`, with exact `canonicalUrl`, `itemNi`, `sourceNi`, source-owned `publicationStatus`, `publiclyReadable: true`, exact-UTC `observedAt`, and an NI-addressed original `releaseRef`. For a rendition naming consequential claims, `claims: [{ref, disposition, evidenceRef}]` must contain a **distinct, current, evidence-linked** assessment of every referenced claim.

The pure gate permits only `active` or `stable`, never `potential`, `absurd` (retracted), unknown, withdrawn or replaced source states; exact edition and original canonical URL; an identified original release; a publisher observation no older than **15 minutes** and not from the future; and current evidence for every linked material claim. A mixed article with sound definitions but superseded statistics is therefore held until the statistics are requalified and a new version is editorially admitted. A claim described as historical, contested or withdrawn does **not** become current merely because it has high engagement.

For independently licensed fiction or other nonfactual media without `claimRefs`, the gate still requires original edition/source readback. It does not impose journalism's ClaimEvidence shape on all media. Conversely, when a nonfiction content producer supplies no `claimRefs`, this gives **edition-level only**, not claim-complete, assurance. The shared [temporal content requirement #24](https://github.com/red-cup-engineering/computer-content-engineering-services-section/issues/24) remains the owner of full per-claim and correction propagation.

## What a readback does not prove

An AI-generated receipt, yesterday's static queue, a social API ID or a manually set `published:true` flag is not trusted publisher evidence. The caller must furnish an independently configured, authorized **read-only** publisher capability, not a new publication grant. This module checks type, binding, temporal and claim completeness. It does **not** cryptographically authenticate the issuer, read an origin itself, decide scientific truth, attest media rights, or prove that anyone received the post.

The standalone `apps/syndicate.mjs due --live` command has no installed original-publisher readback capability. Consequently it now **holds** instead of sending live posts; normal dry-run plans remain available. The original CAIRN/TUFTE/release owner must supply a real readback adapter before the trusted live lane is usable. An accepted published edition and a separately independently verified reader outcome are still required.

The preexisting `runDue` journal status `posted` records a transport adapter's accepted return, **not independent AppView/reader observation**. This change has not silently redefined that historical field. News Property and Media Engineering's original deterministic-key/PDS-replay/public-readback components require qualified consumer convergence before an actual subscriber/reader outcome may be reported.

## Meet, then beat: a falsifiable comparator

| External vendor's described capability | Primary source | Group acceptance test |
| --- | --- | --- |
| SocialBee supports indefinite recycling of evergreen items | [SocialBee evergreen/requeue guidance](https://help.socialbee.com/hc/en-us/articles/29979169066391-Evergreen-Re-Queue-vs-Share-Once-What-s-the-Difference) | A correctly approved revisit is repeatable, but a superseded, retracted, licensed-out or contested source is held before transmission |
| Buffer separates per-channel publishing approvals from Community permissions | [Buffer permissions](https://support.buffer.com/en-us/articles/adding-users-and-setting-up-permissions-ixjiLpe2fd) | Actual two-account, two-authority rights isolation and independently observed no unauthorized post |
| Buffer connects scheduling with community replies and analytics | [Buffer feature guide](https://buffer.com/resources/buffer-features/) | Authored public source → published record → actual discussion → appropriate response and correction acceptance |
| Sprout Social emphasizes listening, audience care and adaptive operations | [Sprout August 2026 guide](https://sproutsocial.com/insights/social-media-management/) | Observed need → source-checked response → independently received beneficial outcome, including measured work/cost |

This is **a comparison of vendor-described features, not a head-to-head result**. The Group has no independent evidence of feature parity, a verified external publishing session, audience growth, customer relationships, conversion or revenue from this source change.

## Source qualification and next receiving

1. Recover the actual accepted canonical article/source and its immutable edition, source-owned release receipt, claim references and editorial authority; old feed titles or visitor metrics cannot substitute.
2. Bind a trusted, read-only CAIRN/TUFTE/customer publisher adapter to `readCurrentSource` that reads current release state and a fresh source revision without granting write privileges.
3. Run `npm run test:source-currentness`, `npm run check` and the original complete `npm test` with the actual pinned dependencies on independently qualified private CI. Pure tests and source-projection seam tests are narrower.
4. Verify a previously queued item becomes held after retraction or a source version change. A corrected item needs its own new authorized edition and truthful revision/correction announcement; never silently mutate yesterday's published claim.
5. Publish one real authorized platform post, then independently reread its public actor/record identity, content and source citation; distinguish accepted provider response, public visibility, actual reader receiving and meaningful participation.
6. Compare the whole resulting job with the commercial incumbents, including qualified posts, false and true holds, recovery after failure, rights, costs, accessibility, source provenance, and useful community outcomes.

Source merge is not a registry release. The installed publisher readback adapter, signature/authority custody, completed claim reviews, already-posted correction propagation, and external reader acceptance are independent work with their original owners.
