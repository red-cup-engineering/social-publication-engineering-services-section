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
