# Answering and forwarding in a conversation

Agreed with the owner on 30 Oct 2026 (D-44). Implemented. Replaces the dialog of spec 6.6, E6e.

## The received e-mail

- A click anywhere on the head of the newest e-mail, outside its links and buttons, folds it to a row
  like the older ones under it. A click on the row opens it again.
- The buttons in order: „Prílohy“, „Odpovedať“ with an arrow, the three dots. „Odpovedať“ never moves:
  the place of the three dots stays when they are hidden. Behind the arrow are „Odpovedať všetkým“
  and „Preposlať“.
- „Odpovedať“ and „Odpovedať všetkým“ are disabled until the e-mail is filed under a contact, as they
  go to a customer. „Preposlať“ works always.

## The row being written

Each opens a new row at the top of the conversation, with no dialog: the fields of „Nový e-mail“
(docs/new-email.md) without the template, and its editor, showing the e-mail in its real look. A click
on the row's head folds it and keeps what is typed. A draft saves itself, is in „Koncepty“, and comes
back as a row when the e-mail is opened again; each user has one draft per e-mail and kind.

| | Komu | Kópia | Subject | Attachments |
| --- | --- | --- | --- | --- |
| „Odpovedať“ | the sender of the e-mail | | `Re:` | |
| „Odpovedať všetkým“ | the sender and its other To | its Cc | `Re:` | |
| „Preposlať“ | typed or searched in Kontakty, organizations, partners | | `Fwd:` | those Files has |

„Odpovedať všetkým“ leaves out Alma's own addresses (as in docs/email-import.md), the user's own
and the inbound domain's. An attachment of an unfiled e-mail is not in Files yet, so a forward cannot
carry it; the row says so.

- **The look**: the product of the organization when it has exactly one, with a look of its own; else
  the global one. It can be changed in the row.
- **The signature** is part of the text, inserted when the draft is made, so it can be changed for
  this one e-mail without touching „Môj účet“. Such an e-mail gets no second signature when sent. An
  answer with nothing but the signature is refused; a forward needs no text of its own.
- **The quote**: the received e-mail's plain text with a head line, shown or hidden under the editor
  and added under the text on sending. The formatting of the original does not survive.

## Model

A campaign of the kind `direct` with `reply_to_inbound_id` and `reply_mode`. An answer's first message
row carries `in_reply_to_inbound_id`, so the sender adds `In-Reply-To` and `References`; a forward
does not thread. The conversation shows a direct e-mail once per organization, not once per recipient.

## Known limits

- The editor has no underline, as e-mail templates have none: same editor, same blocks (D-25).
- The brand name in the inserted signature is the look's at the time the draft was made.
