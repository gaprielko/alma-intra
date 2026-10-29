# Prevádzky: establishments of an organization (draft)

Status: **agreed** (2026-10-29); implementation in the stages of section 10. Phase 1 of the workflow (spec), phase 2 (screens: the
`Est*` boards on the canvas page „Prevádzky“) alongside; the implementation follows once both are
agreed. Builds on [contacts-redesign.md](contacts-redesign.md).

Marks: **[P-n]** a decision of this spec (section 11). 

---

## 1. Why

An organization has one IČO, but under it several **prevádzky** (establishments) may work: an ADOS
company running a home-care agency in Košice and another in Prešov, each with its own address,
people and, later, its own products. Today they can only be one organization (people mixed) or
several organizations (the IČO cannot repeat, the company is split). The user wants:

- prevádzky defined at an organization, like its contact persons;
- a prevádzka with its name, address, primary contact and other contacts;
- the persons of all prevádzky shown under the organization's contacts, with their prevádzka;
- activities tracked per prevádzka, found by the contact, and shown in the organization's timeline
  as well (indented, can be hidden);
- later, products assigned to the organization or to a prevádzka.

---

## 2. Terms

- **Organizácia** (head organization): as today; the legal entity with the IČO.
- **Prevádzka** (code: `establishment`): a part of one organization, at its own address, with its
  own persons and timeline. It has no IČO, role, status or owner of its own: it shares those of its
  organization [P-2].
- A prevádzka belongs to exactly one organization and never has prevádzky of its own (one level)
  [P-3]. A private person (kind `individual`) has none.

---

## 3. Data model

A prevádzka is a row of `organizations` with a parent [P-1]:

```
organizations
  + parent_id        NULL for an organization; the organization's id for a prevádzka
                     (one level: the parent's parent_id is NULL; same role as the parent)
  a prevádzka uses:  name, street, postal_code, city, region, email, phone, web, note,
                     alma_organization_id, created_*, updated_at, deleted_at
  a prevádzka keeps NULL: ico, dic, ic_dph, status, owner_user_id, source_id (shared from the parent)
contact_links        unchanged: a person at a prevádzka is linked to the prevádzka's row,
                     with a position there and whether they are its primary contact
activities, campaign_messages, inbound_messages
                     unchanged: organization_id is the prevádzka when it belongs to one
organization_products (later, products spec): per row, so a prevádzka has its own
```

Why a row of `organizations` and not a table of its own: a prevádzka needs almost everything an
organization has (address, persons, primary contact, timeline, activities, e-mails, replies,
products later). One table keeps every existing query, screen and API working for it; what differs
is only what it shares from the parent. A separate table would double the timeline, persons and
e-mail code.

Rules the API enforces: a parent must be a live organization of kind `organization` without a
parent; a prevádzka cannot change its role (it follows the parent); changing the parent's role
changes that of its prevádzky too; deleting an organization deletes its prevádzky (soft).

---

## 4. The organization's detail

Changes against today's detail (board `EstOrgDetail`):

**Layout**: the timeline is the right-hand panel, from the very top, with „Zobraziť staršie“ at its
end. The middle part holds, in this order: the Prevádzky table, the products right under it (section
4.4), and the Kontaktné osoby table. The basics and the classification have no cards of their own: the
header carries them. Next to the name the role, status and tags; under it a line of IČO, DIČ, seat,
phone, e-mail and web; under that, a little apart, the products with „Prevádzky: 3“ and
„Sestry: 18“. On the right, under the buttons and level with the products, the owner and the source.
The timeline's title is followed by a small „+“ (record an activity); the switch „Aj prevádzky“ sits
on the right of the same row. „Sestry“ is the number of nurses, computed from the products (products.md R-12). The persons
table puts the position under the name and the e-mail over the phone, so it fits beside the
timeline. The prevádzka's detail uses the same layout.

### 4.1 Prevádzky card

Shown **above „Kontaktné osoby“ only when the organization has prevádzky** [P-4]. A table:

| Column        | Content                                                         |
| ------------- | --------------------------------------------------------------- |
| Prevádzka     | name (link to its detail), under it the street and city         |
| Hlavný kontakt| the primary person, with e-mail                                 |
| Osoby         | how many persons                                                |
| Produkty      | its products (once products exist)                              |
| Posledný kontakt | date of the last activity or e-mail                          |
|               | „…“: Upraviť, Zapísať aktivitu, Zrušiť prevádzku                |

„Pridať prevádzku“ is in the card's header and, while there is none, in the header's „…“ menu of
the organization (so the card does not stand empty on every organization).

### 4.2 Kontaktné osoby as a table

The card becomes a table that copes with dozens of persons [P-5]:

- columns: **Meno** (titles, „Hlavný kontakt“ badge, e-mail status badge), **Pozícia**,
  **Prevádzka** (chip per prevádzka the person is at; nothing when only at the organization),
  **E-mail**, **Telefón**, „…“ (Upraviť, Nastaviť ako hlavný kontakt, Odobrať);
- above it: a full-text search (name, e-mail, phone, position) and a dropdown filter **Prevádzka**
  that takes one or several values, with „Len organizácia“ for persons without a prevádzka
  (D-12 style);
- it lists the organization's persons **and those of all its prevádzky** [P-6]; a person at the
  organization and at a prevádzka is one row with that prevádzka's chip; „Hlavný kontakt“ marks
  the organization's primary contact, a prevádzka's primary contact shows „hlavný“ on its chip;
- „Pridať osobu“ (new or existing) asks where: the organization or one of its prevádzky;
- more than 20 rows: paging inside the card.

### 4.3 Timeline

- Shows the organization's own entries **and the entries of its prevádzky** [P-7]. A prevádzka's entry
  is **indented**, with a thin yellow line on the left and the prevádzka's name as a chip, so it is
  told apart at a glance. The timeline draws no other vertical line between its entries.
- A switch **„Aj prevádzky“** (on by default) hides them: then only the organization's own
  activities and e-mails remain. The choice is remembered per user in the browser.
- The existing type chips (Všetko, Aktivity, E-maily, Zmeny) work on top of it.

### 4.4 Products

Specified in [products.md](products.md) section 9.1: a Produkty card under the Prevádzky table,
a table of the organization's products and, apart, those of its prevádzky, with counts, monthly and
yearly price, with or without VAT, and a total [P-8].

---

## 5. The prevádzka's detail

At `/organizations/<id>` like any organization (the same route; board `EstDetail`):

- header: back link to the organization („‹ ADOS Harmónia, s.r.o.“), the name, a „Prevádzka“
  chip, the shared role and status of the organization (read only), the city; actions „Poslať
  e-mail“, „Zapísať aktivitu“, „Upraviť“, „…“ (Zrušiť prevádzku);
- **Produkty** at the very top: its own, prices with or without VAT as its organization has it
  set (products.md 9.1);
- **Kontaktné osoby** under them: the same table, only the prevádzka's persons, no Prevádzka column;
- **Časová os**: only the prevádzka's own entries;
- **Údaje prevádzky**: address, e-mail, phone, Alma ADOS id, note;
- **Organizácia**: name (link), IČO, status, owner, tags: shared, edited at the organization;
- files stay at the organization [P-9]; the card links to the organization's folder.

---

## 6. Creating and editing a prevádzka

Dialog „Nová prevádzka“ (board `EstDialog`):

- name (required), address (street, PSČ, city; region derived as today), e-mail, phone, Alma ADOS
  id, note;
- **Hlavný kontakt** [P-10], one of:
  - a person of the organization or of its other prevádzky (a searchable list; the person keeps
    their link to the organization and gets one to the prevádzka too, with a position there),
  - an existing person from Kontakty,
  - a new person (the fields of „Nová osoba“),
  - none for now;
- further persons are added on the prevádzka's detail, as at an organization.

„Upraviť“ uses the same dialog without the contact part. „Zrušiť prevádzku“ is a soft delete: its
links end, its activities and e-mails stay in the organization's timeline marked „zrušená
prevádzka“.

---

## 7. Activities and e-mails per prevádzka

An activity, a sent e-mail and a filed reply belong to **one** row: the organization or one of
its prevádzky. Which one is **found from the contact** [P-11]:

1. Recorded on a prevádzka's detail: that prevádzka.
2. Recorded on the organization's detail or a person's page: from the participating persons. When
   every participating person of this organization is linked to the same prevádzka (and not to
   the organization itself), it is that prevádzka; otherwise the organization.
3. The activity dialog shows the result as a field **„Prevádzka“** (Organizácia / the prevádzky),
   filled in by rule 2 and refreshed as participants change, until the user picks one by hand.
4. An e-mail: each message is filed by its recipient with the same rule. A reply follows the
   message it answers; an unknown sender assigned to a person follows that person.

Moving an activity between the organization and a prevádzka is an edit of that field.

---

## 8. Lists, search and the rest

| Area | Change |
| ---- | ------ |
| Zákazníci / Partneri lists | organizations only (no prevádzky as rows); under the name „3 prevádzky“. The search also finds a prevádzka's name, city or person and shows its organization with „prevádzka Prešov“ [P-12] |
| Region filter | an organization matches when its seat **or one of its prevádzky** is in the region [P-12] |
| Kontakty list | the organization column shows „ADOS Harmónia · Prevádzka Prešov“; the organization filter finds persons of its prevádzky too |
| Person's page | the organizations card shows the prevádzka under its organization |
| E-mail wizard, recipients | an organization's persons grouped by prevádzka; „Len hlavný kontakt“ picks the organization's primary contact, **„Hlavné kontakty aj prevádzok“** adds each prevádzka's [P-13] |
| Template variables | `organization.*` stays the head organization (name, IČO); new `establishment.name` and `establishment.address`, empty without a prevádzka |
| Received e-mails, assign | by person as today; the dialog shows a person's prevádzka |
| Segments, CSV | per organization; the CSV gets a column with the names of the prevádzky |
| Dashboard | counts organizations, not prevádzky |
| Claude (MCP) | `customers_get` returns the prevádzky with their persons; `contacts_get` shows the prevádzka |
| Audit, history | entity `organization` with `parentId`; „Pridaná prevádzka X“ in the organization's history |
| Turning an existing organization into a prevádzka | „Zaradiť pod organizáciu…“ in the „…“ menu of an organization without IČO and without prevádzky: it becomes a prevádzka of the chosen organization, keeping its persons, timeline and files [P-14] |

---

## 9. Not in this spec

- Products and their assignment (only the place in the detail is reserved, section 4.4).
- A prevádzka's own status, owner or tags.
- More levels (a prevádzka of a prevádzka).
- Files per prevádzka.

## 10. Stages of the implementation (after approval)

| Stage | What |
| ----- | ---- |
| P1 | `parent_id` with its checks, API: create / edit / delete a prevádzka, list an organization's prevádzky, persons of an organization with their prevádzka; tests |
| P2 | Web: Prevádzky card, dialog, the prevádzka's detail |
| P3 | Kontaktné osoby as a table with search and the Prevádzka filter |
| P4 | Activities and e-mails filed by contact (the „Prevádzka“ field), timeline with indented prevádzky and „Aj prevádzky“ |
| P5 | Lists, search, region, Kontakty, recipients, template variables, MCP, CSV, „Zaradiť pod organizáciu“, `functional-spec.md` |

## 11. Decisions

| Id | Decision | State |
| ---- | -------- | ----- |
| P-1 | A prevádzka is a row of `organizations` with `parent_id`. | agreed |
| P-2 | IČO, role, status, owner, source and tags are the organization's; a prevádzka shares them. | agreed |
| P-3 | One level only; a private person has no prevádzky. | agreed |
| P-4 | The Prevádzky card shows only when there is at least one. | agreed |
| P-5 | Kontaktné osoby is a table with full-text search and a multi-value Prevádzka filter. | agreed |
| P-6 | The organization's persons include those of its prevádzky, with the prevádzka named. | agreed |
| P-7 | The organization's timeline includes the entries of the prevádzky, indented, with a switch to hide them. | agreed |
| P-8 | Products later per organization or prevádzka; the organization lists the products of the prevádzky apart. | agreed |
| P-9 | Files stay at the organization. | agreed |
| P-10 | A prevádzka's primary contact: a person of the organization, an existing person, a new one, or none. | agreed |
| P-11 | An activity or e-mail is filed under a prevádzka by its persons; the dialog shows and lets change it. | agreed |
| P-12 | Search and the region filter of the lists also look at the prevádzky. | agreed |
| P-13 | The wizard offers „Hlavné kontakty aj prevádzok“ next to „Len hlavný kontakt“. | agreed |
| P-14 | An existing organization (no IČO, no prevádzky) can be turned into a prevádzka of another. | agreed |
