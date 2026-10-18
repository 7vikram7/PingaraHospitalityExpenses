// TENANT CONFIG — Shree Krishna Palace.
// This file is the source of truth; app/tenant.js (loaded by index.html) is a
// copy of whichever tenant is currently active. See deploy.sh.
//
// LIVE since 2026-10-18 at https://expenses-d85ec.web.app.
const TENANT_BRAND_NAME = "Shree Krishna Palace";
const TENANT_EYEBROW = "Daily Purchase Register";
const TENANT_LOGO = "logo.png"; // app/tenants/shree-krishna-palace-logo.png, swapped in by deploy.sh
const TENANT_TITLE = "Vendor Bill Ledger";

// Full brand theme (2026-10-18, extended from an earlier accent-only
// version), derived from the two colors actually sampled off the
// restaurant's letterhead PDF -- teal #166B5E (triangle emblem fill) and
// gold #F7C57F (feather lines/peacock) -- everything else below is computed
// from those two (darken/lighten/desaturate), not independently chosen, to
// stay a coherent single palette. Optional per-tenant override of the app's
// shared styles.css :root variables (see applyTenantBranding() in init.js);
// Pingara/RK Twelve21 don't define TENANT_THEME, so they keep the app's
// default palette untouched. Deliberately leaves out --green/--red/
// --margin-red/--led-green/--led-red -- those are functional paid/unpaid
// status colors, not brand chrome.
const TENANT_THEME = {
  ink: "#115349",        // primary text/borders -- darker teal (78% brightness)
  inkSoft: "#4F7D75",     // secondary/muted text -- lighter, desaturated teal
  paper: "#FBF6EC",       // card/panel background -- near-white warm cream
  paperDark: "#F0EBE1",   // body background -- one step down from paper
  paperLine: "#DDBD91",   // dividers/borders -- muted gold-tan
  accent: "#166B5E",      // primary buttons/links -- brand teal
  accentDeep: "#0F4940",  // button hover/pressed -- darker teal
  accentLight: "#F7C57F", // selection highlight -- brand gold
  ledBg: "#082521",       // dark stat-bar panel -- deep teal-black
  ledDim: "#5C8982",      // dim/inactive stat-bar text -- muted teal
  ledAmber: "#F7C57F"     // stat-bar highlight figures -- brand gold (was amber)
};

// Single location, per owner's choice -- one restaurant entry covers it.
// "accountant" (added 2026-10-18) is the same elevated-non-owner-profile
// trick Pingara uses -- isAccountantProfile() in core.js matches purely on
// this restaurant id, so adding the entry (+ its own password hash below)
// is the whole implementation; no other code changes needed.
const TENANT_RESTAURANTS = [
  { id: "shree-krishna-palace", label: "Shree Krishna Palace" },
  { id: "accountant",           label: "Accountant" }
];

const TENANT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDE0JwpKtTR4V19h03cVJHBkYWxFZnKznw",
  authDomain: "expenses-d85ec.firebaseapp.com",
  projectId: "expenses-d85ec",
  storageBucket: "expenses-d85ec.firebasestorage.app",
  messagingSenderId: "938956221494",
  appId: "1:938956221494:web:49f43ff635f1815e3d7c97"
};

// Real passwords, set 2026-10-18 (replacing the earlier shared placeholder).
// sha256 hex digests, computed locally via Node -- plaintext was given
// directly in chat, never written to any file, same convention as every
// other password in this project.
const TENANT_REPORTS_PASSWORD_HASH = "7733e51bf8fe15a526128418a6f81259f11e5578d22841a53514ac2ca20d7ceb"; // Owner: skppancharatna@9090

const TENANT_RESTAURANT_PASSWORD_HASH = {
  "shree-krishna-palace": "c3f73c5e2fc2761c4d3151088f4421357003859d9fae682cedd6f86d728414f4", // Manager: skp@9090
  "accountant":           "9f91ab721aaf19ea195afe1d3e0166226145a4df20fd51931580a8ae7a3fad53"  // Accountant: pancharatna@9090
};

// Opts OUT of the app-wide "only Owner/Central Kitchen/Accountant can add a
// new supplier" restriction (added 2026-10-18 for Pingara) -- explicit
// owner request the same day: "give everyone rights to add suppliers" for
// this tenant specifically. See canAddNewSuppliers() in core.js. Pingara/RK
// Twelve21 don't define this, so they keep the restriction.
const TENANT_ALLOW_ALL_SUPPLIER_CREATION = true;
