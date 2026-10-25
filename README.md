# Social Publication Services Section

<!-- 561-group-standards:badges:start -->
[![Red Cup Engineering](https://img.shields.io/badge/561%20Group-Red%20Cup%20Engineering-c0392b)](https://github.com/red-cup-engineering)
[![License: MIT](https://img.shields.io/badge/license-MIT-c0392b)](LICENSE)
[![Indigenous data: CARE](https://img.shields.io/badge/Indigenous%20data-CARE-4b6f44)](https://github.com/red-cup-engineering/.github/blob/main/GOVERNANCE.md)
[![Tips welcome](https://img.shields.io/badge/tips-welcome-d4a017)](https://github.com/561-group/.github/blob/main/TIPS.md)
<!-- 561-group-standards:badges:end -->

Reusable outbound social-publication mechanics for Red Cup Engineering customers.

This section is deliberately **credential-blind** and **editorially blind**:

- customers decide whether a publication is authorized;
- customers retain credentials and supply an attenuated `authorizedFetch` capability;
- the provider constructs and validates protocol/API operations but never invents editorial warrant;
- publication intents and receipts are deterministic `ni:///sha-256;...` resources;
- external responses are bounded and checked before a receipt can be formed.

## Current adapters

### Bluesky / AT Protocol

- public handle resolution through `com.atproto.identity.resolveHandle`;
- bounded image blob upload through `com.atproto.repo.uploadBlob`;
- `app.bsky.feed.post` record construction, including optional external cards;
- current lexicon enforcement: 300 graphemes, 3000 bytes, and at most three languages;
- exact repository publication through `com.atproto.repo.createRecord`.

The service does not log in with a password or own an app password. Authentication belongs to the customer capability.

### Facebook Pages

- exact Page observation;
- Page feed publication with text and optional canonical link;
- explicit Graph API version supplied by the customer rather than frozen into Red Cup code.

The service does not own or request Page tokens. The customer capability adds authorization.

### LinkedIn

- current `/rest/posts` organic publication shape;
- organization or member author URNs;
- explicit `Linkedin-Version` supplied by the customer;
- required Rest.li protocol header;
- exact post URN receipt from `x-restli-id`;
- article projection from the customer's canonical publication intent.

The service does not own LinkedIn access tokens or organization roles. Authorization remains a customer capability.

## Customer pattern

A publication such as Koios.News should own its identity, editorial decision, canonical URL, copy, and assets. It sends an admitted `SocialPublicationIntent` to this service. A platform adapter performs only the authorized transport operation and returns external evidence that the customer can bind into a `SocialPublicationReceipt`.

This keeps platform churn in Red Cup Engineering while publication policy stays with the consuming organization.

## Source-qualified audience and patronage opportunities

The added `src/audience-routes.mjs` is a **pure source-reader**, not a CRM, lead scraper or second posting engine. It reads the corporate Marketing owner's source-qualified public projects and openly documented outside grant/sponsor/community routes, checks topic relevance, observed-on freshness and deadlines, and returns exactly one of `review-for-application`, `verify-eligibility`, `investigate`, `recheck`, `unmatched` or `closed`.

It does **not** infer wealth, person-level interest, grant eligibility, a right to message, a submitted application, or revenue. It cannot change rights or trigger transport. Any actual publish still requires the existing `SocialPublicationIntent` and authorized platform adapter; the existing Coesite marketing Work/consent and original corporate owner select what to commission.

Call `node apps/audience-brief.mjs /path/to/corporate-source.json --markdown` to generate a source-linked review agenda; use `--json` for machine-readable routing. A typical input object has `asOf`, `work:[{id,publicUrl,topics}]`, and `routes:[{id,name,kind,status,checkedOn,sourceUrl,entryUrl,topics,note,nextAction,deadline?}]`. The tool reads files only; it never sends mail or contacts a prospect. Node native tests cover an eligible live route, conditional restriction, stale/closed/refusal, duplicate identities and unsafe source URLs. The first consuming 561 Group campaign source belongs with the original corporate Marketing office, not this generic provider.

## Editorial campaigns through original publisher adapters

`src/campaign-intents.mjs` composes the **existing** `publicationIntent` and `blueskyPostRecord` suppliers rather than making a second platform API client. It reads a commissioned source file with `campaignId`, exact `asOf` ISO instant and bounded `items` (`id`, `channel`, `proofUrl`, `canonicalUrl`, `title`, `description`, `text`). It produces a source-addressed intent for each differentiated story and a bounded Bluesky link-card preview for that adapter. Accepted channels are `bluesky`, `linkedin`, `facebook-page`, and `fediverse`; **Fediverse is an editorial candidate, not a claimed installed provider adapter**.

`node apps/compile-campaign-intents.mjs SOURCE.json --json` produces typed candidates, or `--markdown` a reviewer-friendly pack. Publishing still belongs to the customer account through `publishBlueskyPost`, `publishFacebookPagePost`, `publishLinkedInPost`, or a separately installed native Fediverse publisher, and requires its actual editorial and transport permission. The Group corporate Marketing consumer remains downstream. Tests exercise provenance, duplicate, invalid and overlong content refusals, and deterministic native intent construction.


## Syndication engine (`@.../social-publication-services-section/syndication`)

One pipeline for many brands on many platforms: a ContentItem becomes per-account Renditions, a gated per-account schedule, a publish cycle (dry run unless live and owner-approved), and measurement that feeds allocation. Pure and deterministic except the publish step; the section stays credential-blind and editorially blind: accounts hold credential *references*, copy comes from a voice hook.

```
ContentItem --renditionsFor--> Rendition --gateRendition--> planSchedule --> runDue --> journal --> summarize --> multipliers
   (feeds, YouTube                 ^            ^                  per-account queues, limits         |
    inventories, Notebook)         |            |                                                    v
                         PlatformRuleSet   voiceCheck + manifests                    Notebook allocator, next schedule
```

Interfaces other owners maintain (all JSON; examples in `content/` and `test/`):

- **AccountRegistry** `{type, version, accounts:[{id, brand, platform, handle, kind, automation:{botDisclosed}, credentialRef:{scheme,name}, timezone, state: planned|active|held|suspended, hold?, approval:{firstPostApprovedAt, approvedBy}, cadence?:{targetPerDay}, limits?, sections}]}`. A credential value or secret-bearing field anywhere in it is refused.
- **PlatformRuleSet** `{type, version, status: seed-unverified|verified, rules:{[platform]: {text, hashtags, media, automation:{mode}, aiDisclosure:{required, offered, mechanism, apiField, textLabel}, limits, windows, duplicates, linkBack, cadence?}}}`. `content/platform-rules.seed.json` is a conservative seed, not verified terms. No rule, no post.
- **ContentItem** `{id: ni, brand, section, kind, title, summary, canonicalUrl, source:{ni}, priority, tags, media:[{ni, mediaType, aiGenerated, alt, ...}], linkedWorkAiGenerated?}`. Adapters: `itemsFromFeed`, `itemsFromYouTubeInventory`.
- **Voice check** `(rendition) => {pass, notes}` and **copy hook** `(item, platform, defaults) => string | {text, title}`; defaults are a plain template (`copyOrigin: template`) and a small lint.
- **ProvenanceManifest** (`provenance.mjs`): `561-provenance/1`, C2PA-shaped ingredient and action assertions, the AI-content disclosure, a verification URL, an Ed25519 signature slot. `signManifest` and `verifyManifest` are the reference implementations.
- **MetricReading** `{accountId, platform, section, kind, renditionId?, externalId?, at, views?, likes?, replies?, shares?, clicks?, followersDelta?}`.

Compositor (`compositor.mjs`): crop, scale, pad, cover Google's visible logo where declared, place our lockup, caption, transcode -- as data, renderable to SVG or ffmpeg arguments. It refuses to strip, alter or defeat SynthID, C2PA or metadata, and refuses any step off its allow-list. The unmodified original is archived by content address and named as the derivative's ingredient.

Operator CLI: `node apps/syndicate.mjs plan|due|feedback|verify` (see the file header). `due` never posts without `--live`, an adapter that declares itself live, and the account's recorded first-post approval.

## Brand-presence inputs (`feat/brand-presence-inputs-20261024`)

The brand/account thread's inputs to the syndication engine, in the interfaces above. None of this posts, signs up or holds a credential.

- **Verified platform rules** (`content/platform-rules.verified.json`, a `PlatformRuleSet` with `status: partially-verified`). Thirteen platforms re-read from primary pages on 2026-10-24. Each rule names its dated terms record (`x-evidence.record`, in 561-group-services-section `data/records/platform-terms-records/`) and marks each field verified, partial, unverified, not-stated or own-policy. `mergeRuleSets(seed, verified)` keeps the seed for platforms not yet re-read (Facebook Page, Discord, newsletter, website, Hive). `admitPlatformRuleSet` accepts the new status. Changes from the seed: Hacker News is `prohibited` (automation and generated text are both barred); LinkedIn, Threads, Instagram and Substack are `manual-only` until an API application or review is approved or a posting API exists; X is `manual-only` because its API is pay-per-use ($0.20 for every post that carries a URL) and the Group requires zero cash spend (the Automated label is mandatory if that ever changes); DEV's AI disclosure is the `#ABotWroteThis` tag and AI-assisted articles may not promote a business.
- **Rule evidence** (`src/syndication/rules-evidence.mjs`). `checkEvidence` refuses a rule whose record is missing, dated differently, older than 90 days, contradicts it on automation, or whose text limit differs from a verified platform limit. `driftCheck` re-fetches a record's pages and compares hashes.
- **Editorial gate** (`src/syndication/editorial.mjs`, `content/editorial/phrases.json`). `createVoiceCheck(...)` returns the `(rendition) => {pass, notes}` hook that `gateRendition` takes; `editorialReport` returns the structured result. Checks: length (platform and brand), readability, banned phrases (PTGAE tonal poison, hype, unverifiable claims, engagement bait, stock AI phrases), style, claim-has-source (every checkable sentence is covered by a declared claim with an https source and a PTGAE status, numbers included), claim status shown, links, alt text, AI disclosure, provenance link. It is a phrase-and-structure check; it does not read for meaning.
- **Post provenance** (`src/syndication/post-provenance.mjs`). `buildPostManifest` makes the same `561-provenance/1` manifest for a text post (subject is the address of the words without their last line; a `post` section holds source and commit, tools and models, human review, claims, gate report digest, disclosure decision for private sources, media credentials plan). `signPostManifest` and `verifyPostManifest` reuse `signManifest` and `verifyManifest`. A post ends with `Provenance: https://561.group/v/<12 characters>`. Media plans chain onto the maker's C2PA manifest with `--parent` and are marked `unsigned-design`.
- **Handle probes** (`src/syndication/handles.mjs`). Read-only, four results: `taken`, `free-looking`, `unknown`, `not-probed`.
- **CLI** (`apps/brand-presence.mjs`): `gate`, `finalize`, `links`, `provenance`, `verify`, `handle`, `rules`, `drift`, `keygen --test-only`. Exit 3 is a refusal.

`ContentItem` is extended with optional `claims`, `sources`, `ai` and `authoring` (a `PostCandidateSet` in the CLI header). The extension does not change `renditionsFor`.
