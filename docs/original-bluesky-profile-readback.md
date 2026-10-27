# Original Bluesky public-profile readback · source-observed, not account editing

Status: source-implemented candidate, executing in the **existing original**
`social-publication-engineering-services-section` brand-presence CLI. This
does not post, sign into accounts, acquire a credential, mark Group Work as
done or produce a discharge receipt. It extends [syndication PR
#5](https://github.com/red-cup-engineering/social-publication-engineering-services-section/pull/5),
not a second brand or marketing engine.

## Actual Group task this unlocks

[Group internal-services-section PR
#526](https://github.com/561-group/internal-services-section/pull/526) contains
the original approved public copy for the Group's Bluesky account and an
operator-only handoff to change it. In that branch:

- `data/records/public-copy-records/2026-10-25-bluesky-561-group-profile-text.json`
  records its original observed public description and its NI digest, the
  handle and DID, competing drafts, the selected candidate's passed copy gate
  and the exact chosen `ni:///sha-256;...` digest.
- `data/records/decision-records/2026-10-25-bluesky-561-group-profile-text.json`
  records the institutional choice, authority, and reversal conditions.
- `data/records/human-handoff-requests/apply-2026-10-25-bluesky-561-group-profile-text.json`
  addresses the account holder and gives human editing instructions. The
  existing Console [#36](https://github.com/red-cup-engineering/metroplat-operations-console/pull/36)
  admits it as source-only instructions but **still needs** an authentic
  installed Group source provider and independently verified completion.

The original Group source records carry the exact DID, prior and selected
public-copy content addresses, approved words and evidence. The public
Engineering repository neither duplicates those private source bytes nor
selects them from its own test fixtures; it reads the owner-authorized record
when the recipient explicitly invokes the CLI. It does **not** re-author a
profile, embed a password or decide what the public description should say.

## Execute original read-only receiver

With the original Group source checkout and admitted social-publication
engine available:

```sh
node apps/brand-presence.mjs profile-readback \
  path/to/internal-services-section/data/records/public-copy-records/2026-10-25-bluesky-561-group-profile-text.json
```

The command loads the existing source record. It checks the chosen candidate
against its editorial gate and its SHA-256 of **literal UTF-8 bytes**; checks
that the old observation has the original content address; and extracts the
original declared account and pinned DID. A malformed, tampered or unrelated
record is refused **before any network operation**.

Exactly one unauthenticated HTTPS GET is then made to the fixed Bluesky public
AppView endpoint
`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=561.group`
(as constructed from the admitted source handle). The transport follows no
redirect, forwards no credential, uses a timeout, requires JSON, bounds the
body stream to 32 KiB and refuses invalid UTF-8 and malformed profile fields.
The observer returns the source URL, observed UTC time, original decision
identity, expected and observed NI, pinned DID and public text when that DID
and handle agree. Provider exception bodies are **not** disclosed.

The machine-readable `561-group.social.bluesky-profile-readback.v1` has
precisely these meaningful standings:

- `text-match`: exact original candidate bytes observed at the source-pinned
  DID and handle. This is one public AppView reading only.
- `previous-text-visible`: the original dated old text is still what the
  AppView returned.
- `text-mismatch`: the public description differs from both original old
  and original selected bytes.
- `identity-conflict`: the AppView's DID or handle does not match the
  original source-owned account; it cannot claim the selected text belongs to
  that account.
- `unavailable`: source HTTP status, timeout, redirect, malformed or excessive
  provider response cannot establish a reading; it is not an empty profile.

Exit 0 indicates only a matching **public observation**. Exit 3 marks any
other standing or source-admission refusal. No mode grants an account write,
emits a success receipt, acknowledges a Work request, marks a Leader decision
fulfilled, authenticates a user, or proves upstream PDS persistence. Public
AppView can cache data; an original independent PDS/producer and account-holder
verification are separate.

## Original science → engineering → practice receiving

The [canonical Group runbook
`decide-public-copy`](https://github.com/561-group/internal-services-section/blob/feat/brand-presence-records-skills-runbooks-20261024/lib/agency/runbooks/decide-public-copy.json)
already defines `receive-readback`. The new native operation supplies a
**reusable, independently executable public-source observation** for that
stage. The original Marketing decision, Account holder, Organizing
Work/obligations, and Group change-record writer remain distinct owners.
A matching output may be cited by a human receiver; only the competent owner
may independently assay the provider, issue a source-authored change record
and later authorize an original Work/obligation discharge.

Run `npm run verify` from the original social-publication PR branch.
`test/profile-readback.test.mjs` covers 16 pure source, hash, DID, network,
privacy, bounded stream and refusal cases; `test/profile-readback-cli.test.mjs`
adds 5 actual forked CLI invocation and source-data-minimization tests. Both
use fake provider responses and no network/billing. Public GitHub Actions
`Native source and marketing-tool verification` runs **real Node 24** over
the whole existing program, not a fabricated private runner.

## Economic and user value

This resolves an often-ignored operational defect: approved marketing
copy can be compared with externally visible reality without frontier
inference, credentials, a new application, duplicate state or a human reading
two screenshots. The right metrics are original decisions eventually
reflected in the public profile, time to independently received change,
reopening/refusal rates, and downstream attributable qualified contact or
paid service, **not** the number of source files produced. No account edit,
accepted outcome, actual conversion, outside buyer or income was received in
this source change.
