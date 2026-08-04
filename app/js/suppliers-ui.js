/* ---------- Rendering ---------- */
function renderNewSupplierCatSelect(){
  const sel = document.getElementById('newSupplierCat');
  const prev = sel.value;
  sel.innerHTML = "";
  Object.keys(categories).forEach(c=>{
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    sel.appendChild(opt);
  });
  if(prev && categories[prev]) sel.value = prev;
  renderNewSupplierSubList();
}
function renderNewSupplierSubList(){
  const cat = document.getElementById('newSupplierCat').value;
  const dl = document.getElementById('newSupplierSubList');
  dl.innerHTML = "";
  (categories[cat] || []).forEach(s=>{
    const opt = document.createElement('option');
    opt.value = s;
    dl.appendChild(opt);
  });
}
function renderSupplierSelect(){
  const sel = document.getElementById('supplierSelect');
  const prev = sel.value;
  sel.innerHTML = '<option value="">Select supplier…</option>';
  [...suppliers].sort((a,b)=>a.localeCompare(b)).forEach(s=>{
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    sel.appendChild(opt);
  });
  if(prev && suppliers.includes(prev)) sel.value = prev;
  renderSupplierCatHint();
  updateQaRestFieldsVisibility();
}
function updateQaRestFieldsVisibility(){
  const hasSupplier = !!document.getElementById('supplierSelect').value;
  document.getElementById('qaRestFields').classList.toggle('open', hasSupplier);
}
function renderSupplierCatHint(){
  const supplier = document.getElementById('supplierSelect').value;
  const hint = document.getElementById('supplierCatHint');
  if(!supplier){
    hint.style.display = 'none';
    return;
  }
  const def = supplierDefaults[supplierKey(supplier)];
  hint.style.display = 'block';
  if(def && categories[def.category]){
    hint.classList.remove('missing');
    hint.innerHTML = `Category: <b>${escapeHtml(def.category)}${def.subcategory ? ' → ' + escapeHtml(def.subcategory) : ''}</b><span class="change-link" id="changeSupplierCatLink">change</span>`;
  } else {
    hint.classList.add('missing');
    hint.innerHTML = `No category set for this supplier.<span class="change-link" id="changeSupplierCatLink">set now</span>`;
  }
  document.getElementById('changeSupplierCatLink').addEventListener('click', ()=>{
    openNewSupplierBox(supplier);
  });
}
function openNewSupplierBox(prefillSupplier){
  document.getElementById('manageSuppliersModal').classList.add('open');
  document.getElementById('newSupplierName').value = prefillSupplier || "";
  const def = prefillSupplier ? supplierDefaults[supplierKey(prefillSupplier)] : null;
  renderNewSupplierCatSelect();
  if(def && categories[def.category]){
    document.getElementById('newSupplierCat').value = def.category;
    renderNewSupplierSubList();
    document.getElementById('newSupplierSub').value = def.subcategory || "";
  } else {
    document.getElementById('newSupplierSub').value = "";
  }
  document.getElementById('newSupplierName').focus();
  renderManageSupplierList();
}

/* ---------- Manage Suppliers modal ---------- */
function openManageSuppliersModal(){
  document.getElementById('manageSuppliersModal').classList.add('open');
  document.getElementById('manageSupplierSearch').value = "";
  renderManageSupplierList();
}
function closeManageSuppliersModal(){
  document.getElementById('manageSuppliersModal').classList.remove('open');
}
function renderManageSupplierList(filterText){
  const listEl = document.getElementById('manageSupplierList');
  const search = (filterText !== undefined ? filterText : document.getElementById('manageSupplierSearch').value).trim().toLowerCase();
  listEl.innerHTML = "";
  const sorted = [...suppliers].sort((a,b)=>a.localeCompare(b));
  const filtered = search ? sorted.filter(s=>s.toLowerCase().includes(search)) : sorted;
  document.getElementById('manageSupplierCount').textContent = "(" + suppliers.length + ")";
  if(filtered.length === 0){
    const empty = document.createElement('div');
    empty.className = 'manage-empty';
    empty.textContent = suppliers.length === 0 ? "No suppliers yet — add one below." : "No suppliers match your search.";
    listEl.appendChild(empty);
    return;
  }
  filtered.forEach(name=>{ listEl.appendChild(buildManageSupplierRow(name)); });
}
function buildManageSupplierRow(name){
  const row = document.createElement('div');
  row.className = 'manage-supplier-row';

  const view = document.createElement('div');
  view.className = 'msr-view';

  const nameEl = document.createElement('span');
  nameEl.className = 'msr-name';
  nameEl.textContent = name;

  const def = supplierDefaults[supplierKey(name)];
  const catEl = document.createElement('span');
  if(def && categories[def.category]){
    catEl.className = 'msr-cat';
    catEl.textContent = def.category + (def.subcategory ? ' → ' + def.subcategory : '');
  } else {
    catEl.className = 'msr-cat missing';
    catEl.textContent = 'No category set';
  }

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'msr-edit-btn';
  editBtn.textContent = 'Edit';

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'msr-delete-btn';
  deleteBtn.textContent = 'Remove';

  view.appendChild(nameEl);
  view.appendChild(catEl);
  view.appendChild(editBtn);
  view.appendChild(deleteBtn);
  row.appendChild(view);

  editBtn.addEventListener('click', ()=>{
    const existing = row.querySelector('.msr-edit');
    if(existing){ existing.remove(); return; }
    row.appendChild(buildManageSupplierEditForm(name));
  });

  deleteBtn.addEventListener('click', async ()=>{
    if(!confirm(`Remove "${name}" from the supplier list? Past bills already logged under this supplier are not affected.`)) return;
    suppliers = suppliers.filter(s=>s !== name);
    delete supplierDefaults[supplierKey(name)];
    await saveSuppliers();
    await saveSupplierDefaults();
    renderManageSupplierList();
    renderSupplierSelect();
  });

  return row;
}
function buildManageSupplierEditForm(name){
  const def = supplierDefaults[supplierKey(name)];
  const wrap = document.createElement('div');
  wrap.className = 'msr-edit';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.value = name;

  const catSelect = document.createElement('select');
  Object.keys(categories).forEach(c=>{
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    catSelect.appendChild(opt);
  });
  if(def && categories[def.category]) catSelect.value = def.category;

  const subInput = document.createElement('input');
  subInput.type = 'text';
  subInput.placeholder = 'Subcategory (optional)';
  subInput.value = (def && def.subcategory) || '';
  const subDatalistId = 'msrSubList_' + Math.random().toString(36).slice(2,8);
  subInput.setAttribute('list', subDatalistId);
  const datalist = document.createElement('datalist');
  datalist.id = subDatalistId;
  function refreshSubDatalist(){
    datalist.innerHTML = "";
    (categories[catSelect.value] || []).forEach(s=>{
      const opt = document.createElement('option');
      opt.value = s;
      datalist.appendChild(opt);
    });
  }
  refreshSubDatalist();
  catSelect.addEventListener('change', refreshSubDatalist);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'msr-save-btn';
  saveBtn.textContent = 'Save';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'msr-cancel-btn';
  cancelBtn.textContent = 'Cancel';

  saveBtn.addEventListener('click', async ()=>{
    const newName = nameInput.value.trim();
    const newCat = catSelect.value;
    const newSub = subInput.value.trim();
    if(!newName || !newCat){
      alert("Please enter a supplier name and pick a category.");
      return;
    }
    if(newSub && !categories[newCat].includes(newSub)){
      categories[newCat].push(newSub);
      await saveCategories();
    }
    if(newName !== name){
      const idx = suppliers.indexOf(name);
      if(idx !== -1) suppliers[idx] = newName;
      delete supplierDefaults[supplierKey(name)];
    }
    supplierDefaults[supplierKey(newName)] = { category: newCat, subcategory: newSub };
    await saveSuppliers();
    await saveSupplierDefaults();
    renderManageSupplierList();
    renderSupplierSelect();
  });
  cancelBtn.addEventListener('click', ()=>{ wrap.remove(); });

  wrap.appendChild(nameInput);
  wrap.appendChild(catSelect);
  wrap.appendChild(subInput);
  wrap.appendChild(datalist);
  wrap.appendChild(saveBtn);
  wrap.appendChild(cancelBtn);
  return wrap;
}
