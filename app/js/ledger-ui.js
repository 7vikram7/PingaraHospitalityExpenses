function renderTable(){
  const tbody = document.getElementById('tableBody');
  const empty = document.getElementById('emptyState');
  tbody.innerHTML = "";
  const sorted = [...entries].sort((a,b)=>a.createdAt-b.createdAt);
  if(sorted.length === 0){
    empty.style.display = 'block';
  } else {
    empty.style.display = 'none';
  }
  sorted.forEach((e, i)=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="idx">${i+1}</td>
      <td>${escapeHtml(e.category)}</td>
      <td class="subcat">${escapeHtml(e.subcategory || '—')}</td>
      <td class="supplier">${escapeHtml(e.supplier)}</td>
      <td class="subcat">${escapeHtml(e.invoice || '—')}</td>
      <td class="amount">${fmtMoney(e.amount)}</td>
      <td><button class="badge ${e.status}" data-id="${e.id}" data-action="toggle">${e.status}</button></td>
      <td><button class="del-btn" data-id="${e.id}" data-action="delete">Delete</button></td>
    `;
    tbody.appendChild(tr);
  });
}
function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
}
function renderTotals(){
  const count = entries.length;
  const total = entries.reduce((s,e)=>s+Number(e.amount||0),0);
  const paid = entries.filter(e=>e.status==='paid').reduce((s,e)=>s+Number(e.amount||0),0);
  const unpaid = total - paid;
  document.getElementById('ledCount').textContent = count;
  document.getElementById('ledTotal').textContent = fmtMoney(total);
  document.getElementById('ledPaid').textContent = fmtMoney(paid);
  document.getElementById('ledUnpaid').textContent = fmtMoney(unpaid);
  document.getElementById('ledSales').textContent = (currentSales !== null && !isNaN(currentSales)) ? fmtMoney(currentSales) : "—";
}
function renderBreakdown(){
  const box = document.getElementById('breakdown');
  box.innerHTML = '<span class="breakdown-label">By category</span>';
  const totals = {};
  entries.forEach(e=>{ totals[e.category] = (totals[e.category]||0) + Number(e.amount||0); });
  const rows = Object.entries(totals).sort((a,b)=>b[1]-a[1]);
  if(rows.length === 0){
    box.innerHTML += '<span class="chip" style="color:var(--ink-soft);">No spend yet today</span>';
    return;
  }
  rows.forEach(([cat, amt])=>{
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `${escapeHtml(cat)} <b>${fmtMoney(amt)}</b>`;
    box.appendChild(chip);
  });
}
function renderAll(){
  renderSupplierSelect();
  renderTable();
  renderTotals();
  renderBreakdown();
  document.getElementById('datePick').value = currentDate;
}
function renderRestaurantSelect(){
  const sel = document.getElementById('restaurantSelect');
  sel.innerHTML = "";
  RESTAURANTS.forEach(r=>{
    const opt = document.createElement('option');
    opt.value = r.id; opt.textContent = r.label;
    sel.appendChild(opt);
  });
  sel.value = currentRestaurantId;
  updateSyncBtnLabel();
}
function updateSyncBtnLabel(){
  const btn = document.getElementById('syncBtn');
  const linked = fileHandles[currentRestaurantId];
  btn.textContent = linked ? ("🔗 Linked: " + linked.name) : "Link Excel file (auto-update)";
}
async function switchRestaurant(newId){
  currentRestaurantId = newId;
  setCurrentRestaurantId(newId);
  fileHandle = fileHandles[currentRestaurantId] || null;
  renderRestaurantSelect();
  await loadCategories();
  await loadSuppliers();
  await loadSupplierDefaults();
  await loadEntries(currentDate);
  await loadSales(currentDate);
  renderAll();
}

/* ---------- Events ---------- */
document.getElementById('restaurantSelect').addEventListener('change', (ev)=>{
  switchRestaurant(ev.target.value);
});

/* ---------- Restaurant selection gate ----------
   Shown before anything else (Add Expenses or Reports). Picking a restaurant
   here is a deliberate, separate step from the rest of the UI — once
   confirmed, the dropdown is hidden behind a "Change restaurant" button so a
   manager mid-entry can't accidentally flip the dropdown and keep adding
   bills against the wrong restaurant. */
const RESTAURANT_CONFIRMED_KEY = "restaurantConfirmed";
function isRestaurantConfirmed(){
  try{ return localStorage.getItem(RESTAURANT_CONFIRMED_KEY) === '1'; }catch(e){ return false; }
}
function setRestaurantConfirmed(val){
  try{
    if(val) localStorage.setItem(RESTAURANT_CONFIRMED_KEY, '1');
    else localStorage.removeItem(RESTAURANT_CONFIRMED_KEY);
  }catch(e){}
}
function showRestaurantGate(){
  document.getElementById('restaurantGate').style.display = 'flex';
  document.getElementById('restaurantConfirmedBar').style.display = 'none';
  document.getElementById('appTabsWrap').style.display = 'none';
}
function showConfirmedRestaurant(){
  document.getElementById('restaurantGate').style.display = 'none';
  document.getElementById('restaurantConfirmedBar').style.display = 'flex';
  document.getElementById('restaurantConfirmedName').textContent = restaurantLabel(currentRestaurantId);
  document.getElementById('appTabsWrap').style.display = 'block';
}
function renderRestaurantGateState(){
  if(isRestaurantConfirmed()) showConfirmedRestaurant();
  else showRestaurantGate();
}
document.getElementById('restaurantConfirmBtn').addEventListener('click', ()=>{
  setRestaurantConfirmed(true);
  showConfirmedRestaurant();
});
document.getElementById('restaurantChangeBtn').addEventListener('click', ()=>{
  setRestaurantConfirmed(false);
  showRestaurantGate();
});
document.getElementById('saveSalesBtn').addEventListener('click', async ()=>{
  const ok = await saveSalesValue();
  const hint = document.getElementById('salesSavedHint');
  if(ok){
    renderTotals();
    hint.style.display = 'inline';
    setTimeout(()=>{ hint.style.display = 'none'; }, 2500);
  } else {
    alert("Enter a valid sales amount (0 or more) first.");
  }
});
document.getElementById('downloadCsvBtn').addEventListener('click', downloadCsv);
document.getElementById('downloadExcelBtn').addEventListener('click', handleDownloadExcelClick);
document.getElementById('syncBtn').addEventListener('click', connectExcelFile);
document.getElementById('saveSpreadsheetBtn').addEventListener('click', saveToSpreadsheet);

document.getElementById('fyModalCancel').addEventListener('click', closeFYModal);
document.getElementById('fyModal').addEventListener('click', (ev)=>{
  if(ev.target.id === 'fyModal') closeFYModal();
});

