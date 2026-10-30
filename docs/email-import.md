# Importing e-mail from a private mailbox (draft)

Status: **draft, not agreed**. Open questions are at the end. Nothing here is implemented.

## Goal

Before Intra existed, the owner handled customers from a private mailbox. That correspondence should
live in Intra and read as if it had been written there: received e-mails in „Prijaté“, the owner's
own in „Odoslané“, all of it on the organization's timeline and grouped into conversations.

The owner forwards each old e-mail to Intra with the message `Alma Intra: add mail`. Intra stores it
as the original e-mail instead of as a new one in the inbox.

## Findings in the current system

- **`info@alma-care.eu` does not reach Intra.** It is the general mailbox outside Intra (D-17b).
  Only `@mail.alma-care.eu` is received, through Resend (runbook). Every address on that subdomain
  arrives at the webhook, so an address there needs no DNS change.
- **The webhook gives no sender verification** that Intra reads today, and a `From` can be forged.
  Without protection, anyone who learns the magic line could write into a customer's timeline.
- **A forward loses the original headers.** Its `From`, date and `Message-ID` are the forward's own.
  The original's are only in the text block the mail client adds, whose labels depend on its language
  („Od:“, „Dátum:“ / „From:“, „Date:“). Attachments of the original do come along.
- **A sent e-mail must belong to an organization**: `campaign_messages.organization_id` is required.
- **Conversations** are grouped by organization and subject without „Re:“, so imports join existing
  conversations without needing the original `Message-ID`.
- **Sending** only picks up queued messages, so an import stored as already sent is never sent.

## Proposed behaviour

### Intake

1. A forward arrives at the user's personal import address (see Q1) and starts with the line
   `Alma Intra: add mail`. It is handled before the normal inbox logic.
2. The block of the original is parsed: from, to, cc, date, subject. Slovak and English labels of
   Gmail and Outlook are recognised. The text under the block, with the forward's own header removed,
   is the body. Attachments are kept.
3. **Direction**: original `From` is one of the user's private addresses: the user's own e-mail.
   Anything else: a received e-mail.

### A received e-mail

Stored in `inbound_messages` with the original sender, subject and date, matched to a contact and an
organization by the sender's address as today, already read, with no notification.

### The user's own e-mail

Stored as a campaign of one in the state „sent“, with `sender_user_id` the importing user, the
original date as `sent_at`, one message per recipient found in Kontakty, and marked as imported. It
shows in „Odoslané“ and on the timeline, without delivery figures, which do not exist for it.

### Safeguards

- **Duplicates**: the same original (sender, date, subject, text) is stored once, so a repeated
  forward changes nothing.
- **Nothing is ever sent** to the customer by an import.
- **Whatever cannot be read or matched is not lost**: it stays in „Prijaté“ as „Nepriradené“, marked
  as an import that needs attention, where it can be filed by hand.
- The user gets an in-app notification of what was added or what failed.
- Imports appear in the audit log.

## Alternative worth weighing

Forwarding is one action per e-mail, and it recovers the original only by parsing text. A **one-time
upload of a mailbox export** (`.mbox` from Google Takeout, or `.eml` files, in Settings) keeps the
exact headers, dates and threading and handles years of mail at once. It needs no secret address and
no parsing of forwards. The forward remains useful for an occasional e-mail found later.

## Open questions

- **Q1. Address.** Proposed: a personal address with a secret, `import+<secret>@mail.alma-care.eu`,
  shown in „Môj účet“ and renewable. It replaces `info@alma-care.eu`, and the secret, not the `From`,
  proves who is importing.
- **Q2. Private addresses.** Proposed: entered in „Môj účet“; they tell own e-mails from received ones.
- **Q3. Recipient not in Kontakty.** Proposed: the own e-mail waits in „Nepriradené“ until filed,
  because a sent e-mail needs an organization. Alternative: create the contact automatically.
- **Q4. Which date.** Proposed: the original's everywhere, so old mail sorts into the past.
- **Q5. Quoted history.** A forwarded reply usually quotes everything before it. Proposed: keep the
  text as it is, because cutting quotes reliably is not possible.
- **Q6. Forward or upload.** Forward only, upload only, or both.
- **Q7. Scope.** Only the owner, or every user.
