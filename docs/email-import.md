# Importing e-mail from a private mailbox

Agreed with the owner on 30 Oct 2026 (D-37). Implemented.

## Goal

Before Intra existed, the owner handled customers from a private mailbox. That correspondence should
live in Intra and read as if it had been written there: received e-mails in „Prijaté“, the owner's
own in „Odoslané“, all of it on the organization's timeline and grouped into conversations.

## How it works

The user forwards an old e-mail to `info@alma-care.eu`, which reaches Intra, with the message
`Alma Intra: add mail`. Each e-mail of a conversation is forwarded on its own.

Before a received e-mail is processed, Intra checks, in this order:

1. **The setting**: Settings › Vzhľad e-mailov › „Import starých e-mailov“. Off (the default): no
   e-mail is treated as an import.
2. **The sender**: the forward's `From` is one of the private addresses a user entered in „Môj účet“.
3. **The agreed line**: in the words above the forwarded block, ignoring case.
4. **The original**: its block can be read, with at least a sender and a date.

If any of these fails, the e-mail goes on as an ordinary received one, so nothing is lost.

## What is read

A forward keeps the original's headers only in the text block the mail client adds, whose labels
depend on the client's language. Slovak, Czech, English and German labels of Gmail and Outlook are
recognised, and the date as those clients write it, taken as Bratislava time.

Only the e-mail's own words are kept. What it quotes of earlier e-mails is cut, by the usual signs
(`>`, „On … wrote:“, „Dňa … napísal(a):“, another header block). Earlier e-mails are forwarded
separately and join the same conversation, because conversations group by organization and subject
without „Re:“. The text is stored as plain text: the original's formatting does not survive. The
attachments of the forward are kept.

## Where it goes

- **The original's sender is one of the importer's private addresses**: their own e-mail. It is
  stored as a sent campaign of one with the original date, with a message for each recipient (To, Cc)
  known in Kontakty. Nothing is queued, so nothing is ever sent. Its attachments go to the
  organization's folder.
- **Nobody among the recipients is known**: it waits in „Prijaté“ as „Nepriradené“, labelled as the
  user's own imported e-mail. A sent e-mail needs an organization (`organization_id` is required).
  Filing it there moves it to „Odoslané“.
- **Anyone else's**: a received e-mail with the original's sender, subject and date, matched by the
  sender's address as any other, already read. Nobody is notified and no copy is forwarded.

## Duplicates

The same original (sender, minute of the date, subject, text) is stored once, however often it is
forwarded (`inbound_messages.import_key`). A repeat leaves only a discarded row, so the provider's
list does not offer it again.

## Known limits

- **A forged sender**: Intra does not verify the forward's `From`. Someone who knows both a listed
  private address and the agreed line could add a false e-mail to a timeline. It would send nothing.
  The setting is meant to be on only while importing.
- A client or language outside those recognised: the e-mail arrives as an ordinary one.
- Whether `info@alma-care.eu` reaches Intra depends on the mailbox's forwarding, outside this repo.
