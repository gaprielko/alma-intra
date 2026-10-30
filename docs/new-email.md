# Nový e-mail

Requested by the owner on 30 Oct 2026 (D-38). „Hromadný e-mail“ stays the wizard: one personal e-mail
per recipient. „Nový e-mail“ is one e-mail as in any mailbox.

## Behaviour

- **Komu, Kópia, Skrytá kópia** search contacts, organizations and partners, or take any address.
  A contact adds one recipient; an organization or partner adds its main contact. One without a main
  contact with an e-mail is shown greyed out and cannot be added.
- **An address not in Kontakty** is added, with the offer „Uložiť do kontaktov“ or „Teraz nie“. Saving
  opens the person dialog. Sending does not depend on it.
- **Šablóna** fills the subject and the text. Variables are replaced at once for the first recipient
  in Komu; one without a value stays in brackets to be written over. The look is the global one until
  per-product looks exist.
- **One e-mail**: everybody in Komu and Kópia sees each other, Skrytá kópia is not seen. There is one
  text for all; a different text per person is what „Hromadný e-mail“ is for.
- **Attachments** as in the wizard: from Files or from the computer.
- **Correspondence (D-14)**: no unsubscribe link, and it goes even to an unsubscribed contact, for whom
  the search shows a warning.
- It saves itself as a draft in „Koncepty“. Once sent it is in „Odoslané“, on the timeline of each
  known recipient's organization, and replies come back as to any other e-mail.

## Model

A campaign of the kind `direct`. While a draft, its recipients are in `direct_recipients`. Sending
makes one message row per recipient with its `recipient_role`: rows show the e-mail on timelines and in
the sent detail. Only the first row is picked up by the sender; it sends to all the addresses at once,
and the others take its outcome. `campaign_messages.organization_id` is now nullable, for a recipient
not in Kontakty; bulk e-mails always have it. Delivery events from the provider reach the first row
only, so the others show „sent“. „Použiť znova“ is not offered: it would open the wizard, which needs
an organization for each recipient.
