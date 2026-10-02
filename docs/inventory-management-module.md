# Inventory Management Module

Deliverable for the inventory milestone. Covers categorized inventory items,
per-restaurant unit-of-measure handling, purchase recording, stock adjustments,
wastage and consumption tracking, a full ledger of movements, RBAC, tenant
isolation, tests, and an end-to-end browser verification.

## 1. Scope

Implemented (this milestone):

- **Inventory items**: create/edit/deactivate/reactivate items with a category
  (created inline), display unit, reorder level, latest purchase cost, SKU and
  description. SKUs are unique per restaurant.
- **Categories**: create/edit and categorize items; unused categories can be
  deleted or reactivated.
- **Purchases**: record a multi-line purchase (supplier, invoice number, date,
  notes) that posts `PURCHASE` movements, adds stock and refreshes the item's
  cost price to the latest purchase rate. Sequential per-restaurant numbers
  `PUR-0001` with a configurable prefix (`RestaurantSettings.purchasePrefix`).
- **Stock operations**: adjustment (add/remove with reason), wastage (reason),
  and consumption (reason) — each writes a ledger movement and records an audit
  entry.
- **Ledger / history**: every movement is stored in `stock_movements` with
  before/after balances (in the item's base unit), item name snapshot, reason,
  operator and optional reference (purchase id). Items list low-stock /
  out-of-stock pills; a detail dialog shows the movement trail; a movements
  page filters by type, item and date range.
- **Inventory reports summary**: total items / categories, out-of-stock and
  low-stock counts, and total stock value (sum of `currentStock ×
  costPricePaise` across active items).
- **Atomic, transaction-less integrity**: stock balances change via atomic
  conditional `$inc` (never a read-modify-write) so concurrent movements cannot
  lose updates and stock can never go negative. Purchases are double-submit
  safe via idempotency keys. No multi-document transactions — the local MongoDB
  does not support them.
- **RBAC**: OWNER/MANAGER/CASHIER can view and read stock; OWNER/MANAGER can
  create/edit items, categories and purchases and move stock. WAITER is denied
  on all three pages and redirected to `/dashboard`.
- **Navigation**: app header gains **Inventory**; a sub-nav on the inventory
  pages links Items / Purchases / Movements (previously only reachable by
  URL).

Not implemented (future): auto-deduction of stock from POS/KOT sales, bill
items ↔ inventory consumption, supplier master / purchase returns, expiry
batches/FIFO, reorder automation, per-location warehouses.

## 2. Files

Server layer:

| File | Purpose |
| --- | --- |
| `src/lib/inventory/constants.ts` | Units (`KG,G,L,ML,PCS,DOZEN,PACK,BOX`), base units (`G,ML,PCS,PACK,BOX`), stock statuses, movement types (`PURCHASE,ADJUSTMENT_IN/OUT,WASTAGE,CONSUMPTION`), reference types, reason lists (`ADJUSTMENT/WASTAGE/CONSUMPTION_REASONS`), field length caps, page sizes (`20`), purchase numbering (`PUR`, pad `4`), RBAC role sets |
| `src/lib/inventory/types.ts` | `InventoryItemView`, `CategoryView`, `PurchaseRowView`/`PurchaseDetailView`/`PurchaseLineView`, `StockMovementView`, `Paged<T>` |
| `src/lib/inventory/errors.ts` | `InventoryItemNotFoundError`, `InventoryCategoryNotFoundError`, `CategoryNameTakenError`, `InsufficientStockError`, `IncompatibleUnitError`, `PurchaseNotFoundError`, `PurchaseValidationError`, `InventoryValidationError` |
| `src/lib/inventory/validation.ts` | Zod schemas (category create/update, item create/update, activation, purchase, stock adjustment/wastage/consumption) |
| `src/lib/inventory/units.ts` | Pure conversion engine: `toBaseQuantity`, `baseQuantityToView`, `ratePerBasePaise`, `isUnitCompatibleWithBase`, `formatQuantity`, `formatStockQuantity` |
| `src/lib/inventory/permissions.ts` | `canReadInventory` / `canManageInventory` + asserts |
| `src/lib/inventory/query.ts` | Query normalization (pagination, filters, date ranges) shared by items/purchases/movements |
| `src/lib/inventory/utils.ts` | `containsCaseInsensitiveRegex`, `dateRangeFilter`, `toIso`, safe-min/max helpers |
| `src/lib/inventory/inventory-service.ts` | `createInventoryItem`, `updateInventoryItem`, `setInventoryItemActive`, `deleteInventoryCategory`, `listInventoryItems` (with `categoryName`), `listInventoryCategories` (with `itemCount`), `getInventoryItemView`, `summarizeInventory` (report card), + audit |
| `src/lib/inventory/stock-service.ts` | `applyStockChange` (atomic guarded `$inc` + ledger write), `adjustStock`, `recordWastage`, `recordConsumption`, `listStockMovements`, `listItemMovements` |
| `src/lib/inventory/purchase-service.ts` | `createPurchase` (idempotency-guarded, numbered, stock-posted, cost-refreshed), `listPurchases`, `getPurchaseById`, `formatPurchaseNumber` |
| `src/actions/inventory/_shared.ts` | `InventoryActionResult` + `wrapInventoryAction` |
| `src/actions/inventory/actions.ts` | 13 server actions (list/search, item create/update/activate, category create/update/delete, createPurchase, adjustStock, recordWastage, recordConsumption, summary) — each with `requireAuth` + `requireRestaurant` + permission asserts |
| `src/models/InventoryItem.ts` | Item schema; stock/cost stored in base unit; unique partial index `{restaurantId, sku}` where `sku` is a string |
| `src/models/InventoryCategory.ts` | Category schema (`name`, `displayOrder`, `isActive`, `createdBy`) + indexes |
| `src/models/Purchase.ts` | Purchase schema: lines with item name snapshot + before/after stock, **unique partial** `{restaurantId, idempotencyKey}`, unique `{restaurantId, purchaseNumber}`, indexes for listing |
| `src/models/StockMovement.ts` | Ledger schema: type/direction, quantity + `baseQuantity`, `beforeStock`/`afterStock`, `ratePaise`, `referenceType`/`referenceId`, reason, `createdBy` + listing indexes |

Supporting changes: `src/models/TableAuditLog.ts` (+`INVENTORY_*`/`STOCK_*`/
`PURCHASE_CREATED` actions, `INVENTORY_ITEM`/`INVENTORY_CATEGORY`/
`STOCK_MOVEMENT`/`PURCHASE` entities), `src/models/RestaurantSettings.ts`
(+`purchasePrefix`), `src/lib/db/index.ts` (new models in `syncIndexesOnce`),
`src/components/app-header.tsx` (+Inventory link) and `src/proxy.ts`
(middleware tenant-route map for `/inventory*`).

Client layer:

| File | Purpose |
| --- | --- |
| `src/components/inventory/inventory-manager.tsx` | Items page shell: toolbar, table, pagination, detail dialog, create/edit form, inherit-new-category, stock/purchase modal wiring |
| `src/components/inventory/item-form.tsx` | Create/edit dialog form (name, category select + inline **New category**, unit, minimum, cost, SKU, description, active) |
| `src/components/inventory/item-picker.tsx` | Searchable picker of active items (used by purchase/adjust/wastage/consumption modals) |
| `src/components/inventory/stock-modal.tsx` | Reusable add/remove modal for adjust/wastage/consumption (quantity in item's unit, reason select + note) |
| `src/components/inventory/purchase-form.tsx` | Multi-line purchase form (supplier, invoice, date, note, per-line item/quantity/rate) with cost + quantity calcs |
| `src/components/inventory/purchases-view.tsx` | Purchases page: filters/search, rows (number, date, supplier, invoice, count, total, status), detail dialog |
| `src/components/inventory/movements-view.tsx` | Movements page: type/item/date filters, paginated ledger table |
| `src/components/inventory/item-detail-dialog.tsx` | Item detail + recent movement trail, edit source |
| `src/components/inventory/inventory-summary.tsx` | Report cards (items, categories, out/low stock, total value) |
| `src/components/inventory/inventory-toolbar.tsx`, `status-badge.tsx`, `inventory-pagination.tsx`, `inventory-sub-nav.tsx`, `use-filter-params.ts` | Shared UI |
| `src/app/inventory/page.tsx`, `src/app/inventory/purchases/page.tsx`, `src/app/inventory/movements/page.tsx` | Routes (all guarded + `requireRestaurant`) |

Tests: `src/lib/inventory/units.test.ts` (7), `src/lib/inventory/validation.test.ts`
(11), `src/lib/inventory/permissions.test.ts` (3), `tests/inventory.e2e.test.ts`
(11 scenarios + audit/isolation against a real MongoDB).

## 3. Conventions (how stock is modelled)

- **Base units**: an item stores `unit` (what the user sees and enters) and
  `baseUnit` (the canonical unit stock is persisted in). Converters map the
  display unit to base: KG→G, L→ML, DOZEN→PCS. PACK and BOX are each their own
  base unit — they are **not** inter-convertible. Incompatible units (e.g. KG
  ↔ ML, PACK ↔ BOX) throw `IncompatibleUnitError`.
- **Integers only**: `currentStock`, `minimumStock`, `beforeStock`,
  `afterStock` and `baseQuantity` are integers in the base unit (entered KG
  becomes G at write time) — avoids floating point drift. `formatQuantity` /
  `formatStockQuantity` render back to the display unit (`toBaseQuantity` and
  `baseQuantityToView` round-trip).
- **Cost in integer paise per base unit**: `costPricePaise` is the cost of
  one base unit (₹280/KG → 28 paise per G). `ratePerBasePaise(ratePerUnit)`
  converts a per-display-unit rate at write time. Stock value is computed as
  `Σ currentStock × costPricePaise`, so it stays exact.
- **Status is derived, never stored**: `IN_STOCK` (stock ≥ min), `LOW_STOCK`
  (0 < stock < min), `OUT_OF_STOCK` (stock = 0).
- **Money is integer paise** throughout (`rupeesToPaise`, `formatPaise`).

## 4. Business rules

- **Items**: name required (≤120), unit required, base unit derived; category,
  SKU, description, minimum (default 0) and initial cost (default 0) optional.
  Editing picks up the existing base unit — the unit can only match the item's
  base family. Deactivation hides the item from stock operations but keeps
  history. SKU uniqueness enforced per restaurant (unique partial index).
- **Categories**: names unique per restaurant (case-insensitive
  `$nin`/partial-index guard). Deleting a category clears `categoryId` on its
  items (they become un-categorized) and the category becomes inactive
  (removable); reactivation restores it.
- **Purchases**:
  - At least one line; each line validates item belongs to the restaurant, is
    active, its unit is compatible, quantity > 0, and computes
    `ratePaise = rupeesToPaise(purchaseRateRupees)`, `totalAmountPaise =
    round(quantity × ratePaise)`.
  - Number allocation is retried (≤5) on the unique `{restaurantId,
    purchaseNumber}` index. `idempotencyKey` (a `crypto.randomUUID()` sent by
    the client per attempt) makes double-submit return the already-created
    purchase instead of posting stock twice (unique partial index + E11000
    recovery).
  - Each line posts one `PURCHASE` movement via `applyStockChange` with
    `updateCostPrice: true`, which atomically adds stock and refreshes
    `costPricePaise` to that line's rate per base unit. The purchase document
    is then re-read and enriched with each line's before/after stock.
  - `PUR-0001` … with a configurable alphanumeric prefix
    (`RestaurantSettings.purchasePrefix`, default `PUR`).
- **Stock operations** (adjust ADD/REMOVE, wastage, consumption): reason is
  required (curated lists, free text allowed). Every operation first verifies
  compatibility, then runs the guarded atomic update:
  - IN types (`PURCHASE`, `ADJUSTMENT_IN`): `findOneAndUpdate { _id,
    restaurantId, isActive: true }` with `$inc { currentStock: baseQuantity }`
    (plus `$set costPricePaise` when the purchase asks).
  - OUT types: the filter additionally requires `currentStock ≥ baseQuantity`;
    a miss throws `InsufficientStockError("Insufficient stock. Available: X
    kg.")` — a concurrent oversell simply matches nothing and is rejected.
  - The ledger movement records `direction`, `beforeStock`/`afterStock`,
    `itemNameSnapshot`, `ratePaise` (for purchases/wastage), `referenceType`/
    `referenceId` and the operator.
- **Audit**: item create/update/activate, category create/update, purchases and
  each stock operation write a tenant-scoped `TableAuditLogModel` entry
  (fail-soft), reusing `recordAudit`.
- **Views**: item rows are enriched with `categoryName` and quantity/value
  labels; the movements list resolves operator names; purchase rows/detail
  resolve creator names and line labels.

## 5. RBAC

| Role | View items/purchases/movements | Create/edit items & categories | Purchases & stock operations |
| --- | --- | --- | --- |
| OWNER | yes | yes | yes |
| MANAGER | yes | yes | yes |
| CASHIER | yes | no | no |
| WAITER | **no** (redirected to `/dashboard`) | no | no |

Every write server action asserts the role before touching the DB; UI control
hiding (`inventory-manager` renders manage buttons only for managers) is
ergonomics only.

## 6. Duplicate-prevention strategy

1. Atomic guarded `$inc` for every stock movement — exactly one update can
   commit; losers fail the stock/availability filter.
2. Purchase idempotency: client sends `crypto.randomUUID()` per attempt
   (`purchase-form` regenerates it after a success); the unique partial index
   `{restaurantId, idempotencyKey}` guarantees one purchase per attempt even
   under `Promise.all` double-clicks. The loser reconciles and returns the
   winning purchase.
3. Purchase numbers unique per restaurant with a bounded E11000 retry loop.
4. Client buttons disable while busy; server guards remain the source of
   truth (verified in `tests/inventory.e2e.test.ts` TEST 8 + the concurrent
   wastage race test).

## 7. Tenant isolation

Every item/category/purchase/movement query and update scopes by
`restaurantId`; numbers and sequences are per restaurant; a foreign restaurant
can have its own `PUR-0001`. Cross-tenant writes throw the appropriate
not-found/validation error. Verified by E2E.

## 8. Tests & verification

Automated (32 inventory tests; 304 suite-wide, all passing — `npm run lint`,
`npx tsc --noEmit`, `npm test`, `npm run build` all clean):

- `units.test.ts` (7): base-unit mapping, KG↔G/L↔ML/DOZEN↔PCS conversions,
  PACK/BOX are distinct (PACK→BOX rejected as incompatible), format /
  round-trip helpers.
- `validation.test.ts` (11): item, category, purchase, movement schemas —
  malformed ids, empty names, negative/min quantities, reason required,
  optional fields coerce to `null`, pagination defaults.
- `permissions.test.ts` (3): read/manage matrix.
- `tests/inventory.e2e.test.ts` (11, real MongoDB): create → `OUT_OF_STOCK`
  reported; purchase 10 KG → stock/`IN_STOCK`/movement + cost updated;
  wastage 1 KG → 9 KG + `WASTAGE`; adjustment OUT 2 KG → 7 KG +
  `ADJUSTMENT_OUT: Physical Count` (movements total 3); over-removal rejected
  with the availability message; LOW/OUT derived from balances; double submit
  records exactly one purchase; renaming keeps historical snapshots;
  sub-unit purchases + incompatible-unit rejection; atomic no-oversell under
  concurrent wastage; restaurant isolation.

Manual/browser verification (headless Chrome + Playwright against the dev
server, demo restaurant — pattern lives in the module check script used during
development): owner → item created inline with its category, purchase 10 kg of
Paneer (₹280/kg → ₹2,800, PUR number + supplier/invoice shown), wastage 1 kg →
9 kg, removal 2 kg → 7 kg with value ₹1,960, over-removal blocked, detail shows
the `0→10 → 9 → 7` trail, purchases page totals and movements page list the 3
events; cashier sees rows but no manage buttons; waiter is redirected to
`/dashboard` on both inventory and purchases pages.

### Fixes found during verification

- **Hydrated-doc `_id` loss (TEST 8)**: after enriching purchase lines the
  service used to `create` then spread the hydrated Mongoose document, which
  drops `_id` — `purchase.id` came back `undefined`. The service now `updateOne`
  the lines and re-reads a lean document so the returned view carries the real
  id.
- **PACK/BOX conversion**: `conversionFactor("PACK", "BOX")` returned `1`
  (same `PACKAGE` family). The converter now returns `null` for same-family
  but different units so a PACK cannot be recorded against a BOX item.
- **Optional-field typing (tsc)**: `optionalText`/`optionalObjectId` used to
  make their fields effectively required (`.optional()` applied before
  `.transform()`). Now the transforms run first and `.optional()` last, so
  schema outputs type as `T | null | undefined`; item SKU passes `input.sku ??
  null` into the uniqueness check in both create and update.
- **Inline category race (UI)**: submitting the item form immediately after
  creating a brand-new category could beat the category action's state update,
  saving the item uncategorized on the first category ever created. The form
  now owns a `categoryCreateRef` promise it awaits inside `handleSubmit`
  (body disables while pending).
- **First-category display in the category select**: base-ui's `Select`
  renders the raw value text until the popup with the matching item has been
  mounted, so a just-created category showed its ObjectId in the trigger. Fix:
  base-ui's `items` prop pre-registers `{value, label}` so the trigger shows
  the category name from the first render.

## 9. Known limitations / next module

- **Item balance is a ledger cache**: `currentStock` is derived truth and is
  kept correct by the atomic writes, but if a movement document were ever
  edited/removed by hand or a future module inserted stock outside these
  services, the balance and ledger could disagree (no transactions to pair
  them).
- **No POS/KOT → inventory deduction** yet (by design for this milestone).
- No supplier master, purchase returns/credit notes, or expiry/batch(FIFO).
- `purchasePrefix` (and the bill/KOT prefixes) are edited on `/settings`.
- PACK/BOX list as separate base units even when a supplier delivers
  interchangeable packs.