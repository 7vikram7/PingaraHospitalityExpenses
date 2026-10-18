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
  renderSupSimilarSection();
  // Bulk edit and combine-duplicates can both retroactively change an
  // EXISTING supplier's category/name (same propagate-to-past-bills effect
  // as the manual Edit form) -- Central Kitchen gets the same "no
  // modifying existing records" boundary here as it does on the per-row
  // Edit button (canEditExistingRecords(), core.js).
  document.getElementById('supBulkEditWrap').style.display = canEditExistingRecords() ? '' : 'none';
  document.getElementById('supCombineWrap').style.display = canEditExistingRecords() ? '' : 'none';
}

/* ---------- Suggested similar vendors (added 2026-10-18) ----------
   findSimilarSupplierGroups() (data-store.js) does the actual fuzzy
   matching; this just renders its output and wires each group's "Combine
   these" button into the existing combine-duplicates tool below (opens
   combine mode if it isn't already, pre-checks that group's names). A full
   cross-restaurant bill scan (via findOrphanSupplierNamesInBills()) runs
   underneath, so this is scan-on-demand (tab open, or "rescan" after
   adding/editing suppliers) rather than re-run on every keystroke. */
async function renderSupSimilarSection(){
  if(!canEditExistingRecords()){
    document.getElementById('supSimilarSection').style.display = 'none';
    return;
  }
  document.getElementById('supSimilarSection').style.display = '';
  const listEl = document.getElementById('supSimilarList');
  const countEl = document.getElementById('supSimilarCount');
  listEl.innerHTML = "";
  countEl.textContent = "(scanning…)";
  const groups = await findSimilarSupplierGroups();
  countEl.textContent = groups.length ? `(${groups.length})` : "";
  if(groups.length === 0){
    const empty = document.createElement('div');
    empty.className = 'manage-empty';
    empty.textContent = "No likely duplicates found.";
    listEl.appendChild(empty);
    return;
  }
  groups.forEach(group=>{
    const card = document.createElement('div');
    card.className = 'sup-similar-card';
    const namesEl = document.createElement('div');
    namesEl.className = 'sup-similar-names';
    group.names.forEach((name, i)=>{
      const def = supplierDefaults[supplierKey(name)];
      const pill = document.createElement('span');
      pill.className = 'sup-similar-pill';
      pill.textContent = name + (def && categories[def.category] ? ` (${def.category}${def.subcategory ? ' → ' + def.subcategory : ''})` : '');
      namesEl.appendChild(pill);
      if(i < group.names.length - 1){
        const sep = document.createElement('span');
        sep.className = 'sup-similar-sep';
        sep.textContent = '≈';
        namesEl.appendChild(sep);
      }
    });
    const actionBtn = document.createElement('button');
    actionBtn.type = 'button';
    actionBtn.className = 'history-btn';
    actionBtn.textContent = 'Combine these';
    actionBtn.addEventListener('click', ()=> startCombineFromSuggestion(group.names));
    card.appendChild(namesEl);
    card.appendChild(actionBtn);
    listEl.appendChild(card);
  });
}
document.getElementById('supSimilarRescanLink').addEventListener('click', renderSupSimilarSection);

// Pre-checks a suggested group's names into the existing combine-duplicates
// tool and scrolls it into view, rather than duplicating that tool's own
// merge logic here.
function startCombineFromSuggestion(names){
  if(!supCombineModeActive){
    supCombineModeActive = true;
    document.getElementById('supCombineBox').classList.add('open');
    renderSupCombineOrphans();
  }
  supCombineSelected = new Set(names);
  supCombineCatInitialized = false;
  document.getElementById('supCombineNameInput').value = "";
  renderSuppliersTabList();
  renderSupCombineBar();
  document.getElementById('supCombineBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Sort/bank-account filter added 2026-10-20, same request applied "where
// possible" across Vendor Ledger/Payments/Suppliers -- no "amount pending"
// option here, since a plain supplier directory entry has no amount at
// all (that only exists on bills), so only the sort/filter axes that
// actually apply to this list are offered.
let supSortBy = 'name_asc'; // 'name_asc' | 'name_desc'
let supBankFilter = 'all'; // 'all' | 'with' | 'without'
function renderSuppliersTabList(filterText){
  const listEl = document.getElementById('supTabList');
  const search = (filterText !== undefined ? filterText : document.getElementById('supTabSearch').value).trim().toLowerCase();
  listEl.innerHTML = "";
  const sorted = [...suppliers].sort((a,b)=> supSortBy === 'name_desc' ? b.localeCompare(a) : a.localeCompare(b));
  let filtered = search ? sorted.filter(s=>s.toLowerCase().includes(search)) : sorted;
  if(supBankFilter !== 'all'){
    filtered = filtered.filter(s => supBankFilter === 'with' ? supplierHasBankAccount(s) : !supplierHasBankAccount(s));
  }
  document.getElementById('supTabCount').textContent = "(" + suppliers.length + ")";
  if(filtered.length === 0){
    const empty = document.createElement('div');
    empty.className = 'manage-empty';
    empty.textContent = suppliers.length === 0 ? "No suppliers yet — add one below." : "No suppliers match your search/filter.";
    listEl.appendChild(empty);
    return;
  }
  filtered.forEach(name=>{ listEl.appendChild(buildManageSupplierRow(name, renderSuppliersTabList, supCombineModeActive)); });
}
document.getElementById('supTabSearch').addEventListener('input', (ev)=>{
  renderSuppliersTabList(ev.target.value);
});
document.getElementById('supSortSelect').addEventListener('change', (ev)=>{
  supSortBy = ev.target.value;
  renderSuppliersTabList();
});
document.getElementById('supBankFilterSelect').addEventListener('change', (ev)=>{
  supBankFilter = ev.target.value;
  renderSuppliersTabList();
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
  const accountNumber = document.getElementById('supTabNewAccount').value.trim();
  const ifscCode = document.getElementById('supTabNewIfsc').value.trim().toUpperCase();
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
  supplierBankDetails[supplierKey(name)] = { accountNumber, ifscCode };
  await saveSupplierBankDetails();

  renderSupplierSelect(); // keeps the Add Expenses quick-add dropdown in sync
  renderSuppliersTabList();
  document.getElementById('supTabNewName').value = "";
  document.getElementById('supTabNewSub').value = "";
  document.getElementById('supTabNewAccount').value = "";
  document.getElementById('supTabNewIfsc').value = "";
  document.getElementById('supTabNewName').focus();
});

/* ---------- Bulk edit via Excel (added 2026-10-15) ----------
   Unlike Staff's own bulk upload (add-only, see staff-tab.js), this is a
   genuine round-trip EDIT: "Download template" exports every current
   supplier with its category/subcategory/bank details already filled in,
   so editing a cell and re-uploading the same file updates that supplier in
   place (matched by supplierKey(), case/whitespace-insensitive) rather than
   creating a duplicate. A name with no existing match is added as a new
   supplier instead. A blank Category/Subcategory/Account/IFSC cell on an
   EXISTING supplier's row clears that field -- the file reflects the
   intended final state, not a partial patch. Category changes propagate to
   past bills exactly like the manual Edit form does (one summary alert for
   the whole batch, not one per row). Genuinely an actual .xlsx (not .csv,
   unlike Staff's template) per the explicit "excel file" wording of the
   request this shipped from. */
const SUPPLIER_TEMPLATE_HEADERS = ["Supplier Name*", "Category", "Subcategory", "Account Number", "IFSC Code"];
document.getElementById('supBulkEditLink').addEventListener('click', ()=>{
  document.getElementById('supBulkEditBox').classList.toggle('open');
});
document.getElementById('supDownloadTemplateBtn').addEventListener('click', ()=>{
  const rows = [SUPPLIER_TEMPLATE_HEADERS];
  [...suppliers].sort((a,b)=>a.localeCompare(b)).forEach(name=>{
    const def = supplierDefaults[supplierKey(name)] || {};
    const bank = supplierBankDetails[supplierKey(name)] || {};
    rows.push([name, def.category || "", def.subcategory || "", bank.accountNumber || "", bank.ifscCode || ""]);
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "Suppliers");
  XLSX.writeFile(wb, "suppliers-template.xlsx");
});
document.getElementById('supUploadBtn').addEventListener('click', async ()=>{
  if(!canEditExistingRecords()) return;
  const fileInput = document.getElementById('supUploadFile');
  const file = fileInput.files[0];
  const resultEl = document.getElementById('supUploadResult');
  if(!file){ resultEl.textContent = "Choose a file first."; return; }
  resultEl.textContent = "Uploading…";
  try{
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const get = (row, ...keys) => {
      const wanted = keys.map(k => k.toLowerCase());
      for(const k of Object.keys(row)){
        const normalized = k.trim().replace(/\*$/, '').trim().toLowerCase();
        if(wanted.includes(normalized)) return String(row[k]).trim();
      }
      return "";
    };

    let added = 0, updated = 0, skipped = 0, categoriesChanged = false;
    const unknownCategories = [];
    const pendingPropagations = []; // {name, category, subcategory}
    rows.forEach(row=>{
      const name = get(row, "Supplier Name", "Name");
      if(!name){ skipped++; return; }
      const existingName = suppliers.find(s => supplierKey(s) === supplierKey(name));
      const isNew = !existingName;
      const canonicalName = existingName || name;
      if(isNew) suppliers.push(name);

      const cat = get(row, "Category");
      const sub = get(row, "Subcategory");
      if(cat){
        if(categories[cat]){
          if(sub && !categories[cat].includes(sub)){
            categories[cat].push(sub);
            categoriesChanged = true;
          }
          const prevDef = supplierDefaults[supplierKey(canonicalName)];
          const categoryChanged = !isNew && (!prevDef || prevDef.category !== cat || (prevDef.subcategory||"") !== sub);
          supplierDefaults[supplierKey(canonicalName)] = { category: cat, subcategory: sub };
          if(categoryChanged) pendingPropagations.push({ name: canonicalName, category: cat, subcategory: sub });
        } else {
          unknownCategories.push(`${canonicalName} ("${cat}")`);
        }
      } else if(!isNew){
        delete supplierDefaults[supplierKey(canonicalName)];
      }

      const accountNumber = get(row, "Account Number", "Account No", "Account");
      const ifscCode = get(row, "IFSC Code", "IFSC").toUpperCase();
      supplierBankDetails[supplierKey(canonicalName)] = { accountNumber, ifscCode };

      if(isNew) added++; else updated++;
    });

    if(added > 0 || updated > 0) await saveSuppliers();
    await saveSupplierDefaults();
    await saveSupplierBankDetails();
    if(categoriesChanged) await saveCategories();

    let billsUpdated = 0;
    for(const p of pendingPropagations){
      billsUpdated += await propagateSupplierEditToAllBills(p.name, p.name, p.category, p.subcategory);
    }

    let msg = `Added ${added} new supplier${added===1?'':'s'}, updated ${updated} existing.`;
    if(skipped > 0) msg += ` Skipped ${skipped} row${skipped===1?'':'s'} with no name.`;
    if(unknownCategories.length > 0) msg += ` ${unknownCategories.length} row(s) had an unrecognized category and were left uncategorized: ${unknownCategories.join(', ')}.`;
    if(billsUpdated > 0) msg += ` Updated ${billsUpdated} past bill${billsUpdated===1?'':'s'} to match category changes.`;
    resultEl.textContent = msg;

    renderSupplierSelect();
    renderSuppliersTabList();
    fileInput.value = "";
  }catch(e){
    console.error("supplier bulk edit failed", e);
    resultEl.textContent = "Couldn't read that file — make sure it's a .csv or .xlsx matching the template.";
  }
});

/* ---------- Combine duplicate suppliers (added 2026-10-19) ----------
   Managers have entered the same real vendor under more than one name over
   time (a typo, a spelling variant, a different capitalization) --
   `buildManageSupplierRow()` (suppliers-ui.js) grows a checkbox per row
   when this mode is active (combineMode arg, Suppliers-tab-only by
   design -- the Manage Suppliers modal's own list never passes it). Check
   2+ of the duplicates, type the name to use henceforth (or pick one of
   the checked suppliers' own exact spellings from the datalist), and every
   checked supplier's past bills get retroactively renamed to that one
   name via propagateSupplierEditToAllBills() -- the same function the
   Edit form's own rename handling (suppliers-ui.js) uses, reused here
   rather than duplicated. Per the user's explicit choice: if the final
   name matches one of the checked suppliers exactly, that supplier's own
   category/subcategory/bank details are kept on the merged entry;
   otherwise (a brand-new spelling) the FIRST checked supplier's data is
   used as the base -- no per-field picking UI, just this one rule.

   Also surfaces "orphaned" vendor names (added 2026-10-19, after a real
   live case: a supplier had been removed from -- or never added to -- the
   directory while still actively being billed, so it never showed up here
   to check, even though Vendor Ledger showed it fine since that reads
   bills directly) via findOrphanSupplierNamesInBills() (data-store.js) --
   scanned once when combine mode is entered, rendered as extra checkbox
   rows below the normal list, feeding the exact same supCombineSelected
   Set so they merge through identical logic. */
let supCombineModeActive = false;
let supCombineSelected = new Set(); // exact supplier names currently checked
// Tracks whether the category/subcategory fields have been defaulted yet
// for the CURRENT selection -- reset whenever combine mode (re)opens or a
// suggestion pre-fills the selection, so the auto-suggested category still
// shows up front, but re-rendering after a checkbox toggle doesn't blow
// away a choice the user already made (same pattern the name input uses).
let supCombineCatInitialized = false;
async function renderSupCombineOrphans(){
  const wrap = document.getElementById('supCombineOrphans');
  wrap.innerHTML = "";
  const hint = document.createElement('p');
  hint.className = 'count-hint';
  hint.textContent = 'Scanning bill history for vendor names not in your supplier list…';
  wrap.appendChild(hint);
  const orphans = await findOrphanSupplierNamesInBills();
  if(!supCombineModeActive) return; // mode was toggled off again while the scan was running
  wrap.innerHTML = "";
  if(orphans.length === 0) return;
  const heading = document.createElement('p');
  heading.className = 'sup-tab-note';
  heading.textContent = 'Also found in bill history, not in your supplier list:';
  wrap.appendChild(heading);
  orphans.forEach(({ name, count })=>{
    const row = document.createElement('div');
    row.className = 'manage-supplier-row';
    const view = document.createElement('div');
    view.className = 'msr-view';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'msr-combine-check';
    checkbox.checked = supCombineSelected.has(name);
    checkbox.addEventListener('change', ()=>{
      if(checkbox.checked) supCombineSelected.add(name);
      else supCombineSelected.delete(name);
      renderSupCombineBar();
    });
    const nameEl = document.createElement('span');
    nameEl.className = 'msr-name';
    nameEl.textContent = name;
    const hintEl = document.createElement('span');
    hintEl.className = 'msr-cat missing';
    hintEl.textContent = `${count} bill${count === 1 ? '' : 's'} — not in supplier list`;
    view.appendChild(checkbox);
    view.appendChild(nameEl);
    view.appendChild(hintEl);
    row.appendChild(view);
    wrap.appendChild(row);
  });
}
// Same "exact match wins, else first checked" rule the combine tool always
// used to pick category/subcategory automatically -- now just the DEFAULT
// shown in the editable select/input below, not the final word.
function deriveCombineCategoryDefault(selected, finalName){
  const exactMatchName = selected.find(n => supplierKey(n) === supplierKey(finalName));
  const sourceName = exactMatchName || selected[0];
  return supplierDefaults[supplierKey(sourceName)] || {};
}
function renderSupCombineCatSelect(){
  const sel = document.getElementById('supCombineCatSelect');
  const prev = sel.value;
  sel.innerHTML = "";
  Object.keys(categories).forEach(c=>{
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    sel.appendChild(opt);
  });
  if(prev && categories[prev]) sel.value = prev;
  renderSupCombineSubList();
}
function renderSupCombineSubList(){
  const cat = document.getElementById('supCombineCatSelect').value;
  const dl = document.getElementById('supCombineSubList');
  dl.innerHTML = "";
  (categories[cat] || []).forEach(s=>{
    const opt = document.createElement('option');
    opt.value = s;
    dl.appendChild(opt);
  });
}
document.getElementById('supCombineCatSelect').addEventListener('change', renderSupCombineSubList);

function renderSupCombineBar(){
  const bar = document.getElementById('supCombineBar');
  const n = supCombineSelected.size;
  bar.style.display = n >= 2 ? 'flex' : 'none';
  if(n < 2) return;
  document.getElementById('supCombineCount').textContent = `${n} selected`;
  const dl = document.getElementById('supCombineNameList');
  dl.innerHTML = "";
  const names = Array.from(supCombineSelected);
  names.forEach(n2=>{
    const opt = document.createElement('option');
    opt.value = n2;
    dl.appendChild(opt);
  });
  const nameInput = document.getElementById('supCombineNameInput');
  if(!nameInput.value) nameInput.value = names[0]; // default: first checked, still editable

  renderSupCombineCatSelect();
  if(!supCombineCatInitialized){
    const def = deriveCombineCategoryDefault(names, nameInput.value);
    if(def.category && categories[def.category]){
      document.getElementById('supCombineCatSelect').value = def.category;
      renderSupCombineSubList();
    }
    document.getElementById('supCombineSubInput').value = def.subcategory || "";
    supCombineCatInitialized = true;
  }
}
document.getElementById('supCombineLink').addEventListener('click', ()=>{
  supCombineModeActive = !supCombineModeActive;
  document.getElementById('supCombineBox').classList.toggle('open', supCombineModeActive);
  if(!supCombineModeActive){
    supCombineSelected.clear();
    supCombineCatInitialized = false;
    document.getElementById('supCombineNameInput').value = "";
    document.getElementById('supCombineOrphans').innerHTML = "";
  }
  renderSuppliersTabList();
  renderSupCombineBar();
  if(supCombineModeActive) renderSupCombineOrphans();
});
document.getElementById('supCombineCancelBtn').addEventListener('click', ()=>{
  supCombineSelected.clear();
  supCombineCatInitialized = false;
  document.getElementById('supCombineNameInput').value = "";
  renderSuppliersTabList();
  renderSupCombineBar();
  renderSupCombineOrphans();
});
document.getElementById('supCombineConfirmBtn').addEventListener('click', async ()=>{
  if(!canEditExistingRecords()) return;
  const selected = Array.from(supCombineSelected);
  if(selected.length < 2) return;
  const finalName = document.getElementById('supCombineNameInput').value.trim();
  if(!finalName){
    alert("Enter the name to use for the combined supplier.");
    return;
  }

  const exactMatchName = selected.find(n => supplierKey(n) === supplierKey(finalName));
  const sourceName = exactMatchName || selected[0];
  const keptBank = supplierBankDetails[supplierKey(sourceName)] || {};
  // Category/subcategory now come from the combine bar's own editable
  // select/input (added 2026-10-18, user's explicit ask) instead of being
  // silently auto-picked from one of the merged suppliers -- the fields
  // are still pre-filled with that same auto-pick as a starting point (see
  // deriveCombineCategoryDefault()/renderSupCombineBar()), just no longer
  // the final word.
  const keptCategory = document.getElementById('supCombineCatSelect').value;
  const keptSubcategory = document.getElementById('supCombineSubInput').value.trim();
  const keptAccountNumber = keptBank.accountNumber || "";
  const keptIfscCode = keptBank.ifscCode || "";
  if(!keptCategory){
    alert("Please pick a category for the combined supplier.");
    return;
  }

  const confirmBtn = document.getElementById('supCombineConfirmBtn');
  if(!confirm(`Combine ${selected.length} suppliers into "${finalName}"?\n\nEvery past bill logged under the other name${selected.length === 2 ? '' : 's'} will be updated to "${finalName}", across every restaurant. The now-duplicate supplier entries will be removed. This cannot be undone.`)) return;

  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Combining…';
  let billsUpdated = 0;
  for(const srcName of selected){
    billsUpdated += await propagateSupplierEditToAllBills(srcName, finalName, keptCategory, keptSubcategory);
  }

  selected.forEach(srcName=>{
    suppliers = suppliers.filter(s => s !== srcName);
    delete supplierDefaults[supplierKey(srcName)];
    delete supplierBankDetails[supplierKey(srcName)];
  });
  if(!suppliers.includes(finalName)) suppliers.push(finalName);
  supplierDefaults[supplierKey(finalName)] = { category: keptCategory, subcategory: keptSubcategory };
  supplierBankDetails[supplierKey(finalName)] = { accountNumber: keptAccountNumber, ifscCode: keptIfscCode };

  await saveSuppliers();
  await saveSupplierDefaults();
  await saveSupplierBankDetails();
  // Rebuilt in-session too (not just on next reload) -- usage is keyed by
  // supplierKey() per restaurant, and the merged-away names' usage would
  // otherwise look stale for the rest of this session.
  await loadSupplierUsageIndex();

  supCombineSelected.clear();
  supCombineCatInitialized = false;
  supCombineModeActive = false;
  document.getElementById('supCombineBox').classList.remove('open');
  document.getElementById('supCombineNameInput').value = "";
  document.getElementById('supCombineSubInput').value = "";
  document.getElementById('supCombineOrphans').innerHTML = "";
  confirmBtn.disabled = false;
  confirmBtn.textContent = 'Combine';

  renderSupplierSelect();
  renderSuppliersTabList();
  renderSupCombineBar();
  renderSupSimilarSection(); // the merged names should drop out of the suggestions list

  alert(`Combined ${selected.length} suppliers into "${finalName}". Updated ${billsUpdated} past bill${billsUpdated === 1 ? '' : 's'} across every restaurant.`);
});
