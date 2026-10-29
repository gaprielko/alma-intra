# Kontakty redesign: customers, partners and contacts (draft)

Status: **implemented** (2026-10-29, stages O1–O6). Phases 1 and 2 done (screens: the `Org*`,
`ContactDetail` and `PersonDialog` boards in `design/`); phase 3, the implementation, goes in the
stages of section 11. Once implemented, it replaces sections 4 and 5 of
`functional-spec.md`.

Marks: **[D-n]** a decision of this redesign (listed at the end, section 10).

---

## 1. Why

Today one register („Kontakty“) holds every organization or private person, told apart by a
„contact type“ code list (Zákazník, Partner, Dodávateľ, …); the persons at an organization live only
inside it. The user wants three registers of their own:

All three are tabs of one sidebar item, **„Organizácie“** [D-1].

| UI name       | What it holds                                                                                   |
| ------------- | ----------------------------------------------------------------------------------------------- |
| **Zákazníci** | our customers: usually organizations, possibly a private person; status, owner, tags, products |
| **Partneri**  | whoever we work with or are in touch with: organizations or private persons; tags only (no status, no owner, for now) |
| **Kontakty**  | **natural persons only**: usually the contact persons of customers and partners                 |

A customer or partner that is a private person is at the same time its own (primary) contact and
appears in Kontakty right away.

---

## 2. Terms

- **Organizácia** (code: `organization`): the shared shape of a customer and a partner: name, kind,
  company ids, address, general e-mail/phone/web, tags, note, files, timeline. Its **role** is
  `customer` or `partner`.
- **Kind** stays: `organization` (a company) or `individual` (a private person).
- **Kontakt** (code: `contact`): a natural person, a record of its own: name, titles, form of
  address, salutation, e-mail, phone, e-mail status, unsubscribe, note. It is linked to an
  organization with a **position** there.

---

## 3. Data model

```
organizations           (today's `customers`, renamed)
  id, role (customer | partner), kind (organization | individual)
  name, ico, dic, ic_dph, street, postal_code, city, region, web, email, phone
  note, alma_organization_id, source_id
  status            customer only (null for a partner)
  owner_user_id     customer only (null for a partner)
  created_*, updated_at, deleted_at
organization_tags       (today's customer_tags)
organization_products   (today's customer_products; customer only)

contacts                a natural person, a table of its own
  id, title_before, first_name, last_name, title_after, gender, salutation
  email, phone, email_status, unsubscribed_at, unsubscribe_source, note
  created_*, updated_at, deleted_at

contact_links           the person at an organization: 0..n per person          [D-2, D-3]
  contact_id, organization_id, position, is_primary
```

- **One table for customers and partners**, told apart by `role`. They share almost everything
  (address, tags, files, timeline, activities, e-mails, segments); two tables would double every
  query and screen. What only a customer has (status, owner, products) is refused for a partner.
- The `individual` customer/partner keeps **no person fields of its own** any more: its person is a
  `contacts` row linked as its primary contact, and the organization's name follows that person's
  name. So a private person exists once, and Kontakty shows every person.
- The **contact type** code list (Zákazník, Partner, Dodávateľ, …) goes away: the role replaces it.
  A partner's kind of cooperation (Dodávateľ, Spolupracovník, Inštitúcia, …) is a tag [D-4].
- `customers` is renamed `organizations` in the database and the code (API, routes): a large but
  one-off change, so partners never read as „customers“ [D-11].

---

## 4. Zákazníci

Behaves as today's register, limited to role `customer`:

- **List**: name (under it the status and the city; for a private person „Súkromná osoba“),
  products (chips), primary contact (name, e-mail; empty for a private person), owner, tags, last
  contact. Search, status chips with counts (including „Bez stavu“), filters (kind, product
  including „Bez produktu“, region, tag, owner), sorting, paging 20/50/100, bulk „Poslať e-mail“,
  „Pridať štítok“, „Zmeniť stav“, „Export CSV“, segments.
- **Status**: `lead` Potenciálny, `contacted` Oslovený, `interested` Má záujem, `customer` Aktívna
  spolupráca, `former_customer` Ukončená spolupráca, `not_interested` Bez záujmu. It may stay
  empty: then **nothing is shown** (no badge in the list, the detail or the form's summary); the
  list's chip „Bez stavu“ still finds them [D-6].
- **Owner**: one Intra user responsible for the customer.
- **Products**: none, one or several. Product details and specifications come later (a separate
  spec).
- **Detail**: header (name, status, products, tags, quick actions), basics and address, **Kontaktné
  osoby** card (persons linked to it, the primary one marked, position, add an existing person or a
  new one), timeline, files, history of changes.

## 5. Partneri

Like customers, without status, owner and products (for now):

- **List**: name (under it the city / „Súkromná osoba“), primary contact, tags, last contact.
  Search, filters (kind, region, tag), sorting, paging, bulk „Poslať e-mail“, „Pridať štítok“,
  „Export CSV“, segments.
- **Detail**: same as a customer's, without status, owner and products.
- **„Zmeniť na zákazníka“** turns a partner into a customer (and „Zmeniť na partnera“ back),
  keeping its history, contacts, files and segments; a customer turned partner loses its status,
  owner and products (kept in the history of changes) [D-5].

## 6. Kontakty (persons)

- **List**: name (titles), organization(s) with role chip (Zákazník / Partner) and position,
  e-mail, phone, e-mail status (Neplatný, Odhlásený), last contact. Search (name, e-mail, phone,
  organization), filters (role of the organization, organization, unsubscribed / invalid e-mail,
  „Bez organizácie“), sorting, paging, bulk „Poslať e-mail“, „Export CSV“.
- A person may have **no organization** (a consultant, a doctor) [D-2] or **several**, with a
  position in each [D-3].
- **Detail**: header (name, position @ organization, quick actions „Poslať e-mail“, „Zapísať
  aktivitu“, „Upraviť“), personal data and salutation, e-mail status and unsubscribe, the
  organization(s) with a link to each, **the person's own timeline** (section 7), history of changes.
- A private-person customer/partner shows here as a person with the chip „Súkromná osoba ·
  Zákazník“; editing the person edits the customer's name too.
- A person's e-mail is **unique across all live persons**, so one person is not entered twice;
  the form offers the existing person instead [D-7].

## 7. Activities and the timelines

Activities are recorded **per customer / partner as today** (one organization per activity), with
participants: its contact persons and Intra users.

- **Organization timeline**: all its activities, sent e-mails, received replies, as today.
- **Contact timeline** (new): only what concerns this person:
  - activities where the person is a participant;
  - e-mails sent to the person and replies received from the person;
  - not the organization's activities the person did not take part in [D-8].
- „Zapísať aktivitu“ from a contact: the organization is preselected (asked for when the person has
  several, none for a person without an organization: then the activity needs one chosen), the
  person is a participant.
- Next steps, attachments, edits by anyone, soft delete: unchanged.

## 8. Everything else this touches

| Area                    | Change                                                                                         |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| Navigation              | sidebar: Prehľad, **Organizácie** (tabs Zákazníci, Partneri, Kontakty), E-maily, Súbory [D-1] |
| URLs                    | `/organizations/customers`, `/organizations/partners`, `/organizations/contacts`; details `/organizations/<id>`, `/contacts/<id>` |
| E-mail recipients       | always a person (`contacts`); the wizard picks from customers, partners and persons            |
| Template variables      | `customer.*` → „Organizácia“ (name, address) for both roles; `contact.*` the person           |
| Segments                | per register (a segment of customers, of partners, of persons)                                 |
| Files                   | per organization as today; none per person for now [D-9]                                      |
| Received e-mails        | matched to the person, then to their organization (several → asked when assigning)            |
| Dashboard               | status counts of customers only; „last contact“ for customers and partners                    |
| CSV export              | per register, with its own columns                                                             |
| Claude (MCP)            | `customers_search` → `organizations_search` (role filter) and `contacts_search`                |
| Audit, history          | entity types `organization`, `contact`; history on both details                               |
| Code lists (Nastavenia) | contact types removed [D-4]; products, sources stay                                            |

## 9. Migration of today's data

1. Records with contact type „Zákazník“ → role `customer`; every other type → role `partner`
   (their status and owner are dropped, the history of changes keeps them [D-10]; their contact type
   becomes a tag of the same name [D-4]).
2. Every `individual` record → its person fields move into a new `contacts` row, linked as primary.
3. Today's contact persons → `contacts` + a link to their organization (position, primary).
4. Activities, participants, e-mails, replies, files, segments, audit keep their ids; the history
   stays readable.

## 10. Decisions (2026-10-29)

| Id   | Decision |
| ---- | -------- |
| D-1  | One sidebar item „Organizácie“ with three tabs: Zákazníci, Partneri, Kontakty. |
| D-2  | A person may exist without any organization. |
| D-3  | A person may belong to several organizations, with a position in each. |
| D-4  | No partner sub-type for now: tags. Today's contact types become tags in the migration. |
| D-5  | A partner can become a customer and back, keeping everything shared. |
| D-6  | Customer status is optional; when empty nothing is shown. |
| D-7  | A person's e-mail is unique across all live persons. |
| D-8  | A contact's timeline shows only the activities the person took part in, and their e-mails. |
| D-9  | Files only per organization for now. |
| D-10 | The migration drops the status and owner of records that become partners (kept in history). |
| D-11 | `customers` is renamed `organizations` in the database and the code. |
| D-12 | Every dropdown filter takes one or several values; the customer status is such a filter (no chip row). |

## 11. Stages of the implementation

Each stage is its own set of commits, leaves the app working and the tests green.

| Stage | What | Visible change |
| ----- | ---- | -------------- |
| O1 | Rename: table `customers` → `organizations`, `customer_*` columns and tables → `organization_*`, code identifiers likewise. A pure refactor. Done: `e118e11`. | none |
| O2 | Data model: persons as standalone `contacts` + `contact_links` (position, primary), private persons moved into `contacts`, one person per e-mail (duplicates merged); `role` on organizations, derived from the contact type „Zákazník“ until the forms offer it. Done: `2002ab0`, `1a5bf24`. | almost none |
| O3 | API: lists per role, persons list / detail / timeline, create and link persons, unique e-mail, role change, multi-select filters. Done: `de4abe6`, `853f4a7`, `5333c07`. | none |
| O4 | Web lists: „Organizácie“ with the tabs Zákazníci, Partneri, Kontakty; multi-select dropdown filters. The forms choose the role; contact types become tags (D-4) and the partners' status and owner go (D-10). Done: `f06b4b5`, `510c255`. | new lists |
| O5 | Web details: customer, partner, private person, contact detail with its timeline, person dialog, „Zmeniť na zákazníka“. Done: `47ed007`, `3f892c6`, `4c3cb74` (details at `/organizations/<id>` since `/customers/<id>` moved there; persons at `/contacts/<id>`). | new details |
| O6 | The rest: e-mail wizard recipients, template variables, segments per register, received e-mail matching, Claude's tools, dashboard, CSV, `functional-spec.md` sections 4 and 5 replaced. Done: `8c0358f`, `bcce4e5`, `4e87333`, this spec. Received e-mails needed no change (matched to persons since O2). | everything consistent |
