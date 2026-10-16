/* ---------- Vendor Ledger tab: per-vendor spend, all restaurants or one, for a period ----------
   Shares the Reports tab's owner password/session (same sensitivity — aggregate
   financial data across restaurants) rather than introducing a second password. */
let vlPeriodType = 'month';  // 'day' | 'month' | 'range'
let vlSelectedDate, vlSelectedMonth;
let vlRangeFrom, vlRangeTo;
let vlRestaurantFilter = 'all'; // 'all' or a restaurant id, set from the shared top-bar selector
let vlVendorSearch = ''; // free-text, case-insensitive substring match on vendor name (added 2026-10-18)

// Inclusive list of "YYYY-MM" month keys spanned by a date range — a range can
// cross month-bucket document boundaries, so every covered month needs its own fetch.
function monthsBetween(fromDate, toDate){
  const months = [];
  let y = Number(fromDate.slice(0,4)), m = Number(fromDate.slice(5,7));
  const endY = Number(toDate.slice(0,4)), endM = Number(toDate.slice(5,7));
  while(y < endY || (y === endY && m <= endM)){
    months.push(y + '-' + String(m).padStart(2,'0'));
    m++;
    if(m > 12){ m = 1; y++; }
  }
  return months;
}

function showVLPanel(){
  const unlocked = reportsUnlocked();
  document.getElementById('vlLock').style.display = unlocked ? 'none' : 'block';
  document.getElementById('vlContent').style.display = unlocked ? 'block' : 'none';
  if(unlocked){
    renderVendorLedger();
  }
}
document.getElementById('vlUnlockBtn').addEventListener('click', async ()=>{
  const input = document.getElementById('vlPasswordInput');
  const errEl = document.getElementById('vlLockError');
  errEl.classList.remove('show');
  const hash = await sha256Hex(input.value);
  if(hash === REPORTS_PASSWORD_HASH){
    try{ localStorage.setItem(REPORTS_UNLOCK_KEY, '1'); }catch(e){}
    input.value = '';
    showVLPanel();
  } else {
    errEl.classList.add('show');
  }
});
document.getElementById('vlPasswordInput').addEventListener('keydown', (ev)=>{
  if(ev.key === 'Enter') document.getElementById('vlUnlockBtn').click();
});

// Reuses fetchAllRestaurantsBillsForMonth (reports-dashboard.js) for every restaurant
// even when scoped to one, for simplicity — Firestore reads stay well within quota
// at this app's actual data volume (see CONTEXT.md). params is one of:
// {date}, {month}, or {from, to} depending on periodType.
async function computeVendorLedgerData(periodType, params, restaurantFilter){
  let monthKeys, dateFilter;
  if(periodType === 'day'){
    monthKeys = [params.date.slice(0,7)];
    dateFilter = (d)=> d === params.date;
  } else if(periodType === 'range'){
    const from = params.from <= params.to ? params.from : params.to;
    const to = params.from <= params.to ? params.to : params.from;
    monthKeys = monthsBetween(from, to);
    dateFilter = (d)=> d >= from && d <= to;
  } else {
    monthKeys = [params.month];
    dateFilter = ()=> true;
  }

  const billsAll = {};
  for(const mk of monthKeys){
    const monthBills = await fetchAllRestaurantsBillsForMonth(mk);
    RESTAURANTS.forEach(r=>{
      if(!billsAll[r.id]) billsAll[r.id] = {};
      Object.assign(billsAll[r.id], monthBills[r.id] || {});
    });
  }

  const vendors = {}; // supplier name -> { amount, paid, unpaid, count, restaurantIds:Set, bills:[] }
  RESTAURANTS.forEach(r=>{
    if(restaurantFilter !== 'all' && restaurantFilter !== r.id) return;
    const billsData = billsAll[r.id] || {};
    Object.keys(billsData).forEach(d=>{
      if(!dateFilter(d)) return;
      (billsData[d] || []).forEach(e=>{
        const name = e.supplier || 'Unknown';
        if(!vendors[name]) vendors[name] = { amount: 0, paid: 0, unpaid: 0, count: 0, restaurantIds: new Set(), bills: [] };
        const amt = Number(e.amount || 0);
        vendors[name].amount += amt;
        if(e.status === 'paid') vendors[name].paid += amt; else vendors[name].unpaid += amt;
        vendors[name].count += 1;
        vendors[name].restaurantIds.add(r.id);
        vendors[name].bills.push({
          id: e.id, date: d, restaurantId: r.id, invoice: e.invoice || '',
          amount: amt, status: e.status, paidAt: e.paidAt || null, createdAt: e.createdAt || 0,
          verified: !!e.verified
        });
      });
    });
  });

  const rows = Object.keys(vendors).map(name=>{
    const v = vendors[name];
    return {
      name,
      category: (supplierDefaults[supplierKey(name)] || {}).category || '—',
      amount: v.amount, paid: v.paid, unpaid: v.unpaid, count: v.count,
      restaurantIds: Array.from(v.restaurantIds),
      bills: v.bills.sort((a,b)=> b.date === a.date ? (b.createdAt - a.createdAt) : (b.date < a.date ? -1 : 1))
    };
  }).sort((a,b)=>b.amount-a.amount);

  const totals = rows.reduce((acc,r)=>({
    amount: acc.amount + r.amount,
    paid: acc.paid + r.paid,
    unpaid: acc.unpaid + r.unpaid
  }), { amount: 0, paid: 0, unpaid: 0 });

  return { rows, totals };
}

// Accordion: at most one vendor's detail open at a time — expanding a new one
// closes whichever was open. Persists across re-renders triggered by a status
// toggle inside the expanded detail, but is cleared whenever the restaurant/
// period filter changes (see the filter handlers below).
let vlExpandedVendor = null;
let vlLastRows = [];
let vlLastShowRestCol = false;

function buildVLDetailTable(row, showRestCol){
  const scroll = document.createElement('div');
  scroll.className = 'vl-detail-scroll';
  const table = document.createElement('table');
  table.className = 'vl-detail-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.innerHTML = '<th>Date</th>' + (showRestCol ? '<th>Restaurant</th>' : '') +
    '<th>Invoice #</th><th class="num">Amount</th><th>Status</th><th>Verified</th><th>Paid on</th>';
  thead.appendChild(headRow);

  const tbody = document.createElement('tbody');
  row.bills.forEach(b=>{
    const tr = document.createElement('tr');
    const tdDate = document.createElement('td'); tdDate.textContent = fmtDateLabel(b.date);
    tr.appendChild(tdDate);
    if(showRestCol){
      const tdRest = document.createElement('td');
      tdRest.textContent = restaurantLabel(b.restaurantId);
      tdRest.className = 'subcat';
      tr.appendChild(tdRest);
    }
    const tdInv = document.createElement('td'); tdInv.textContent = b.invoice || '—'; tdInv.className = 'subcat';
    const tdAmt = document.createElement('td'); tdAmt.className = 'amount'; tdAmt.textContent = fmtMoney(b.amount);
    tr.appendChild(tdInv); tr.appendChild(tdAmt);

    const tdStatus = document.createElement('td');
    const statusBtn = document.createElement('button');
    statusBtn.type = 'button';
    statusBtn.className = 'badge ' + b.status;
    statusBtn.textContent = b.status;
    statusBtn.addEventListener('click', async ()=>{
      statusBtn.disabled = true;
      await toggleBillStatusByLocation(b.restaurantId, b.date, b.id);
      await renderVendorLedger();
    });
    tdStatus.appendChild(statusBtn);
    tr.appendChild(tdStatus);

    const tdVerify = document.createElement('td');
    tdVerify.appendChild(buildVerifyControl(b.verified, canVerifyEntries, async ()=>{
      await toggleBillVerifiedByLocation(b.restaurantId, b.date, b.id, currentVerifierLabel());
      await renderVendorLedger();
    }));
    tr.appendChild(tdVerify);

    const tdPaidOn = document.createElement('td');
    tdPaidOn.className = 'subcat';
    tdPaidOn.textContent = b.paidAt ? fmtDateLabel(toDateStr(new Date(b.paidAt))) : '—';
    tr.appendChild(tdPaidOn);

    tbody.appendChild(tr);
  });
  table.appendChild(thead); table.appendChild(tbody);
  scroll.appendChild(table);
  return scroll;
}

function renderVLTable(rows, showRestCol){
  vlLastRows = rows;
  vlLastShowRestCol = showRestCol;
  const wrap = document.getElementById('vlTableWrap');
  wrap.innerHTML = "";
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.innerHTML = '<th>Vendor</th><th>Category</th>' +
    (showRestCol ? '<th>Restaurants</th>' : '') +
    '<th class="num">Bills</th><th class="num">Amount</th><th class="num">Paid</th><th class="num">Unpaid</th>';
  thead.appendChild(headRow);

  const tbody = document.createElement('tbody');
  rows.forEach(r=>{
    const expanded = vlExpandedVendor === r.name;
    const tr = document.createElement('tr');
    tr.className = 'vl-vendor-row';
    tr.tabIndex = 0;

    const tdName = document.createElement('td');
    tdName.className = 'supplier';
    tdName.innerHTML = `<span class="vl-expand-caret">${expanded ? '▾' : '▸'}</span>${escapeHtml(r.name)}`;
    const tdCat = document.createElement('td');
    tdCat.textContent = r.category; tdCat.className = 'subcat';
    tr.appendChild(tdName); tr.appendChild(tdCat);
    if(showRestCol){
      const tdRest = document.createElement('td');
      tdRest.textContent = r.restaurantIds.map(id=>restaurantLabel(id)).join(', ');
      tdRest.className = 'subcat';
      tr.appendChild(tdRest);
    }
    const tdCount = document.createElement('td'); tdCount.className = 'num'; tdCount.textContent = r.count;
    const tdAmt = document.createElement('td'); tdAmt.className = 'amount'; tdAmt.textContent = fmtMoney(r.amount);
    const tdPaid = document.createElement('td'); tdPaid.className = 'num'; tdPaid.textContent = fmtMoney(r.paid);
    const tdUnpaid = document.createElement('td'); tdUnpaid.className = 'num'; tdUnpaid.textContent = fmtMoney(r.unpaid);
    tr.appendChild(tdCount); tr.appendChild(tdAmt); tr.appendChild(tdPaid); tr.appendChild(tdUnpaid);

    const toggleExpand = ()=>{
      vlExpandedVendor = (vlExpandedVendor === r.name) ? null : r.name;
      renderVLTable(vlLastRows, vlLastShowRestCol);
    };
    tr.addEventListener('click', toggleExpand);
    tr.addEventListener('keydown', (ev)=>{
      if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); toggleExpand(); }
    });
    tbody.appendChild(tr);

    if(expanded){
      const detailTr = document.createElement('tr');
      detailTr.className = 'vl-detail-row';
      const detailTd = document.createElement('td');
      detailTd.colSpan = showRestCol ? 7 : 6;
      detailTd.appendChild(buildVLDetailTable(r, showRestCol));
      detailTr.appendChild(detailTd);
      tbody.appendChild(detailTr);
    }
  });
  table.appendChild(thead); table.appendChild(tbody);
  wrap.appendChild(table);
}

// The full computeVendorLedgerData() result for the current period/
// restaurant scope, BEFORE the vendor search filter -- cached here (added
// 2026-10-18) so typing in the search box re-filters and re-renders
// instantly from memory via applyVLSearchAndRender() instead of re-running
// the Firestore fetch on every keystroke the way a period/restaurant change
// does.
let vlLastAllRows = [];
let vlLastAllTotals = { amount: 0, paid: 0, unpaid: 0 };

async function renderVendorLedger(){
  if(vlSelectedDate === undefined) vlSelectedDate = addDaysStr(todayStr(), -1);
  if(vlSelectedMonth === undefined) vlSelectedMonth = todayStr().slice(0,7);
  if(vlRangeFrom === undefined) vlRangeFrom = todayStr().slice(0,8) + '01'; // 1st of this month
  if(vlRangeTo === undefined) vlRangeTo = todayStr();
  document.getElementById('vlDatePicker').value = vlSelectedDate;
  document.getElementById('vlMonthPicker').value = vlSelectedMonth;
  document.getElementById('vlRangeFromPicker').value = vlRangeFrom;
  document.getElementById('vlRangeToPicker').value = vlRangeTo;

  const panel = document.querySelector('#tabPanelLedger .dash-panel');
  panel.classList.add('dash-loading');
  try{
    const params = vlPeriodType === 'day' ? { date: vlSelectedDate }
      : vlPeriodType === 'range' ? { from: vlRangeFrom, to: vlRangeTo }
      : { month: vlSelectedMonth };
    const { rows, totals } = await computeVendorLedgerData(vlPeriodType, params, vlRestaurantFilter);
    vlLastAllRows = rows;
    vlLastAllTotals = totals;
    applyVLSearchAndRender();
  }catch(e){
    console.error('vendor ledger render failed', e);
  }finally{
    // Must run even on a thrown error above -- .dash-loading sets
    // pointer-events:none on the whole panel, which would otherwise
    // permanently disable the restaurant selector and period toggles.
    panel.classList.remove('dash-loading');
  }
}

// Applies vlVendorSearch to the cached vlLastAllRows and renders the result
// -- called after every fresh fetch, and directly from the search box's own
// input handler (no re-fetch needed, the data hasn't changed). The
// downloads below already promise "whatever the table above is showing,"
// and a search result is exactly that, so a search for one vendor
// naturally scopes "download pending bills" etc. to just that vendor too --
// no separate concept to keep in sync. Totals are recomputed from the
// filtered set rather than reusing vlLastAllTotals, so the hero cards match
// what's actually filtered.
function applyVLSearchAndRender(){
  const allRows = vlLastAllRows;
  const search = vlVendorSearch.trim().toLowerCase();
  const rows = search ? allRows.filter(r => r.name.toLowerCase().includes(search)) : allRows;

  const totalsBar = document.getElementById('vlTotalsBar');
  const empty = document.getElementById('vlEmpty');
  if(allRows.length === 0 || rows.length === 0){
    document.getElementById('vlTableWrap').innerHTML = "";
    totalsBar.style.display = 'none';
    empty.textContent = allRows.length === 0 ? "No bills logged for this period yet." : "No vendors match your search.";
    empty.style.display = 'block';
    // Bug fix (2026-10-16): this early return used to skip renderVLTable(),
    // which is the ONLY place vlLastRows/vlLastShowRestCol get updated --
    // so switching to a period/restaurant/search scope with zero matching
    // rows left the pending-bills downloads silently reading the PREVIOUS
    // scope's stale data instead of correctly finding nothing. Caught by
    // test_pending_bills_by_vendor.js's empty-scope check.
    vlLastRows = [];
    vlLastShowRestCol = vlRestaurantFilter === 'all';
    return;
  }
  empty.style.display = 'none';
  totalsBar.style.display = 'flex';
  const totals = search ? rows.reduce((acc,r)=>({
    amount: acc.amount + r.amount, paid: acc.paid + r.paid, unpaid: acc.unpaid + r.unpaid
  }), { amount: 0, paid: 0, unpaid: 0 }) : vlLastAllTotals;
  document.getElementById('vlTotalVendors').textContent = rows.length;
  document.getElementById('vlTotalAmount').textContent = fmtMoney(totals.amount);
  document.getElementById('vlTotalPaid').textContent = fmtMoney(totals.paid);
  document.getElementById('vlTotalUnpaid').textContent = fmtMoney(totals.unpaid);

  renderVLTable(rows, vlRestaurantFilter === 'all');
}
document.getElementById('vlVendorSearch').addEventListener('input', (ev)=>{
  vlVendorSearch = ev.target.value;
  vlExpandedVendor = null;
  applyVLSearchAndRender();
});

const VL_PERIOD_BTNS = { day: 'vlPeriodDay', month: 'vlPeriodMonth', range: 'vlPeriodRange' };
const VL_PERIOD_FIELDS = {
  day: ['vlDatePicker'],
  month: ['vlMonthPicker'],
  range: ['vlRangeFromLabel', 'vlRangeFromPicker', 'vlRangeToLabel', 'vlRangeToPicker']
};
function setVLPeriodType(type){
  vlPeriodType = type;
  vlExpandedVendor = null;
  Object.keys(VL_PERIOD_BTNS).forEach(key=>{
    document.getElementById(VL_PERIOD_BTNS[key]).classList.toggle('active', key === type);
  });
  Object.keys(VL_PERIOD_FIELDS).forEach(key=>{
    const display = key === type ? '' : 'none';
    VL_PERIOD_FIELDS[key].forEach(id=>{ document.getElementById(id).style.display = display; });
  });
  renderVendorLedger();
}
document.getElementById('vlPeriodDay').addEventListener('click', ()=>setVLPeriodType('day'));
document.getElementById('vlPeriodMonth').addEventListener('click', ()=>setVLPeriodType('month'));
document.getElementById('vlPeriodRange').addEventListener('click', ()=>setVLPeriodType('range'));

document.getElementById('vlDatePicker').addEventListener('change', (ev)=>{
  if(ev.target.value){ vlSelectedDate = ev.target.value; vlExpandedVendor = null; renderVendorLedger(); }
});
document.getElementById('vlMonthPicker').addEventListener('change', (ev)=>{
  if(ev.target.value){ vlSelectedMonth = ev.target.value; vlExpandedVendor = null; renderVendorLedger(); }
});
document.getElementById('vlRangeFromPicker').addEventListener('change', (ev)=>{
  if(ev.target.value){ vlRangeFrom = ev.target.value; vlExpandedVendor = null; renderVendorLedger(); }
});
document.getElementById('vlRangeToPicker').addEventListener('change', (ev)=>{
  if(ev.target.value){ vlRangeTo = ev.target.value; vlExpandedVendor = null; renderVendorLedger(); }
});

/* ---------- Pending bills download (added 2026-10-15) ----------
   A payment-ready export of PENDING (unpaid) bills for whatever
   period/restaurant scope the table above is currently showing -- reuses
   vlLastRows rather than recomputing, so the download can never disagree
   with what's on screen. Supplier bank details (account number + IFSC,
   added the same day on the Suppliers tab) get joined in from
   supplierBankDetails; the plain CSV includes every pending bill regardless
   of whether its supplier has bank details on file, the bank-transfer
   .xlsx requires a complete account number + IFSC (NEFT needs both) --
   same split the Staff tab's combined report already established. */
function vlPendingBillRows(){
  const rows = [];
  vlLastRows.forEach(r=>{
    r.bills.forEach(b=>{
      if(b.status === 'paid') return;
      rows.push({ supplier: r.name, category: r.category, restaurantId: b.restaurantId, date: b.date, invoice: b.invoice, amount: b.amount });
    });
  });
  return rows.sort((a,b)=> a.date === b.date ? a.supplier.localeCompare(b.supplier) : (a.date < b.date ? -1 : 1));
}
function vlPeriodFilenameSuffix(){
  if(vlPeriodType === 'day') return vlSelectedDate;
  if(vlPeriodType === 'month') return vlSelectedMonth;
  return `${vlRangeFrom}_to_${vlRangeTo}`;
}
function downloadPendingBillsReport(){
  const rows = vlPendingBillRows();
  if(rows.length === 0){
    alert("No pending bills for this period/restaurant scope.");
    return;
  }
  const out = [["Date", "Restaurant", "Supplier", "Category", "Invoice #", "Amount", "Account Number", "IFSC Code"]];
  rows.forEach(b=>{
    const bank = supplierBankDetails[supplierKey(b.supplier)] || {};
    out.push([
      fmtDateLabel(b.date), restaurantLabel(b.restaurantId), b.supplier, b.category,
      b.invoice || "", b.amount.toFixed(2),
      csvForceText(bank.accountNumber), bank.ifscCode || ""
    ]);
  });
  const csv = out.map(r => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pending-bills_${vlPeriodFilenameSuffix()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
document.getElementById('vlDownloadPendingBtn').addEventListener('click', downloadPendingBillsReport);

// Vendor-wise ledger export (added 2026-10-16), a genuine .xlsx (not a CSV
// like the flat download above) -- the flat download is one row per bill,
// sorted by date; this groups those same bills under each vendor instead,
// with a Subtotal row per vendor and a Grand Total at the end, closer to
// the classic sub-ledger layout an accountant would expect. vlLastRows is
// already vendor-grouped by computeVendorLedgerData() -- no re-grouping
// needed, just filter each vendor's own bills down to unpaid ones. Vendor
// name/category/account number/IFSC are only written on each group's FIRST
// row (blank on the rest) rather than repeated on every line, so the
// grouping reads clearly without needing real merged cells.
function downloadPendingBillsByVendor(){
  const showRestCol = vlRestaurantFilter === 'all';
  const groups = vlLastRows
    .map(r => ({ name: r.name, category: r.category, bills: r.bills.filter(b => b.status !== 'paid') }))
    .filter(g => g.bills.length > 0)
    .map(g => ({ ...g, total: g.bills.reduce((s,b)=> s + b.amount, 0) }))
    .sort((a,b) => b.total - a.total);

  if(groups.length === 0){
    alert("No pending bills for this period/restaurant scope.");
    return;
  }

  const header = ["Vendor", "Category", "Date", "Invoice #"].concat(showRestCol ? ["Restaurant"] : [], ["Amount", "Account Number", "IFSC Code"]);
  const rows = [header];
  groups.forEach(g=>{
    const bank = supplierBankDetails[supplierKey(g.name)] || {};
    g.bills
      .sort((a,b)=> a.date < b.date ? -1 : (a.date > b.date ? 1 : 0))
      .forEach((b, idx)=>{
        rows.push([
          idx === 0 ? g.name : "",
          idx === 0 ? g.category : "",
          fmtDateLabel(b.date), b.invoice || ""
        ].concat(
          showRestCol ? [restaurantLabel(b.restaurantId)] : [],
          [Number(b.amount.toFixed(2)), idx === 0 ? (bank.accountNumber || "") : "", idx === 0 ? (bank.ifscCode || "") : ""]
        ));
      });
    rows.push([`Subtotal - ${g.name}`, "", "", ""].concat(showRestCol ? [""] : [], [Number(g.total.toFixed(2)), "", ""]));
    rows.push([]);
  });
  const grandTotal = groups.reduce((s,g)=> s + g.total, 0);
  rows.push(["GRAND TOTAL", "", "", ""].concat(showRestCol ? [""] : [], [Number(grandTotal.toFixed(2)), "", ""]));

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Pending by vendor");
  XLSX.writeFile(wb, `pending-bills-by-vendor_${vlPeriodFilenameSuffix()}.xlsx`);
}
document.getElementById('vlDownloadPendingByVendorBtn').addEventListener('click', downloadPendingBillsByVendor);

// Changed 2026-10-16 (same day as the "by vendor" download above) from one
// row per pending BILL to one row per VENDOR -- an explicit request to match
// the Staff tab's own bank-transfer format exactly, which aggregates OT/
// Incentive/Tips into a single total per employee, not one row per entry.
// Bill-level detail (invoice numbers, individual dates) stays available in
// the flat CSV and the "by vendor" sub-ledger .xlsx above; this file is
// purely "how much to pay each vendor," matching what you'd actually hand to
// a bank's bulk-upload screen.
async function downloadPendingBillsBankTransfer(){
  // Loaded lazily here (not just on the Staff tab's own showStaffTabPanel())
  // so this works correctly even if Vendor Ledger is opened first in a
  // session, before Staff Expenses has had a chance to load it.
  await loadBankDebitAccountNumber();
  if(!bankDebitAccountNumber){
    alert('Set your Debit Account Number in the Staff tab (Bank Transfer Settings) before downloading a bank transfer file.');
    return;
  }
  // Merge by supplierKey() (added 2026-10-17), not the raw name -- bills'
  // own `supplier` field is free text, independent of the `suppliers`
  // directory, so the same real vendor billed as e.g. "ABC Traders" on one
  // bill and "abc traders" (or with stray whitespace) on another produces
  // TWO separate rows in vlLastRows (computeVendorLedgerData groups by the
  // exact string). Both would independently pass supplierHasFullBankDetails()
  // -- it already normalizes via supplierKey() -- so without this merge
  // step the same vendor got two bank-transfer rows, each with a partial
  // amount, instead of one with the correct combined total.
  const mergedByKey = {}; // supplierKey -> {name, total}
  vlLastRows.forEach(r=>{
    const total = r.bills.filter(b => b.status !== 'paid').reduce((s,b)=> s + b.amount, 0);
    if(total <= 0) return;
    const key = supplierKey(r.name);
    if(!mergedByKey[key]) mergedByKey[key] = { name: r.name, total: 0 };
    mergedByKey[key].total += total;
  });
  // Prefer the supplier directory's own exact-cased name for display, in
  // case the bills used a differently-cased/spaced spelling than `suppliers`.
  Object.keys(mergedByKey).forEach(key=>{
    const canonical = suppliers.find(s => supplierKey(s) === key);
    if(canonical) mergedByKey[key].name = canonical;
  });
  const groups = Object.values(mergedByKey).filter(g => supplierHasFullBankDetails(g.name));
  if(groups.length === 0){
    alert("No vendors with a complete account number + IFSC on file have pending bills for this period/restaurant scope.");
    return;
  }
  const dataRows = groups
    .sort((a,b)=> a.name.localeCompare(b.name))
    .map(g=>{
      const bank = supplierBankDetails[supplierKey(g.name)];
      return buildBankTransferRow(
        { name: g.name, accountNumber: bank.accountNumber, ifscCode: bank.ifscCode },
        g.total,
        "Pending bills payment"
      );
    });
  downloadBankTransferWorkbook(dataRows, `pending-bills-bank-transfer_${vlPeriodFilenameSuffix()}.xlsx`);
}
document.getElementById('vlDownloadPendingBankBtn').addEventListener('click', downloadPendingBillsBankTransfer);
