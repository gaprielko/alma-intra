# Produkty: products, their items and prices (draft)

Status: **agreed** (2026-10-29); implementation after the prevádzky (stages R1–R5). Phase 1 (spec) and phase 2 (screens: the `Prod*` boards on
the canvas page „Produkty · návrh“). How a product is assigned to an organization or a prevádzka and
shown on its detail follows once this is agreed (section 9); it continues
[establishments.md](establishments.md) section 4.4.

Marks: **[R-n]** a decision of this spec (section 11).

---

## 1. Why

Today a product is only a name in Nastavenia › Číselníky (ADOS, DOS, Stacionár) ticked on a
customer. The user wants products as software a customer buys, each with its own price list:

- a product has a name (ADOS) and a base price;
- the base price includes a number of accesses per role (ADOS: 1 admin, 4 sestry);
- each further access has a surcharge (another admin, another sestra), up to a maximum;
- a product may have items of its own (a superadmin role with its own price), so every product is
  set up on its own;
- the names of the items are shared: „Admin prístup“ made for ADOS is picked from a list for DOS.

---

## 2. Terms

- **Produkt** (code: `product`): what a customer buys. Name, short description, base price for a
  period, state.
- **Položka** (code: `product_item`, the catalog): a named thing a price list counts or adds:
  „Admin prístup“, „Sestra“, „Superadmin“, „Implementácia“. Shared by all products [R-2].
- **Rola** (`product_item` of kind `role`): a catalog item that is an access of a user. It names the
  applications it reaches, **Mobil**, **Web** and **Backend**, at least one, possibly all [R-20, R-21].
- **Ďalšia položka** (`product_item` of kind `other`): every other catalog item, such as
  „Implementácia“. It reaches no application [R-20].
- **Položka produktu** (code: `product_price_item`): an item in one product's price list, with that
  product's numbers: how many are in the base price, the price of each further one, the maximum,
  whether it repeats every period or is paid once [R-3].

---

## 3. Data model

```
products                    (today's code list `products`, extended) [R-1]
  id, name (unique), description
  base_price, base_price_gross   numeric(10,2), EUR without and with VAT; NULL = not set yet
  period                    'month' | 'year'
  workload_step             % to which every workload is rounded up (e.g. 50); for items counted
                            by workloads [R-14]
  state                     'offered' | 'withdrawn' (no longer offered; kept for customers who have it)
  position, created_*, updated_at, deleted_at

product_items               the shared catalog of item names [R-2]
  id, name (unique), unit   „Admin prístup“ / unit „prístup“; „Sestra“ / „sestra“
  kind                      'role' | 'other'; set when created, never changed [R-20]
  apps                      text[] of 'mobile', 'web', 'backend': at least one for a role, none for
                            another item (a check in the database) [R-21]
  description, created_*, deleted_at

product_price_items         one product's price list [R-3]
  product_id, item_id       (one item once per product)
  included                  how many are in the base price (0 = none)
  unit_price, unit_price_gross   each further one, EUR without and with VAT; NULL = none may be
                            added beyond `included`
  max                       the most a customer may have (NULL = no limit)
  billing                   'recurring' (every period of the product) | 'once'
  by_workload               counted from workloads at the customer (recurring roles only) [R-23]
  position                  order in the price list
```

The price of a product for given counts [R-4]:

```
recurring = base_price + Σ over recurring items: max(0, count − included) × unit_price
once      =              Σ over one-off items:  count × unit_price
```

A count above `max` is refused. The sums are made without VAT; the total with VAT is the sum times
(1 + rate), rounded to cents.

**With and without VAT** [R-9]: every price is shown and entered both ways. The user types either
one, the other is computed with the VAT rate and rounded to 2 decimals (half up); both are stored,
so what was typed stays exact. The **VAT rate** (%, today 23) is a setting, Nastavenia › „Ceny a DPH“
(board `ProdVatSettings`). When it changes, the prices without VAT stay and those with VAT are
recomputed; the change is audited.

---

## 4. Navigation

A sidebar item **„Produkty“** right under „Organizácie“ [R-5], with two tabs:

| Tab | What |
| --- | ---- |
| **Produkty** | the products with their base price and what it includes |
| **Role** | the shared catalog of roles, with their applications |
| **Ďalšie položky** | the shared catalog of the other items |

„Produkty“ leaves Nastavenia › Číselníky; the code list's products become products (section 8).

---

## 5. Produkty (list)

Board `ProdList`. A table, paging as elsewhere, a search by name, and a switch **S DPH / Bez DPH**
(prices with VAT by default; the other form is shown small under the base price):

| Column | Content |
| ------ | ------- |
| Produkt | the name as a chip and the description under it |
| Základná cena | „60,27 € / mesiac“ (with VAT, „bez DPH 49,00 €“ under it); „cena nezadaná“ when empty |
| V základnej cene | „1 × Admin prístup · 4 × Sestra“ |
| Príplatky | the items with a price per further one, „Admin prístup +10 € · Sestra +8 €“ |
| Zákazníci | how many organizations and prevádzky have it (link to the filtered list) |
| Stav | „Ponúka sa“ / „Už sa neponúka“ |

Actions: „Nový produkt“, a row's „…“: Upraviť, Duplikovať, Už sa neponúka / Znova ponúkať,
Odstrániť (only while no customer has it).

---

## 6. A product's detail and price list

Board `ProdDetail`, at `/products/<id>`. One page that is edited in place (no separate form):

- **Základné údaje**: name, description, base price, period (Mesačne / Ročne), state. The price is
  shown without VAT first and with VAT next to it; the one with VAT is the one entered (the other
  is worked out and shown on a grey field), and typing the price without VAT works out the other
  way [R-16]. The same holds for each item's price in the Cenník.
- **Cenník** (the price list), a table, rows dragged to order:

  | Položka | Platba | V cene | Cena za ďalšiu | Max. | |
  | ------- | ------ | ------ | -------------- | ---- | - |
  | Admin prístup | opakovane | 1 | 10 € | 3 | odobrať |
  | Sestra | opakovane | 4 | 8 € | 50 | |
  | Superadmin | opakovane | 0 | 25 € | 1 | |
  | Implementácia | jednorazovo | 0 | 450 € | 1 | |

  „Pridať položku“ opens the item picker (section 7).

  The Cenník has two parts, apart to the eye [R-22], each with a heading, a table and a button of
  its own: **Role** („Pridať rolu“; each row shows its applications under the name) and, under a
  dividing band, **Ďalšie položky** („Pridať položku“). Rows are ordered within their part. A role
  always comes before another item, wherever the price list is shown (the calculator, a product at
  a customer). Board `ProdRoleDetail`.
- **Výpočet ceny** (right): counts per item, each line explained („Sestra: 10, z toho 4 v cene,
  6 × 8 € = 48 €“), and the totals in a small table: monthly, yearly (12 months; for a yearly product
  the month is a twelfth) and one-off, each without and with VAT. It is a calculator for offers; it
  stores nothing [R-6].
- **Majú ho** (under the price list): a table of the organizations and prevádzky with the product:
  name (and whose prevádzka), what they have („2 admin · 10 sestier“), the monthly and the yearly
  price without VAT. Its numbers come with the product at a customer (section 9).
- **História zmien**: who changed which price when (the audit, as elsewhere).

Saving changes a product for the future; what it does to customers who already have it is section
9's question [R-7].

„Duplikovať“ copies a product with its price list under the name „ADOS (kópia)“, a quick start for
a similar product.

---

## 7. Adding an item: the shared catalog

Dialog „Pridať položku“ (board `ProdItemDialog`) on a product's price list:

- a search over the catalog; each item shows where it is already used, with that product's numbers
  („v ADOS: 1 v cene, +10 €, max. 3“);
- picking one adds it with the numbers of the product it was last used in, ready to change
  („Prevziať nastavenia z ADOS“, on by default) [R-8];
- **„Nová položka“**: a name and a unit; it joins the catalog and is offered to every product
  from then on;
- an item already in this product's price list is shown but cannot be added twice.

The dialog offers one kind only, the one of the part it was opened from: „Pridať rolu“ lists roles
with their applications and creates a „Nová rola“ (board `ProdRolePicker`), „Pridať položku“ lists
the other items.

## 8. Role and Ďalšie položky (catalog tabs)

Boards `ProdRoles` and `ProdOtherItems`. A table each: name, unit, description, the products that
use it (chips); Role also has a column **Aplikácie**. Actions: „Nová rola“ or „Nová položka“, rename
(the new name shows in every product), delete (only while no product uses it). The role's form
(board `ProdRoleDialog`) has a checkbox for each application; it cannot be saved with none.

The applications belong to the role in the catalog and hold in every product. A role that reaches
something else in another product is another role [R-21].

Core will hold products and roles (the company architecture, „Alma - Solutions Architecture.html“); the applications move there with the
roles, and until then nothing but these screens reads them.

**Existing items** when this is deployed: an item whose every price list row is paid once becomes
another item, any other a role with the application Web, to be corrected by hand.

---

## 9. A product at a customer

An organization or one of its prevádzky **has** a product (board `EstProductDialog`, the Produkty
cards of `EstOrgDetail` and `EstDetail`):

```
organization_products       (today's link, extended) [R-10]
  id, organization_id       the organization or the prevádzka that has it
  product_id
  valid_from, valid_to      valid_to NULL = ongoing; ending is setting valid_to, never deleting
  pricing                   'list' (the product's price list) | 'discount' | 'fixed'
  discount_steps            with 'discount': [{ percent, months }], one after another from
                            valid_from, then the list price; months NULL = permanent [R-19]
  fixed_price, fixed_price_gross   with 'fixed': the monthly (or yearly) price, without and with VAT
  note
organization_product_counts how many of each item it has
  organization_product_id, item_id, count
organization_product_workloads   for an item counted by workloads: the people and their workload
  organization_product_id, item_id, persons, percent   („3 × 33 %“)
```

- **Rozsah a príplatky** (the counts): one count per item of the product's price list. It starts
  at the number in the package (`included`) and **cannot go below it**; each piece above it is a
  surcharge, shown per piece (as the product's price list sets it, not changeable here) and in
  total („+2 × 9,84 € = +19,68 €“). It cannot exceed the maximum; one-off items count once.
- **Workloads** [R-14]: for any role switched to „podľa úväzkov“ on the product (Sestra, or others),
  the count is not set by hand: the button „Úväzky“ opens a modal of its own for that item, so many
  such items stay readable. The customer's workloads are listed („2 × 100 %, 3 × 33 %, 1 × 15 %“); each is
  rounded **up** to the product's step (with 50 %: 33 % and 15 % count as 50 %, 51 % as 100 %); the
  sum gives the count (400 % = 4 sestry, covered by a package of 4), a sum that is not whole is
  rounded up to the next one (450 % = 5) [R-15]. The package floor and the surcharge then apply as
  above.
- **Price** [R-7, R-11]: by default it follows the product's current price list, so a price change
  reaches every customer on it (and shows in their history of changes); a **discount** in % keeps
  following it, either **permanent** or in **steps**, each for a number of months (100 % for 3
  months, then 50 % for 9; then the list price applies) [R-19]; a **fixed price** is agreed with the customer and stays until changed.
- A product is held at most once at a time per organization or prevádzka.
- **Prideliť produkt** (dialog): for whom (the organization or one of its prevádzky), the product
  (a searchable list, by name and description, with the starting price; products no longer offered
  shown but not pickable, as there may be dozens),
  the counts with steppers („1 v cene, max. 3, +12,30 €“), from (and until), the price mode, and the
  result monthly, yearly and one-off, with and without VAT.

### 9.1 On the organization's and the prevádzka's detail

- The **Produkty** card (under the Prevádzky table, establishments.md 4.4) is a table: product
  (with whose prevádzka it is), the counts one item per line („2 × Admin prístup“, „10 × Sestra“),
  **Platnosť** (from, and until under it when set), the monthly and the yearly price; the
  organization's own rows first, then „Produkty prevádzok“; a total row. Each row's „…“: Upraviť,
  Ukončiť.
- Prices show with or without VAT as the organization's **„Ceny produktov“** says: a setting in
  the organization's form (Základné údaje), with VAT by default, valid for the organization and
  all its prevádzky; the card shows it as a label, not a switch. A private person's prices are
  always with VAT [R-17].
- **In the organization's form** (Upraviť organizáciu, Upraviť fyzickú osobu), Zaradenie lists
  the customer's own products in the same table with „Prideliť produkt“; adding, editing and
  ending use the same dialog as the detail and are saved at once. A new organization has no
  products in its form: they are assigned after it is saved [R-18]. The old product chips and
  „Nový produkt“ in the form are gone; products are made in the catalog.
- The prevádzka's detail shows the same card with its own rows only.
- The header's product chips are the products held by the organization or any of its prevádzky.
- **„Sestry: 18“** in the header is computed: the sum of the counts of the item „Sestra“ over the
  organization and its prevádzky, nothing to type [R-12].
- The lists' product filter finds an organization when it or one of its prevádzky holds the product
  now.

## 10. Migration of today's data

1. Each code-list product (ADOS, DOS, Stacionár) becomes a product with the same id and name, no
   price („cena nezadaná“) and an empty price list.
2. Customers' ticked products become held products from the day of the migration, priced by the
   list, with the included counts.
3. The catalog starts empty; the user fills it while setting up the first price list.
4. Settings › Číselníky drops „Produkty“; the products' names are edited on Produkty.

## 11. Decisions

| Id | Decision | State |
| --- | -------- | ----- |
| R-1 | Products are today's code list extended (same ids), not a new list beside it. | agreed |
| R-2 | Item names live in one shared catalog; a product's price list points to them. | agreed |
| R-3 | Per product and item: included count, price of each further one, maximum, recurring or once. | agreed |
| R-4 | Price = base + further items × their price, in EUR; a product has a period, monthly or yearly. | agreed |
| R-9 | Prices are shown and entered with and without VAT; the other is computed and rounded to cents; the VAT rate is a setting; a rate change keeps the prices without VAT. | agreed |
| R-5 | „Produkty“ is a sidebar item under „Organizácie“, with tabs Produkty, Role and Ďalšie položky (R-20). | agreed |
| R-6 | The product's detail has a price calculator that stores nothing. | agreed |
| R-7 | A held product follows the current price list (a change reaches its customers, in their history); a discount in % follows it too; a fixed price stays. | agreed |
| R-10 | A product is held by an organization or a prevádzka, with counts per item and dates; ended, not deleted. | agreed |
| R-11 | Price modes at a customer: by the list, a discount in %, or a fixed agreed price. | agreed |
| R-13 | The count of an item starts at the package and cannot go below it; the surcharge per piece is the price list's, not changed per customer. | agreed |
| R-14 | An item of a product can be counted from workloads; each workload rounds up to the product's step; the sum gives the count. | agreed |
| R-15 | A sum of workloads that is not whole is rounded up to the next whole count. | agreed |
| R-12 | „Sestry“ in the header is the sum of the „Sestra“ counts over the organization and its prevádzky. | agreed |
| R-8 | Adding an item offers the numbers from the product it was last used in. | agreed |
| R-16 | A price is entered with VAT, the price without VAT is worked out (and the other way); without VAT is shown first. | agreed |
| R-17 | „Ceny produktov“ (with / without VAT) is set on the organization and holds for its prevádzky; a private person's prices are always with VAT. | agreed |
| R-18 | The organization's form lists and assigns its products through the same dialog; a new organization gets them after it is saved. | agreed |
| R-20 | The catalog has two kinds: roles and further items, each on a tab of its own; the kind does not change. | agreed |
| R-21 | A role reaches one or more of Mobil, Web and Backend; at least one. Set on the role in the catalog, valid in every product. | agreed |
| R-22 | A product's Cenník shows roles and further items as two parts apart to the eye, ordered within each. | agreed |
| R-23 | Only a role can be counted from workloads. | agreed |
| R-19 | A time-limited discount can have several steps, each its percent for so many months, one after another; then the list price. A permanent discount has one percent. | agreed |

## 12. Stages (after approval)

| Stage | What |
| ----- | ---- |
| R1 | Data: products extended, `product_items`, `product_price_items`, the VAT rate setting; API with the price function; tests |
| R2 | Web: sidebar item, Produkty list, Položky tab |
| R3 | Web: product detail with the price list, the item dialog, the calculator, duplicate |
| R4 | Code list removed from Nastavenia, `functional-spec.md` |
| R5 | The product at a customer (section 9): data, the dialog, the Produkty cards, the header, the filter |
