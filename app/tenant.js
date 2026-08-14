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
  { id: "umami-la-delice",   label: "Umami La Delice" },
  { id: "central-kitchen",   label: "Central Kitchen" }
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

// One password per restaurant — a manager only knows their own restaurant's
// password. sha256 hashes, same soft-deterrent model as the Reports password.
const TENANT_RESTAURANT_PASSWORD_HASH = {
  "krishna-nigdi":   "fd1782e48deb8911c3fb137065038a5aa8e1bd4f97717f63c89d99329cb7527a",
  "krishna-ravet":   "8df8aa769d24738c7ac2b3255706fb4e6e1d6d10cf81c8dc907f00a2dc550089",
  "krishna-chikhli": "eb7edf9e07f7959d4be3253db3a770cb6c745510c755d74087214162833cfd36",
  "savali":          "a49389c0e960243bb07a679032c1bd2777850aa7db7663da1d1bfc5b896d3316",
  "malhaar":         "889fe9a11fde855aaaf2326ea6c8b397ee85745dd43dbd99bc6e8f3ead79e597",
  "umami-la-delice": "97318b10fb613f4cc830bca4acf33dc296565f25addf97ba103ce3af3a560bb9",
  "central-kitchen": "e43fc89bc3650189d3cdc36f544c91939cb50c43b4cea04b5f228a699ddb156d"
};
