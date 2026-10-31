# Aktivity: activities that come from an application

Status: **agreed and implemented, step one** (2026-10-30). The user decided on two steps: this one
receives podnety and shows them in Aktivity, and the way back to Alma (request 3) comes later. All
recommendations in section 7 were accepted. Screens: page „Aktivity“ on the canvas „Alma Intra –
screens“. Builds on `docs/activities.md` and `docs/activity-types.md`.

The contract with Alma ADOS is `docs/integrations/pilot-feedback-intranet.md` (v1.3) in the
`alma-ados` repository. It is the source of truth and a change to it is agreed with Alma first.

---

## 1. Why

Alma ADOS already collects „podnety“ from testers of a pilot agency and is ready to send them to the
intranet. The user wants each one to appear in Aktivity by itself, assigned to its organization,
pracovisko and contact, so that it shows on their timelines. Aktivity must also say where an entry
came from: a button in an e-mail, or an application.

---

## 2. What changes

- **Aktivity › Zoznam, „Odkiaľ“:** an e-mail entry stays as it is. An application entry says
  „Aplikácia Alma ADOS“, and under it the kind and the client: „Nápad · web“.
- **„Organizácia“:** gains the pracovisko on a line of its own.
- **Detail:** a new variant for a podnet, with the text, the marked place, the masked picture and the
  technical record.
- **Timelines:** of the organization, the pracovisko and the contact show „Podnet: Nápad“ with the
  product and the origin, without the text [A-3].
- **Typy aktivít:** a seeded type „Podnet“, which no e-mail button offers.

---

## 3. How an item is assigned

| The entry's | Comes from | Rule |
| --- | --- | --- |
| Product | the endpoint | the contract has no product field; the receiver of Alma ADOS records the ADOS product |
| Type | seeded | „Podnet“; the contract's `type` is the kind: `bug` „Chyba“, `idea` „Nápad“, `question` „Neviem, ako na to“ |
| Organization, pracovisko | `organization.id` | Intra's own id of the organization or prevádzka; until ADOS adapts, `alma_organization_id` [A-1] |
| Contact | `reporter.email` | the live contact with the e-mail, ignoring case; an e-mail belongs to one person (D-7) [A-2] |

`reporter.userId` is stored from the start, so that details can later be fetched from Alma ADOS by the
application and user id. Fetching them is not in this step: the e-mail is the identifier for now.

**No match.** Alma cannot be refused: every non-2xx is retried for 24 hours and then lost. So an item
is always stored. Without a matched organization it shows „Nepriradené“ with the agency's name from
Alma, and somebody assigns it by hand. Without a matched contact it stays on the organization, with
the reporter's name and e-mail shown.

---

## 4. Receiving

Requests 1, 2 and 2b of the contract, on plain REST routes under `/api/integrations/ados` rather than tRPC, because
the signature is verified on the raw bytes before parsing:

- HMAC-SHA256 of `timestamp.body`, a constant-time comparison, ±5 minutes, 401 otherwise.
- `ALMA_OUTBOUND_SECRET` as a new environment variable; no session and no `can()`, the signature is
  the authentication.
- Idempotent by `id`: a repeat answers 2xx and stores nothing.
- A body limit of 1 MB, an answer within 15 s, unknown fields ignored.

The picture goes to the object store, the rest to the database.

---

## 5. Data

A new table `app_feedback`: the id from Alma, the kind, `whatDoing`, `expected`, the reporter's id,
name, e-mail and role, Alma's organization id and name, app, device, place, trail, API calls, errors,
`pending_sync`, the picture's key. A second table holds the reporter's replies and confirmations.

`lead_activities` (with the changes of `docs/activity-types.md`) gains:

- `source`: `email` or `app`.
- `app_feedback_id`, a reference to the new table.
- `organization_id` becomes nullable, for „Nepriradené“. It holds the matched record, a prevádzka too,
  as everywhere in the app: a prevádzka is a row of `organizations` with its `parent_id`, so its
  timeline and its organization's already work.

The unique index and its count of repeats apply to `source = 'email'` only: every podnet is an entry
of its own and never merges with another one.

---

## 6. Health data

The contract says the free text and the picture **may contain health data**, even on demo data, and
must be stored as such: team only, no third-party log, analytics, error tracker or AI that keeps it.
For this app:

- Log ids, never the text, as rule 5 of `CLAUDE.md` already says.
- Reading a podnet's detail is a sensitive read, logged by the audit interceptor.
- The text and the picture stay out of the list, the timelines, notifications and the MCP tools.

---

## 7. Open questions (each with the recommendation)

- **[A-1] Pracovisko. Decided by the user (2026-10-30).** Intra owns organizations and prevádzky and
  creates them in ADOS, which then sends Intra's id back. The id alone therefore gives the organization
  and the pracovisko: a prevádzka's id gives both, an organization's id gives the organization. See
  `docs/integrations/products.md`. Until ADOS adapts, the receiver also matches
  `alma_organization_id`, so no change on the side of ADOS is needed to start.
- **[A-2] A reporter without a contact.** Create one automatically? Recommended: no, show the name and
  the e-mail and offer „Vytvoriť kontakt“, so that a typing error in Alma never makes a contact.
- **[A-3] The text on a timeline.** Recommended: no, only the kind and the origin, with a link to the
  detail. See section 6.
- **[A-4] The way back. Decided by the user (2026-10-30): a later step.** The contract also expects
  Intra to send status changes and messages (request 3), which is what the tester sees. Until then
  the item stays „Prijatý“ in Alma, so testers should be told. Replies and confirmations are stored
  already. The later step adds the status, the messages and an outbox.
- **[A-5] Deleting a podnet.** Recommended: it hides the entry as for other activities, but keeps
  `app_feedback`, because Alma can still send replies to it.

---

## 8. After it is deployed

Generate `ALMA_OUTBOUND_SECRET` and set it on both sides; set Alma's `FEEDBACK_INTRANET_URL` to
`https://<intra>/api/integrations/ados`. Until ADOS adapts, fill „ID v Alma ADOS“ on the matching organizations or prevádzky. Test
against staging with a test agency from Maroš.

---

## 9. Not in this step

The way back (request 3), fetching user details from Alma ADOS, creating organizations in ADOS (the
contract is drafted, the sending comes later), other applications than Alma ADOS, workflows, a filter
by source.
