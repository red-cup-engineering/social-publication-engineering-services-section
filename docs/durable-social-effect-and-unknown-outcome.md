# An ambiguous social API result is not permission to publish again

**Source engineering, 2026-10-28.** This documents the original social-publication source and native tests, not an installed release, an authorized real social post, a provider reply or verified audience delivery.

## The observed failure

The original `runDue` treated a provider 5xx/network exception after `adapter.publish` as a retry. The original `syndicate due` wrote its journal only after `runDue` returned. A platform can accept a post, lose the response and leave the client convinced it failed. A process can die before the resulting journal append. Consequently a retry could create an unintended duplicate, defeating the exact intent/transport/public observation chain established in [PR #9](https://github.com/red-cup-engineering/social-publication-engineering-services-section/pull/9).

This defect does **not** justify a second scheduler, cross-platform transport abstraction, state registry or fake publisher receipt.

## The original repaired boundary

The original `./syndication` module now computes a `SocialPublicationEffectAttempt` with one NI address from exact account, platform, rendition NI, content hash, source-edition NI, independently received release NI and scheduled slot. A new slot is a distinct deliberate attempt, never an implicit retry of yesterday's transport.

The existing `runDue` requires two independent capabilities for live effects: a fresh trusted publisher `readCurrentSource` and host-supplied **atomic durable** `reserveEffect`. It invokes the latter only after the original account, policy, voice, source, media, schedule and credential gates. The adapter may post **only** once the original effect has been uniquely reserved. A missing or refused reserve holds the attempt without a remote effect.

The original file-backed port, `reserveSocialEffectInJournal(originalJournalPath)`, is appropriate for **one local authoritative filesystem**: an exclusive adjacent lock guards an up-to-date journal read, a duplicate/unresolved-attempt check, and a synchronous, fsynced `effect-reserved` line in that same original JSONL journal. There is no duplicate database. The lock is removed only after the reservation is safely recorded. A process killed while holding it leaves the lock intact, deliberately blocking new effects. Do not auto-expire or delete a lock because it looks old.

A multi-machine service **must not** copy this JSONL file between nodes as if that were an atomic distributed journal. It must supply an equivalent durable reserve-if-unused source in the original installed operational owner. The abstract callback is a **host promise**, not proof that an arbitrary caller persisted anything.

After reservation, any exception from the adapter, including an API 429/4xx/5xx or network failure, yields an `outcome-unknown` journal result and never schedules an automatic retry of that effect. A provider 401/403 also holds the account. Successful adapter receipts remain separate `posted` journal rows, and their independent public AppView observations remain separate `public-readback` rows. None of these asserts human readership, search indexing, scientific acceptance or payments.

## Operator receiving of an ambiguous attempt

1. **Freeze the exact attempted account/rendition/slot.** Retain the original `effect-reserved` and any `outcome-unknown` rows, exact source/release, time, platform and error class. Do not delete, overwrite or relabel the original attempt or infer absence from a missing API response. A previously unjournaled pre-change `retry` or `posted` without an effect NI is also an unresolved legacy state.
2. **Investigate through the original account's authorized, read-only platform capability.** Use the correct PDS or platform account and exact evidence window. When a known AT URI and CID exist, use the already merged original `syndicate readback` operation. A public AppView `not-observed` status does not prove no record existed. If an API response was lost **before** its AT URI was recorded, there is no original rkey/CID to silently reconstruct.
3. **Keep the original attempt held until independently received reconciliation.** A sourced public record, non-public/removed record or conflicting evidence must be distinguished. Record actual observations and the original editor/operations receiver's decision in the source-owning Work and journal. A person may authorize a *new* publication under a distinct scheduled slot only after explicitly accepting the evidence and remaining uncertainty; this source module does **not** invent an override or a clearing receipt.
4. **Repair the underlying cause before enabling repeated automated effects.** For Bluesky, a future origin-approved allocated `tid` record key recorded *before* `createRecord` can make direct PDS reconciliation possible. The [AT Protocol record-key spec](https://atproto.com/specs/record-key) specifies `tid` semantics; a content hash is **not** a valid replacement for the required post key semantics. The [createRecord contract](https://atproto.blue/models/com/atproto/repo/createRecord/) supports an optional caller-supplied `rkey`; the current adapter does not allocate or persist one. This task has **not** solved unknown-result reconciliation or automatic retry.
5. **Only then resume the account/work.** Ordinary tests and a new source commit are not installed remote receiving. Require an authorized publisher account, current platform terms, independent native package verification, received credentials and actual public PDS/AppView evidence before labeling the full journey delivered.

## Actual native source assays

The original CI exercises a fresh source-check and 111 tests including the added seven source-currentness cases. Test fixtures include deterministic exact NI, changed account/source/release, changed scheduled slot, invalid/tampered reservation, exclusive writer lock, malformed original JSONL, legacy retry, two accounts with independent outcomes, an ambiguous 503 following a simulated remote write, restart with *only* the persisted pre-effect entry, and failure to post when the durable port is missing. The test suite deliberately uses synthetic authorized adapters and readbacks; it has **not** sent a real API request, published a package or executed private SignCraft-dependent verification.

## Meet then beat — falsifiable claim

Scheduling products can offer retry, evergreen recycling and multi-channel posting. The relevant Group improvement is not post volume: **a possibly successful API write cannot become an involuntary second publication**. Qualification requires a real authorized record, intentionally interrupted transport, source-owned durable reservation, correct remote reconciliation, no second public record, transparent operator decision and independently observed downstream acceptance. That complete external assay has **not** yet happened.
