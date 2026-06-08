# Contacts app: facts, invariants, open items

Durable findings about this app. Update this file when one of them changes.

## Data model (`sobamail.com/module/contacts/v1.mjs`, tables in `Mutator.mjs`)

| table | insert event | key | notes |
|---|---|---|---|
| `person` | `AddPerson` | lww `uuid` | the entity |
| `person_attr_single` | `SetPersonAttr` | lww `[person, key]` | `firstName`, `lastName`, `jobTitle`, `company`, `address`, `notes` |
| `person_attr_multi` | `AddPersonAttr` | lww `[person, key]` | container row for a list: `emails`, `phones`, `tags` |
| `person_attr_multi_value` | `AddPersonAttrValue` | none | one row per list item, composite fk to its container |
| `person_attr_label` | `SetPersonAttrLabel` | lww `[person, key, value]` | the label of one email or phone (`work`, `mobile`...); fk to the person only |

Invariants:

- Every fk is `ON DELETE CASCADE`: deleting a person removes all of its attributes,
  deleting a container removes its values.
- List values have no lww key, so they can't be looked up or deleted one by one. A
  changed list deletes its container and inserts a new one. The new container links to
  that delete (through `_soba_mut1_delcache`), so its values are new mutations even
  when the same value existed before. Re-inserting a value under the *same* container
  after deleting it would collapse into the deleted mutation and stay deleted.
- `PutPerson` without a `base` replaces the whole person: a blank or missing field is
  deleted. With `base`, the person the edit form loaded (the UI always sends it when
  editing), only what the user changed against it is applied: a field the user left
  alone keeps whatever is stored now, and a list gets the user's additions and
  removals applied to its current items. A field the user did change wins over a
  change made elsewhere meanwhile. A `base` on a new person is ignored. Values are
  trimmed, blanks and duplicates dropped. It refuses to create a person with no data
  at all.
- Two replicas editing the same list concurrently merge as a union: both delete the
  same container (identical `DeleteRow`), both insert an identical new container, and
  the values of both attach to it.
- Labels (`emails` and `phones` only) are keyed to the person, not to the list's
  container. A cascade leaves no `DeleteRow` behind, so a label row cascaded away with
  a replaced container and then inserted again under the same lww key would take a
  runtime path nobody has seen; keyed to the person, a replaced list keeps the label
  rows of the values that stay, and `PutPerson` deletes the labels of values that go.
  On the wire a person carries `labels: {emails: {value: label}, phones: {...}}`; the
  list values themselves are unchanged, so direct readers of the tables (amp-mgui's
  composer) see the same rows as before. With a `base`, a label the user didn't change
  keeps what is stored now. The UI offers home/work/other for emails and
  mobile/home/work/fax/other for phones; the backend takes any non-blank text.

## Delivery

`process()` logs `JSON.stringify(metadata)` for every delivery and accepts only
`metadata.type` `"task"` (ui requests) and `"task-replay"`. Anything arriving by mail
is refused, so nobody can write to the address book by mailing it a structured
object. Consequence: an instance in **shared** mode would not sync, because shared
instances ship events between mailboxes by mail. Private-mode sync between one
mailbox's replicas is unaffected.

`static objects` lists only what the app accepts: the events and the requests.
Response classes (`PutPersonResponse`, `Person`, `GetPeopleResponse`,
`SendVCardResponse`) don't go in it (owner, 2026-10-13); they are never delivered to
the app.

An object whose constructor finds a required field missing throws `MalformedObject`;
`process()` logs and drops it, since a throw would be retried forever. Any other error
still throws, so a retry can succeed once replication brings what was missing.

## Composing from a contact

Each email in the detail view is a `mailto:` link. A user-clicked `mailto:` in an app
page goes amp-cef `CefClientImpl::handle_external_url` (476-497) -> `mailto_request`
-> amp-mgui `make_app_view` -> `app_view_mailto` (amp-mgui 30eb20ce7 and 6e6daf86e,
built, pinned by `test_ui__test_ui_app_view_mailto_opens_the_composer`), which
routes it through `cli_request` like the reader's links: Sobamail's composer, with
`?to=`, `?cc=`, `?subject=`, `?body=` filled in. Before that commit it went to
`QDesktopServices::openUrl`, the OS mail client. A navigation without a user gesture
is cancelled (`OnBeforeBrowse` 1107-1110).

## Email check

The form checks email rows for typos only (`ui/src/lib/email.ts`): one "@", something
before it, a domain with a dot, no blanks; `user+tag@` and non-ASCII addresses pass.
A malformed row gets the invalid border, one hint shows under the list, and Save stays
disabled. Blank rows pass, since saving drops them. The backend doesn't check: it only
reads and writes.

## Division of work

The backend only reads and writes the address book (owner, 2026-10-13). Anything
derived from the data, like the vCard export, is made in the UI. One sending request
is allowed: `SendVCard` attaches a vCard file the UI sends to a message and mails it to
the addresses the UI gives (owner, 2026-10-13). The UI writes the vCard, the subject
and the text too; the backend only fills in a fallback for a blank one.

## vCard export

`ui/src/lib/vcard.ts` writes vCard 3.0 (RFC 2426): CRLF lines folded at 75 UTF-8
octets without splitting a character; text escaped (backslash, line breaks, comma,
semicolon); `N`, `FN` (the name, else company, first email, first phone), `ORG`,
`TITLE`, `EMAIL;TYPE=INTERNET[,label]`, `TEL[;TYPE=label]`, the free-text address in
`ADR`'s street component, `NOTE`, `CATEGORIES` from the tags, `UID` from the uuid.
Labels map to vCard types home/work/mobile/fax -> HOME/WORK/CELL/FAX; others get none.
The toolbar's Export exports the selected contact (read fresh with `GetPerson`) or
everyone (one `GetPeople` with a limit of a million) and hands the text to the browser
as a Blob download, `<name>.vcf` or `contacts.vcf`.

The download does NOT work inside Sobamail (amp-cef `cef/integration/CefClientImpl.cpp`,
read 2026-10-13; not run). `GetResourceRequestHandler` (820-924) passes `data:`,
`about:` and `chrome:` to CEF's default handling and serves `soba://message`,
`soba://app`, `mailto:`, `cid:`, `asm:` itself; any other scheme, `blob:` included,
ends at 921-923 with `disable_default_handling = true` and no handler, which cancels
it. And `CefClientImpl` implements no `CefDownloadHandler` (nothing in amp-cef does),
so CEF cancels downloads anyway. The message view saves attachments through its own
`soba://message/.../download` URLs, turned into Qt signals (1036-1068); `soba://app`
pages have no such route. It works in a plain browser only. The button stays: the host
is to get download support (owner, 2026-10-13).

The Export dialog also sends the vCard by email: a "Send by email to" field takes one
or more addresses (commas or blanks between them, each checked like an email row) and
calls `SendVCard`. `SendVCard.process({Message, MessageAttachment})` gets the base
module's classes from the Mutator (`MAIL`), since the module can't import the base
module (the UI bundles the module). The attachment is `text/vcard`, its bytes
`soba.text.encode(vcard).buffer`; the message is from `soba.app.account()`. No other
Sobamail app has sent an attachment yet, so this path is untested against a real
runtime.

## vCard import

`parse_vcards()` in `ui/src/lib/vcard.ts` reads vCard 2.1, 3.0 and 4.0 in the UI:
folding undone (only the first blank of a continuation line goes), 2.1's
quoted-printable with soft line breaks and `CHARSET` (e.g. ISO-8859-9), 2.1's bare
types (`TEL;CELL`), groups (`item1.EMAIL`), quoted parameter values, `tel:` / `mailto:`
values, text unescaping. N gives the names (middle name joins the first); without N,
FN is split at the last blank, unless it only repeats ORG. ORG's first component is the
company; ADR's components become lines (the code before the locality); every NOTE is
kept; CATEGORIES are tags; EMAIL/TEL types become labels (fax, cell/mobile/iphone,
work, home, in that order). PHOTO and other binaries are skipped, so is UID: each card
becomes a new person. Cards with nothing usable are counted, not imported.

The toolbar's Import opens a file picker, then a dialog listing the cards to tick.
Cards with an email already in the book (one `GetPeople` for everyone) start unticked
and say so. Import sends one `PutPerson` per ticked card, one after the other, with a
progress bar and a Stop button, then reloads the list.

## Reading and search

- `GetPeople` pages in display order: by last name (the first name when there is
  none), then first name, case and accent insensitive via `fold()`; people without a
  name last, uuid breaking ties. Every person's names are read and sorted in js (SQL
  `ORDER BY` folds only ascii), then the page is sliced; with a filter, only matching
  people are. The response keeps page order, so the UI shows the pages as they come
  (no client-side sort) and its letter sections, keyed by the last name's (else the
  first name's) initial, put "#" last.
- Attributes for the page come from `json_each(<uuids>)` `LEFT JOIN` the shared
  attribute query, so people without attributes are listed too.
- Search is a substring match on each value separately, case and accent insensitive
  via `fold()`: NFKD, drop U+0300 to U+036F, lowercase, `ı` to `i`. "sahin" finds
  "Şahin", "cagri" finds "Çağrı". `%` and `_` are literal.
- `tagFilter` is ignored by the backend; the ui filters groups client-side, over the
  loaded pages only.
- Emails are sorted case-insensitively on read (`GetPeople` and `GetPerson`).
- Collected addresses (the client's tag `Replied`, `collected` before 2026-10-19) are
  listed with every other contact, not hidden (owner, 2026-10-13).
- The client's send-time collect keeps the name of a person tagged `Replied` current
  with the mail: a `PutPerson` with the uuid, the new name, every other field blank and
  a `base` of the old name alone, so only the name changes (amp-mgui
  `zai/contacts-app-facts.md`, § The Replied tag; pinned in `contacts.test.ts`, "changes
  the name alone when the base carries only the old name"). Saving an edit of a
  `Replied` person in the form drops the tag (`App.svelte` `save()`, `TAG_REPLIED` in
  `model.ts`), so the collect leaves the user's contact alone from then on, as an edit
  clears `iscoll` in the legacy address book (owner, 2026-10-19; `App.test.ts`, "drops
  the Replied tag of a contact the user edits").

- A person without a name is shown by its first email (the list rows, the avatar, the
  detail head, the dialogs; `fullName` in `App.svelte`), "(no name)" only when it has
  no email either; it still sorts into the "#" section with the other nameless people
  (owner, 2026-10-19).

## Merging

The user deduplicates the list, not the client (owner, 2026-10-19): any contact can be
merged into the one shown ("Merge…" in the detail footer, a dialog to search and pick
it, then a confirmation). `merge_people` (`ui/src/lib/merge.ts`) builds the result:
the name is the shown contact's (the other's when it has none, the two names never
mixed); every other single field keeps the shown contact's value and takes the
other's where it has none, the notes keeping both; emails (case ignored), phones and
tags are the union, the shown contact's first; its labels win, the other's fill in.
A merge is the user's edit, so the Replied tag goes. The merge is two requests from
the UI, no object of its own: a `PutPerson` of the result with the shown contact as
stored as its `base`, then a `DeletePerson` of the other, in that order, so a failure
in between leaves a duplicate rather than a loss. Pins: `merge.test.ts`,
`App.test.ts` "merges a picked contact into the shown one and deletes it".

## Launch fragment

The mail client launches the app with a fragment. Its "Open contact card..." uses
`#person/show?email=<address>&name=<display name>`; the client side is in amp-mgui
(`zai/contacts-app-facts.md`, ruling 13). Parsing is in `ui/src/lib/fragment.ts`, the
handling in `App.svelte` `openFragment()`, on load and on `hashchange`.

- `person/new` opens an empty new contact card; a query on it is ignored.
- `person/show` needs `email`. A bare `person/show`, a name-only one, any other
  path or a malformed escape is invalid. An empty fragment is the app's root.
- Every fragment is removed from the URL once read, valid or not (`replaceState`,
  which fires no `hashchange`). A reload doesn't apply it again, and launching the
  same fragment again changes the hash, so the app sees it.
- Values are decoded with `decodeURIComponent`, not `URLSearchParams`: QUrlQuery
  encodes a space as `%20` but leaves a literal `+` bare, which `URLSearchParams`
  would turn into a space (`user+tag@example.com`).
- The name gets the client migration's treatment (its ruling 7): one pair of
  surrounding double quotes goes, a name equal to the address is no name, and it
  splits at the last blank into first and last name.
- The card is looked up by exact, case-insensitive email among `GetPeople` search
  results. If several cards hold it, the one whose first + last name spells the
  display name wins, else the first. Found with the same name or no name: shown.
  Found under another name: opened as an edit with the new name filled in, unsaved.
  Not found: a new entry pre-filled with the email and name, unsaved.

## Tests

`pnpm run test` in `ui/` (vitest). `src/lib/fragment.test.ts` covers the launch
fragment parser. `src/lib/contacts.test.ts` runs the module's request handlers on
`src/test/soba.ts`, a stand-in runtime: `soba.db.exec` runs on an in-memory SQLite
(sql.js) with the tables `Mutator.mjs` declares, mirrored by hand (keep the two in
sync), and `soba.data.*` emulate lww replacement and fk cascades. Mutations, content
addressing and replication are not modelled, so what replicas do with concurrent
writes is not covered.

`src/App.test.ts` renders `App.svelte` in jsdom (Testing Library; `vitest.config.ts`
adds its svelte plugin) against `src/test/backend.ts`: a stubbed `fetch` that decodes
each `/api/v2/object` request, runs the module's request object on the stand-in
runtime and answers in compact SMC. So those tests drive the UI, `model.ts` and the
module together: list order and sections, nameless rows shown by email, search, the
detail view, the form's checks, the base merge, an edit dropping the Replied tag,
merging contacts, deleting with Enter, launch fragments, export by mail, import. The
host (CEF, mailto routing, downloads, file dialogs) is not in it. Undoing the Enter fix
or the base merge makes a test fail.

## Runtime facts (checked 2026-10-13)

The C++ runtime (amp-apps) is not checked out next to this repo. These come from
`soba-runtime/model/Base.mjs`, the soba-mbmgr Mutators, amp-mgui's `zai/` notes and
the runtime debug logs kept under amp-mgui `zai/**/evidence/`.

- `metadata.type` is `"message"` (mail, structured messages included), `"task"` or
  `"task-replay"`; `metadata.location` can be `"limbo"`. UI requests are transient
  tasks (owner), so they arrive as `"task"`. Mutations from other replicas are
  replayed through `process()` as `"task-replay"` (amp-mgui
  `zai/dept-authz-facts.md`), so the delivery gate lets sync through. A `DeleteRow`
  never reaches JS.
- Tasks queued with the client's `insert_as_task_to_app` are `tasks` rows that only
  work through the task branch; their type string is not logged anywhere, but
  `"task"` is the only one that fits.
- `soba.db.exec` returns code 0 on success (mbmgr's admin checks depend on it, and
  their tests pass).
- `soba.data.find` only accepts the full column set of an lww constraint (in any
  property order), so that it matches a single row; a partial key is refused ("Query
  does not contain unique columns"). Here that is `{uuid}` on `person` and
  `{person, key}` on the two attr tables; `person_attr_multi_value` has no lww key and
  can't be found at all, hence lists are replaced through their container. It returns
  the live (latest) mutation, with `deleted`. A miss throws
  AND aborts every later `soba.data.*` call in the same pass ("Execution was aborted
  previously"); a task row that throws is retried forever. Only `find` what a
  `soba.db.exec` read has just shown to exist.
- `soba.db.exec` reads its own snapshot: a row removed by `soba.data.delete` (or by
  the cascade it triggers) is still visible to `exec` later in the same pass. Read
  first, then write, as `PutPerson` does.
- Instance databases run with `PRAGMA foreign_keys=ON`; the generated fks are
  `ON DELETE CASCADE`. SQLite is 3.53.3, with the JSON functions built in.
- Tasks are NOT deduplicated: the `tasks` table has no unique key and every row is
  processed. Only mutations are content-addressed (`sha512` UNIQUE), so a
  byte-identical insert is ignored. Two `PutPerson` tasks with an empty uuid make two
  people.
- An lww insert over an existing key emits a `DeleteRow` for the old row and chains
  the insert after it; the new row gets a new rowid.
- Upgrades (from amp-mgui's notes and runtime logs, 2026-10-13): an instance upgrade
  re-runs the objkey walk and rewrites the `assoc` rows for the new version, so new
  `objects` entries get delivered (seen for a core app, not yet for a user app). Each
  init creates any declared table missing from main.db (`sqlite_schema` check, then
  `CREATE TABLE`); an existing table is never altered. What a replica still on the old
  version does with mutations of the new one is not documented.

Still unconfirmed: whether the backend V8 has ICU. Without it,
`String.prototype.normalize` returns its input unchanged and search folds only case,
not accents.

## Public mirror

- github.com/sobamail/contacts (cloned at `~/src/github/sobamail/contacts`) carries
  the source code, not the history. `github-sync/sync.sh` stages it there: the tree of
  HEAD minus `ui/public/ds/assets/fonts` (Idealist Sans), `ui/public/ds/assets/icons`
  and the unused `ui/public/address-book.svg`, with generic stand-ins for the ten
  icons the UI loads and `.gitmodules` on HTTPS URLs. Never hand-copy files there;
  change `EXCLUDE` or `overlay/` in the script. The owner commits and pushes.
- The mirror's first commit ("Contacts app initial import", made by hand from
  d6d7a66) still holds the fonts and the design system's icons, plus three
  pre-redesign components (ContactDetail/Form/List.svelte). A sync deletes them from
  the tree, not from GitHub's history.

## Lessons

- The Edit and Write tools turn `\uXXXX` in new text into the raw character. Don't
  write unicode escapes into source through them; compare code points instead, or
  read the result back.
- Every commit that changes `v1.mjs` updates its `?sha224=` pin in `Mutator.mjs` in
  the same commit (base32hex, the encoding already used there). Run
  `.claude/skills/sobamail-app/scripts/gen-hash.py <file>` from the repo root; the
  permission rule matches that form, not `python3 ...`.
- The Edit tool drops trailing whitespace from the replacement text, so a replacement
  that ends in a blank loses it. Keep replacement boundaries off whitespace, and have
  tests check error message text, not just the error class.
- Mail with an attachment, as `SendVCard` builds it: base `Message` has no
  addAttachment; assign `message.attachments = [new MessageAttachment({name, type,
  blobs: [arrayBuffer]})]`. Unlike the text body, a string blob is NOT encoded for you
  (the skill's runtime-api.md says otherwise): pass `soba.text.encode(s).buffer`, and
  keep blobs raw ArrayBuffers, since `Blob.toMsgpack`'s inline branch calls
  `new Uint8Array.from(...)`, which throws. Before `SendVCard`, no Sobamail app sent an
  attachment (checked soba-mbmgr and soba-runtime, 2026-10-13).

## Open items (survey of 2026-10-13)

- Duplicates per address, DEFERRED (owner, 2026-10-13: not an issue now, to be looked
  at later). `PutPerson` with an empty uuid mints a fresh one on every run, and every
  client replica migrates its own legacy table (amp-mgui ruling 1), so an address
  held on two replicas becomes two people, and two completer entries. Converging
  needs a uuid derived from the address (identical mutations then collapse across
  replicas), which in turn needs an add-only object for the client, since
  `PutPerson` with a known uuid and no `base` replaces the card. It happens on one
  replica too: tasks are not deduplicated (see Runtime facts). amp-mgui's ruling 9,
  which said the runtime dedupes them, is withdrawn (owner, 2026-10-13).
- Group (tag) counts in the sidebar cover the loaded pages only.
- The tables are an api now: amp-mgui's composer reads them directly
  (`SELECT_PEOPLE_LEGACY_SHAPE`), so a schema change breaks its autocomplete with no
  error on either side.
- `process()` logs every delivery's metadata at info level: one line per migrated
  contact. Demote it once the delivery types are confirmed.
- Mail integration: the client autocompletes from the app's tables, writes collected
  addresses through, and opens the contact card. Nothing exposes contacts through an
  object yet.
- Saving an edit after another replica deleted the person brings the person back
  with only the fields the user changed: with a `base`, an untouched field keeps
  "what is stored now", which the delete cascaded away. Writing attributes back under
  lww keys whose rows a cascade removed is also the untested runtime path labels were
  keyed to avoid. `PutPerson` should refuse (or drop the base) when the uuid it is
  given no longer exists. The client's rename of a `Replied` person has the same
  exposure: a person deleted after the collect read it comes back as a bare name.
- Contacts with nothing but a name, or nothing at all, seen live (owner's instance
  `K17NOKV33D05F6ECB5U8NSP2EO`, 2026-10-20, over DevTools): of 27 people, 7 had no
  attribute at all (listed as "(no name)") and 8 had only a first and last name, no
  email and no tag. A search for "@", which also reads list values left without their
  container, found none of the 15, so none of their emails is stored. Every contact that
  still has an email has a tag (`collected` or `Replied`); none of the 15 has one. Code
  paths that leave such rows: `PutPerson` with a uuid always inserts the person row
  first, so one for a person deleted meanwhile brings it back with only the fields it
  changes (with a `base` and no change: a bare row); with a uuid, no `base` and every
  field blank, it deletes every attribute and keeps the row, since the empty-person
  refusal only covers new people. Which of these made the 15 is not confirmed: the
  instance's mutation log (`mutlog.py`) would show it.
- Unsaved form edits are dropped without asking when the user picks another contact
  or a launch fragment arrives.
- Scale: every `GetPeople` reads and folds every person's name (and, for a search,
  every stored value). Fine for thousands; the migration imports every collected
  address, so tens of thousands are possible. Export-all is one request for everyone.
- `SendVCard` with every contact can be large; whether the mailbox's outbound size
  limit (mbmgr `LimitsPut`) applies to app-sent mail is unchecked. The dialog says
  "Sent" once the request returns, i.e. queued, not delivered.
- `SendVCard` sends whatever the app's page asks, as the user, so script injection in
  the UI would be a mail-sending hole. `App.svelte` renders every value as text (no
  `{@html}`, checked 2026-10-13); keep it that way.
- Elsewhere: `ui/src/lib/Response.ts`'s two changes (no console.log, an `error`
  getter) to fold into soba-mbmgr's copies.
- CardDAV if phones should sync.
- Structured or labelled addresses, birthday, website, photo; custom label text in the
  UI.
- Duplicate detection and merge; groups usable as recipient lists.
- The list doesn't refresh when another replica syncs; only the Refresh button does.
- Translations (neither soba-appstore nor soba-mbmgr has any yet; pick one mechanism
  for all apps).
- `App.svelte`'s infinite scroll isn't tested: jsdom has no IntersectionObserver.
