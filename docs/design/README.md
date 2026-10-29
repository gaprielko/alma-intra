# Alma Intra: screen designs

The agreed screen designs for stages E0–E8 of [the functional spec](../functional-spec.md),
exported from the design canvas [Alma Intra – screens](https://claude.ai/artifact/Cej4Jk7P7FXMQWoYmyW3Tf)
(state of 26 Oct 2026). The canvas is the place to look at them; these files are its source, kept
with the code so the implementation can be checked against them.

## Format

- `canvas.json`: the canvas index (pages, board positions and titles).
- `*.dc.html`: one board each, a self-contained HTML page with a small `DCLogic` script. They load
  `./support.js`, the canvas runtime, which is not in this repo, so they do not render when opened
  from disk. Read them as markup: the colours, spacing, copy and structure are the spec.
- Slovak copy in the boards is the intended UI copy. Sample data (customers, people, prices) is
  invented.

## Boards

| Stage | Board | Screen |
| ----- | ----- | ------ |
| Brand | `Logo.dc.html` | App logo (speech bubble), marks of the sidebar items |
| E0 | `Main.dc.html` | Sign-in |
| E0 | `SecondStep.dc.html` | Second-factor code at sign-in |
| E0 | `SetupTwoFactor.dc.html` | Mandatory 2FA setup after activation |
| E0 | `Users.dc.html` | Settings › Users |
| E0 | `InviteUser.dc.html` | Invite a user (dialog) |
| E0 | `Account.dc.html` | My account |
| E0 | `Sidebar.dc.html` | Sidebar component (used by every app screen) |
| E1 | `Customers.dc.html` | Customer list |
| E1 | `CustomerDetail.dc.html` | Customer detail, organization |
| E1 | `IndividualDetail.dc.html` | Customer detail, private person |
| E1 | `CustomerForm.dc.html` | New / edit customer |
| E1 | `ContactDialog.dc.html` | Contact (dialog) |
| E1 | `CodeLists.dc.html` | Settings › Code lists |
| E2 | `Files.dc.html` | Files: company documents and customer folders |
| E2 | `FileDetail.dc.html` | File detail, versions, where used |
| E2 | `FilePicker.dc.html` | Attach files (dialog) |
| E3 | `ActivityDialog.dc.html` | Record an activity (dialog) |
| E3 | `ActivityDetail.dc.html` | Activity detail and next steps |
| E4 | `Templates.dc.html` | E-mail templates |
| E4 | `TemplateEditor.dc.html` | Template editor in the real e-mail look |
| E4 | `EmailLook.dc.html` | Settings › E-mail look |
| E4 | `EmailCanvas.dc.html` | Company e-mail layout (component) |
| E5 | `SendRecipients.dc.html` | Send wizard, 1 recipients |
| E5 | `SendContent.dc.html` | Send wizard, 3 content and custom fields |
| E5 | `SendPreview.dc.html` | Send wizard, 4 preview and per-recipient edit |
| E5 | `SendReview.dc.html` | Send wizard, 5 review and send |
| E5 | `Campaign.dc.html` | Sent e-mail, delivery status |
| E5 | `Unsubscribe.dc.html` | Public unsubscribe page |
| E6 | `Inbox.dc.html` | E-mails › Received |
| E6 | `Conversation.dc.html` | Conversation: reply on top, newest first, collapsible (interactive) |
| E6 | `AssignReply.dc.html` | Assign an unknown sender's e-mail, kind and type (interactive) |
| E7 | `ClaudeAccess.dc.html` | My account › Access for Claude |
| E7 | `TokenCreated.dc.html` | New personal access token (shown once) |
| E7 | `OAuthConsent.dc.html` | Approve the Claude connector (OAuth) |
| E7 | `GenerateDocument.dc.html` | Create a document from a template |
| E7 | `ClaudeActivity.dc.html` | Settings › Activity log, changes by Claude |
| E8 | `Dashboard.dc.html` | Overview (dashboard) |
| E8 | `Scheduled.dc.html` | E-mails › Scheduled and drafts |
| E8 | `Segments.dc.html` | Customers › saved segments |
| E8 | `SegmentRecipients.dc.html` | Send wizard, recipients from a segment |
| Org | `OrgCustomers.dc.html` | Organizácie › Zákazníci (multi-select dropdown filters) |
| Org | `OrgPartners.dc.html` | Organizácie › Partneri |
| Org | `OrgContacts.dc.html` | Organizácie › Kontakty (persons) |
| Org | `OrgCustomerDetail.dc.html` | Customer detail: contact persons with position, add a new or existing person |
| Org | `OrgPartnerDetail.dc.html` | Partner detail, „Zmeniť na zákazníka“ |
| Org | `OrgIndividualDetail.dc.html` | Private person as a customer, without status |
| Org | `ContactDetail.dc.html` | Contact (person) detail: organizations and the person's own timeline |
| Org | `PersonDialog.dc.html` | New person: organizations with position, existing e-mail |
| Est | `EstOrgDetail.dc.html` | Organization with prevádzky: their table, persons as a table, timeline with prevádzky (interactive switch) |
| Est | `EstDetail.dc.html` | Prevádzka detail |
| Est | `EstDialog.dc.html` | New prevádzka with its primary contact |
| Est | `EstActivityDialog.dc.html` | Record an activity: the prevádzka found by the contact |
| Prod | `ProdList.dc.html` | Produkty: products with base price, what it includes and surcharges |
| Prod | `ProdDetail.dc.html` | Product detail: price list and price calculator (interactive) |
| Prod | `ProdItemDialog.dc.html` | Add an item to a price list from the shared catalog |
| Prod | `ProdItems.dc.html` | Položky: the shared catalog of item names |

The `Org` boards are the agreed redesign of [contacts-redesign.md](../contacts-redesign.md) (29 Oct
2026); they replace the E1 boards once implemented. `Sidebar.dc.html` gained the switch
`organizations` that names the item „Organizácie“.

The `Est` boards are the draft of [establishments.md](../establishments.md) (prevádzky, 29 Oct
2026), not yet agreed.

The `Prod` boards are the draft of [products.md](../products.md) (29 Oct 2026), not yet agreed.
`Sidebar.dc.html` shows „Produkty“ under „Organizácie“ when `organizations` is on.

## Keeping them in step

A change made on the canvas is exported here again (same file names). The design tokens the
boards use are the ones of `packages/shared/src/tokens.ts`, taken over from Alma ADOS.
