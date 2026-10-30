# Alma Intra: functional specification (v0.3)

Status: **functionality agreed**, nothing is implemented. Based on an analysis of `code/alma-ados`
(state of 26 Oct 2026) and the owner's answers of 26 Oct 2026 (v0.1 and v0.2 questions). Every
question is answered; proposals the owner did not comment on were accepted as proposed.
Next steps: screen designs, then implementation in stages.

Language: code, identifiers, docs, commit messages and Jira (project **INTRA**) are English only.
Slovak appears only in UI strings (and in customer-facing e-mail content). Slovak UI copy is
quoted in „…“ where needed.

Decisions are marked **[D-x]** (the number of the question they answer) and are listed in
section 11.

---

## 1. What Alma Intra is

An internal web application of the company that operates Alma, used to:

1. keep customers, their contacts and the history of communication with them (a light CRM),
2. send professional, personalised e-mails to selected customers from templates that can be
   edited before sending, and see the customers' replies in the app,
3. store company documents and customer files in one place, attach them to e-mails and
   activities, and let Claude read and edit them.

It is a **separate application**: its own repository (`code/alma-intra`), database, domain and
users. It shares no data and no runtime with Alma ADOS; it reuses its technology, design and code
(copied, not imported).

Out of scope for now: mobile app, more than one role, sales pipeline / deals, invoicing,
CSV import (**[D-10]**: not needed).

---

## 2. What is taken from Alma ADOS

### 2.1 Stack (unchanged)

| Layer         | Alma ADOS                                                                 | Alma Intra                                  |
| ------------- | ------------------------------------------------------------------------- | ------------------------------------------- |
| Monorepo      | pnpm 10 + Turborepo, Node 22, TypeScript                                  | same                                        |
| API           | NestJS modular monolith, tRPC, Drizzle ORM, PostgreSQL 16                 | same                                        |
| Jobs          | pg-boss (installed by a migration)                                        | none: polled tables in the API process **[D-32]** |
| E-mail        | Resend + React Email, transactional outbox (ADR-015)                      | same + campaigns, delivery webhooks, inbound |
| Files         | S3 API (Hetzner Object Storage, MinIO locally), signed URLs (ADR-007)     | same, extended into the Files module        |
| Web           | Vite + React 19, TanStack Router/Query/Table, RHF + Zod, shadcn/ui, TW 4  | same + a WYSIWYG editor (TipTap, **[D-11]**) |
| Mobile        | Expo                                                                      | **none**                                    |
| Tests         | Vitest, Testcontainers, Playwright                                        | same                                        |
| Hosting       | Hetzner + Coolify, the API image serves the web (ADR-017), age backups    | same (details later)                        |
| Observability | Sentry (EU, scrubbed), pino logs without personal data                    | same                                        |

### 2.2 Solutions taken over almost 1:1

- **Authentication** (`apps/api/src/auth`): e-mail + password (argon2id), 15-minute access token,
  rotating refresh token in an httpOnly cookie, HIBP check of new passwords, rate limits, password
  reset, activation by invitation (`/activate`), TOTP second factor with recovery codes and
  „remember this device“, logout after inactivity.
- **First-user bootstrap**: a CLI command like `admin:create-super-admin` (creates a user without a
  password and mails an invitation).
- **Audit** (`audit_events`, the interceptor, the allow-list of what an event may contain).
- **Mail outbox, worker and Resend transport**, snapshot tests of templates.
- **Logging and scrubbing** (`SENSITIVE_KEYS`, `NoEchoExceptionFilter`), security headers, the SPA
  shell with a CSP nonce, `/health`.
- **Storage module** (`apps/api/src/storage`): signed PUT/GET, upload confirmation by HEAD and file
  signature, keys made of ids, never of file names.
- **Dockerfile, CI workflow** (lint, format, typecheck, test, build, integration, e2e), runbook
  (deploy, backups, Sentry, sender domain).
- **Conventions of `CLAUDE.md`** (English everywhere but UI strings, UI copy rules, conventional
  commits, PR checklist). Rules specific to health data and tenants are dropped.

### 2.3 Not taken over

- **Multi-tenancy and RLS** (`organization_id`, `orgProcedure`, `app.org_id`, the tenant-isolation
  suite), the super-admin system role, organization modules, licences, the organization switcher.
  Intra serves one company: `protectedProcedure` + `can()` with one role.
- Everything clinical or domain-specific: patients, care plans, planning, reporting, insurers,
  statistics, AI drafting, intake, migration, maps, km, push notifications, birth-number encryption.

### 2.4 Web components to take over

| Area        | Components (`apps/web/src/…`)                                                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Design      | `styles.css`, `packages/shared/src/tokens.ts`, Figtree, `brand-mark`, `brand-panel` (login), lucide icons                                       |
| Primitives  | all of `components/ui/*` (button, badge, card, dialog, sheet, select, combobox, table, tabs, toast, tooltip, date-picker, switch, form, …)      |
| Shell       | `app-sidebar` (dark teal, collapsible), `user-menu`, `page-header`, `route-error`, `route-fade`, `not-found`, `idle-warning`, `global-search`   |
| Lists       | `data-list` (search, filter chips, sorting, paging), `table-shell`, `empty-state`, `skeletons`, `ui/row-actions`, `ui/action-bar`               |
| Forms       | `ui/form`, `ui/form-section`, `leave-guard`, `lib/form-errors`                                                                                  |
| Detail      | `settings-card`, the patient card's layout, `contact-person-dialog` (pattern for a contact), `kpi-card`                                         |
| Users       | `invite-nurse-dialog` → invite a user, `nurses.index` → user list, `change-password-dialog`, `second-factor`, `account`                         |
| Templates   | `record-templates-card` (ordered list, activate / deactivate) as the pattern for e-mail templates                                              |
| Lib         | `trpc`, `session`, `auth`, `format`, `errors`, `list-return`, `back-trail`, `query-view`, `undo`, `use-sign-out`, `sidebar-state`, `image-resize` |

How: a **one-time copy** (fork) into the new repository, then pruning. A shared npm package for two
apps and a small team is overhead; a `ui` package can be split out later if the need shows.

---

## 3. Users and access

### 3.1 Role

One role, `admin`. **[D-22]** Every member of the company has their own account and, for now,
everyone may do everything, **[D-1]** including managing other users. `can()` stays (one policy table), so a
second role later does not mean rewriting procedures. Every action is recorded under its user.

### 3.2 Functions

- **First user**: created by a server CLI command (`users:create-first --email --name`), receives an
  invitation (valid 72 h) and sets their own password. No public sign-up.
- **User list**: name, e-mail, status (invited / active / deactivated), last sign-in, 2FA on/off.
- **Invite a user**: titles before and after, name, e-mail, phone, position. Resend or withdraw an
  invitation.
- **Titles** of a colleague („Mgr. Jana Horváthová, PhD.“) show only in the user list, the e-mails
  (the sender, `{{sender.name}}`, the invitation) and the communication on a timeline. Everywhere
  else (an owner, who recorded an activity, who changed what) the name stands alone.
- **Deactivate / reactivate** a user; deactivation ends their sessions at once.
- **Safeguards**: nobody deactivates themselves; at least one active user always remains.
- **Reset another user's 2FA** (lost phone).
- **My account**: name, phone, position, **e-mail signature** (used in e-mails), password change,
  2FA, active sessions, **Claude access tokens** (section 7.5).

**[D-2]** 2FA is **mandatory** for everyone (personal data of customers, sending in the company's
name, file access for Claude): a new user sets it up right after activation, before reaching any
other screen.

---

## 4. Organizácie: customers, partners and contacts

Redesigned on 29 Oct 2026; the decisions D-1…D-12 and the reasoning are in
[contacts-redesign.md](contacts-redesign.md), the screens in `design/Org*.dc.html`,
`design/ContactDetail.dc.html` and `design/PersonDialog.dc.html`. One sidebar item, „Organizácie“,
with three tabs:

| Tab           | What it holds                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------ |
| **Zákazníci** | organizations (or private persons) with the role `customer`: status, owner, products, tags        |
| **Partneri**  | organizations (or private persons) with the role `partner`: tags only; no status, owner, products |
| **Kontakty**  | natural persons, at any number of organizations (a position at each) or at none                  |

### 4.1 Organization (`organizations`)

| Field              | Note                                                                                       |
| ------------------ | ------------------------------------------------------------------------------------------ |
| Role               | `customer` or `partner`; „Zmeniť na zákazníka / partnera“ keeps everything shared (D-5)     |
| Kind               | `organization` (a company) or `individual` (a private person); chosen once                  |
| Name               | a company's name; a private person's name follows their person                             |
| IČO, DIČ, IČ DPH   | a company only; IČO unique; name and seat from the register of legal persons **[D-5]**     |
| Status             | a customer only, optional (nothing shown when empty, D-6); `lead` … `not_interested`        |
| Products           | a customer only: none, one or several, each with its counts and price (section 4.5)        |
| Organization       | set for a prevádzka only: the organization it belongs to (section 4.4)                     |
| Owner              | a customer only: the Intra user responsible                                                |
| Address, web, e-mail, phone, source, tags, note, Alma ADOS id | as before; a partner's kind of cooperation is a tag (D-4) |

### 4.2 Person (`contacts`, linked by `contact_links`)

Titles, first and last name, form of address, salutation, e-mail (unique among live persons, D-7),
phone, e-mail status, unsubscribe, note. Where they work is a link per organization: the position
there and whether they are its primary contact (the default recipient). A private-person customer
or partner is linked to its own person as the primary contact, so the person exists once and shows
in Kontakty.

### 4.3 Screens

- **Lists** (each tab): search, dropdown filters that take several values each (D-12; customers:
  status with counts, kind, product, region, tag, owner; partners: kind, region, tag; persons:
  where they work, organization, e-mail state), sorting, paging 20/50/100, bulk e-mail, tag, status
  (customers), CSV, segments saved per tab.
- **Organization detail** (`/organizations/<id>`; old `/customers/<id>` links redirect): header with role, status and quick actions; the
  contact persons with their position, a new one or an existing one from Kontakty; the timeline;
  basics, classification and files; the „…“ menu changes the role, makes a document, deletes.
- **Person detail** (`/contacts/<id>`): positions at their organizations, the person's own
  timeline, personal data, the organizations card (assign, make primary, take off), edit, delete.
- **„Nová osoba“**: the person and any number of organizations; an e-mail already in Kontakty offers
  that person instead.

Deleting is soft everywhere; the communication history stays. Export to CSV; no import
(**[D-10]**).

### 4.4 Prevádzky (establishments) **[D-34]**

Agreed and implemented on 29 Oct 2026; the decisions P-1…P-14 are in
[establishments.md](establishments.md), the screens in `design/Est*.dc.html`. In short:

- A prevádzka is a row of `organizations` with `parent_id` set, one level only. It has its own
  name, address, persons, primary contact, timeline and products; role, status, owner, IČO and
  tags are its organization's. The lists show organizations only, with „3 prevádzky“ under the
  name; the search and the region filter find an organization by its prevádzky.
- The organization's detail shows the Prevádzky table, the products, and a persons table with the
  persons of the prevádzky too; its timeline includes the prevádzky' entries, indented, with the
  switch „Aj prevádzky“.
- An activity, a sent e-mail and a filed reply belong to the organization or one prevádzka: picked
  in „Patrí k“, or found from the persons (all at the same prevádzka: that prevádzka).
- The e-mail wizard offers „Hlavné kontakty aj prevádzok“; templates have `establishment.name` and
  `establishment.address`. Kontakty name a prevádzka with its organization. CSV and Claude (MCP)
  include the prevádzky.
- „Zaradiť pod organizáciu…“ turns an organization without IČO and without prevádzky into a
  prevádzka of another.

### 4.5 Products and price lists **[D-35]**

Agreed and implemented on 29 Oct 2026; the decisions R-1…R-15 are in [products.md](products.md),
the screens in `design/Prod*.dc.html`. In short:

- „Produkty“ in the sidebar: products with a base price and period, and a price list of items from
  a shared catalog (Položky): how many are in the base price, the price of each further one, a
  maximum, recurring or one-off, counted from workloads or not. Prices without and with VAT; the
  VAT rate is set in Nastavenia › Ceny a DPH.
- An organization or a prevádzka holds a product from a date (optionally to one), with counts that
  never go below the package, priced by the list, with a discount (permanent or for some months)
  or at a fixed price. A change of the list applies to every holder unless the price is fixed.
- Items counted from workloads: each workload rounds up to the product's step, the sum rounds up to
  whole ones. „Sestry“ in the organization's header is the count of the item „Sestra“.

---

## 5. Activities **[D-8]**

A record of a contact with the customer outside the app.

| Field        | Note                                                                         |
| ------------ | ---------------------------------------------------------------------------- |
| Kind         | `call`, `meeting`, `note` (code list may grow: `video_call`, …)              |
| When         | date and time (default now), duration optional                               |
| Participants | customer contacts (0..n) and Intra users (default: the author)               |
| Subject      | short line                                                                   |
| Notes        | formatted text (the same TipTap editor, simple formatting)                  |
| Attachments  | files from the Files module or uploaded here (stored in the customer's folder) |
| Next step    | optional: text + due date + assignee **[D-23]**                              |

Functions: create from the organization detail or its list, edit by anyone **[D-24]**, delete
(soft), filter in the timeline. Each edit is audited. A due next step notifies its assignee. An
activity belongs to one organization; a person's own timeline shows only the activities they took
part in, the e-mails sent to them and their replies, from all their organizations (D-8).

---

## 6. E-mail

### 6.1 Principles

- Each recipient gets **their own e-mail** (never a shared To/Cc).
- A **uniform company look**: header with logo, body, the sender's signature, footer with company
  details and an unsubscribe link. The layout is a React Email component; users write the body only.
- **WYSIWYG editing of the final look** **[D-11]**: the editor shows the body inside the real
  layout (header, footer, signature, fonts, colours), with images, so what is edited is what
  arrives. A „true preview“ renders the exact HTML the provider gets, per recipient.
- Personalisation by **variables** + the option to **edit the text for one recipient**.
- **Preview per recipient** and a **test e-mail to oneself** before sending.
- Contacts that unsubscribed or bounced are **left out automatically**, visibly in the preview.
- Only delivery is tracked (**[D-13]**): no open pixel, no link rewriting.

### 6.2 Sending domain and addresses **[D-17]**

- Outgoing mail is sent through Resend from a **subdomain** (`mail.alma-care.eu`), so its
  reputation is separate from the main domain and from Alma ADOS's system mail.
- **From**: the user's name with the shared address **`info@mail.alma-care.eu`** **[D-17a]**, e.g.
  `Ján Novák | Alma <info@mail.alma-care.eu>`.
- **Reply-To** **[D-36]**: chosen in Settings › Vzhľad e-mailov („Odpovede zákazníkov“):
  - „Na firemnú adresu“ (the default): the company address, `info@alma-care.eu` unless changed;
  - „Do Alma Intra“: a per-message reply address on the inbound subdomain (section 6.6), so replies
    come back to Intra; until the inbound domain is set up, the sender's own mailbox;
  - „Odosielateľovi“: the sender's own mailbox.
- `info@alma-care.eu` is the company's general mailbox outside Intra and is shown in the e-mail
  footer as the general contact **[D-17b]**. Bringing mail sent to it into Intra (forwarding to the
  inbound address) is a later extension, not part of the stages below.

### 6.3 Templates

| Field         | Note                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------- |
| Name          | internal („Ponuka pilot 2027“, „Pozvánka na webinár“)                                    |
| Category      | offer, invitation, news, follow-up, … (code list, optional)                             |
| Language      | a field on the template, only Slovak offered at first **[D-20b]**                        |
| Subject       | may contain variables                                                                    |
| Body          | TipTap document: paragraphs, headings, bold / italic, the look's accent colour, lists, links, **images**, the look's logo within a line, a button, a divider, a two-column block **[D-25, D-46]** |
| Attachments   | default attachments from the Files module                                                |
| Custom fields | fields filled at sending (common or per recipient), e.g. price, number of nurses, date  |
| Active        | inactive templates are not offered, never deleted (pattern `record_templates`)           |

**Variables** are inserted from a menu in the editor (shown as chips, not typed by hand):

- contact: `salutation`, `contact.firstName`, `contact.lastName`, `contact.position`;
- customer: `customer.name`, `customer.city`;
- sender: `sender.name`, `sender.phone`, `sender.position`;
- custom fields of the template.

A missing value marks the recipient in the preview and blocks sending until filled, so no customer
ever reads „Vážený {{salutation}}“.

**Images in e-mails**: e-mail clients cannot open signed URLs that expire, so images used in mail
bodies (logo, inserted pictures) are copied to a separate **public, read-only prefix** with
unguessable ids (`/m/<random-id>.png`). Only images explicitly inserted into a template or e-mail go
there, never other files. They are resized and stripped of EXIF on upload (`image-resize`).

Functions: list, new, edit with a live preview on a sample contact, duplicate, deactivate.

### 6.4 Sending (wizard)

Started from a customer's detail (one customer), from the list (bulk selection) or from „E-maily“.

1. **Recipients**: the selected customers → the primary contact of each (or chosen / all contacts).
   Badges „odhlásený“, „bez e-mailu“, „neplatný e-mail“; those are left out.
2. **Template**: a template or an empty e-mail.
3. **Content**: subject, body and attachments for everybody; custom fields (common, or in a table
   per recipient).
4. **Preview per recipient**: page through the recipients exactly as the mail will arrive; **edit
   the body for this recipient only** (e.g. an individual offer paragraph or a different attachment,
   such as their own price offer from their folder). An edited recipient is marked and can be reset
   to the common version.
5. **Check and send**: summary (recipients, left out, sender, attachment sizes), **test e-mail to
   myself**, „Odoslať teraz“ or schedule for a date and time **[D-12]** (cancellable until sent).
   A scheduled e-mail to a segment either reloads the segment at sending time or keeps the list of
   the day it was scheduled (the sender chooses); unsubscribed contacts are left out either way.

The draft is saved as it goes and can be finished later.

### 6.5 Delivery and states

- A send is a **campaign** record (who, when, template, content) with one **message** per recipient.
- Each message keeps its **exact rendered copy** (subject, HTML, text) and **the exact versions of
  its attachments**, so it is always clear what the customer received. (Unlike Alma ADOS, which
  stores no mail body: this is business correspondence, not health data.)
- Sending runs from a **queue table polled in the API process** **[D-32]** with a rate limit (Resend's limits), retries on temporary errors,
  idempotency per message.
- Message states: `queued` → `sent` → `delivered` / `bounced` / `complained`, from **Resend
  webhooks** (signed, verified).
- A hard bounce or a complaint marks the contact's e-mail as invalid / unsubscribed.
- Attachment limit: Resend accepts up to 40 MB per message; the wizard sums the sizes and refuses
  more and offers a download link instead: a signed link to that file version, valid 30 days
  **[D-26]**.

### 6.6 Replies in the app **[D-21]**

The owner wants to see customers' replies in Intra.

- Each message's Reply-To is a unique address on the sending subdomain, which also receives,
  `r+<message-token>@mail.alma-care.eu`. Resend's inbound mail receives it and calls Intra's
  webhook; Intra fetches the message and its attachments. (**Spike first**: verify Resend inbound's
  current capabilities, limits and pricing; the fallback is a forwarding mailbox read over IMAP.)
- A reply is matched by its token to the original message, hence to the customer, contact and user.
  Mail with no valid token is matched by the sender's address to a contact; otherwise it lands in
  „Nepriradené“, where a user assigns it to a customer or discards it.
- A reply appears in the customer's timeline and in the conversation of the original message;
  its attachments are saved into the customer's folder.
- The sending user gets a notification in the app and a **copy forwarded to their own mailbox**
  **[D-27]**, so nothing is missed by somebody who is not looking at Intra.
- **Answering from the app**: „Odpovedať“ on a reply opens the composer with the quoted thread;
  the answer is sent with `In-Reply-To` / `References`, so it threads in the customer's client.
- Inbound content is untrusted: HTML is sanitised before display, remote images are not loaded
  until the user asks, attachments are only downloaded, never rendered inline (except images and
  PDF in the preview).

### 6.7 Unsubscribe

- Every marketing e-mail has an **unsubscribe link** in the footer and the `List-Unsubscribe` /
  `List-Unsubscribe-Post` headers (one click).
- The link opens a public Intra page (token, no sign-in): „Boli ste odhlásený“, optionally a reason.
- An unsubscribe shows on the contact and in the customer's timeline.
- A one-to-one reply from the app (section 6.6) is correspondence, not marketing, and is sent even
  to an unsubscribed contact **[D-14]**.
- **To do before production [D-14]**: the lawyer confirms the legal basis (legitimate interest for
  B2B vs. consent; individuals need consent) and the footer and unsubscribe wording.

### 6.8 E-mail overview

- **Odoslané**: campaigns (subject, sender, when, recipients, delivered / bounced / replied), the
  campaign detail with each recipient's state and replies.
- **Prijaté**: replies, unassigned mail first.
- **Naplánované a koncepty**.
- **Šablóny**.

---

## 7. Files **[D-9]**

A module of its own that manages all files. Other modules (customers, activities, e-mail) reference
its files; they never store bytes themselves.

### 7.1 Where a file lives

- **Company documents**: a shared folder tree („Firemné dokumenty“ with sub-folders such as
  „Zmluvy“, „Cenníky“, „Marketing“, „Šablóny dokumentov“). Users create, rename, move and delete
  folders.
- **Customer folder**: every customer has its own space, created with the customer, optionally with
  sub-folders. It shows on the customer's detail and in the Files module under „Zákazníci“.
- A file has **one place** (a folder). Being an attachment of an e-mail or an activity is a
  **reference**, not a copy, so the same price offer is one file whether it sits in the customer's
  folder or was sent twice.

### 7.2 File

| Field       | Note                                                                                   |
| ----------- | -------------------------------------------------------------------------------------- |
| Name        | display name with extension; free to rename                                            |
| Folder      | company folder or a customer's folder                                                  |
| Versions    | every upload of a new content is a new version; the history is kept                    |
| Type, size  | from the stored object (HEAD + signature check, as in Alma ADOS), not from the client  |
| Description, tags | optional                                                                        |
| Document date | per version **[D-33]**: a date at the end of the uploaded name (`… 2026-10-28.pdf`) leaves the name and becomes the date; otherwise the upload day. The current version's date is the file's; the list shows it and filters by a range |
| Created / changed by | user (or „Claude on behalf of <user>“, section 7.5)                          |

- **Versioning**: replacing a file adds a version; any version can be downloaded or restored.
  A sent e-mail and an activity point to the **version** they used, so later edits never change
  what a customer already received.
- **Deleting** moves to „Kôš“ (trash) for 30 days **[D-28]**; a file referenced by a sent e-mail is
  kept for the e-mail's record even after it is emptied from the trash (hidden, not destroyed).
- **Limits [D-29]**: max 50 MB per file, a video 500 MB; allowed types: documents (PDF, DOCX, DOC,
  RTF, ODT, HTML as download only, XLSX, PPTX, TXT, MD, CSV), images (JPG, PNG, WEBP, SVG as
  download only), videos (MP4, MOV, download only), archives (ZIP).

### 7.3 Screens and functions

- **Files** page: folder tree on the left, list on the right (name, type, size, changed, by whom),
  breadcrumbs, search by name across folders, filters (type, changed by, period).
- Upload by drag and drop or a button, several at once, progress, direct to the bucket via a signed
  URL (bytes never pass through the API).
- **Preview** in a dialog over the list, opened by a click on the file: PDF, images and HTML (in a
  frame without scripts or anything from the internet, **[D-43]**); DOCX / XLSX / PPTX and other
  files say they have no preview and offer the download (no PDF renditions, **[D-30]**). „Verzie“
  alone opens the file's detail.
- Rename, move, new version, version history, download, trash, restore.
- „Priložiť k e-mailu“ and „Priložiť k aktivite“ from a file's menu; in the e-mail wizard and the
  activity form a **file picker** that opens the customer's folder first, with a switch to the
  company documents, and an upload that saves into the customer's folder.

### 7.4 Document templates and generated documents

To create, e.g., a new price offer for a customer:

- A **document template** is a DOCX in „Šablóny dokumentov“ with placeholders (`{customer.name}`,
  `{contact.salutation}`, `{offer.price}` …), the same variables as e-mail templates.
- „Vytvoriť dokument“ on a customer: pick a template, fill the custom fields, Intra fills the DOCX
  (a library such as `docxtemplater`, to approve) and saves it into the customer's folder as DOCX
  (no PDF conversion in the app, **[D-30]**). The result can be edited further (by hand or by Claude) and
  attached to an e-mail.
- This is the deterministic path. Free-form drafting (writing a new offer from scratch, rewording,
  combining documents) is Claude's, section 7.5.

### 7.5 Access for Claude

Goal: Claude (Claude Desktop / claude.ai / Claude Code) can find, read, create and change files in
Intra, e.g. „prepare a new price offer for ADOS Košice from last year's offer and the current price
list“.

**Proposal: Intra exposes an MCP server** (`https://<intra-domain>/mcp`, part of the API, no extra
service).

- **Authentication**: OAuth 2.1 with Intra's own sign-in (what claude.ai custom connectors require),
  and for Claude Code also **personal access tokens** created under „Môj účet“ (shown once, stored
  hashed, expiry, revocable, last used). Claude always acts **on behalf of a user**: same permissions,
  every call audited as „Claude on behalf of <user>“.
- **Tools** (first set):
  - `files.search`, `files.list_folder`, `files.get_info`, `files.read` (text extraction for
    DOCX/XLSX/PDF/MD, or the raw file for Claude's own document skills), `files.download_url`;
  - `files.create` (into a folder), `files.update` (**always a new version**, never an overwrite),
    `files.move`, `files.rename`, `files.create_folder`, and `files.upload_begin` /
    `files.upload_finish` (a signed link for content too large for base64); no hard delete;
  - `customers.search`, `customers.get` (with contacts and recent timeline), so Claude knows whom a
    document is for;
  - `customers.create`, `customers.update`, `contacts.create`, `contacts.update`,
    `establishments.create`, `establishments.update`: organizations, their persons and prevádzky
    (**[D-42]**, e.g. entering future customers from a list the user gives). An update changes only
    the fields it names. Private persons, deleting, products of an existing customer, role changes
    and unsubscribes stay in the app;
  - `templates.search`, `templates.get`, `templates.preview`, `templates.create`,
    `templates.update`: e-mail templates (**[D-45]**), so that Claude can prepare one for a user to
    check and send in the app. Duplicating and sending stay in the app;
  - `templates.image_from_file`, `product_look.set_logo`: a picture from Files for a template, or
    as the logo of a product's look (**[D-49]**);
  - later, optionally: `activities.create` (e.g. notes from a meeting), `emails.create_draft` (a
    draft for a user to review and send in the app; Claude never sends).
- **Safety**: tool results are data; documents may contain text that tries to instruct Claude, so
  write tools are limited to files, organizations with their persons and prevádzky, e-mail templates
  and drafts; they never delete, and nothing leaves the company (no sending) without a user in the
  app. Writing to organizations needs the same `customer.write` as the web, and to templates the same
  `template.write`, and each change stands in the activity log as Claude's, a change of an
  organization also in its history. Claude writes to organizations and templates only when the user
  asked for that change, never because a document or an e-mail says so.
- Alternatives considered: storing files in Google Drive / SharePoint (Claude has connectors, but
  files would live outside Intra, with a second permission model and no link to customers and
  e-mails); syncing a local folder (no audit, conflicts). The MCP keeps one source of truth.

**[D-31]** All Claude clients are supported: claude.ai and Claude Desktop through a custom
connector (OAuth), Claude Code through OAuth or a personal access token. Both ways of signing in are
part of stage E7.

---

## 8. Other functions

- **Dashboard** (simple, stage E8, **[D-15]**): customers by status, recent campaigns and their results, unassigned
  replies, scheduled sends, my next steps (section 5), my customers without contact for N days.
- **Notifications** in the app: new reply, bounced message, a next step due.
- **Global search** (⌘K) over customers, contacts and files (`global-search`).
- **Settings**:
  - **Firma**: company details for the e-mail footer, logo, sending name and address, Reply-To
    domain;
  - **Používatelia**;
  - **Číselníky**: customer types (with kind), tags, template categories, activity kinds, sources;
  - **E-mailový vzhľad**: layout colours, logo, footer text (with a preview).
- **Audit**: every change, send, file access by Claude; shown in a customer's history, a file's
  history and a global „Záznam aktivít“ **[D-16]**.
- **Domain and access [D-18]**: the app runs on its own subdomain (`intra.alma-care.eu`),
  without an IP or VPN restriction; mandatory 2FA (D-2) is the protection.

### Navigation (proposed sidebar)

- Prehľad
- Organizácie (Zákazníci, Partneri, Kontakty)
- Produkty (Produkty, Položky)
- E-maily (Prijaté, Odoslané, Naplánované, Šablóny)
- Súbory
- Nastavenia (Firma, Používatelia, Číselníky, Vzhľad e-mailov)
- footer: Môj účet, odhlásenie

---

## 9. Data model (indicative)

```
users                   (taken over: + position, email_signature)
refresh_tokens, auth_tokens, user_second_factors, …   (taken over)
personal_access_tokens  id, user_id, name, token_hash, expires_at, last_used_at, revoked_at
oauth_clients, oauth_grants   (MCP OAuth, D-31)
audit_events            (taken over, without organization_id; + actor_kind user | claude)
mail_outbox             (taken over: system mail – invitations, password reset)

contact_types           id, name, active, position, system_key (seed: Zákazník = customer, Partner, Dodávateľ, Spolupracovník)
products                id, name, active, position            (seed: ADOS, DOS, Stacionár)
customer_products       customer_id, product_id
customers               id, kind (organization | individual), contact_type_id, name, ico, dic, ic_dph, status?, address_*, region, web,
                        email, phone, owner_user_id, source_id, note, alma_org_id,
                        -- individual only: title_*, first_name, last_name, gender, salutation,
                        email_status, unsubscribed_at, deleted_at
contacts                id, customer_id, title_before, first_name, last_name, title_after,
                        gender, salutation, position, email, phone, is_primary,
                        email_status (ok | bounced | complained), unsubscribed_at,
                        unsubscribe_source, note, deleted_at
tags, customer_tags, sources, activity_kinds, template_categories   (code lists)

activities              id, customer_id, kind_id, occurred_at, duration_min, subject, body,
                        next_step_text, next_step_due, next_step_user_id, author_id, deleted_at
activity_participants   activity_id, contact_id | user_id
activity_attachments    activity_id, file_version_id

folders                 id, parent_id, customer_id (customer folder root), name, deleted_at
files                   id, folder_id, name, description, current_version_id, deleted_at
file_versions           id, file_id, storage_key, mime, size, sha256, created_by,
                        created_via (web | mcp | generated | inbound), created_at
public_images           id, file_version_id, public_key   (images used in e-mails)
(document templates: the DOCX files of the company folder „Šablóny dokumentov“; their fields are read from the placeholders, no table)

email_templates         id, name, category_id, language, subject, body (TipTap JSON),
                        custom_fields, default_attachments, active, position
campaigns               id, template_id, subject, body, custom_values, status
                        (draft | scheduled | sending | sent | cancelled), scheduled_at,
                        sender_user_id, created_by
campaign_messages       id, campaign_id, recipient (contact_id | customer_id), to_email,
                        subject, html, text, override_body, field_values, reply_token,
                        status, provider_message_id, sent_at, delivered_at, bounced_at,
                        error_code, in_reply_to_inbound_id
message_attachments     message_id, file_version_id
email_events            id, message_id, type, occurred_at, payload
inbound_messages        id, message_id?, customer_id?, contact_id?, from_email, subject,
                        html_sanitized, text, received_at, assigned_by, status
inbound_attachments     inbound_message_id, file_version_id
unsubscribe_tokens      id, recipient, token_hash, used_at
notifications           id, user_id, kind, ref_id, read_at
saved_filters           id, user_id, name, values (rules), shared
```

---

## 10. Stages (proposal)

| Stage | Content                                                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| E0    | Repository (fork + pruning), CI, Docker, app shell, design, sign-in, first user, user management, My account                            |
| E1    | Customers and contacts: types code list, list, detail, forms, tags, export CSV                                                          |
| E2    | Files: storage, folders, customer folders, versions, preview, trash                                                                     |
| E3    | Activities with notes and attachments; customer timeline                                                                                 |
| E4    | E-mail templates: TipTap editor in the real layout, variables, images, company look settings                                            |
| E5    | Sending: wizard, per-recipient edits, attachments, test to self, queued sending, delivery webhooks, unsubscribe, sent overview         |
| E6    | Replies in the app (after the Resend inbound spike), answering from the app, notifications                                              |
| E7    | Claude access (MCP with OAuth for claude.ai / Desktop and personal tokens for Claude Code), document templates (DOCX generation)        |
| E8    | Dashboard, scheduled sending, saved segments, global activity log                                                                       |

After each stage the app is deployable and usable. E2 comes before activities and e-mail because
both attach files.

---

## 11. Decisions (26 Oct 2026)

| #     | Decision                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------- |
| D-1   | Every user may manage users, with safeguards (no self-deactivation, at least one active user)                             |
| D-2   | 2FA mandatory for everyone                                                                                                |
| D-3   | Kind (organization / individual) is part of the model; every record has a contact type (code list, „Zákazník“ alone has a status) and any number of products (code list seeded with „ADOS“) |
| D-4   | Optional Alma ADOS organization id, no synchronisation                                                                    |
| D-5   | Company look-up by IČO in the business register, if its public API is usable                                              |
| D-6   | Addresses typed by hand, no Google Places                                                                                 |
| D-7   | Saved segments; a campaign can target a segment (E8)                                                                      |
| D-8   | Activities: calls, meetings, notes, with attachments                                                                      |
| D-9   | Attachments in e-mails; a Files module for company documents and customer files, reachable by Claude                      |
| D-10  | No import                                                                                                                 |
| D-11  | WYSIWYG editor (TipTap) showing the final look including graphics                                                         |
| D-12  | Scheduled sending (E8)                                                                                                    |
| D-13  | Delivery tracking only (no opens / clicks)                                                                                |
| D-14  | Unsubscribe link in every marketing e-mail; replies go even to unsubscribed contacts; lawyer confirms basis and wording before production |
| D-15  | A simple dashboard (E8)                                                                                                   |
| D-16  | A global activity log in the UI (E8)                                                                                      |
| D-17a | Sending address `info@mail.alma-care.eu` (subdomain), From shows the user's name                                           |
| D-17b | `info@alma-care.eu` is the general mailbox, shown in the footer; importing its mail into Intra is a later extension      |
| D-18  | Own subdomain `intra.alma-care.eu`, no IP / VPN restriction                                                         |
| D-19  | Jira project **INTRA**; tickets are created once the Jira connector is reconfigured                                       |
| D-20  | UI in Slovak; code, docs and Jira in English                                                                              |
| D-20b | Templates have a language field, only Slovak offered at first                                                             |
| D-21  | Customers' replies are visible in the app (Resend inbound, spike first)                                                   |
| D-22  | Each member has an own account; for now everyone may do everything                                                        |
| D-23  | Activities have an optional next step (text, due date, assignee)                                                          |
| D-24  | Anyone may edit an activity; edits are audited                                                                            |
| D-25  | E-mail editor blocks as listed in 6.3                                                                                     |
| D-26  | Over the 40 MB attachment limit: a signed download link valid 30 days                                                     |
| D-27  | A copy of each reply is forwarded to the sender's own mailbox                                                             |
| D-28  | Trash keeps files 30 days                                                                                                 |
| D-29  | Max 50 MB per file (video 500 MB); types in 7.2                                                                            |
| D-30  | No PDF renditions of Office files                                                                                         |
| D-31  | MCP for all Claude clients: OAuth (claude.ai, Desktop, Code) and personal access tokens (Code), both in E7                |
| D-32  | No job library: e-mails wait in `campaign_messages` (and system mail in `mail_outbox`), drained every few seconds by a worker in the API process with leases, retries and scheduled times; one process, no extra service. pg-boss only if several API instances run |
| D-33  | A file's document date is a property of each version, taken from the end of the uploaded name or the upload day; old versions merged into one file keep their dates |
| D-34  | Prevádzky are organizations under an organization, one level deep, with their own persons, timeline and products (establishments.md, P-1…P-14; 29 Oct 2026) |
| D-35  | Products have price lists of shared items; a holder's price follows the list unless fixed or discounted; workloads count items (products.md, R-1…R-15; 29 Oct 2026) |
| D-36  | The Reply-To of e-mails to customers is a setting: company address (default), back to Intra, or the sender (29 Oct 2026) |
| D-40  | Dates are written d.M.yyyy everywhere; every date field uses the app's own calendar (30 Oct 2026) |
| D-39  | E-mail look per product over a global one; chosen on the template and on a new e-mail; sending address and replies are common (30 Oct 2026) |
| D-38  | „Nový e-mail“ is one e-mail to To, Cc and Bcc, beside the wizard „Hromadný e-mail“ (30 Oct 2026, docs/new-email.md) |
| D-37  | Old e-mail is imported by forwarding it with an agreed line from a listed private address, when a setting allows it (30 Oct 2026, docs/email-import.md); replaced by D-41 |
| D-44  | Answer, answer all and forward are written in a new row of the conversation, in the company or product look with an editable signature (30 Oct 2026, docs/conversation-reply.md) |
| D-41  | A forwarded e-mail arrives as any other; a user adds it with „Pridaj do konverzácie“, no detection on arrival and no setting (30 Oct 2026, docs/email-import.md) |
| D-42  | Claude may create and change organizations, their persons and prevádzky through MCP, on the user's request, with `customer.write`; no deleting, no sending, private persons stay in the app (30 Oct 2026) |
| D-43  | A click on a file shows its preview in a dialog, HTML included; „Verzie“ alone opens its detail (30 Oct 2026) |
| D-48  | An e-mail is one person: a contact added with the e-mail of removed ones brings the newest back and takes the history of them all; what was given wins, an unsubscribe stays (30 Oct 2026) |
| D-47  | A contact can be made from a user; their details follow the user and never the other way round (30 Oct 2026) |
| D-45  | Claude may read, preview, create and change e-mail templates through MCP, on the user's request, with `template.write`; no deleting, no sending, new images stay in the app (30 Oct 2026) |
| D-46  | Text in an e-mail can take the look's accent colour and the look's logo within a line, so a product's name can be written as its logo; both follow the look, there is no free choice of colour or picture (30 Oct 2026) |
| D-48  | In the header of an e-mail the words of the brand's name after the first stand out, so „Alma ADOS“ reads as the product's logo: a light colour on a dark header, the accent on a light one (30 Oct 2026) |
| D-49  | A picture for an e-mail (an image, a logo within a line, a look's logo) can be taken from Files, in the app and through MCP. A PNG or JPG of 2 MB at most is copied among the images of e-mails, as an e-mail needs an address open to anybody that does not change with a new version of the file; EXIF of a JPG is dropped (30 Oct 2026) |

### Still to verify (not decisions)

- Resend inbound: **settled 2026-10-28**. Receiving works on a verified domain with one MX record,
  catches every address on it, and calls the webhook with `email.received` (metadata only; body,
  headers and attachments come from the API, attachment links valid 1 hour). Received mail counts
  against the same quota as sent mail; Resend keeps it while the webhook is down. Replies use the
  sending subdomain itself (`r+<token>@mail.alma-care.eu`), so no second domain is needed. The
  HTML of received mail is shown only in a sandboxed frame (no scripts, no forms, no remote
  content) instead of being sanitised by a new library.
- Business register API (RPO / ORSR) for D-5: availability and terms.
- New libraries to approve when their stage starts: TipTap (E4), `docxtemplater` (E7), an MCP /
  OAuth server library (E7).
