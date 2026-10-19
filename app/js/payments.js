/* ---------- Payments tab: mark pending bills paid in bulk, vendor-wise ----------
   Added 2026-10-17 -- the owner pays suppliers in batches (1st-15th,
   16th-end of month) and marking each bill paid individually got
   impractical as the bill count grew. Deliberately a FOCUSED view, not
   another full ledger: shows only vendors with something still pending
   for the selected period/restaurant scope (no already-paid bills
   cluttering the list), with a "Mark Paid" button per vendor (a
   page-wide "Mark All Paid" existed briefly too, removed 2026-10-20 as
   too easy to fire by accident across a whole scope -- per-vendor is the
   one safe granularity now). Reuses the exact same
   computeVendorLedgerData()/period-picker/restaurant-selector/search
   pattern vendor-ledger.js already built and tested, rather than a
   second parallel implementation -- same data, different purpose-built
   presentation. Shares Reports/Vendor Ledger's owner password/session
   (same sensitivity -- bulk bill mutation across restaurants).

   Safety property, explicitly requested: marking a range paid is a
   one-time action on whatever bills exist right now -- there is no
   date-range-level "paid" flag, so a bill added later (even dated inside
   an already-processed range) is a brand-new record and starts 'unpaid'
   as always. markBillsPaid() (data-store.js) only ever flips existing
   records, never anything that could retroactively apply to a future
   write.

   Expandable per-vendor bill list with deselect, added 2026-10-17 same
   day -- "it is a problem if 1 or 2 bills are not paid within a marked
   date range," so marking a vendor's WHOLE pending total paid in one
   click isn't always right. Each vendor row expands (click the row or its
   caret, same accordion pattern vendor-ledger.js's own detail view uses)
   into its individual bills, each with a checkbox -- checked by default
   (the common case is "pay everything"), unchecking one excludes it from
   that vendor's Mark Paid action. payExcludedBillIds (a Set of bill ids)
   is the one piece of selection state; a bill not in it is selected.
   Deliberately reset on every fresh fetch (period/restaurant/search
   change, or right after a mark-paid action completes) rather than
   persisted -- an exclusion is a decision about THIS specific payment
   run, not a lasting property of the bill; if it still shouldn't be paid
   next time, it gets excluded again then. Checkbox toggles update totals
   live via updatePayLiveTotals() (direct DOM text updates against
   payRowRefs, not a full table rebuild) so unchecking a bill doesn't
   collapse other expanded rows or jump the scroll position -- expand/
   collapse and the search/period filters are the only things that
   trigger a full renderPayTable(). */
let payPeriodType = 'month';  // 'day' | 'month' | 'range'
let paySelectedDate, paySelectedMonth;
let payRangeFrom, payRangeTo;
let payRestaurantFilter = 'all'; // 'all' or a restaurant id, set from the shared top-bar selector
let payVendorSearch = '';
let paySortBy = 'pending_desc'; // 'pending_desc' | 'pending_asc' | 'name_asc' | 'name_desc' (added 2026-10-20)
let payBankFilter = 'all'; // 'all' | 'with' | 'without' -- supplierHasBankAccount() (added 2026-10-20)
let payExpandedVendors = new Set(); // vendor names currently expanded
let payExcludedBillIds = new Set(); // bill ids unchecked for the next mark-paid action
let payRowRefs = []; // [{ row, markBtn, captionEl }] -- live refs for updatePayLiveTotals(), rebuilt every renderPayTable()

function showPayPanel(){
  const unlocked = reportsUnlocked();
  document.getElementById('payLock').style.display = unlocked ? 'none' : 'block';
  document.getElementById('payContent').style.display = unlocked ? 'block' : 'none';
  if(unlocked){
    renderPayments();
  }
}
document.getElementById('payUnlockBtn').addEventListener('click', async ()=>{
  const input = document.getElementById('payPasswordInput');
  const errEl = document.getElementById('payLockError');
  errEl.classList.remove('show');
  const hash = await sha256Hex(input.value);
  if(hash === REPORTS_PASSWORD_HASH){
    try{ localStorage.setItem(REPORTS_UNLOCK_KEY, '1'); }catch(e){}
    input.value = '';
    showPayPanel();
  } else {
    errEl.classList.add('show');
  }
});
document.getElementById('payPasswordInput').addEventListener('keydown', (ev)=>{
  if(ev.key === 'Enter') document.getElementById('payUnlockBtn').click();
});

// The full computeVendorLedgerData() result for the current period/
// restaurant scope (every vendor, paid and unpaid bills both) -- cached so
// the search box can re-filter instantly without re-fetching, same
// vlLastAllRows/applyVLSearchAndRender() split vendor-ledger.js already
// uses. payLastFilteredRows is what's actually on screen right now (paid
// bills excluded, search applied) -- the "Selected to mark paid" hero
// stat reads from this directly rather than recomputing the same filter
// twice.
let payLastAllRows = [];
let payLastFilteredRows = [];

async function renderPayments(){
  if(paySelectedDate === undefined) paySelectedDate = addDaysStr(todayStr(), -1);
  if(paySelectedMonth === undefined) paySelectedMonth = todayStr().slice(0,7);
  if(payRangeFrom === undefined) payRangeFrom = todayStr().slice(0,8) + '01'; // 1st of this month
  if(payRangeTo === undefined) payRangeTo = todayStr();
  document.getElementById('payDatePicker').value = paySelectedDate;
  document.getElementById('payMonthPicker').value = paySelectedMonth;
  document.getElementById('payRangeFromPicker').value = payRangeFrom;
  document.getElementById('payRangeToPicker').value = payRangeTo;

  const panel = document.querySelector('#tabPanelPayments .dash-panel');
  panel.classList.add('dash-loading');
  try{
    const params = payPeriodType === 'day' ? { date: paySelectedDate }
      : payPeriodType === 'range' ? { from: payRangeFrom, to: payRangeTo }
      : { month: paySelectedMonth };
    const { rows } = await computeVendorLedgerData(payPeriodType, params, payRestaurantFilter);
    payLastAllRows = rows;
    payExcludedBillIds.clear(); // fresh fetch -- every bill in the new scope starts selected
    applyPaySearchAndRender();
  }catch(e){
    console.error('payments render failed', e);
  }finally{
    panel.classList.remove('dash-loading');
  }
}

// Sort/bank-account filter added 2026-10-20 -- same as Vendor Ledger's
// own addition the same day. Pending here is unambiguous (every row IS
// the pending list already), so "amount pending" sort just sorts the
// existing Pending column -- no separate "total spend" concept to choose
// between like Vendor Ledger has.
function sortPayRows(rows){
  const sorted = [...rows];
  const pendingAmount = (r)=> r.bills.reduce((s,b)=> s + b.amount, 0);
  if(paySortBy === 'name_asc') sorted.sort((a,b)=> a.name.localeCompare(b.name));
  else if(paySortBy === 'name_desc') sorted.sort((a,b)=> b.name.localeCompare(a.name));
  else if(paySortBy === 'pending_asc') sorted.sort((a,b)=> pendingAmount(a) - pendingAmount(b));
  else sorted.sort((a,b)=> pendingAmount(b) - pendingAmount(a)); // 'pending_desc', the default
  return sorted;
}
function applyPaySearchAndRender(){
  const search = payVendorSearch.trim().toLowerCase();
  const pendingRows = payLastAllRows
    .map(r => ({ name: r.name, category: r.category, bills: r.bills.filter(b => b.status !== 'paid') }))
    .filter(r => r.bills.length > 0);
  let rows = search ? pendingRows.filter(r => r.name.toLowerCase().includes(search)) : pendingRows;
  if(payBankFilter !== 'all'){
    rows = rows.filter(r => payBankFilter === 'with' ? supplierHasBankAccount(r.name) : !supplierHasBankAccount(r.name));
  }
  rows = sortPayRows(rows);
  payLastFilteredRows = rows;
  // Independent of the pending-only list above -- a vendor can be searched
  // here specifically BECAUSE everything of theirs is already paid (nothing
  // left pending, so they wouldn't appear in `rows` at all), and that's
  // exactly when someone wants their paid-bills download.
  updatePayVendorDownload();

  const totalsBar = document.getElementById('payTotalsBar');
  const empty = document.getElementById('payEmpty');
  if(rows.length === 0){
    document.getElementById('payTableWrap').innerHTML = "";
    totalsBar.style.display = 'none';
    empty.textContent = pendingRows.length === 0
      ? "Nothing pending for this period/restaurant scope."
      : "No vendors match your search/filter.";
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  totalsBar.style.display = 'flex';

  const totalBills = rows.reduce((s,r)=> s + r.bills.length, 0);
  const totalAmount = rows.reduce((s,r)=> s + r.bills.reduce((s2,b)=> s2 + b.amount, 0), 0);
  document.getElementById('payTotalVendors').textContent = rows.length;
  document.getElementById('payTotalBills').textContent = totalBills;
  document.getElementById('payTotalAmount').textContent = fmtMoney(totalAmount);

  renderPayTable(rows, payRestaurantFilter === 'all');
  updatePayLiveTotals();
}
document.getElementById('payVendorSearch').addEventListener('input', (ev)=>{
  payVendorSearch = ev.target.value;
  applyPaySearchAndRender();
});
document.getElementById('paySortSelect').addEventListener('change', (ev)=>{
  paySortBy = ev.target.value;
  applyPaySearchAndRender();
});
document.getElementById('payBankFilterSelect').addEventListener('change', (ev)=>{
  payBankFilter = ev.target.value;
  applyPaySearchAndRender();
});

/* ---------- Download paid bills for one vendor (added 2026-10-20) ----------
   "give an option to download paid bill details ... for a particular
   vendor" -- scoped to the same period/restaurant selection already on
   screen (matches every other download in this app), triggered by the
   existing vendor search box: narrowing it down to exactly one vendor
   (matched against payLastAllRows, not the pending-only payLastFilteredRows,
   since a vendor with nothing left pending -- the exact moment someone
   wants a paid receipt -- would otherwise never match) reveals a download
   button for that vendor's paid bills specifically. Flat CSV, one row per
   bill with its own Restaurant column ("restaurant wise" == a column, not
   grouped sections, confirmed before building) -- matches the shape of
   the existing flat pending-bills CSV in Vendor Ledger, just filtered to
   status === 'paid' for one named vendor instead of every unpaid bill. */
let payVendorDownloadTarget = null; // { name, category, bills } for the one currently-matched vendor, or null
function updatePayVendorDownload(){
  const wrap = document.getElementById('payVendorDownloadWrap');
  const search = payVendorSearch.trim().toLowerCase();
  payVendorDownloadTarget = null;
  if(!search){
    wrap.style.display = 'none';
    return;
  }
  const matches = payLastAllRows.filter(r => r.name.toLowerCase().includes(search));
  if(matches.length !== 1){
    wrap.style.display = 'none';
    return;
  }
  const paidBills = matches[0].bills.filter(b => b.status === 'paid');
  if(paidBills.length === 0){
    wrap.style.display = 'none';
    return;
  }
  payVendorDownloadTarget = { name: matches[0].name, category: matches[0].category, bills: paidBills };
  document.getElementById('payVendorDownloadLabel').textContent =
    `${paidBills.length} paid bill${paidBills.length === 1 ? '' : 's'} for "${matches[0].name}" in this period`;
  wrap.style.display = 'flex';
}
function payPeriodFilenameSuffix(){
  if(payPeriodType === 'day') return paySelectedDate;
  if(payPeriodType === 'month') return paySelectedMonth;
  return `${payRangeFrom}_to_${payRangeTo}`;
}
// Shared by the search-triggered download above and the per-row inline
// link below (added 2026-10-20 -- "very complicated, give an easier
// option preferably next to the name of the vendor") -- one CSV builder,
// two ways to reach it.
function downloadVendorPaidBillsCsv(name, category, bills){
  const rows = [["Date", "Restaurant", "Category", "Invoice #", "Amount"]];
  bills
    .sort((a,b)=> a.date < b.date ? -1 : (a.date > b.date ? 1 : 0))
    .forEach(b=>{
      rows.push([fmtDateLabel(b.date), restaurantLabel(b.restaurantId), category, b.invoice || "", b.amount.toFixed(2)]);
    });
  const csv = rows.map(r => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = name.trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  a.download = `paid-bills_${safeName}_${payPeriodFilenameSuffix()}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
// Looks up a vendor's PAID bills from the full (not pending-filtered)
// scope -- used by the inline per-row link, which needs to know a count
// even for a vendor currently shown only because of its PENDING bills.
function findVendorPaidBills(vendorName){
  const match = payLastAllRows.find(r => r.name === vendorName);
  return match ? match.bills.filter(b => b.status === 'paid') : [];
}
document.getElementById('payVendorDownloadBtn').addEventListener('click', ()=>{
  if(!payVendorDownloadTarget) return;
  const { name, category, bills } = payVendorDownloadTarget;
  downloadVendorPaidBillsCsv(name, category, bills);
});

function renderPayTable(rows, showRestCol){
  payRowRefs = [];
  const wrap = document.getElementById('payTableWrap');
  wrap.innerHTML = "";
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.innerHTML = '<th>Vendor</th><th>Category</th>' +
    (showRestCol ? '<th>Restaurants</th>' : '') +
    '<th class="num">Bills</th><th class="num">Pending</th><th></th>';
  thead.appendChild(headRow);

  const tbody = document.createElement('tbody');
  rows.forEach(r=>{
    const amount = r.bills.reduce((s,b)=> s + b.amount, 0);
    const expanded = payExpandedVendors.has(r.name);
    const tr = document.createElement('tr');
    tr.className = 'vl-vendor-row';
    tr.tabIndex = 0;

    const tdName = document.createElement('td');
    tdName.className = 'supplier';
    const caret = document.createElement('span');
    caret.className = 'vl-expand-caret';
    caret.textContent = expanded ? '▾' : '▸';
    tdName.appendChild(caret);
    tdName.appendChild(document.createTextNode(r.name));
    // Inline "paid bills" link, added 2026-10-20 -- the search-box-triggered
    // download above was "very complicated" to find; this is the easy path
    // for the common case (a vendor already visible here, with SOME paid
    // bills in this scope alongside what's still pending). Only rendered
    // when there's actually something to download -- findVendorPaidBills()
    // reads the full (not pending-filtered) row, since r.bills here is
    // pending-only and wouldn't reflect paid bills at all.
    const paidBills = findVendorPaidBills(r.name);
    if(paidBills.length > 0){
      const dlLink = document.createElement('span');
      dlLink.className = 'addlink pay-vendor-dl-link';
      dlLink.textContent = `⬇ ${paidBills.length} paid`;
      dlLink.title = `Download ${paidBills.length} paid bill${paidBills.length === 1 ? '' : 's'} for "${r.name}" in this period`;
      dlLink.addEventListener('click', (ev)=>{
        ev.stopPropagation(); // don't also toggle the row's expand/collapse
        downloadVendorPaidBillsCsv(r.name, r.category, paidBills);
      });
      tdName.appendChild(dlLink);
    }
    tr.appendChild(tdName);

    const tdCat = document.createElement('td');
    tdCat.className = 'subcat';
    tdCat.textContent = r.category;
    tr.appendChild(tdCat);

    if(showRestCol){
      const restIds = Array.from(new Set(r.bills.map(b => b.restaurantId)));
      const tdRest = document.createElement('td');
      tdRest.className = 'subcat';
      tdRest.textContent = restIds.map(id => restaurantLabel(id)).join(', ');
      tr.appendChild(tdRest);
    }

    const tdCount = document.createElement('td');
    tdCount.className = 'num';
    tdCount.textContent = r.bills.length;
    tr.appendChild(tdCount);

    const tdAmt = document.createElement('td');
    tdAmt.className = 'amount';
    tdAmt.textContent = fmtMoney(amount);
    tr.appendChild(tdAmt);

    const tdBtn = document.createElement('td');
    const btnWrap = document.createElement('div');
    btnWrap.className = 'pay-mark-cell';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msr-save-btn';
    btn.textContent = 'Mark Paid';
    const captionEl = document.createElement('span');
    captionEl.className = 'count-hint';
    btn.addEventListener('click', async (ev)=>{
      ev.stopPropagation(); // the whole row also toggles expand on click
      const selectedBills = r.bills.filter(b => !payExcludedBillIds.has(b.id));
      if(selectedBills.length === 0){ alert('Nothing selected for this vendor — check at least one bill first.'); return; }
      const selectedAmount = selectedBills.reduce((s,b)=> s + b.amount, 0);
      const excludedCount = r.bills.length - selectedBills.length;
      const excludedNote = excludedCount > 0 ? ` (${excludedCount} unchecked bill${excludedCount === 1 ? '' : 's'} left pending)` : '';
      if(!confirm(`Mark ${selectedBills.length} bill${selectedBills.length === 1 ? '' : 's'} (${fmtMoney(selectedAmount)}) for "${r.name}" as paid?${excludedNote}`)) return;
      btn.disabled = true;
      btn.textContent = 'Marking…';
      await markBillsPaid(selectedBills.map(b => ({ restaurantId: b.restaurantId, date: b.date, id: b.id })));
      await renderPayments();
    });
    btnWrap.appendChild(btn);
    btnWrap.appendChild(captionEl);
    tdBtn.appendChild(btnWrap);
    tr.appendChild(tdBtn);

    const toggleExpand = ()=>{
      if(payExpandedVendors.has(r.name)) payExpandedVendors.delete(r.name);
      else payExpandedVendors.add(r.name);
      renderPayTable(rows, showRestCol);
      updatePayLiveTotals();
    };
    tr.addEventListener('click', toggleExpand);
    tr.addEventListener('keydown', (ev)=>{
      if(ev.key === 'Enter' || ev.key === ' '){ ev.preventDefault(); toggleExpand(); }
    });
    tbody.appendChild(tr);

    payRowRefs.push({ row: r, markBtn: btn, captionEl });

    if(expanded){
      const detailTr = document.createElement('tr');
      detailTr.className = 'vl-detail-row';
      const detailTd = document.createElement('td');
      detailTd.colSpan = showRestCol ? 6 : 5;
      detailTd.appendChild(buildPayDetailTable(r, showRestCol));
      detailTr.appendChild(detailTd);
      tbody.appendChild(detailTr);
    }
  });
  table.appendChild(thead); table.appendChild(tbody);
  wrap.appendChild(table);
}

function buildPayDetailTable(row, showRestCol){
  const scroll = document.createElement('div');
  scroll.className = 'vl-detail-scroll';

  const selectLinks = document.createElement('div');
  selectLinks.className = 'count-hint';
  const selectAll = document.createElement('span');
  selectAll.className = 'addlink';
  selectAll.textContent = 'select all';
  selectAll.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    row.bills.forEach(b => payExcludedBillIds.delete(b.id));
    renderPayTable(payLastFilteredRows, payRestaurantFilter === 'all');
    updatePayLiveTotals();
  });
  const selectNone = document.createElement('span');
  selectNone.className = 'addlink';
  selectNone.textContent = 'select none';
  selectNone.addEventListener('click', (ev)=>{
    ev.stopPropagation();
    row.bills.forEach(b => payExcludedBillIds.add(b.id));
    renderPayTable(payLastFilteredRows, payRestaurantFilter === 'all');
    updatePayLiveTotals();
  });
  selectLinks.appendChild(selectAll);
  selectLinks.appendChild(document.createTextNode(' · '));
  selectLinks.appendChild(selectNone);
  scroll.appendChild(selectLinks);

  const table = document.createElement('table');
  table.className = 'vl-detail-table';
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.innerHTML = '<th></th><th>Date</th>' + (showRestCol ? '<th>Restaurant</th>' : '') +
    '<th>Invoice #</th><th class="num">Amount</th>';
  thead.appendChild(headRow);

  const tbody = document.createElement('tbody');
  row.bills
    .sort((a,b)=> a.date < b.date ? -1 : (a.date > b.date ? 1 : 0))
    .forEach(b=>{
      const tr = document.createElement('tr');
      const tdCheck = document.createElement('td');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = !payExcludedBillIds.has(b.id);
      checkbox.addEventListener('click', (ev)=> ev.stopPropagation());
      checkbox.addEventListener('change', ()=>{
        if(checkbox.checked) payExcludedBillIds.delete(b.id);
        else payExcludedBillIds.add(b.id);
        updatePayLiveTotals();
      });
      tdCheck.appendChild(checkbox);
      tr.appendChild(tdCheck);

      const tdDate = document.createElement('td'); tdDate.textContent = fmtDateLabel(b.date);
      tr.appendChild(tdDate);
      if(showRestCol){
        const tdRest = document.createElement('td');
        tdRest.className = 'subcat';
        tdRest.textContent = restaurantLabel(b.restaurantId);
        tr.appendChild(tdRest);
      }
      const tdInv = document.createElement('td'); tdInv.className = 'subcat'; tdInv.textContent = b.invoice || '—';
      tr.appendChild(tdInv);
      const tdAmt = document.createElement('td'); tdAmt.className = 'amount'; tdAmt.textContent = fmtMoney(b.amount);
      tr.appendChild(tdAmt);
      tr.addEventListener('click', (ev)=> ev.stopPropagation()); // don't collapse the vendor row on a detail-row click
      tbody.appendChild(tr);
    });
  table.appendChild(thead); table.appendChild(tbody);
  scroll.appendChild(table);
  return scroll;
}

// Recomputes every vendor's selected subtotal (Mark Paid button label +
// caption) and the page-level "Selected to mark paid" hero stat, from
// payExcludedBillIds -- pure DOM text updates against payRowRefs, no
// table rebuild, so unchecking a bill doesn't collapse any other expanded
// vendor or move the scroll position. (A page-wide "Mark All Paid"
// button used to live here too, reading the same totals -- removed
// 2026-10-20, too easy to fire across an entire scope by accident; the
// hero stat itself stays, it's informational, not an action.)
function updatePayLiveTotals(){
  payRowRefs.forEach(({ row, markBtn, captionEl })=>{
    const selectedBills = row.bills.filter(b => !payExcludedBillIds.has(b.id));
    const selectedAmount = selectedBills.reduce((s,b)=> s + b.amount, 0);
    if(selectedBills.length === row.bills.length){
      markBtn.textContent = 'Mark Paid';
      captionEl.textContent = '';
    } else {
      markBtn.textContent = `Mark Paid (${fmtMoney(selectedAmount)})`;
      captionEl.textContent = `${selectedBills.length} of ${row.bills.length} selected`;
    }
    markBtn.disabled = selectedBills.length === 0;
  });

  const allBills = payLastFilteredRows.flatMap(r => r.bills);
  const selectedBills = allBills.filter(b => !payExcludedBillIds.has(b.id));
  const selectedAmount = selectedBills.reduce((s,b)=> s + b.amount, 0);
  const selectedEl = document.getElementById('paySelectedAmount');
  if(selectedEl) selectedEl.textContent = fmtMoney(selectedAmount);
}

const PAY_PERIOD_BTNS = { day: 'payPeriodDay', month: 'payPeriodMonth', range: 'payPeriodRange' };
const PAY_PERIOD_FIELDS = {
  day: ['payDatePicker'],
  month: ['payMonthPicker'],
  range: ['payRangeFromLabel', 'payRangeFromPicker', 'payRangeToLabel', 'payRangeToPicker']
};
function setPayPeriodType(type){
  payPeriodType = type;
  Object.keys(PAY_PERIOD_BTNS).forEach(key=>{
    document.getElementById(PAY_PERIOD_BTNS[key]).classList.toggle('active', key === type);
  });
  Object.keys(PAY_PERIOD_FIELDS).forEach(key=>{
    const display = key === type ? '' : 'none';
    PAY_PERIOD_FIELDS[key].forEach(id=>{ document.getElementById(id).style.display = display; });
  });
  renderPayments();
}
document.getElementById('payPeriodDay').addEventListener('click', ()=>setPayPeriodType('day'));
document.getElementById('payPeriodMonth').addEventListener('click', ()=>setPayPeriodType('month'));
document.getElementById('payPeriodRange').addEventListener('click', ()=>setPayPeriodType('range'));

document.getElementById('payDatePicker').addEventListener('change', (ev)=>{
  if(ev.target.value){ paySelectedDate = ev.target.value; renderPayments(); }
});
document.getElementById('payMonthPicker').addEventListener('change', (ev)=>{
  if(ev.target.value){ paySelectedMonth = ev.target.value; renderPayments(); }
});
document.getElementById('payRangeFromPicker').addEventListener('change', (ev)=>{
  if(ev.target.value){ payRangeFrom = ev.target.value; renderPayments(); }
});
document.getElementById('payRangeToPicker').addEventListener('change', (ev)=>{
  if(ev.target.value){ payRangeTo = ev.target.value; renderPayments(); }
});
