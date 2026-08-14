// TENANT CONFIG — Pingara Hospitality.
// This file is the source of truth; app/tenant.js (loaded by index.html) is a
// copy of whichever tenant is currently active. See deploy.sh.
const TENANT_BRAND_NAME = "Pingara Hospitality";
const TENANT_EYEBROW = "Daily Purchase Register";
const TENANT_LOGO = "logo.png"; // set to null for a clean text-only header, no logo
const TENANT_TITLE = "Vendor Bill Ledger";

const TENANT_RESTAURANTS = [
  { id: "krishna-nigdi",     label: "Krishna Veg (Nigdi)" },
  { id: "krishna-ravet",     label: "Krishna Veg (Ravet)" },
  { id: "krishna-chikhli",   label: "Krishna Veg (Chikhli)" },
  { id: "savali",            label: "Savali" },
  { id: "malhaar",           label: "Malhaar" },
  { id: "umami-la-delice",   label: "Umami La Delice" }
];

const TENANT_FIREBASE_CONFIG = {
  apiKey: "AIzaSyBQtd4VGuG2TyEEjKyF81_WmDTMem60QtI",
  authDomain: "vendor-bills.firebaseapp.com",
  projectId: "vendor-bills",
  storageBucket: "vendor-bills.firebasestorage.app",
  messagingSenderId: "998946985906",
  appId: "1:998946985906:web:77a8397812ea1fcb14b6ab",
  measurementId: "G-1LKF1KY8T1"
};

// Same admin password as the Reports tab. sha256("Admin123").
const TENANT_REPORTS_PASSWORD_HASH = "3b612c75a7b5048a435fb6ec81e52ff92d6d795a8b5a9c17070f6a63c97a53b2";
