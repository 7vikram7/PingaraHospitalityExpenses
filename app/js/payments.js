/* ---------- Payments tab: mark pending bills paid in bulk, vendor-wise ----------
   Added 2026-10-17 -- the owner pays suppliers in batches (1st-15th,
   16th-end of month) and marking each bill paid individually got
   impractical as the bill count grew. Deliberately a FOCUSED view, not
   another full ledger: shows only vendors with something still pending
   for the selected period/restaurant scope (no already-paid bills
   cluttering the list), with a "Mark Paid" button per vendor and one
   "Mark All Paid" for the whole scope at once. Reuses the exact same
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
   write. */
let payPeriodType = 'month';  // 'day' | 'month' | 'range'
let paySelectedDate, paySelectedMonth;
let payRangeFrom, payRangeTo;
let payRestaurantFilter = 'all'; // 'all' or a restaurant id, set from the shared top-bar selector
let payVendorSearch = '';

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
// bills excluded, search applied) -- the "Mark All Paid" button reads from
// this directly rather than recomputing the same filter twice.
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
    applyPaySearchAndRender();
  }catch(e){
    console.error('payments render failed', e);
  }finally{
    panel.classList.remove('dash-loading');
  }
}

function applyPaySearchAndRender(){
  const search = payVendorSearch.trim().toLowerCase();
  const pendingRows = payLastAllRows
    .map(r => ({ name: r.name, category: r.category, bills: r.bills.filter(b => b.status !== 'paid') }))
    .filter(r => r.bills.length > 0);
  const rows = search ? pendingRows.filter(r => r.name.toLowerCase().includes(search)) : pendingRows;
  payLastFilteredRows = rows;

  const totalsBar = document.getElementById('payTotalsBar');
  const markAllWrap = document.getElementById('payMarkAllWrap');
  const empty = document.getElementById('payEmpty');
  if(rows.length === 0){
    document.getElementById('payTableWrap').innerHTML = "";
    totalsBar.style.display = 'none';
    markAllWrap.style.display = 'none';
    empty.textContent = pendingRows.length === 0
      ? "Nothing pending for this period/restaurant scope."
      : "No vendors match your search.";
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  totalsBar.style.display = 'flex';
  markAllWrap.style.display = 'flex';

  const totalBills = rows.reduce((s,r)=> s + r.bills.length, 0);
  const totalAmount = rows.reduce((s,r)=> s + r.bills.reduce((s2,b)=> s2 + b.amount, 0), 0);
  document.getElementById('payTotalVendors').textContent = rows.length;
  document.getElementById('payTotalBills').textContent = totalBills;
  document.getElementById('payTotalAmount').textContent = fmtMoney(totalAmount);

  renderPayTable(rows, payRestaurantFilter === 'all');
}
document.getElementById('payVendorSearch').addEventListener('input', (ev)=>{
  payVendorSearch = ev.target.value;
  applyPaySearchAndRender();
});

function renderPayTable(rows, showRestCol){
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
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.className = 'supplier';
    tdName.textContent = r.name;
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
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'msr-save-btn';
    btn.textContent = 'Mark Paid';
    btn.addEventListener('click', async ()=>{
      if(!confirm(`Mark ${r.bills.length} bill${r.bills.length === 1 ? '' : 's'} (${fmtMoney(amount)}) for "${r.name}" as paid?`)) return;
      btn.disabled = true;
      btn.textContent = 'Marking…';
      await markBillsPaid(r.bills.map(b => ({ restaurantId: b.restaurantId, date: b.date, id: b.id })));
      await renderPayments();
    });
    tdBtn.appendChild(btn);
    tr.appendChild(tdBtn);

    tbody.appendChild(tr);
  });
  table.appendChild(thead); table.appendChild(tbody);
  wrap.appendChild(table);
}

document.getElementById('payMarkAllPaidBtn').addEventListener('click', async ()=>{
  const rows = payLastFilteredRows;
  const allBills = rows.flatMap(r => r.bills);
  if(allBills.length === 0) return;
  const total = allBills.reduce((s,b)=> s + b.amount, 0);
  if(!confirm(`Mark ALL ${allBills.length} pending bill${allBills.length === 1 ? '' : 's'} (${fmtMoney(total)}) across ${rows.length} vendor${rows.length === 1 ? '' : 's'} as paid?\n\nThis only affects bills that exist right now.`)) return;
  const btn = document.getElementById('payMarkAllPaidBtn');
  btn.disabled = true;
  btn.textContent = 'Marking…';
  await markBillsPaid(allBills.map(b => ({ restaurantId: b.restaurantId, date: b.date, id: b.id })));
  btn.disabled = false;
  btn.textContent = 'Mark All Paid';
  await renderPayments();
});

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
