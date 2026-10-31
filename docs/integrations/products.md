# Intra and its products: the contract (draft)

Status: **draft from Intra's side, 2026-10-31.** Nothing is implemented and Alma ADOS has not agreed to
it yet: the user decided that Intra prepares its contracts and ADOS adapts later. The reasoning, the
sequence diagrams and the decisions are in the Intra file „Alma - Solutions Architecture.html“
(Firemné dokumenty / Firma / Technológie). Screens: boards with „(návrh)“ on the pages
„Produkty“ and „Organizácie“ of the canvas. Podnety keep their own contract,
`docs/integrations/pilot-feedback-intranet.md` in the `alma-ados` repository, with the one change in
section 6.

---

## 1. Who owns what

| Data | Owner | The other side |
| --- | --- | --- |
| Organizations, prevádzky, contacts | Intra | The product keeps a copy of what it needs; Intra's id is the key |
| A product and its roles | The product app | Read only in Intra after registration |
| Prices, other price list items | Intra | The product does not know them |
| Assignment, validity, scope per role | Intra | The product gets the validity and checks the scope |
| Users and their accounts | The product app | Intra knows only which account holds which place |

An organization and its prevádzka can each hold a product. In the product they are equal organizations,
and a user in both switches between them. So every row of `organization_products` is one organization
in the product, with its own scope, founding and places.

---

## 2. Signing

As in the podnety contract: `X-Alma-Timestamp` and `X-Alma-Signature: sha256=<hex>` of HMAC-SHA256 over
`timestamp.body` on the raw bytes, ±5 minutes, 401 otherwise, constant-time comparison.

| Key | Signs | Where it lives |
| --- | --- | --- |
| Registration secret | only the first registration of a product | one value per environment, in Intra as `PRODUCT_REGISTRATION_SECRET` and in the product as `INTRA_REGISTRATION_SECRET` |
| `toIntraKey` | everything the product sends after that | issued by Intra at the first registration, stored by the product |
| `toProductKey` | everything Intra sends to the product | issued the same way |

Intra keeps the two issued keys encrypted with `DATA_ENCRYPTION_KEY`. A leaked key of one product does
not touch another. A leaked registration secret can only add a new product, which cannot be assigned
until a worker fills in its prices. A worker can issue new keys for a product in Intra.

---

## 3. Registration: product → Intra

`PUT {INTRA_URL}/api/integrations/products/{code}`, at the first deploy or at every start. A failure
does not stop the product, which tries again in the background.

| Field | Type | Notes |
| --- | --- | --- |
| `code` | string | permanent, the same as in the path: `ados` |
| `name` | string | shown in Intra: `ADOS` |
| `baseUrl` | https URL | where Intra calls the product |
| `version` | string | shown in Intra |
| `roles[]` | array, ≥ 1 | see below |

`roles[]`: `code` (permanent), `name`, `unit` (the word for one), `founding` (boolean). Exactly one role
is founding, or the answer is 422 and the last valid state stays. Only an organization's roles are
sent, not the platform's.

```json
{
  "code": "ados",
  "name": "ADOS",
  "baseUrl": "https://app.adosalma.sk",
  "version": "4f2a91c",
  "roles": [
    { "code": "admin", "name": "Admin", "unit": "prístup", "founding": true },
    { "code": "nurse", "name": "Sestra", "unit": "sestra" }
  ]
}
```

Answers: 200, with `{ "toIntraKey": "…", "toProductKey": "…" }` at the first registration only and `{}`
after that; 401; 422.

A role missing from a later registration is marked retired in Intra: it cannot be assigned again, and
what already holds it stays until a worker resolves it.

---

## 4. Founding and updates: Intra → product

`PUT {baseUrl}/api/integrations/organizations/{id}`: the whole present state of one row. The same request
again changes nothing but the differences. Sent from an outbox, retried on everything but 2xx and 422.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | UUID | Intra's id of the organization or prevádzka, also in the path; the key in the product |
| `parentId` | UUID or null | for information; the product treats both as equal |
| `name` | string | |
| `ico` | string or null | |
| `address` | object | `street`, `postalCode`, `city`, each a string or null |
| `validFrom`, `validTo` | date, date or null | the product goes read only outside them on its own |
| `active` | boolean | false when marked inactive in Intra (the marking comes later) |
| `foundingAccount` | object or null | `name`, `email`; present only for founding |
| `updatedAt` | time | an older request is answered 2xx and changes nothing |

Answer to founding: 200 with `{ "foundingAccountId": "…" }`; Intra then holds that account's place. If an
account with that e-mail already exists, the product uses it. Prices and discounts never travel.

A product is **active** when the organization is founded, today is within the validity and it is not
marked inactive. When it is not, the agency can read but not edit, and new places are refused.

---

## 5. Places: product → Intra

The product asks before it creates a user, and Intra assigns the place at once, so two administrators
cannot take the last one together. Only the founding role creates accounts in an organization.

`POST {INTRA_URL}/api/integrations/seats`, idempotent by `organizationId`, `accountId` and `roleCode`:

| Field | Type | Notes |
| --- | --- | --- |
| `organizationId` | UUID | Intra's id |
| `roleCode` | string | |
| `accountId` | UUID | made by the product |
| `workloadPercent` | integer 1–100 or null | sent for every role; used by a role counted by workloads |

Intra refuses with 409 and `{ "reason": …, "limit": …, "used": … }`:

| Reason | When |
| --- | --- |
| `NOT_ASSIGNED` | no live row, or the row does not hold this product |
| `NOT_ACTIVE` | outside the validity, or marked inactive |
| `ROLE_NOT_AVAILABLE` | the role is not of this product, or is retired |
| `LIMIT_REACHED` | no room in the scope of this role |

Also:

- `PUT …/seats/{organizationId}/{accountId}/{roleCode}`: a changed workload, refused the same way.
- `DELETE` on the same address: an account switched off or a role taken away. Retried from a queue.
- `GET …/seats?organizationId=…`: scope and use per role, for the form.
- `PUT …/seats/{organizationId}`: the whole list, once, when an existing organization is linked. Going
  over the scope is accepted and shown to the worker.

**How the scope counts.** A role counted in pieces takes one place per account. A role counted by
workloads uses the rule of the price: each workload is first rounded up to the product's step, then
they are summed (`docs/products.md`, R-14). An empty workload counts as the step, generally 50 %. The
limit is the whole count: 5 nurses are 500 %, even when a billed sum of 450 % was rounded to 5. A person
with two roles takes a place in each, and a person in two organizations takes a place in each.

Lowering a scope touches no existing account: new ones are refused until the use falls, and the worker
sees the excess. While Intra is down, no new account can be made and no role or workload changed; people
keep working.

---

## 6. Podnety

Requests 1, 2 and 2b stay, with one change of meaning: `organization.id` is Intra's id, and
`organization.name` is no longer needed. The receiver takes Intra's id first and `alma_organization_id`
until ADOS has moved. See `docs/activities-from-apps.md`.

---

## 7. What changes in Alma ADOS

- Registers at start; founding creates an organization and its first account from Intra's request.
- Creating an organization and managing an agency's accounts leave `super_admin`; the founding role does
  the latter. An operator's account stays, only for what has no new home yet: second factor reset, the
  „Funkcie“ modules, the insurers' price lists, audit across agencies. It is not sold, not registered and
  not checked.
- Read only outside the validity or when not active.
- An empty workload counts as the product's step here, while ADOS's capacity forecast counts it as full
  time. They answer different questions, and both stay.

---

## 8. The move from today

1. Today's product ADOS gets the code `ados`, so the first registration joins it with its prices and
   assignments.
2. A migration moves „Admin prístup“ to the role `admin` and „Sestra“ to `nurse`, with prices and
   scopes. „Superadmin“ ends: whoever holds it is resolved by a worker first. The rest stay other items.
3. An existing agency is linked by „Prepojiť s existujúcou“, using today's „ID v Alma ADOS“, and sends
   its list of accounts. The field and the second lookup of podnety end after that.
4. The check goes on only when every agency is linked.
