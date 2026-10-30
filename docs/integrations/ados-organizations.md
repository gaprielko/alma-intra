# Organizations between Intra and Alma ADOS: the target contract (draft)

Status: **draft from Intra's side, 2026-10-30.** Nothing is implemented and ADOS has not agreed to it
yet: the user decided that Intra prepares its contracts for this flow and ADOS adapts later. ADOS's
present contract is `docs/integrations/pilot-feedback-intranet.md` (v1.3) in the `alma-ados` repository.

---

## 1. The flow

Intra is the source of truth for organizations, prevádzky, products and their validity.

```
Intra: organization or prevádzka, with the ADOS product and its validity
  │ A. PUT /api/integrations/organizations/{id}
  ▼
ADOS: creates or updates the record, keeps Intra's id
  │ B. POST /feedback, organization.id = Intra's id
  ▼
Intra: the id alone gives the organization and the pracovisko
```

Each organization or prevádzka that holds the ADOS product in `organization_products` is one record in
ADOS. Prices, discounts and notes never travel.

---

## 2. Signing

As in the present contract: `X-Alma-Timestamp`, `X-Alma-Signature` over `timestamp.body` with
HMAC-SHA256, on the raw bytes, ±5 minutes, 401 otherwise. Each direction has its own secret. Request A
gets a new one, `ADOS_ORGANIZATIONS_SECRET`.

---

## 3. A. `PUT {ADOS_API}/api/integrations/organizations/{id}`: Intra → ADOS

The whole present state of one record. The same request again changes nothing.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Intra's id, also in the path; the key in ADOS and the id ADOS sends back |
| `parentId` | UUID or null | a prevádzka's organization; null for an organization |
| `name` | string | |
| `ico` | string or null | a prevádzka shares its organization's |
| `address` | object | `street`, `postalCode`, `city`, each a string or null |
| `product` | object | `validFrom` (date), `validTo` (date or null: ongoing) |
| `updatedAt` | time | a request older than the last one applied is answered 2xx and changes nothing |

Ending a product sends `validTo`. A record is never deleted over this contract.

Answers: 2xx stored, 401 refused signature, 422 refused shape. Intra sends from an outbox and retries
everything but 2xx and 422.

Example:

```json
{
  "id": "9c2d4e6f-1a3b-4c5d-8e7f-0a1b2c3d4e5f",
  "parentId": "1b7e0c52-3d44-4a19-9f60-7c2a5e8d1034",
  "name": "ADOS Harmónia Košice",
  "ico": "12345678",
  "address": { "street": "Hlavná 1", "postalCode": "040 01", "city": "Košice" },
  "product": { "validFrom": "2026-11-01", "validTo": null },
  "updatedAt": "2026-10-30T20:00:00.000Z"
}
```

---

## 4. B. Podnety: ADOS → Intra

Requests 1, 2 and 2b of the present contract, with one change of meaning: `organization.id` is the `id`
of request A, and `organization.name` is no longer needed. ADOS sends the same id back in its request 3
as `organizationId`.

Intra's receiver is ready for both states, in this order:

1. `organization.id` is the id of a live organization or prevádzka in Intra.
2. Otherwise it equals `alma_organization_id` of one; this is the transition, removed once ADOS has
   adapted.
3. Otherwise the item is stored as „Nepriradené“, with `organization.name` if it came.

---

## 5. The transition

1. Today: ADOS has its own ids. „ID v Alma ADOS“ links a record by hand, rule 2 above.
2. Intra sends the existing records with request A, and ADOS links each to its agency.
3. ADOS sends Intra's ids, rule 1 above, and new records start in Intra only.
4. „ID v Alma ADOS“ and rule 2 go.

---

## 6. For later, not decided

- The first user of a new record in ADOS: how the agency's administrator is created.
- Counts from the products (for example the number of nurses) as a limit in ADOS.
- Whether ADOS needs more than the validity to switch its modules, such as „Pilotné podnety“.
- What ADOS does when `validTo` passes.
