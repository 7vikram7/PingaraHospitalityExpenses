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

// Supplier bank details (added 2026-10-15, for the Vendor Ledger tab's
// pending-bills bank-transfer download) -- shared account-wide, same scope
// as supplierDefaults, not restaurant-scoped.
async function loadSupplierBankDetails(){
  const raw = await safeGet(supBankDetailsKey());
  if(raw){ try{ supplierBankDetails = JSON.parse(raw) || {}; return; }catch(e){} }
  supplierBankDetails = {};
}
async function saveSupplierBankDetails(){ await safeSet(supBankDetailsKey(), JSON.stringify(supplierBankDetails)); }
// NEFT needs both an account number and an IFSC code -- same bar
// staffEmployeeHasFullBankDetails() applies to staff.
function supplierHasFullBankDetails(name){
  const d = supplierBankDetails[supplierKey(name)];
  return !!(d && d.accountNumber && d.accountNumber.trim() && d.ifscCode && d.ifscCode.trim());
}
// Looser bar -- an account number on file, IFSC not required -- added
// 2026-10-20 for the "with/without bank account" list filters (Vendor
// Ledger, Payments, Suppliers tabs). Mirrors staffEmployeeHasBankAccount()'s
// own looser bar vs. staffEmployeeHasFullBankDetails(), same split.
function supplierHasBankAccount(name){
  const d = supplierBankDetails[supplierKey(name)];
  return !!(d && d.accountNumber && d.accountNumber.trim());
}

// ---- Month-bucketed bills & sales ----
// One document per restaurant per month (not per day) — e.g. "rest:savali:bills:2026-07"
// holds { "2026-07-01": [...entries], "2026-07-02": [...], ... }. This keeps well under
// Firestore's 1 MiB document cap (a full month of entries is only ~100-150 KB) while cutting
// report reads roughly 30x versus one document per day.
function billsMonthKey(monthKey){ return restPrefix() + "bills:" + monthKey; }
function salesMonthKey(monthKey){ return restPrefix() + "sales:" + monthKey; }
function salesMetaKey(monthKey){ return restPrefix() + "salesMeta:" + monthKey; }

// billsMonthCache/currentBillsMonthCacheKey stay a plain READ cache (day
// navigation within the Add Expenses tab re-fetches only on a month
// change) -- that part was never the problem. The problem was several
// WRITE paths below also trusting this same cache instead of re-reading
// before merging their change in, which is how a browser tab left open
// since before someone else's edit could silently save a stale full
// month back over it, wiping that edit out. See withFreshBillsMonth().
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
  entriesBaseline = JSON.parse(JSON.stringify(entries)); // see saveEntries()
}

// The one place every bill-document WRITE routes through (added
// 2026-10-20, after two real incidents -- "Laxmi Departments" reverting
// 2026-10-16, "Al Taqdeer Foods" reverting for Umami La Delice
// 2026-10-20 -- both traced to a stale in-memory month object getting
// saved back over a change made by another session/action in the
// meantime). ALWAYS fetches the current server copy immediately before
// `mutate` touches it -- never reuses billsMonthCache for a write, even
// when it looks like "the same month we already have loaded" -- then
// writes back and, only if this key is the restaurant+month currently
// being viewed, resyncs billsMonthCache so this session's own day
// navigation still sees its own fresh write (otherwise flipping to
// another day in the same month would show stale data until a reload).
// Wrapped in showGlobalSaving()/hideGlobalSaving() so the whole app
// visibly pauses for the ~1 read + 1 write this takes, making it far
// harder for a second action in the SAME session to start mid-write and
// race this one too -- the other half of the same class of bug.
// `mutate` returning `undefined` (no explicit return, or an explicit
// `return undefined`/bare `return`) means "nothing to write" and skips
// the safeSet entirely -- preserves the pre-existing behavior of
// toggleBillStatusByLocation() et al., which never wrote anything back
// when the target bill id couldn't be found. Any other return value
// (including `null`) is treated as "write it" and passed through as this
// function's own return value.
async function withFreshBillsMonth(key, mutate){
  showGlobalSaving();
  try{
    const monthObj = JSON.parse((await safeGet(key)) || "{}") || {};
    const result = await mutate(monthObj);
    if(result === undefined) return undefined;
    await safeSet(key, JSON.stringify(monthObj));
    if(key === billsMonthKey(currentDate.slice(0,7))){
      billsMonthCache = monthObj;
      currentBillsMonthCacheKey = key;
    }
    return result;
  } finally {
    hideGlobalSaving();
  }
}

// NOTE: withFreshBillsMonth() alone fetches a fresh MONTH DOCUMENT, but that
// isn't enough here on its own -- `entries` is this session's in-memory
// view of one DAY within that document, loaded at some earlier point, and
// a naive `month[currentDate] = entries` would still blindly replace that
// day with this session's possibly-stale copy, wiping out anything another
// session/tab wrote to the SAME day since (e.g. a Payments-tab mark-paid
// elsewhere) -- this is exactly how the Al Taqdeer/Umami incident happened,
// and a dedicated regression test (test_fresh_fetch_race_fix.js) caught
// this same gap in the first version of this fix. So instead this does a
// proper 3-way merge against `entriesBaseline` (the day's shape as last
// loaded by THIS session): a bill missing from `entries` but present in
// the baseline was explicitly deleted by this session and is dropped; a
// bill present in the fresh server day but absent from both this
// session's `entries` AND its baseline was added by someone else since and
// is kept; anything else uses this session's own (possibly edited) copy.
async function saveEntries(){
  const monthKey = currentDate.slice(0,7);
  const date = currentDate;
  const clientEntries = entries;
  const baselineById = {};
  entriesBaseline.forEach(b => { baselineById[b.id] = b; });
  const clientById = {};
  clientEntries.forEach(e => { clientById[e.id] = e; });
  const deletedIds = new Set(entriesBaseline.filter(b => !clientById[b.id]).map(b => b.id));

  const merged = await withFreshBillsMonth(billsMonthKey(monthKey), (month)=>{
    const freshDay = month[date] || [];
    const result = freshDay
      .filter(b => !deletedIds.has(b.id))
      .map(b => {
        const clientVersion = clientById[b.id];
        if(!clientVersion) return b; // shouldn't happen (would be in deletedIds above), but keep the fresh copy defensively
        const baselineVersion = baselineById[b.id];
        // Only let this session's copy win if it actually differs from what
        // this session last loaded for that bill -- otherwise it's just an
        // untouched, possibly-stale carry-along, and the fresh server copy
        // (which may carry someone else's concurrent change, e.g. a paid
        // toggle) must win instead.
        const editedThisSession = !baselineVersion || JSON.stringify(baselineVersion) !== JSON.stringify(clientVersion);
        return editedThisSession ? clientVersion : b;
      });
    clientEntries.forEach(e => {
      if(!freshDay.some(b => b.id === e.id)) result.push(e); // brand-new bill from this session
    });
    month[date] = result;
    return result;
  });

  // Adopt the merged result as the new in-memory state and baseline, so a
  // concurrent addition from elsewhere becomes visible on next render, and
  // so the next saveEntries() call diffs against what's actually on the
  // server rather than against this call's pre-merge snapshot.
  entries = merged;
  entriesBaseline = JSON.parse(JSON.stringify(merged));
}

// Moves a single bill from the currently-viewed date to a different date (used by
// the Modify-bill date field). The entry's own fields should already be updated by
// the caller before this runs — this only relocates it between day-buckets, which
// may mean a different month document entirely.
async function moveEntryDate(entry, newDate){
  entries = entries.filter(x => x.id !== entry.id);
  await saveEntries(); // persists the current month bucket without this entry (fresh-fetch, see above)

  const targetKey = billsMonthKey(newDate.slice(0,7));
  await withFreshBillsMonth(targetKey, (targetMonthObj)=>{
    if(!targetMonthObj[newDate]) targetMonthObj[newDate] = [];
    targetMonthObj[newDate].push(entry);
    return true;
  });
}

// Toggles paid/unpaid for a bill identified by restaurant+date+id rather than
// by position in the currently-loaded `entries` array — used by the Vendor
// Ledger tab, where a bill's restaurant/date may not be the one currently
// active in the Add Expenses tab. Always fetches fresh via
// withFreshBillsMonth() (added 2026-10-20 -- see its own comment) rather
// than reusing a possibly-stale cached month, and keeps the live `entries`
// array in sync if it's the same day being viewed.
async function toggleBillStatusByLocation(restaurantId, date, billId){
  const key = "rest:" + restaurantId + ":bills:" + date.slice(0,7);
  const bill = await withFreshBillsMonth(key, (monthObj)=>{
    const dayBills = monthObj[date] || [];
    const b = dayBills.find(x => x.id === billId);
    if(!b) return undefined; // not found -- withFreshBillsMonth skips the write entirely
    b.status = b.status === 'paid' ? 'unpaid' : 'paid';
    b.paidAt = b.status === 'paid' ? Date.now() : null;
    return b;
  });
  if(!bill) return null;

  if(restaurantId === currentRestaurantId && date === currentDate){
    const localEntry = entries.find(e => e.id === billId);
    if(localEntry){ localEntry.status = bill.status; localEntry.paidAt = bill.paidAt; }
  }
  return bill;
}

// Bulk version of toggleBillStatusByLocation() for the Payments tab (added
// 2026-10-17) -- marks a whole batch of bills paid in one pass instead of
// one Firestore round-trip per bill, since a real payment run can be
// dozens of bills across several restaurants/months at once. `bills` is
// [{restaurantId, date, id}]; grouped by restaurant+month doc so each
// month document is read and written at most once regardless of how many
// of its bills are in the batch. Only ever sets status forward to 'paid'
// on EXISTING bill records at the moment this runs -- there is no
// date-range-level "paid" flag anywhere, so a bill added later (even
// dated inside an already-processed range) is a brand-new record that
// starts 'unpaid' as always, same as any other new bill. Returns how many
// bills were actually flipped (already-paid ones in the batch don't
// recount).
async function markBillsPaid(bills){
  const byDoc = {}; // "rest:<id>:bills:<YYYY-MM>" -> [{date, id}]
  bills.forEach(({ restaurantId, date, id })=>{
    const key = "rest:" + restaurantId + ":bills:" + date.slice(0,7);
    if(!byDoc[key]) byDoc[key] = { restaurantId, items: [] };
    byDoc[key].items.push({ date, id });
  });

  let updatedCount = 0;
  for(const key of Object.keys(byDoc)){
    const { restaurantId, items } = byDoc[key];
    await withFreshBillsMonth(key, (monthObj)=>{
      let changed = false;
      items.forEach(({ date, id })=>{
        const bill = (monthObj[date] || []).find(b => b.id === id);
        if(!bill || bill.status === 'paid') return;
        bill.status = 'paid';
        bill.paidAt = Date.now();
        changed = true;
        updatedCount++;
        if(restaurantId === currentRestaurantId && date === currentDate){
          const localEntry = entries.find(e => e.id === id);
          if(localEntry){ localEntry.status = bill.status; localEntry.paidAt = bill.paidAt; }
        }
      });
      return changed ? true : undefined; // undefined -- withFreshBillsMonth skips the write when nothing in this doc changed
    });
  }
  return updatedCount;
}

// ---- Cross-verification (added 2026-10-06) ----
// A bill's verified flag lives on the bill itself (same doc as its status), so
// it reads and writes exactly like the paid toggle. Sales verification is kept
// in its own key rather than on the sales figure, so every existing reader of
// the sales bucket is untouched.
async function toggleBillVerifiedByLocation(restaurantId, date, billId, by){
  const key = "rest:" + restaurantId + ":bills:" + date.slice(0,7);
  const bill = await withFreshBillsMonth(key, (monthObj)=>{
    const b = (monthObj[date] || []).find(x => x.id === billId);
    if(!b) return undefined;
    b.verified = !b.verified;
    b.verifiedBy = b.verified ? by : null;
    b.verifiedAt = b.verified ? Date.now() : null;
    return b;
  });
  if(!bill) return null;

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
// Fetches fresh immediately before merging in the one day's value, same
// reasoning as withFreshBillsMonth() above (added 2026-10-20) -- saveSalesValue()
// had the identical structural flaw: load the month doc via the cache
// (which may be stale), set one day, write the WHOLE month back, silently
// reverting every other day's sales figure if the cache was out of date.
async function saveSalesValue(){
  const input = document.getElementById('salesInput');
  const val = parseFloat(input.value);
  if(isNaN(val) || val < 0) return false;
  const monthKey = currentDate.slice(0,7);
  const monthCacheKey = salesMonthKey(monthKey);
  const metaCacheKey = salesMetaKey(monthKey);
  showGlobalSaving();
  try{
    const month = JSON.parse((await safeGet(monthCacheKey)) || "{}") || {};
    month[currentDate] = val;
    await safeSet(monthCacheKey, JSON.stringify(month));
    salesMonthCache = month;
    currentSalesMonthCacheKey = monthCacheKey;

    const meta = JSON.parse((await safeGet(metaCacheKey)) || "{}") || {};
    if(!meta[currentDate]){
      meta[currentDate] = Date.now();
      await safeSet(metaCacheKey, JSON.stringify(meta));
    }
    salesMetaCache = meta;
    currentSalesMetaCacheKey = metaCacheKey;

    currentSales = val;
    currentSalesSavedAt = meta[currentDate];
    return true;
  } finally {
    hideGlobalSaving();
  }
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

// Retroactively applies a supplier's new name/category/subcategory to every
// past bill logged under its OLD name, across every restaurant and every
// month — not just new bills going forward. Originally just category/
// subcategory (`propagateSupplierCategoryToAllBills`, renaming never
// touched history); generalized 2026-10-19 to also rewrite the bill's
// `supplier` field on a real rename, at the user's explicit request to make
// a name correction just as retroactive as a category correction already
// was. Both kinds of change are handled in a SINGLE pass deliberately —
// doing them as two separate scans would have the second scan try to match
// bills by the OLD name right after the first scan already rewrote it,
// finding nothing. Pass `oldName === newName` for a category-only change
// (no rename) — the no-op rename check below correctly skips rewriting
// `supplier` in that case. Returns how many bills were actually changed.
// Bills are matched by supplierKey() (case/whitespace-insensitive), same
// normalization supplierDefaults itself uses.
async function propagateSupplierEditToAllBills(oldName, newName, newCategory, newSubcategory){
  const key = supplierKey(oldName);
  const monthKeys = await listAllRestaurantsBillMonthKeys();
  let updatedCount = 0;
  const currentMonthKey = billsMonthKey(currentDate.slice(0,7)); // compared AFTER each write below, not cached up front
  for(const fullKey of monthKeys){
    const docChanged = await withFreshBillsMonth(fullKey, (monthObj)=>{
      let changed = false;
      Object.keys(monthObj).forEach(date=>{
        (monthObj[date] || []).forEach(bill=>{
          if(supplierKey(bill.supplier) !== key) return;
          let billChanged = false;
          if(bill.supplier !== newName){
            bill.supplier = newName;
            billChanged = true;
          }
          if(bill.category !== newCategory || (bill.subcategory||"") !== (newSubcategory||"")){
            bill.category = newCategory;
            bill.subcategory = newSubcategory || "";
            billChanged = true;
          }
          if(billChanged){ changed = true; updatedCount++; }
        });
      });
      return changed ? true : undefined; // undefined -- withFreshBillsMonth skips the write for a month with nothing to change
    });
    // withFreshBillsMonth already resynced billsMonthCache if this was the
    // current restaurant+month -- this just makes sure the Add Expenses
    // tab's rendered DOM catches up too, if it's showing the month that
    // was just changed underneath it.
    if(docChanged && fullKey === currentMonthKey){
      renderTable(); renderTotals(); renderBreakdown();
    }
  }
  return updatedCount;
}

// Finds every distinct supplier name used in ANY bill, across every
// restaurant and month, that doesn't match (via supplierKey()) any name
// currently in the `suppliers` directory -- these are "orphaned" names: a
// vendor bills were logged against that isn't (or isn't anymore) in the
// directory, so the Suppliers tab's own list never shows it even though
// Vendor Ledger (which reads bills directly, not the directory) does.
// Added 2026-10-19 for the "combine duplicate suppliers" tool, after a real
// case surfaced live: a supplier removed from the directory (or never
// added) while still actively being billed. Returns [{name, count}] sorted
// by count descending. Only called on demand (entering combine mode), not
// on every tab load, since it's a full cross-restaurant bill scan.
async function findOrphanSupplierNamesInBills(){
  const directoryKeys = new Set(suppliers.map(supplierKey));
  const monthKeys = await listAllRestaurantsBillMonthKeys();
  const counts = {}; // exact name -> count
  for(const fullKey of monthKeys){
    const isCachedCurrentMonth = fullKey === currentBillsMonthCacheKey;
    const monthObj = isCachedCurrentMonth ? billsMonthCache
      : (JSON.parse((await safeGet(fullKey)) || "{}") || {});
    Object.keys(monthObj).forEach(date=>{
      (monthObj[date] || []).forEach(bill=>{
        if(!bill.supplier || directoryKeys.has(supplierKey(bill.supplier))) return;
        counts[bill.supplier] = (counts[bill.supplier] || 0) + 1;
      });
    });
  }
  return Object.keys(counts).map(name => ({ name, count: counts[name] })).sort((a,b) => b.count - a.count);
}

// ---- Suggested similar vendors (added 2026-10-18) ----
// Fuzzy-matches supplier names to catch the same real vendor entered under
// different spellings (a staff typo, a shortened name, a casing
// difference) that supplierKey()'s exact-after-normalize matching doesn't
// catch -- the whole reason the "combine duplicate suppliers" tool above
// needs a human to already suspect two specific names are the same. This
// proactively surfaces candidates instead.
//
// Threshold and the two down-weighted word lists below were tuned against
// Pingara's real 275-supplier list (not invented numbers) via a throwaway
// scratch script, through two rounds of real false positives:
//   1. Generic Indian business-type suffixes ("Enterprises", "Traders",
//      "Electricals", "Hardware", ...) are shared by dozens of unrelated
//      vendors -- "N R ENTERPRISES" vs "S D Enterprises" scored a perfect
//      1.0 on raw token overlap despite being obviously different vendors.
//   2. Common devotional/auspicious name-prefixes ("Laxmi", "Shri",
//      "Shree", "Sai", "Ganesh", ...) are just as widely shared --
//      "Laxmi Electrical" vs "Laxmi Departmental Stores" also scored a
//      false 1.0 sharing only "laxmi".
// Both lists exist so a pair only counts as a candidate when it shares (or
// near-matches) something genuinely DISTINCTIVE, not just a common
// suffix/prefix -- see distinctiveRemainder()/tokenSimilarity() below.
// 0.80 is where the real data's good matches cluster; below roughly 0.75
// it's dominated by coincidentally-similar-shaped short Hindi names
// ("Shriram"/"Shivam"/"Shivaay"/"Sairam") that aren't actually related.
const SIMILAR_VENDOR_THRESHOLD = 0.80;
const SIMILAR_VENDOR_GENERIC_WORDS = new Set([
  'enterprise','enterprises','trader','traders','hardware','electrical','electricals',
  'marketing','service','services','store','stores','agency','agencies','company','co',
  'pvt','ltd','foods','food','dairy','mart','supplier','suppliers','distributor',
  'distributors','sales','industry','industries','corporation','corp','kirana',
  'departmental','department','general','wholesale','retail','and','the','of',
  'shri','shree','sri','laxmi','lakshmi','sai','ganesh','ganpati','balaji','om','jai',
  'shiv','shiva','krishna','ram','rama','hanuman','durga','maa','mauli','new','shubh','swami'
]);
function svNormalize(name){
  return (name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function svTokenize(name){
  return svNormalize(name).split(' ').filter(Boolean);
}
function svDistinctiveRemainder(name){
  return svTokenize(name).filter(t => !SIMILAR_VENDOR_GENERIC_WORDS.has(t)).join(' ');
}
function svLevenshtein(a, b){
  const m = a.length, n = b.length;
  if(m === 0) return n;
  if(n === 0) return m;
  let prev = Array.from({length: n+1}, (_,i)=>i);
  for(let i = 1; i <= m; i++){
    const cur = [i];
    for(let j = 1; j <= n; j++){
      cur[j] = a[i-1] === b[j-1] ? prev[j-1] : 1 + Math.min(prev[j-1], prev[j], cur[j-1]);
    }
    prev = cur;
  }
  return prev[n];
}
function svLevenshteinRatio(a, b){
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - svLevenshtein(a, b) / maxLen;
}
// Jaccard-ish token overlap, generic words included but requiring at least
// one genuinely distinctive shared-or-stemmed token before it counts --
// see hasDistinctiveMatch below, the gate that keeps shared-suffix-only
// pairs from ever qualifying.
function svTokenSimilarity(a, b){
  const ta = svTokenize(a), tb = svTokenize(b);
  const sa = new Set(ta), sb = new Set(tb);
  if(sa.size === 0 || sb.size === 0) return { score: 0, hasDistinctiveMatch: false };
  let shared = 0, hasDistinctiveMatch = false;
  sa.forEach(t => {
    if(sb.has(t)){
      shared++;
      if(!SIMILAR_VENDOR_GENERIC_WORDS.has(t)) hasDistinctiveMatch = true;
    }
  });
  let stemShared = 0;
  sa.forEach(ta_t => {
    if(sb.has(ta_t) || SIMILAR_VENDOR_GENERIC_WORDS.has(ta_t)) return;
    sb.forEach(tb_t => {
      if(sa.has(tb_t) || SIMILAR_VENDOR_GENERIC_WORDS.has(tb_t)) return;
      if(ta_t.length >= 4 && tb_t.length >= 4){
        const pfx = Math.min(5, ta_t.length, tb_t.length);
        if(ta_t.slice(0, pfx) === tb_t.slice(0, pfx)){ stemShared += 0.7; hasDistinctiveMatch = true; }
      }
    });
  });
  const union = sa.size + sb.size - shared;
  return { score: union === 0 ? 0 : (shared + stemShared) / union, hasDistinctiveMatch };
}
function svNameSimilarity(a, b){
  const na = svNormalize(a), nb = svNormalize(b);
  if(na === nb) return 1;
  const ra = svDistinctiveRemainder(a), rb = svDistinctiveRemainder(b);
  if(ra.length < 2 || rb.length < 2) return 0; // nothing distinctive left to compare
  const lev = svLevenshteinRatio(ra, rb);
  const { score: tok, hasDistinctiveMatch } = svTokenSimilarity(a, b);
  return hasDistinctiveMatch ? Math.max(tok, lev) : lev;
}
// Returns [{ names: [...], score }], sorted most-confident first. `names`
// always includes at least 2 entries (union-find over every qualifying
// pair, so a 3+-way match like "SHIVAM TRADER"/"Shivam Traders"/"SHIVAM
// TRADERS" lands in one group, not three separate pairwise suggestions).
// Candidate pool is the supplier directory plus orphaned bill-only names
// (findOrphanSupplierNamesInBills()) so a name that was never added to the
// directory at all can still surface as a likely duplicate of one that is.
async function findSimilarSupplierGroups(){
  const orphans = await findOrphanSupplierNamesInBills();
  const names = [...new Set([...suppliers, ...orphans.map(o => o.name)])];

  const parent = {};
  names.forEach(n => { parent[n] = n; });
  function find(n){ while(parent[n] !== n){ n = parent[n]; } return n; }
  function union(a, b){ const ra = find(a), rb = find(b); if(ra !== rb) parent[ra] = rb; }

  const bestScoreForPair = {};
  for(let i = 0; i < names.length; i++){
    for(let j = i + 1; j < names.length; j++){
      const score = svNameSimilarity(names[i], names[j]);
      if(score >= SIMILAR_VENDOR_THRESHOLD){
        union(names[i], names[j]);
        const root = find(names[i]);
        bestScoreForPair[root] = Math.max(bestScoreForPair[root] || 0, score);
      }
    }
  }

  const groups = {};
  names.forEach(n => {
    const root = find(n);
    if(!groups[root]) groups[root] = [];
    groups[root].push(n);
  });
  return Object.keys(groups)
    .filter(root => groups[root].length >= 2)
    .map(root => ({ names: groups[root].sort((a,b)=>a.localeCompare(b)), score: bestScoreForPair[root] || 0 }))
    .sort((a,b) => b.score - a.score);
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

