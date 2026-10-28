# Social publication: exact public readback and competitive assays

**Status:** Original source merged on 2026-10-28 by [PR #9](https://github.com/red-cup-engineering/social-publication-engineering-services-section/pull/9), merge commit `2891af977c29f9d1fd3cd805c9e069162e8928a7`. The public-source native verification passed 96 cases; original private SignCraft-dependent package qualification, registry publication, installed consumer, account permission, live public readback and audience outcomes have not been received.

## Existing owners, not another social platform

The publisher owns research/evidence qualification, accepted editorial decisions, edition identity, public URL, correction state and credentials. Red Cup's existing `social-publication-services-section` owns credential-blind platform transports and the shared source-checked `runDue` schedule. The original Causeway / 561 Group publisher and Marketing offices own audience rights, public accounts, adoption and measurement. This addition uses those roles rather than introducing another newsroom, state ledger, marketing office or universal content ontology.

Original work and source:
- [Group media-to-publication feedback loop](https://github.com/561-group/bare-cedar-fog/issues/260)
- [Original scientific-publication handoffs, L-Space and consent](https://github.com/561-group/bare-cedar-fog/issues/255)
- [Original source-currentness and correction-safe social queue](https://github.com/red-cup-engineering/social-publication-engineering-services-section/pull/8)
- [Original existing social syndication and brand sources](https://github.com/red-cup-engineering/social-publication-engineering-services-section/pull/7)

## Exact observation contract: one Bluesky record

The existing Bluesky transport calls `com.atproto.repo.createRecord` using a customer-supplied attenuated authorization capability. Its result includes the AT URI and the immutable record CID. The original adapter had discarded the CID; successful `runDue` journals therefore could not independently compare the provider's exact version with a public reading.

The original adapter now returns the CID, the exact outgoing intent NI and a content-addressed SocialPublicationReceipt whose responseDigest binds **both** the AT URI and CID. The existing runDue posted journal retains all those along with original source/release context. The read-only syndicate readback command requires the exact original account, rendition and transport receipt NI, refuses legacy/ambiguous/changed inputs before fetching, then appends a distinct public-readback observation to that same original journal. Identical observations are idempotent and later observations preserve earlier evidence. The pure API exposes admitBlueskyJournalPost, readBlueskyJournalPost, admitBlueskyPostExpectation and readBlueskyPostReceipt through the existing module / ./bluesky-post-readback export. No new publishing client, account registry, scheduler, editorial authority or credential store is created.

A readback:
1. Requires the original posted journal, account and rendition, including source content hash and release NI, and the exact SHA-256 NI-addressed SocialPublicationIntent and SocialPublicationReceipt. The provider response digest binds both AT URI and CID. Nothing is reconstructed from guessed external URLs or an old legacy log. The caller must identify an actual independently authorized original publication; this module cannot authenticate the issuer.
2. Uses the unauthenticated [Bluesky public AppView](https://docs.bsky.app/docs/api/app-bsky-feed-get-author-feed) `app.bsky.feed.getPosts` with one exact URI, a nonredirecting GET, 8-second timeout and 128 KiB total response cap. It does not send tokens or perform a write.
3. Compares the observed post URI, author DID, CID, literal post text and exact canonical source URL in the external card or visible text.
4. Returns one bounded immutable observation with status: `public-record-match`, `not-observed`, `identity-conflict`, `revision-conflict`, `content-conflict`, `source-link-missing` or `unavailable`. None sets `verifiedCompletion` true.

A missing public AppView record is **not** evidence of deletion, suppression, or zero readership. A matching AppView is **not** cryptographic PDS confirmation, federation to subscribers, authority to publish, fact checking, rights acceptance, human reading, qualified traffic or economic benefit. A network failure remains unavailable rather than fabricating success. The existing readback CLI appends the dated observation to the original journal instead of creating a second publication registry. Its public observer does not constitute a second canonical publication authority.

The authentic GitHub Actions public-source run [#40741598430](https://github.com/red-cup-engineering/social-publication-engineering-services-section/actions/runs/40741598430) at its exact tested head passed **96 tests, zero failures/skips**. Native tests refuse mismatched NI, changed source, account, rendition, wrong DID or CID, altered text, missing canonical URL, oversize/malformed/HTTP-error responses, ambiguous timestamps, deleted original transport receipts, and duplicate journal entries. They exercise the original adapter to source-addressed transport receipt, public record readback, and append-only idempotent observation. This is **source-only verification**: the authentic private SignCraft-dependent suite, installed package, account permission and real authorized source+platform session have not been received.

## Meet, then beat — externally described baseline vs our acceptance tests

These are **vendor-described capabilities**, not an independent head-to-head result or proof of 561 Group feature parity.

| Baseline | Observable current vendor capability | Required 561 Group independent assay | Status here |
| --- | --- | --- | --- |
| [WriteFreely](https://writefreely.org/docs/main/writer/federation) | ActivityPub followable blogs; [RSS](https://writefreely.org/docs/main/writer/following) | Signed/rights-admitted original article → accessible live canonical page and valid RSS/Atom/ActivityPub representation → two distinct external readers actually retrieve the correct edition | Not tested or delivered here |
| [Buffer](https://support.buffer.com/articles/supported-channels-LM3P7Y4zsp) | Multi-channel publishing, with per-channel basic/advanced analytics and community features varying by platform | One accepted source → two distinct account-authorized platform renditions → independently observed remote records → reconciled analytics with exact origin/campaign and no invented impressions | Only Bluesky exact single-record readback is built |
| [SocialBee](https://help.socialbee.com/hc/en-us/articles/29979169066391-Evergreen-Re-Queue-vs-Share-Once-What-s-the-Difference) | Indefinite evergreen re-queue and share-once workflows | A still-current evergreen source may re-queue; a superseded, retracted or time-expired claim must hold before next send, and previously posted copies must receive transparent correction state | Original source-currentness hold implemented in #8; correction fan-out not proven |
| [Bluesky AT Protocol](https://docs.bsky.app/docs/api/app-bsky-feed-get-author-feed) | Unauthenticated public AppView reads of individual social records | Exact accepted post URI, DID, CID, text and original source link all match an independent public observation; record changes or missing readings must be explicit | Source + synthetic tests; no authorized live effect |

A passing test of code is weaker than a platform-observed outcome; a platform-observed post is weaker than a measured benefit to a real reader. No reach/impact ranking should be computed from fabricated or unavailable observations.

## Next receiving, in existing owners

**P0 — qualify and receive this source.** Exact-commit public-source `npm run check` and `npm run test:public-source` have passed. Still run authentic original `npm run verify` with pinned SignCraft 0.6.2 on an authorized independent runner, not a substitute dependency. The original source review and merge were completed in PR #9; qualified installed package receiving remains open. The private SignCraft closure or CI billing can hold full verification without redefining a green public-source build as a released package. Independently read back exact merged commit, package version and installed consumer before claiming deployment.

**P1 — original publisher actually publishes.** Source publisher supplies exact signed/custodied editorial authority, up-to-date `readCurrentSource`, canonical HTTPS page and accepted post intent. Credentials remain at the original account. Perform a sandbox-approved real publishing session and read back exact public Bluesky record through the new operation, preserving both timestamps and results.

**P2 — publication is observable beyond one network.** Receive original Mastodon/ActivityPub publisher and external reader instead of claiming that a `fediverse` campaign candidate is an installed adapter. Add alternate readers or PDS CID proof separately; compare three independent observations before any claims of multi-network distribution. No pay-to-use API channel should be made active without budget and current terms authority.

**P3 — correct what is already out.** An original source revision or withdrawal must find affected renditions and append transparent correction, link update or withdrawal *according to each platform's supported semantics*, retaining original and amended records. Recheck source status at send time, as the already merged source-currentness gate does; no silent deletion or erased history.

**P4 — qualify value and beat peers.** Ingest real timestamped per-platform, per-post measurements and owner analytics where authorized; separate observed public record, impressions, click-throughs, actual useful reading/reuse, citations and revenue. A comparative claim requires a reproducible assay on matching platform features, rights, cost, reliability, accessibility, time and independent reviewers. Adaptations must preserve claim/evidence lineage, licensed media, accessibility and truthful uncertainty.

## Source qualification

Source references verified against existing first-party project files and public product/protocol documentation on 2026-10-28. Live provider permissions, platform limits, competitor functionality, pricing, policy, actual publishing state, account availability and audience measurements must be re-observed at their effect boundary; a reference page does not authorize transport. Source code here is MIT-licensed in the original engineering repository; original posts and underlying research keep their own separately declared rights.
