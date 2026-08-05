/* ---------- Vendor Ledger tab: per-vendor spend, all restaurants or one, for a period ----------
   Shares the Reports tab's owner password/session (same sensitivity — aggregate
   financial data across restaurants) rather than introducing a second password. */
let vlPeriodType = 'month';  // 'day' | 'month'
let vlSelectedDate, vlSelectedMonth;
let vlRestaurantFilter = 'all'; // 'all' or a restaurant id

function renderVLRestaurantSelect(){
  const sel = document.getElementById('vlRestaurantSelect');
  const prev = sel.value || vlRestaurantFilter;
  sel.innerHTML = '<option value="all">All restaurants</option>';
  RESTAURANTS.forEach(r=>{
    const opt = document.createElement('option');
    opt.value = r.id; opt.textContent = r.label;
    sel.appendChild(opt);
  });
  sel.value = prev;
}

function showVLPanel(){
  const unlocked = reportsUnlocked();
  document.getElementById('vlLock').style.display = unlocked ? 'none' : 'block';
  document.getElementById('vlContent').style.display = unlocked ? 'block' : 'none';
  if(unlocked){
    renderVLRestaurantSelect();
    renderVendorLedger();
  }
}
document.getElementById('vlUnlockBtn').addEventListener('click', async ()=>{
  const input = document.getElementById('vlPasswordInput');
  const errEl = document.getElementById('vlLockError');
  errEl.classList.remove('show');
  const hash = await sha256Hex(input.value);
  if(hash === REPORTS_PASSWORD_HASH){
    try{ sessionStorage.setItem(REPORTS_UNLOCK_KEY, '1'); }catch(e){}
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
// at this app's actual data volume (see CONTEXT.md).
async function computeVendorLedgerData(periodType, dateOrMonth, restaurantFilter){
  const monthKey = periodType === 'day' ? dateOrMonth.slice(0,7) : dateOrMonth;
  const dateFilter = periodType === 'day' ? (d)=> d === dateOrMonth : ()=> true;
  const billsAll = await fetchAllRestaurantsBillsForMonth(monthKey);

  const vendors = {}; // supplier name -> { amount, paid, unpaid, count, restaurantIds:Set }
  RESTAURANTS.forEach(r=>{
    if(restaurantFilter !== 'all' && restaurantFilter !== r.id) return;
    const billsData = billsAll[r.id] || {};
    Object.keys(billsData).forEach(d=>{
      if(!dateFilter(d)) return;
      (billsData[d] || []).forEach(e=>{
        const name = e.supplier || 'Unknown';
        if(!vendors[name]) vendors[name] = { amount: 0, paid: 0, unpaid: 0, count: 0, restaurantIds: new Set() };
        const amt = Number(e.amount || 0);
        vendors[name].amount += amt;
        if(e.status === 'paid') vendors[name].paid += amt; else vendors[name].unpaid += amt;
        vendors[name].count += 1;
        vendors[name].restaurantIds.add(r.id);
      });
    });
  });

  const rows = Object.keys(vendors).map(name=>{
    const v = vendors[name];
    return {
      name,
      category: (supplierDefaults[supplierKey(name)] || {}).category || '—',
      amount: v.amount, paid: v.paid, unpaid: v.unpaid, count: v.count,
      restaurantIds: Array.from(v.restaurantIds)
    };
  }).sort((a,b)=>b.amount-a.amount);

  const totals = rows.reduce((acc,r)=>({
    amount: acc.amount + r.amount,
    paid: acc.paid + r.paid,
    unpaid: acc.unpaid + r.unpaid
  }), { amount: 0, paid: 0, unpaid: 0 });

  return { rows, totals };
}

function renderVLTable(rows, showRestCol){
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
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    tdName.textContent = r.name; tdName.className = 'supplier';
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
    tbody.appendChild(tr);
  });
  table.appendChild(thead); table.appendChild(tbody);
  wrap.appendChild(table);
}

async function renderVendorLedger(){
  if(vlSelectedDate === undefined) vlSelectedDate = addDaysStr(todayStr(), -1);
  if(vlSelectedMonth === undefined) vlSelectedMonth = todayStr().slice(0,7);
  document.getElementById('vlDatePicker').value = vlSelectedDate;
  document.getElementById('vlMonthPicker').value = vlSelectedMonth;

  const panel = document.querySelector('#tabPanelLedger .dash-panel');
  panel.classList.add('dash-loading');
  try{
    const dateOrMonth = vlPeriodType === 'day' ? vlSelectedDate : vlSelectedMonth;
    const { rows, totals } = await computeVendorLedgerData(vlPeriodType, dateOrMonth, vlRestaurantFilter);

    const totalsBar = document.getElementById('vlTotalsBar');
    const empty = document.getElementById('vlEmpty');
    if(rows.length === 0){
      document.getElementById('vlTableWrap').innerHTML = "";
      totalsBar.style.display = 'none';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';
    totalsBar.style.display = 'flex';
    document.getElementById('vlTotalVendors').textContent = rows.length;
    document.getElementById('vlTotalAmount').textContent = fmtMoney(totals.amount);
    document.getElementById('vlTotalPaid').textContent = fmtMoney(totals.paid);
    document.getElementById('vlTotalUnpaid').textContent = fmtMoney(totals.unpaid);

    renderVLTable(rows, vlRestaurantFilter === 'all');
  }catch(e){
    console.error('vendor ledger render failed', e);
  }
  panel.classList.remove('dash-loading');
}

document.getElementById('vlRestaurantSelect').addEventListener('change', (ev)=>{
  vlRestaurantFilter = ev.target.value;
  renderVendorLedger();
});
document.getElementById('vlPeriodDay').addEventListener('click', ()=>{
  vlPeriodType = 'day';
  document.getElementById('vlPeriodDay').classList.add('active');
  document.getElementById('vlPeriodMonth').classList.remove('active');
  document.getElementById('vlDatePicker').style.display = '';
  document.getElementById('vlMonthPicker').style.display = 'none';
  renderVendorLedger();
});
document.getElementById('vlPeriodMonth').addEventListener('click', ()=>{
  vlPeriodType = 'month';
  document.getElementById('vlPeriodMonth').classList.add('active');
  document.getElementById('vlPeriodDay').classList.remove('active');
  document.getElementById('vlDatePicker').style.display = 'none';
  document.getElementById('vlMonthPicker').style.display = '';
  renderVendorLedger();
});
document.getElementById('vlDatePicker').addEventListener('change', (ev)=>{
  if(ev.target.value){ vlSelectedDate = ev.target.value; renderVendorLedger(); }
});
document.getElementById('vlMonthPicker').addEventListener('change', (ev)=>{
  if(ev.target.value){ vlSelectedMonth = ev.target.value; renderVendorLedger(); }
});
