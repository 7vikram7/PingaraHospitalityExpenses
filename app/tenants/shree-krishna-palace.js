// TENANT CONFIG — Shree Krishna Palace.
// This file is the source of truth; app/tenant.js (loaded by index.html) is a
// copy of whichever tenant is currently active. See deploy.sh.
//
// LIVE since 2026-10-18 at https://expenses-d85ec.web.app.
const TENANT_BRAND_NAME = "Shree Krishna Palace";
const TENANT_EYEBROW = "Daily Purchase Register";
const TENANT_LOGO = "logo.png"; // app/tenants/shree-krishna-palace-logo.png, swapped in by deploy.sh
const TENANT_TITLE = "Vendor Bill Ledger";

// Brand accent colors, sampled directly from the restaurant's letterhead PDF
// (triangle emblem fill / gold feather lines). Optional per-tenant override
// of the app's shared --brass/--brass-deep/--brass-light CSS variables (see
// applyTenantBranding() in init.js) -- Pingara/RK Twelve21 don't define
// these, so they keep the app's default brass/gold palette untouched; only
// a tenant that explicitly sets all three gets its own accent color.
const TENANT_ACCENT = "#166B5E";       // brand teal (triangle fill) -- replaces --brass
const TENANT_ACCENT_DEEP = "#0F4940";  // darker teal, computed (~68% brightness) -- replaces --brass-deep
const TENANT_ACCENT_LIGHT = "#F7C57F"; // brand gold (feather lines/peacock) -- replaces --brass-light

// Single location, per owner's choice -- one restaurant entry covers it.
const TENANT_RESTAURANTS = [
  { id: "shree-krishna-palace", label: "Shree Krishna Palace" }
];

const TENANT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDE0JwpKtTR4V19h03cVJHBkYWxFZnKznw",
  authDomain: "expenses-d85ec.firebaseapp.com",
  projectId: "expenses-d85ec",
  storageBucket: "expenses-d85ec.firebasestorage.app",
  messagingSenderId: "938956221494",
  appId: "1:938956221494:web:49f43ff635f1815e3d7c97"
};

// Placeholder password, per owner's explicit choice ("placeholder for now") --
// same shared sha256("Admin123") hash RK Twelve21 started with. Used for
// BOTH the Owner/Reports password and the one restaurant's password until
// real ones are chosen. Swap before real financial data goes in.
const TENANT_REPORTS_PASSWORD_HASH = "3b612c75a7b5048a435fb6ec81e52ff92d6d795a8b5a9c17070f6a63c97a53b2";

const TENANT_RESTAURANT_PASSWORD_HASH = {
  "shree-krishna-palace": "3b612c75a7b5048a435fb6ec81e52ff92d6d795a8b5a9c17070f6a63c97a53b2"
};
