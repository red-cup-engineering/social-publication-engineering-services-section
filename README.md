# Social Publication Services Section

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
