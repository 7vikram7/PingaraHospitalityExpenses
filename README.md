# Vendor Bill Ledger

A web app for tracking daily vendor bills (expenses) and sales across
multiple restaurants, with Excel/CSV exports and a cross-restaurant spend
dashboard. No build step, no framework — plain HTML/CSS/JS split into a
handful of files by concern, backed by Firebase Firestore, deployed on
Firebase Hosting.

**Live app:** https://vendor-bills.web.app

## Features

- **Supplier-first bill entry** — pick a supplier, its category/subcategory
  auto-fills from a saved default
- **Restaurant lock** — a manager confirms one restaurant before anything
  else is editable, so a stray tap can't misattribute a bill to the wrong
  restaurant
- **Daily sales tracking** alongside purchases
- **Reports tab** (password-gated): a spend dashboard (by restaurant, by
  category, Yesterday/Month-to-date toggle) plus Excel/CSV export —
  including a live-linked `.xlsx` file (Chrome/Edge desktop only) and a
  full financial-year register (Apr–Mar, Indian FY convention)
- **Offline-first**: every write lands in `localStorage` immediately and
  syncs to Firestore in the background, so a flaky connection never blocks
  data entry

## Tech stack

| Piece | Choice |
|---|---|
| UI | Plain HTML/CSS/JS — no framework, no bundler |
| Data | Firebase Firestore (config is hardcoded — this app intentionally has no "connect to a different project" UI) |
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

## Project structure

```
app/
  index.html               markup + tab/modal structure
  styles.css                all CSS
  logo.png                  Pingara Hospitality logo (was inline base64, extracted for readability)
  js/
    core.js                 constants, app state, Firebase config/init, date/money utils
    excel-export.js         CSV/Excel export, live-linked spreadsheet sync
    data-store.js           safeGet/safeSet + category/supplier/bill/sales persistence
    suppliers-ui.js         supplier dropdown, Manage Suppliers modal
    ledger-ui.js             ledger table/totals rendering, restaurant select + gate
    reports-dashboard.js     Reports tab password gate, tab switching, sales/expense charts
    init.js                  app bootstrap — loaded last, after every other module
firebase.json               Hosting config + the predeploy sync step
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
- **The Reports tab password is a UI deterrent, not access control.** It's
  a client-side SHA-256 comparison in a static file with no backend — it
  hides the download buttons from casual use, nothing more.
- Real reports, exports, and any restaurant-specific data are intentionally
  **not** in this repo.

## License

Private/internal project — no license granted for reuse.
