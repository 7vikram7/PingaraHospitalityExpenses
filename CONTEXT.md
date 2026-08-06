# Vendor Bill Ledger — Project Context

## What this is
A static HTML/CSS/JS web app (`app/`, see "File location" below) used to track
daily vendor bills (expenses) across 6 restaurants, log daily sales, and
generate Excel/CSV reports. No build step, no backend server — plain files
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
    `{ "<date YYYY-MM-DD>": [ {id, category, subcategory, supplier, invoice, amount, status, paidAt, createdAt}, ... ], ... }`.
    `paidAt` (added 2026-08-05) is a timestamp set whenever `status` becomes
    `'paid'` (at creation if added already-paid, or via either toggle path
    below) and cleared back to `null` on `'unpaid'` — not a history log, just
    "when did this bill *most recently* become paid."
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
before. Session-scoped (`sessionStorage`), so it re-prompts on every fresh
browser session, matching how the Reports-tab password already behaved.

Screens (all in `index.html`, siblings before `#appTabsWrap`):
1. **`#profileGate`** — "Who's logging in?" Owner or Manager.
2. **`#ownerLoginGate`** (Owner only) — one password, SHA-256-compared against
   `REPORTS_PASSWORD_HASH` in `core.js` — **the same hash the Reports tab
   already used**, reused deliberately so the owner has one password, not two.
   Success sets `sessionStorage.profileType = 'owner'` and *also* sets the
   Reports tab's own unlock flag (`reportsUnlockedSession`), so Reports and
   Vendor Ledger open with no further prompt.
3. **`#restaurantGate`** (existing screen, extended) — pick a restaurant, then
   Continue. For a **Manager**, a password field appears and is checked
   against `RESTAURANT_PASSWORD_HASH[restaurantId]` in `core.js` (one hash per
   restaurant — a manager only knows their own restaurant's password, so this
   is a practical boundary between locations even though Firestore itself
   doesn't enforce it). For an **Owner**, no password field — Continue alone
   confirms, for *any* restaurant. Either way, confirming sets
   `sessionStorage.unlockedRestaurantId` to that restaurant, which is what
   `isRestaurantUnlockedForSession()` (core.js) checks on every reload to
   decide whether to show the gate again or go straight to the app —
   deliberately **not** short-circuited by owner status alone, so the owner
   still clicks through this step once per session too (same "prevents an
   accidental restaurant switch" purpose the gate always had).
4. Main app — `restaurantConfirmedBar` gets a second button, **"Switch
   profile"**, alongside the existing "Change restaurant" — clears both
   session flags and returns to `#profileGate`.

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

## Tab structure (Add Expenses added first; Reports added 2026-07-31; Vendor
## Ledger added 2026-08-05)
Three tab panels, switched by `.tab-bar` buttons (`tabBtnExpenses` /
`tabBtnReports` / `tabBtnLedger`) via `switchTab()` in reports-dashboard.js:
- **"Add Expenses"** (`#tabPanelExpenses`, default/active tab) — restaurant
  selector (shared above all tabs, in `.restaurant-context-bar`), date nav,
  history panel, LED totals, sales input, the supplier-first quick-add form,
  and the ledger table. The only tab a Manager profile ever sees.
- **"Reports"** (`#tabPanelReports`) — the sales-vs-expenses dashboard plus
  everything for generating/exporting Excel or CSV: `syncBtn` (Link Excel
  file), `downloadCsvBtn`, `downloadExcelBtn`, and `saveSpreadsheetBtn` (Save
  to Excel File), plus their shared `save-bar` note. Gated behind a
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
  - **Click a vendor row to expand it** (`vlExpandedVendors`, a Set of vendor
    names, tracks which rows are open — persists across the re-render a
    status toggle triggers, but is cleared whenever the restaurant/period
    filter changes) into a nested per-bill table: date, restaurant (only in
    "All restaurants" mode), invoice #, amount, a clickable paid/unpaid
    `.badge` button, and the paid date. Toggling status here calls
    `toggleBillStatusByLocation()` (data-store.js) rather than mutating the
    `entries` array directly, since the bill may belong to a different
    restaurant/date than whatever's currently active in the Add Expenses tab
    — it reuses the month cache when it happens to be the same
    restaurant+month, otherwise fetches fresh, and syncs the live `entries`
    array too if it is the same day currently being viewed there.

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
At the stated usage (20 entries/day/restaurant × 5-6 restaurants, ~10
reports/day), this stays comfortably within Firebase's free Spark tier (50k
reads/day, 20k writes/day) even after several years of accumulated data post
the month-bucketing change — this was calculated out in detail in chat if you
need to reference the numbers again. No billing account is needed currently.

## Known limitations / deliberately deferred items
- **No access control at the data layer, despite the login screens.**
  Firestore rules are fully open, and the Firebase config is hardcoded into
  the (public, deployed) HTML file — anyone with the URL can read/write all 6
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
