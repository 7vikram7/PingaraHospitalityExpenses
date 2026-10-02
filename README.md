# Vendor Bill Ledger

A web app for tracking daily vendor bills (expenses) and sales across
multiple restaurants, with Excel/CSV exports and a cross-restaurant spend
dashboard. No build step, no framework — plain HTML/CSS/JS split into a
handful of files by concern, backed by Firebase Firestore, deployed on
Firebase Hosting.

**Live app:** https://vendor-bills.web.app

## Features

- **Login: Owner or Manager profile** — Owner enters one password and gets
  every tab and every restaurant; Manager picks a restaurant and enters
  *that restaurant's* password, and only ever sees the Add Expenses tab.
  Persists across closing the browser/tab, backgrounding, or reopening from
  the home screen — since most use is on mobile, staying logged in matters
  more than re-prompting on every app switch. The only way back to the
  login screens is the explicit **Logout** button.
- **Installable as a mobile app** — manifest.json + iOS meta tags let you
  "Add to Home Screen" on Android/iPhone and it opens full-screen, no
  browser chrome, with its own icon. Layout (tab bar, stat rows, tables)
  is built for phone widths, not just scaled-down desktop.
- **Desktop view toggle** — an in-app button next to Logout that renders
  the full desktop layout (all Vendor Ledger columns, etc. at once) scaled
  to fit the phone screen, for when a wide table is easier to read zoomed
  out than scrolled sideways. Works the same from an installed home-screen
  app too, where a browser's own "Request desktop site" menu isn't
  available. A device preference, not login state — survives Logout.
- **Supplier-first bill entry** — pick a supplier, its category/subcategory
  auto-fills from a saved default, with an optional free-text Notes field.
  **Invoice # is required**; attaching a photo or PDF of the bill is
  optional — "Take Photo" opens the camera directly, "Attach file" opens
  the normal file/photo picker (also accepts PDFs). Photos are downscaled
  client-side before upload to keep it fast on restaurant wifi/mobile data.
  A bill with an attachment shows a small 📄/🖼️ icon next to its invoice #
  in the ledger, linking straight to the file.
- **Supplier picker is scoped to the restaurant you're on** — the shared
  supplier list and categories are still account-wide (see Suppliers tab
  below), but the dropdown only shows suppliers *this* restaurant has
  actually billed before, so a manager isn't scrolling past every other
  location's vendors. A newly-added supplier with no bills yet shows
  everywhere until its first bill narrows it down to wherever it was
  actually used.
- **Restaurant lock** — confirm one restaurant before anything else is
  editable, so a stray tap can't misattribute a bill to the wrong restaurant
- **Modify a bill** — freely editable for 1 hour after it's added; after
  that, a Manager needs the owner password, an Owner never does. Category/
  subcategory always follow the supplier's default and aren't directly
  editable; the date can be changed, moving the bill to a different day.
  The attachment can be added, replaced, or removed here too, not just at
  the moment the bill is first created.
- **Daily sales tracking** alongside purchases, with the same 1-hour-then-
  password rule once a day's figure has been saved
- **Reports tab** (Owner only): a spend dashboard (by restaurant, by
  category, Day/Month/Date-range toggle) plus Excel/CSV export — including
  a live-linked `.xlsx` file (Chrome/Edge desktop only) and a full
  financial-year register (Apr–Mar, Indian FY convention). Also shows a
  plain "spend by category" table (amount + % of sales) and Profit %
  alongside the chart, and a "Compare months" mode — pick any two months
  to see them side by side, each with its own Sales/Expenses/Profit/
  Profit % and category breakdown. The category table (and Total Expenses/
  Profit above it) always reflects every bill in scope, even for a
  restaurant/period with no sales figure logged — only the chart itself
  needs a sales number to plot. Click a category row to expand it and see
  its subcategories with their own amounts/percentages (accordion, one
  open at a time, independent per column in Compare-months)
- **Vendor Ledger tab** (Owner only): bills grouped by supplier instead of
  by day, across all restaurants or one, for a day, month, or custom date
  range. Click a vendor to expand its individual bills (date, invoice #,
  amount, paid/unpaid) and flip paid status right there, with the paid
  date recorded alongside it
- **Suppliers tab** (Owner only): every supplier with its category/
  subcategory, shared across every restaurant on the account, plus adding
  new ones. Editing a supplier's category/subcategory here retroactively
  updates every past bill logged under that supplier too, not just new ones
- **Staff Expenses tab** (Owner, or Manager for their own restaurant only;
  named "Staff OT & Salary" until 2026-10-02): a staff directory per
  restaurant — name, employee ID/code, designation, department, gender,
  mobile number, bank name, bank branch, account number, IFSC code, and a
  default monthly salary — with bank name/branch/IFSC remembered
  account-wide so the next employee is a pick, not a retype. Add one at a
  time or bulk-upload a CSV/Excel list; the downloadable template matches
  an existing payroll-system export format (`Code*`, `Employee Name*`,
  `Mobile No*`, `Gender*`, `Department Name*`, `Designation Name*`, etc.)
  so a file already maintained elsewhere can be dropped in with no
  reformatting. The directory list sits directly above "Add a new
  employee" at the bottom of the tab.
  **OT, Captain Incentive, Waiter Tips, and Staff Advance** are four
  separate lists sharing one date — each its own add-form and table, a
  flat amount per employee per entry (not hours × rate). None of them
  track a paid/unpaid status — that concept doesn't exist anywhere in this
  tab. OT, Captain Incentive, and Waiter Tips only offer employees who've
  been explicitly added to *that* list — not every restaurant employee
  needs OT, or is a captain, or is a waiter — via a "Manage employees in
  this list" control right there in the section (pick from the
  restaurant's full staff directory, no limit on how many lists one
  employee belongs to). This never creates a new employee, only
  assigns/unassigns an existing one — the directory's own add form or bulk
  upload is still the one place a new employee is actually created. Staff
  Advance is the one exception — it has no such list/roster at all, since
  any employee can take an advance; its dropdown always offers everyone
  currently in the directory, with nothing to assign first. Each list can
  also be **submitted** independently for
  the day — "Submit OT for this day" etc. — which locks it permanently for
  the Manager profile (no more adding, editing, or deleting entries for
  that list/date); the Owner profile is never restricted and is the only
  way to make a further change to a submitted list, with no in-app
  "unlock" step. Each restaurant's staff list, daily entries, list
  memberships, submission status, and salary records are fully independent
  of every other restaurant's — switching the restaurant selector never
  carries data over.
  A **combined report** downloads a payment-ready CSV for a date range —
  one row per employee with their bank name/branch/account/IFSC plus
  OT/Incentive/Tips totals for processing actual payouts (Staff Advance
  isn't part of this report — an advance is money already given, not a
  payout to calculate). Monthly salary tracking also exists (pre-filled
  from each employee's default, editable per month) but its section is
  currently hidden from the UI (not removed — just not needed right now).
- **Offline-first**: every write lands in `localStorage` immediately and
  syncs to Firestore in the background, so a flaky connection never blocks
  data entry

## Tech stack

| Piece | Choice |
|---|---|
| UI | Plain HTML/CSS/JS — no framework, no bundler |
| Data | Firebase Firestore (config is hardcoded — this app intentionally has no "connect to a different project" UI) |
| Files | Firebase Storage — bill attachment photos/PDFs only; everything else stays in Firestore |
| Hosting | Firebase Hosting |
| Excel export | [SheetJS](https://sheetjs.com/) via CDN |

## Running locally

Nothing to build or install. Either open `app/index.html` directly in a
browser (plain `<script src>`/`<link>` tags, so relative paths resolve fine
over `file://`), or serve the folder so relative behavior matches production:

```
cd app && python3 -m http.server 8000
```

## Deploying

```
firebase deploy --only hosting --project vendor-bills
```

The `predeploy` step in `firebase.json` mirrors the whole `app/` folder into
`public/` (gitignored — regenerated on every deploy). That isolated
`public/` folder is the *only* thing Firebase Hosting ever uploads, by
design: nothing else in this repo, or anywhere else on the machine this is
deployed from, can end up on the live site by accident. Adding a new file to
`app/` gets it deployed automatically — no changes to `firebase.json` needed.

`firestore.rules` and `storage.rules` are **not** part of `deploy.sh`'s
routine hosting deploy — they rarely change, so they're deployed as their
own one-off command, per project, whenever they actually do:
```
firebase deploy --only firestore:rules,storage --project <project>
```

## Project structure

```
app/
  index.html               markup + tab/modal structure
  styles.css                all CSS
  logo.png                  Pingara Hospitality logo (was inline base64, extracted for readability)
  manifest.json             PWA manifest (active tenant's copy — see tenants/ below)
  icon-192.png, icon-512.png  home-screen icons (active tenant's copy)
  tenants/
    <tenant>.js               branding/restaurant list/Firebase config/passwords
    <tenant>-manifest.json     PWA manifest, per tenant (app name, theme color)
    <tenant>-icon-192.png,
    <tenant>-icon-512.png      home-screen icon, per tenant
  js/
    core.js                 constants, app state, Firebase config/init, date/money utils
    excel-export.js         CSV/Excel export, live-linked spreadsheet sync
    data-store.js           safeGet/safeSet + category/supplier/bill/sales persistence
    attachments.js          bill photo/PDF upload to Firebase Storage, shared picker UI
    suppliers-ui.js         supplier dropdown, Manage Suppliers modal
    ledger-ui.js             ledger table/totals rendering, restaurant select, Modify-bill dialog
    reports-dashboard.js     Reports tab password gate, tab switching, sales/expense charts
    vendor-ledger.js         Vendor Ledger tab — per-supplier spend by restaurant/period
    suppliers-tab.js         Suppliers tab — list/add suppliers, retroactive category fixes
    staff-tab.js             Staff OT & Salary tab — staff directory, bulk upload, daily OT, monthly salary
    auth.js                  login: Owner/Manager profile choice, per-restaurant passwords
    init.js                  app bootstrap — loaded last, after every other module
firebase.json               Hosting config + the predeploy sync step
firestore.rules              Firestore security rules (deliberately open, see below)
storage.rules                 Storage security rules (same tradeoff, see below)
.firebaserc                 Firebase project id (vendor-bills)
CONTEXT.md                  architecture notes, data model, design decisions, known limitations
```

The JS files are loaded as plain global `<script src>` tags (not ES
modules) — deliberately, so `file://` still works for local testing/dev.
That means they all share one global scope, same as when it was one file;
the split is about navigability for whoever (human or Claude) is editing
this, not encapsulation. `js/init.js` must stay loaded last since it's the
only file with code that runs immediately on load rather than waiting for
an event.

For the deeper "why" — the Firestore key layout and why it's month-bucketed,
the Excel export sheet structure, the financial-year convention, and a
running list of known limitations — see [`CONTEXT.md`](./CONTEXT.md).

## Data & security notes

- **Firestore security rules are fully open** (`allow read, write: if true`)
  — a deliberate simplicity-over-access-control tradeoff, not an oversight.
  Anyone with the deployed URL can read/write all restaurants' data over the
  network. See `CONTEXT.md` for the reasoning and what a stricter setup
  would require.
- **Storage security rules are equally open** (`storage.rules`, same
  `allow read, write: if true`) — bill attachment photos/PDFs carry the
  same tradeoff. A download URL is an unguessable long token, but anyone
  who obtains one (e.g. it leaks via a shared screenshot) can view that file
  indefinitely; there's no per-file expiry or access revocation.
- **Every password (owner, all 7 restaurants) is a UI deterrent, not access
  control.** All client-side SHA-256 comparisons in a static file with no
  backend — they gate what the UI shows, not what's reachable over the
  network. See `CONTEXT.md`'s "Login" and "Known limitations" sections.
- **Staff bank account numbers and IFSC codes carry the same open-Firestore
  exposure as everything else** — see the point above. This is real
  financial PII, more sensitive than anything else this app stores; the
  tradeoff was made consciously for this feature too, not overlooked.
- Real reports, exports, and any restaurant-specific data are intentionally
  **not** in this repo.

## License

Private/internal project — no license granted for reuse.
