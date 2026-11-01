# Súbory: public sharing of a file (draft)

Status: **draft, phase 1 of 3** (2026-11-01). Waits for the owner's answers to section 12; screens
follow on the canvas „Alma Intra – screens“, page „Súbory“, and only then code. Builds on section 7
of `docs/functional-spec.md` and D-43, D-54.

Marks: **[S-n]** a decision of this spec. Items marked *(Q-n)* are the recommendation until the owner
answers question n.

---

## 1. Why

The owner wants to give any file in „Súbory“ to somebody outside Intra through a unique address, with
or without a password. An HTML file can also be commented on or edited by that person, and an edit
comes back as a new version of the file, marked as an external change.

These are public routes without a sign-in, serving stored HTML that outsiders can change. Section 8 is
as much a part of the requirement as the features.

---

## 2. What real documents look like

Measured on the 14 HTML documents in `Firemné dokumenty` on 2026-11-01. This shapes several decisions:

| Finding                                                                              | Consequence                                           |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| All 14 carry scripts, several of them the `alma-edit` bar („Upraviť“, „Uložiť“)      | That bar must never show on a shared page [S-11]      |
| „Ekonomika“ and „Business plan“ are live calculators; the deck is driven by a script | Without scripts they do not work as meant *(Q-1)*     |
| Most load Google Fonts through a stylesheet                                          | Blocked by today's frame policy *(Q-2)*               |
| Heavy use of `class` and `style` (the deck: 1090 `style`, 963 `div`, 91 `svg`)       | A plain TipTap document would destroy them [S-20]     |
| 45 tables in „Solutions Architecture“, 32 `details`                                  | Tables and collapsed parts are first-class            |
| The deck has 6.4 MB, others up to 853 KB                                             | Limits on what travels and what is edited [S-27]      |

---

## 3. Scope

**In:** the „Zdieľať“ dialog, a unique address, an optional password per file, three modes for HTML, the
public page, comments, fragment editing with tracked changes, a new version from an external editor,
comments in the app's preview.

**Out of this step:** sharing a folder; several files at one address; sharing through MCP (Claude);
adding a new image or uploading anything from the public page; editing a non-HTML file; commenting on
a non-HTML file; accounts for external people; real-time co-editing.

---

## 4. In the app

### 4.1 „Zdieľať“

- A new item „Zdieľať“ in a file's menu in the Files list [S-1], for anyone with the new permission
  `file.share` (through `can()`, all admins today).
- One link per file *(Q-3)*. The dialog holds:
  - the address with „Kopírovať odkaz“;
  - „Režim“, for an HTML file only: „Čítanie“, „Komentovanie“, „Úpravy“. Others are always „Čítanie“;
  - „Heslo“: optional for „Čítanie“, required for the other two [S-2];
  - „Platnosť do“: optional, empty means until cancelled *(Q-4)*;
  - „Zrušiť zdieľanie“;
  - for a file in a customer's folder, one line saying it can hold personal data of that customer.
- The password is stored only as an Argon2 hash, as all passwords in Intra are, so it can be replaced
  but not shown again. The dialog offers „Vygenerovať“ and copying at the moment it is set. At least 8
  characters [S-3].
- Changing the password or cancelling the link ends every open public session at once. Lowering the mode
  applies at the visitor's next request [S-4].
- A shared file carries an icon in the list, and the Files filter gets „Zdieľané“ *(Q-12)*.

### 4.2 Life of a link

- A link always shows the file's **current version** [S-5]. A new version reaches the link's visitors on
  their next load; while reading they are offered it like in the preview („Načítať“).
- A rename or a move changes nothing for the link. A file in the trash, or of a deleted customer, answers
  like an unknown link. A file restored from the trash has its link working again. A purge deletes the
  link and the comments. A copied file is not shared [S-6].

### 4.3 Versions

- A version from the public page is `created_via = 'share'` with `external_author` holding the typed name,
  and no `created_by_user_id`. Everywhere an author shows (list, sheet, history) it reads
  „Externá zmena <meno>“ [S-7]. „Externá zmena“ is always part of it: the name is self-declared, nobody
  verified it, and it must not pass for a colleague.

### 4.4 Comments in the preview

- An HTML file's preview in the app gets a panel „Komentáre (n)“, with the commented places highlighted in
  the document. Comments never create a version [S-8].
- A colleague can reply and mark a comment resolved or delete it *(Q-7)*. Comments can exist only on a file
  shared at some point; they stay visible after the link is cancelled.

---

## 5. The public page

- Address: `https://intra.alma-care.eu/zdielanie#<token>`. As with `/zaujem#<token>`, the token is in the
  fragment and goes to the API in POST bodies, so it reaches no proxy log and no referrer (CLAUDE.md rule
  5) [S-9]. A random 256 bits; Intra stores its SHA-256 for lookup and the token encrypted with
  `DATA_ENCRYPTION_KEY`, so „Kopírovať odkaz“ works later.
- A route outside `_app`, with the Alma mark, the file's name once unlocked, and nothing else about Intra:
  no folder path, customer or colleague's name [S-10].
- **Access screen**, before anything of the file is sent, not even its name:
  - „Čítanie“ without a password: skipped;
  - „Čítanie“ with a password: „Heslo“;
  - „Komentovanie“ or „Úpravy“: „Vaše meno“ and „Heslo“, both required, 2–80 characters for the name.
- After unlocking, an httpOnly, `SameSite=Strict` cookie for 12 hours in that browser holds the link, the
  name and the password generation. An expired session asks again over the page and keeps what is unsaved.
- A wrong token, a cancelled or expired link, and a file in the trash all give the same screen:
  „Odkaz nie je platný“.
- „Stiahnuť“ is offered in every mode through a short-lived signed URL *(Q-5)*.

### 5.1 By type

- HTML: section 6. Markdown, PDF, photos: shown as in the app's preview (`previewKind`).
- Everything else, SVG and video included: the name, the size and „Stiahnuť“.

### 5.2 Reading HTML

- Pictures show, links work. A link inside the document moves within it and opens the collapsed parts
  around the target; any other `http`, `https`, `mailto` or `tel` link opens in a new tab without an opener
  or referrer. Other schemes do nothing [S-12].
- Scripts of the document: see Q-1, which decides between two ways of serving it (section 8.2).

---

## 6. Comments and edits on an HTML file

The modes are cumulative: „Úpravy“ can also comment, „Komentovanie“ can also read *(Q-6)*. In both, the
document's scripts do not run, because the page itself must reach into the document [S-13].

### 6.1 Commenting

- Selecting any text shows „Komentovať“ at the selection. An image, an SVG or a block shows it on hover
  (on a touch screen on a tap) [S-14].
- The comment shows with the typed name and the time. All comments are visible to everyone with access
  *(Q-7)*. A side panel lists them in document order, and a click scrolls to the place.
- A comment is anchored to the version and to its place: the block, the quoted text with what precedes and
  follows it, or the element. On a new version the same quote is searched for; a comment whose place is gone
  stays in the panel under „Bez miesta v aktuálnej verzii“ *(Q-8)*.

### 6.2 Editing

- **Hover:** the fragment under the cursor is outlined, with icons at its top right: „Upraviť“, „Zmazať“ and,
  on a changed fragment, „Zobraziť zmeny“. On a touch screen a tap selects [S-15].
- **What a fragment is:** the smallest of `p`, `h1`–`h6`, `ul`/`ol` as a whole, `table` as a whole,
  `blockquote`, `pre`, `figure`, `img`, `svg`, `hr`, and a `div` or `section` holding text directly [S-16].
  An extra icon „Nadradený blok“ climbs to the enclosing `div`, `section` or `details`, so a whole card or
  chapter can be selected (not in the owner's request, needed for deleting one) [S-17].
- **„Upraviť“:** a WYSIWYG editor (TipTap, already in the app) opens over the fragment with its content and
  „Uložiť“, „Zrušiť“. It offers text styles, lists, links and, in a table, rows and columns [S-18]. „Uložiť“
  closes the editor and changes the page only.
- **„Zmazať“:** removes the fragment, without a confirmation since it can be undone (below) [S-19].
- **Fidelity [S-20]:** existing `class` and `style` survive an edit. A fragment that the editor cannot hold
  without loss (an `svg`, a chart, a layout of nested blocks, anything with a script) offers no „Upraviť“: it
  can be deleted, or its inner parts edited one by one. This is checked by a round trip before the editor
  opens. No image can be added or replaced in this step *(Q-11)*.
- **Top bar:** after the first change a bar stays on top: the number of changes, „Zahodiť zmeny“ (with a
  confirmation) and „Uložiť ako novú verziu“. A fragment edited back to the original drops out of the count,
  and with no changes the bar goes away [S-21].
- **In memory:** until „Uložiť ako novú verziu“ changes live in that tab only, as asked. Leaving or reloading
  warns, and then they are lost [S-22].
- **„Uložiť ako novú verziu“:** a new version in Intra, „Externá zmena <meno>“. The page stays open and further
  edits start from that version [S-23].

### 6.3 Tracked changes

- The normal view shows the final text. „Zobraziť zmeny“ on a fragment shows what was added and removed, word
  by word: added underlined in green, removed struck out in red, each with who and when [S-24].
- A deleted fragment has nothing to hover, so in „Úpravy“ a thin marker stays in its place with the same icon
  and „Vrátiť späť“ *(Q-9)* [S-25].
- Unsaved changes show the same way. Saved ones stay visible across the following external versions until a
  colleague adds a version in Intra, which starts a new baseline *(Q-9)*. A colleague sees them in the preview
  of such a version through „Zobraziť zmeny“ *(Q-9)*.

### 6.4 Somebody else saved first

At „Uložiť ako novú verziu“ the page sends the version it started from. If the file moved on meanwhile, a
dialog says so, naming the newer version and who made it, with „Uložiť aj tak“ and „Späť k úpravám“. „Uložiť aj
tak“ creates the next version from the visitor's base plus their changes, and that version's note says which
version it is based on. Nothing is lost, as every version stays in the history *(Q-10)* [S-26].

---

## 7. Data

New tables, by Drizzle migration, one per concern:

- `file_shares`: `id`, `file_id` (cascade), `token_hash` (unique), `token_encrypted`, `mode`
  (`read`/`comment`/`edit`), `password_hash`, `password_generation`, `expires_at`, `created_by_user_id`,
  `created_at`, `updated_at`. Unique on `file_id` *(Q-3)*. A check: `mode = 'read' or password_hash is not null`.
  Cancelling deletes the row: a new link must be a new address.
- `file_comments`: `id`, `file_id` (cascade), `version_id`, `parent_id`, `anchor` (jsonb), `body`,
  `author_name` or `user_id` (exactly one), `resolved_at`, `resolved_by_user_id`, `created_at`, `deleted_at`.
- `file_version_changes`: `version_id` (cascade), `base_version_id`, `position`, `kind` (`edited`, `deleted`),
  `old_html`, `new_html`. What „Zobraziť zmeny“ reads.

Changed:

- `file_versions`: `external_author` (text) and the new `share` value of `file_version_source`; a check that
  a `share` version has an author and no user.
- `purgeFiles` already removes a file's rows; these follow by cascade.
- The audit allow-list gets `fileShare` and `fileComment`: ids, the mode, counts. Never the name, the comment's
  text, or the password (`input-keys.test.ts`).

---

## 8. Security

### 8.1 Access

| Threat                               | Answer                                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Guessing a link                      | 256 random bits; `limitPerIp` on every public procedure; the same answer for every kind of invalid link                    |
| Guessing a password                  | Argon2; per IP and per link limits in `RATE_LIMITS`; the failure that reaches the link's limit locks it for the window     |
| Lockout used against a real visitor  | It lasts 15 minutes at most, and a colleague can issue a new link at once                                                  |
| Reading without the password         | Nothing about the file before unlocking; every procedure checks the cookie against the link and `password_generation`      |
| Mode bypass                          | Mode is read from the database on each call, never from the cookie or the client                                           |
| Link or token leaking                | The fragment; `Referrer-Policy`; `X-Robots-Tag: noindex`; the token never logged; stored only hashed and encrypted         |
| Cross-site requests                  | `SameSite=Strict`, POST only, as the rest of Intra                                                                         |
| A public call acting as a colleague  | Public procedures ignore `ctx.session`; a signed-in colleague opening a link is a visitor like any other                   |
| Reaching other files                 | Every query goes through the link's `file_id`; ids of versions come from the server and are checked against that file      |
| Bucket access                        | Bytes stay private; signed GET with a short life, `attachment` except PDF and photos, as `downloadUrl`                     |
| Filling storage or the audit trail   | Limits on saves and comments per link and IP; the size limits of [S-27]; refusals by the limiter leave no audit row        |

### 8.2 Showing stored HTML

The app and the public page share `intra.alma-care.eu`, so stored HTML must never run as this origin [S-11].

- **Comments and edits:** the scheme of the existing preview. An `iframe` with `srcdoc` and
  `sandbox="allow-same-origin"`, no `allow-scripts`, no `allow-forms`, no `allow-popups`. The page's own code
  reaches into the frame, and overlays and popups live in the page, not in the document, so the document's CSS
  cannot touch them.
- **Reading, if Q-1 is answered with scripts:** a frame from its own route, `/share-frame/<short-lived signed
  token>`, whose response carries `Content-Security-Policy: sandbox allow-scripts allow-popups
  allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline'; connect-src 'none';
  form-action 'none'; …`. No `allow-same-origin`: the document runs with an opaque origin, even when its address
  is opened directly. It cannot reach cookies, the API, or the page, and cannot fetch anything. This route opts
  out of the shell's nonce policy on purpose and is added to `API_PREFIXES`.
- **Without scripts in any mode:** as for comments and edits.
- **What the server removes before sending** to any of these [S-11]: the `alma-edit` script and bar. In the
  scriptless modes also every `script`, `on*` attribute, `javascript:` address, `meta http-equiv`, `base`,
  `iframe`, `object`, `embed`, `form`. Removal is a second layer under the sandbox, and changes only what is
  sent, never the file.
- **Frame policy:** as `fileDocument`: `default-src 'none'; img-src data: https:; style-src 'unsafe-inline';
  font-src data:`, plus Google Fonts *(Q-2)*.

### 8.3 Accepting edits

The client never sends a document. It sends **operations** on fragments of a known version, and the server
builds the file [S-28]:

1. The server parses the version with `parse5` (a new dependency, to approve) with source locations, and numbers
   the fragments. The HTML sent to the client carries these numbers as attributes.
2. A save sends `{ baseVersionId, ops: [{ block, kind: 'edit' | 'delete', html? }] }`.
3. Each `html` goes through an **allow-list sanitizer** on the server: only the elements the editor produces, only
   `class`, `style`, `href`, `src`, `alt`, `colspan`, `rowspan`, `title`. `href` only `http`, `https`, `mailto`,
   `tel`, `#`. `src` only as already in that fragment. `style` only an allow-listed set of properties and no `url()`.
   What falls outside is dropped, and what the client sent is never trusted to be what its editor produced.
4. The new file is the old source with those byte ranges replaced. Everything untouched stays byte for byte,
   including the document's scripts, which came from a colleague. An external editor can therefore never add
   a script, an event handler, a form or a frame, but only delete one along with its fragment.
5. `addVersionFromBytes` stores it: its checks of extension, size and signature apply.

### 8.4 Limits [S-27]

- Comment 4000 characters, name 80, 200 operations per save, 256 KB per fragment, the result at most the
  file limit of 50 MB.
- Editing is offered for a document up to 10 MB; a larger one can be read and commented on.
- Text typed by outsiders (names, comments) is rendered as text by React, never as HTML, in the app too.

### 8.5 Other

- **No tracking of opening** [S-29], in line with D-13 and the owner's decision of 30 Oct 2026: no list of who
  opened a link and when. The audit trail holds what changes something: link created, changed, cancelled, a
  comment, an external version, a lockout.
- **External pictures and fonts** tell their servers the visitor's address, with no referrer. Already so in the
  preview (D-54).
- **Personal data:** the typed name is kept with the version or comment as long as the file exists. Noted for
  the owner's list of legal questions.

---

## 9. Notifications

Whoever created the link gets an in-app notification (`notifications`, new kinds) for a new comment and for an
external version, one per save and at most one per comment thread within 10 minutes *(Q-12)*.

---

## 10. Stages

Each one deployable and with its own commits:

1. **S1 Read:** the dialog, tables, public page, password, all file types, security tests.
2. **S2 Comments:** public comments, anchoring, panel in the public page and the app's preview, notifications.
3. **S3 Edits:** parser, sanitizer, overlay, editor, top bar, saving, external author in the lists.
4. **S4 Tracked changes:** the changes table, the diff view, markers, the preview in the app.

Tests beyond the usual: an XSS corpus against the sanitizer and the scriptless removal; byte identity of untouched
ranges; integration tests of every public procedure with no cookie, a wrong link's cookie, an old password generation
and a lowered mode; rate limits; and an end-to-end run on copies of „Solutions Architecture“ and „Ekonomika“. `docs/functional-spec.md` gets a D-number on agreement.

---

## 11. Screens for phase 2

„Súbory › Zdieľať“ (three modes, with and without a password), „Súbory › Náhľad s komentármi“, „Súbory › Verzie“ with
an external change, „Zdieľanie › Prístup“, „Zdieľanie › Neplatný odkaz“, „Zdieľanie › Čítanie“, „Zdieľanie ›
Súbor bez náhľadu“, „Zdieľanie › Komentovanie“, „Zdieľanie › Úpravy, zvýraznený fragment“, „Zdieľanie › Úpravy, editor“,
„Zdieľanie › Úpravy, lišta zmien“, „Zdieľanie › Zobrazenie zmien“, „Zdieľanie › Novšia verzia“, and a phone width of the
public pages.

---

## 12. Open questions

Put to the owner in Slovak; each has a recommendation.

| #    | Question                                                         | Recommendation                                                                                                     |
| ---- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Q-1  | Do a document's scripts run on a shared page in „Čítanie“?       | Yes, in the isolated frame of 8.2. In comments and edits they never run, so a calculator shows its static state    |
| Q-2  | Do Google Fonts load on a shared page?                           | Yes, only those two hosts, so documents look as written; the visitor's address reaches Google                      |
| Q-3  | One link per file, or several (per recipient)?                   | One. The tables allow more later                                                                                   |
| Q-4  | Optional expiry date?                                            | Yes, optional, empty by default                                                                                    |
| Q-5  | Can a visitor download the file?                                 | Yes, in every mode. A DOCX has no other way                                                                        |
| Q-6  | Are the modes cumulative?                                        | Yes: edit includes comment                                                                                         |
| Q-7  | Who sees and handles comments?                                   | Everyone with access sees all and may reply. Colleagues resolve and delete. A visitor cannot delete                |
| Q-8  | Comments on a new version?                                       | Carried over by the quoted text; the rest go under „Bez miesta v aktuálnej verzii“                                 |
| Q-9  | How long do tracked changes stay visible, and who sees them?     | Across consecutive external versions until a colleague's version; in the app too; a marker with undo for a deleted fragment |
| Q-10 | Two people editing, the second one saves later?                  | Warn, offer „Uložiť aj tak“ as the next version; both stay in the history                                          |
| Q-11 | A complex block (chart, cards), images?                          | Edited part by part, deleted whole; no new or replaced image in this step                                          |
| Q-12 | Notifications, and an overview of what is shared?                | In-app to the link's creator; an icon and a filter „Zdieľané“ in Files; no e-mail                                  |
