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
| Jobs          | pg-boss (installed by a migration)                                        | same (sending, scheduling, inbound mail)    |
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
- **Invite a user**: name, e-mail, phone, position. Resend or withdraw an invitation.
- **Deactivate / reactivate** a user; deactivation ends their sessions at once.
- **Safeguards**: nobody deactivates themselves; at least one active user always remains.
- **Reset another user's 2FA** (lost phone).
- **My account**: name, phone, position, **e-mail signature** (used in e-mails), password change,
  2FA, active sessions, **Claude access tokens** (section 7.5).

**[D-2]** 2FA is **mandatory** for everyone (personal data of customers, sending in the company's
name, file access for Claude): a new user sets it up right after activation, before reaching any
other screen.

---

## 4. Customers and contacts

### 4.1 Customer kind and type **[D-3]**

Customers are mostly ADOS, but may be other organizations or private persons. Two separate
attributes:

- **Kind** (fixed, part of the model, chosen first when creating a customer, decides the form):
  - `organization`: a company with a name, company ids, address and contact persons;
  - `individual`: a private person; the customer *is* the person (name, salutation, e-mail, phone,
    address), no company ids, no separate contacts.
- **Type** (optional): a **code list managed in Settings** (add, rename, reorder, deactivate; never
  deleted while used), independent of the kind. Seeded with one value, „ADOS“. A customer may have
  no type („Bez typu“), which is also a filter in the list. Wherever an organization is created
  (the customer form, assigning an unknown sender's e-mail) the type picker also offers „Nový typ
  organizácie“, which adds the type to the code list on the spot.

### 4.2 Customer

| Field                | Note                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------- |
| Kind                 | `organization` / `individual`; decides which fields apply                             |
| Type                 | optional, from the code list                                                          |
| Name                 | organization: company name; individual: built from the person's name                  |
| IČO, DIČ, IČ DPH     | organization only, optional; IČO unique. **[D-5]** look-up in the business register (RPO / ORSR) if its public API is usable |
| Status               | `lead` → `contacted` → `interested` → `customer` → `former_customer`; `not_interested` |
| Address              | street, city, postal code, region (for filtering)                                     |
| Web, e-mail, phone   | general ones of the organization                                                      |
| Owner                | the Intra user responsible for the customer                                           |
| Tags                 | free tags for segmentation („pilot 2027“, „konferencia Košice“)                       |
| Source               | where the customer came from (referral, conference, web, …)                           |
| Note                 | free text                                                                             |
| Alma ADOS id         | **[D-4]** optional id of the organization in Alma ADOS; no synchronisation            |

### 4.3 Contact (0..n per organization customer)

| Field                 | Note                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------- |
| Titles, first / last name |                                                                                    |
| Form of address       | Mr / Ms, for „Vážený pán / Vážená pani“                                                 |
| **Salutation**        | the exact text used in e-mails, prefilled („Vážená pani riaditeľka“, „Vážený pán Novák“), editable |
| Position              | director, head nurse, economist, …                                                     |
| E-mail, phone         | e-mail unique within the customer                                                      |
| Primary contact       | one per customer; the default recipient                                                |
| E-mail status         | `ok`, `bounced`, `complained`; unsubscribed (when, how)                                |
| Note                  |                                                                                        |

For an `individual` customer the same personal fields (salutation, e-mail status, unsubscribe) live
on the customer, so the e-mail flow treats both the same way: a recipient is a contact or an
individual customer.

Deleting is a **soft delete** (customer, contact); the communication history stays.

### 4.4 Screens

**Customer list** (the patient list's pattern, `DataList`):

- columns: customer (name, city, type), primary contact (name, e-mail), status (badge), owner,
  tags, last contact (date of the last e-mail, reply or activity);
- search (name, IČO, a contact's name or e-mail), status chips with counts, filters (kind, type
  including „Bez typu“, region, tag, owner), sorting, paging;
- **bulk selection** → „Poslať e-mail“, „Pridať štítok“, „Zmeniť stav“, „Export CSV“;
- saved filters (segments), pattern of `saved_filters`; a campaign can target a segment **[D-7]**.
  A segment stores its rules, not a list of customers, so a new customer matching them joins it on
  its own. A segment is personal or shared with colleagues (a switch when saving).

**New / edit customer**: form in sections (kind first, since it decides the fields; basics,
address, classification), optionally the first contact right away; leave guard. Addresses are
typed by hand, no Google Places **[D-6]**.

**Customer detail** (the patient card's pattern: header + cards / tabs):

- header: name, status, type, tags, quick actions („Poslať e-mail“, „Zapísať aktivitu“,
  „Nahrať súbor“, „Upraviť“);
- **Basics** and address;
- **Contacts**: add, edit, make primary, unsubscribe, remove;
- **Timeline** (section 5): activities, sent e-mails with delivery status, received replies, notes,
  in one chronological stream with filters by kind;
- **Files**: the customer's folder (section 7);
- **History of changes** (from the audit): who changed status, owner, … .

**Export** of the current list to CSV. No import (**[D-10]**).

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

Functions: create from the customer detail or the customer list, edit by anyone **[D-24]**,
delete (soft), filter in the timeline. Each edit is audited. A due next step notifies its assignee.

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
- **Reply-To**: a per-message reply address on the inbound subdomain (section 6.6), so replies come
  back to Intra.
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
| Body          | TipTap document: paragraphs, headings, bold / italic, lists, links, **images**, a button, a divider, a two-column block **[D-25]** |
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
- Sending runs as **pg-boss jobs** with a rate limit (Resend's limits), retries on temporary errors,
  idempotency per message.
- Message states: `queued` → `sent` → `delivered` / `bounced` / `complained`, from **Resend
  webhooks** (signed, verified).
- A hard bounce or a complaint marks the contact's e-mail as invalid / unsubscribed.
- Attachment limit: Resend accepts up to 40 MB per message; the wizard sums the sizes and refuses
  more and offers a download link instead: a signed link to that file version, valid 30 days
  **[D-26]**.

### 6.6 Replies in the app **[D-21]**

The owner wants to see customers' replies in Intra.

- Each message's Reply-To is a unique address on an inbound subdomain, e.g.
  `r+<message-token>@reply.alma-care.eu`. Resend's inbound mail receives it and calls Intra's
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
| Created / changed by | user (or „Claude on behalf of <user>“, section 7.5)                          |

- **Versioning**: replacing a file adds a version; any version can be downloaded or restored.
  A sent e-mail and an activity point to the **version** they used, so later edits never change
  what a customer already received.
- **Deleting** moves to „Kôš“ (trash) for 30 days **[D-28]**; a file referenced by a sent e-mail is
  kept for the e-mail's record even after it is emptied from the trash (hidden, not destroyed).
- **Limits [D-29]**: max 50 MB per file; allowed types: documents (PDF, DOCX, XLSX, PPTX, ODT, TXT,
  MD, CSV), images (JPG, PNG, WEBP, SVG as download only), archives (ZIP).

### 7.3 Screens and functions

- **Files** page: folder tree on the left, list on the right (name, type, size, changed, by whom),
  breadcrumbs, search by name across folders, filters (type, changed by, period).
- Upload by drag and drop or a button, several at once, progress, direct to the bucket via a signed
  URL (bytes never pass through the API).
- **Preview** in the browser: PDF and images inline; DOCX / XLSX / PPTX and other files are
  downloaded (no PDF renditions, **[D-30]**).
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
    `files.move`, `files.rename`; no hard delete;
  - `customers.search`, `customers.get` (with contacts and recent timeline), so Claude knows whom a
    document is for;
  - later, optionally: `activities.create` (e.g. notes from a meeting), `emails.create_draft` (a
    draft for a user to review and send in the app; Claude never sends).
- **Safety**: tool results are data; documents may contain text that tries to instruct Claude, so
  write tools are limited to files and drafts, and nothing leaves the company (no sending) without a
  user in the app.
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
- Zákazníci
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

customer_types          id, name, active, position            (seed: ADOS)
customers               id, kind (organization | individual), type_id?, name, ico, dic, ic_dph, status, address_*, region, web,
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
document_templates      id, file_id, custom_fields

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
| E5    | Sending: wizard, per-recipient edits, attachments, test to self, pg-boss sending, delivery webhooks, unsubscribe, sent overview         |
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
| D-3   | Customer kind (organization / individual) is part of the model; type is an optional code list seeded with „ADOS“          |
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
| D-29  | Max 50 MB per file; allowed types as in 7.2                                                                               |
| D-30  | No PDF renditions of Office files                                                                                         |
| D-31  | MCP for all Claude clients: OAuth (claude.ai, Desktop, Code) and personal access tokens (Code), both in E7                |

### Still to verify (not decisions)

- Resend inbound: capabilities, limits and pricing (spike before E6; fallback IMAP).
- Business register API (RPO / ORSR) for D-5: availability and terms.
- New libraries to approve when their stage starts: TipTap (E4), `docxtemplater` (E7), an MCP /
  OAuth server library (E7).
