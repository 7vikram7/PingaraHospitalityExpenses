// TENANT CONFIG — Shree Krishna Palace.
// This file is the source of truth; app/tenant.js (loaded by index.html) is a
// copy of whichever tenant is currently active. See deploy.sh.
//
// SCAFFOLDED 2026-10-18, not yet live. TENANT_FIREBASE_CONFIG below is still
// "TODO" -- deploy.sh refuses to deploy any tenant file containing that
// literal string, so this can't go out by accident. Needs a real Firebase
// project (its own, separate from vendor-bills/rk-twelve21) with Firestore +
// Storage enabled, a Web App registered in it for the config block below, and
// a service account key with "Editor" + "Firebase Admin" IAM roles granted
// up front (see CONTEXT.md / project memory for why both roles, found the
// hard way on RK Twelve21's Storage setup).
const TENANT_BRAND_NAME = "Shree Krishna Palace";
const TENANT_EYEBROW = "Daily Purchase Register";
const TENANT_LOGO = null; // no logo yet -- clean text-only header for now, same as RK Twelve21; set once a logo file is provided
const TENANT_TITLE = "Vendor Bill Ledger";

// Single location, per owner's choice -- one restaurant entry covers it.
const TENANT_RESTAURANTS = [
  { id: "shree-krishna-palace", label: "Shree Krishna Palace" }
];

// TODO: replace with the real Firebase project's Web App config
// (Console -> Project Settings -> General -> Your apps -> SDK setup and
// configuration), once that project exists.
const TENANT_FIREBASE_CONFIG = {
  apiKey: "TODO",
  authDomain: "TODO",
  projectId: "TODO",
  storageBucket: "TODO",
  messagingSenderId: "TODO",
  appId: "TODO"
};

// Placeholder password, per owner's explicit choice ("placeholder for now") --
// same shared sha256("Admin123") hash RK Twelve21 started with. Used for
// BOTH the Owner/Reports password and the one restaurant's password until
// real ones are chosen. Swap before real financial data goes in.
const TENANT_REPORTS_PASSWORD_HASH = "3b612c75a7b5048a435fb6ec81e52ff92d6d795a8b5a9c17070f6a63c97a53b2";

const TENANT_RESTAURANT_PASSWORD_HASH = {
  "shree-krishna-palace": "3b612c75a7b5048a435fb6ec81e52ff92d6d795a8b5a9c17070f6a63c97a53b2"
};
