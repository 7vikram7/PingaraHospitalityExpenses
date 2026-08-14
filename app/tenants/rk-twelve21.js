// TENANT CONFIG — RK Twelve21.
// This file is the source of truth; app/tenant.js (loaded by index.html) is a
// copy of whichever tenant is currently active. See deploy.sh.
const TENANT_BRAND_NAME = "RK Twelve21";
const TENANT_EYEBROW = "RK Twelve21"; // no logo yet, so the brand name carries identity here instead
const TENANT_LOGO = null; // clean text-only header for now, per owner request — add a logo file later and set this
const TENANT_TITLE = "Vendor Bill Ledger";

const TENANT_RESTAURANTS = [
  { id: "ramakrishna", label: "Ramakrishna" },
  { id: "twelve21",    label: "Twelve21" }
];

// TODO: incomplete — messagingSenderId/appId/measurementId were never provided.
// Do not deploy this tenant until these are filled in from the Firebase Console
// (Project settings > General > Your apps > SDK setup and configuration).
const TENANT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyDGV8AgE1OanmRyK3L58Fw_vxePIZDanHk",
  authDomain: "rk-twelve21.firebaseapp.com",
  projectId: "rk-twelve21",
  storageBucket: "rk-twelve21.firebasestorage.app",
  messagingSenderId: "TODO",
  appId: "TODO",
  measurementId: "TODO"
};

// Same admin password as Pingara's Reports tab, per owner request ("use same
// passwords for now"). sha256("Admin123"). Revisit if these two portals should
// have independent owner access later.
const TENANT_REPORTS_PASSWORD_HASH = "3b612c75a7b5048a435fb6ec81e52ff92d6d795a8b5a9c17070f6a63c97a53b2";

// No distinct per-restaurant passwords chosen yet, so both restaurants use the
// same Admin123 hash as the owner password for now, per "use same passwords
// for now." Give each restaurant its own manager password once RK Twelve21
// is ready to onboard managers separately from the owner.
const TENANT_RESTAURANT_PASSWORD_HASH = {
  "ramakrishna": "3b612c75a7b5048a435fb6ec81e52ff92d6d795a8b5a9c17070f6a63c97a53b2",
  "twelve21":    "3b612c75a7b5048a435fb6ec81e52ff92d6d795a8b5a9c17070f6a63c97a53b2"
};
