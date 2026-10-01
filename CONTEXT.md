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
auth.js): a Manager only ever sees the "Add Expenses" tab button — Reports
and Vendor Ledger buttons are `display:none`, not just password-gated, so
they're not just locked but not even visible. An Owner sees all three.

**"Once the owner logs in, no other passwords are required" applies
app-wide**, not just to the tabs — `billWithinModifyWindow()` (core.js) and
`salesWithinModifyWindow()` (ledger-ui.js) both short-circuit true for an
owner session, so the Modify-bill and sales-edit admin-password prompts
(see "Modify a bill" below) never appear for an owner, even on data older
than the 1-hour window. A Manager still sees those prompts normally — that's
a per-action escalation (type the owner password to override just this one
edit), a separate concept from the profile login itself, deliberately left
as-is.

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
  - **Editing a supplier's category/subcategory retroactively updates every
    past bill logged under that supplier** — not just new ones — across
    every restaurant and every month, not just the current one. This is the
    one genuinely new piece of logic (`propagateSupplierCategoryToAllBills()`
    in data-store.js): it discovers every `rest:*:bills:*` month-document
    key across every restaurant (`listAllRestaurantsBillMonthKeys()`, a
    broad-prefix Firestore range query on `"rest:"` rather than one
    restaurant's own prefix), loads each one that isn't already cached,
    rewrites `category`/`subcategory` on every bill matching the supplier
    (matched via `supplierKey()`, same case/whitespace-insensitive
    normalization `supplierDefaults` itself uses), and only writes back the
    documents that actually changed. Runs from `buildManageSupplierEditForm`'s
    save handler whenever the category/subcategory actually changed, so it
    also fires from the old Manage Suppliers modal, not just this tab —
    edited from either surface, behavior is identical. Does **not** touch a
    bill's `supplier` name field if the supplier was also renamed in the
    same edit — same as before, a rename doesn't reach into history, only
    category/subcategory do now.
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
  - **Combined OT/Incentive/Tips report** (added 2026-10-02,
    `downloadStaffCombinedReport()`) — a From/To date-range picker plus an
    "Unpaid entries only" checkbox (checked by default — the common real
    case is "what do I still owe," not a full historical record) above a
    "Download combined report (CSV)" button. Scans `rest:<id>:ot:<YYYY-MM>`
    across every month the range touches (`monthsBetween()`, reused from
    vendor-ledger.js), sums each employee's OT/Captain Incentive/Waiter
    Tips separately (respecting the unpaid-only filter), then joins that
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
  - **Monthly salary** (`rest:<id>:salary:<YYYY-MM>` →
    `{employeeId: {employeeName, amount, status, paidAt}}`, one entry per
    employee per month, not an array) — every *current* staff member gets a
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
  - **Account numbers are masked in the list view** (`maskAccountNumber()`
    — last 4 digits only, `••••1234`) as a shoulder-surfing precaution on a
    phone in a shared kitchen/restaurant setting; full digits are still
    shown (and editable) inside the per-employee edit form. This is a UX
    nicety, not real protection — see the open-Firestore-rules caveat
    below, same as everywhere else in this app.
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
