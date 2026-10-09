async function safeGet(key){
  if(firebaseConfigured()){
    try{
      const value = await fbGet(key);
      if(value !== undefined && value !== null){
        try{ localStorage.setItem(key, value); }catch(e){}
        renderFirebaseStatus("", false);
        return value;
      }
      // not found remotely — fall through to local cache
    }catch(e){
      console.error("firebase get failed", key, e);
      renderFirebaseStatus("Couldn't reach your cloud storage — showing last synced copy on this device.", true);
    }
  }
  try{
    return localStorage.getItem(key);
  }catch(e){ console.error("storage get failed", key, e); return null; }
}
async function safeSet(key, value){
  let localOk = true;
  try{ localStorage.setItem(key, value); }
  catch(e){ console.error("storage set failed", key, e); showSaveError(); localOk = false; }
  if(firebaseConfigured()){
    try{
      await fbSet(key, value);
      renderFirebaseStatus("", false);
    }catch(e){
      console.error("firebase set failed", key, e);
      renderFirebaseStatus(localOk
        ? "Saved on this device, but couldn't sync to your cloud storage. Will keep trying."
        : "Couldn't save this entry to the cloud or this device — check your internet connection and try again.", true);
    }
  }
  return localOk;
}

async function loadCategories(){
  const raw = await safeGet(catsKey());
  if(raw){
    try{ categories = JSON.parse(raw); return; }catch(e){}
  }
  categories = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES));
  await safeSet(catsKey(), JSON.stringify(categories));
}
async function saveCategories(){ await safeSet(catsKey(), JSON.stringify(categories)); }

async function loadSuppliers(){
  const raw = await safeGet(supKey());
  if(raw){
    try{ suppliers = JSON.parse(raw); return; }catch(e){}
  }
  suppliers = [];
}
async function saveSuppliers(){ await safeSet(supKey(), JSON.stringify(suppliers)); }

async function loadSupplierDefaults(){
  const raw = await safeGet(supDefaultsKey());
  if(raw){
    try{ supplierDefaults = JSON.parse(raw); return; }catch(e){}
  }
  supplierDefaults = {};
}
async function saveSupplierDefaults(){ await safeSet(supDefaultsKey(), JSON.stringify(supplierDefaults)); }
function supplierKey(name){ return (name||"").trim().toLowerCase(); }

// ---- Month-bucketed bills & sales ----
// One document per restaurant per month (not per day) — e.g. "rest:savali:bills:2026-07"
// holds { "2026-07-01": [...entries], "2026-07-02": [...], ... }. This keeps well under
// Firestore's 1 MiB document cap (a full month of entries is only ~100-150 KB) while cutting
// report reads roughly 30x versus one document per day.
function billsMonthKey(monthKey){ return restPrefix() + "bills:" + monthKey; }
function salesMonthKey(monthKey){ return restPrefix() + "sales:" + monthKey; }
function salesMetaKey(monthKey){ return restPrefix() + "salesMeta:" + monthKey; }

let billsMonthCache = {};
let currentBillsMonthCacheKey = null;
async function loadBillsMonth(monthKey){
  const cacheKey = billsMonthKey(monthKey);
  if(currentBillsMonthCacheKey !== cacheKey){
    const raw = await safeGet(cacheKey);
    billsMonthCache = raw ? (JSON.parse(raw) || {}) : {};
    currentBillsMonthCacheKey = cacheKey;
  }
  return billsMonthCache;
}
async function loadEntries(date){
  const month = await loadBillsMonth(date.slice(0,7));
  entries = month[date] || [];
}
async function saveEntries(){
  const monthKey = currentDate.slice(0,7);
  const month = await loadBillsMonth(monthKey); // ensures cache is loaded & matches this month before we mutate it
  month[currentDate] = entries;
  await safeSet(billsMonthKey(monthKey), JSON.stringify(month));
}

// Moves a single bill from the currently-viewed date to a different date (used by
// the Modify-bill date field). The entry's own fields should already be updated by
// the caller before this runs — this only relocates it between day-buckets, which
// may mean a different month document entirely.
async function moveEntryDate(entry, newDate){
  entries = entries.filter(x => x.id !== entry.id);
  await saveEntries(); // persists the current month bucket without this entry

  const targetMonthKey = newDate.slice(0,7);
  const targetKey = billsMonthKey(targetMonthKey);
  let targetMonthObj;
  if(targetKey === currentBillsMonthCacheKey){
    targetMonthObj = billsMonthCache; // same month as the one we just saved above
  } else {
    const raw = await safeGet(targetKey);
    targetMonthObj = raw ? (JSON.parse(raw) || {}) : {};
  }
  if(!targetMonthObj[newDate]) targetMonthObj[newDate] = [];
  targetMonthObj[newDate].push(entry);
  await safeSet(targetKey, JSON.stringify(targetMonthObj));
}

// Toggles paid/unpaid for a bill identified by restaurant+date+id rather than
// by position in the currently-loaded `entries` array — used by the Vendor
// Ledger tab, where a bill's restaurant/date may not be the one currently
// active in the Add Expenses tab. Reuses the current month cache when it
// happens to be the same restaurant+month (avoiding a redundant read), and
// keeps the live `entries` array in sync if it's the same day being viewed.
async function toggleBillStatusByLocation(restaurantId, date, billId){
  const monthKey = date.slice(0,7);
  const key = "rest:" + restaurantId + ":bills:" + monthKey;
  const sameCachedMonth = (restaurantId === currentRestaurantId) && (key === currentBillsMonthCacheKey);
  const monthObj = sameCachedMonth ? billsMonthCache
    : (JSON.parse((await safeGet(key)) || "{}") || {});

  const dayBills = monthObj[date] || [];
  const bill = dayBills.find(b => b.id === billId);
  if(!bill) return null;
  bill.status = bill.status === 'paid' ? 'unpaid' : 'paid';
  bill.paidAt = bill.status === 'paid' ? Date.now() : null;
  await safeSet(key, JSON.stringify(monthObj));

  if(restaurantId === currentRestaurantId && date === currentDate){
    const localEntry = entries.find(e => e.id === billId);
    if(localEntry){ localEntry.status = bill.status; localEntry.paidAt = bill.paidAt; }
  }
  return bill;
}

// ---- Cross-verification (added 2026-10-06) ----
// A bill's verified flag lives on the bill itself (same doc as its status), so
// it reads and writes exactly like the paid toggle. Sales verification is kept
// in its own key rather than on the sales figure, so every existing reader of
// the sales bucket is untouched.
async function toggleBillVerifiedByLocation(restaurantId, date, billId, by){
  const monthKey = date.slice(0,7);
  const key = "rest:" + restaurantId + ":bills:" + monthKey;
  const sameCachedMonth = (restaurantId === currentRestaurantId) && (key === currentBillsMonthCacheKey);
  const monthObj = sameCachedMonth ? billsMonthCache
    : (JSON.parse((await safeGet(key)) || "{}") || {});

  const bill = (monthObj[date] || []).find(b => b.id === billId);
  if(!bill) return null;
  bill.verified = !bill.verified;
  bill.verifiedBy = bill.verified ? by : null;
  bill.verifiedAt = bill.verified ? Date.now() : null;
  await safeSet(key, JSON.stringify(monthObj));

  if(restaurantId === currentRestaurantId && date === currentDate){
    const localEntry = entries.find(e => e.id === billId);
    if(localEntry){ localEntry.verified = bill.verified; localEntry.verifiedBy = bill.verifiedBy; localEntry.verifiedAt = bill.verifiedAt; }
  }
  return bill;
}
function salesVerifiedKeyFor(restaurantId, monthKey){ return "rest:" + restaurantId + ":salesVerified:" + monthKey; }
async function loadSalesVerified(restaurantId, monthKey){
  const raw = await safeGet(salesVerifiedKeyFor(restaurantId, monthKey));
  if(raw){ try{ return JSON.parse(raw) || {}; }catch(e){} }
  return {};
}
async function isSalesVerified(restaurantId, date){
  const obj = await loadSalesVerified(restaurantId, date.slice(0,7));
  return !!obj[date];
}
async function toggleSalesVerified(restaurantId, date, by){
  const monthKey = date.slice(0,7);
  const obj = await loadSalesVerified(restaurantId, monthKey);
  if(obj[date]) delete obj[date];
  else obj[date] = { by, at: Date.now() };
  await safeSet(salesVerifiedKeyFor(restaurantId, monthKey), JSON.stringify(obj));
  return !!obj[date];
}

let salesMonthCache = {};
let currentSalesMonthCacheKey = null;
async function loadSalesMonth(monthKey){
  const cacheKey = salesMonthKey(monthKey);
  if(currentSalesMonthCacheKey !== cacheKey){
    const raw = await safeGet(cacheKey);
    salesMonthCache = raw ? (JSON.parse(raw) || {}) : {};
    currentSalesMonthCacheKey = cacheKey;
  }
  return salesMonthCache;
}
// Separate lightweight doc tracking only *when* each date's sales figure was first
// saved — kept apart from the sales value itself so every existing reader of the
// sales bucket (Excel export, dashboard) is untouched by this addition.
let salesMetaCache = {};
let currentSalesMetaCacheKey = null;
async function loadSalesMeta(monthKey){
  const cacheKey = salesMetaKey(monthKey);
  if(currentSalesMetaCacheKey !== cacheKey){
    const raw = await safeGet(cacheKey);
    salesMetaCache = raw ? (JSON.parse(raw) || {}) : {};
    currentSalesMetaCacheKey = cacheKey;
  }
  return salesMetaCache;
}
let currentSales = null; // number or null for "not recorded"
let currentSalesSavedAt = null; // timestamp sales was first saved for this date, or null if legacy/unknown
let salesTempUnlocked = false; // password-unlocked for the currently-viewed date; reset whenever the date changes
async function loadSales(date){
  salesTempUnlocked = false;
  const month = await loadSalesMonth(date.slice(0,7));
  const val = month[date];
  currentSales = (val !== undefined && val !== null && val !== "") ? Number(val) : null;
  const meta = await loadSalesMeta(date.slice(0,7));
  currentSalesSavedAt = meta[date] || null;
  const input = document.getElementById('salesInput');
  if(input) input.value = (currentSales !== null && !isNaN(currentSales)) ? currentSales : "";
  updateSalesLockUI();
  renderSalesVerifyControl();
}
async function saveSalesValue(){
  const input = document.getElementById('salesInput');
  const val = parseFloat(input.value);
  if(isNaN(val) || val < 0) return false;
  const monthKey = currentDate.slice(0,7);
  const month = await loadSalesMonth(monthKey);
  month[currentDate] = val;
  await safeSet(salesMonthKey(monthKey), JSON.stringify(month));
  const meta = await loadSalesMeta(monthKey);
  if(!meta[currentDate]){
    meta[currentDate] = Date.now();
    await safeSet(salesMetaKey(monthKey), JSON.stringify(meta));
  }
  currentSales = val;
  currentSalesSavedAt = meta[currentDate];
  return true;
}

// Discovery only — lists which MONTH documents exist (far fewer than day documents
// used to be), so this stays cheap even after years of data. Used for the history
// panel and for figuring out which financial years have any data at all.
async function listBillMonthKeys(){
  const prefix = restPrefix() + 'bills:';
  const out = new Set();
  try{
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if(k && k.startsWith(prefix)) out.add(k);
    }
  }catch(e){ console.error("storage list failed", e); }
  if(firebaseConfigured()){
    try{
      const remoteKeys = await fbList(prefix);
      remoteKeys.forEach(k=>out.add(k));
      renderFirebaseStatus("", false);
    }catch(e){
      console.error("firebase list failed", e);
      renderFirebaseStatus("Couldn't reach your cloud storage — showing what's saved on this device.", true);
    }
  }
  return Array.from(out); // each like "rest:<id>:bills:2026-07"
}
async function fetchMonthObject(fullKey){
  // Reuses the in-memory cache if it's the month currently open in the ledger,
  // to avoid a redundant read.
  if(fullKey === currentBillsMonthCacheKey) return billsMonthCache;
  if(fullKey === currentSalesMonthCacheKey) return salesMonthCache;
  const raw = await safeGet(fullKey);
  if(!raw) return {};
  try{ return JSON.parse(raw) || {}; }catch(e){ return {}; }
}
// Fetches exactly the 12 known month-documents for one financial year (no listing
// query needed — we already know which months an FY covers) and flattens them.
async function collectFYBillRows(fyStartYear){
  const rows = []; // {date, supplier, category, amount}
  for(const {year, month} of monthsForFY(fyStartYear)){
    const mk = `${year}-${String(month).padStart(2,'0')}`;
    const monthData = await fetchMonthObject(billsMonthKey(mk));
    Object.keys(monthData).forEach(date=>{
      (monthData[date] || []).forEach(e=>{
        rows.push({ date, supplier: e.supplier, category: e.category || "Uncategorized", amount: Number(e.amount||0) });
      });
    });
  }
  return rows;
}
async function collectFYSalesRows(fyStartYear){
  const rows = []; // {date, amount}
  for(const {year, month} of monthsForFY(fyStartYear)){
    const mk = `${year}-${String(month).padStart(2,'0')}`;
    const monthData = await fetchMonthObject(salesMonthKey(mk));
    Object.keys(monthData).forEach(date=>{
      const amt = Number(monthData[date]);
      if(!isNaN(amt)) rows.push({ date, amount: amt });
    });
  }
  return rows;
}
function fyStartYearFromMonthKeyStr(monthKeyStr){
  // Expect the key to end with "YYYY-MM" — match strictly instead of blindly
  // slicing the last 7 chars, so a stray/malformed key (e.g. a leftover
  // day-bucketed key from before the month-bucketing migration) can't produce
  // NaN and show up as a bogus "FY NaN-NaN" option.
  const m = /(\d{4})-(\d{2})$/.exec(monthKeyStr);
  if(!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  if(mo < 1 || mo > 12) return null;
  return (mo >= 4) ? y : y - 1;
}
async function getAvailableFYs(){
  const keys = await listBillMonthKeys();
  const set = new Set(
    keys.map(fyStartYearFromMonthKeyStr).filter(fy => fy !== null && !Number.isNaN(fy))
  );
  set.add(fyStartYearForDate(todayStr())); // always offer the current FY, even with no data yet
  return Array.from(set).sort((a,b)=>b-a); // most recent first
}

// Cross-restaurant discovery — like listBillMonthKeys() but across every
// restaurant's bills, not just the currently active one. Used when a
// supplier's category/subcategory changes and needs to be propagated to
// every past bill under that supplier, everywhere, not just the current
// restaurant's history.
async function listAllRestaurantsBillMonthKeys(){
  const out = new Set();
  const pattern = /^rest:[^:]+:bills:\d{4}-\d{2}$/;
  try{
    for(let i=0;i<localStorage.length;i++){
      const k = localStorage.key(i);
      if(k && pattern.test(k)) out.add(k);
    }
  }catch(e){ console.error("storage list failed", e); }
  if(firebaseConfigured()){
    try{
      const remoteKeys = await fbList('rest:'); // every restaurant's bills/sales/salesMeta keys
      remoteKeys.forEach(k=>{ if(pattern.test(k)) out.add(k); });
      renderFirebaseStatus("", false);
    }catch(e){
      console.error("firebase list failed", e);
      renderFirebaseStatus("Couldn't reach your cloud storage — showing what's saved on this device.", true);
    }
  }
  return Array.from(out); // each like "rest:<id>:bills:2026-07"
}

// Retroactively applies a supplier's new category/subcategory to every past
// bill logged under that supplier, across every restaurant and every month —
// not just new bills going forward. Returns how many bills were actually
// changed. Bills are matched by supplierKey() (case/whitespace-insensitive),
// same normalization supplierDefaults itself uses.
async function propagateSupplierCategoryToAllBills(supplierName, newCategory, newSubcategory){
  const key = supplierKey(supplierName);
  const monthKeys = await listAllRestaurantsBillMonthKeys();
  let updatedCount = 0;
  for(const fullKey of monthKeys){
    const isCachedCurrentMonth = fullKey === currentBillsMonthCacheKey;
    const monthObj = isCachedCurrentMonth ? billsMonthCache
      : (JSON.parse((await safeGet(fullKey)) || "{}") || {});
    let changed = false;
    Object.keys(monthObj).forEach(date=>{
      (monthObj[date] || []).forEach(bill=>{
        if(supplierKey(bill.supplier) === key &&
           (bill.category !== newCategory || (bill.subcategory||"") !== (newSubcategory||""))){
          bill.category = newCategory;
          bill.subcategory = newSubcategory || "";
          changed = true;
          updatedCount++;
        }
      });
    });
    if(changed){
      await safeSet(fullKey, JSON.stringify(monthObj));
      // Objects are mutated in place, so `entries` (which shares references
      // with billsMonthCache when it's the same month) is already correct —
      // this just makes sure the Add Expenses tab's rendered DOM catches up
      // if it's showing the month that was just changed underneath it.
      if(isCachedCurrentMonth){
        renderTable(); renderTotals(); renderBreakdown();
      }
    }
  }
  return updatedCount;
}

// ---- Per-restaurant supplier usage (added 2026-10-02) ----
// Suppliers are shared account-wide (see above), but which ones are
// *relevant* to a given restaurant isn't — a manager at Restaurant A
// shouldn't have to scroll past every supplier Restaurant B has ever used.
// `supplierUsageIndex` (core.js) maps supplierKey() -> Set of restaurant
// ids that have actually billed that supplier at least once, built fresh
// from the bills themselves (the authoritative source — never a separate
// persisted structure that could drift out of sync with them, which is
// exactly the kind of redundant derived state that caused the 2026-10-02
// supplier-list data-loss incident). A supplier with no recorded usage
// anywhere yet (freshly added, never billed) is treated as visible to
// every restaurant — once any restaurant's first bill against it lands,
// visibility narrows to just the restaurant(s) that have actually used it.
// Built once at app init (loadSupplierUsageIndex()) and kept current
// in-memory via recordSupplierUsage() after every bill save, rather than
// re-scanning all bills on every dropdown render.
async function buildSupplierUsageIndex(){
  const index = {};
  const monthKeys = await listAllRestaurantsBillMonthKeys();
  for(const fullKey of monthKeys){
    const m = /^rest:([^:]+):bills:/.exec(fullKey);
    if(!m) continue;
    const restId = m[1];
    // Deliberately NOT fetchMonthObject() -- that helper reuses whichever
    // single month happens to be cached for the Add Expenses tab right now
    // (billsMonthCache/currentBillsMonthCacheKey), which is fine for the
    // one restaurant+month it's actually tracking but would silently read
    // stale data here if this scan ever ran while that cache represented
    // something not yet flushed to storage. A fresh direct read on every
    // month-document, every time this builds, costs little (called once at
    // init, incrementally maintained after) and removes that whole class of
    // staleness bug outright.
    const raw = await safeGet(fullKey);
    let monthObj = {};
    if(raw){ try{ monthObj = JSON.parse(raw) || {}; }catch(e){} }
    Object.keys(monthObj).forEach(date=>{
      (monthObj[date] || []).forEach(bill=>{
        if(!bill.supplier) return;
        const key = supplierKey(bill.supplier);
        if(!index[key]) index[key] = new Set();
        index[key].add(restId);
      });
    });
  }
  return index;
}
async function loadSupplierUsageIndex(){
  supplierUsageIndex = await buildSupplierUsageIndex();
}
// Call after saving a bill so the in-memory index stays correct without a
// full rescan — same spirit as updating `entries` in place rather than
// reloading everything after a local change.
function recordSupplierUsage(supplierName, restaurantId){
  const key = supplierKey(supplierName);
  if(!supplierUsageIndex[key]) supplierUsageIndex[key] = new Set();
  supplierUsageIndex[key].add(restaurantId);
}
// Whether `name` should appear in a supplier picker for `restaurantId` —
// visible if never billed anywhere yet, or if this restaurant has billed
// it at least once.
function supplierVisibleForRestaurant(name, restaurantId){
  const usage = supplierUsageIndex[supplierKey(name)];
  return !usage || usage.size === 0 || usage.has(restaurantId);
}

// ---- Staff directory (added 2026-10-01) ----
// One flat document per restaurant — `rest:<id>:staff` — holding the whole
// employee array, same shape as suppliers/categories (a static-ish master
// list, not a daily transactional log, so no month-bucketing needed here).
// Unlike suppliers, staff are NOT shared across restaurants — an employee
// genuinely works at one restaurant, so each restaurant's list is its own
// document, keyed by the restaurant id actually chosen in the Staff tab's
// own selector (Owner) or the logged-in Manager's restaurant — never
// `currentRestaurantId` implicitly, since that would tie this tab's
// selection to whatever the Add Expenses toolbar happens to be showing.
function staffKeyFor(restaurantId){ return "rest:" + restaurantId + ":staff"; }
async function loadStaffList(restaurantId){
  const raw = await safeGet(staffKeyFor(restaurantId));
  if(raw){ try{ return JSON.parse(raw) || []; }catch(e){} }
  return [];
}
async function saveStaffList(restaurantId, list){
  await safeSet(staffKeyFor(restaurantId), JSON.stringify(list));
}

// Shared, account-wide memory of {bankName, ifscCode, bankBranch} triples
// already used for some employee, somewhere — deliberately NOT
// restaurant-scoped, since a bank branch is a real-world entity that can
// plausibly serve employees at more than one of the account's restaurants.
// Mirrors supplierDefaults' "remember it so the next entry is a pick, not a
// retype" role, just for a few fields instead of one. bankBranch isn't part
// of the dedup key (IFSC alone already uniquely identifies the branch in
// reality) — it's just carried along, and opportunistically backfilled onto
// an existing pair that didn't have one yet.
const STAFF_BANK_DEFAULTS_KEY = "staffBankDefaults";
let staffBankDefaults = []; // [{bankName, ifscCode, bankBranch}]
async function loadStaffBankDefaults(){
  const raw = await safeGet(STAFF_BANK_DEFAULTS_KEY);
  if(raw){ try{ staffBankDefaults = JSON.parse(raw) || []; return; }catch(e){} }
  staffBankDefaults = [];
}
async function saveStaffBankDefaults(){ await safeSet(STAFF_BANK_DEFAULTS_KEY, JSON.stringify(staffBankDefaults)); }
// Returns true if this created a new pair or filled in a previously-missing
// branch on an existing one (caller can skip re-saving otherwise).
function rememberBankDefault(bankName, ifscCode, bankBranch){
  if(!bankName || !ifscCode) return false;
  const existing = staffBankDefaults.find(b =>
    b.bankName.trim().toLowerCase() === bankName.trim().toLowerCase() &&
    b.ifscCode.trim().toUpperCase() === ifscCode.trim().toUpperCase());
  if(existing){
    if(bankBranch && !existing.bankBranch){ existing.bankBranch = bankBranch.trim(); return true; }
    return false;
  }
  staffBankDefaults.push({ bankName: bankName.trim(), ifscCode: ifscCode.trim().toUpperCase(), bankBranch: (bankBranch||"").trim() });
  return true;
}

// ---- Daily OT / Captain Incentive / Waiter Tips / Staff Advance (added
// 2026-10-01, extended 2026-10-02 with Captain Incentive + Waiter Tips, then
// again the same day with Staff Advance) ----
// Month-bucketed exactly like bills — `rest:<id>:ot:<YYYY-MM>` ->
// { "<date>": [...entries for that day] } — since all four are logged day
// by day, not once a month. The Firestore key stays "ot" (not renamed to
// something more generic) purely for backward compatibility with data
// already saved under it before the other types existed — `type`
// distinguishes them now, defaulting to 'ot' for any pre-existing entry
// that predates this field. Each entry carries a denormalized
// `employeeName` snapshot alongside `employeeId` (the employee's internal
// uid(), not their editable "Employee ID" text field) so a later-renamed or
// removed employee doesn't leave past entries pointing at a name that can
// no longer be found — same convention bills already use for supplier
// names. There is deliberately no paid/unpaid status on these entries
// (removed 2026-10-02, along with the toggle UI and the Combined report's
// "unpaid only" filter) -- unlike bills/sales, nothing here tracks payment
// status at all.
function otMonthKeyFor(restaurantId, monthKey){ return "rest:" + restaurantId + ":ot:" + monthKey; }
async function loadOTMonth(restaurantId, monthKey){
  const raw = await safeGet(otMonthKeyFor(restaurantId, monthKey));
  if(raw){ try{ return JSON.parse(raw) || {}; }catch(e){} }
  return {};
}
async function addOTEntry(restaurantId, date, employeeId, employeeName, amount, type){
  const monthKey = date.slice(0,7);
  const month = await loadOTMonth(restaurantId, monthKey);
  if(!month[date]) month[date] = [];
  const entry = { id: uid(), employeeId, employeeName, amount: Number(amount), type: type || 'ot', createdAt: Date.now() };
  month[date].push(entry);
  await safeSet(otMonthKeyFor(restaurantId, monthKey), JSON.stringify(month));
  return entry;
}
async function toggleOTVerified(restaurantId, date, otId, by){
  const monthKey = date.slice(0,7);
  const month = await loadOTMonth(restaurantId, monthKey);
  const entry = (month[date] || []).find(e => e.id === otId);
  if(!entry) return null;
  entry.verified = !entry.verified;
  entry.verifiedBy = entry.verified ? by : null;
  entry.verifiedAt = entry.verified ? Date.now() : null;
  await safeSet(otMonthKeyFor(restaurantId, monthKey), JSON.stringify(month));
  return entry;
}
async function deleteOTEntry(restaurantId, date, otId){
  const monthKey = date.slice(0,7);
  const month = await loadOTMonth(restaurantId, monthKey);
  month[date] = (month[date] || []).filter(e => e.id !== otId);
  await safeSet(otMonthKeyFor(restaurantId, monthKey), JSON.stringify(month));
}

// ---- Per-day submit/lock for OT / Captain Incentive / Waiter Tips / Staff
// Advance (added 2026-10-02) ---- A separate key (not a field on the
// entries themselves) so the entries' own shape never needs to change.
// `rest:<id>:otSubmitted:<YYYY-MM>` -> { "<date>": { ot: true,
// captain_incentive: true, ... } }, one flag per type per date, since each
// of the four lists is submitted independently. Once true, the Manager
// profile can no longer add, edit, or delete entries for that type on that
// date -- the Owner profile is never restricted by this flag (see staff-tab.js's
// staffCanEditDaily()) and there is deliberately no "unsubmit" action in the
// UI at all -- an Owner who needs to fix something just edits directly,
// logged in as Owner, rather than reopening the list first.
function otSubmissionKeyFor(restaurantId, monthKey){ return "rest:" + restaurantId + ":otSubmitted:" + monthKey; }
async function loadOTSubmissions(restaurantId, monthKey){
  const raw = await safeGet(otSubmissionKeyFor(restaurantId, monthKey));
  if(raw){ try{ return JSON.parse(raw) || {}; }catch(e){} }
  return {};
}
async function isOTListSubmitted(restaurantId, date, type){
  const subs = await loadOTSubmissions(restaurantId, date.slice(0,7));
  return !!(subs[date] && subs[date][type]);
}
async function submitOTList(restaurantId, date, type){
  const monthKey = date.slice(0,7);
  const subs = await loadOTSubmissions(restaurantId, monthKey);
  if(!subs[date]) subs[date] = {};
  subs[date][type] = true;
  await safeSet(otSubmissionKeyFor(restaurantId, monthKey), JSON.stringify(subs));
}

// ---- Monthly salary (added 2026-10-01) ----
// `rest:<id>:salary:<YYYY-MM>` -> { "<employeeId>": {employeeName, amount,
// status, paidAt} } — one entry per employee per month (unlike OT, salary
// is a single figure per person per month, not a running list of entries).
function salaryMonthKeyFor(restaurantId, monthKey){ return "rest:" + restaurantId + ":salary:" + monthKey; }
async function loadSalaryMonth(restaurantId, monthKey){
  const raw = await safeGet(salaryMonthKeyFor(restaurantId, monthKey));
  if(raw){ try{ return JSON.parse(raw) || {}; }catch(e){} }
  return {};
}
// Saves/overwrites one employee's salary amount for the month — does NOT
// touch paid status (editing the amount after it's marked paid shouldn't
// silently flip it back to unpaid; the two are deliberately separate actions).
async function saveSalaryAmount(restaurantId, monthKey, employeeId, employeeName, amount){
  const month = await loadSalaryMonth(restaurantId, monthKey);
  const existing = month[employeeId];
  month[employeeId] = {
    employeeName, amount: Number(amount),
    status: existing ? existing.status : 'unpaid',
    paidAt: existing ? existing.paidAt : null
  };
  await safeSet(salaryMonthKeyFor(restaurantId, monthKey), JSON.stringify(month));
  return month[employeeId];
}
async function toggleSalaryPaid(restaurantId, monthKey, employeeId, employeeName, amount){
  const month = await loadSalaryMonth(restaurantId, monthKey);
  if(!month[employeeId]){
    // No saved entry yet for this month (still just showing the employee's
    // default salary as a suggestion) -- toggling Paid implicitly saves it
    // first, same as a bill/sales entry always exists before it can be paid.
    month[employeeId] = { employeeName, amount: Number(amount), status: 'unpaid', paidAt: null };
  }
  const entry = month[employeeId];
  entry.status = entry.status === 'paid' ? 'unpaid' : 'paid';
  entry.paidAt = entry.status === 'paid' ? Date.now() : null;
  await safeSet(salaryMonthKeyFor(restaurantId, monthKey), JSON.stringify(month));
  return entry;
}

// ---- Salary by Days Present (added 2026-10-09) ----
// Separate from the flat Monthly Salary feature above (still hidden from the
// UI). `rest:<id>:salaryDays:<YYYY-MM>` -> { employeeId: { days, savedAt } }
// stores ONLY the days-present input -- gross/advances/net are always
// computed fresh (staff-tab.js) from the employee's current default salary,
// the days in that calendar month, and that month's Staff Advance total, so
// editing a salary or an advance afterward is reflected immediately without
// needing to re-save anything here.
// ---- Bank transfer settings (added 2026-10-09) ----
// One shared "debit account number" (the business's own account the bank
// bulk-payment file pays FROM), used on every row of every bank-transfer
// download regardless of restaurant -- the user explicitly chose "one
// account for everything" over a per-restaurant value. Deliberately never
// committed to git (unlike app/tenant.js) and never typed into chat -- it's
// entered once in the Staff tab and stored the same account-wide way
// staffBankDefaults already is.
const BANK_DEBIT_ACCOUNT_KEY = "bankDebitAccountNumber";
let bankDebitAccountNumber = "";
async function loadBankDebitAccountNumber(){
  const raw = await safeGet(BANK_DEBIT_ACCOUNT_KEY);
  bankDebitAccountNumber = raw || "";
  return bankDebitAccountNumber;
}
async function saveBankDebitAccountNumber(value){
  bankDebitAccountNumber = (value || "").trim();
  await safeSet(BANK_DEBIT_ACCOUNT_KEY, bankDebitAccountNumber);
}

function salaryDaysKeyFor(restaurantId, monthKey){ return "rest:" + restaurantId + ":salaryDays:" + monthKey; }
async function loadSalaryDays(restaurantId, monthKey){
  const raw = await safeGet(salaryDaysKeyFor(restaurantId, monthKey));
  if(raw){ try{ return JSON.parse(raw) || {}; }catch(e){} }
  return {};
}
async function saveSalaryDaysForEmployee(restaurantId, monthKey, employeeId, days){
  const obj = await loadSalaryDays(restaurantId, monthKey);
  obj[employeeId] = { days: Number(days) || 0, savedAt: Date.now() };
  await safeSet(salaryDaysKeyFor(restaurantId, monthKey), JSON.stringify(obj));
  return obj[employeeId];
}
// Sums that month's Staff Advance entries per employee -- same
// `rest:<id>:ot:<YYYY-MM>` collection OT/Incentive/Tips/Advance all share,
// filtered to type === 'advance'. Only that one calendar month counts, by
// design (an advance given in an earlier month was already deducted then).
async function computeStaffAdvanceTotalsForMonth(restaurantId, monthKey){
  const totals = {};
  const month = await loadOTMonth(restaurantId, monthKey);
  Object.keys(month).forEach(date=>{
    (month[date] || []).forEach(e=>{
      if((e.type || 'ot') !== 'advance') return;
      totals[e.employeeId] = (totals[e.employeeId] || 0) + Number(e.amount || 0);
    });
  });
  return totals;
}

let saveErrorShown = false;
function showSaveError(){
  if(saveErrorShown) return;
  saveErrorShown = true;
  const banner = document.createElement('div');
  banner.textContent = "This browser is blocking local storage (e.g. private/incognito mode) — entries are still being saved to the cloud (Firebase) as long as you're online, but this device won't keep an offline backup copy. Try a normal browser window to fix that.";
  banner.style.cssText = "background:#B23A2E;color:#fff;padding:10px 20px;font-family:'IBM Plex Mono',monospace;font-size:12px;text-align:center;";
  document.body.insertBefore(banner, document.body.firstChild);
}

