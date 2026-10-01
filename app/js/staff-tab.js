/* ---------- Staff OT & Salary tab (added 2026-10-01) ----------
   Unlike Reports/Vendor Ledger/Suppliers, this tab is visible to BOTH Owner
   and Manager (see auth.js's updateTabVisibilityForProfile) — a Manager can
   add/view staff and log OT/salary for their own restaurant, the same
   boundary that already applies to Add Expenses via the restaurant password
   gate. Only the restaurant SELECTOR here is owner-only: a Manager has
   nothing to pick between and always operates on currentRestaurantId.

   Three sub-concerns share one restaurant scope, chosen independently of
   whatever Add Expenses currently has active (staffRestaurantId, not
   currentRestaurantId, for an Owner — mirrors Reports/Vendor Ledger's own
   independent restaurant selectors):
     - the staff directory itself (flat list per restaurant, data-store.js)
     - daily OT entries (month-bucketed by date, like bills)
     - monthly salary entries (month-bucketed by employee, one per month)
   Bank name + IFSC code are remembered account-wide (staffBankDefaults,
   data-store.js) so adding the next employee is a pick, not a retype. */

let staffRestaurantId;
let staffOtSelectedDate;
let staffSalaryMonth;
let currentStaffList = [];

function getStaffActiveRestaurantId(){
  return isOwnerProfile() ? (staffRestaurantId || RESTAURANTS[0].id) : currentRestaurantId;
}
function maskAccountNumber(acc){
  if(!acc) return '—';
  const s = String(acc);
  return s.length <= 4 ? s : '••••' + s.slice(-4);
}

/* ---------- Restaurant selector (owner only) ---------- */
function renderStaffRestaurantSelect(){
  const sel = document.getElementById('staffRestaurantSelect');
  const prev = sel.value || staffRestaurantId;
  sel.innerHTML = "";
  RESTAURANTS.forEach(r=>{
    const opt = document.createElement('option');
    opt.value = r.id; opt.textContent = r.label;
    sel.appendChild(opt);
  });
  if(prev && RESTAURANTS.some(r=>r.id === prev)) sel.value = prev;
  staffRestaurantId = sel.value;
}
document.getElementById('staffRestaurantSelect').addEventListener('change', (ev)=>{
  staffRestaurantId = ev.target.value;
  renderStaffPanel();
});

/* ---------- Entry point + master render ---------- */
async function showStaffTabPanel(){
  if(isOwnerProfile()) renderStaffRestaurantSelect();
  if(staffOtSelectedDate === undefined) staffOtSelectedDate = todayStr();
  if(staffSalaryMonth === undefined) staffSalaryMonth = todayStr().slice(0,7);
  document.getElementById('staffOtDatePicker').value = staffOtSelectedDate;
  document.getElementById('staffSalaryMonthPicker').value = staffSalaryMonth;
  await renderStaffPanel();
}
async function renderStaffPanel(){
  const restId = getStaffActiveRestaurantId();
  currentStaffList = await loadStaffList(restId);
  renderStaffList();
  renderStaffBankDatalists();
  renderStaffOtEmployeeSelect();
  await renderStaffOtTable();
  await renderStaffSalaryTable();
}

/* ---------- Staff directory list ---------- */
function renderStaffList(filterText){
  const listEl = document.getElementById('staffList');
  const search = (filterText !== undefined ? filterText : document.getElementById('staffSearch').value).trim().toLowerCase();
  listEl.innerHTML = "";
  const sorted = [...currentStaffList].sort((a,b)=>a.name.localeCompare(b.name));
  const filtered = search
    ? sorted.filter(e => e.name.toLowerCase().includes(search) || (e.employeeId||'').toLowerCase().includes(search))
    : sorted;
  document.getElementById('staffCount').textContent = "(" + currentStaffList.length + ")";
  if(filtered.length === 0){
    const empty = document.createElement('div');
    empty.className = 'manage-empty';
    empty.textContent = currentStaffList.length === 0 ? "No staff added yet — add one below." : "No staff match your search.";
    listEl.appendChild(empty);
    return;
  }
  filtered.forEach(emp => listEl.appendChild(buildStaffRow(emp, async ()=>{ await renderStaffPanel(); })));
}
document.getElementById('staffSearch').addEventListener('input', (ev)=> renderStaffList(ev.target.value));

// Reuses the exact view/edit-row shape Suppliers established (manage-supplier-row /
// msr-view / msr-edit etc, all flex-wrap already, so extra fields here just
// wrap onto more lines rather than needing new CSS).
function buildStaffRow(emp, onChange){
  const row = document.createElement('div');
  row.className = 'manage-supplier-row';

  const view = document.createElement('div');
  view.className = 'msr-view';

  const nameEl = document.createElement('span');
  nameEl.className = 'msr-name';
  nameEl.textContent = emp.name;

  const idEl = document.createElement('span');
  idEl.className = emp.employeeId ? 'msr-cat' : 'msr-cat missing';
  idEl.textContent = emp.employeeId ? ('ID ' + emp.employeeId) : 'No employee ID';

  const bankEl = document.createElement('span');
  bankEl.className = emp.bankName ? 'msr-cat' : 'msr-cat missing';
  bankEl.textContent = emp.bankName
    ? `${emp.bankName} • ${maskAccountNumber(emp.accountNumber)} • ${emp.ifscCode || '—'}`
    : 'No bank details set';

  const salaryEl = document.createElement('span');
  salaryEl.className = 'msr-cat';
  salaryEl.textContent = 'Salary ' + fmtMoney(emp.salary || 0);

  const editBtn = document.createElement('button');
  editBtn.type = 'button'; editBtn.className = 'msr-edit-btn'; editBtn.textContent = 'Edit';

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button'; deleteBtn.className = 'msr-delete-btn'; deleteBtn.textContent = 'Remove';

  view.appendChild(nameEl); view.appendChild(idEl); view.appendChild(bankEl); view.appendChild(salaryEl);
  view.appendChild(editBtn); view.appendChild(deleteBtn);
  row.appendChild(view);

  editBtn.addEventListener('click', ()=>{
    const existing = row.querySelector('.msr-edit');
    if(existing){ existing.remove(); return; }
    row.appendChild(buildStaffEditForm(emp, onChange));
  });

  deleteBtn.addEventListener('click', async ()=>{
    if(!confirm(`Remove ${emp.name} from the staff list? Past OT and salary entries already logged for them are not affected.`)) return;
    const restId = getStaffActiveRestaurantId();
    currentStaffList = currentStaffList.filter(e => e.id !== emp.id);
    await saveStaffList(restId, currentStaffList);
    onChange();
  });

  return row;
}
function buildStaffEditForm(emp, onChange){
  const wrap = document.createElement('div');
  wrap.className = 'msr-edit';

  const nameInput = document.createElement('input');
  nameInput.type = 'text'; nameInput.value = emp.name; nameInput.placeholder = 'Employee name';

  const idInput = document.createElement('input');
  idInput.type = 'text'; idInput.value = emp.employeeId || ''; idInput.placeholder = 'Employee ID';

  const bankInput = document.createElement('input');
  bankInput.type = 'text'; bankInput.value = emp.bankName || ''; bankInput.placeholder = 'Bank name';
  const bankListId = 'staffEditBankList_' + Math.random().toString(36).slice(2,8);
  bankInput.setAttribute('list', bankListId);
  const bankDatalist = document.createElement('datalist');
  bankDatalist.id = bankListId;
  [...new Set(staffBankDefaults.map(b=>b.bankName))].forEach(n=>{
    const opt = document.createElement('option'); opt.value = n; bankDatalist.appendChild(opt);
  });

  const ifscInput = document.createElement('input');
  ifscInput.type = 'text'; ifscInput.value = emp.ifscCode || ''; ifscInput.placeholder = 'IFSC code';
  const ifscListId = 'staffEditIfscList_' + Math.random().toString(36).slice(2,8);
  ifscInput.setAttribute('list', ifscListId);
  const ifscDatalist = document.createElement('datalist');
  ifscDatalist.id = ifscListId;
  function refreshIfscOptions(){
    ifscDatalist.innerHTML = "";
    const bankName = bankInput.value.trim().toLowerCase();
    const matches = staffBankDefaults.filter(b => !bankName || b.bankName.toLowerCase() === bankName);
    [...new Set(matches.map(b=>b.ifscCode))].forEach(code=>{
      const opt = document.createElement('option'); opt.value = code; ifscDatalist.appendChild(opt);
    });
  }
  refreshIfscOptions();
  bankInput.addEventListener('input', refreshIfscOptions);

  const accountInput = document.createElement('input');
  accountInput.type = 'text'; accountInput.value = emp.accountNumber || ''; accountInput.placeholder = 'Account number';

  const salaryInput = document.createElement('input');
  salaryInput.type = 'number'; salaryInput.min = '0'; salaryInput.step = '1';
  salaryInput.value = emp.salary || 0; salaryInput.placeholder = 'Default monthly salary';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button'; saveBtn.className = 'msr-save-btn'; saveBtn.textContent = 'Save';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button'; cancelBtn.className = 'msr-cancel-btn'; cancelBtn.textContent = 'Cancel';

  saveBtn.addEventListener('click', async ()=>{
    const newName = nameInput.value.trim();
    if(!newName){ alert("Please enter the employee's name."); return; }
    const restId = getStaffActiveRestaurantId();
    const idx = currentStaffList.findIndex(e => e.id === emp.id);
    if(idx === -1) return;
    const bankName = bankInput.value.trim();
    const ifscCode = ifscInput.value.trim().toUpperCase();
    currentStaffList[idx] = {
      ...currentStaffList[idx],
      name: newName,
      employeeId: idInput.value.trim(),
      bankName, ifscCode,
      accountNumber: accountInput.value.trim(),
      salary: Number(salaryInput.value) || 0
    };
    await saveStaffList(restId, currentStaffList);
    if(rememberBankDefault(bankName, ifscCode)) await saveStaffBankDefaults();
    onChange();
  });
  cancelBtn.addEventListener('click', ()=>{ wrap.remove(); });

  wrap.appendChild(nameInput);
  wrap.appendChild(idInput);
  wrap.appendChild(bankInput);
  wrap.appendChild(bankDatalist);
  wrap.appendChild(ifscInput);
  wrap.appendChild(ifscDatalist);
  wrap.appendChild(accountInput);
  wrap.appendChild(salaryInput);
  wrap.appendChild(saveBtn);
  wrap.appendChild(cancelBtn);
  return wrap;
}

/* ---------- Bank/IFSC memory for the Add-employee form ---------- */
function renderStaffBankDatalists(){
  const nameList = document.getElementById('staffBankNameList');
  nameList.innerHTML = "";
  [...new Set(staffBankDefaults.map(b=>b.bankName))].sort((a,b)=>a.localeCompare(b)).forEach(n=>{
    const opt = document.createElement('option'); opt.value = n; nameList.appendChild(opt);
  });
  refreshStaffNewIfscDatalist();
}
function refreshStaffNewIfscDatalist(){
  const bankName = document.getElementById('staffNewBankName').value.trim().toLowerCase();
  const ifscListEl = document.getElementById('staffIfscList');
  ifscListEl.innerHTML = "";
  const matches = staffBankDefaults.filter(b => !bankName || b.bankName.toLowerCase() === bankName);
  const uniqueIfscs = [...new Set(matches.map(b=>b.ifscCode))];
  uniqueIfscs.forEach(code=>{
    const opt = document.createElement('option'); opt.value = code; ifscListEl.appendChild(opt);
  });
  // Auto-fill only when there's exactly one known IFSC for this bank name and
  // the field is still empty -- never overwrite something the user already typed.
  const ifscInput = document.getElementById('staffNewIfsc');
  if(bankName && uniqueIfscs.length === 1 && !ifscInput.value.trim()){
    ifscInput.value = uniqueIfscs[0];
  }
}
document.getElementById('staffNewBankName').addEventListener('input', refreshStaffNewIfscDatalist);

/* ---------- Add a new employee ---------- */
document.getElementById('staffSaveEmployeeBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('staffNewName').value.trim();
  if(!name){ alert("Please enter the employee's name."); return; }
  const employeeId = document.getElementById('staffNewEmpId').value.trim();
  const bankName = document.getElementById('staffNewBankName').value.trim();
  const ifscCode = document.getElementById('staffNewIfsc').value.trim().toUpperCase();
  const accountNumber = document.getElementById('staffNewAccount').value.trim();
  const salary = Number(document.getElementById('staffNewSalary').value) || 0;

  const restId = getStaffActiveRestaurantId();
  currentStaffList.push({ id: uid(), name, employeeId, bankName, accountNumber, ifscCode, salary });
  await saveStaffList(restId, currentStaffList);
  if(rememberBankDefault(bankName, ifscCode)) await saveStaffBankDefaults();

  renderStaffList();
  renderStaffBankDatalists();
  renderStaffOtEmployeeSelect();
  await renderStaffSalaryTable();

  document.getElementById('staffNewName').value = "";
  document.getElementById('staffNewEmpId').value = "";
  document.getElementById('staffNewBankName').value = "";
  document.getElementById('staffNewIfsc').value = "";
  document.getElementById('staffNewAccount').value = "";
  document.getElementById('staffNewSalary').value = "";
  document.getElementById('staffNewName').focus();
});

/* ---------- Bulk upload ---------- */
document.getElementById('staffBulkUploadLink').addEventListener('click', ()=>{
  document.getElementById('staffBulkUploadBox').classList.toggle('open');
});
document.getElementById('staffDownloadTemplateBtn').addEventListener('click', ()=>{
  const csv = "Name,Employee ID,Bank Name,Account Number,IFSC Code,Monthly Salary\n";
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = "staff-upload-template.csv";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});
document.getElementById('staffUploadBtn').addEventListener('click', async ()=>{
  const fileInput = document.getElementById('staffUploadFile');
  const file = fileInput.files[0];
  const resultEl = document.getElementById('staffUploadResult');
  if(!file){ resultEl.textContent = "Choose a file first."; return; }
  resultEl.textContent = "Uploading…";
  try{
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    const get = (row, ...keys) => {
      for(const k of Object.keys(row)){
        if(keys.some(want => want.toLowerCase() === k.trim().toLowerCase())) return String(row[k]).trim();
      }
      return "";
    };

    const restId = getStaffActiveRestaurantId();
    let added = 0, skipped = 0, bankDefaultsChanged = false;
    rows.forEach(row=>{
      const name = get(row, "Name", "Employee Name");
      if(!name){ skipped++; return; }
      const employeeId = get(row, "Employee ID", "EmployeeId", "ID");
      const bankName = get(row, "Bank Name", "Bank");
      const ifscCode = get(row, "IFSC Code", "IFSC").toUpperCase();
      const accountNumber = get(row, "Account Number", "Account No", "Account");
      const salary = Number(get(row, "Monthly Salary", "Salary")) || 0;
      currentStaffList.push({ id: uid(), name, employeeId, bankName, accountNumber, ifscCode, salary });
      added++;
      if(rememberBankDefault(bankName, ifscCode)) bankDefaultsChanged = true;
    });

    if(added > 0) await saveStaffList(restId, currentStaffList);
    if(bankDefaultsChanged) await saveStaffBankDefaults();

    resultEl.textContent = `Added ${added} employee${added===1?'':'s'}` +
      (skipped > 0 ? `, skipped ${skipped} row${skipped===1?'':'s'} with no name.` : '.');

    renderStaffList();
    renderStaffBankDatalists();
    renderStaffOtEmployeeSelect();
    await renderStaffSalaryTable();
    fileInput.value = "";
  }catch(e){
    console.error("staff bulk upload failed", e);
    resultEl.textContent = "Couldn't read that file — make sure it's a .csv or .xlsx matching the template.";
  }
});

/* ---------- Daily OT ---------- */
function renderStaffOtEmployeeSelect(){
  const sel = document.getElementById('staffOtEmployeeSelect');
  const prev = sel.value;
  sel.innerHTML = currentStaffList.length === 0
    ? '<option value="">No staff added yet</option>'
    : '<option value="">Select employee…</option>';
  [...currentStaffList].sort((a,b)=>a.name.localeCompare(b.name)).forEach(emp=>{
    const opt = document.createElement('option');
    opt.value = emp.id; opt.textContent = emp.name;
    sel.appendChild(opt);
  });
  if(prev && currentStaffList.some(e=>e.id === prev)) sel.value = prev;
}
async function renderStaffOtTable(){
  const restId = getStaffActiveRestaurantId();
  const monthKey = staffOtSelectedDate.slice(0,7);
  const month = await loadOTMonth(restId, monthKey);
  const dayEntries = month[staffOtSelectedDate] || [];
  const wrap = document.getElementById('staffOtTableWrap');
  const empty = document.getElementById('staffOtEmpty');
  wrap.innerHTML = "";
  if(dayEntries.length === 0){
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Employee</th><th class="num">Amount</th><th>Status</th><th></th></tr>';
  const tbody = document.createElement('tbody');
  dayEntries.slice().sort((a,b)=>a.createdAt-b.createdAt).forEach(e=>{
    const tr = document.createElement('tr');
    const tdName = document.createElement('td'); tdName.textContent = e.employeeName; tdName.className = 'supplier';
    const tdAmt = document.createElement('td'); tdAmt.className = 'amount'; tdAmt.textContent = fmtMoney(e.amount);

    const tdStatus = document.createElement('td');
    const statusBtn = document.createElement('button');
    statusBtn.type = 'button'; statusBtn.className = 'badge ' + e.status; statusBtn.textContent = e.status;
    statusBtn.addEventListener('click', async ()=>{
      statusBtn.disabled = true;
      await toggleOTPaid(restId, staffOtSelectedDate, e.id);
      await renderStaffOtTable();
    });
    tdStatus.appendChild(statusBtn);

    const tdDel = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'del-btn'; delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async ()=>{
      if(!confirm(`Delete this OT entry for ${e.employeeName}?`)) return;
      await deleteOTEntry(restId, staffOtSelectedDate, e.id);
      await renderStaffOtTable();
    });
    tdDel.appendChild(delBtn);

    tr.appendChild(tdName); tr.appendChild(tdAmt); tr.appendChild(tdStatus); tr.appendChild(tdDel);
    tbody.appendChild(tr);
  });
  table.appendChild(thead); table.appendChild(tbody);
  wrap.appendChild(table);
}
document.getElementById('staffOtAddBtn').addEventListener('click', async ()=>{
  const sel = document.getElementById('staffOtEmployeeSelect');
  const empId = sel.value;
  if(!empId){ alert("Pick an employee first."); return; }
  const emp = currentStaffList.find(e => e.id === empId);
  const amountInput = document.getElementById('staffOtAmount');
  const amount = Number(amountInput.value);
  if(!amount || amount <= 0){ alert("Enter a valid OT amount."); return; }
  const restId = getStaffActiveRestaurantId();
  await addOTEntry(restId, staffOtSelectedDate, emp.id, emp.name, amount);
  amountInput.value = "";
  await renderStaffOtTable();
});
function setStaffOtDate(dateStr){
  staffOtSelectedDate = dateStr;
  document.getElementById('staffOtDatePicker').value = dateStr;
  renderStaffOtTable();
}
document.getElementById('staffOtDatePicker').addEventListener('change', (ev)=>{
  if(ev.target.value) setStaffOtDate(ev.target.value);
});
document.getElementById('staffOtPrevDay').addEventListener('click', ()=> setStaffOtDate(addDaysStr(staffOtSelectedDate, -1)));
document.getElementById('staffOtNextDay').addEventListener('click', ()=> setStaffOtDate(addDaysStr(staffOtSelectedDate, 1)));

/* ---------- Monthly salary ---------- */
// One row per CURRENT staff member — a saved entry for this month, if any,
// otherwise the employee's own default salary shown as an editable
// suggestion (nothing is written until Save or the paid toggle is used).
async function renderStaffSalaryTable(){
  const restId = getStaffActiveRestaurantId();
  const monthObj = await loadSalaryMonth(restId, staffSalaryMonth);
  const wrap = document.getElementById('staffSalaryTableWrap');
  const empty = document.getElementById('staffSalaryEmpty');
  wrap.innerHTML = "";
  if(currentStaffList.length === 0){
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Employee</th><th class="num">Salary</th><th></th><th>Status</th></tr>';
  const tbody = document.createElement('tbody');
  [...currentStaffList].sort((a,b)=>a.name.localeCompare(b.name)).forEach(emp=>{
    const existing = monthObj[emp.id];
    const amount = existing ? existing.amount : (emp.salary || 0);
    const status = existing ? existing.status : 'unpaid';
    const tr = document.createElement('tr');

    const tdName = document.createElement('td'); tdName.textContent = emp.name; tdName.className = 'supplier';

    const tdAmt = document.createElement('td'); tdAmt.className = 'amount';
    const amtInput = document.createElement('input');
    amtInput.type = 'number'; amtInput.min = '0'; amtInput.step = '1';
    amtInput.value = amount;
    amtInput.className = 'staff-salary-input';
    tdAmt.appendChild(amtInput);

    const tdSave = document.createElement('td');
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button'; saveBtn.className = 'msr-save-btn'; saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', async ()=>{
      const newAmount = Number(amtInput.value);
      if(isNaN(newAmount) || newAmount < 0){ alert("Enter a valid salary amount."); return; }
      await saveSalaryAmount(restId, staffSalaryMonth, emp.id, emp.name, newAmount);
      await renderStaffSalaryTable();
    });
    tdSave.appendChild(saveBtn);

    const tdStatus = document.createElement('td');
    const statusBtn = document.createElement('button');
    statusBtn.type = 'button'; statusBtn.className = 'badge ' + status; statusBtn.textContent = status;
    statusBtn.addEventListener('click', async ()=>{
      statusBtn.disabled = true;
      await toggleSalaryPaid(restId, staffSalaryMonth, emp.id, emp.name, Number(amtInput.value) || amount);
      await renderStaffSalaryTable();
    });
    tdStatus.appendChild(statusBtn);

    tr.appendChild(tdName); tr.appendChild(tdAmt); tr.appendChild(tdSave); tr.appendChild(tdStatus);
    tbody.appendChild(tr);
  });
  table.appendChild(thead); table.appendChild(tbody);
  wrap.appendChild(table);
}
document.getElementById('staffSalaryMonthPicker').addEventListener('change', (ev)=>{
  if(ev.target.value){ staffSalaryMonth = ev.target.value; renderStaffSalaryTable(); }
});
