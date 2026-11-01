# Súbory: public sharing of a file, drafts and their approval

Status: **implemented** (2026-11-01), all recommendations of section 15 accepted. Screens: the `Share*`
boards on the canvas „Alma Intra – screens“, page „Súbory“, and `AktDetailShare` on page „Aktivity“. The
owner changed the concept in the first round: an outsider never makes a version, only a draft that a
colleague approves. Builds on section 7 of `docs/functional-spec.md`, D-43, D-54 and
`docs/activity-types.md`. Decision D-58.

Marks: **[S-n]** a decision of this spec. _(Q-n)_ points to the question that settled it (section 15).

---

## 1. Why

The owner wants to give any file in „Súbory“ to somebody outside Intra through a unique address, with or
without a password. An HTML file can also be commented on or edited by that person. What they send comes
back as a draft („Koncept“), and only a colleague can turn a draft into a new version.

These are public routes without a sign-in, serving stored HTML that outsiders can change. Section 9 is as
much a part of the requirement as the features.

---

## 2. What real documents look like

Measured on the 14 HTML documents in `Firemné dokumenty` on 2026-11-01. This shapes several decisions:

| Finding                                                                              | Consequence                                  |
| ------------------------------------------------------------------------------------ | -------------------------------------------- |
| All 14 carry scripts, several of them the `alma-edit` bar („Upraviť“, „Uložiť“)      | That bar never shows on a shared page [S-11] |
| „Ekonomika“ and „Business plan“ are live calculators; the deck is driven by a script | Scripts run, in an isolated frame [S-12]     |
| 10 load Figtree or Inter from Google Fonts; their styles already name system fonts   | Google is removed, system fonts show [S-13]  |
| Heavy use of `class` and `style` (the deck: 1090 `style`, 963 `div`, 91 `svg`)       | A plain TipTap document would destroy them   |
| 45 tables in „Solutions Architecture“, 32 `details`                                  | Tables and collapsed parts are first-class   |
| The deck has 6.4 MB, others up to 853 KB                                             | Limits on what travels and what is edited    |

---

## 3. Scope

**In:** the „Zdieľať“ dialog, a unique address, an optional password and expiry, three modes for HTML, the
public page, comments, fragment editing with tracked changes, drafts, merging them, approving changes and
comments, a new version from a draft, the activity „Zmena dokumentu“.

**Out of this step:** sharing a folder; several files at one address; sharing through MCP (Claude); adding
or replacing an image, or uploading anything, from the public page; editing a non-HTML file; commenting on a
non-HTML file; accounts for external people; real-time co-editing; a visitor returning to an unsaved or an
earlier draft; running scripts in the app's ordinary file preview (D-54 stays).

---

## 4. In the app

### 4.1 „Zdieľať“

- A new item „Zdieľať“ in a file's menu in the Files list [S-1], for anyone with the new permission
  `file.share` (through `can()`, all admins today).
- One link per file, as the owner decided. The dialog holds:
  - the address with „Kopírovať odkaz“;
  - „Režim“, for an HTML file only: „Čítanie“, „Komentovanie“, „Úpravy“. Others are always „Čítanie“;
  - „Heslo“: optional for „Čítanie“, required for the other two [S-2];
  - „Platnosť do“: optional, empty means until cancelled;
  - „Zrušiť zdieľanie“;
  - for a file in a customer's folder, one line saying it can hold personal data of that customer.
- The password is stored only as an Argon2 hash, as all passwords in Intra are, so it can be replaced but not
  shown again. The dialog offers „Vygenerovať“ and copying at the moment it is set. At least 8 characters [S-3].
- Changing the password or cancelling the link ends every open public session at once. Lowering the mode
  applies at the visitor's next request [S-4].
- A shared file carries an icon in the list, and the Files filter gets „Zdieľané“.

### 4.2 Life of a link

- A link always shows the file's **current version** [S-5]. Unapproved changes never show to other visitors.
  A new version is offered while reading, like in the preview („Načítať“).
- A rename or a move changes nothing for the link. A file in the trash, or of a deleted customer, answers like
  an unknown link. A file restored from the trash has its link working again. A purge deletes the link, the
  drafts and the comments. A copied file is not shared [S-6].
- Cancelling a link leaves its drafts and comments in Intra, to be finished.

### 4.3 Column „Koncepty“

The Files list gets a column „Koncepty“: the number of drafts waiting, or „–“. A click opens the list of the
file's drafts (section 7.1). The file's sheet gets the same list as a tab. The app's preview of an HTML file
with open comments shows a panel with them (author, quote, text); a click opens the draft that holds the
comment [S-7].

---

## 5. The public page

- Address: `https://intra.alma-care.eu/zdielanie#<token>`. As with `/zaujem#<token>`, the token is in the fragment
  and goes to the API in POST bodies, so it reaches no proxy log and no referrer (CLAUDE.md rule 5) [S-9]. A
  random 256 bits; Intra stores its SHA-256 for lookup and the token encrypted with `DATA_ENCRYPTION_KEY`, so
  „Kopírovať odkaz“ works later.
- A route outside `_app`, with the Alma mark, the file's name once unlocked, and nothing else about Intra: no
  folder path and no customer [S-10].
- **Access screen**, before anything of the file is sent, not even its name:
  - „Čítanie“ without a password: skipped;
  - „Čítanie“ with a password: „Heslo“;
  - „Komentovanie“ or „Úpravy“: „Vaše meno“ and „Heslo“, both required, 2–80 characters for the name;
  - a returning visitor (5.1): „Heslo“ only, with „Vitajte späť, <meno>“ and „Nie som <meno>“.
- After unlocking, an httpOnly, `SameSite=Strict` session cookie, for 12 hours at most and gone with the browser,
  holds the link, the visitor and the password generation. An expired session asks again over the page and keeps
  what is unsaved.
- A wrong token, a cancelled or expired link, and a file in the trash all give the same screen: „Odkaz nie je platný“.
- „Stiahnuť“ is offered in every mode through a short-lived signed URL.

### 5.1 A returning visitor [S-14]

The owner's rule: a visitor changes and deletes only their own comments, within the session in which they wrote
them, also after several saves; later only if the app can recognize them, and then they do not type the name again.

- At the first unlock in „Komentovanie“ or „Úpravy“ the browser gets a second cookie, httpOnly, for 90 days from
  the last visit, holding a random token of that visitor (`file_share_visitors`, only its hash stored).
- It recognizes **this browser on this link**, not the device: there is no fingerprinting. Another browser or a
  private window is a new visitor, who cannot touch the earlier comments.
- The password is still required: the cookie replaces the name, not the password. „Nie som <meno>“ drops the
  cookie, for a shared computer.
- Own comments stay editable until a colleague agrees to them _(Q-20)_.

### 5.2 By type

- HTML: section 6. Markdown, PDF, photos: shown as in the app's preview (`previewKind`).
- Everything else, SVG and video included: the name, the size and „Stiahnuť“.

### 5.3 Reading HTML

- Pictures show, links work, and the document's scripts run in the isolated frame [S-12]. A link inside the document
  moves within it and opens the collapsed parts around the target; any other `http`, `https`, `mailto` or `tel`
  link opens in a new tab without an opener or referrer. Other schemes do nothing.

---

## 6. Comments and edits on an HTML file

The modes are cumulative: „Úpravy“ can also comment, „Komentovanie“ can also read. The document's scripts run in
these modes too _(Q-13)_ [S-15], with one limit: what a script generates is not in the file. So a calculated value
cannot be edited, only its block's source can, and a comment on it may lose its place when the numbers change.

### 6.1 Commenting

- Selecting any text shows „Komentovať“ at the selection. An image, an SVG or a block shows it on hover (on a touch
  screen on a tap).
- A comment shows the typed name and the time, and is saved at once. All open comments are visible to everyone
  with access. A side panel lists them in document order, and a click scrolls to the place. A visitor can reply.
- A comment is anchored to the version and to its place: the block, the quoted text with what precedes and follows
  it, or the element. On a new version the same quote is searched for; a comment whose place is gone goes to the
  end of the document, under „Nezaradené komentáre“ [S-16].
- Editing and deleting one's own: section 5.1.
- A comment agreed to by a colleague no longer shows on the public page.

### 6.2 Editing

- **Hover:** the fragment under the cursor is outlined, with icons at its top right: „Upraviť“, „Zmazať“ and, on a
  changed fragment, „Zobraziť zmeny“. On a touch screen a tap selects [S-17].
- **What a fragment is:** the smallest of `p`, `h1`–`h6`, `ul`/`ol` as a whole, `table` as a whole, `blockquote`,
  `pre`, `figure`, `img`, `svg`, `hr`, and a `div` or `section` holding text directly. An extra icon „Nadradený blok“
  climbs to the enclosing `div`, `section` or `details`, so a whole card or chapter can be deleted [S-18].
- **„Upraviť“:** a WYSIWYG editor (TipTap, already in the app) opens over the fragment with its content and „Uložiť“,
  „Zrušiť“. It offers text styles, lists, links and, in a table, rows and columns. „Uložiť“ closes the editor and
  changes the page only [S-19].
- **„Zmazať“:** removes the fragment, without a confirmation since it can be undone (6.3).
- **Fidelity [S-20]:** existing `class` and `style` survive an edit, and the editor shows the document's own styles. A
  fragment the editor cannot hold without loss (an `svg`, a chart, a layout of nested blocks, anything with a script)
  offers no „Upraviť“: it can be deleted, or its inner parts edited one by one, as the owner agreed. This is checked
  by a round trip before the editor opens. No image can be added or replaced.
- **Top bar:** after the first change a bar stays on top: the number of changes, „Zahodiť zmeny“ (with a
  confirmation) and **„Uložiť a poslať na schválenie“**. A fragment edited back to the original drops out of the
  count, and with no changes the bar goes away [S-21].
- **In memory:** until that button changes live in that tab only, as asked. Leaving or reloading warns, and then they
  are lost [S-22].
- **„Uložiť a poslať na schválenie“** creates a draft (section 7) and an activity (section 8), and never a version.
  The page stays as it is, so the visitor can continue, and saving again creates another draft _(Q-14)_ [S-23].

### 6.3 Tracked changes

- The normal view shows the final text. „Zobraziť zmeny“ on a fragment shows what was added and removed, word by word:
  added underlined in green, removed struck out in red [S-24].
- A deleted fragment has nothing to hover, so a thin marker stays in its place with the same icon and „Vrátiť späť“ [S-25].
- For a visitor this covers their own changes in that session. For a colleague it covers every change of a draft, and it
  stays readable from the version the draft became.

---

## 7. Drafts

A draft („Koncept“) is a set of changes against a version, plus comments, by a named outsider. It is not a file: it
is rows, and it becomes a file only when a version is made [S-26]. Two people editing at once simply make two drafts,
so there is no conflict at saving.

A draft is **waiting**, **merged** (into another draft), **finished** (became a version, or held only comments and all
were agreed to) or **discarded**.

### 7.1 The list of a file's drafts

Newest first: name(s), date, base version, number of changes and comments, how many are still undecided. Each row has a
checkbox. „Zlúčiť“ is active with two or more selected, and „Zahodiť“ is on each row, with a confirmation.

### 7.2 Showing a draft

A full-screen view like the preview: the document with the draft's changes, in the same isolated frame.

- Each changed fragment is marked, with „Schváliť“, „Zamietnuť“ and „Zobraziť zmeny“, and also listed in a side panel.
- The panel lists the comments, with „Odpovedať“ and „Odsúhlasiť“. „Nezaradené komentáre“ and changes that no longer fit
  are at the end.
- A colleague's reply is visible to visitors on the public page, with the colleague's name _(Q-17)_.
- The top bar: what is left („Zostáva: 2 zmeny, 1 komentár“), and „Vytvoriť novú verziu“, active only when every change is
  decided and every comment agreed to, as the owner set [S-27].
- A colleague does not write into a draft _(Q-16)_.

### 7.3 Merging [S-28]

The selected drafts become one new draft on the file's current version, and they turn into „Zlúčený“, readable.

- Comments of all of them are in the new one. Those that do not fit go to „Nezaradené komentáre“ at the end of the document,
  as the owner decided.
- The same change twice becomes one, and a decision already made on it carries over.
- Two different changes of one fragment stay as alternatives, each with its author: approving one rejects the others.
- A merge creates no new activity; the activities of the merged drafts lead to the new draft _(Q-18)_.

### 7.4 A draft on an older version [S-29]

When a draft is opened or merged while its base is no longer current, its changes are moved onto the current version:
a change whose original fragment is found there unchanged applies; the others are listed at the end as „Zmena sa už
nedá zaradiť“, with their old and new text, and can only be rejected. A colleague redoes them by hand if wanted.

### 7.5 From a draft to a version [S-30]

„Vytvoriť novú verziu“ builds the file from the current version plus the approved changes. Rejected ones are left out.

- The version is made by the colleague: `created_by_user_id`, `created_via = 'share'`, and `external_author` with the
  typed name(s). Everywhere an author shows it reads „Externá zmena <meno>, schválil(a)…“ in gender neutral words
  (the exact words on the screens) _(Q-19)_. „Externá zmena“ is always part of it: the name is self-declared, nobody
  verified it, and it must not pass for a colleague.
- The draft becomes finished, its activity says so, and the version's row links to it for „Zobraziť zmeny“.
- A draft with only comments has no such button: it is finished when its last comment is agreed to.

---

## 8. The activity „Zmena dokumentu“

As the owner decided, replacing a separate notification [S-31]:

- A new type „Zmena dokumentu“ in the code list of Aktivity, seeded by the migration as a system type like „Podnet“: no
  e-mail button records it and it cannot be removed.
- Each draft an outsider saves creates one row in `lead_activities`: new `source = 'share'`, new `file_draft_id`,
  and `organization_id` from the folder of a customer's file. A company file has no organization, and is not shown as
  „nepriradené“ („Odkiaľ“ shows the file).
- The list shows it like other activities. The detail shows the file, the typed name, what the draft holds, and a link to
  the draft, and through it the document.
- **Tracking** _(Q-15)_: the draft's state, and a dated trail on the detail: created, merged into, changes
  approved and rejected, comments answered and agreed to, version made, discarded, with who did it.
- The bell tells whoever created the link, on the same terms as other types ([T-5]).

---

## 9. Security

### 9.1 Access

| Threat                              | Answer                                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Guessing a link                     | 256 random bits; `limitPerIp` on every public procedure; the same answer for every kind of invalid link                |
| Guessing a password                 | Argon2; per IP and per link limits in `RATE_LIMITS`; the failure that reaches the link's limit locks it for the window |
| Lockout used against a real visitor | It lasts 15 minutes at most, and a colleague can issue a new link at once                                              |
| Reading without the password        | Nothing about the file before unlocking; every procedure checks the cookie against the link and `password_generation`  |
| Mode bypass                         | Mode is read from the database on each call, never from the cookie or the client                                       |
| Changing somebody else's comment    | The visitor comes from the server's cookie, never from input; the row's `visitor_id` must match                        |
| Link or token leaking               | The fragment; `Referrer-Policy`; `X-Robots-Tag: noindex` on the frame; the token never logged; stored hashed and encrypted |
| Cross-site requests                 | `SameSite=Strict`, POST only, as the rest of Intra                                                                     |
| A public call acting as a colleague | Public procedures ignore `ctx.session`; a signed-in colleague opening a link is a visitor like any other               |
| Reaching other files                | Every query goes through the link's `file_id`; ids of versions and drafts are checked against that file                |
| Bucket access                       | Bytes stay private; signed GET with a short life, `attachment` except PDF and photos, as `downloadUrl`                 |
| Filling the database or the trail   | Limits on saves and comments per link and IP ([S-34]); refusals by the limiter leave no audit row                      |
| Flooding Aktivity                   | At most 30 saves per link an hour, and a password is required to save                                                  |

### 9.2 Showing stored HTML [S-11, S-12]

The app and the public page share `intra.alma-care.eu`, so stored HTML must never run as this origin. One way for all
modes, in the public page and in a colleague's view of a draft:

- A frame from its own route, `/share-frame/<token>`, with a signed token for that content, valid 5 minutes. The response
  carries `Content-Security-Policy: sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none';
script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https:; font-src data:; connect-src 'none';
form-action 'none'; frame-ancestors 'self'`.
- No `allow-same-origin`: the document runs with an opaque origin, even when the address is opened directly. It cannot
  reach cookies, the API or the page, and it cannot fetch anything. This is stricter than the existing preview's frame.
  The route opts out of the shell's nonce policy on purpose and is added to `API_PREFIXES`.
- **Bridge:** the server adds a small script of ours, which reports the block under the cursor, selections and geometry
  to the page by `postMessage`. The document's scripts could forge these, so the page treats every message as untrusted: it
  checks the sender is the frame, accepts only known block numbers, shows quotes as text. A forgery can at most misplace a
  comment of that visitor. Editors, panels and overlays are in the page, out of the document's reach.
- **What the server removes** from what it sends, never from the file: the `alma-edit` script and bar, `<link>`s to Google
  Fonts [S-13], `meta http-equiv` and `base`. Nothing else: the frame's policy stops the rest.

### 9.3 Accepting edits [S-32]

The client never sends a document. It sends **operations** on fragments of a known version, and the server builds the file:

1. The server parses the version with `parse5` (a new dependency, to approve) with source locations, and numbers the
   fragments. The HTML in the frame carries these numbers as attributes. The source of a fragment for the editor comes from
   the server by its number, never from the frame.
2. A save sends `{ baseVersionId, ops: [{ block, kind: 'edit' | 'delete', html? }] }`.
3. Each `html` goes through an **allow-list sanitizer** on the server: only the elements the editor produces, only `class`,
   `style`, `href`, `src`, `alt`, `colspan`, `rowspan`, `title`. `href` only `http`, `https`, `mailto`, `tel`, `#`. `src` only
   as already in that fragment. `style` only an allow-listed set of properties and no `url()`. What falls outside is dropped.
4. A version is the source with those byte ranges replaced, and the sanitizer runs once more at that moment. Everything
   untouched stays byte for byte, including the document's scripts, which came from a colleague. An outsider can therefore never
   add a script, an event handler, a form or a frame, only delete one along with its fragment.
5. `addVersionFromBytes` stores it: its checks of extension, size and signature apply.

### 9.4 Limits [S-34]

Comment 4000 characters, name 80, 200 changes per save, 256 KB per fragment, 5 MB per draft, the result at most the file limit
of 50 MB. Editing is offered for a document up to 10 MB; a larger one can be read and commented on. Text typed by outsiders is
rendered as text by React, never as HTML, in the app too.

### 9.5 Other

- **No tracking of opening** [S-33], in line with D-13 and the owner's decision of 30 Oct 2026: no list of who opened a link and
  when. The audit trail and the activity hold what changes something. Wrong passwords only count
  towards the limits.
- **External pictures** tell their servers the visitor's address, with no referrer, as in the preview (D-54). Google Fonts no longer do.
- **Personal data:** the typed name is kept with the draft or comment as long as the file exists, and the 90-day cookie is needed
  for what the visitor does, not for tracking. Noted for the owner's list of legal questions.

---

## 10. Data

New tables, by Drizzle migration:

- `file_shares`: `id`, `file_id` (cascade, unique), `token_hash` (unique), `token_encrypted`, `mode`, `password_hash`,
  `password_generation`, `expires_at`, `created_by_user_id`, `created_at`, `updated_at`. A check: `mode = 'read' or
password_hash is not null`. Cancelling deletes the row, so a new link is a new address.
- `file_share_visitors`: `id`, `file_id` (cascade), `share_id` (set null), `name`, `device_token_hash`, `created_at`, `last_seen_at`.
- `file_drafts`: `id`, `file_id` (cascade), `base_version_id`, `visitor_id`, `author_names`, `state`, `merged_into_id`,
  `version_id`, `created_by_user_id` (of a merge), `created_at`, `finished_at`.
- `file_draft_changes`: `id`, `draft_id` (cascade), `block`, `kind` (`edited`, `deleted`), `old_html`, `new_html`, `author_name`,
  `decision` (`pending`, `approved`, `rejected`), `decided_by_user_id`, `decided_at`.
- `file_comments`: `id`, `file_id` (cascade), `version_id`, `parent_id`, `anchor` (jsonb), `body`, `visitor_id` or `user_id`
  (exactly one), `author_name`, `agreed_at`, `agreed_by_user_id`, `created_at`, `updated_at`, `deleted_at`.
- `file_draft_comments`: `draft_id`, `comment_id`. All drafts of one session hold its comments, and a merged draft holds those of
  its sources, so an answer shows everywhere.

Changed:

- `file_versions`: `external_author` (text), the new `share` value of `file_version_source`. The draft it
  came from is found through `file_drafts.version_id`. A new enum value cannot be used in the migration
  that adds it, so no check ties the two together.
- `lead_activities`: new `share` value of its source, `file_draft_id` (set null). `activity_types`: seeded „Zmena dokumentu“.
- The audit allow-list gets `fileShare`, `fileDraft` and `fileComment`: ids, the mode, counts, decisions. Never a name, a text or the
  password (`input-keys.test.ts`).

---

## 11. Stages

Each one deployable and with its own commits:

1. **S1 Read:** the dialog, tables, public page, password, expiry, all file types, the isolated frame.
2. **S2 Comments:** visitors and the 90-day cookie, bridge, comments, anchoring, the panel in the preview.
3. **S3 Edits and drafts:** parser, sanitizer, overlay, editor, top bar, saving a draft, the column, the activity.
4. **S4 Approval:** the draft view, decisions, tracked changes, new version, external author in the lists.
5. **S5 Merging:** selecting, merging, alternatives, moving onto a newer version.

Tests beyond the usual: an XSS corpus against the sanitizer; the frame's policy on its response; byte identity of untouched
ranges; integration tests of every public procedure with no cookie, a wrong link's cookie, an old password generation, a lowered
mode, and another visitor's comment; rate limits; merges with duplicates and alternatives; and an end-to-end run on copies of
„Solutions Architecture“ and „Ekonomika“. `docs/functional-spec.md` gets a D-number on agreement.

---

## 12. Screens for phase 2

„Súbory › Zdieľať“ (three modes, with and without a password), „Súbory › Stĺpec Koncepty“, „Súbory › Koncepty súboru“, „Súbory ›
Náhľad s komentármi“, „Súbory › Koncept“ (changes and comments, a change's revisions, alternatives, what no longer fits, version
ready), „Súbory › Verzie“ with an external change, „Aktivity › Zmena dokumentu“, „Zdieľanie › Prístup“ (new and returning visitor),
„Zdieľanie › Neplatný odkaz“, „Zdieľanie › Čítanie“, „Zdieľanie › Súbor bez náhľadu“, „Zdieľanie › Komentovanie“, „Zdieľanie › Úpravy“
(fragment, editor, bar, changes), and a phone width of the public pages.

---

## 13. Rule for documents

The owner wants documents to use a font that is not tied to a provider such as Google. Documents already using one get a similar
system font. This holds for new documents at once; the 10 existing ones are a separate task, and meanwhile [S-13] applies.

---

## 14. Answers of the first round (2026-11-01)

| #    | Answer                                                                                                                                   |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Q-1  | Scripts run when reading. The owner asks whether also in comments and edits: Q-13                                                        |
| Q-2  | No Google Fonts: section 13                                                                                                              |
| Q-3  | One link per file                                                                                                                        |
| Q-4  | Optional expiry                                                                                                                          |
| Q-5  | Download allowed                                                                                                                         |
| Q-6  | Modes are cumulative                                                                                                                     |
| Q-7  | A visitor changes and deletes only their own comments, in their session; later only if recognized, and then no name again: section 5.1   |
| Q-8  | Comments are carried over by the quote                                                                                                   |
| Q-9  | Concept changed: an outsider makes no version, only drafts; merging; approval by a colleague: section 7                                  |
| Q-10 | Solved by Q-9: two drafts                                                                                                                |
| Q-11 | Accepted: part by part, deleted whole, no new images                                                                                     |
| Q-12 | A new activity type, an activity per draft with tracking and a link; drafts can be shown and comments resolved there: sections 7, 8      |

---

## 15. Second round (2026-11-01)

The owner accepted every recommendation.

| #    | Question                                                                 | Decision                                                                                             |
| ---- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Q-13 | Scripts in comments and edits as well?                                   | Yes, it is possible and it is one way for all modes. Calculated values cannot be edited              |
| Q-14 | A second save in one session: everything so far, or only what is new?    | Everything so far. Each draft is complete, and a merge removes the duplicates                        |
| Q-15 | What does „tracking“ of the activity mean?                               | The draft's state and a dated trail on the activity's detail                                         |
| Q-16 | May a colleague rewrite a change in the draft before approving?          | No in this step: approve or reject, then adjust in a new version                                     |
| Q-17 | Does a visitor see a colleague's reply, and under what name?             | Yes, with the colleague's name                                                                       |
| Q-18 | Does a merged draft get an activity of its own?                          | No, a colleague made it; the original activities lead to it                                          |
| Q-19 | Whose version is it?                                                     | Both: „Externá zmena <meno>“, and the colleague who approved it. A merge lists all the names         |
| Q-20 | Can a comment still be changed after a colleague answered it?            | Yes until it is agreed to; after that no                                                             |
| Q-21 | Only comments and no changes: is it a draft too, and how is it sent?     | Yes, made by itself at the first comment of a session, without a button, with one activity           |
| Q-22 | Must every change be approved, or may it be rejected?                    | Each is decided either way, and a rejected one stays out of the version                              |

---

## 16. A colleague opening the link (agreed, 2026-11-01)

Asked by the owner after the rest was implemented. The answers are in 16.3. Screens first, then code.

A colleague has access to every file anyway, so a link is only a way to find the file. It opens the file in
„Súbory“, whatever the link's mode, password or expiry, and always in the view mode first.

- **Signed in:** `/zdielanie#<token>` restores the session and asks the new `fileShare.resolve` (POST, the token in
  the body, `file.read`) for the file and its folder, then goes to `/files` with the file's preview open. No access
  screen and no public session.
- **Not signed in:** the access screen gets „Prihlásiť sa účtom Alma“. So does „Odkaz nie je platný“, as an expired
  link must still open for a colleague, and that screen must keep looking the same for every invalid link. The token
  waits in `sessionStorage` through the login, never in an address (CLAUDE.md rule 5), and is removed once used.
- **Expiry** does not apply to `fileShare.resolve`. A cancelled link is gone from the database and a file in the trash
  is not live, so both stay „Odkaz nie je platný“ after signing in too.
- **Visitors are unchanged:** without a session nothing of this reaches them, and `publicShare.*` still ignores
  `ctx.session`.

### 16.1 View and edit in „Súbory“

- The preview of an HTML file gets „Upraviť“, for anyone with `file.write`, and the file's menu gets the same item, which
  opens the dialog directly in the edit mode. The preview itself stays as it is (D-54): no scripts. Other files have no
  edit mode.
- The edit mode is the isolated frame, hover icons, editor and comments of section 6, in a full-screen dialog, with the
  colleague's name. The server path is the same: operations and the sanitizer of section 9.3, so no script can be added
  here either. Documents over 10 MB offer comments only.
- **The top bar has two ways to save [S-35]:** „Uložiť ako koncept“ always, and „Uložiť ako novú verziu“ only while this
  visit of the edit mode wrote no comment, since a comment waits for an answer and a version has no place for it.
  With a comment written the button is off and says why.
- **Comments of a colleague [S-36]** are saved at once and work as a visitor's (6.1): the first of a visit makes a
  comments-only draft, and saving a draft fills it. The colleague changes and deletes their own until they are agreed to.
  They show on the public page under the colleague's name.
- **A colleague's draft** goes through the same list and approval as any other, and makes no activity: Aktivity hold what
  somebody outside did [S-37].
- **„Uložiť ako novú verziu“** makes a version at once under the colleague's name, ordinary `web`. A newer version arriving
  meanwhile: changes whose fragment is unchanged apply to it; the save stops and names the ones that no longer fit, and
  they stay on the page, where they can still go into a draft.

### 16.2 Data and API

- `file_comments` and `file_drafts` take a colleague as they are: `user_id` and `created_by_user_id` exist, `session_id`
  is a random id per opening of the edit mode, sent by the page.
- `fileShare.resolve`, `fileShare.editFrame`, `fileShare.fragment`, `fileShare.comments` and its comment mutations, and
  `fileShare.saveEdits` (`mode`: `version` or `draft`), all behind `can()`: `file.write`.

### 16.3 Answers

| #    | Question                                         | Answer                                                                                     |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| Q-23 | Does a colleague's edit make a version at once?  | The colleague chooses: a new version, unless they wrote a comment, or a draft              |
| Q-24 | Comments in the colleague's editing view?        | Covered by Q-23: they can write them                                                       |
| Q-25 | Only through a link, or also from „Súbory“?      | Both: viewing a file in Intra offers the button to edit it                                 |
| Q-26 | A link in the „Čítanie“ mode?                    | A colleague can edit too, but always sees the view first and switches with that button     |
| Q-27 | A way to see the page as the visitor does?       | Not now                                                                                    |
