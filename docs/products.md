# Produkty: products, their items and prices (draft)

Status: **agreed** sections 1–8 (2026-10-29); section 9, a product at a customer, **draft for review**. Phase 1 (spec) and phase 2 (screens: the `Prod*` boards on
the canvas page „Produkty · návrh“). How a product is assigned to an organization or a prevádzka and
shown on its detail follows once this is agreed (section 9); it continues
[establishments.md](establishments.md) section 4.4.

Marks: **[R-n]** a decision of this spec (section 11), _proposed_ until the user agrees.

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
  state                     'offered' | 'withdrawn' (no longer offered; kept for customers who have it)
  position, created_*, updated_at, deleted_at

product_items               the shared catalog of item names [R-2]
  id, name (unique), unit   „Admin prístup“ / unit „prístup“; „Sestra“ / „sestra“
  description, created_*, deleted_at

product_price_items         one product's price list [R-3]
  product_id, item_id       (one item once per product)
  included                  how many are in the base price (0 = none)
  unit_price, unit_price_gross   each further one, EUR without and with VAT; NULL = none may be
                            added beyond `included`
  max                       the most a customer may have (NULL = no limit)
  billing                   'recurring' (every period of the product) | 'once'
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
| **Položky** | the shared catalog of item names |

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

- **Základné údaje**: name, description, base price, period (Mesačne / Ročne), state.
- **Cenník** (the price list), a table, rows dragged to order:

  | Položka | Platba | V cene | Cena za ďalšiu | Max. | |
  | ------- | ------ | ------ | -------------- | ---- | - |
  | Admin prístup | opakovane | 1 | 10 € | 3 | odobrať |
  | Sestra | opakovane | 4 | 8 € | 50 | |
  | Superadmin | opakovane | 0 | 25 € | 1 | |
  | Implementácia | jednorazovo | 0 | 450 € | 1 | |

  „Pridať položku“ opens the item picker (section 7).
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

## 8. Položky (catalog tab)

Board `ProdItems`. A table: name, unit, description, the products that use it (chips). Actions:
„Nová položka“, rename (the new name shows in every product), delete (only while no product uses
it).

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
  discount_percent          with 'discount'
  fixed_price, fixed_price_gross   with 'fixed': the monthly (or yearly) price, without and with VAT
  note
organization_product_counts how many of each item it has
  organization_product_id, item_id, count
```

- **Rozsah** (the counts): one count per item of the product's price list; it starts at the
  included number, cannot exceed the maximum; one-off items count once.
- **Price** [R-7, R-11]: by default it follows the product's current price list, so a price change
  reaches every customer on it (and shows in their history of changes); a **discount** in % keeps
  following it; a **fixed price** is agreed with the customer and stays until changed.
- A product is held at most once at a time per organization or prevádzka.
- **Prideliť produkt** (dialog): for whom (the organization or one of its prevádzky), the product,
  the counts with steppers („1 v cene, max. 3, +12,30 €“), from (and until), the price mode, and the
  result monthly, yearly and one-off, with and without VAT.

### 9.1 On the organization's and the prevádzka's detail

- The **Produkty** card (under the Prevádzky table, establishments.md 4.4) is a table: product,
  where (the organization or which prevádzka), the counts in short („2 admin · 10 sestier“), from,
  the monthly and the yearly price; the organization's own rows first, then „Produkty prevádzok“;
  a total row. A switch **S DPH / Bez DPH**, with VAT by default as on Produkty. Each row's „…“:
  Upraviť, Ukončiť.
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
| R-5 | „Produkty“ is a sidebar item under „Organizácie“, with tabs Produkty and Položky. | agreed |
| R-6 | The product's detail has a price calculator that stores nothing. | agreed |
| R-7 | A held product follows the current price list; a discount in % follows it too; a fixed price stays. | proposed |
| R-10 | A product is held by an organization or a prevádzka, with counts per item and dates; ended, not deleted. | proposed |
| R-11 | Price modes at a customer: by the list, a discount in %, or a fixed agreed price. | proposed |
| R-12 | „Sestry“ in the header is the sum of the „Sestra“ counts over the organization and its prevádzky. | proposed |
| R-8 | Adding an item offers the numbers from the product it was last used in. | agreed |

## 12. Stages (after approval)

| Stage | What |
| ----- | ---- |
| R1 | Data: products extended, `product_items`, `product_price_items`, the VAT rate setting; API with the price function; tests |
| R2 | Web: sidebar item, Produkty list, Položky tab |
| R3 | Web: product detail with the price list, the item dialog, the calculator, duplicate |
| R4 | Code list removed from Nastavenia, `functional-spec.md` |
| R5 | The product at a customer (section 9): data, the dialog, the Produkty cards, the header, the filter |
