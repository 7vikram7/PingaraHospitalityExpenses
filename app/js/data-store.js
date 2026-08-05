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

let saveErrorShown = false;
function showSaveError(){
  if(saveErrorShown) return;
  saveErrorShown = true;
  const banner = document.createElement('div');
  banner.textContent = "This browser is blocking local storage (e.g. private/incognito mode) — entries are still being saved to the cloud (Firebase) as long as you're online, but this device won't keep an offline backup copy. Try a normal browser window to fix that.";
  banner.style.cssText = "background:#B23A2E;color:#fff;padding:10px 20px;font-family:'IBM Plex Mono',monospace;font-size:12px;text-align:center;";
  document.body.insertBefore(banner, document.body.firstChild);
}

