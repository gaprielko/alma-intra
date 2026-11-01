# Aktivity: types of activity as a code list

Status: **implemented** (2026-10-30), with the recommendations of section 4. Screens: page „Aktivity“
on the canvas „Alma Intra – screens“. Builds on `docs/activities.md`.

---

## 1. Why

A button in an e-mail records one thing today: interest in a product, hard-coded as an enum. The user
wants the button to record any activity, its type chosen from a code list, with „Záujem o produkt“ as
the first type. The types will later be connected to workflows.

---

## 2. What changes

- **Button dialog:** „Čo tlačidlo urobí“ offers „Otvorí adresu“ or „Zaznamená aktivitu“. Under the
  second, „Typ aktivity“ from the code list, and „Produkt“ when the type asks for one [T-1].
- **Aktivity:** two tabs, „Zoznam“ (today's list) and „Typy aktivít“ (new).
- **Typy aktivít:** the list of types, „Nový typ“, a click on a row edits it.
- **Public page:** its confirm button says the type's own words [T-2].
- **Workflows are not in this step.** The tab is where they will connect later.

---

## 3. Data

New table `activity_types`:

| Column | Meaning |
| --- | --- |
| `id` | a uuid; the seeded „Záujem o produkt“ has a fixed one |
| `name` | „Záujem o produkt“; unique among the live types |
| `confirm_label` | the public page's button: „Áno, mám vážny záujem“; NULL on a type no button records: „Podnet“, or one with the switch „Tlačidlo v e-maile“ off. Only a type with a label is offered in the button dialog, and a type some button holds keeps its label |
| `asks_product` | the button picks a product, and the activity holds it |
| `active` | offered in the button dialog |
| `position`, `created_at`, `updated_at` | as other code lists |

`lead_activities`:

- `type` (the enum) becomes `type_id`, a reference to `activity_types`; the rows move to the seeded
  type in the migration, and the enum goes.
- `product_id` becomes nullable: NULL for a type that does not ask for a product.
- One live row per type, organization, contact and product, with NULL as one value, as today.

The button's attributes: `activityTypeId` and, when the type asks for one, `productId`, instead of
`interestProductId`. A document saved before keeps working: `interestProductId` reads as the seeded
type with that product. The token gains the type's id; a token already in somebody's inbox holds none
and means the seeded type, so e-mails already sent keep working.

---

## 4. Open questions (each with the recommendation)

- **[T-1] Product.** Does every type have a product? Recommended: no, a switch on the type,
  „Vyberá sa produkt“. It is on for „Záujem o produkt“, and the dialog then starts on the template's
  look product, as today.
- **[T-2] The words of the public page.** Recommended: each type has its own text for the confirm
  button, because „Áno, mám vážny záujem“ does not fit another type. The rest of the page is common:
  „Ďakujeme“ and the masked address.
- **[T-3] Repeated confirmation.** Recommended: as today, for every type: one entry, the count grows.
- **[T-4] Removing a type.** Asked by the user: a row shows edit and delete at its right on hover, as
  elsewhere in the app, and delete only when the type is used nowhere. Recommended: used means an
  entry, or a button in a template or an e-mail. A used type can only be switched off: it is then not
  offered for new buttons, but buttons already sent keep recording and its entries stay. Asked by the
  user on 1 Nov 2026: only „Podnet“ is the system's; „Záujem o produkt“ goes like any other once nothing
  uses it, a button in a sent e-mail included, as its link must keep working. A type that cannot go shows
  the delete icon disabled, and the icon says why and how many hold it.
- **[T-5] Notification.** Recommended: the bell tells the sender about every type, on the first
  confirmation only. It says „Nová aktivita“ and the organization, without the type's name, which the
  notification does not hold.
- **[T-6] Where the code list lives.** Recommended: the tab in Aktivity, as asked, not
  Settings › Číselníky, with `can()` actions `activity_type.read` and `activity_type.write`.

---

## 5. After it is deployed

The button of the template „Poďakovanie za záujem 2026“ keeps working unchanged, through the rule for
old documents above. It is saved anew with `activityTypeId` so that it no longer depends on that rule.

---

## 6. Not in this step

Workflows. They come later on this tab: rows get checkboxes, and a panel beside the table sets the
workflow of the checked types, one or several at once. More seeded types, MCP tools for the code
list. Activities from an application are in `docs/activities-from-apps.md`.
