/* ---------- Staff Expenses tab (added 2026-10-01 as "Staff OT & Salary";
   renamed 2026-10-02 when Captain Incentive and Waiter Tips joined OT;
   same day, split back into three separate lists — one shared date-nav,
   three independent add-forms/tables below it, "Add a new employee" moved
   to the bottom of the tab) ----------
   Unlike Reports/Vendor Ledger/Suppliers, this tab is visible to BOTH Owner
   and Manager (see auth.js's updateTabVisibilityForProfile) — a Manager can
   add/view staff and log entries for their own restaurant, the same
   boundary that already applies to Add Expenses via the restaurant password
   gate. Only the restaurant SELECTOR here is owner-only: a Manager has
   nothing to pick between and always operates on currentRestaurantId.

   Several sub-concerns share one restaurant scope, chosen independently of
   whatever Add Expenses currently has active (staffRestaurantId, not
   currentRestaurantId, for an Owner — mirrors Reports/Vendor Ledger's own
   independent restaurant selectors):
     - the staff directory itself (flat list per restaurant, data-store.js)
     - daily OT/Captain Incentive/Waiter Tips entries — still one
       underlying Firestore collection (month-bucketed by date, like bills,
       `rest:<id>:ot:<YYYY-MM>`), still distinguished by a `type` field
       (STAFF_DAILY_TYPES below), just rendered as three separate
       lists/forms instead of one shared one with a type selector — purely
       a UI change, the data model from 2026-10-02's earlier revision is
       untouched, so existing entries (including legacy ones with no
       `type` at all, defaulting to 'ot') keep working unmigrated
     - a combined CSV report across all three types + staff directory
       details (bank name/branch/account/IFSC), for payment processing
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
  staffReportDefaultDates();
  await renderStaffPanel();
}
async function renderStaffPanel(){
  const restId = getStaffActiveRestaurantId();
  currentStaffList = await loadStaffList(restId);
  renderStaffList();
  renderStaffBankDatalists();
  renderStaffDailyEmployeeSelects();
  renderAllHeadRosters();
  await renderAllStaffDailyTables();
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

  const roleEl = document.createElement('span');
  const roleText = [emp.designation, emp.department].filter(Boolean).join(' · ');
  roleEl.className = roleText ? 'msr-cat' : 'msr-cat missing';
  roleEl.textContent = roleText || 'No designation/department set';

  const mobileEl = document.createElement('span');
  mobileEl.className = emp.mobile ? 'msr-cat' : 'msr-cat missing';
  mobileEl.textContent = emp.mobile ? ('Mobile ' + emp.mobile + (emp.gender ? ' • ' + emp.gender : '')) : (emp.gender || 'No mobile/gender set');

  const bankEl = document.createElement('span');
  bankEl.className = emp.bankName ? 'msr-cat' : 'msr-cat missing';
  bankEl.textContent = emp.bankName
    ? `${emp.bankName}${emp.bankBranch ? ' (' + emp.bankBranch + ')' : ''} • ${maskAccountNumber(emp.accountNumber)} • ${emp.ifscCode || '—'}`
    : 'No bank details set';

  const salaryEl = document.createElement('span');
  salaryEl.className = 'msr-cat';
  salaryEl.textContent = 'Salary ' + fmtMoney(emp.salary || 0);

  const editBtn = document.createElement('button');
  editBtn.type = 'button'; editBtn.className = 'msr-edit-btn'; editBtn.textContent = 'Edit';

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button'; deleteBtn.className = 'msr-delete-btn'; deleteBtn.textContent = 'Remove';

  view.appendChild(nameEl); view.appendChild(idEl); view.appendChild(roleEl); view.appendChild(mobileEl);
  view.appendChild(bankEl); view.appendChild(salaryEl);
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
  idInput.type = 'text'; idInput.value = emp.employeeId || ''; idInput.placeholder = 'Employee ID / Code';

  const designationInput = document.createElement('input');
  designationInput.type = 'text'; designationInput.value = emp.designation || ''; designationInput.placeholder = 'Designation';

  const departmentInput = document.createElement('input');
  departmentInput.type = 'text'; departmentInput.value = emp.department || ''; departmentInput.placeholder = 'Department';

  const genderSelect = document.createElement('select');
  ['', 'Male', 'Female', 'Other'].forEach(g=>{
    const opt = document.createElement('option');
    opt.value = g; opt.textContent = g || 'Gender';
    genderSelect.appendChild(opt);
  });
  genderSelect.value = emp.gender || '';

  const mobileInput = document.createElement('input');
  mobileInput.type = 'tel'; mobileInput.value = emp.mobile || ''; mobileInput.placeholder = 'Mobile number';

  const bankInput = document.createElement('input');
  bankInput.type = 'text'; bankInput.value = emp.bankName || ''; bankInput.placeholder = 'Bank name';
  const bankListId = 'staffEditBankList_' + Math.random().toString(36).slice(2,8);
  bankInput.setAttribute('list', bankListId);
  const bankDatalist = document.createElement('datalist');
  bankDatalist.id = bankListId;
  [...new Set(staffBankDefaults.map(b=>b.bankName))].forEach(n=>{
    const opt = document.createElement('option'); opt.value = n; bankDatalist.appendChild(opt);
  });

  const branchInput = document.createElement('input');
  branchInput.type = 'text'; branchInput.value = emp.bankBranch || ''; branchInput.placeholder = 'Bank branch';
  const branchListId = 'staffEditBranchList_' + Math.random().toString(36).slice(2,8);
  branchInput.setAttribute('list', branchListId);
  const branchDatalist = document.createElement('datalist');
  branchDatalist.id = branchListId;

  const ifscInput = document.createElement('input');
  ifscInput.type = 'text'; ifscInput.value = emp.ifscCode || ''; ifscInput.placeholder = 'IFSC code';
  const ifscListId = 'staffEditIfscList_' + Math.random().toString(36).slice(2,8);
  ifscInput.setAttribute('list', ifscListId);
  const ifscDatalist = document.createElement('datalist');
  ifscDatalist.id = ifscListId;
  function refreshBankOptions(){
    ifscDatalist.innerHTML = "";
    branchDatalist.innerHTML = "";
    const bankName = bankInput.value.trim().toLowerCase();
    const matches = staffBankDefaults.filter(b => !bankName || b.bankName.toLowerCase() === bankName);
    [...new Set(matches.map(b=>b.ifscCode))].forEach(code=>{
      const opt = document.createElement('option'); opt.value = code; ifscDatalist.appendChild(opt);
    });
    [...new Set(matches.map(b=>b.bankBranch).filter(Boolean))].forEach(br=>{
      const opt = document.createElement('option'); opt.value = br; branchDatalist.appendChild(opt);
    });
  }
  refreshBankOptions();
  bankInput.addEventListener('input', refreshBankOptions);

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
    const bankBranch = branchInput.value.trim();
    currentStaffList[idx] = {
      ...currentStaffList[idx],
      name: newName,
      employeeId: idInput.value.trim(),
      designation: designationInput.value.trim(),
      department: departmentInput.value.trim(),
      gender: genderSelect.value,
      mobile: mobileInput.value.trim(),
      bankName, ifscCode, bankBranch,
      accountNumber: accountInput.value.trim(),
      salary: Number(salaryInput.value) || 0
    };
    await saveStaffList(restId, currentStaffList);
    if(rememberBankDefault(bankName, ifscCode, bankBranch)) await saveStaffBankDefaults();
    onChange();
  });
  cancelBtn.addEventListener('click', ()=>{ wrap.remove(); });

  wrap.appendChild(nameInput);
  wrap.appendChild(idInput);
  wrap.appendChild(designationInput);
  wrap.appendChild(departmentInput);
  wrap.appendChild(genderSelect);
  wrap.appendChild(mobileInput);
  wrap.appendChild(bankInput);
  wrap.appendChild(bankDatalist);
  wrap.appendChild(branchInput);
  wrap.appendChild(branchDatalist);
  wrap.appendChild(ifscInput);
  wrap.appendChild(ifscDatalist);
  wrap.appendChild(accountInput);
  wrap.appendChild(salaryInput);
  wrap.appendChild(saveBtn);
  wrap.appendChild(cancelBtn);
  return wrap;
}

/* ---------- Bank/IFSC/Branch memory for the Add-employee form ---------- */
function renderStaffBankDatalists(){
  const nameList = document.getElementById('staffBankNameList');
  nameList.innerHTML = "";
  [...new Set(staffBankDefaults.map(b=>b.bankName))].sort((a,b)=>a.localeCompare(b)).forEach(n=>{
    const opt = document.createElement('option'); opt.value = n; nameList.appendChild(opt);
  });
  refreshStaffNewBankOptions();
}
function refreshStaffNewBankOptions(){
  const bankName = document.getElementById('staffNewBankName').value.trim().toLowerCase();
  const ifscListEl = document.getElementById('staffIfscList');
  const branchListEl = document.getElementById('staffBankBranchList');
  ifscListEl.innerHTML = "";
  branchListEl.innerHTML = "";
  const matches = staffBankDefaults.filter(b => !bankName || b.bankName.toLowerCase() === bankName);
  const uniqueIfscs = [...new Set(matches.map(b=>b.ifscCode))];
  uniqueIfscs.forEach(code=>{
    const opt = document.createElement('option'); opt.value = code; ifscListEl.appendChild(opt);
  });
  const uniqueBranches = [...new Set(matches.map(b=>b.bankBranch).filter(Boolean))];
  uniqueBranches.forEach(br=>{
    const opt = document.createElement('option'); opt.value = br; branchListEl.appendChild(opt);
  });
  // Auto-fill only when there's exactly one known value for this bank name and
  // the field is still empty -- never overwrite something the user already typed.
  const ifscInput = document.getElementById('staffNewIfsc');
  if(bankName && uniqueIfscs.length === 1 && !ifscInput.value.trim()){
    ifscInput.value = uniqueIfscs[0];
  }
  const branchInput = document.getElementById('staffNewBankBranch');
  if(bankName && uniqueBranches.length === 1 && !branchInput.value.trim()){
    branchInput.value = uniqueBranches[0];
  }
}
document.getElementById('staffNewBankName').addEventListener('input', refreshStaffNewBankOptions);

/* ---------- Add a new employee ---------- */
document.getElementById('staffSaveEmployeeBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('staffNewName').value.trim();
  if(!name){ alert("Please enter the employee's name."); return; }
  const employeeId = document.getElementById('staffNewEmpId').value.trim();
  const designation = document.getElementById('staffNewDesignation').value.trim();
  const department = document.getElementById('staffNewDepartment').value.trim();
  const gender = document.getElementById('staffNewGender').value;
  const mobile = document.getElementById('staffNewMobile').value.trim();
  const bankName = document.getElementById('staffNewBankName').value.trim();
  const bankBranch = document.getElementById('staffNewBankBranch').value.trim();
  const ifscCode = document.getElementById('staffNewIfsc').value.trim().toUpperCase();
  const accountNumber = document.getElementById('staffNewAccount').value.trim();
  const salary = Number(document.getElementById('staffNewSalary').value) || 0;

  const restId = getStaffActiveRestaurantId();
  currentStaffList.push({
    id: uid(), name, employeeId, designation, department, gender, mobile,
    bankName, bankBranch, accountNumber, ifscCode, salary, heads: []
  });
  await saveStaffList(restId, currentStaffList);
  if(rememberBankDefault(bankName, ifscCode, bankBranch)) await saveStaffBankDefaults();

  renderStaffList();
  renderStaffBankDatalists();
  renderStaffDailyEmployeeSelects();
  renderAllHeadRosters();
  await renderStaffSalaryTable();

  document.getElementById('staffNewName').value = "";
  document.getElementById('staffNewEmpId').value = "";
  document.getElementById('staffNewDesignation').value = "";
  document.getElementById('staffNewDepartment').value = "";
  document.getElementById('staffNewGender').value = "";
  document.getElementById('staffNewMobile').value = "";
  document.getElementById('staffNewBankName').value = "";
  document.getElementById('staffNewBankBranch').value = "";
  document.getElementById('staffNewIfsc').value = "";
  document.getElementById('staffNewAccount').value = "";
  document.getElementById('staffNewSalary').value = "";
  document.getElementById('staffNewName').focus();
});

/* ---------- Bulk upload ---------- */
document.getElementById('staffBulkUploadLink').addEventListener('click', ()=>{
  document.getElementById('staffBulkUploadBox').classList.toggle('open');
});
// Header row matches the owner's existing payroll-system export format
// verbatim (added 2026-10-01, replacing an earlier app-invented header set)
// so a file already maintained there can be dropped in with zero
// reformatting. "Display Name" and "Mobile country code" are read (the
// latter combined with "Mobile No") but have no field of their own beyond
// that — kept in the template anyway so the two stay interchangeable in
// both directions.
const STAFF_TEMPLATE_HEADERS = [
  "Code*", "Employee Name*", "Display Name", "Mobile country code", "Mobile No*",
  "Gender*", "Department Name*", "Designation Name*", "Salary",
  "Bank Name", "Account Number", "IFSC Code", "Bank Branch"
];
document.getElementById('staffDownloadTemplateBtn').addEventListener('click', ()=>{
  const csv = STAFF_TEMPLATE_HEADERS.join(",") + "\n";
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

    // Matches header text case-insensitively and ignores a trailing "*"
    // (the owner's source system marks required columns that way), so both
    // "Code*" and a plain "Code"/"Employee ID" work as the same field.
    const get = (row, ...keys) => {
      const wanted = keys.map(k => k.toLowerCase());
      for(const k of Object.keys(row)){
        const normalized = k.trim().replace(/\*$/, '').trim().toLowerCase();
        if(wanted.includes(normalized)) return String(row[k]).trim();
      }
      return "";
    };

    const restId = getStaffActiveRestaurantId();
    let added = 0, skipped = 0, bankDefaultsChanged = false;
    rows.forEach(row=>{
      const name = get(row, "Name", "Employee Name");
      if(!name){ skipped++; return; }
      const employeeId = get(row, "Employee ID", "EmployeeId", "ID", "Code");
      const designation = get(row, "Designation", "Designation Name");
      const department = get(row, "Department", "Department Name");
      const gender = get(row, "Gender");
      // SheetJS reads a bare "+91" cell as the number 91, dropping the "+"
      // (spreadsheet numeric parsing, not a bug in this code) -- re-add it
      // when a country code is present but wasn't already prefixed.
      let countryCode = get(row, "Mobile country code", "Country Code");
      if(countryCode && !countryCode.startsWith('+')) countryCode = '+' + countryCode;
      const mobileNo = get(row, "Mobile No", "Mobile", "Phone");
      const mobile = countryCode && mobileNo ? `${countryCode} ${mobileNo}` : (mobileNo || countryCode);
      const bankName = get(row, "Bank Name", "Bank");
      const bankBranch = get(row, "Bank Branch", "Branch");
      const ifscCode = get(row, "IFSC Code", "IFSC").toUpperCase();
      const accountNumber = get(row, "Account Number", "Account No", "Account");
      const salary = Number(get(row, "Monthly Salary", "Salary")) || 0;
      currentStaffList.push({
        id: uid(), name, employeeId, designation, department, gender, mobile,
        bankName, bankBranch, accountNumber, ifscCode, salary, heads: []
      });
      added++;
      if(rememberBankDefault(bankName, ifscCode, bankBranch)) bankDefaultsChanged = true;
    });

    if(added > 0) await saveStaffList(restId, currentStaffList);
    if(bankDefaultsChanged) await saveStaffBankDefaults();

    resultEl.textContent = `Added ${added} employee${added===1?'':'s'}` +
      (skipped > 0 ? `, skipped ${skipped} row${skipped===1?'':'s'} with no name.` : '.') +
      (added > 0 ? ` New employees aren't in the OT/Incentive/Tips lists yet — use "Manage employees in this list" in each one to add them.` : '');

    renderStaffList();
    renderStaffBankDatalists();
    renderStaffDailyEmployeeSelects();
    renderAllHeadRosters();
    await renderStaffSalaryTable();
    fileInput.value = "";
  }catch(e){
    console.error("staff bulk upload failed", e);
    resultEl.textContent = "Couldn't read that file — make sure it's a .csv or .xlsx matching the template.";
  }
});

/* ---------- Daily OT / Captain Incentive / Waiter Tips — three separate
   lists sharing one date (split back out from a single shared-type-selector
   section, 2026-10-02) ---------- */
const STAFF_OT_TYPE_LABELS = { ot: 'OT', captain_incentive: 'Captain Incentive', waiter_tips: 'Waiter Tips' };
function staffOtTypeLabel(type){ return STAFF_OT_TYPE_LABELS[type] || STAFF_OT_TYPE_LABELS.ot; }
// One config per list — same underlying `rest:<id>:ot:<YYYY-MM>` data,
// each list just reads/writes its own `type` and its own set of element ids.
// Employee options come strictly from `currentStaffList` (the active
// restaurant's own staff — see getStaffActiveRestaurantId()/
// renderStaffPanel()), filtered further to whoever is on THIS head's own
// roster (emp.heads, an array of type codes stored right on the employee
// record — added 2026-10-02 so not every restaurant employee clutters
// every list; e.g. only kitchen staff need to show under OT). These lists
// still deliberately do NOT offer a way to CREATE a brand new employee of
// their own (tried briefly, removed 2026-10-02) — staff only get added via
// the one real directory (the Staff section's own add form / bulk upload);
// "Manage employees in this list" here only assigns/unassigns EXISTING
// employees to/from this head, it never creates one.
const STAFF_DAILY_TYPES = [
  { type: 'ot', label: 'OT',
    employeeSelectId: 'staffOtEmployeeSelect', amountId: 'staffOtAmount', addBtnId: 'staffOtAddBtn',
    tableWrapId: 'staffOtTableWrap', emptyId: 'staffOtEmpty',
    rosterChipsId: 'staffOtRosterChips', manageLinkId: 'staffOtManageLink', manageBoxId: 'staffOtManageBox',
    manageListId: 'staffOtManageList', manageSaveBtnId: 'staffOtManageSaveBtn', manageCancelBtnId: 'staffOtManageCancelBtn' },
  { type: 'captain_incentive', label: 'Captain Incentive',
    employeeSelectId: 'staffIncentiveEmployeeSelect', amountId: 'staffIncentiveAmount', addBtnId: 'staffIncentiveAddBtn',
    tableWrapId: 'staffIncentiveTableWrap', emptyId: 'staffIncentiveEmpty',
    rosterChipsId: 'staffIncentiveRosterChips', manageLinkId: 'staffIncentiveManageLink', manageBoxId: 'staffIncentiveManageBox',
    manageListId: 'staffIncentiveManageList', manageSaveBtnId: 'staffIncentiveManageSaveBtn', manageCancelBtnId: 'staffIncentiveManageCancelBtn' },
  { type: 'waiter_tips', label: 'Waiter Tips',
    employeeSelectId: 'staffTipsEmployeeSelect', amountId: 'staffTipsAmount', addBtnId: 'staffTipsAddBtn',
    tableWrapId: 'staffTipsTableWrap', emptyId: 'staffTipsEmpty',
    rosterChipsId: 'staffTipsRosterChips', manageLinkId: 'staffTipsManageLink', manageBoxId: 'staffTipsManageBox',
    manageListId: 'staffTipsManageList', manageSaveBtnId: 'staffTipsManageSaveBtn', manageCancelBtnId: 'staffTipsManageCancelBtn' }
];
function employeeInHead(emp, type){ return (emp.heads || []).includes(type); }
function renderStaffDailyEmployeeSelects(){
  STAFF_DAILY_TYPES.forEach(cfg=>{
    const sel = document.getElementById(cfg.employeeSelectId);
    const prev = sel.value;
    const members = currentStaffList.filter(e => employeeInHead(e, cfg.type));
    sel.innerHTML = members.length === 0
      ? '<option value="">No employees in this list yet — add some above</option>'
      : '<option value="">Select employee…</option>';
    [...members].sort((a,b)=>a.name.localeCompare(b.name)).forEach(emp=>{
      const opt = document.createElement('option');
      opt.value = emp.id; opt.textContent = emp.name;
      sel.appendChild(opt);
    });
    if(prev && members.some(e=>e.id === prev)) sel.value = prev;
  });
}

/* ---------- Per-head employee roster: who's in OT / Captain Incentive /
   Waiter Tips (added 2026-10-02) ---------- */
function renderHeadRoster(cfg){
  const chipsEl = document.getElementById(cfg.rosterChipsId);
  chipsEl.innerHTML = "";
  const members = currentStaffList.filter(e => employeeInHead(e, cfg.type)).sort((a,b)=>a.name.localeCompare(b.name));
  if(members.length === 0){
    const empty = document.createElement('span');
    empty.className = 'head-roster-empty';
    empty.textContent = 'No employees in this list yet.';
    chipsEl.appendChild(empty);
    return;
  }
  members.forEach(emp=>{
    const chip = document.createElement('span');
    chip.className = 'head-roster-chip';
    const name = document.createElement('span');
    name.textContent = emp.name;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button'; removeBtn.textContent = '×';
    removeBtn.title = `Remove ${emp.name} from this list`;
    removeBtn.addEventListener('click', async ()=>{
      emp.heads = (emp.heads || []).filter(h => h !== cfg.type);
      const restId = getStaffActiveRestaurantId();
      await saveStaffList(restId, currentStaffList);
      renderHeadRoster(cfg);
      renderStaffDailyEmployeeSelects();
    });
    chip.appendChild(name); chip.appendChild(removeBtn);
    chipsEl.appendChild(chip);
  });
}
function renderAllHeadRosters(){
  STAFF_DAILY_TYPES.forEach(cfg => renderHeadRoster(cfg));
}
function renderHeadManageChecklist(cfg){
  const listEl = document.getElementById(cfg.manageListId);
  listEl.innerHTML = "";
  if(currentStaffList.length === 0){
    const empty = document.createElement('span');
    empty.className = 'head-roster-empty';
    empty.textContent = 'No staff in the directory yet — add one at the bottom of the tab first.';
    listEl.appendChild(empty);
    return;
  }
  [...currentStaffList].sort((a,b)=>a.name.localeCompare(b.name)).forEach(emp=>{
    const label = document.createElement('label');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = emp.id;
    checkbox.checked = employeeInHead(emp, cfg.type);
    label.appendChild(checkbox);
    label.appendChild(document.createTextNode(emp.name));
    listEl.appendChild(label);
  });
}
STAFF_DAILY_TYPES.forEach(cfg=>{
  document.getElementById(cfg.manageLinkId).addEventListener('click', ()=>{
    const box = document.getElementById(cfg.manageBoxId);
    const opening = !box.classList.contains('open');
    if(opening) renderHeadManageChecklist(cfg);
    box.classList.toggle('open', opening);
  });
  document.getElementById(cfg.manageCancelBtnId).addEventListener('click', ()=>{
    document.getElementById(cfg.manageBoxId).classList.remove('open');
  });
  document.getElementById(cfg.manageSaveBtnId).addEventListener('click', async ()=>{
    const checkedIds = new Set(
      [...document.querySelectorAll('#' + cfg.manageListId + ' input[type="checkbox"]:checked')].map(cb => cb.value)
    );
    currentStaffList.forEach(emp=>{
      const heads = new Set(emp.heads || []);
      if(checkedIds.has(emp.id)) heads.add(cfg.type); else heads.delete(cfg.type);
      emp.heads = Array.from(heads);
    });
    const restId = getStaffActiveRestaurantId();
    await saveStaffList(restId, currentStaffList);
    renderHeadRoster(cfg);
    renderStaffDailyEmployeeSelects();
    document.getElementById(cfg.manageBoxId).classList.remove('open');
  });
});
async function renderStaffDailyTable(cfg){
  const restId = getStaffActiveRestaurantId();
  const monthKey = staffOtSelectedDate.slice(0,7);
  const month = await loadOTMonth(restId, monthKey);
  const dayEntries = (month[staffOtSelectedDate] || []).filter(e => (e.type || 'ot') === cfg.type);
  const wrap = document.getElementById(cfg.tableWrapId);
  const empty = document.getElementById(cfg.emptyId);
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
      await renderStaffDailyTable(cfg);
    });
    tdStatus.appendChild(statusBtn);

    const tdDel = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.type = 'button'; delBtn.className = 'del-btn'; delBtn.textContent = 'Delete';
    delBtn.addEventListener('click', async ()=>{
      if(!confirm(`Delete this ${staffOtTypeLabel(e.type)} entry for ${e.employeeName}?`)) return;
      await deleteOTEntry(restId, staffOtSelectedDate, e.id);
      await renderStaffDailyTable(cfg);
    });
    tdDel.appendChild(delBtn);

    tr.appendChild(tdName); tr.appendChild(tdAmt); tr.appendChild(tdStatus); tr.appendChild(tdDel);
    tbody.appendChild(tr);
  });
  table.appendChild(thead); table.appendChild(tbody);
  wrap.appendChild(table);
}
async function renderAllStaffDailyTables(){
  for(const cfg of STAFF_DAILY_TYPES) await renderStaffDailyTable(cfg);
}
STAFF_DAILY_TYPES.forEach(cfg=>{
  document.getElementById(cfg.addBtnId).addEventListener('click', async ()=>{
    const sel = document.getElementById(cfg.employeeSelectId);
    const empId = sel.value;
    if(!empId){ alert("Pick an employee first."); return; }
    const emp = currentStaffList.find(e => e.id === empId);
    const amountInput = document.getElementById(cfg.amountId);
    const amount = Number(amountInput.value);
    if(!amount || amount <= 0){ alert("Enter a valid amount."); return; }
    const restId = getStaffActiveRestaurantId();
    await addOTEntry(restId, staffOtSelectedDate, emp.id, emp.name, amount, cfg.type);
    amountInput.value = "";
    await renderStaffDailyTable(cfg);
  });
});

function setStaffOtDate(dateStr){
  staffOtSelectedDate = dateStr;
  document.getElementById('staffOtDatePicker').value = dateStr;
  renderAllStaffDailyTables();
}
document.getElementById('staffOtDatePicker').addEventListener('change', (ev)=>{
  if(ev.target.value) setStaffOtDate(ev.target.value);
});
document.getElementById('staffOtPrevDay').addEventListener('click', ()=> setStaffOtDate(addDaysStr(staffOtSelectedDate, -1)));
document.getElementById('staffOtNextDay').addEventListener('click', ()=> setStaffOtDate(addDaysStr(staffOtSelectedDate, 1)));

/* ---------- Combined OT/Incentive/Tips report (added 2026-10-02) ----------
   One CSV row per employee with at least one qualifying entry in the date
   range, combining their bank details (from the staff directory, not the
   entries themselves) with per-type totals -- a payment-ready sheet for
   whenever the owner needs to actually process these payouts. */
function staffReportDefaultDates(){
  const fromEl = document.getElementById('staffReportFrom');
  const toEl = document.getElementById('staffReportTo');
  if(!fromEl.value) fromEl.value = todayStr().slice(0,8) + '01'; // 1st of this month
  if(!toEl.value) toEl.value = todayStr();
}
async function downloadStaffCombinedReport(){
  const restId = getStaffActiveRestaurantId();
  const from = document.getElementById('staffReportFrom').value;
  const to = document.getElementById('staffReportTo').value;
  if(!from || !to || from > to){
    alert("Pick a valid From and To date first.");
    return;
  }
  const unpaidOnly = document.getElementById('staffReportUnpaidOnly').checked;

  const totals = {}; // employeeId -> {name, ot, captain_incentive, waiter_tips}
  for(const mk of monthsBetween(from, to)){
    const month = await loadOTMonth(restId, mk);
    Object.keys(month).forEach(date=>{
      if(date < from || date > to) return;
      (month[date] || []).forEach(e=>{
        if(unpaidOnly && e.status === 'paid') return;
        if(!totals[e.employeeId]) totals[e.employeeId] = { name: e.employeeName, ot: 0, captain_incentive: 0, waiter_tips: 0 };
        const t = e.type || 'ot';
        totals[e.employeeId][t] += Number(e.amount || 0);
      });
    });
  }

  const employeeIds = Object.keys(totals);
  if(employeeIds.length === 0){
    alert(`No ${unpaidOnly ? 'unpaid ' : ''}OT/Incentive/Tips entries found for that date range.`);
    return;
  }

  const rows = [[
    "Employee Name", "Employee ID", "Designation", "Department", "Mobile",
    "Bank Name", "Bank Branch", "Account Number", "IFSC Code",
    "OT", "Captain Incentive", "Waiter Tips", "Total"
  ]];
  employeeIds
    .sort((a,b)=> (totals[a].name||'').localeCompare(totals[b].name||''))
    .forEach(empId=>{
      const emp = currentStaffList.find(e => e.id === empId);
      const t = totals[empId];
      const total = t.ot + t.captain_incentive + t.waiter_tips;
      rows.push([
        emp ? emp.name : t.name,
        emp ? (emp.employeeId || "") : "",
        emp ? (emp.designation || "") : "",
        emp ? (emp.department || "") : "",
        emp ? (emp.mobile || "") : "",
        emp ? (emp.bankName || "") : "",
        emp ? (emp.bankBranch || "") : "",
        emp ? (emp.accountNumber || "") : "",
        emp ? (emp.ifscCode || "") : "",
        t.ot.toFixed(2),
        t.captain_incentive.toFixed(2),
        t.waiter_tips.toFixed(2),
        total.toFixed(2)
      ]);
    });

  const csv = rows.map(r => r.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${restId}-staff-ot-incentive-tips_${from}_to_${to}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
document.getElementById('staffReportDownloadBtn').addEventListener('click', downloadStaffCombinedReport);

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
