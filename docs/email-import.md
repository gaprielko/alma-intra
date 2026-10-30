# Adding a forwarded e-mail to a conversation

Agreed with the owner on 30 Oct 2026 (D-37, changed by D-41). Implemented.

## Goal

Before Intra existed, the owner handled customers from a private mailbox. That correspondence should
live in Intra and read as if it had been written there: received e-mails in „Prijaté“, the owner's
own in „Odoslané“, all of it on the organization's timeline and grouped into conversations. It stays
usable at any time, not only for a one-off import.

## How it works

Every received e-mail comes in the same way; nothing is detected on arrival, so a stranger's mail can
never be turned into anything by what it says or by whom it claims to be from.

A user forwards an old e-mail to Intra. Each e-mail of a conversation is forwarded on its own. The
e-mail shows in „Prijaté“ as any other. On its page the three dots next to „Odpovedať“ and „Prílohy“
offer „Pridaj do konverzácie“. A dialog shows what was read from the forward: from, to, date, subject
and where it will go. Confirming replaces the forward by the original.

An e-mail in which no original can be read refuses with a message and stays as it is. An e-mail
already added no longer offers the action.

## What is read

A forward keeps the original's headers only in the text block the mail client adds, whose labels
depend on the client's language. Slovak, Czech, English and German labels of Gmail and Outlook are
recognised, and the date as those clients write it, taken as Bratislava time. The text part is tried
first, then the HTML.

Only the e-mail's own words are kept. What it quotes of earlier e-mails is cut, by the usual signs
(`>`, „On … wrote:“, „Dňa … napísal(a):“, another header block). Earlier e-mails are forwarded
separately and join the same conversation, because conversations group by organization and subject
without „Re:“. The text is stored as plain text: the original's formatting does not survive. The
attachments of the forward are kept.

## Where it goes

The original counts as a colleague's own when its sender is a login or a private address („Môj účet“)
of an active user, or the very address it was forwarded from (then it belongs to the user adding it).

- **A colleague's own**: stored as a sent campaign of one with the original date, with a message for
  each recipient (To, Cc) known in Kontakty. Nothing is queued, so nothing is ever sent. Its
  attachments go to the organization's folder.
- **Nobody among the recipients is known**: it waits in „Prijaté“ as „Nepriradené“, labelled as the
  user's own imported e-mail. A sent e-mail needs an organization (`organization_id` is required).
  Filing it there moves it to „Odoslané“.
- **Anyone else's**: a received e-mail with the original's sender, subject and date, matched by the
  sender's address as any other, already read. Nobody is notified and no copy is forwarded.

A forward filed by hand before it was added keeps that organization when the addresses tell nothing.

## Duplicates

The same original (sender, minute of the date, subject, text) is stored once, however often it is
forwarded (`inbound_messages.import_key`). Adding a repeat refuses with a message; the user discards
that forward.

## Known limits

- The forward is replaced, not kept beside the original, so adding cannot be undone. That is why the
  dialog shows the result first. The audit log records who added it and the outcome.
- The contents of a forward can be forged by whoever forwards it, and adding it trusts them. A user
  sees the result before confirming, and nothing is ever sent.
- A client or language outside those recognised: the action refuses and the e-mail stays as it is.
