# A contact from a user of the app

Agreed with the owner on 30 Oct 2026 (D-47). Implemented.

## Goal

A colleague, the user themself included, can become a contact person of an organization without being
entered again. Their details are kept in one place: a change in „Používatelia“ reaches the contact,
and a change in the contact never reaches the user.

## Adding

„Pridať kontaktnú osobu“ on an organization or a prevádzka gets a third choice next to „Nová osoba“
and „Existujúci kontakt“: „Používateľ aplikácie“. It lists active and invited users, found by name or
e-mail; deactivated ones are left out. As with an existing contact, the dialog asks for the position
in this organization and whether the person is primary. The position starts as the user's own and can
be changed, because it belongs to the link.

A user who is already a contact is not created twice: the same contact gets one more organization.

## What follows the user

A contact made from a user points to them (`contacts.user_id`, unique, nullable).

| Follows the user, read-only on the contact | The contact's own, editable |
| ------------------------------------------ | --------------------------- |
| Titles, first name, last name              | Gender, salutation          |
| E-mail, phone                              | Note, receiving bulk e-mail |
|                                            | Position, primary, per link |

A user's change is written to the contact in the same transaction. `users.name` is one text: the last
word becomes the last name and the rest the first name; a single word stands for both, until the user
gets a full name. It is recorded in the user's history, not the contact's.

The contact's page and „Upraviť osobu“ show the followed fields as read-only, with a note „Údaje sa
preberajú z používateľa“ and a link to the user. `person.update` and the MCP tool `contacts_update`
refuse a change to these fields, so no route writes back.

## When the two part

- **The user is deactivated or removed:** the contact stays with its last details and its fields
  still cannot be edited while the user is deactivated. A reactivated user continues. A removed user's
  contact becomes an ordinary contact.
- **The contact is deleted or unlinked from an organization:** the user is untouched.
- **Removing the link:** „Odpojiť od používateľa“ makes it an ordinary contact that keeps its details.

## Existing contact with the user's e-mail

An e-mail belongs to one live contact (D-7). If it is taken, the dialog says so and offers to connect
that contact to the user. Its followed fields then take the user's values; the dialog shows the ones
that change before confirming.

## Other parts of the app

A linked contact is a normal recipient of e-mails. Adding an imported e-mail still treats the
address as a colleague's own first (`docs/email-import.md`). No login or permission depends on the link.
