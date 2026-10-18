# Vendor Bill Ledger — Project Context

## What this is
A static HTML/CSS/JS web app (`app/`, see "File location" below) used to track
daily vendor bills (expenses) across 7 restaurants/locations, log daily sales,
and generate Excel/CSV reports. No build step, no backend server — plain files
that talk directly to Firebase Firestore from the browser.

## Restaurants (hardcoded list, in the `RESTAURANTS` const near the top of the script)
| id | label |
|---|---|
| krishna-nigdi | Krishna Veg (Nigdi) |
| krishna-ravet | Krishna Veg (Ravet) |
| krishna-chikhli | Krishna Veg (Chikhli) |
| savali | Savali |
| malhaar | Malhaar |
| umami-la-delice | Umami La Delice |
| central-kitchen | Central Kitchen (added 2026-08-06) |

Adding a restaurant is just two entries: one in `RESTAURANTS` (core.js) and
one hash in `RESTAURANT_PASSWORD_HASH` (same file, see the Login section
below) — everything else (dropdowns, Vendor Ledger's "All restaurants"
aggregation, the Reports dashboard, per-month Firestore bucketing) is driven
off `RESTAURANTS` with no other hardcoded list anywhere in the app.

A dropdown at the top of the page switches the "active" restaurant; everything
below (ledger, totals, sales) is scoped to whichever restaurant is selected.

## Tech stack / dependencies (all via CDN, no npm/build)
- **SheetJS (xlsx.full.min.js v0.18.5)** — from cdnjs — builds the Excel workbooks.
  Note: this is the free **Community Edition** — it does NOT reliably support
  writing cell background colors/fills (that's a paid "Pro" feature of SheetJS).
  We attempt a yellow Sunday-row highlight in one sheet but it may not render;
  there's a `try/catch` around it so it fails silently rather than breaking export.
- **Firebase JS SDK v10.12.2, compat/namespaced build** (`firebase-app-compat.js`,
  `firebase-firestore-compat.js`) — loaded from `gstatic.com` with an automatic
  fallback to a `cdnjs.cloudflare.com` mirror if the primary fails (added because
  a user hit a `"Firebase is not defined"` error, likely from gstatic.com being
  blocked on their network). See `__loadScriptWithFallback` / `__firebaseSdkReady`
  near the top of the file, and `ensureFirebaseSdkLoaded()` in the script.

## Data persistence — two layers
1. **localStorage** — always used, per-browser cache/fallback. Works offline.
2. **Firebase Firestore** — **hardcoded as of 2026-07-31**, project `vendor-bills`.
   The `FIREBASE_CONFIG` const near the top of the script (right before
   `initFirebase`) holds the literal config (apiKey, authDomain, projectId,
   etc.). `getFirebaseConfig()` just returns this const and `firebaseConfigured()`
   always returns `true` — there is **no UI left to connect to a different
   Firebase project, or to disconnect** (the old "Connect Cloud Storage" modal,
   its paste-a-config-object parser, and the "Disconnect cloud storage" button
   were all removed). Every device that opens the file talks to the same
   Firebase project automatically, no setup step required.
   - Every read/write tries Firestore first, falls back to/also writes
     localStorage, and shows a status bar (`renderFirebaseStatus`) on failure.
   - Firestore collection: **`billTrackerData`**, plain key→`{value: "<json string>"}`
     documents (a simple KV store, not a normalized schema).
   - **Security rules are fully open** (`allow read, write: if true`) — there is
     NO authentication at the Firestore level. This was a deliberate choice:
     "simple, trust everyone with the config string" over "strict per-restaurant
     access control." Anyone with the deployed URL can read/write ALL 6
     restaurants' data via the browser network tab even with the client-side
     Reports-tab password below. If stricter access control is ever wanted,
     that's a bigger lift (Firebase Auth + rules keyed to restaurant/user) —
     explicitly deferred, not built.
   - To rotate/change the Firebase project in the future, edit `FIREBASE_CONFIG`
     directly in the HTML file — there is no in-app UI for it anymore.

## Storage key structure (IMPORTANT — recently changed, see below)
- **Shared across ALL restaurants** (not namespaced):
  - `categories` — JSON object `{ "Category Name": ["Subcategory", ...], ... }`
  - `suppliers` — JSON array of supplier name strings
  - `supplierDefaults` — JSON object `{ "<lowercased supplier name>": { category, subcategory }, ... }`
    (this is what makes the supplier-first entry flow work — pick a supplier,
    its category/subcategory auto-fill)
- **Per-restaurant, per-month bucketed** (this is the current, optimized design):
  - Bills: key = `rest:<restaurantId>:bills:<YYYY-MM>` → JSON object
    `{ "<date YYYY-MM-DD>": [ {id, category, subcategory, supplier, invoice, amount, status, notes, paidAt, createdAt}, ... ], ... }`.
    `paidAt` (added 2026-08-05) is a timestamp set whenever `status` becomes
    `'paid'` (at creation if added already-paid, or via either toggle path
    below) and cleared back to `null` on `'unpaid'` — not a history log, just
    "when did this bill *most recently* become paid." `notes` (added
    2026-08-15) is a free-text string, always optional — `''` when not set,
    never required by the add-bill form or the Modify dialog. Shown in the
    ledger table as a small 📝 icon (`.note-indicator`) next to the invoice
    cell, only rendered when `notes` is truthy, with the full text in a
    `title` tooltip rather than its own always-visible column.
  - Sales: key = `rest:<restaurantId>:sales:<YYYY-MM>` → JSON object
    `{ "<date YYYY-MM-DD>": <number>, ... }`

### Why month-bucketed (not day-bucketed, not one-doc-forever)
We migrated from one-Firestore-document-per-day to one-document-per-month after
a cost/scaling discussion:
- Firestore has **no limit on total document count**, but a **1 MiB max size per
  document**.
- One document per restaurant *forever* would exceed 1 MiB within about a year
  at ~20 entries/day (~1.4 MB/year) — not viable.
- One document per day meant every report (Excel export) had to run a listing
  query PLUS an individual `.get()` per day — reads scaled linearly with total
  history (e.g. ~1,460 reads for one restaurant's one-year report).
- One document per month keeps each doc comfortably small (~100–150 KB/month)
  AND lets reports fetch exactly the 12 known months of a financial year
  directly (no listing query needed for the actual report content — see
  `collectFYBillRows` / `collectFYSalesRows` / `monthsForFY`), cutting reads by
  roughly 30x.
- **The old day-bucketed data was intentionally dropped** (it was only test
  data) — there is no migration path from the old scheme, this was a clean
  cutover by user agreement.
- In-memory read-modify-write caching (`billsMonthCache` /
  `currentBillsMonthCacheKey`, and the sales equivalents) avoids redundant
  Firestore reads when adding multiple bills to the same day/month in one
  session.

## Login: profile (Owner/Manager) + per-restaurant passwords (added 2026-08-05)
Before any tab is reachable, `app/js/auth.js` runs a small client-side login
flow — still the same "soft deterrent, not real security" model as everything
else in this app (see Known limitations), just applied one level earlier than
before.

**Persisted in `localStorage`, not `sessionStorage` (changed 2026-08-28).**
Originally session-scoped, re-prompting on every browser close to match the
Reports-tab password's existing behavior — but since most real usage is on a
phone, that meant re-logging in every time the browser or home-screen app got
backgrounded and reopened, which reads as broken on mobile even though it was
working as designed. Login now persists indefinitely — across closing the
browser/tab, backgrounding, force-closing a home-screen-installed instance,
even reinstalling — until the user explicitly taps **Logout**. The three keys
involved (`profileType`, `unlockedRestaurantId` in core.js;
`reportsUnlockedSession` in reports-dashboard.js) all moved together; Logout
(`switchProfileBtn`'s handler in auth.js) clears all three so it's a
genuinely clean slate, not just profile+restaurant.

Screens (all in `index.html`, siblings before `#appTabsWrap`):
1. **`#profileGate`** — "Who's logging in?" Owner or Manager.
2. **`#ownerLoginGate`** (Owner only) — one password, SHA-256-compared against
   `REPORTS_PASSWORD_HASH` in `core.js` — **the same hash the Reports tab
   already used**, reused deliberately so the owner has one password, not two.
   Success sets `localStorage.profileType = 'owner'` and *also* sets the
   Reports tab's own unlock flag (`reportsUnlockedSession`), so Reports and
   Vendor Ledger open with no further prompt.
3. **`#restaurantGate`** — pick a restaurant, then Continue. **Manager only**
   as of 2026-08-06 — a password field appears and is checked against
   `RESTAURANT_PASSWORD_HASH[restaurantId]` in `core.js` (one hash per
   restaurant — a manager only knows their own restaurant's password, so this
   is a practical boundary between locations even though Firestore itself
   doesn't enforce it). Confirming sets `localStorage.unlockedRestaurantId`
   to that restaurant, which `isRestaurantUnlockedForSession()` (core.js)
   checks on every reload to decide whether to show the gate again — the
   function name kept its old "ForSession" wording even though it's no
   longer session-scoped, since renaming it would touch far more call sites
   than the behavior change warranted.
   **An Owner never sees this screen at all** — `ownerLoginBtn`'s success
   handler calls `showConfirmedRestaurant()` directly, and
   `isRestaurantUnlockedForSession()` short-circuits true for
   `isOwnerProfile()` regardless of which restaurant, so the gate is skipped
   both on login and on every later reload. (Originally the owner *did* click
   through this screen once per session, password-free, as a leftover
   "prevents an accidental restaurant switch" step — changed on explicit
   request since the owner instead gets a restaurant selector directly in the
   Add Expenses toolbar, see below.)
4. Main app — `restaurantConfirmedBar` shows the current restaurant name plus
   **"Logout"** (labeled "Switch profile" until 2026-08-28 — same button/id
   `switchProfileBtn`, relabeled once login became persistent so it reads as
   the deliberate way out rather than an incidental one; clears all three
   login keys, returns to `#profileGate`) for both profiles, and **"Change
   restaurant"** (re-shows the gate) for a **Manager only** — hidden for an
   Owner, since re-showing a gate the owner never goes through wouldn't do
   anything useful. `updateTabVisibilityForProfile()` (auth.js) toggles both
   buttons plus the Add Expenses toolbar's `#expensesRestaurantControl`
   (owner-only) between profiles.

**Add Expenses toolbar restaurant selector (added 2026-08-06,
`#expensesRestaurantSelect`)** — owner-only (same `updateTabVisibilityForProfile()`
toggle), populated by the same `renderRestaurantSelect()` (ledger-ui.js) that
already populates the gate's own `#restaurantSelect`, so both stay in sync.
On change it calls the existing `switchRestaurant(id)` — no new
restaurant-switching logic, just a second entry point into it, matching how
Reports/Vendor Ledger each already have their own independent restaurant
selector. `switchRestaurant()` now also updates `#restaurantConfirmedName`'s
text directly, since this path (unlike the old gate-confirm flow) doesn't
pass back through `showConfirmedRestaurant()` to refresh it.

**Tab visibility by profile** (`updateTabVisibilityForProfile()` in
auth.js): a normal Manager only ever sees "Add Expenses" and "Staff
Expenses" — Reports, Vendor Ledger, and Suppliers buttons are
`display:none`, not just password-gated, so they're not just locked but
not even visible. An Owner sees every tab. (See "Central Kitchen: elevated
Manager profile" below for the one Manager login that also gets the
Owner-level set.)

**"Once the owner logs in, no other passwords are required" applies
app-wide**, not just to the tabs — `billWithinModifyWindow()` (core.js) and
`salesWithinModifyWindow()` (ledger-ui.js) both short-circuit true for an
owner session, so the Modify-bill and sales-edit admin-password prompts
(see "Modify a bill" below) never appear for an owner, even on data older
than the 1-hour window. A Manager still sees those prompts normally — that's
a per-action escalation (type the owner password to override just this one
edit), a separate concept from the profile login itself, deliberately left
as-is.

## Cross-verification flags (added 2026-10-06)
An explicit "this entry has been checked" mark, separate from paid/unpaid.
Owner and Central Kitchen toggle it; everyone else sees a read-only badge.

- **Bills**: `verified`, `verifiedBy`, `verifiedAt` live on the bill record
  itself (same `rest:<id>:bills:<YYYY-MM>` doc as paid/unpaid), toggled by
  `toggleBillVerifiedByLocation()` (data-store.js). Shown in the Add Expenses
  ledger and in Vendor Ledger's expanded bill rows, so Central Kitchen can
  verify other restaurants' bills from there.
- **Sales**: kept in its own key, `rest:<id>:salesVerified:<YYYY-MM>`
  (`{date: {by, at}}`), not on the sales number itself, so every existing
  reader of the sales bucket is untouched. Owner-only, since Central Kitchen
  never sees sales. Shown only once a sales figure exists for the day.
- **Staff entries**: `verified` fields on the OT-month entry, toggled by
  `toggleOTVerified()`, rendered as a column in each of the four lists.

Decisions made via questions before building: Central Kitchen stays blind to
sales (so only Owner verifies sales); a click toggles, so mistakes can be
reversed; editing a verified entry does **not** clear its verified status;
Managers see a read-only badge.

**Permissions are re-checked at click time**, not just at render time
(`buildVerifyControl(verified, canFn, onToggle)` in core.js). The same page
can switch profile without a reload (Logout, then a new login), so a control
built under one profile must never act under another. The Add Expenses table,
sales control, and Vendor Ledger detail are re-rendered from
`updateTabVisibilityForProfile()` whenever the profile changes, which caught a
real gap: a Manager logging in on the same page kept the Owner's live buttons
until the next data change.

## Central Kitchen: elevated Manager profile (added 2026-10-03)
A specific real-world need — the Central Kitchen location needed broad
visibility (Owner-level) but not the right to alter financial records, and
shouldn't see sales — led to a third tier between Owner and Manager,
implemented as a **special case of the Manager login**, not a new
`profileType` value. Detection is purely "is this a non-owner session whose
`unlockedRestaurantId` is `central-kitchen`" (`isCentralKitchenProfile()`,
core.js) — robust across restaurant-selector changes within Reports/Staff
(which don't touch `unlockedRestaurantId`), and automatically inert on
tenants without that restaurant (e.g. RK Twelve21), so no tenant-config
guard was needed.

**Three new core.js helpers, each named for exactly what they gate** (kept
separate rather than one catch-all flag, since each maps to a distinct,
independently-requested right):
- `hasElevatedAccess()` = `isOwnerProfile() || isCentralKitchenProfile()` —
  cross-restaurant visibility into Reports/Vendor Ledger/Suppliers/Staff
  Expenses.
- `canSeeSalesData()` = `!isCentralKitchenProfile()` — gates the Sales input
  in Add Expenses, the ledger strip's Sales figure, and Reports' Sales/
  Profit/Profit % (Profit is hidden alongside Sales, not just Sales itself,
  since Expenses + Profit would let Sales be back-calculated).
- `canEditExistingRecords()` = `!isCentralKitchenProfile()` — gates the
  Modify-bill button (ledger-ui.js's `renderTable()`, plus a defense-in-depth
  check in the click handler in reports-dashboard.js) and the Suppliers
  tab/modal's Edit button (suppliers-ui.js's `buildManageSupplierRow()`,
  shared by both surfaces). Both are "can't change an EXISTING record,"
  whether that's a bill's amount or a supplier's category default
  (retroactively re-tags every past bill) — one flag covers both since
  they're the same restriction for this profile. Adding new bills, new
  suppliers, and all Staff Expenses entry (including editing existing staff
  records) were explicitly requested as unrestricted, so none of those check
  this flag. Paid/unpaid toggling and Delete (bills and suppliers) were also
  left unrestricted — not explicitly asked to be locked, so left as-is per
  this project's "only restrict what's actually named" convention.

**Where each gate actually plugs in:**
- `updateTabVisibilityForProfile()` (auth.js): Reports/Ledger/Suppliers tab
  buttons and the Staff tab's restaurant selector now check `hasElevatedAccess()`
  instead of `isOwnerProfile()`; `expensesRestaurantControl` (Add Expenses'
  owner-only in-toolbar selector) and `restaurantChangeBtn` stay keyed to
  `owner` only, deliberately — Central Kitchen's own bill-entry stays scoped
  to Central Kitchen specifically, same restaurant-gate boundary as any other
  Manager; only Reports/Ledger/Suppliers/Staff go cross-restaurant. Also
  toggles `salesInlineSection`/`ledSalesCell` per `canSeeSalesData()`.
  **Had to add a second call to this function** inside `restaurantConfirmBtn`'s
  click handler (it previously only ran once, from `profileChooseManager`'s
  handler, before any restaurant — and therefore elevation — was known) —
  caught immediately by testing the real login click-through rather than the
  evaluate()-based profile bypass used elsewhere in this test suite; the
  bypass pattern would have masked this bug since it sets state directly
  rather than going through the actual handlers.
- `reportsUnlocked()` (reports-dashboard.js, shared by Reports and Vendor
  Ledger): short-circuits true for `isCentralKitchenProfile()`, since this
  profile never learns the Owner's Reports password. Checked dynamically
  rather than setting the unlock flag at login time, so it's correct even
  for a session that was already logged in before this feature shipped.
- `getStaffActiveRestaurantId()`/`showStaffTabPanel()`/`staffCanEditDaily()`
  (staff-tab.js): all switched from `isOwnerProfile()` to `hasElevatedAccess()`
  so Central Kitchen gets the Staff tab's cross-restaurant selector and is
  never locked out by another list's submit/lock, exactly like Owner.
- `renderDashboard()`/`buildDashCompareCol()` (reports-dashboard.js): hide
  the Sales/Profit/Profit % hero cards, the bar/pie chart (which plots
  sales-vs-expenses per restaurant) and its type-toggle buttons, and the
  "no sales yet" empty state, all behind `canSeeSalesData()` — the
  expense-only category breakdown table (and compare-view's Expenses stat)
  stay visible regardless, since that data doesn't involve sales at all.
  Rewriting the chart itself into an expenses-only visualization was
  considered and rejected as unnecessary engineering risk for a dashboard
  this data-dense; hiding it outright was the safer, explicitly-correct
  reading of "strip sales everywhere."

**Clarified via questions before building** (per the collaboration-style
convention — several genuinely ambiguous, consequential calls in one
request): cross-restaurant scope (yes, full Owner-level, not just Central
Kitchen's own data), exactly what "don't modify numbers" covers (bill
amounts + supplier categories, not Staff Expenses entry which was a
separate explicit grant), how far "no sales" goes (Reports too, not just
the Add Expenses field), and whether new-bill-entry stays available (yes).

**Password**: changed the same day, from the earlier opaque default to
`central@6699` (SHA-256 hash in `app/tenants/pingara.js`'s
`TENANT_RESTAURANT_PASSWORD_HASH`) — same soft-deterrent model as every
other restaurant password, computed with Node's `crypto` module and
verified via a real login click-through in the test suite, not just a
hash-string comparison.

Verified with a dedicated Playwright test (`test_central_kitchen_profile.js`,
35/35, via the real login UI — profile choice, restaurant-gate dropdown,
actual new password — not the `setUnlockedRestaurantId()` evaluate()
shortcut used elsewhere, specifically because that shortcut would have
hidden the `updateTabVisibilityForProfile()` timing bug above): every tab
visible, sales hidden in both Add Expenses and Reports (single + compare
views), Modify hidden but toggle/add/delete all still work, Suppliers
Edit hidden but add/remove work, Vendor Ledger/Reports fully functional
cross-restaurant with no password prompt, Staff Expenses usable for a
restaurant other than Central Kitchen itself. A second test
(`test_other_profiles_unaffected.js`, 15/15) confirmed real Owner and a
normal (non-Central-Kitchen) Manager session are both completely
unchanged, plus the full pre-existing staff/supplier suite re-run clean.

**Note**: the sales-hiding behavior above (`canSeeSalesData()`) was later
explicitly reversed — a follow-up request gave Central Kitchen full
Owner-level access including sales and Add Expenses verify controls (see
the Verify/Cross-verification section). `updateTabVisibilityForProfile()`
now unconditionally shows `salesInlineSection`/`ledSalesCell` for every
profile; `canSeeSalesData()` no longer exists in the code. Left this
section's original wording above as a historical record of the feature's
first shape rather than rewriting it, since the "why" (what was asked,
in what order) still matters more than keeping every paragraph in sync
with the latest state — current gating logic is always the code itself.

### Generalized to a second elevated profile: Accountant (added 2026-10-19)
A second real person (the owner's accountant) needed the exact same rights
as Central Kitchen — asked for explicitly as "same access as that for
central kitchen." Rather than hardcoding a second raw id check everywhere
`isCentralKitchenProfile()` was called, core.js now has:
```js
const ACCOUNTANT_RESTAURANT_ID = "accountant";
function isAccountantProfile(){
  return !isOwnerProfile() && getUnlockedRestaurantId() === ACCOUNTANT_RESTAURANT_ID;
}
const ELEVATED_NON_OWNER_RESTAURANT_IDS = [CENTRAL_KITCHEN_RESTAURANT_ID, ACCOUNTANT_RESTAURANT_ID];
function isElevatedNonOwnerProfile(){
  return !isOwnerProfile() && ELEVATED_NON_OWNER_RESTAURANT_IDS.includes(getUnlockedRestaurantId());
}
```
`hasElevatedAccess()`, `canEditExistingRecords()`, and `reportsUnlocked()`
(reports-dashboard.js) were switched from `isCentralKitchenProfile()` to
`isElevatedNonOwnerProfile()` — the only three call sites that actually
needed to generalize, since every OTHER gate in the app is already built
on top of `hasElevatedAccess()`/`canEditExistingRecords()`, not the raw id
(confirmed by grepping for every reference to `isCentralKitchenProfile`/
`"central-kitchen"` before making the change). `isCentralKitchenProfile()`
itself was deliberately left unchanged and still means exactly "logged in
as Central Kitchen specifically" — still used by `currentVerifierLabel()`,
which now branches per-profile (`'owner'` / `'central-kitchen'` /
`'accountant'`) instead of assuming any non-owner elevated session must be
Central Kitchen, so a bill/sales-day verified by the Accountant is
correctly attributed, not mislabeled.

Implemented as the same "restaurant-gate login vehicle" trick Central
Kitchen itself uses — a new `{ id: "accountant", label: "Accountant" }`
entry in `TENANT_RESTAURANTS` (Pingara tenant only, same as Central
Kitchen; inert on RK Twelve21) plus its own `TENANT_RESTAURANT_PASSWORD_HASH`
entry, own password, own login — not a shared Central Kitchen login,
specifically so `verifiedBy`/any future activity trail can tell the two
people apart. Because it's a `TENANT_RESTAURANTS` entry, it automatically
appears in every restaurant selector in the app (login dropdown, Add
Expenses toolbar, the shared Owner/elevated-profile top-bar selector) with
zero extra wiring — same as Central Kitchen, confirmed by reading how
`renderRestaurantSelect()`/`renderSharedRestaurantBar()` (ledger-ui.js)
work before making the change, not assumed. No restaurant-specific data is
expected to ever exist under `rest:accountant:*` in practice (the
Accountant has no reason to pick itself in the shared selector when
adding a bill, since it's a login identity, not an operational kitchen
like Central Kitchen) — nothing in the code prevents it, this is just
expected usage, not an enforced restriction.

Verified with a new test (`test_accountant_profile.js`, 21/21, via the
real login UI with the actual password, not a bypass): "Accountant"
appears in the restaurant-gate dropdown, wrong password is rejected,
correct password grants every elevated tab/selector, `canEditExistingRecords()`
is false, Reports/Vendor Ledger auto-unlock with no separate password,
Suppliers' bulk-edit/combine-duplicates tools are hidden (same boundary
as Central Kitchen), `currentVerifierLabel()` correctly returns
`'accountant'` not `'central-kitchen'`, sales are visible, and logging
back in as Central Kitchen afterward still resolves as
`isCentralKitchenProfile()` (not `isAccountantProfile()`) with its own
correct verifier label — confirming the two profiles are genuinely
independent, not aliases of each other. Full existing suite re-run clean
— one pre-existing test (`test_shared_restaurant.js`) had a hardcoded
restaurant-selector option count (8) that needed updating to 9 to account
for the new entry, not a real regression.

## Mobile: PWA install + phone-width layout (added 2026-08-28)
Prompted by "this is mostly used on mobile" — two separate pieces:

**Installable as a mobile app.** `app/manifest.json` + `app/icon-192.png`/
`icon-512.png` are per-tenant files, following the exact same pattern as
`app/tenant.js`: the source of truth lives in `app/tenants/<tenant>-manifest.json`
and `app/tenants/<tenant>-icon-{192,512}.png`, and `deploy.sh` copies the
active tenant's copies over the fixed `app/manifest.json`/`icon-*.png`
filenames before deploying — so `git status` can show these three as
"modified" after a deploy exactly like `app/tenant.js` does, and the same
`git restore` habit applies to all four together, not just `tenant.js`.
`index.html`'s `<head>` links the manifest and sets `apple-mobile-web-app-*`
meta tags — Android/Chrome honors the manifest's `display:standalone`
directly, iOS Safari ignores the manifest for install behavior and needs
those meta tags plus an explicit `<link rel="apple-touch-icon">` instead.
Pingara's icon is the fan mark cropped out of the left of `logo.png` (which
is a wide wordmark lockup, not a square icon) onto a paper-cream square background
— generated by rendering a small HTML crop in headless Chromium and
screenshotting it at exact pixel sizes, since no image-editing tool was
available on this machine.
- **Fixed 2026-08-28 (reported: the icon looked "a little off-centered"
  when installed):** the first crop used a guessed crop width (270px out of
  the 900px-wide source) with the image left-anchored inside it — wider
  than the mark's actual pixel footprint, so the slack landed only on the
  right, and centering that whole lopsided box in the square canvas put the
  visible mark off-center too. Fixed by finding the mark's *exact* pixel
  bounding box first (scan `logo.png` for the first column-gap after the
  mark, to separate it from the "PINGARA" wordmark that starts further
  right — see `find_mark_bounds2.js` technique, not committed, just the
  scratchpad method) and sizing the crop box to that exactly, with the image
  shifted by a matching negative margin so the crop shows *only* the mark.
  All padding to the square canvas then comes from the outer flex centering
  alone, which is symmetric by construction. Verified by re-measuring the
  generated PNG's own ink bounding box afterward (pixel margins matched
  left/right, within 1px top/bottom) rather than eyeballing it, since
  eyeballing is exactly what produced the original bug.

RK Twelve21 has no logo file yet (`TENANT_LOGO:
null`), so its icon is a placeholder "RK" monogram in the app's own dark-ink/
brass palette — replace `app/tenants/rk-twelve21-icon-*.png` once a real
logo exists, same as `TENANT_LOGO` itself is waiting on one.

**Phone-width layout fixes.** A screenshot survey at 390px/375px width (the
actual previous behavior, not a hypothetical) found three real breakages,
all now fixed:
- `.tab-bar` (Add Expenses/Reports/Vendor Ledger/Suppliers) had no overflow
  handling — at phone width it just clipped past the viewport edge with the
  Suppliers button unreachable. Now `overflow-x:auto` with `flex:0 0 auto`
  tab buttons, so it's a swipeable strip instead.
- `.dash-hero-row` (the 4-cell Sales/Expenses/Profit/Profit% stat row used by
  both Reports and Vendor Ledger totals) was a single flex row with
  `overflow:hidden` — at phone width the cells couldn't shrink enough to fit
  and the last one or two values were silently clipped off (Profit/Profit%
  went missing, looked like a data bug, was actually a layout bug). Fixed
  with a `@media (max-width:980px)` override to a 2x2 grid plus a smaller
  value font-size, mirroring the pattern `.dash-compare-stats` (the
  Compare-months stat cells) already used successfully.
- Wide tables (`.ledger-wrap`, `.dash-table-wrap`, `.plain-table-wrap`) had
  no horizontal-scroll handling of their own, which combined with a missing
  page-level safety net meant a too-wide table could push the *entire page*
  wider than the viewport (sideways-scrollable page, easy to trigger by
  accident while trying to tap something). Fixed two ways together: a global
  `html,body{overflow-x:hidden}` safety net so no single element can do that
  again, plus `overflow-x:auto` on all three table-wrapper classes so a wide
  table scrolls *within its own box* instead of either overflowing the page
  or (now that the page-level net exists) getting silently clipped.
  `.plain-table-wrap` specifically needed `overflow-x:auto` layered on top
  of its existing `overflow:hidden` shorthand rather than replacing it —
  `overflow-y` needs to stay `hidden` for its rounded-corner-clipping trick
  on the table's square corners to keep working.
- `.brand-block` (logo + eyebrow/title in the header) gained `flex-wrap:wrap`
  so the logo and title stack instead of forcing the row wider than the
  viewport when there isn't room for both side by side.

**Desktop view toggle** (`#desktopViewToggle`, next to Logout in
`restaurantConfirmedBar`, added same day as a follow-up: Vendor Ledger's
table is wide enough that the phone-width layout above means real
horizontal scrolling to see it all). Phone browsers' old "Request desktop
site" menu option did this by overriding the page's `<meta viewport>` to a
fixed wide width, which makes CSS media queries see a wide *layout*
viewport and render their normal (non-mobile) layout, scaled down by the
browser to fit the actual screen — the user pinches/zooms to read one part
at a time. `applyViewportMode()` (core.js) does the identical thing
explicitly, in-app: swaps `#viewportMeta`'s `content` between
`width=device-width, initial-scale=1.0, viewport-fit=cover` (mobile) and
`width=1200` (desktop — comfortably clears the `max-width:980px` breakpoint
used throughout the mobile CSS above) via `DESKTOP_VIEW_KEY` in
localStorage. Doing this in-app rather than relying on the browser's own
toggle matters because it also works from an installed home-screen PWA,
where there's no browser chrome/menu to find "Request desktop site" in at
all. Applied immediately on script load (`applyViewportMode()` runs
unconditionally at the bottom of core.js, not gated on login) so it's
already correct on the login screens themselves. **Deliberately not cleared
by Logout** — this is a device/display preference, not login state, same
as a real browser wouldn't reset its own desktop-site setting on logging
out of a site.

## Tab structure (Add Expenses added first; Reports added 2026-07-31; Vendor
## Ledger added 2026-08-05; Suppliers added 2026-08-15; Staff OT & Salary
## added 2026-10-01)
Five tab panels, switched by `.tab-bar` buttons (`tabBtnExpenses` /
`tabBtnReports` / `tabBtnLedger` / `tabBtnSuppliers` / `tabBtnStaff`) via
`switchTab()` in reports-dashboard.js:
- **"Add Expenses"** (`#tabPanelExpenses`, default/active tab) — a
  restaurant control (Manager: name-only, in `.restaurant-context-bar` above
  all tabs, "Change restaurant" re-triggers the password gate; Owner: an
  actual `#expensesRestaurantSelect` dropdown in the toolbar itself, see the
  Login section above), date nav, history panel, LED totals, sales input,
  the supplier-first quick-add form, and the ledger table. The only tab a
  Manager profile ever sees.
- **"Reports"** (`#tabPanelReports`) — the sales-vs-expenses dashboard plus
  everything for generating/exporting Excel or CSV: `syncBtn` (Link Excel
  file), `downloadCsvBtn`, `downloadExcelBtn`, and `saveSpreadsheetBtn` (Save
  to Excel File), plus their shared `save-bar` note. A restaurant selector
  (all restaurants, or one specific one) plus a Day/Month/Date-range period
  toggle scope the dashboard (added 2026-08-06, mirrors Vendor Ledger's own
  filter row exactly — same `monthsBetween()` reuse for a range spanning
  multiple month-bucket documents). With one restaurant selected, the
  bar/pie chart just shows that restaurant's single bar/pie rather than a
  comparison — same rendering code, just a filtered `restaurants` array from
  `computeSalesExpenseData(periodType, params, restaurantFilter)`. Gated behind a
  **client-side password prompt** (`#reportsLock` / `#reportsContent`,
  `showReportsPanel()`): SHA-256 hashed in-browser (`sha256Hex`) and compared
  against `REPORTS_PASSWORD_HASH` — the plaintext password is not stored in
  the file, only its hash. Unlock state lives in `sessionStorage`
  (`reportsUnlockedSession`) — as of the login system above, an Owner is
  already unlocked on arrival; this gate mainly still matters as the
  mechanism the owner-login step itself sets.
  - **This is a soft deterrent, not real security.** It's a static HTML file
    with no backend — anyone who opens browser DevTools can read the hash (or
    the whole app's source), and Firestore itself has open rules (see above),
    so the underlying data was never protected by this gate. If real
    per-role access control is ever needed, that requires Firebase Auth +
    server-enforced rules, not a client-side password.
  - **"Spend by category" table + Profit %** (added 2026-08-20, modeled on a
    manual Excel cost-ratio analysis the owner already used for Umami):
    `computeSalesExpenseData()` builds `byCategoryAll`/`bySubcategoryAll` —
    category and subcategory totals across every restaurant matching the
    filter+date range, **independent of whether that restaurant logged a
    sales figure for the period**. `aggregateCategorySpend()` turns those
    into a sorted list, each row carrying its own `subcategories` array —
    amount and % **of total sales for the scope**, same ratio
    `buildSegments()` uses per-restaurant for the chart. `buildCategoryTable()`
    (`#dashCategoryTableWrap`, reused by the compare view below) renders it
    as a click-to-expand accordion — one category open at a time, mirroring
    Vendor Ledger's `vlExpandedVendor` pattern, except the expand state is
    closure-scoped per table instance (not a module-level variable) since
    Compare-months renders two of these side by side and each expands
    independently. The hero row gained a 4th stat, Profit %
    (`setProfitPctText()`), alongside the existing ₹ figures.
    - **Fixed 2026-08-20**: the chart/per-restaurant table legitimately stay
      sales-gated (a restaurant with no sales entry can't be plotted as a
      proportional sales-vs-expense bar), but that exclusion used to also
      silently drop that restaurant's expense categories from the aggregate
      "Spend by category" table and from the "Total expenses"/Profit hero
      figures — a restaurant that logs bills without ever logging a sales
      figure (a real usage pattern, not just an edge case) had its entire
      spend invisible everywhere except its own Add-Expenses/Vendor-Ledger
      view. `totalExpenses` is now derived from the same complete
      `byCategoryAll` sum the category table uses, so the hero "Total
      expenses" figure always agrees with what the table sums to; `totalSales`
      stays restaurant-gated since an unlogged sales figure genuinely isn't
      known to be zero.
  - **"Compare months" period mode** (`dashPeriodCompare`, same 2026-08-20
    change) — a 4th option alongside Day/Month/Date-range. Two independent
    `<input type="month">` pickers (`dashCompareMonthA`/`B`, no relationship
    to each other — deliberately not "this month vs last," the owner picks
    both), each queried via the existing `computeSalesExpenseData('month', …)`
    path and rendered as its own stats+category-table column
    (`buildDashCompareCol()`) inside `#dashCompareCols`. Selecting Compare
    swaps the whole chart+hero+category block (`#dashSingleView`) for the
    two-column view (`#dashCompareView`) and hides the now-meaningless
    Bar/Pie toggle (`#dashChartTypeGroup`) — the restaurant selector still
    applies to both columns. This is a live, in-app version of the "two
    months side by side, category breakdown + Sales/Expense/Profit/Profit%"
    pivot table the owner already built by hand in Excel for Umami — same
    underlying ratios, no download/Excel step needed to see it.
  - The financial-year picker modal (`#fyModal`, triggered by
    `downloadExcelBtn`) lives as a page-level sibling (not nested inside any
    tab-panel div) specifically so it isn't hidden by `display:none` when the
    Reports tab's panel is the one currently inactive.
  - To change the Reports/owner password, recompute a SHA-256 hex hash of the
    new password and replace `REPORTS_PASSWORD_HASH` in `reports-dashboard.js`
    (this same hash is reused for the owner-login step in auth.js).
- **"Vendor Ledger"** (`#tabPanelLedger`, `app/js/vendor-ledger.js`) — bills
  grouped by supplier instead of by day. A restaurant selector (all
  restaurants, or one specific one) plus a Day/Month/Date-range period
  toggle scope the view; each row shows bill count, amount, paid, unpaid,
  and — only in "All restaurants" mode — which restaurants that vendor
  supplied. A date range can span multiple month-bucket documents
  (`monthsBetween()` computes every month key it touches and merges them).
  Gated the same way as Reports (shares `reportsUnlocked()`/the same session
  flag, not a second password).
  - **Click a vendor row to expand it** (`vlExpandedVendor` holds at most one
    vendor name — an accordion, expanding a new vendor closes whichever was
    open. Persists across the re-render a status toggle triggers, but is
    cleared whenever the restaurant/period filter changes) into a nested
    per-bill table: date, restaurant (only in
    "All restaurants" mode), invoice #, amount, a clickable paid/unpaid
    `.badge` button, and the paid date. Toggling status here calls
    `toggleBillStatusByLocation()` (data-store.js) rather than mutating the
    `entries` array directly, since the bill may belong to a different
    restaurant/date than whatever's currently active in the Add Expenses tab
    — it reuses the month cache when it happens to be the same
    restaurant+month, otherwise fetches fresh, and syncs the live `entries`
    array too if it is the same day currently being viewed there.
  - **Vendor search, added 2026-10-18** (`vlVendorSearch`) — a free-text box
    in the same filter row as the period toggle, case-insensitive substring
    match on vendor name. Split the render into two steps specifically so
    typing doesn't re-fetch from Firestore on every keystroke:
    `renderVendorLedger()` still does the async `computeVendorLedgerData()`
    fetch (on period/restaurant change, or a status/verify toggle) and
    caches the result in `vlLastAllRows`/`vlLastAllTotals`; the search box's
    own `input` listener calls the new, synchronous
    `applyVLSearchAndRender()` directly, which just filters that cache and
    re-renders — instant, no loading flicker, no network. A search that
    matches nothing shows a distinct "No vendors match your search." empty
    message, kept separate from "No bills logged for this period yet." so
    the two causes aren't confused. The hero totals (Vendors/Total spend/
    Paid/Unpaid) are recomputed from the filtered rows when a search is
    active, so they always describe what's actually on screen, not the
    whole unfiltered period. **Deliberately also narrows `vlLastRows`**
    (and therefore every pending-bills download below) to the search
    results — the downloads already promise "whatever the table above is
    showing," and a search result is exactly that, so this preserves that
    invariant rather than introducing a second, separately-tracked scope
    concept. Verified with a new test (`test_vendor_ledger_search.js`,
    14/14): search narrows the table and hero totals correctly, is
    case-insensitive, a no-match search shows the right empty state without
    leaving `vlLastRows` stale, clearing the box restores every vendor, and
    a pending-bills download taken while a search is active correctly only
    includes the searched-for vendor.
  - **Sort + bank-account filter, added 2026-10-20** — "for all where
    possible," applied identically across Vendor Ledger, Payments, and the
    Suppliers tab (NOT the Manage Suppliers modal, deliberately — that's a
    fast quick-pick surface available to every profile including Manager
    during bill entry, where bank-account filtering has no relevance and
    extra controls would just add friction to a frequently-used lookup).
    `vlSortSelect` (`vlSortBy` — `amount_desc` default/unchanged, plus
    `name_asc`/`name_desc`/`pending_desc`/`pending_asc`) and
    `vlBankFilterSelect` (`vlBankFilter` — `all`/`with`/`without`, via the
    new `supplierHasBankAccount(name)` in data-store.js) both apply inside
    `applyVLSearchAndRender()`, after search and before the table/totals/
    `vlLastRows` are built — same "whatever's on screen" invariant the
    search feature already established, so a bank-account filter also
    narrows the downloads below, not just the table. `supplierHasBankAccount()`
    is deliberately the LOOSER bar (account number present, IFSC not
    required) — matching the existing "with/without bank details" CSV
    split's own bar, not the stricter `supplierHasFullBankDetails()` the
    bank-transfer downloads require, since this filter is about "do I have
    anything on file for them" not "are they bank-transfer-ready."
    Payments (`payments.js`) gets the same two controls (`paySortBy`,
    `payBankFilter`) inside `applyPaySearchAndRender()`, with one
    difference: no `amount_desc`/total-spend option, since every row
    there IS the pending list already — "amount pending" sort just sorts
    the existing Pending column directly (no ambiguity about which
    amount to use, unlike Vendor Ledger which also shows a Total spend
    column). Suppliers tab (`suppliers-tab.js`) gets `supSortSelect`/
    `supBankFilterSelect` inside `renderSuppliersTabList()`, with only
    `name_asc`/`name_desc` offered — no amount-pending option at all,
    since a plain directory entry has no amount concept (that only
    exists on bills), correctly excluded per "where possible" rather than
    forced in. Verified with a new test (`test_sort_filter_controls.js`,
    12/12, across all three tabs): each sort order produces the exact
    expected row order (not just "changed somehow"), the bank filter
    correctly includes/excludes vendors by their actual
    `supplierBankDetails` state in each of the three views.
  - **Pending bills download, added 2026-10-15** — two buttons
    (`vlDownloadPendingBtn`, plain CSV; `vlDownloadPendingBankBtn`, bank
    transfer `.xlsx`) reusing whatever period/restaurant scope the table
    above is already showing, no separate date picker of its own. Built
    from `vlPendingBillRows()`, which filters `vlLastRows` (the already-
    computed, already-rendered rows — never recomputed, so the download can
    never disagree with what's on screen) down to bills with
    `status !== 'paid'`. The plain CSV joins in each bill's supplier's
    `supplierBankDetails` (Account Number via `csvForceText()`, same
    scientific-notation guard the Staff reports use, + IFSC Code) and
    includes every pending bill regardless of whether its supplier has bank
    details on file (blank columns otherwise). The bank-transfer `.xlsx`
    reuses Staff's own `buildBankTransferRow()`/`downloadBankTransferWorkbook()`
    /`bankDebitAccountNumber` wholesale (staff-tab.js, loaded as a plain
    global like everything else in this app, so no refactor was needed to
    call it from vendor-ledger.js) and requires `supplierHasFullBankDetails()`.
    Originally shipped as one row per pending bill (so a multi-invoice
    supplier got separate, traceable transactions) — **changed the same day
    (2026-10-16), per an explicit follow-up request, to one row per vendor**,
    its pending bills summed into a single total, matching Staff's own
    bank-transfer format exactly (which aggregates OT/Incentive/Tips into one
    row per employee, not one per entry). Bill-level detail (invoice
    numbers, individual dates) is deliberately NOT in this file anymore —
    it's still available in the flat CSV and the "by vendor" sub-ledger
    `.xlsx` below, both unchanged; only this one format aggregates. Remarks
    is now the generic `"Pending bills payment"` (no invoice numbers,
    mirroring Staff's own generic `"OT/Incentive/Tips payout"` remarks) since
    there's no single invoice left to name once several are summed together.
    - **Fixed 2026-10-17: duplicate rows for the same real vendor.** The
      report "please just 1 entry for a vendor not multiple" traced back to
      `computeVendorLedgerData()` grouping vendors by the bill's raw
      `e.supplier` string (case/whitespace-sensitive), not `supplierKey()` —
      a real vendor billed as `"ABC Traders"` on one bill and
      `"abc traders"` (or with stray whitespace) on another produces TWO
      separate rows in `vlLastRows`, since that free-text field on each bill
      is independent of the `suppliers` directory. Both raw-name rows
      independently passed `supplierHasFullBankDetails()` (which already
      normalizes via `supplierKey()`), so each produced its own
      bank-transfer row with only its own partial total — the right total
      split across two "vendors" instead of summed into one correct one.
      **Deliberately fixed only inside `downloadPendingBillsBankTransfer()`,
      not in `computeVendorLedgerData()` itself** — changing the vendor
      grouping there would also change the on-screen Vendor Ledger table's
      own vendor count/totals for everyone, a much bigger change than this
      one format needed. The fix re-groups `vlLastRows` by `supplierKey()`
      into `mergedByKey` before computing totals, summing every raw-name
      variant's pending total together, then picks the display name from
      the `suppliers` directory's own exact casing when a match exists
      (`suppliers.find(s => supplierKey(s) === key)`) rather than whichever
      bill's spelling happened to be seen. Verified by extending
      `test_pending_bills_by_vendor.js` to 20/20 — added a bill for the same
      seeded vendor under a different-cased spelling and confirmed the
      bank-transfer file still produces exactly one row, with both amounts
      correctly summed and the canonical directory name used for display.
    `bankDebitAccountNumber` is loaded lazily inside
    `downloadPendingBillsBankTransfer()` itself (`await
    loadBankDebitAccountNumber()`) rather than assuming Staff's tab was
    already visited this session, since the two tabs load it independently
    now. No extra access gating beyond what Vendor Ledger already has —
    both buttons are owner/Central-Kitchen-only by virtue of the whole tab
    already being gated behind `reportsUnlocked()`/`hasElevatedAccess()`.
    - **Bug fix, same day the next request landed (2026-10-16)**: the
      `rows.length === 0` early-return branch inside `renderVendorLedger()`
      (no bills at all for the current period/restaurant scope) never
      called `renderVLTable()` — the ONLY place `vlLastRows`/
      `vlLastShowRestCol` get updated — so switching to an empty
      period/restaurant scope left every pending-bills download silently
      reading the *previous* scope's stale rows instead of correctly
      finding nothing. Existed from the moment `vlLastRows` was first reused
      for a download (this same day, above) until caught by
      `test_pending_bills_by_vendor.js`'s own empty-scope check, written for
      the vendor-wise download below but equally applicable to the other
      two. Fixed by explicitly resetting both to empty on that branch before
      the early return.
  - **"Pending bills by vendor" (.xlsx), added 2026-10-16** — a third
    format, requested as a follow-up the next day ("download the pending
    bill ledger vendor wise ie. give vendor wise data in the excel"), read
    as: group the same pending bills from the CSV above by vendor, as an
    actual `.xlsx` (not `.csv` — "in the excel" was explicit, same reading
    as the Suppliers bulk-edit template the day before) rather than
    replacing either existing button. `downloadPendingBillsByVendor()`
    needs no re-grouping at all — `vlLastRows` is already vendor-grouped by
    `computeVendorLedgerData()`, so it just filters each vendor's own
    `bills` down to unpaid ones. Single flat sheet, sorted by each vendor's
    pending total descending: vendor name/category/account number/IFSC
    written only on that group's FIRST bill row (blank on the rest) rather
    than repeated every line, followed by a `"Subtotal - <vendor>"` row,
    a blank spacer row, then the next vendor — classic sub-ledger shape,
    without needing SheetJS's real cell-merge support. Ends with a
    `GRAND TOTAL` row across every vendor. Amount/Subtotal/Grand Total are
    real JS numbers (not `.toFixed()` strings) since this is a genuine
    `.xlsx` built via `aoa_to_sheet()`, not a CSV opened by Excel — the
    scientific-notation risk `csvForceText()` guards against is CSV-
    specific and doesn't apply here, same contrast already noted for the
    bank-transfer downloads. Verified with a new test
    (`test_pending_bills_by_vendor.js`, 14/14: two vendors' bills correctly
    grouped with the right subtotals, a paid bill excluded from its
    vendor's subtotal, a vendor with no bank details on file gets blank
    bank columns rather than breaking the row, grand total correct, and an
    empty period/restaurant scope shows the "no pending bills" alert
    instead of a stale or empty file) plus the full existing suite re-run
    clean.
- **"Payments"** (`#tabPanelPayments`, `app/js/payments.js`, added
  2026-10-17) — a focused, bulk-pay view, requested after "marking bills
  as paid individually is difficult" once the real workflow (paying
  suppliers 1st–15th and 16th–end-of-month in two batches) made the bill
  count per batch too large for one-at-a-time toggling. Explored two
  designs with the user first (a bulk button bolted onto Vendor Ledger vs.
  a dedicated screen) — landed on a dedicated tab specifically because it
  can default to showing **only pending bills, grouped by vendor, with no
  already-paid clutter**, which is what actually makes a payment run fast;
  it still reuses Vendor Ledger's exact period-picker/restaurant-selector/
  search machinery and `computeVendorLedgerData()`, not a second parallel
  data layer. Gated identically to Vendor Ledger: `hasElevatedAccess()`
  for tab visibility, `reportsUnlocked()` for the password lock (shares
  the same session flag), shared top-bar restaurant selector
  (`payRestaurantFilter`, set from `applySharedRestaurantPick()` alongside
  `dashRestaurantFilter`/`vlRestaurantFilter`).
  - **Split render like Vendor Ledger's own search** (`renderPayments()`
    fetches via `computeVendorLedgerData()` on period/restaurant change,
    caches the raw result in `payLastAllRows`; `applyPaySearchAndRender()`
    filters that cache down to pending-only + the search term and
    re-renders synchronously, so typing in `#payVendorSearch` never
    re-fetches). `payLastFilteredRows` is explicitly exposed as what's
    **currently on screen** — the "Mark All Paid" button reads straight
    from it rather than recomputing the pending+search filter a second
    time, so the button can never mark something that isn't actually
    visible.
  - **One row per vendor**: name, category, restaurant(s) (only in "All
    restaurants" scope), pending bill count, pending amount, and a
    **"Mark Paid"** button — clicking it calls the new
    `markBillsPaid(bills)` (data-store.js) with just that vendor's
    currently-pending bills in scope. A **"Mark All Paid"** button above
    the table does the same for every bill across every vendor currently
    shown. Both show a `confirm()` first, naming the exact count and
    amount — the same "block before acting" treatment the Suppliers
    combine-duplicates tool uses, since this mutates potentially dozens of
    bills across restaurants/months at once. A vendor whose last pending
    bill just got marked paid simply disappears from the list on the next
    render (it's computed fresh from `payLastAllRows`/`applyPaySearchAndRender()`
    every time, not maintained as separate state).
  - **`markBillsPaid(bills)` (data-store.js)** — the bulk sibling of
    `toggleBillStatusByLocation()`, taking `[{restaurantId, date, id}]`.
    Groups by restaurant+month document so each one is read and written
    **at most once** regardless of how many of its bills are in the batch
    (a real payment run can span several restaurants and, for a date
    range crossing a month boundary, several months), reusing the exact
    same `sameCachedMonth` precision `toggleBillStatusByLocation()`
    already has (restaurant AND month-doc-key must both match
    `currentRestaurantId`/`currentBillsMonthCacheKey`, not just one).
    Returns how many bills were actually flipped (an already-paid bill
    caught in the batch — e.g., from a stale page — isn't recounted).
  - **Explicit safety property, requested up front**: marking a batch
    paid is a one-time action on whatever bills exist at the moment of
    the click — there is no date-range-level "paid" flag anywhere in the
    data model, so a bill added later (even dated inside an
    already-processed range) is a brand-new record that starts `unpaid`
    exactly like any other new bill always has. This didn't need any
    special code to guarantee — it falls straight out of `markBillsPaid()`
    only ever touching bill records that already exist when it runs.
    Verified explicitly, not just assumed: a new test
    (`test_payments_tab.js`, 21/21) seeds a bill dated inside an
    already-marked-paid range *after* marking it, and confirms that bill
    shows up as its own pending item (not silently paid, not merged into
    the vendor's already-paid total) — alongside the standard checks (only
    pending bills/vendors shown with correct totals, a paid bill excluded
    from a vendor's pending count, per-vendor Mark Paid only affects that
    vendor, Mark All Paid clears the whole visible scope and shows the
    empty state afterward, and vendor search narrows the list the same
    way Vendor Ledger's does). Full existing suite re-run clean.
  - **Expandable per-vendor bill list with deselect, added the same day**
    — "it is a problem if 1 or 2 bills are not paid within a marked date
    range," since the original version could only mark a vendor's WHOLE
    pending total paid in one shot. Each vendor row now expands (click the
    row or its caret — same accordion `.vl-vendor-row`/`.vl-detail-row`
    structure Vendor Ledger's own detail view already uses, including the
    CSS, so this didn't need new styling beyond two small additions) into
    its individual bills, each with a checkbox, **checked by default**
    (the common case is "pay everything"); unchecking one excludes it from
    that vendor's "Mark Paid" and the page-level "Mark All Paid"/"Mark
    Selected Paid" alike. `payExcludedBillIds` (a `Set` of bill ids) is
    the one piece of selection state, deliberately reset on every fresh
    fetch (period/restaurant/search change, or right after a mark-paid
    action completes) rather than persisted — an exclusion is a decision
    about THAT specific payment run, not a lasting property of the bill;
    if it genuinely shouldn't be paid next time either, it gets excluded
    again then, same as the user would naturally re-check a physical
    stack of bills each run.
  - **Live totals update via targeted DOM writes, not a table rebuild** —
    `updatePayLiveTotals()` iterates `payRowRefs` (built fresh each
    `renderPayTable()` call: `{row, markBtn, captionEl}` per vendor) and
    rewrites just the Mark Paid button's label/caption and the two
    page-level numbers (`#paySelectedAmount` hero, `#payMarkAllPaidBtn`'s
    own label) directly, so unchecking a bill doesn't collapse any other
    expanded vendor or move the scroll position — only expand/collapse
    and the period/search filters trigger a full `renderPayTable()`.
    **"Show the new total beside it," the user's exact ask**, is
    satisfied at two levels: a new "Selected to mark paid" hero sits
    beside the existing "Total pending" one at the page level, and each
    vendor's Mark Paid button itself shows the live selected amount
    (`Mark Paid (₹X)`) sitting directly beside that row's own unchanging
    "Pending" column — a visible side-by-side comparison rather than a
    separate explanation of what got excluded.
  - Multiple vendors can be expanded at once (no single-accordion
    restriction, unlike Vendor Ledger's own `vlExpandedVendor`) —
    deliberate, since reviewing a payment run plausibly means checking
    several vendors' bill lists before committing to Mark All Paid, not
    one at a time. Small "select all"/"select none" links inside each
    expanded vendor's own detail table toggle that vendor's bills only.
  - Verified with a new test (`test_payments_deselect.js`, 19/19): the
    page-level Selected/Total split starts equal and diverges correctly
    as bills are unchecked, a vendor's Mark Paid button and caption
    update live without affecting the unchanging Pending column, marking
    paid with one bill unchecked pays only the checked ones and leaves
    the rest genuinely pending (not silently included), the view
    correctly resets to the new (smaller) pending scope afterward, and
    "select all"/"select none" work independently per vendor. Full
    existing suite re-run clean — `test_payments_tab.js` needed one
    assertion updated for an intentional wording change (the Mark All
    confirm message now says "Mark N bills... as paid" instead of always
    "Mark ALL N pending bills," since it may now describe a selected
    subset, not literally everything).
  - **Download paid bills for one vendor, added 2026-10-20** — "give an
    option to download paid bill details... bill and restaurant wise for
    a particular vendor." Three real design forks (time scope, how to
    pick the vendor, flat-vs-grouped), asked explicitly rather than
    guessed, per [[feedback-collaboration-style]]/this app's own pattern
    for consequential-enough requests: scoped to the SAME period/
    restaurant selection already on screen (not a separate all-time
    history), triggered via the existing `#payVendorSearch` box rather
    than a new per-row button, and a flat CSV with a Restaurant column
    rather than restaurant-grouped sections. `updatePayVendorDownload()`
    matches the search text against `payLastAllRows` — deliberately NOT
    `payLastFilteredRows` (the pending-only list the main table reads
    from) — since a vendor search typed specifically to download a
    receipt is most likely for a vendor with NOTHING left pending
    (everything already paid, so they'd never appear in the pending
    list at all); only when the search narrows to exactly one vendor
    AND that vendor has at least one `status === 'paid'` bill in scope
    does `#payVendorDownloadWrap` appear, independent of whether the
    main pending table/empty-state is showing anything. Download is a
    plain CSV (`Date, Restaurant, Category, Invoice #, Amount`, sorted
    by date, filtered to `status === 'paid'` for that one vendor) —
    reuses the same `csvEscape()`/`fmtDateLabel()`/`restaurantLabel()`
    helpers every other flat download in this app already uses, no new
    formatting logic. Filename pattern mirrors Vendor Ledger's own
    period-suffix downloads (`payPeriodFilenameSuffix()`, a direct copy
    of `vlPeriodFilenameSuffix()`'s shape for the Payments tab's own
    period state). Verified with a new test
    (`test_payments_vendor_download.js`, 16/16): the download button
    stays hidden with no search text, correctly appears for a vendor
    whose bills are ALL paid even though the main list shows "no
    vendors match" for them, a mixed vendor's download includes only
    the paid bill and excludes the still-pending one, an ambiguous
    search matching 2+ vendors hides the button rather than guessing
    which one, a vendor with zero matching bills in scope also hides it,
    and clearing the search hides it again. Full existing suite re-run
    clean.
  - **Inline per-row download link, added the same day as a follow-up**
    — the search-triggered discovery above turned out to be "very
    complicated" in practice (the user couldn't find it until walked
    through the exact steps), so a second, easier path was added
    alongside it rather than replacing it: every vendor row already
    shown in the table (i.e., with something still pending) now has a
    small `⬇ N paid` link right next to its name, rendered only when
    `findVendorPaidBills(r.name)` (reading the FULL, not pending-
    filtered, row from `payLastAllRows`) finds at least one paid bill
    for that vendor in the current scope — no typing, no search. Both
    download paths share one function, `downloadVendorPaidBillsCsv(name,
    category, bills)`, factored out of what was previously inline in the
    search button's click handler. The link has its own click handler
    with `ev.stopPropagation()` so clicking it doesn't also trigger the
    row's own expand/collapse toggle (the row itself still listens for
    clicks to expand). The search-triggered version from earlier the
    same day is still the only path for a vendor with NOTHING pending at
    all (such a vendor has no row to attach a link to), so it was kept
    as the fallback rather than removed. Verified with a new test
    (`test_payments_inline_download.js`, 9/9): the link appears only
    next to a vendor that actually has a paid bill in scope (not a
    pending-only vendor), shows the right count, downloads the correct
    paid-only CSV, and — the one real risk with adding a clickable
    element inside an already-clickable row — confirmed clicking it does
    NOT also expand the row, while clicking elsewhere on the row still
    does. Full existing Payments suite re-run clean.
- **"Suppliers"** (`#tabPanelSuppliers`, `app/js/suppliers-tab.js`) —
  owner-only, same tab-visibility toggle as Reports/Vendor Ledger
  (`updateTabVisibilityForProfile()` in auth.js), no separate password
  screen of its own since owner-only visibility already gates it. Lists
  every supplier with its category/subcategory and lets you add a new one —
  `suppliers`/`categories`/`supplierDefaults` were already unnamespaced by
  restaurant (see Storage key structure above), so this list, and any edit
  made here, is automatically shared across every restaurant on the account,
  nothing extra needed for that part.
  - **Reuses `buildManageSupplierRow()` / `buildManageSupplierEditForm()`**
    (suppliers-ui.js) for the list and inline edit form — the exact same
    functions the Add Expenses toolbar's "Manage Suppliers" modal already
    used, refactored to take an `onChange()` callback instead of hardcoding
    which list to re-render, so both surfaces share one implementation
    rather than maintaining two. The "add a new supplier" form is a
    parallel copy with its own element ids (`supTab*`) rather than shared,
    since that logic wasn't already isolated from the modal's specific ids
    without a bigger refactor.
  - **Editing a supplier's name, category, or subcategory retroactively
    updates every past bill logged under that supplier** — not just new
    ones — across every restaurant and every month, not just the current
    one. `propagateSupplierEditToAllBills(oldName, newName, newCategory,
    newSubcategory)` (data-store.js) discovers every `rest:*:bills:*`
    month-document key across every restaurant
    (`listAllRestaurantsBillMonthKeys()`, a broad-prefix Firestore range
    query on `"rest:"` rather than one restaurant's own prefix), loads each
    one that isn't already cached, and on every bill matching the supplier
    (via `supplierKey()`, case/whitespace-insensitive) rewrites `supplier`
    to `newName` and `category`/`subcategory` to the new values — both in
    the SAME pass, only writing back documents that actually changed.
    Originally (`propagateSupplierCategoryToAllBills()`, 2026-10-02)
    category/subcategory only, with a rename deliberately NOT touching
    history. **Reversed 2026-10-19 at the user's explicit request** ("if a
    vendor name or any other detail is changed go into the data
    retrospectively") — a rename is now exactly as retroactive as a
    category change always was. Doing both kinds of change in one combined
    pass (rather than two separate scans, one per concern) was a deliberate
    choice, not just tidiness: a rename-then-category-scan ordering would
    have the category scan try to match bills by the OLD name right after
    the rename scan already rewrote it to the new one, finding nothing —
    caught while implementing, before it ever shipped. Runs from
    `buildManageSupplierEditForm`'s save handler whenever the name and/or
    category/subcategory actually changed, so it also fires from the old
    Manage Suppliers modal, not just this tab — edited from either surface,
    behavior is identical. The Suppliers bulk-edit-via-Excel feature below
    calls the same function with `oldName === newName` (bulk edit never
    renames, only matches-and-updates by existing name) — no behavior
    change there. Verified by extending the existing supplier test suite
    (`test_supplier_rename_and_combine.js`, part of a combined 15/15 — see
    "Combine duplicate suppliers" below) to seed a supplier with bills on
    two restaurants, rename it via the Edit form, and confirm both
    restaurants' bills show the new name afterward.
  - **Account number + IFSC code, added 2026-10-15** — a new,
    deliberately separate key (`supplierBankDetails`, `supBankDetailsKey()`
    in core.js) alongside `supplierDefaults` rather than merged into it,
    same split staff's own name/role fields keep from
    bankName/accountNumber/ifscCode. Shared account-wide like every other
    supplier key. `supplierHasFullBankDetails(name)` (data-store.js) mirrors
    `staffEmployeeHasFullBankDetails()` — both an account number AND an IFSC
    required (NEFT needs both), used to gate the Vendor Ledger bank-transfer
    download below. Editable from both the Suppliers tab's "Add a new
    supplier" form and `buildManageSupplierEditForm()` (so the Manage
    Suppliers modal gets it too, being the same shared edit form) — on a
    rename, the old key's bank-details entry is deleted and a fresh one
    written under the new name, same handling `supplierDefaults` already
    gets on rename. Deliberately **not** shown in the supplier list's
    collapsed view (same "editing is good, just simplify viewing" call
    already made for Staff's own bank fields) — only visible/editable via
    Edit.
  - **Bulk edit via Excel, added 2026-10-15** — unlike Staff's own bulk
    upload (`staff-tab.js`, add-only, no matching against existing records),
    this is a genuine round-trip **edit**: "Download template"
    (`supDownloadTemplateBtn`) exports every current supplier with its
    category/subcategory/account number/IFSC already filled in as an actual
    `.xlsx` (built via the same SheetJS `aoa_to_sheet()`/`writeFile()`
    pattern the bank-transfer downloads use, not a `.csv` like Staff's
    template — the request's own wording was specifically "excel file").
    Editing a cell and re-uploading the same file updates that supplier **in
    place**, matched by `supplierKey()` (case/whitespace-insensitive) against
    the uploaded "Supplier Name" column — a name with no existing match is
    added as a brand-new supplier instead, so one upload covers both bulk
    edits and bulk additions. A blank Category/Subcategory/Account/IFSC cell
    on an EXISTING supplier's row **clears** that field — the file is
    treated as the intended final state, not a partial patch (new suppliers
    with a blank category are still added, just left uncategorized, same
    representable state `buildManageSupplierRow()` already renders as "No
    category set"). A category that doesn't match any existing category name
    is left as a warning in the result summary rather than silently
    creating a new category from a typo. Category changes propagate to past
    bills exactly like the manual Edit form
    (`propagateSupplierCategoryToAllBills()`), tallied into one summary
    alert for the whole batch rather than one per row. Gated behind
    `canEditExistingRecords()` both at render time (the whole
    `#supBulkEditWrap` block hidden for Central Kitchen, same boundary the
    per-row Edit button already has) and again at click time inside the
    upload handler — same defense-in-depth pattern established for Staff's
    "all restaurants" downloads. Verified with a new test
    (`test_supplier_bank_and_pending_bills.js`) covering the full round
    trip: add with bank details via the UI, Edit form prefilled correctly,
    rename carries bank details to the new name, downloaded template
    reflects current state, uploading an edited copy updates the existing
    supplier and adds a new one, and the block is hidden/inert for Central
    Kitchen.
  - **Combine duplicate suppliers, added 2026-10-19** — "some suppliers
    have been entered multiple times by my managers give option to combine
    them and ask what name is to be used hence forth." "+ combine duplicate
    suppliers" (`supCombineLink`) toggles `supCombineModeActive`, which
    makes `buildManageSupplierRow()` (suppliers-ui.js) grow a checkbox per
    row via its new optional `combineMode` parameter — deliberately passed
    ONLY from the Suppliers tab's own `renderSuppliersTabList()`, never
    from the Manage Suppliers modal's `renderManageSupplierList()`, since
    this tool was explicitly asked for in the Suppliers tab only. Checking
    2+ suppliers (`supCombineSelected`, a `Set` of exact names) reveals a
    bar (`renderSupCombineBar()`) with a name input — a `<datalist>` of the
    checked suppliers' own exact spellings for quick-pick, but free text is
    also accepted — defaulting to whichever was checked first. Two real
    design forks were asked about explicitly before building, since this
    retags real history across the whole account (see
    [[feedback-collaboration-style]] — genuinely consequential + several
    valid designs = ask): (1) when the checked suppliers have DIFFERING
    category/subcategory/bank details, the user chose "use the chosen
    name's own data" — if the typed final name exactly matches one of the
    checked suppliers, THAT one's category/bank details become the merged
    entry's; otherwise (a brand-new spelling) the FIRST checked supplier's
    data is the base, no per-field picking UI; (2) Owner-only, same
    `canEditExistingRecords()` boundary the per-row Edit button and the
    bulk-edit tool above already have, gated at both render time
    (`supCombineWrap` hidden for Central Kitchen) and click time (the
    Confirm handler re-checks and no-ops). Confirming shows a `confirm()`
    dialog naming the vendor count and warning it's irreversible (the one
    place in this flow that blocks before acting, unlike a plain rename's
    after-the-fact alert — merging also deletes supplier entries outright,
    not just retags them) before calling the SAME
    `propagateSupplierEditToAllBills()` the Edit form's own rename uses,
    once per checked supplier (including the one whose data was kept, if
    its own name differs from the typed final name) — every checked
    supplier's bills end up under the one final name with zero
    special-casing needed, since a no-op rename for an already-matching
    bill is just not counted as changed. `suppliers`/`supplierDefaults`/
    `supplierBankDetails` entries for every checked name except the final
    one are deleted; `loadSupplierUsageIndex()` is also re-run immediately
    (not left to the next reload) so the merged-away names don't look
    stale in the current session's restaurant-scoped supplier pickers.
    Verified with a new test (`test_supplier_rename_and_combine.js`, 15/15
    combined with the rename-propagation test above): checkboxes appear
    only in combine mode, the name input defaults sensibly, three
    deliberately similarly-named/differently-cased duplicate suppliers
    (one of them sharing a bill already under the chosen final name, to
    verify the "already correct, don't double-count" case) correctly merge
    into one with the kept supplier's own bank details surviving, every
    affected bill ends up with the right supplier name, and the whole tool
    is hidden AND inert (direct click is a no-op) for Central Kitchen.
    **Caught while writing this test, not the app's own logic**: the test's
    own bill-seeding helper wrote bills directly into localStorage, which
    bypasses `billsMonthCache` (the in-memory cache `loadBillsMonth()`
    serves from for whichever restaurant+month is already active) — in
    real usage every bill write goes through functions that keep that
    cache in sync, so this only ever surfaces as a test-seeding artifact,
    never a production bug; fixed in the test by invalidating
    `currentBillsMonthCacheKey` before reloading, not by changing any app
    code.
    - **Extended the same day, from a real live case**: the owner spotted
      "Laxmi Departments" and "LAXMI DEPARTMENTAL STORES" as two separate
      vendors in Vendor Ledger but only the latter in the Suppliers tab. A
      read-only check of production confirmed why: "Laxmi Departments" had
      13 real bills (Krishna Veg Nigdi, 2026-10-01 to 2026-10-15) but
      wasn't in the `suppliers[]` directory at all — removed from it at
      some point (the "Remove" button's own confirm text already warns
      "Past bills already logged under this supplier are not affected"),
      or never added, while still actively being billed. The Suppliers
      tab's combine tool (above) had nothing to check for a name like
      that, since it only lists directory entries. **Fixed the live data
      directly first** (a service-account Firestore script, dry-run logged
      before any write, confirmed byte-for-byte against the dry run before
      executing — same live-data caution as the 2026-10-02 incident noted
      in "Known limitations" below) — the 13 bills also carried a
      subcategory ("Dry Goods & Grocery") the canonical supplier's own
      default didn't have yet, so per the owner's explicit choice that
      default was updated too and applied to all 96 pre-existing bills
      under that name, not just the 13 being merged in (109 total,
      verified with a second read-only pass afterward).
      **Then generalized the tool itself**: `findOrphanSupplierNamesInBills()`
      (data-store.js) scans every bill across every restaurant/month for
      supplier names that don't match (via `supplierKey()`) anything in
      `suppliers[]`, returning `[{name, count}]` sorted by count — run only
      on demand, when combine mode is entered (a full cross-restaurant
      scan, same cost class as `buildSupplierUsageIndex()`/
      `propagateSupplierEditToAllBills()`, never on every tab load).
      `renderSupCombineOrphans()` (suppliers-tab.js) renders these as extra
      checkbox rows in a new `#supCombineOrphans` block below the normal
      list, each labeled with its bill count and "not in supplier list"
      (reusing `.msr-cat.missing`'s existing warning style) — feeding the
      exact same `supCombineSelected` Set the directory checkboxes do, so
      an orphan name merges through the identical confirm-dialog-then-
      `propagateSupplierEditToAllBills()` path with zero special-casing:
      the existing cleanup code's `suppliers.filter(s => s !== srcName)` /
      `delete supplierDefaults[...]` / `delete supplierBankDetails[...]`
      calls are harmless no-ops for a name that was never in those
      structures. Verified with a new test
      (`test_supplier_combine_orphans.js`, 10/10): a seeded orphan name
      (bills only, never added to `suppliers[]`) is correctly surfaced with
      its right bill count and excluded from the "not in supplier list"
      label when it IS a directory entry, checking an orphan alongside a
      real directory supplier and merging works with no crash, and the
      orphan section clears after a successful merge. Full existing suite
      re-run clean.
  - **Supplier *pickers* are scoped per restaurant (added 2026-10-02)** —
    the underlying `suppliers`/`categories`/`supplierDefaults` stay fully
    shared account-wide as above; only the `#supplierSelect` (Add Expenses)
    and `#editBillSupplier` (Modify dialog) dropdowns are filtered, to
    `supplierVisibleForRestaurant(name, restaurantId)` (data-store.js):
    visible if that restaurant has at least one past bill against that
    supplier, **or** if the supplier has never been billed by *any*
    restaurant yet (a freshly-added supplier shows everywhere until its
    first bill narrows it to wherever it was actually used). The Suppliers
    tab's own list and the Manage Suppliers modal stay unfiltered — they're
    the account-wide admin/category-management view, not a bill-entry
    picker, so restaurant-scoping doesn't apply there.
    - `supplierUsageIndex` (core.js: `supplierKey() -> Set<restaurantId>`)
      is built once at init (`loadSupplierUsageIndex()` in init.js, kicked
      off non-blocking *after* `renderAll()` so app startup isn't delayed
      by scanning every restaurant's bill history — until it resolves,
      `supplierVisibleForRestaurant()` treats the empty index as
      unrestricted, so the only visible effect of the scan still running
      is the dropdown briefly showing more than it will a moment later,
      never less) and kept current afterward via `recordSupplierUsage()`
      rather than rebuilt from scratch on every render — called from three
      places, each only when it's actually appropriate: the quick-add
      submit handler and the Modify-bill save handler (a bill was actually
      saved against that supplier), and `saveSupplierBtn`'s handler (the
      Add Expenses toolbar's Manage Suppliers modal) **but only when the
      submitted name already existed in `suppliers`** — a genuinely
      brand-new name stays unclaimed (zero usage = visible everywhere) by
      design. That distinction matters: without it, a restaurant with no
      bill history for an *already-existing* supplier (used elsewhere, so
      the "never billed anywhere" exemption doesn't cover it) had no way
      to make it selectable again — typing its exact name into "Add a new
      supplier" was a no-op against `suppliers` (already present) and the
      dropdown still excluded it, so `.value = name` right after silently
      failed to select anything. Calling `recordSupplierUsage()` only for
      the pre-existing case fixes that without also narrowing a truly new
      supplier's visibility down to just whichever restaurant happened to
      add it — caught by testing both cases together after an initial fix
      accidentally did the latter too. The Suppliers tab's own add form
      (no restaurant context at all, being the account-wide admin view)
      deliberately does **not** call `recordSupplierUsage()` either way.
      **Deliberately never persisted to Firestore** — it's
      rebuilt fresh from the bills (the authoritative source) at the start
      of every session specifically so it can never drift out of sync with
      them the way a separately-saved derived structure could — see "Known
      limitations"' 2026-10-02 incident note below, which this design is a
      direct response to.
    - `buildSupplierUsageIndex()` deliberately does **not** reuse
      `fetchMonthObject()`'s single-month cache-reuse shortcut (which
      exists for the FY-register/Vendor-Ledger style reads, where it's
      safe because it only ever matters for the one restaurant+month
      currently active) — a caught bug during testing: reusing it here
      meant a cross-restaurant scan could silently return a stale cached
      copy for whichever one restaurant+month happened to already be
      cached in the Add Expenses tab, undercounting that restaurant's real
      supplier usage. Always reads directly via `safeGet()` instead, since
      correctness matters far more than the minor cost of a few extra
      reads during a scan that only runs once per session.
- **"Staff Expenses"** (`#tabPanelStaff`, `app/js/staff-tab.js` — tab
  button named "Staff OT & Salary" until 2026-10-02, renamed once Captain
  Incentive and Waiter Tips joined OT as peer entry types, see below) —
  **the one tab visible to BOTH Owner and Manager**, not owner-only like
  Reports/Vendor Ledger/Suppliers (`updateTabVisibilityForProfile()` in
  auth.js leaves `tabBtnStaff` alone). A Manager can add/view staff and log
  entries for their own restaurant only — the same boundary that already
  applies to Add Expenses via the restaurant password gate, not a new
  mechanism. No separate password screen of its own, same reasoning as
  Suppliers not needing one, just applied per-restaurant instead of
  account-wide.
  - **Unlike Suppliers, staff are NOT shared across restaurants** — an
    employee genuinely works at one restaurant, so `rest:<id>:staff` is its
    own flat-array document per restaurant (same shape/reasoning as
    suppliers: a static-ish master list, not a month-bucketed transactional
    log). The restaurant in scope comes from this tab's *own* selector for
    an Owner (`staffRestaurantId`, independent of `currentRestaurantId` —
    mirrors how Reports/Vendor Ledger each have their own restaurant
    selector rather than following whatever Add Expenses has active) or
    directly from `currentRestaurantId` for a Manager, who has nothing to
    pick between (`getStaffActiveRestaurantId()`).
  - **Bank name + branch + IFSC code are remembered account-wide**
    (`staffBankDefaults` in data-store.js, an unnamespaced key like
    `supplierDefaults`, each entry `{bankName, ifscCode, bankBranch}`) — a
    bank branch is a real-world entity that can plausibly serve employees
    at more than one of the account's restaurants, so this memory isn't
    restaurant-scoped like the staff list itself. Implemented as plain
    `<input list="...">` + `<datalist>` pairs (reusing the exact pattern
    Suppliers' subcategory field already established) rather than a custom
    dropdown: typing/picking a bank name auto-fills IFSC and branch *only*
    when there's exactly one remembered value for that exact name and the
    field is still empty, never overwriting something already typed.
    `bankBranch` isn't part of the dedup key (IFSC alone already uniquely
    identifies a branch) — `rememberBankDefault()` opportunistically
    backfills it onto an existing pair that didn't have one yet.
  - **Each employee record** (added 2026-10-01, then extended same day —
    see below) carries `name`, `employeeId`, `designation`, `department`,
    `gender`, `mobile`, `bankName`, `bankBranch`, `accountNumber`,
    `ifscCode`, `salary`, plus **an internal `id` (`uid()`), separate from
    the user-entered "Employee ID" text field** — the latter is just a
    display attribute (editable, not necessarily unique, and also accepts
    "Code" as an alias on bulk upload, see below), while the former is the
    stable key OT/salary entries actually reference. Both OT entries and
    salary entries also carry a denormalized `employeeName` snapshot
    alongside that internal id, so a later-renamed or removed employee
    never leaves a past entry pointing at a name that can no longer be
    found — same convention bills already use for supplier names
    (`e.supplier` is a string, not a foreign key).
  - **Extended same day** (prompted by the owner supplying an actual bulk-
    upload template from an existing payroll system) to add `designation`,
    `department`, `gender`, `mobile`, and `bankBranch` on top of the
    original 6-field record. The directory list row (`buildStaffRow()`)
    and edit form (`buildStaffEditForm()`) both show/edit every field;
    `.msr-view`/`.msr-edit`'s existing `flex-wrap` handles the extra spans
    and inputs without any new CSS. `gender` is a fixed 3-option `<select>`
    (blank/Male/Female/Other) everywhere it appears, not free text.
  - **Daily OT / Captain Incentive / Waiter Tips** (`rest:<id>:ot:<YYYY-MM>`
    → `{date: [...entries]}`, exactly bills' own shape — the Firestore key
    stayed `ot`, un-renamed, purely for backward compatibility with data
    already saved under it) — a flat amount typed directly per entry, not
    hours × an hourly rate (explicit choice: "we give out daily OT", not
    tracked by hours worked). Each entry gets its own paid/unpaid `.badge`
    toggle (`toggleOTPaid()`) and a Delete action, mirroring bills'
    status-toggle UX exactly. One shared date-nav control (prev/next day +
    date input, matching Add Expenses' own `#datePick` pattern) covers all
    three — they're logged against the same date far more often than not.
    - **Extended 2026-10-02** with a `type` field (`'ot'` |
      `'captain_incentive'` | `'waiter_tips'`, `STAFF_OT_TYPE_LABELS` in
      staff-tab.js) alongside OT. `addOTEntry()` defaults `type` to `'ot'`
      when not passed, and `staffOtTypeLabel()` falls back to `'OT'` for
      any entry read back with no `type` at all — so OT entries saved
      before this change (the feature had already been live for a day)
      keep displaying correctly, un-migrated, rather than needing a data
      backfill. The tab button itself was renamed "Staff OT & Salary" →
      "Staff Expenses" the same day to reflect the broader scope.
    - **Split into three separate lists, same day, same type field** — the
      very first version of this used one shared section with a
      `<select id="staffOtTypeSelect">` type picker; the next request
      asked for three genuinely separate lists instead (own add-form, own
      table, own empty-state, per type), so `STAFF_DAILY_TYPES`
      (staff-tab.js) now holds one config object per type — just the
      element ids and label — and every render/add/toggle/delete function
      is written once, parameterized by that config, and called three
      times (`renderStaffDailyTable(cfg)`, `renderAllStaffDailyTables()`
      looping over `STAFF_DAILY_TYPES`, one `addEventListener` per add
      button inside a `STAFF_DAILY_TYPES.forEach(...)`). The underlying
      data model and Firestore key are completely unchanged from the
      `type`-field extension above — this was purely a UI-layer split, so
      nothing needed migrating.
    - **Each list briefly got its own inline "+ Add new employee"
      quick-add** (same day, follow-up), then **reversed the same day**
      once more by explicit request: employees must come strictly from
      the restaurant's own directory (the one real add form / bulk
      upload), never from a shortcut inside a daily list, so there's
      exactly one place that can ever put an employee into a
      restaurant's staff list. The quick-add markup, the six extra
      `STAFF_DAILY_TYPES` element ids per type it needed
      (`quickAddLinkId` etc.), and its wiring were all removed again;
      `STAFF_DAILY_TYPES` is back to holding just the four ids each
      type needs for its own add-form/table. This is the second
      same-day reversal in this feature's history — worth remembering
      that "move the add-form elsewhere for tidiness" and "let each
      list add its own employees inline" are competing goals here, and
      the second one lost.
    - **Restaurant isolation, explicitly verified 2026-10-02**: the
      employee directory (`rest:<id>:staff`), daily OT/Incentive/Tips
      entries (`rest:<id>:ot:<YYYY-MM>`), and monthly salary
      (`rest:<id>:salary:<YYYY-MM>`) are all keyed per restaurant, and
      `getStaffActiveRestaurantId()` is re-read on every save/load
      rather than cached — unlike the bills/sales `fetchMonthObject()`
      helper, `loadOTMonth()`/`loadSalaryMonth()`/`loadStaffList()` call
      `safeGet()` directly with no cross-request cache to go stale, so
      there's no equivalent of the supplier-usage-index caching bug here.
      Verified with a dedicated Playwright test (two restaurants seeded
      with non-overlapping employees, switched back and forth, checked
      the directory list, all three OT/Incentive/Tips dropdowns and
      tables, and the Monthly salary table each time) — zero
      cross-restaurant leakage in either direction. Given the
      2026-10-02 supplier-list data-loss incident (see "Known
      limitations"), this tab's restaurant-scoping gets the same
      scrutiny going forward as the supplier-usage-index.
    - **Per-head employee rosters, same day (2026-10-02)**: not every
      restaurant employee needs OT, is a captain, or is a waiter, so each
      of the three lists' employee dropdown now only offers employees
      explicitly assigned to *that* list, rather than the full staff
      directory. Membership lives directly on the employee record
      (`emp.heads`, an array of type codes — `'ot'`/`'captain_incentive'`/
      `'waiter_tips'` — so it's already covered by the existing
      `rest:<id>:staff` restaurant-scoping and persistence, no new
      Firestore key). Each section shows a chip row of its current
      members (with a one-click "×" to unassign) and a "+ Manage
      employees in this list" link revealing a checkbox list of every
      employee in the directory — checking/unchecking and hitting Save
      writes the change back to every affected employee's `heads` array
      in one `saveStaffList()` call; Cancel discards. An employee can
      belong to any combination of the three lists at once (e.g. someone
      who does both OT and waits tables). New employees start on NO
      list (opt-in, not opt-out) — the bulk-upload result message says
      so explicitly, since this is the one place a new batch of staff
      could otherwise look like it "did nothing" in the daily lists.
      Unassigning someone from a list does NOT touch past entries already
      logged for them — removal is roster-only, not retroactive — same
      principle as removing someone from the Staff directory entirely
      (buildStaffRow's delete confirm already says this). Verified with a
      dedicated Playwright test (assign/unassign via chip and via
      checklist, Cancel discards, one employee in multiple lists
      simultaneously, and roster membership/checklist contents don't leak
      across restaurants either).
    - **Staff directory section moved, same day**: was the first section
      in the tab; now sits directly above "Add a new employee" at the
      bottom instead — purely a markup reorder (`<section>` moved in
      index.html), no element ids or JS touched, so nothing downstream
      needed updating.
    - **Per-list submit/lock, same day**: each list can be "submitted"
      independently for its current date
      (`staffOtSubmitBtn`/`staffIncentiveSubmitBtn`/`staffTipsSubmitBtn`/
      `staffAdvanceSubmitBtn`, confirmed via a native `confirm()` before it
      takes effect). Once submitted, `rest:<id>:otSubmitted:<YYYY-MM>`
      (data-store.js) records `{ "<date>": { <type>: true } }` — a separate
      key from the entries themselves, so the entries' own shape never
      needed to change. `staffCanEditDaily(submitted)` (staff-tab.js) is
      the single gate: `isOwnerProfile() || !submitted`. When it's false
      (Manager, on a submitted list/date), `renderStaffDailyTable()`
      disables that list's employee select, amount input, and Add button,
      plus every existing row's Delete button — all via the native
      `disabled` attribute, not just hiding click handlers, so there's no
      way to interact even via devtools without the attribute showing up.
      The Owner profile is **never** gated by this flag, by design — the
      explicit answer to "how can a mistake be fixed later" was "only the
      Owner, logged in as Owner, no other way," so there's deliberately no
      in-app "unsubmit" control for anyone, Owner included; an Owner who
      needs to fix something just edits directly, and the list stays
      flagged as submitted (so Manager stays locked out) the whole time.
      The Submit button itself disappears once clicked, replaced by a
      status badge whose text differs by profile (Manager sees "locked,
      contact the Owner"; Owner sees "still editable by you"). Submission
      is independent per list (OT finalized doesn't touch Incentive/Tips/
      Advance), per date (a new day always starts unsubmitted), and per
      restaurant (same key-per-restaurant convention as everything else in
      this tab). Verified with a dedicated Playwright test covering all of
      the above plus the full existing staff/supplier suite re-run clean
      afterward.
    - **Paid/unpaid status removed entirely, same day**: every OT/
      Incentive/Tips entry used to carry a `status` ('paid'/'unpaid') with
      a toggle badge in the table (`toggleOTPaid()`), and the combined
      report had an "Unpaid entries only" checkbox filtering by it. Both
      removed outright by explicit request — `toggleOTPaid()` deleted from
      data-store.js (it had exactly one caller, now gone), the Status
      table column and badge button removed from
      `renderStaffDailyTable()`, the checkbox removed from index.html, and
      `downloadStaffCombinedReport()` no longer filters by it (every
      qualifying entry in the date range always counts). `addOTEntry()` no
      longer writes `status`/`paidAt` on new entries at all — unlike the
      Monthly salary hide above, this is a genuine removal, not a
      `display:none`, since the request was specifically to *remove* the
      options, not hide them. Pre-existing entries that still carry old
      `status`/`paidAt` fields in Firestore are harmless, unread dead data
      — no migration was needed or performed.
    - **Staff Advance added as a fourth list, same day**: reuses the exact
      same `STAFF_DAILY_TYPES`-parameterized machinery as OT/Incentive/
      Tips (own add-form, own table, own independent submit/lock) —
      adding it was a matter of appending one more config object to
      `STAFF_DAILY_TYPES` plus one more markup block in index.html; every
      render/add/submit function already iterates the array generically,
      so nothing else needed changing. Entries use `type: 'advance'` in
      the same `rest:<id>:ot:<YYYY-MM>` collection as the other three (no
      new Firestore key). Deliberately **excluded from the Combined
      OT/Incentive/Tips report** — an advance is money already paid out
      to an employee, not a future payout to calculate, so summing it
      alongside OT/Incentive/Tips into one "Total" would overstate what's
      actually owed; `downloadStaffCombinedReport()` explicitly skips
      `type === 'advance'` entries before they're even added to the
      per-employee totals object, so an employee with only an advance in
      range doesn't show up as a bogus all-zero report row either.
    - **Unlike OT/Incentive/Tips, Staff Advance has NO roster of its own**
      (corrected the same day, right after it first shipped with one by
      default via the shared `STAFF_DAILY_TYPES` machinery above) — "any
      one can take advances," not just whoever happens to be assigned to
      a pay-type list. Its config object in `STAFF_DAILY_TYPES` carries
      `allEmployees: true` and omits `rosterChipsId`/`manageLinkId`/
      `manageBoxId`/`manageListId`/`manageSaveBtnId`/`manageCancelBtnId`
      entirely (and index.html has no roster-chips/manage-box markup for
      it either) — `renderStaffDailyEmployeeSelects()` checks
      `cfg.allEmployees` and lists the full `currentStaffList` instead of
      filtering by `employeeInHead()`, `renderHeadRoster()` returns
      immediately when `cfg.rosterChipsId` is missing, and the
      `manageLinkId`/`manageSaveBtnId`/etc. click-wiring loop filters to
      only configs that actually have a `manageLinkId` before attaching
      listeners (`document.getElementById(undefined)` would otherwise
      throw for Advance). A brand-new employee — even one from a bulk
      upload that moment — is immediately selectable for an advance, no
      assignment step, while still needing explicit roster assignment for
      OT/Incentive/Tips as before.
  - **Combined OT/Incentive/Tips report** (added 2026-10-02,
    `downloadStaffCombinedReport(bankFilter)`) — a From/To date-range picker
    above three download buttons (originally one; split 2026-10-09 — see
    below) (originally also had an "Unpaid entries only" checkbox; removed
    the same day the paid/unpaid concept was removed entirely, see above —
    every qualifying entry in range always counts now). Scans
    `rest:<id>:ot:<YYYY-MM>` across every
    month the range touches (`monthsBetween()`, reused from
    vendor-ledger.js), sums each employee's OT/Captain Incentive/Waiter
    Tips separately (skipping `type === 'advance'` entries), then joins that
    against `currentStaffList` for bank name/branch/account
    number/IFSC/designation/department/mobile — a payment-ready sheet for
    whenever the owner actually needs to process these payouts, not just a
    log of what was entered. Only employees with at least one qualifying
    entry in range appear (not every current employee, unlike the Monthly
    salary table below). Falls back to the entry's own denormalized
    `employeeName` snapshot if the employee was since removed from the
    directory. Plain CSV via the same `Blob`+`URL.createObjectURL`+
    `csvEscape()` pattern `excel-export.js`'s `downloadCsv()` and the
    bulk-upload template already use.
    - **Split into three downloads, 2026-10-09**: "Download all",
      "With bank details", and "Without bank details" all call the same
      `downloadStaffCombinedReport(bankFilter)`, just with `'all'`/`'with'`/
      `'without'` — the totals-scanning and row-building are completely
      unchanged, only which `employeeIds` make it into `rows` differs.
      `staffEmployeeHasBankAccount(emp)` checks `accountNumber` specifically
      (the same field the staff directory's own "No bank details set" badge
      keys off, not just `bankName` alone) — an employee who's since been
      removed from the directory (denormalized name only) counts as not
      having one, since there's nothing left to pay into. Filenames get a
      `_with-bank-details`/`_without-bank-details` suffix; "all" keeps the
      original unsuffixed name. An empty result shows a filter-specific
      alert ("No employees with/without bank details on file have
      OT/Incentive/Tips entries for that date range") rather than the
      generic one, so it's clear the *filter* came up empty, not the whole
      range.
    - **Mobile/account numbers forced to text in the CSV, 2026-10-09**:
      Excel auto-converts a bare 10+ digit numeric string to scientific
      notation (`9.97E+09`) and silently truncates past 15 digits, which
      corrupts a mobile or account number opened from a plain CSV.
      `csvForceText(v)` (excel-export.js) wraps the value as the Excel
      formula literal `="1234567890"` before it reaches `csvEscape()` —
      Excel evaluates that as literal text, showing every digit exactly as
      given. Applied to the Mobile and Account Number columns only (IFSC
      already has letters, so it's immune); the rest of the row is
      untouched.
    - **On-screen summary added 2026-10-03** (`renderStaffReportSummary()`)
      — four `.dash-hero` stat cards (OT / Captain Incentive / Waiter Tips
      / Total, same visual pattern as the Reports tab's Total
      sales/expenses/profit cards) above the download button, so checking
      "what did we pay out" doesn't require downloading a CSV first. The
      totals-scanning logic was factored out of
      `downloadStaffCombinedReport()` into a shared
      `computeStaffReportTotals(restId, from, to)` so the on-screen
      numbers and the downloaded file read from exactly the same
      computation and can never disagree. `staffReportDefaultDates()` now
      defaults From/To to **yesterday** (`addDaysStr(todayStr(), -1)`)
      instead of the 1st-of-month-to-today it used before — "what did we
      pay out yesterday" is the more common quick check, and this also
      narrows the default CSV range to match; the date inputs stay freely
      editable for any other range. The summary re-renders on: the date
      inputs' `change` event, every `renderStaffPanel()` call (tab open,
      restaurant switch), and every OT/Captain Incentive/Waiter Tips
      add/delete (deliberately skipped for Staff Advance adds/deletes,
      since Advance never counts toward this summary either) — so it's
      never stale after an action that could change it.
  - **Salary — Days Present** (added 2026-10-09, `renderStaffSalaryCalcTable()`)
    — a new, separate section (not the flat Monthly Salary table below,
    which stays hidden and untouched) for the request "we just add the
    number of days present and you calculate the salaries of employees by
    subtracting their advances." Month picker (its own
    `staffSalaryCalcMonth`, independent of the flat table's
    `staffSalaryMonth`) above a table with one row per current employee:
    an editable Days Present input, then Gross / Advances / Net, all
    computed, plus the same four `.dash-hero` summary cards and the same
    all/with-bank/without-bank CSV split the combined report above uses.
    **Only the days-present number is persisted** — `saveSalaryDaysForEmployee()`
    writes to a new key, `rest:<id>:salaryDays:<YYYY-MM>` →
    `{employeeId: {days, savedAt}}` (data-store.js), deliberately separate
    from `rest:<id>:salary:<YYYY-MM>` (the old flat table's own key).
    Gross/Advances/Net are **never stored** — `staffSalaryCalcFor(emp, days,
    daysInMonth, advance)` recomputes them from the employee's *current*
    `salary` field, `daysInCalendarMonth(monthKey)` (`new Date(y, m, 0)
    .getDate()` — day 0 of next month is the last day of this one), and
    `computeStaffAdvanceTotalsForMonth()` (data-store.js, sums that
    calendar month's `type === 'advance'` entries from the same
    `rest:<id>:ot:<YYYY-MM>` collection the daily lists use) every time the
    table renders — so a later salary change or a newly-logged advance is
    reflected immediately without anything here needing re-saving, by
    design per the user's explicit choice to persist only days-present, not
    the calculation. The days input also has a live `input` listener that
    recomputes just that row's Gross/Net cells as you type, before Save —
    the four summary cards deliberately do **not** update until Save, same
    "nothing written (or counted) until Save" discipline the flat Monthly
    Salary table already follows. Advances only count from the same
    calendar month as the salary being calculated (an earlier month's
    advance was already deducted then) — the user's explicit choice over
    "every unpaid advance ever," which would have needed a
    settle/already-deducted flag to avoid double-counting. The download
    only includes employees with a saved days-present value `> 0` for that
    month (mirrors the combined report only including employees with a
    qualifying entry) and reuses `staffEmployeeHasBankAccount()` and
    `csvForceText()` from the combined report unchanged. Verified with
    `test_salary_days_present.js` (21/21: both employees appear with no
    roster/assignment step needed, live preview during typing, totals stay
    at zero until Save then match exactly, days-present persists across
    leaving and returning to the tab, all three downloads correct
    including the actual Gross/Net figures and the with/without-bank
    filtering, a zero-days employee is excluded from every download, no
    scientific notation / full-precision account numbers via
    `csvForceText()`) plus the full existing suite re-run clean. **Caught
    by testing**: the table didn't refresh after adding a new employee or
    a bulk upload — only `renderStaffPanel()` (tab open/restaurant switch)
    called the new render function at first, missing the two other places
    the flat Monthly Salary table already refreshes itself
    (`staffSaveEmployeeBtn`'s handler and the bulk-upload handler) — fixed
    by adding the same call alongside `renderStaffSalaryTable()` in both.
    - **Bank transfer (.xlsx) download added the same day**, on both this
      report and the combined OT/Incentive/Tips report above — the user
      shared their actual downloaded bank template
      (`BLKPAY_YYYYMMDD.xlsx`, IDFC FIRST's bulk-payment format) and asked
      for a download that matches it, kept separate from the existing CSV
      downloads. Read with the `xlsx` npm package first (not the Read
      tool, which can't parse binary files) to capture the real column
      headers (`BANK_TRANSFER_HEADER_ROW`) and the bank's own per-column
      instructions text (`BANK_TRANSFER_INSTRUCTIONS_ROW`), both
      reproduced verbatim as rows 1–2 of the generated file, in case the
      bank's own bulk-upload parser is strict about the template's exact
      structure — data starts row 3, same as the real template. Built with
      the same SheetJS (`XLSX.utils.aoa_to_sheet()` + `XLSX.writeFile()`)
      pattern `excel-export.js` already uses for the FY register, not a
      new dependency. Three design decisions needed real answers before
      building (asked via questions, since this generates a file that
      moves real money and a wrong guess isn't just inconvenient): the
      required "Debit Account Number" field is one shared value across
      every restaurant, not per-restaurant; Transaction Type is always
      `"NEFT"` (never auto-detected `"IFT"`, which would have needed
      knowing IDFC FIRST's own IFSC prefix); and the feature applies to
      both reports independently, each producing its own file, not a
      merged one. **The debit account number is deliberately never typed
      into chat or committed to git** — `bankDebitAccountNumber`
      (core state in data-store.js) is entered once in a new "Bank
      Transfer Settings" field in the Staff tab and stored the same
      account-wide way `staffBankDefaults` already is, same as every other
      piece of real financial PII in this app (see "Data & security
      notes" below). `staffEmployeeHasFullBankDetails(emp)` is a stricter
      bar than the plain CSV's `staffEmployeeHasBankAccount()` — NEFT
      needs both an account number *and* an IFSC code, so an employee
      missing either is silently excluded here (still included normally
      in the plain CSV). The salary version also excludes any employee
      whose net pay isn't strictly positive (an advance larger than the
      days-present gross), since a bank transfer amount can't be zero or
      negative — that employee still appears correctly, negative net and
      all, in the plain CSV. Account number, IFSC, and the debit account
      are written as real JS strings into the `.xlsx` cells, so (unlike
      the CSV downloads) they render as text with no scientific-notation
      risk and need no `csvForceText()`-style workaround — that trick is
      specific to a CSV being *opened* by Excel, not to a binary `.xlsx`
      built directly via SheetJS. Amount is written as an actual JS
      number (not a string), since the bank's own instructions say
      "Enter payment amount" without any text-preservation concern the
      way an account/mobile number has. Transaction Date is always
      today's date (`todayDDMMYYYY()`, converting `todayStr()`'s
      `YYYY-MM-DD` to the bank's required `DD/MM/YYYY`) — no separate date
      picker, matching the minimal scope actually requested; a future
      date can still be hand-edited into the downloaded file before
      upload if needed. Verified with `test_bank_transfer.js` (18/18:
      download blocked with a clear message before the debit account is
      set, the setting persists across reload, the header and
      instructions rows match the real template exactly, an
      account-without-IFSC employee is excluded from both reports' bank
      files while still appearing in the plain CSV, Transaction Type/
      Debit Account/Date/Currency are all correct, Amount is a real
      number not text, account/IFSC are preserved as exact text) plus the
      full existing suite re-run clean.
    - **"All restaurants" cross-restaurant version, added 2026-10-15**
      (`computeStaffReportTotalsAllRestaurants(from, to)`,
      `downloadStaffCombinedReportAllRestaurants(bankFilter)`,
      `downloadBankTransferCombinedReportAllRestaurants()`) — a second
      sub-section inside the Combined OT/Incentive/Tips report, "All
      restaurants," with its own four buttons mirroring the single-restaurant
      ones above but covering every restaurant in `RESTAURANTS` (including
      Central Kitchen) in one file, over the same From/To range already on
      screen. Owner/Central Kitchen only (`hasElevatedAccess()`) — a Manager
      is restricted to their own restaurant everywhere else in this app, so
      the wrapping `<div id="staffReportAllRestaurantsWrap">` is toggled
      alongside `sharedRestaurantWrap` in `updateTabVisibilityForProfile()`
      (auth.js), and each download function re-checks `hasElevatedAccess()`
      at call time too — same defense-in-depth as `canVerifyEntries()`, since
      a profile can switch mid-session without a reload. Deliberately scoped
      to OT/Captain Incentive/Waiter Tips only (not Salary — Days Present or
      Staff Advance), matching the single-restaurant Combined report's own
      scope. `computeStaffReportTotalsAllRestaurants()` loops `RESTAURANTS`,
      calling the existing `computeStaffReportTotals(r.id, from, to)` and
      `loadStaffList(r.id)` per id — both already took a restaurant id as a
      parameter and don't touch `currentStaffList`/`currentRestaurantId`, so
      this never disturbs whichever restaurant happens to be selected on
      screen. The CSV output gets a new leading **Restaurant** column
      (restaurant name, not id); the bank-transfer `.xlsx` has no spare
      column for it (fixed template), so the restaurant name is appended to
      the Remarks field instead (`"OT/Incentive/Tips payout - <restaurant
      label>"` vs. the single-restaurant version's plain `"OT/Incentive/Tips
      payout"`). Filenames drop the restaurant id prefix entirely
      (`all-restaurants-staff-ot-incentive-tips_<from>_to_<to>.csv` /
      `all-restaurants-bank-transfer-ot-incentive-tips_<from>_to_<to>.xlsx`).
      Verified with `test_all_restaurants_staff_report.js` (20/20: the block
      is visible for Owner and hidden for a normal Manager, a direct console
      call is a no-op for Manager even with the button hidden, all four
      downloads correctly combine entries seeded on two different
      restaurants, the Restaurant column and per-row totals are correct, the
      with/without-bank-details split is correct across restaurants, and the
      bank-transfer file's Remarks column correctly names which restaurant
      each row is from) plus the full existing suite re-run clean.
  - **Monthly salary** (hidden from the UI 2026-10-02 via `display:none` on
    its `<section>` — "not required right now," not removed; the data
    model, `renderStaffSalaryTable()`, and all its Firestore reads/writes
    are completely untouched, so un-hiding it later is a one-line revert
    with zero data loss). `rest:<id>:salary:<YYYY-MM>` →
    `{employeeId: {employeeName, amount, status, paidAt}}`, one entry per
    employee per month, not an array — every *current* staff member gets a
    row regardless of whether a salary document exists yet for the viewed
    month: `renderStaffSalaryTable()` shows the saved amount if one exists,
    otherwise the employee's own default `salary` as an editable
    suggestion, so nothing is written until Save or the paid toggle is
    used. Editing the amount (`saveSalaryAmount()`) deliberately does
    **not** touch paid status — flipping an already-paid month back to
    unpaid just because the figure was corrected afterward would be wrong;
    the two are separate actions, same as the amount input + paid badge
    being two separate controls in the row.
  - **Bulk upload** (`staffBulkUploadBox`, collapsed by default behind a
    "+ bulk upload a list" link, same reveal pattern as Suppliers'
    "+ new category"/"+ new subcategory") reuses the `XLSX` global already
    loaded for Excel export (`excel-export.js`'s CDN script tag) to parse
    an uploaded `.csv`/`.xlsx` — `XLSX.read()` + `sheet_to_json()`, matched
    against expected headers via `get()`'s alias list, case-insensitively
    and ignoring a trailing `*` (so `"Bank Name"`, `"Bank"`, `"Code*"`, and
    plain `"Code"` are all accepted). Only a blank Name is a hard skip;
    every other field is optional per row.
    - **`STAFF_TEMPLATE_HEADERS` matches an existing payroll-system export
      format verbatim** (added 2026-10-01, replacing an earlier
      app-invented header set, after the owner supplied a real template
      from that system): `Code*, Employee Name*, Display Name, Mobile
      country code, Mobile No*, Gender*, Department Name*, Designation
      Name*, Salary, Bank Name, Account Number, IFSC Code, Bank Branch` —
      so a staff list already maintained there can be dropped in with zero
      reformatting, both via the "Download template" button (which emits
      this exact header row) and via uploading a file straight from that
      other system. `"Mobile country code"` and `"Mobile No"` combine into
      one `mobile` field (`"+91 9876543210"`); SheetJS reads a bare `"+91"`
      CSV cell as the number `91`, dropping the `+` (spreadsheet numeric
      parsing, not a bug here) — the parser re-prepends it when a country
      code is present but not already `+`-prefixed. `"Display Name"` is
      read but has no field of its own beyond `name` (populated from
      `"Employee Name"`) — kept in the template only so the two header sets
      stay interchangeable.
  - **The directory's collapsed list view was simplified 2026-10-02** to
    just name + an optional designation/department tag + Edit/Remove —
    employee ID, mobile/gender, bank details, and salary all used to show
    inline (bank was masked to last-4 via `maskAccountNumber()`, now
    deleted — unused once nothing displayed bank details in the view
    anymore) but made the list feel dense/cluttered at a glance. All of
    that is still there, unmasked and fully editable, inside the
    per-employee Edit form (`buildStaffEditForm()`) — only collapsed-view
    `buildStaffRow()` changed; the masking precaution is effectively
    replaced by "not shown by default at all," which is more private, not
    less.
  - **This tab introduces the most sensitive data this app stores** — real
    bank account numbers and IFSC codes, not just operational
    spend/category data. The same "soft deterrent, not real access
    control" tradeoff documented for the rest of the app (open Firestore
    rules, client-side-only passwords) applies here too, consciously, not
    as an oversight carried over by default. If this data's sensitivity
    ever outgrows that tradeoff, it's the strongest candidate in the app
    for being the first thing migrated behind real Firebase Auth + rules.

## Modify a bill (added 2026-08-05)
Each ledger row has a **Modify** button (`ledger-ui.js` renders it,
`reports-dashboard.js`'s `tableBody` click handler wires it). Only supplier,
date, invoice, amount, and status are editable — **category/subcategory are
never directly editable**, they always follow the selected supplier's saved
default (same supplier-first rule as the quick-add form), shown as a
read-only hint (`renderEditBillCatHint()`). Changing the date can move a bill
into a different day, even a different month-bucket document
(`moveEntryDate()` in data-store.js).

Freely usable for **1 hour after `createdAt`** (`MODIFY_WINDOW_MS` in
core.js); past that, a manager is prompted for the owner/Reports password via
`modifyAuthModal` (a generic password gate taking a success callback, shared
with the sales-unlock flow below) before the edit dialog opens. Editing
doesn't reset `createdAt`, so an old bill needs the password again on every
edit. An owner session skips this prompt entirely (see the login section
above).

**Sales entry follows the same rule.** A `rest:<id>:salesMeta:<YYYY-MM>` doc
(separate from the sales value itself, so Excel export/dashboard readers are
unaffected) tracks when each date's figure was first saved; past the 1-hour
window the Save button becomes a "🔒 Unlock" prompt for a manager, and is
never locked at all for an owner.

## Bill attachments (added 2026-10-01)
A bill can have one photo or PDF attached — a camera-captured or
already-on-device image of the paper invoice — plus **Invoice # became
required** the same day (was previously optional; `#invoiceInput` just
gained `required` and the browser's own constraint validation handles the
rest, same mechanism the Supplier/Amount fields already relied on, no new
JS check needed). The attachment itself is optional.

**This is the one place this app uses a Firebase service other than
Firestore.** Binary files don't fit Firestore's 1 MiB document cap or
localStorage's quota, so photos/PDFs live in actual **Cloud Storage for
Firebase** instead — only the resulting download URL (plus the Storage
object path, kept for later deletion) gets written onto the bill entry
itself, the same "small document, external blob" split every other large
thing in this app already uses (Excel files live in the user's own
Google Drive/OneDrive via the File System Access API, not in Firestore
either). `storage.rules` mirrors `firestore.rules` exactly — fully open
(`allow read, write: if true`), same documented tradeoff, deployed
separately from hosting (`firebase deploy --only storage --project
<project>`, not part of `deploy.sh`) since rules rarely change.

- **`app/js/attachments.js`** is the whole feature in one file:
  - `uploadBillAttachment(restaurantId, billId, file)` — uploads to
    `rest/<restaurantId>/bills/<billId>/<timestamp>_<sanitized filename>`
    and returns `{url, path, name, type}`. Throws (caller shows the message
    via `alert()`) if the file exceeds `ATTACHMENT_MAX_BYTES` (15 MB) or if
    Storage can't be reached — a failed upload **blocks the bill from
    saving at all**, deliberately: silently saving the bill without the
    photo the user explicitly attached would be a worse surprise than
    making them retry.
  - `compressImageFile(file)` — downscales to `ATTACHMENT_IMAGE_MAX_DIM`
    (1600px longest side) and re-encodes as JPEG at
    `ATTACHMENT_IMAGE_QUALITY` (0.75) via an off-screen canvas, before
    upload. A phone camera photo can be 5-10+ MB; restaurant wifi/mobile
    data makes that slow both to upload and to view later. Only used if the
    result is actually smaller than the original; PDFs pass through
    unchanged (no cheap client-side PDF recompression). **Fails closed, not
    open** — if `createImageBitmap()` can't decode the file for any reason,
    the catch block logs and falls back to uploading the original
    untouched, rather than blocking the whole bill over a compression
    hiccup.
  - `deleteBillAttachmentByPath(path)` — best-effort delete (used when a
    bill is deleted, or its attachment is replaced/removed via Modify).
    Swallows errors; a dangling Storage file costs a little quota but
    should never block the user's actual action.
  - `wireAttachmentPicker(ids)` — the shared UI: two buttons ("📷 Take
    Photo" → a hidden `<input type="file" accept="image/*"
    capture="environment">`, which opens the camera directly on mobile;
    "📎 Attach file" → a hidden `<input type="file"
    accept="image/*,application/pdf">` with no `capture` attribute, opening
    the normal file/photo picker, which also covers PDFs since a camera
    obviously can't produce one) plus a preview chip (thumbnail for images,
    filename always) with a remove button. One instance is wired for the
    Add Expenses quick-add form (`quickAddAttachmentPicker` in
    reports-dashboard.js) and a second, independent instance for the
    Modify-bill dialog (`editBillAttachmentPicker` in ledger-ui.js) — same
    function, different element-id sets, since both forms need their own
    picker state.
  - The returned API distinguishes three outcomes the Modify dialog's save
    handler needs to tell apart: **nothing changed** (leave the entry's
    attachment fields alone), **replaced** (`getFile()` returns the new
    File — upload it, then delete the old Storage object only *after* the
    new upload succeeds, so a failed replacement never leaves the bill
    attachment-less), and **explicitly removed with no replacement**
    (`wasExistingRemoved()` — true only when an attachment was present on
    open, nothing new was picked, and the remove button was clicked; this
    is why `hadExisting` is tracked as its own flag rather than inferred
    from whether the preview is currently visible, which alone can't
    distinguish "never had one" from "had one, removed it").
- **Ledger table indicator**: a bill with `attachmentUrl` set shows a small
  📄 (PDF) or 🖼️ (image) link next to its invoice # (`renderTable()` in
  ledger-ui.js), opening the file in a new tab — same cell/pattern as the
  existing 📝 notes indicator, just a real link instead of a tooltip.
- **Deleting a bill deletes its attachment too** — the `tableBody` delete
  handler (reports-dashboard.js) now calls `deleteBillAttachmentByPath()`
  after removing the entry, so attachments don't silently accumulate as
  orphaned Storage objects for bills that no longer exist.
- **Not covered by automated tests the normal way**: Playwright's
  established practice here blocks all `firebase`/`googleapis` network
  calls so tests never touch live production data — but Storage uploads
  have no localStorage fallback the way Firestore writes do, so a blocked
  upload simply fails outright. Verified instead by overriding
  `window.initFirebaseStorage` in the test page to return a fake
  `{ref(path) => {put, getDownloadURL, delete}}` stub, which lets the
  *real* `uploadBillAttachment()`/`compressImageFile()` run (including
  real image compression against a real PNG) while swapping out only the
  one genuinely network-dependent leaf. The real camera-capture flow
  itself (as opposed to the `capture="environment"` attribute being
  present and wired to the right hidden input, which *is* tested) can't be
  exercised from headless Chromium at all and needs a real device to
  confirm end to end.

## Financial year convention
Indian FY: **April → March**. See `fyStartYearForDate()`, `monthsForFY()`,
`fyLabel()`. A "financial year" is labeled by its start year, e.g. FY2026 =
April 2026 → March 2027 = "FY 2026-27".

## Bill entry flow (supplier-first)
1. User picks a **Supplier** from a dropdown (not free text) — this list is the
   shared `suppliers` array.
2. Category/subcategory are **not** shown/chosen per-bill — they auto-fill from
   `supplierDefaults` the moment a supplier is picked, shown as a small hint
   line under the dropdown.
3. New suppliers are added via a "+ new supplier" panel: name + category
   (existing or new) + subcategory (existing or new) — this writes to
   `suppliers`, `categories`, and `supplierDefaults` all at once.
4. If a selected supplier somehow has no category assigned, submission is
   blocked and the "+ new supplier" panel opens pre-filled to fix it.
5. Paid/Unpaid toggle — tinted red/unpaid, green/paid even when inactive (a
   cosmetic fix requested), solid fill when active.

## Sales tracking
Added later — a "Sales for this day" input + Save button near the top totals
strip (LED strip). One number per restaurant per day. Feeds into the Excel
Calendar/Weekly Sales/Analysis sheets (see below) to compare sales vs. purchases.

## Excel export — structure (this took several iterations, get this right)
Two ways to get an Excel file:
- **"Download Excel (FY register)"** — one-off download for a chosen financial
  year (prompts to pick a year if more than one has data).
- **"Link Excel file (auto-update)"** + **"Save to Excel File"** — uses the
  browser's File System Access API (Chrome/Edge desktop ONLY — no Firefox/Safari
  support) to keep an actual `.xlsx` file on disk updated in place. One linked
  file handle **per restaurant, per browser session** (not persisted across
  page reloads — a platform limitation, not a bug: re-linking is needed after
  closing the browser). This variant includes **every financial year** with
  data (`buildFullWorkbook()`), not just one.

Each financial year gets this set of sheets, in this order (see
`buildFYSection`):
1. **`Calendar FY xxxx-yy`** — one row per calendar day of the FY: Date, Day,
   Sales, Purchases, Purchases % of Sales.
2. **`Weekly Sales FY xxxx-yy`** — this layout was reverse-engineered from a
   user-provided screenshot, do not casually change it:
   - Rows cascade **Monday → Sunday**, wrapping through as many consecutive
     weeks as the FY's longest month needs (up to 6 weeks / 42 rows, trimmed to
     only as many rows as actually needed).
   - Each month gets its own **Day-number + Sales** column pair.
   - A day lands on whichever row matches its actual weekday (computed via
     `(new Date(year, month-1, 1).getDay() + 6) % 7` for the 1st-of-month
     offset, then straight sequential rows from there) — so e.g. July's "1"
     might sit 2 rows lower than April's "1" if they start on different
     weekdays. This lets you compare "week 1 Wednesday" across every month on
     one row.
   - Bottom **Total** row sums each month's Sales column.
   - Sunday-row yellow highlight is attempted but may not render (SheetJS CE
     limitation, see above) — row label is in ALL CAPS as a fallback visual cue.
3. **One sheet per month** (`Apr 2026`, `May 2026`, ... `Mar 2027`) — the core
   supplier ledger grid:
   - Rows = suppliers with any bill that month, sorted alphabetically.
   - Columns: **Supplier, Total, 1, 2, 3, ... (day of month)**. Total is the
     **2nd column** (right after Supplier) by explicit user request — "so I can
     get to the total without scrolling."
   - **Total cells are live Excel `SUM()` formulas**, not static numbers — both
     each supplier's row-total and the bottom Total row (per-day column sums
     and the grand total) — so editing a number in Excel recalculates
     correctly. See the `rangeFormula` helper in `buildMonthSheets`.
   - A bottom **Total** row sums every day-column and the Total column.
4. **`Analysis FY xxxx-yy`** — three stacked tables in one sheet: monthly
   Sales vs Purchases vs %, spend-by-category breakdown, and top 20 suppliers
   by spend (each with % of total purchases).

CSV export (`Download CSV`) is a separate, simpler flat export: one row per
bill, all-time, columns Date/Category/Subcategory/Supplier/Invoice/Amount/Status.
Unaffected by the above — kept as a basic detail-level backup format.

## Firestore usage / cost (context, not action items)
At the stated usage (20 entries/day/restaurant × 7 restaurants, ~10
reports/day), this stays comfortably within Firebase's free Spark tier (50k
reads/day, 20k writes/day) even after several years of accumulated data post
the month-bucketing change — this was calculated out in detail in chat if you
need to reference the numbers again (margin was large enough that going from
5-6 to 7 restaurants doesn't meaningfully change the conclusion). No billing
account is needed currently.

## Known limitations / deliberately deferred items
- **No access control at the data layer, despite the login screens.**
  Firestore rules are fully open, and the Firebase config is hardcoded into
  the (public, deployed) HTML file — anyone with the URL can read/write all 7
  restaurants' data directly via the network, regardless of profile/restaurant
  passwords (those only gate the *UI*, not the underlying Firestore data).
  Every password hash (owner + all 6 restaurants) ships in the client-side JS,
  so a determined user can read them via browser DevTools. This was a
  deliberate choice both times (Reports password originally, then the
  profile/restaurant login layered on top) over building real auth +
  restaurant-scoped security rules — the login system is a genuine UI/workflow
  boundary between an owner, a restaurant's manager, and other restaurants'
  managers, not a security control against a determined attacker.
- **Linked Excel file only works in Chrome/Edge desktop** (File System Access
  API). Other browsers fall back to a plain download with an alert explaining
  why.
- **Sunday highlight color in the Weekly Sales sheet may not appear** — SheetJS
  Community Edition doesn't reliably support writing cell fill styles. If this
  becomes annoying, options are: (a) tell the user to add a one-time Excel
  conditional-formatting rule ("text contains SUNDAY" → yellow), or (b) switch
  to a different Excel-writing approach/library that supports styling (bigger
  lift).
- **Incident, 2026-10-02: the live `suppliers`/`supplierDefaults` Firestore
  documents were briefly wiped to empty** by an automated smoke test that
  touched the real production site to verify the Storage upload pipeline. A
  fresh, empty browser profile loaded the real supplier list, added+removed
  a disposable test entry, and saved — if that initial load had any
  hiccup, the in-memory list would have started empty and the save
  overwrote the real one with it. Fully recoverable only because every bill
  stores its supplier name + category directly (never a reference) — all
  245 suppliers were reconstructed by scanning every restaurant's bill
  history and rewritten directly to Firestore, with the app's own
  restaurant-scoped supplier picker (just above) built the same day partly
  *because of* this incident: deriving `supplierUsageIndex` fresh from
  bills every session, never persisting it, is a direct response to having
  just been burned by trusting a derived copy instead of the source of
  truth. Lesson for any future live-site scripted verification: assert the
  real data actually loaded non-empty before performing any save/mutate,
  never assume a fresh page load succeeded.

## File location
As of 2026-08-04, split out of the original single-file design (was one
`vendor-bill-tracker.html` with everything inline) into `app/` — see
`README.md`'s "Project structure" for the full file map. Function names
mentioned throughout this doc (`buildFYSection`, `loadEntries`,
`renderSupplierSelect`, `initFirebase`, etc.) now live in `app/js/*.js`,
grouped by concern rather than all in one script. The split was purely
mechanical — code was cut at existing section boundaries, nothing was
reordered or rewritten — done for editability (the original file had grown
to ~3,400 lines with a 77KB base64 logo embedded as a single line, both of
which made it slow to navigate). Still zero build step: the JS files are
plain global `<script src>` tags, not ES modules, specifically so the app
still opens directly over `file://` for local testing.

## Suggested next steps (not yet requested, just flagged as possible follow-ups)
- Consider whether the Sunday-highlight limitation needs a real fix.
- Consider whether stricter per-restaurant access control becomes necessary as
  usage grows.
- No other open bugs/requests as of this handoff — everything asked for so far
  has been implemented and tested.

## Central Kitchen access update (2026-10-06)
Supersedes the earlier sales and restaurant rules in the section above:
- **Sales are visible** to Central Kitchen, the same as the Owner. The
  `canSeeSalesData()` helper was removed, along with its gates in Add
  Expenses and Reports. Profit and profit % show as well.
- **Add Expenses restaurant selector** (`#expensesRestaurantControl`) is
  shown to Central Kitchen, so it can add bills for any restaurant without a
  password. "Change restaurant" is hidden for it, the same as for the Owner.
  `isRestaurantUnlockedForSession()` now uses `hasElevatedAccess()`, so
  switching restaurants doesn't re-trigger the gate on reload.
- **Verify on sales**: `canVerifySales()` now uses `hasElevatedAccess()`, so
  Central Kitchen verifies sales days like the Owner.
- **Still locked for Central Kitchen**: editing existing bills
  (`canEditExistingRecords()`) and editing existing supplier categories.
  Adding bills, suppliers, and staff entries is unchanged.

Tested in `test_ck_cross_restaurant.js` (switch to another restaurant with no
prompt, add a bill there, verify sales, stay signed in after reload) and the
updated `test_central_kitchen_profile.js`.

## One shared restaurant selector (added 2026-10-06)
Owner and Central Kitchen used to have a separate restaurant picker on each
tab. There is now one selector in the top bar (`#sharedRestaurantSelect`),
which every tab follows.
- Choosing a specific restaurant calls `applySharedRestaurantPick()`
  (ledger-ui.js), which runs `switchRestaurant()`, so `currentRestaurantId`
  moves to that restaurant. Add Expenses, Staff Expenses, Reports, and
  Vendor Ledger all read from it. The staff tab's own `staffRestaurantId`
  selector and its variable were removed.
- "All restaurants" is also an option. It only sets the Reports and Vendor
  Ledger filters to combined data. Add Expenses and Staff Expenses keep the
  last specific restaurant, and a hint next to the selector says which one.
- The choice is stored under `sharedRestaurantPick` in localStorage, so it
  survives a reload, and Logout clears it (`setSharedRestaurantStored(null)`).
- Managers don't get the selector. Their restaurant is fixed by the gate
  and shown as the name in the top bar.

## Stale-write race condition fix + global saving overlay (2026-10-20)
Two real incidents turned out to be the same bug: **"Laxmi Departments"
reverting to a duplicate vendor (2026-10-16)**, and **Al Taqdeer Foods bills
reverting from paid back to unpaid for Umami La Delice (2026-10-20)** — the
user reported the latter ("few bills for al taqdeer chicken were marked as
paid can you tell me why it got reverted back as unpaid for umami?"), which
was diagnosed by reading Firestore directly: Malhaar's Al Taqdeer bills for
Oct 1–14 all shared one `paidAt` batch timestamp (a mark-paid run that
worked); Umami's bills for the same dates were all back to `unpaid` with no
trace of that timestamp (a later save reverted them).

**Root cause**: bills are stored one Firestore document per
restaurant+month (`rest:<id>:bills:<YYYY-MM>`), and several write paths
(`toggleBillStatusByLocation`, `markBillsPaid`, `saveEntries`, …) checked
whether that month was already the one cached in memory
(`billsMonthCache`/`currentBillsMonthCacheKey`) and, if so, mutated that
cached copy directly instead of re-reading from Firestore first. A browser
tab/session that loaded a restaurant+month *before* some other
action/session changed it would still be holding that older snapshot — and
the next time *that* tab saved anything for the same month, it wrote its
whole stale snapshot back over the newer change, silently reverting it.
Exactly this happened to Umami: a session had Umami's October bills cached
before the Payments-tab batch mark-paid ran, then later saved something
else for that restaurant+month and wiped the paid status back out.

**The fix, in `app/js/data-store.js`**:
- `withFreshBillsMonth(key, mutate)` is now the one path every bill-document
  write goes through. It *always* does a fresh `safeGet()` + `JSON.parse()`
  immediately before handing the month object to `mutate`, never reusing
  `billsMonthCache` for a write — only for day-navigation reads, which were
  never the problem. After writing, it resyncs `billsMonthCache` only if the
  key is the month currently being viewed (so same-session day navigation
  stays fast without reintroducing the staleness risk). `mutate` returning
  `undefined` means "nothing to write" (preserves the original
  not-found-skips-the-write behavior of the toggle functions);
  anything else triggers the `safeSet()`.
  `toggleBillStatusByLocation`, `markBillsPaid`, `toggleBillVerifiedByLocation`,
  `moveEntryDate`, and `propagateSupplierEditToAllBills` were all rewritten
  onto this helper.
- **`saveEntries()` needed more than a fresh month fetch.** It writes the
  *whole current day's* bill list from the in-memory `entries` array, and
  that array itself is what's loaded once and kept across edits — a plain
  "fetch the month fresh, then set `month[date] = entries`" still blindly
  replaces the day with this session's possibly-stale copy of *every bill
  in it*, not just the one the user actually touched. (A dedicated
  regression test caught exactly this gap in the first version of the fix —
  see below.) It now does a proper 3-way merge against a new
  `entriesBaseline` snapshot (taken whenever `loadEntries()` loads a day):
  for each bill in the freshly-fetched day, this session's copy wins only
  if it actually differs from the baseline (i.e. was genuinely edited this
  session); otherwise the fresh server copy wins, so a concurrent change
  made elsewhere (like a paid toggle) survives. A bill missing from
  `entries` but present in the baseline was explicitly deleted this session
  and is dropped; a bill in the fresh day that's absent from both is
  someone else's addition since, and is kept. `entries`/`entriesBaseline`
  are then both set to the merged result, so the next `saveEntries()` call
  diffs against what's actually on the server.
- `saveSalesValue()` had the identical flaw (reused `loadSalesMonth()`'s
  cache, overwrote the whole month) — fixed the same way (fetch fresh
  immediately before merging in the day's value), even though it wasn't
  what was reported, since it's the same bug class and cheap to close.
  `toggleSalesVerified()` was checked and was already safe — its loader has
  no caching layer at all.

**Global saving overlay** (`#globalSavingOverlay` in `index.html`,
`showGlobalSaving()`/`hideGlobalSaving()` in `core.js`, styles in
`styles.css`): shown for the duration of every `withFreshBillsMonth()` call
(and `saveSalesValue()`), per the user's request to "pause any other
operations" while a save is in flight — this closes the *same-session*
half of this bug class (a second action starting mid-save and racing it),
where the cross-session half is closed by the fetch-fresh rewrite above.
Reference-counted via `globalSavingDepth` (not a boolean) so a bulk
operation that writes several month-documents in a loop (e.g.
`markBillsPaid` across restaurants) doesn't flicker the overlay open/closed
between iterations — it only hides once the outermost call finishes.

**Testing**: `test_fresh_fetch_race_fix.js` simulates the actual incident —
two independent page sessions (sharing one browser context's storage, so
only `billsMonthCache` differs between them — the actual stale state) both
load the same restaurant+day, session A marks a bill paid, then session B
(still on its pre-change snapshot) saves an unrelated edit for the same
day; the bill A marked paid must survive. The first version of the
`saveEntries()` fix failed this test (client's stale copy of the untouched
bill was winning the merge outright), which is what led to the
`entriesBaseline`-diff refinement above. Also verifies the overlay opens
during a (deliberately slowed) save and closes after. The full existing
suite (payments, vendor ledger, suppliers, verify flags, staff isolation,
sort/filter, attachments, bank transfer, CSV formatting, shared restaurant,
supplier scoping, accountant/Central Kitchen profiles) was re-run after the
`saveEntries()` rewrite and still passes — that function is on the hot path
for every bill add/edit/delete via Add Expenses.

**Deliberately not done**: the Umami Al Taqdeer bills that were actually
reverted in production were **not** re-marked as paid as part of this fix —
the user explicitly scoped this request to the architectural fix only
("just do point number 2"). If raised again, that's a one-off data
correction, separate from this.

## Third tenant (Shree Krishna Palace) + custom Hosting site/target (2026-10-18)
Added as a third tenant under the existing multi-tenant architecture (see
"Multi-tenant architecture" above) — own Firebase project (`expenses-d85ec`,
a different Google account than Pingara's), own `app/tenants/
shree-krishna-palace.js`, own full brand theme and real Owner/Manager/
Accountant logins. Nothing here changes how a tenant's *app* config works;
what's new is **how its hosting URL is chosen**.

Firebase project ids are immutable once created and give a default Hosting
site at `<project-id>.web.app`. The owner didn't want `expenses-d85ec.web.app`
as the live URL. Firebase Hosting supports multiple *sites* per project, so
a second site was created in that same project — `firebase hosting:sites:
create skpexpenses --project expenses-d85ec` — giving `skpexpenses.web.app`.
Pointing a deploy at a non-default site needs a **hosting target**, applied
once per project:
```
firebase target:apply hosting <target-name> <site-id> --project <project>
```
which records the target->site mapping in `.firebaserc` (now has a
`targets` section with one entry per tenant's project). This required
converting `firebase.json`'s `hosting` key from a single object into an
**array**, one entry per tenant, each carrying its own `"target"` — a
target-based entry can't coexist with a bare project-level deploy, so
*every* tenant needed a target applied, not just the new one: `pingara`
and `rktwelve21` simply point at their own existing default site (no URL
change for them), `skp` points at the new `skpexpenses` site. `deploy.sh`
changed from `firebase deploy --only hosting --project $PROJECT` to
`firebase deploy --only "hosting:$TARGET" --project $PROJECT`, with
`$TARGET` added alongside `$PROJECT` in its tenant case statement.

Verified all three tenants' live URLs after this restructuring — including
a real redeploy of Pingara's production site specifically to confirm zero
collateral impact on it, not just a local/staging check. Also: RK
Twelve21's hosting deploy, which had failed on every prior attempt with a
project-access error unrelated to this change, succeeded cleanly during
this same verification pass with no fix applied here — cause unconfirmed,
noted in project memory rather than assumed fixed for good.

## Suggested similar vendors + supplier-creation permission gate (2026-10-18)
Two related requests from the same message: (1) proactively suggest likely
duplicate supplier names (staff had been entering the same real vendor
under different spellings) with a category/subcategory CHOICE when
combining them, in a visually separate area; (2) stop plain Managers from
adding brand-new suppliers at all, restricted to Owner/Central
Kitchen/Accountant going forward.

**Fuzzy matching (`findSimilarSupplierGroups()`, data-store.js)**: tuned
empirically against Pingara's real 275-supplier list via a throwaway
scratch script (not invented thresholds) — two rounds of real false
positives shaped the final design:
1. Generic Indian business-type suffixes ("Enterprises", "Traders",
   "Electricals", "Hardware", "Marketing", ...) are shared by dozens of
   unrelated vendors. Raw token overlap scored "N R ENTERPRISES" vs
   "S D Enterprises" a perfect 1.0 despite being obviously different.
2. Common devotional/auspicious name-prefixes ("Laxmi", "Shri", "Shree",
   "Sai", "Ganesh", ...) are just as widely shared — "Laxmi Electrical" vs
   "Laxmi Departmental Stores" also false-positived at 1.0 on "laxmi" alone.

Both word lists are down-weighted (`SIMILAR_VENDOR_GENERIC_WORDS`) so a
pair only counts as a candidate when it shares something genuinely
distinctive — either an exact non-generic token, a 5-char-prefix stem
match between two non-generic tokens, or a high Levenshtein ratio computed
on each name's "distinctive remainder" (the name with every generic/common
word stripped out — stops a long shared generic suffix from inflating
character-level similarity for two otherwise-unrelated short prefixes).
Threshold 0.80 is where the real data's good matches cluster; below
roughly 0.75 it's dominated by coincidentally-similar-shaped short Hindi
names ("Shriram"/"Shivam"/"Shivaay"/"Sairam") that aren't actually related.
Validated end to end against real data (not just the scoring function) —
the union-find grouping correctly clustered multi-way matches like
"Incentive"/"INCENTIVE"/"insentive"/"Insentive" into one group, 28 of 29
groups were genuine matches, one borderline false positive remained
("Disha Marketing" vs "isha electricals") — acceptable since this is a
human-reviewed suggestion, not an auto-merge.

**UI**: a new "Suggested Similar Vendors" section (`#supSimilarSection`,
suppliers-tab.js) at the top of the Suppliers tab — not a new top-level app
tab, since this is thematically a proactive front-end to the EXISTING
combine-duplicates tool, not a separate workflow; made deliberately
prominent (not nested behind a "+" expand link like bulk-edit/combine
themselves) to read as a clearly separate area, per the explicit ask.
Scan-on-demand (tab open, or "rescan" link), same pattern as
`findOrphanSupplierNamesInBills()`'s own on-demand scan it reuses as part
of the candidate pool. Each suggested group's "Combine these" button
pre-selects those names into `supCombineSelected` and opens the existing
combine tool rather than duplicating its merge logic.

**Category/subcategory now a real choice, not an auto-pick** (the second
half of the same request): the combine bar gained a category select +
subcategory input (`#supCombineCatSelect`/`#supCombineSubInput`),
pre-filled with the same "exact name match wins, else first checked" rule
the tool always used internally (`deriveCombineCategoryDefault()`) as a
sensible starting point, but now editable — `supCombineConfirmBtn`'s
handler reads the final values from these fields instead of silently
deriving them. A `supCombineCatInitialized` flag (mirrors the existing
name-input pattern) makes sure the default only sets once per combine
session, so re-rendering after a checkbox toggle doesn't clobber a choice
the user already made.

Gated behind `canEditExistingRecords()`, same boundary the combine tool
itself already has — Central Kitchen/Accountant can't act on a suggestion
any more than they can use the combine tool directly, so the whole section
is hidden for them too rather than showing suggestions with no action
available.

**New-supplier permission gate**: the ONE place a plain Manager could
previously add a brand-new supplier was the "Manage Suppliers" modal
reachable from the Add Expenses toolbar (`saveSupplierBtn`,
reports-dashboard.js) — the Suppliers tab's own add form and the combine
tool's own supplier creation were already elevated-only, since the whole
Suppliers tab is hidden from plain Managers (`tabBtnSuppliers` visibility
in auth.js). That one path is now gated behind `hasElevatedAccess()`, with
a clear alert naming Central Kitchen/Owner when a Manager tries to add a
name that doesn't already exist, plus a proactive note in the modal itself
so a Manager isn't surprised only after filling the form. **Deliberately
narrow**: a Manager can still set/fix the category on an EXISTING
uncategorized supplier through the exact same form (the `alreadyExisted`
branch is untouched) — that's completing data for a supplier that already
exists, not adding a new one, and wasn't part of what was asked to be
restricted.

This is shared `app/js` code, so it applies to every tenant uniformly, not
just Pingara — RK Twelve21 (no Central Kitchen/Accountant at all) and
Shree Krishna Palace (Accountant only, no Central Kitchen) both lose
Manager-level supplier creation too, leaving only their Owner (and SKP's
Accountant) able to add a brand-new supplier going forward.

Verified via a dedicated 17-check Playwright test (seeded near-duplicate
suppliers, confirmed grouping/exclusion, confirmed the combine bar's
chosen category — not the auto-derived one — is what actually gets saved,
confirmed Manager is blocked while still able to categorize an existing
supplier, confirmed Central Kitchen is both excluded from suggestions and
still able to add new suppliers) plus the full existing supplier/
permission regression suite (189 checks across 10 files, zero failures).

## Dismiss suggestions + Shree Krishna Palace supplier-creation exemption (same day, follow-up)
Two more asks on the feature above. **"Not the same vendor"** dismiss
button on each suggestion card: `dismissSimilarVendorGroup()` (data-store.js)
marks every pairwise combination within that group's names as dismissed
(a 3+-member group dismisses as one unit via its own card, not one click
per pair), keyed by `dismissSimilarVendorPairKey()` -- an order-independent
key built from `svNormalize()`, not the raw name, so a later rename of
either name doesn't silently un-dismiss a pair already reviewed.
Persisted (`dismissedSimilarVendorPairs`, a new shared account-wide key,
loaded at init alongside the other supplier state) so it survives a
rescan AND a fresh session, not just hidden client-side for the current
page load. `findSimilarSupplierGroups()` checks a `Set` of dismissed keys
before ever unioning a pair, so a dismissed pairing simply never
re-qualifies on a future scan; it doesn't block either name from
independently matching some OTHER name strongly enough to surface its own
suggestion.

**Shree Krishna Palace supplier-creation exemption**: the new-supplier
restriction two sections up was explicitly requested as a Pingara
change, but it's shared `app/js` code, so it silently applied to every
tenant -- flagged to the user after shipping, and they asked for it back
specifically for Shree Krishna Palace ("give everyone rights to add
suppliers"). Rather than a one-off special case, generalized the gate
itself into `canAddNewSuppliers()` (core.js): `hasElevatedAccess()` OR an
optional per-tenant `TENANT_ALLOW_ALL_SUPPLIER_CREATION` flag, the same
"undefined for Pingara/RK Twelve21, explicitly set where it diverges"
pattern `TENANT_THEME`/`TENANT_ACCENT` already established for branding.
Set `true` in `app/tenants/shree-krishna-palace.js`; Pingara/RK Twelve21
don't define it, so they keep the restriction. Both the actual gate
(reports-dashboard.js's `saveSupplierBtn` handler) and the proactive
"ask Central Kitchen/Owner" note (suppliers-ui.js) now go through this
one helper instead of checking `hasElevatedAccess()` directly, so they
can never drift out of sync with each other per tenant.

Verified via two dedicated test files: dismiss (seed a pair, confirm it
suggests, dismiss it, confirm it's gone immediately AND after an explicit
rescan AND in a brand-new session -- real persistence, not an in-memory
hide) and the SKP exemption (Manager there can add a new supplier and
doesn't see the restriction note; Pingara's own Manager is unaffected,
re-confirmed as a regression check on the `canAddNewSuppliers()`
refactor). Plus the full existing supplier/permission suite again,
zero failures.

## Which restaurant orders from a supplier, shown wherever a supplier is listed (same day, follow-up)
No new data needed — `supplierUsageIndex` (built by `buildSupplierUsageIndex()`,
already existed to scope the Add Expenses supplier dropdown per
restaurant, 2026-10-02) already maps every supplier name to the set of
restaurant ids that have actually billed it. `supplierRestaurantLabel(name)`
(data-store.js) just reads that same index and turns it into a small
display string (restaurant labels joined, or "Not billed yet" for a
supplier with no usage anywhere) — works for an orphaned name too, not
just directory suppliers, since `buildSupplierUsageIndex()` indexes every
bill's supplier field regardless of whether it's in the directory.

Wired in everywhere a supplier row is actually rendered: the shared
`buildManageSupplierRow()` (suppliers-ui.js, covers both the Manage
Suppliers modal and the Suppliers tab list in one place), the Suggested
Similar Vendors pills, and the combine-duplicates orphan rows. New
`.msr-restaurants` CSS class — small (10.5px), muted, deliberately not
competing with the name/category for attention, per the explicit "ok even
if small font" ask. Left out of the Add Expenses supplier `<select>`
dropdown itself (a native `<option>` can't carry secondary styled text)
and Vendor Ledger/Payments (which already show their own per-restaurant
breakdown in "All restaurants" mode, a different, pre-existing mechanism).

On the Suggested Similar Vendors pills specifically, this label is more
than decoration — it's actual evidence for the judgment call the section
exists to support: two spellings billed by *different* restaurants
supports "same vendor, two managers, two spellings"; both billed by the
*same* restaurant looks more like a stray typo than a cross-restaurant
naming drift.

**Background-load correctness fix, surfaced by this change**:
`loadSupplierUsageIndex()` (init.js) has always run non-blocking after the
initial render (a full cross-restaurant bill scan, deliberately not
delaying app load) and previously only triggered a dropdown re-render on
completion. Now that the index also drives DISPLAYED text instead of just
a dropdown filter, a view opened in that brief window (Suppliers tab,
Manage Suppliers modal) could have shown a misleading "Not billed yet" for
a supplier that's actually billed plenty, just not indexed yet.
Closed by also re-rendering both those lists when the index load
resolves — harmless no-op if neither happens to be open.

Verified via a dedicated 6-check Playwright test (two restaurants billing
the same supplier shows both labels, an unbilled supplier shows "Not
billed yet", both the modal and the Suppliers tab list agree, a
suggestion pill carries the label too) plus the existing supplier/
permission regression suite again (108 checks across 8 files), zero
failures.
