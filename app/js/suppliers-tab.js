/* ---------- Suppliers tab (owner-only) ----------
   A full-tab view over the same suppliers/categories/supplierDefaults data
   the Add Expenses toolbar's "Manage Suppliers" modal already edits — shared
   across every restaurant on this account (those three keys were never
   namespaced by restaurant, see CONTEXT.md). Reuses buildManageSupplierRow /
   buildManageSupplierEditForm (suppliers-ui.js) for the list itself, so the
   retroactive category-propagation behavior added there applies here too
   without duplicating it. The "add a new supplier" form below is a separate,
   parallel copy of the modal's own add form (own element ids) rather than a
   shared one, since that logic isn't otherwise reusable without a bigger
   refactor across files. */

function showSuppliersTabPanel(){
  renderSupTabNewCatSelect();
  renderSuppliersTabList();
}

function renderSuppliersTabList(filterText){
  const listEl = document.getElementById('supTabList');
  const search = (filterText !== undefined ? filterText : document.getElementById('supTabSearch').value).trim().toLowerCase();
  listEl.innerHTML = "";
  const sorted = [...suppliers].sort((a,b)=>a.localeCompare(b));
  const filtered = search ? sorted.filter(s=>s.toLowerCase().includes(search)) : sorted;
  document.getElementById('supTabCount').textContent = "(" + suppliers.length + ")";
  if(filtered.length === 0){
    const empty = document.createElement('div');
    empty.className = 'manage-empty';
    empty.textContent = suppliers.length === 0 ? "No suppliers yet — add one below." : "No suppliers match your search.";
    listEl.appendChild(empty);
    return;
  }
  filtered.forEach(name=>{ listEl.appendChild(buildManageSupplierRow(name, renderSuppliersTabList)); });
}
document.getElementById('supTabSearch').addEventListener('input', (ev)=>{
  renderSuppliersTabList(ev.target.value);
});

/* ---------- Add a new supplier ---------- */
function renderSupTabNewCatSelect(){
  const sel = document.getElementById('supTabNewCat');
  const prev = sel.value;
  sel.innerHTML = "";
  Object.keys(categories).forEach(c=>{
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    sel.appendChild(opt);
  });
  if(prev && categories[prev]) sel.value = prev;
  renderSupTabNewSubList();
}
function renderSupTabNewSubList(){
  const cat = document.getElementById('supTabNewCat').value;
  const dl = document.getElementById('supTabNewSubList');
  dl.innerHTML = "";
  (categories[cat] || []).forEach(s=>{
    const opt = document.createElement('option');
    opt.value = s;
    dl.appendChild(opt);
  });
}
document.getElementById('supTabNewCat').addEventListener('change', renderSupTabNewSubList);

document.getElementById('supTabAddCatLink').addEventListener('click', ()=>{
  document.getElementById('supTabAddCatBox').classList.toggle('open');
  document.getElementById('supTabNewCatInput').focus();
});
document.getElementById('supTabNewCatSave').addEventListener('click', async ()=>{
  const input = document.getElementById('supTabNewCatInput');
  const name = input.value.trim();
  if(!name) return;
  if(!categories[name]) categories[name] = [];
  await saveCategories();
  renderSupTabNewCatSelect();
  document.getElementById('supTabNewCat').value = name;
  renderSupTabNewSubList();
  input.value = "";
  document.getElementById('supTabAddCatBox').classList.remove('open');
});

document.getElementById('supTabAddSubLink').addEventListener('click', ()=>{
  document.getElementById('supTabAddSubBox').classList.toggle('open');
  document.getElementById('supTabNewSubInput').focus();
});
document.getElementById('supTabNewSubSave').addEventListener('click', async ()=>{
  const cat = document.getElementById('supTabNewCat').value;
  const input = document.getElementById('supTabNewSubInput');
  const name = input.value.trim();
  if(!name || !cat) return;
  if(!categories[cat].includes(name)) categories[cat].push(name);
  await saveCategories();
  renderSupTabNewSubList();
  document.getElementById('supTabNewSub').value = name;
  input.value = "";
  document.getElementById('supTabAddSubBox').classList.remove('open');
});

document.getElementById('supTabSaveSupplierBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('supTabNewName').value.trim();
  const cat = document.getElementById('supTabNewCat').value;
  const sub = document.getElementById('supTabNewSub').value.trim();
  if(!name || !cat){
    alert("Please enter a supplier name and pick a category.");
    return;
  }
  if(!suppliers.includes(name)){
    suppliers.push(name);
    await saveSuppliers();
  }
  if(sub && !categories[cat].includes(sub)){
    categories[cat].push(sub);
    await saveCategories();
  }
  supplierDefaults[supplierKey(name)] = { category: cat, subcategory: sub };
  await saveSupplierDefaults();

  renderSupplierSelect(); // keeps the Add Expenses quick-add dropdown in sync
  renderSuppliersTabList();
  document.getElementById('supTabNewName').value = "";
  document.getElementById('supTabNewSub').value = "";
  document.getElementById('supTabNewName').focus();
});
