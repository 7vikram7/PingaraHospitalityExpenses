const DEFAULT_CATEGORIES = {
  "Food & Beverage": ["Produce","Meat & Poultry","Seafood","Dairy & Eggs","Bakery","Beverages (Non-Alc)","Alcohol","Dry Goods & Grocery"],
  "Operations": ["Cleaning Supplies","Paper & Disposables","Kitchen Equipment","Repairs & Maintenance","Linen & Laundry"],
  "Utilities": ["Electricity","Water","Gas","Internet & Phone"],
  "Staff": ["Wages","Uniforms","Staff Meals"],
  "Rent & Lease": ["Rent","Equipment Lease"],
  "Marketing": ["Advertising","Printing"],
  "Other": ["Miscellaneous"]
};

// Restaurant list comes from the active tenant config (app/tenant.js, loaded
// before this file) — this is what makes the same codebase servable as a
// distinct white-labeled portal per client.
const RESTAURANTS = TENANT_RESTAURANTS;
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

// One password per restaurant — a manager only knows the password for their own
// restaurant(s). Client-side SHA-256 compare, same soft-deterrent model as
// REPORTS_PASSWORD_HASH (see auth.js and CONTEXT.md's security notes) — not real
// access control, just a UI-level boundary between locations. Comes from the
// active tenant config, same as RESTAURANTS above.
const RESTAURANT_PASSWORD_HASH = TENANT_RESTAURANT_PASSWORD_HASH;

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
// supplierKey() -> Set of restaurant ids that have actually billed that
// supplier (see data-store.js's buildSupplierUsageIndex()) — drives which
// suppliers a given restaurant's picker shows. Built once at init, kept
// current via recordSupplierUsage() rather than re-derived per render.
let supplierUsageIndex = {};
let entries = [];
let currentDate = todayStr();

// One Excel file-link per restaurant, remembered for this browser session
// (re-linking is needed after a full page reload — the browser doesn't let us
// silently reuse file permissions across sessions without a user click).
let fileHandles = {};
let fileHandle = null;

/* ---------- Firebase (Firestore) remote KV backend ---------- */
// This app always talks to one Firebase project per tenant — there is
// deliberately no UI to point it at a different project or disconnect from
// it. Which project is "this app" comes from app/tenant.js.
const FIREBASE_CONFIG = TENANT_FIREBASE_CONFIG;
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

// ---- Firebase Storage (added 2026-10-01, bill attachments) ----
// Binary files (photos/PDFs) don't fit Firestore's 1 MiB document cap or
// localStorage's quota, so attachments use actual Cloud Storage instead —
// the one place this app uses a Firebase service other than Firestore.
// Reuses the same initialized app as initFirebase() above rather than a
// separate one.
let firebaseStorageRef = null;
async function initFirebaseStorage(){
  const cfg = getFirebaseConfig();
  if(!cfg) { firebaseStorageRef = null; return null; }
  try{
    await ensureFirebaseSdkLoaded();
    await initFirebase(); // ensures firebase.initializeApp() has already run
    firebaseStorageRef = firebase.storage();
    return firebaseStorageRef;
  }catch(e){
    console.error("firebase storage init failed", e);
    firebaseStorageRef = null;
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

// A bill stays freely modifiable for this long after it's added (no password) —
// past it, modifying requires the admin (Reports-tab) password. Based on the
// entry's original createdAt, not reset by edits, so re-editing an old bill
// needs the password again each time. The owner profile is exempt (see auth.js) —
// once logged in as owner, no further passwords are asked anywhere in the app.
const MODIFY_WINDOW_MS = 60 * 60 * 1000;
function billWithinModifyWindow(entry){
  return isOwnerProfile() || (Date.now() - entry.createdAt) < MODIFY_WINDOW_MS;
}

/* ---------- Login: profile (owner/manager) + per-restaurant login state ----------
   Persisted in localStorage (changed 2026-08-28, was sessionStorage) so the
   app behaves like a real mobile app that stays logged in across closing the
   browser/tab, backgrounding, or reopening from the home screen — the whole
   point of most of this codebase's usage being on mobile. The ONLY way back
   to the login screens is the explicit Logout button (see auth.js's
   switchProfileBtn handler, which clears every one of these keys plus
   REPORTS_UNLOCK_KEY in reports-dashboard.js). See auth.js for the login
   screens and flow; these are just the storage primitives, kept here
   alongside the other small state accessors (getCurrentRestaurantId etc). */
const PROFILE_KEY = "profileType"; // 'owner' | 'manager'
function getProfile(){
  try{ return localStorage.getItem(PROFILE_KEY); }catch(e){ return null; }
}
function setProfile(p){
  try{
    if(p) localStorage.setItem(PROFILE_KEY, p);
    else localStorage.removeItem(PROFILE_KEY);
  }catch(e){}
}
function isOwnerProfile(){ return getProfile() === 'owner'; }

// ---- Central Kitchen: elevated non-owner profile (added 2026-10-03) ----
// A specific restaurant (Central Kitchen, Pingara tenant only) whose manager
// login gets broader rights than a normal restaurant manager: full owner-
// level visibility into Reports/Vendor Ledger/Suppliers/Staff Expenses
// (across every restaurant, not just its own), can toggle bills paid/unpaid
// and add new ones for its own restaurant same as any manager, but can
// never modify an existing bill's amount/category/date, and never sees
// sales figures anywhere in the app. Detected purely by which restaurant's
// password unlocked the session -- getUnlockedRestaurantId(), not
// currentRestaurantId, since the latter can change (e.g. the Reports/Staff
// restaurant selectors) without ending the Central Kitchen session itself.
// Tenants without a "central-kitchen" restaurant (e.g. RK Twelve21) simply
// never match this, so this is inert there.
const CENTRAL_KITCHEN_RESTAURANT_ID = "central-kitchen";
function isCentralKitchenProfile(){
  return !isOwnerProfile() && getUnlockedRestaurantId() === CENTRAL_KITCHEN_RESTAURANT_ID;
}
// Who gets owner-level, cross-restaurant visibility into Reports/Vendor
// Ledger/Suppliers/Staff Expenses -- the real Owner, or the Central Kitchen
// elevated profile above.
function hasElevatedAccess(){
  return isOwnerProfile() || isCentralKitchenProfile();
}
// Sales figures are hidden entirely from the Central Kitchen profile (not
// just the "Sales" label -- Profit/Profit % are derived from Sales too, so
// those are hidden alongside it, since showing Expenses + Profit would let
// Sales be back-calculated anyway).
function canSeeSalesData(){ return !isCentralKitchenProfile(); }
// Central Kitchen can toggle a bill's paid/unpaid status, add new bills, and
// add new suppliers, but can never modify an EXISTING record's own fields --
// a bill's amount/category/invoice/date (unlike the normal 1-hour-then-
// Owner-password window that otherwise applies, there is no override for
// this profile at all), or a supplier's category/subcategory default (which
// retroactively re-tags every past bill under that supplier). One flag
// covers both since they're the same restriction for this profile.
function canEditExistingRecords(){ return !isCentralKitchenProfile(); }

const UNLOCKED_RESTAURANT_KEY = "unlockedRestaurantId"; // which restaurant a manager verified, persists until logout
function getUnlockedRestaurantId(){
  try{ return localStorage.getItem(UNLOCKED_RESTAURANT_KEY); }catch(e){ return null; }
}
function setUnlockedRestaurantId(id){
  try{
    if(id) localStorage.setItem(UNLOCKED_RESTAURANT_KEY, id);
    else localStorage.removeItem(UNLOCKED_RESTAURANT_KEY);
  }catch(e){}
}
// Whether `id` is usable without going through the restaurant gate. An owner
// never needs the gate at all (2026-08-06: owner skips restaurant selection
// entirely at login — see auth.js — and instead gets a restaurant selector
// directly in the Add Expenses toolbar, matching how Reports/Vendor Ledger
// already have their own independent selectors). A manager still needs to
// have confirmed `id` specifically, via its password — that confirmation now
// persists until Logout (see UNLOCKED_RESTAURANT_KEY above), not just for
// one browser session. Name kept as-is; "session" here now means "since
// last login," not "since last browser close."
function isRestaurantUnlockedForSession(id){
  return isOwnerProfile() || getUnlockedRestaurantId() === id;
}

/* ---------- Desktop view toggle (added 2026-08-28) ----------
   Vendor Ledger's table (and a couple others) is wide enough that mobile's
   narrow layout means a lot of horizontal scrolling to see everything at
   once. Phone browsers used to have a built-in "Request desktop site" option
   for this -- what that actually does under the hood (this app has no
   server-side rendering to change) is override the page's own <meta
   viewport> to a fixed wide width, so CSS media queries see a wide "layout
   viewport" and render their normal (non-mobile) layout, which the browser
   then scales down to fit the physical screen -- the user pinches/zooms to
   read any one part. Doing the same thing explicitly, in-app, via
   #viewportMeta means it works the same way from an installed home-screen
   PWA too, where there's no browser chrome/menu to find that toggle in.
   A device/display preference, not login state -- deliberately NOT cleared
   by Logout, same as a browser's own "desktop site" setting wouldn't be. */
const DESKTOP_VIEW_KEY = "desktopViewEnabled";
const DESKTOP_VIEWPORT_CONTENT = "width=1200";
const MOBILE_VIEWPORT_CONTENT = "width=device-width, initial-scale=1.0, viewport-fit=cover";

function isDesktopViewEnabled(){
  try{ return localStorage.getItem(DESKTOP_VIEW_KEY) === '1'; }catch(e){ return false; }
}
function setDesktopViewEnabled(on){
  try{
    if(on) localStorage.setItem(DESKTOP_VIEW_KEY, '1');
    else localStorage.removeItem(DESKTOP_VIEW_KEY);
  }catch(e){}
}
function applyViewportMode(){
  const on = isDesktopViewEnabled();
  const meta = document.getElementById('viewportMeta');
  if(meta) meta.setAttribute('content', on ? DESKTOP_VIEWPORT_CONTENT : MOBILE_VIEWPORT_CONTENT);
  const btn = document.getElementById('desktopViewToggle');
  if(btn) btn.textContent = on ? 'Mobile view' : 'Desktop view';
}
// Applied immediately (not gated on login) so the preference already shows
// correctly on the login screens themselves, not just after signing in.
applyViewportMode();

