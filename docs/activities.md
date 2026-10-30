# Aktivity: serious interest from an e-mail button

Status: **agreed and implemented** (2026-10-30). Screens: page „Aktivity“ on the canvas „Alma Intra –
screens“. All recommendations in section 5 were accepted.

---

## 1. Why

The template „Poďakovanie za záujem 2026“ (Follow-up, look ADOS) has a button „Mám vážny záujem“.
Today it is a `mailto:` to info@alma-care.eu, so nothing is recorded. The user wants the button to
record the request in Intra, and a list of serious prospects in a new main menu item „Aktivity“.
Actions that follow from an activity come later.

---

## 2. Flow

1. A colleague sets the button in a template (or an e-mail) to „Zaznamená záujem o produkt“ and
   picks the product. It starts on the template's look product, here ADOS.
2. At sending, each recipient gets their own link: `<WEB_URL>/zaujem#<token>`, in the fragment like
   `/odhlasenie#<token>`.
3. The recipient clicks and sees the public page with a masked address and the button „Áno, mám
   vážny záujem“. **Opening the page records nothing**, a mail scanner can open links too [A-1].
4. The button posts the token, the activity is saved, the page says thank you.

---

## 3. Data

New table `lead_activities`, apart from `activities` (calls and meetings a colleague logs, with a
next step and attachments, editable). One row per contact and product [A-3].

| Column | Meaning |
| --- | --- |
| `type` | enum, for now only `product_interest` („Záujem o produkt“) |
| `product_id` | the product, here ADOS |
| `organization_id` | the customer or partner, required |
| `contact_id` | the contact; NULL only for a private person, who has no contact |
| `campaign_message_id` | the e-mail it came from: subject, template, sender, sent at |
| `email` | the address the e-mail went to, kept as it was then |
| `created_at` | when it entered the system |
| `last_confirmed_at` | the latest confirmation |
| `deleted_at` | soft delete [A-7] |

Unique while alive: organization, contact (NULL as one value) and product, with the type.

The token is signed with a server key and holds the message id and the product id, like the download
token (`download-link.ts`); nothing is stored. It does not expire: a late interest is still interest.
Only a message that left counts, so a preview cannot create an activity.

A public `POST` in the style of `unsubscribe.*`, audited like `unsubscribe.oneClick`, rate limited.
The IP address is not stored on the activity.

---

## 4. Screens

- **Sidebar:** „Aktivity“ is the 3rd item: Prehľad, E-maily, Aktivity, Organizácie, Produkty, Súbory.
- **Aktivity › Zoznam:** newest first; search, filters Typ, Produkt, Obdobie; columns Prišla, Typ,
  Produkt, Organizácia / partner (with its role), Kontakt, Odkiaľ. Read only.
- **Aktivity › Detail aktivity:** what happened, who, from which e-mail; „Odstrániť“.
- **Public page:** the confirm step, the thank-you, „už evidujeme“ and an invalid link, with the look
  of the product. The token is in the fragment, so the page holds nothing without it.
- **Šablóna › Tlačidlo:** the dialog gains „Čo tlačidlo urobí“: open an address, or record interest
  in a product, with the product.
- **Časová os** of the organization and the contact: a read-only line „Záujem o produkt · ADOS“ [A-4].

The template's own button is changed from `mailto:` once this works. It has not been sent yet
(`sentCount` 0).

---

## 5. Decisions

- **[A-1] What counts as serious interest?** Recommended: only the confirm button on the public page.
- **[A-2] Two kinds of „Aktivity“.** Recommended: the menu stays „Aktivity“; those on the timeline
  become „Záznamy“ (words only, no data change).
- **[A-3] A repeated confirmation.** Recommended: one row per contact and product; it moves
  `last_confirmed_at`, the page says the interest is already recorded.
- **[A-4] On the detail of the organization and the contact?** Recommended: yes, read only. The
  customer's sales status does not change by itself.
- **[A-5] Notify the sender?** Recommended: yes, the bell, because the e-mail promises more
  information. Other follow-up actions later.
- **[A-6] A recipient who is not in Kontakty** (only „Nový e-mail“). Recommended: no working button
  for them, and a warning shows. A „Nový e-mail“ is one e-mail for everybody on it, so its button
  records the first To only; the composer warns about that too.
- **[A-7] What can be done with an activity?** Recommended: list, detail and delete (test clicks).
  No states, owner or notes until the follow-up actions.

---

## 6. Not in this step

States and owners, follow-up actions, further types, sending the demo information automatically,
merging calls and meetings into the list.
