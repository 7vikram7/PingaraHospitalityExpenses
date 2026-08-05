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
    const withinModifyWindow = billWithinModifyWindow(e);
    const modifyLabel = withinModifyWindow ? 'Modify' : '🔒 Modify';
    const modifyTitle = withinModifyWindow ? '' : ' title="Added more than an hour ago — admin password required"';
    tr.innerHTML = `
      <td class="idx">${i+1}</td>
      <td>${escapeHtml(e.category)}</td>
      <td class="subcat">${escapeHtml(e.subcategory || '—')}</td>
      <td class="supplier">${escapeHtml(e.supplier)}</td>
      <td class="subcat">${escapeHtml(e.invoice || '—')}</td>
      <td class="amount">${fmtMoney(e.amount)}</td>
      <td><button class="badge ${e.status}" data-id="${e.id}" data-action="toggle">${e.status}</button></td>
      <td><button class="modify-btn" data-id="${e.id}" data-action="modify"${modifyTitle}>${modifyLabel}</button></td>
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
// Sales for a day are freely editable while new (currentSales === null) or within
// MODIFY_WINDOW_MS of when they were first saved — same 1hr-then-password rule as
// bills. currentSalesSavedAt is null for legacy dates saved before this feature
// existed, which is treated as "outside the window" (locked) rather than guessed at.
function salesWithinModifyWindow(){
  return isOwnerProfile() || currentSales === null || (!!currentSalesSavedAt && (Date.now() - currentSalesSavedAt) < MODIFY_WINDOW_MS);
}
function updateSalesLockUI(){
  const input = document.getElementById('salesInput');
  const btn = document.getElementById('saveSalesBtn');
  const locked = !salesWithinModifyWindow() && !salesTempUnlocked;
  input.disabled = locked;
  btn.textContent = locked ? '🔒 Unlock' : 'Save';
  btn.title = locked ? "Sales entered more than an hour ago — click to unlock with the admin password" : "";
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
/* ---------- Modify bill modal ---------- */
let editBillId = null;
function renderEditBillSupplierSelect(selectedSupplier){
  const sel = document.getElementById('editBillSupplier');
  sel.innerHTML = "";
  [...suppliers].sort((a,b)=>a.localeCompare(b)).forEach(s=>{
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    sel.appendChild(opt);
  });
  if(selectedSupplier && !suppliers.includes(selectedSupplier)){
    const opt = document.createElement('option');
    opt.value = selectedSupplier; opt.textContent = selectedSupplier + ' (removed)';
    sel.appendChild(opt);
  }
  sel.value = selectedSupplier || "";
}
// Category/subcategory are never directly editable here — same supplier-first
// rule as the quick-add form (see supplierCatHint). This just displays what
// the currently-selected supplier's default is; fix the default via Manage
// Suppliers if it's wrong, don't override it per-bill.
function renderEditBillCatHint(){
  const supplier = document.getElementById('editBillSupplier').value;
  const hint = document.getElementById('editBillCatHint');
  if(!supplier){
    hint.style.display = 'none';
    return;
  }
  const def = supplierDefaults[supplierKey(supplier)];
  hint.style.display = 'block';
  if(def && categories[def.category]){
    hint.classList.remove('missing');
    hint.innerHTML = `Category: <b>${escapeHtml(def.category)}${def.subcategory ? ' → ' + escapeHtml(def.subcategory) : ''}</b><span class="change-link" id="editBillChangeCatLink">change</span>`;
  } else {
    hint.classList.add('missing');
    hint.innerHTML = `No category set for this supplier.<span class="change-link" id="editBillChangeCatLink">set now</span>`;
  }
  document.getElementById('editBillChangeCatLink').addEventListener('click', ()=>{
    openNewSupplierBox(supplier);
  });
}
function setEditBillStatus(s){
  document.getElementById('editBillBtnUnpaid').classList.toggle('active', s === 'unpaid');
  document.getElementById('editBillBtnPaid').classList.toggle('active', s === 'paid');
}
function openEditBillModal(entry){
  editBillId = entry.id;
  renderEditBillSupplierSelect(entry.supplier);
  renderEditBillCatHint();
  document.getElementById('editBillDate').value = currentDate;
  document.getElementById('editBillInvoice').value = entry.invoice || "";
  document.getElementById('editBillAmount').value = entry.amount;
  setEditBillStatus(entry.status);
  document.getElementById('editBillError').classList.remove('show');
  document.getElementById('editBillModal').classList.add('open');
}
function closeEditBillModal(){
  document.getElementById('editBillModal').classList.remove('open');
  editBillId = null;
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
   Shown once login (see auth.js) has confirmed the profile and, for a manager,
   the restaurant's own password. Picking a restaurant here is a deliberate,
   separate step from the rest of the UI — once confirmed, the dropdown is
   hidden behind a "Change restaurant" button so a manager mid-entry can't
   accidentally flip the dropdown and keep adding bills against the wrong
   restaurant. */
function showConfirmedRestaurant(){
  document.getElementById('profileGate').style.display = 'none';
  document.getElementById('ownerLoginGate').style.display = 'none';
  document.getElementById('restaurantGate').style.display = 'none';
  document.getElementById('restaurantConfirmedBar').style.display = 'flex';
  document.getElementById('restaurantConfirmedName').textContent = restaurantLabel(currentRestaurantId);
  document.getElementById('appTabsWrap').style.display = 'block';
}
document.getElementById('saveSalesBtn').addEventListener('click', async ()=>{
  if(document.getElementById('salesInput').disabled){
    openModifyAuthModal(()=>{
      salesTempUnlocked = true;
      updateSalesLockUI();
      document.getElementById('salesInput').focus();
    });
    return;
  }
  const ok = await saveSalesValue();
  const hint = document.getElementById('salesSavedHint');
  if(ok){
    salesTempUnlocked = false;
    renderTotals();
    updateSalesLockUI();
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

document.getElementById('editBillSupplier').addEventListener('change', renderEditBillCatHint);
document.getElementById('editBillBtnUnpaid').addEventListener('click', ()=>setEditBillStatus('unpaid'));
document.getElementById('editBillBtnPaid').addEventListener('click', ()=>setEditBillStatus('paid'));
document.getElementById('editBillCancel').addEventListener('click', closeEditBillModal);
document.getElementById('editBillModal').addEventListener('click', (ev)=>{
  if(ev.target.id === 'editBillModal') closeEditBillModal();
});
document.getElementById('editBillSave').addEventListener('click', async ()=>{
  const entry = entries.find(x=>x.id === editBillId);
  if(!entry){ closeEditBillModal(); return; }
  const supplier = document.getElementById('editBillSupplier').value;
  const def = supplierDefaults[supplierKey(supplier)];
  const newDate = document.getElementById('editBillDate').value;
  const invoice = document.getElementById('editBillInvoice').value.trim();
  const amount = parseFloat(document.getElementById('editBillAmount').value);
  const status = document.getElementById('editBillBtnPaid').classList.contains('active') ? 'paid' : 'unpaid';
  if(!supplier || !def || !categories[def.category] || !newDate || !amount || amount <= 0){
    document.getElementById('editBillError').classList.add('show');
    return;
  }
  document.getElementById('editBillError').classList.remove('show');
  entry.supplier = supplier;
  entry.category = def.category;
  entry.subcategory = def.subcategory || "";
  entry.invoice = invoice;
  entry.amount = amount;
  entry.status = status;

  if(newDate !== currentDate){
    await moveEntryDate(entry, newDate);
  } else {
    await saveEntries();
  }
  renderTable();
  renderTotals();
  renderBreakdown();
  closeEditBillModal();
  if(newDate !== currentDate){
    alert(`Moved to ${fmtDateLabel(newDate)} — it no longer appears in this day's ledger. Navigate to that date to see it.`);
  }
});

