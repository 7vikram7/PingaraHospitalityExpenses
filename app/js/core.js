const DEFAULT_CATEGORIES = {
  "Food & Beverage": ["Produce","Meat & Poultry","Seafood","Dairy & Eggs","Bakery","Beverages (Non-Alc)","Alcohol","Dry Goods & Grocery"],
  "Operations": ["Cleaning Supplies","Paper & Disposables","Kitchen Equipment","Repairs & Maintenance","Linen & Laundry"],
  "Utilities": ["Electricity","Water","Gas","Internet & Phone"],
  "Staff": ["Wages","Uniforms","Staff Meals"],
  "Rent & Lease": ["Rent","Equipment Lease"],
  "Marketing": ["Advertising","Printing"],
  "Other": ["Miscellaneous"]
};

const RESTAURANTS = [
  { id: "krishna-nigdi",     label: "Krishna Veg (Nigdi)" },
  { id: "krishna-ravet",     label: "Krishna Veg (Ravet)" },
  { id: "krishna-chikhli",   label: "Krishna Veg (Chikhli)" },
  { id: "savali",            label: "Savali" },
  { id: "malhaar",           label: "Malhaar" },
  { id: "umami-la-delice",   label: "Umami La Delice" }
];
const CURRENT_RESTAURANT_KEY = "currentRestaurantId"; // NOT namespaced — this is global, just remembers your last pick
function getCurrentRestaurantId(){
  try{
    const saved = localStorage.getItem(CURRENT_RESTAURANT_KEY);
    if(saved && RESTAURANTS.some(r=>r.id === saved)) return saved;
  }catch(e){}
  return RESTAURANTS[0].id;
}
function setCurrentRestaurantId(id){
  try{ localStorage.setItem(CURRENT_RESTAURANT_KEY, id); }catch(e){}
}
function restaurantLabel(id){
  const r = RESTAURANTS.find(r=>r.id === id);
  return r ? r.label : id;
}
let currentRestaurantId = getCurrentRestaurantId();
function restPrefix(){ return "rest:" + currentRestaurantId + ":"; }

// Every one of these keys is namespaced by the current restaurant, so switching
// restaurants gives you a completely separate set of categories/suppliers/bills.
// Suppliers and categories are shared across every restaurant — same vendor
// database everywhere. Only the actual day-to-day bills are kept separate
// per restaurant, since those are restaurant-specific transactions.
function catsKey(){ return "categories"; }
function supKey(){ return "suppliers"; }
function supDefaultsKey(){ return "supplierDefaults"; }

let categories = {};
let suppliers = [];
let supplierDefaults = {};
let entries = [];
let currentDate = todayStr();

// One Excel file-link per restaurant, remembered for this browser session
// (re-linking is needed after a full page reload — the browser doesn't let us
// silently reuse file permissions across sessions without a user click).
let fileHandles = {};
let fileHandle = null;

/* ---------- Firebase (Firestore) remote KV backend ---------- */
// This app always talks to this one Firebase project — there is deliberately
// no UI to point it at a different project or disconnect from it.
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBQtd4VGuG2TyEEjKyF81_WmDTMem60QtI",
  authDomain: "vendor-bills.firebaseapp.com",
  projectId: "vendor-bills",
  storageBucket: "vendor-bills.firebasestorage.app",
  messagingSenderId: "998946985906",
  appId: "1:998946985906:web:77a8397812ea1fcb14b6ab",
  measurementId: "G-1LKF1KY8T1"
};
let firebaseDb = null;
let firebaseInitTried = false;

function getFirebaseConfig(){ return FIREBASE_CONFIG; }
function firebaseConfigured(){ return true; }

async function ensureFirebaseSdkLoaded(){
  if(typeof firebase !== 'undefined') return true;
  const ok = await window.__firebaseSdkReady;
  if(!ok || typeof firebase === 'undefined'){
    throw new Error("couldn't load the cloud storage library — your network may be blocking Google's script CDN. Try a different network/Wi-Fi, disable ad-blockers for this page, or try again later.");
  }
  return true;
}
async function initFirebase(){
  const cfg = getFirebaseConfig();
  if(!cfg) { firebaseDb = null; return null; }
  try{
    await ensureFirebaseSdkLoaded();
    const existing = firebase.apps.find(a=>a.name === '[DEFAULT]');
    if(existing){
      const sameConfig = JSON.stringify(existing.options) === JSON.stringify(cfg);
      if(sameConfig && firebaseDb) return firebaseDb;
      if(!sameConfig){
        await existing.delete();
        firebaseDb = null;
      }
    }
    if(!firebase.apps.find(a=>a.name === '[DEFAULT]')){
      firebase.initializeApp(cfg);
    }
    firebaseDb = firebase.firestore();
    return firebaseDb;
  }catch(e){
    console.error("firebase init failed", e);
    firebaseDb = null;
    return null;
  }
}

function renderFirebaseStatus(text, isError){
  const bar = document.getElementById('cloudStatusBar');
  if(!text){ bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  bar.textContent = text;
  bar.style.color = isError ? '#fff' : 'var(--ink-soft)';
  bar.style.background = isError ? 'var(--red)' : '#fff';
}

const FB_COLLECTION = "billTrackerData";

async function fbGet(key){
  const db = await initFirebase();
  if(!db) return undefined;
  const doc = await db.collection(FB_COLLECTION).doc(key).get();
  if(!doc.exists) return undefined;
  const data = doc.data();
  return data ? data.value : undefined;
}
async function fbSet(key, value){
  const db = await initFirebase();
  if(!db) return;
  await db.collection(FB_COLLECTION).doc(key).set({ value: value });
}
async function fbList(prefix){
  const db = await initFirebase();
  if(!db) return [];
  const snap = await db.collection(FB_COLLECTION)
    .where(firebase.firestore.FieldPath.documentId(), '>=', prefix)
    .where(firebase.firestore.FieldPath.documentId(), '<', prefix + '\uf8ff')
    .get();
  const keys = [];
  snap.forEach(d=>keys.push(d.id));
  return keys;
}
function toDateStr(d){
  const y = d.getFullYear();
  const m = String(d.getMonth()+1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function todayStr(){
  return toDateStr(new Date());
}
function fmtMoney(n){
  return "₹" + Number(n||0).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
}
function fmtDateLabel(dstr){
  const d = new Date(dstr + "T00:00:00");
  return d.toLocaleDateString('en-IN', {weekday:'short', day:'numeric', month:'short', year:'numeric'});
}
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

