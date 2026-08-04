/* ---------- Reports tab: password gate + tab switching ---------- */
async function sha256Hex(str){
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}
const REPORTS_PASSWORD_HASH = "3b612c75a7b5048a435fb6ec81e52ff92d6d795a8b5a9c17070f6a63c97a53b2";
const REPORTS_UNLOCK_KEY = "reportsUnlockedSession";

function reportsUnlocked(){
  try{ return sessionStorage.getItem(REPORTS_UNLOCK_KEY) === '1'; }catch(e){ return false; }
}
function showReportsPanel(){
  const unlocked = reportsUnlocked();
  document.getElementById('reportsLock').style.display = unlocked ? 'none' : 'block';
  document.getElementById('reportsContent').style.display = unlocked ? 'block' : 'none';
  if(unlocked) renderDashboard();
}
document.getElementById('reportsUnlockBtn').addEventListener('click', async ()=>{
  const input = document.getElementById('reportsPasswordInput');
  const errEl = document.getElementById('reportsLockError');
  errEl.classList.remove('show');
  const hash = await sha256Hex(input.value);
  if(hash === REPORTS_PASSWORD_HASH){
    try{ sessionStorage.setItem(REPORTS_UNLOCK_KEY, '1'); }catch(e){}
    input.value = '';
    showReportsPanel();
  } else {
    errEl.classList.add('show');
  }
});
document.getElementById('reportsPasswordInput').addEventListener('keydown', (ev)=>{
  if(ev.key === 'Enter') document.getElementById('reportsUnlockBtn').click();
});

function switchTab(tab){
  const expensesBtn = document.getElementById('tabBtnExpenses');
  const reportsBtn = document.getElementById('tabBtnReports');
  const expensesPanel = document.getElementById('tabPanelExpenses');
  const reportsPanel = document.getElementById('tabPanelReports');
  if(tab === 'reports'){
    expensesBtn.classList.remove('active');
    reportsBtn.classList.add('active');
    expensesPanel.classList.remove('active');
    reportsPanel.classList.add('active');
    showReportsPanel();
  } else {
    reportsBtn.classList.remove('active');
    expensesBtn.classList.add('active');
    reportsPanel.classList.remove('active');
    expensesPanel.classList.add('active');
  }
}
document.getElementById('tabBtnExpenses').addEventListener('click', ()=>switchTab('expenses'));
document.getElementById('tabBtnReports').addEventListener('click', ()=>switchTab('reports'));

/* ---------- Reports dashboard: sales vs. expenses, by restaurant ----------
   Cross-restaurant, independent of the currently confirmed restaurant — reads
   directly by computed key rather than through currentRestaurantId/restPrefix().
   A restaurant with no sales record for the selected day/month is excluded
   entirely — from the charts AND from the total sales/expenses figures. */
const CATEGORY_COLOR_SLOTS = ["#2a78d6","#eb6834","#1baf7a","#eda100","#e87ba4","#008300","#4a3aa7","#e34948"];
const PROFIT_COLOR = '#565f4c'; // var(--ink-soft) — neutral, reserved, not a categorical slot
let dashTooltipEl = null;
let dashChartType = 'bar';   // 'bar' | 'pie'
let dashPeriodType = 'day';  // 'day' | 'month'
let dashSelectedDate, dashSelectedMonth; // set from init(), after todayStr()/addDaysStr() exist

function restaurantBillsKeyFor(restaurantId, monthKey){
  return "rest:" + restaurantId + ":bills:" + monthKey;
}
function restaurantSalesKeyFor(restaurantId, monthKey){
  return "rest:" + restaurantId + ":sales:" + monthKey;
}
async function fetchAllRestaurantsBillsForMonth(monthKey){
  const out = {};
  for(const r of RESTAURANTS){
    const raw = await safeGet(restaurantBillsKeyFor(r.id, monthKey));
    let data = {};
    if(raw){ try{ data = JSON.parse(raw) || {}; }catch(e){} }
    out[r.id] = data;
  }
  return out;
}
async function fetchAllRestaurantsSalesForMonth(monthKey){
  const out = {};
  for(const r of RESTAURANTS){
    const raw = await safeGet(restaurantSalesKeyFor(r.id, monthKey));
    let data = {};
    if(raw){ try{ data = JSON.parse(raw) || {}; }catch(e){} }
    out[r.id] = data;
  }
  return out;
}
function addDaysStr(dateStr, delta){
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + delta);
  return toDateStr(d);
}

async function computeSalesExpenseData(periodType, dateOrMonth){
  const monthKey = periodType === 'day' ? dateOrMonth.slice(0,7) : dateOrMonth;
  const dateFilter = periodType === 'day' ? (d)=> d === dateOrMonth : ()=> true;
  const [salesAll, billsAll] = await Promise.all([
    fetchAllRestaurantsSalesForMonth(monthKey),
    fetchAllRestaurantsBillsForMonth(monthKey)
  ]);

  const restaurants = [];
  RESTAURANTS.forEach(r=>{
    const salesData = salesAll[r.id] || {};
    const salesDays = Object.keys(salesData).filter(dateFilter);
    if(salesDays.length === 0) return; // no sales entered for this period — fully excluded

    const sales = salesDays.reduce((s,d)=> s + (Number(salesData[d]) || 0), 0);

    const billsData = billsAll[r.id] || {};
    let expenses = 0;
    const byCategory = {};
    Object.keys(billsData).forEach(d=>{
      if(!dateFilter(d)) return;
      (billsData[d] || []).forEach(e=>{
        const amt = Number(e.amount || 0);
        expenses += amt;
        const cat = e.category || "Uncategorized";
        byCategory[cat] = (byCategory[cat] || 0) + amt;
      });
    });

    restaurants.push({ id: r.id, label: r.label, sales, expenses, profit: sales - expenses, byCategory });
  });

  const totalSales = restaurants.reduce((s,r)=>s+r.sales, 0);
  const totalExpenses = restaurants.reduce((s,r)=>s+r.expenses, 0);
  return { restaurants, totalSales, totalExpenses, totalProfit: totalSales - totalExpenses };
}

// Stable per-category color: assigned by alphabetical position among the app's
// known categories (not by current-period rank), so a category's color never
// changes when you switch periods. Anything past the 7 named slots — or a
// stray category not in the known list — folds into one "Other" bucket on
// the reserved 8th slot. The profit remainder always wears the fixed neutral
// PROFIT_COLOR — it isn't a competing series, so it never takes a slot.
function getCategoryColorMap(){
  const names = Object.keys(categories).sort((a,b)=>a.localeCompare(b));
  const map = {};
  const maxNamed = CATEGORY_COLOR_SLOTS.length - 1;
  names.forEach((name, i)=>{
    if(i < maxNamed) map[name] = CATEGORY_COLOR_SLOTS[i];
  });
  return map;
}

// Builds the ordered [expense-category segments..., profit] for one restaurant.
// Normal case: segments sum to 100% of SALES (expenses + profit = sales).
// Loss case (expenses > sales): no profit slice; segments sum to 100% of
// EXPENSES instead (so the mark's composition still reads correctly), and the
// shortfall is surfaced as a separate loss figure rather than forcing the
// mark past its own 100% frame.
function buildSegments(restaurant){
  const colorMap = getCategoryColorMap();
  const names = Object.keys(categories).sort((a,b)=>a.localeCompare(b));
  const maxNamed = CATEGORY_COLOR_SLOTS.length - 1;

  const buckets = {};
  Object.keys(restaurant.byCategory).forEach(cat=>{
    const idx = names.indexOf(cat);
    const known = idx !== -1 && idx < maxNamed;
    const key = known ? cat : "Other";
    buckets[key] = (buckets[key] || 0) + restaurant.byCategory[cat];
  });

  const catEntries = Object.keys(buckets).map(name=>({
    name, amount: buckets[name],
    color: colorMap[name] || CATEGORY_COLOR_SLOTS[CATEGORY_COLOR_SLOTS.length-1]
  })).sort((a,b)=>b.amount-a.amount);

  const isLoss = restaurant.expenses > restaurant.sales;
  const denom = isLoss ? restaurant.expenses : restaurant.sales;

  const segments = catEntries.map(e=>({
    name: e.name, color: e.color, amount: e.amount,
    pct: denom > 0 ? (e.amount / denom * 100) : 0
  }));
  if(!isLoss){
    const profitAmt = restaurant.sales - restaurant.expenses;
    if(profitAmt > 0){
      segments.push({
        name: 'Profit', color: PROFIT_COLOR, amount: profitAmt,
        pct: denom > 0 ? (profitAmt / denom * 100) : 0, isProfit: true
      });
    }
  }
  return { segments, isLoss, lossAmount: isLoss ? restaurant.expenses - restaurant.sales : 0 };
}

function makeTooltipContent(label, value){
  const frag = document.createDocumentFragment();
  const valueEl = document.createElement('span');
  valueEl.className = 'dash-tooltip-value';
  valueEl.textContent = fmtMoney(value);
  const labelEl = document.createElement('span');
  labelEl.textContent = ' — ' + label;
  frag.appendChild(valueEl);
  frag.appendChild(labelEl);
  return frag;
}
function showDashTooltip(x, y, content){
  if(!dashTooltipEl){
    dashTooltipEl = document.createElement('div');
    dashTooltipEl.className = 'dash-tooltip';
    document.body.appendChild(dashTooltipEl);
  }
  dashTooltipEl.innerHTML = "";
  dashTooltipEl.appendChild(content);
  dashTooltipEl.style.left = x + 'px';
  dashTooltipEl.style.top = y + 'px';
  dashTooltipEl.classList.add('show');
}
function hideDashTooltip(){
  if(dashTooltipEl) dashTooltipEl.classList.remove('show');
}
function wireTooltip(el, getContent){
  const show = ()=>{
    const rect = el.getBoundingClientRect();
    showDashTooltip(rect.left + rect.width / 2, rect.top, getContent());
  };
  el.addEventListener('pointermove', show);
  el.addEventListener('focus', show);
  el.addEventListener('pointerleave', hideDashTooltip);
  el.addEventListener('blur', hideDashTooltip);
}

function renderBarView(restaurants){
  const chart = document.getElementById('dashBarChart');
  chart.innerHTML = "";
  const maxSales = Math.max(1, ...restaurants.map(r=>r.sales));
  const sorted = restaurants.slice().sort((a,b)=>b.sales-a.sales);

  sorted.forEach(r=>{
    const { segments, isLoss, lossAmount } = buildSegments(r);
    const col = document.createElement('div');
    col.className = 'dash-bar-col';

    const cap = document.createElement('div');
    cap.className = 'dash-bar-cap' + (isLoss ? ' loss' : '');
    cap.textContent = isLoss ? ('Loss ' + fmtMoney(lossAmount)) : fmtMoney(r.sales);
    col.appendChild(cap);

    const track = document.createElement('div');
    track.className = 'dash-bar-track-v';

    const stack = document.createElement('div');
    stack.className = 'dash-bar-stack';
    stack.style.height = Math.max((r.sales / maxSales) * 100, 0) + '%';

    segments.forEach(seg=>{
      const segEl = document.createElement('div');
      segEl.className = 'dash-bar-seg-v' + (seg.isProfit ? ' dash-profit' : '');
      segEl.style.height = seg.pct + '%';
      segEl.style.background = seg.color;
      segEl.tabIndex = 0;
      segEl.setAttribute('role', 'img');
      segEl.setAttribute('aria-label', r.label + ' — ' + seg.name + ': ' + fmtMoney(seg.amount));
      wireTooltip(segEl, ()=>makeTooltipContent(r.label + ' — ' + seg.name, seg.amount));
      stack.appendChild(segEl);
    });

    track.appendChild(stack);
    col.appendChild(track);

    const name = document.createElement('div');
    name.className = 'dash-bar-colname';
    name.textContent = r.label;
    col.appendChild(name);

    chart.appendChild(col);
  });
}

function buildConicGradient(segments){
  if(segments.length === 0) return 'var(--paper-line)';
  let acc = 0;
  const stops = [];
  segments.forEach(seg=>{
    const start = acc;
    acc += seg.pct;
    stops.push(seg.color + ' ' + start + '% ' + acc + '%');
  });
  return 'conic-gradient(' + stops.join(', ') + ')';
}

function renderPieView(restaurants){
  const grid = document.getElementById('dashPieGrid');
  grid.innerHTML = "";
  const maxSales = Math.max(1, ...restaurants.map(r=>r.sales));
  const sorted = restaurants.slice().sort((a,b)=>b.sales-a.sales);
  const MAX_D = 130, MIN_D = 56;

  sorted.forEach(r=>{
    const { segments, isLoss, lossAmount } = buildSegments(r);
    const cell = document.createElement('div');
    cell.className = 'dash-pie-cell';

    // Radius scales by sqrt(sales) so *area* — what the eye actually reads as
    // "size" — is proportional to sales, not radius scaling linearly with it.
    const sizeRatio = Math.sqrt(r.sales / maxSales);
    const diameter = Math.max(MIN_D, sizeRatio * MAX_D);

    const pie = document.createElement('div');
    pie.className = 'dash-pie';
    pie.style.width = diameter + 'px';
    pie.style.height = diameter + 'px';
    pie.style.background = buildConicGradient(segments);
    pie.tabIndex = 0;
    pie.setAttribute('role', 'img');
    pie.setAttribute('aria-label', r.label + ' — sales ' + fmtMoney(r.sales) + '. ' +
      segments.map(s=> s.name + ': ' + fmtMoney(s.amount)).join(', '));

    wireTooltip(pie, ()=>{
      const frag = document.createDocumentFragment();
      const header = document.createElement('div');
      header.style.fontWeight = '700';
      header.style.marginBottom = '4px';
      header.textContent = r.label + ' — Sales ' + fmtMoney(r.sales);
      frag.appendChild(header);
      segments.forEach(s=>{
        const row = document.createElement('div');
        const valueSpan = document.createElement('span');
        valueSpan.className = 'dash-tooltip-value';
        valueSpan.textContent = fmtMoney(s.amount);
        row.appendChild(valueSpan);
        row.appendChild(document.createTextNode(' — ' + s.name));
        frag.appendChild(row);
      });
      return frag;
    });

    cell.appendChild(pie);

    const name = document.createElement('div');
    name.className = 'dash-pie-name';
    name.textContent = r.label;
    cell.appendChild(name);

    const salesLine = document.createElement('div');
    salesLine.className = 'dash-pie-sales' + (isLoss ? ' dash-pie-loss' : '');
    salesLine.textContent = isLoss ? ('Loss ' + fmtMoney(lossAmount)) : ('Sales ' + fmtMoney(r.sales));
    cell.appendChild(salesLine);

    grid.appendChild(cell);
  });
}

function renderDashLegend(restaurants){
  const legend = document.getElementById('dashCatLegend');
  legend.innerHTML = "";
  const seen = new Map();
  restaurants.forEach(r=>{
    buildSegments(r).segments.forEach(s=>{ if(!seen.has(s.name)) seen.set(s.name, s.color); });
  });
  seen.forEach((color, name)=>{
    const item = document.createElement('div');
    item.className = 'dash-legend-item';
    const swatch = document.createElement('span');
    swatch.className = 'dash-legend-swatch';
    swatch.style.background = color;
    const text = document.createElement('span');
    text.textContent = name;
    item.appendChild(swatch);
    item.appendChild(text);
    legend.appendChild(item);
  });
}

function renderDashTable(restaurants){
  const wrap = document.getElementById('dashTableWrap');
  wrap.innerHTML = "";
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.innerHTML = '<th>Restaurant</th><th class="num">Sales</th><th class="num">Expenses</th><th class="num">Profit</th>';
  thead.appendChild(headRow);
  const tbody = document.createElement('tbody');
  restaurants.slice().sort((a,b)=>b.sales-a.sales).forEach(r=>{
    const tr = document.createElement('tr');
    const tdName = document.createElement('td'); tdName.textContent = r.label;
    const tdSales = document.createElement('td'); tdSales.className='num'; tdSales.textContent = fmtMoney(r.sales);
    const tdExp = document.createElement('td'); tdExp.className='num'; tdExp.textContent = fmtMoney(r.expenses);
    const tdProfit = document.createElement('td'); tdProfit.className='num'; tdProfit.textContent = fmtMoney(r.profit);
    tr.appendChild(tdName); tr.appendChild(tdSales); tr.appendChild(tdExp); tr.appendChild(tdProfit);
    tbody.appendChild(tr);
  });
  table.appendChild(thead); table.appendChild(tbody);
  wrap.appendChild(table);
}

async function renderDashboard(){
  if(dashSelectedDate === undefined) dashSelectedDate = addDaysStr(todayStr(), -1);
  if(dashSelectedMonth === undefined) dashSelectedMonth = todayStr().slice(0,7);
  document.getElementById('dashDatePicker').value = dashSelectedDate;
  document.getElementById('dashMonthPicker').value = dashSelectedMonth;

  const panel = document.getElementById('reportsDashboard');
  panel.classList.add('dash-loading');
  try{
    const dateOrMonth = dashPeriodType === 'day' ? dashSelectedDate : dashSelectedMonth;
    const data = await computeSalesExpenseData(dashPeriodType, dateOrMonth);

    document.getElementById('dashTotalSales').textContent = fmtMoney(data.totalSales);
    document.getElementById('dashTotalExpenses').textContent = fmtMoney(data.totalExpenses);
    const profitEl = document.getElementById('dashTotalProfit');
    profitEl.textContent = fmtMoney(data.totalProfit);
    profitEl.classList.toggle('negative', data.totalProfit < 0);
    profitEl.classList.toggle('positive', data.totalProfit > 0);

    const hasData = data.restaurants.length > 0;
    document.getElementById('dashEmpty').style.display = hasData ? 'none' : 'block';
    document.getElementById('dashChartCard').style.display = hasData ? 'block' : 'none';

    if(dashChartType === 'bar') renderBarView(data.restaurants);
    else renderPieView(data.restaurants);
    renderDashLegend(data.restaurants);
    renderDashTable(data.restaurants);
  }catch(e){
    console.error('dashboard render failed', e);
  }
  panel.classList.remove('dash-loading');
}

document.getElementById('dashChartBar').addEventListener('click', ()=>{
  dashChartType = 'bar';
  document.getElementById('dashChartBar').classList.add('active');
  document.getElementById('dashChartPie').classList.remove('active');
  document.getElementById('dashBarChart').style.display = 'flex';
  document.getElementById('dashPieGrid').style.display = 'none';
  renderDashboard();
});
document.getElementById('dashChartPie').addEventListener('click', ()=>{
  dashChartType = 'pie';
  document.getElementById('dashChartPie').classList.add('active');
  document.getElementById('dashChartBar').classList.remove('active');
  document.getElementById('dashBarChart').style.display = 'none';
  document.getElementById('dashPieGrid').style.display = 'grid';
  renderDashboard();
});
document.getElementById('dashPeriodDay').addEventListener('click', ()=>{
  dashPeriodType = 'day';
  document.getElementById('dashPeriodDay').classList.add('active');
  document.getElementById('dashPeriodMonth').classList.remove('active');
  document.getElementById('dashDatePicker').style.display = '';
  document.getElementById('dashMonthPicker').style.display = 'none';
  renderDashboard();
});
document.getElementById('dashPeriodMonth').addEventListener('click', ()=>{
  dashPeriodType = 'month';
  document.getElementById('dashPeriodMonth').classList.add('active');
  document.getElementById('dashPeriodDay').classList.remove('active');
  document.getElementById('dashDatePicker').style.display = 'none';
  document.getElementById('dashMonthPicker').style.display = '';
  renderDashboard();
});
document.getElementById('dashDatePicker').addEventListener('change', (ev)=>{
  if(ev.target.value){ dashSelectedDate = ev.target.value; renderDashboard(); }
});
document.getElementById('dashMonthPicker').addEventListener('change', (ev)=>{
  if(ev.target.value){ dashSelectedMonth = ev.target.value; renderDashboard(); }
});
document.getElementById('dashTableToggle').addEventListener('click', (ev)=>{
  const wrap = document.getElementById('dashTableWrap');
  const showingTable = wrap.style.display !== 'none';
  wrap.style.display = showingTable ? 'none' : 'block';
  if(dashChartType === 'bar'){
    document.getElementById('dashBarChart').style.display = showingTable ? 'flex' : 'none';
  } else {
    document.getElementById('dashPieGrid').style.display = showingTable ? 'grid' : 'none';
  }
  document.getElementById('dashCatLegend').style.display = showingTable ? 'flex' : 'none';
  ev.target.textContent = showingTable ? 'View as table' : 'View as chart';
});

document.getElementById('supplierSelect').addEventListener('change', ()=>{
  renderSupplierCatHint();
  updateQaRestFieldsVisibility();
  if(document.getElementById('supplierSelect').value){
    document.getElementById('invoiceInput').focus();
  }
});

document.getElementById('manageSuppliersBtn').addEventListener('click', ()=>{
  document.getElementById('newSupplierName').value = "";
  renderNewSupplierCatSelect();
  document.getElementById('newSupplierSub').value = "";
  openManageSuppliersModal();
});
document.getElementById('manageSuppliersClose').addEventListener('click', closeManageSuppliersModal);
document.getElementById('manageSuppliersModal').addEventListener('click', (ev)=>{
  if(ev.target.id === 'manageSuppliersModal') closeManageSuppliersModal();
});
document.getElementById('manageSupplierSearch').addEventListener('input', (ev)=>{
  renderManageSupplierList(ev.target.value);
});

document.getElementById('btnUnpaid').addEventListener('click', ()=>setStatus('unpaid'));
document.getElementById('btnPaid').addEventListener('click', ()=>setStatus('paid'));
function setStatus(s){
  document.getElementById('btnUnpaid').classList.toggle('active', s==='unpaid');
  document.getElementById('btnPaid').classList.toggle('active', s==='paid');
}

document.getElementById('addCatLink').addEventListener('click', ()=>{
  document.getElementById('addCatBox').classList.toggle('open');
  document.getElementById('newCatInput').focus();
});
document.getElementById('newCatSave').addEventListener('click', async ()=>{
  const input = document.getElementById('newCatInput');
  const name = input.value.trim();
  if(!name) return;
  if(!categories[name]) categories[name] = [];
  await saveCategories();
  renderNewSupplierCatSelect();
  document.getElementById('newSupplierCat').value = name;
  renderNewSupplierSubList();
  input.value = "";
  document.getElementById('addCatBox').classList.remove('open');
});

document.getElementById('addSubLink').addEventListener('click', ()=>{
  document.getElementById('addSubBox').classList.toggle('open');
  document.getElementById('newSubInput').focus();
});
document.getElementById('newSubSave').addEventListener('click', async ()=>{
  const cat = document.getElementById('newSupplierCat').value;
  const input = document.getElementById('newSubInput');
  const name = input.value.trim();
  if(!name || !cat) return;
  if(!categories[cat].includes(name)) categories[cat].push(name);
  await saveCategories();
  renderNewSupplierSubList();
  document.getElementById('newSupplierSub').value = name;
  input.value = "";
  document.getElementById('addSubBox').classList.remove('open');
});

document.getElementById('saveSupplierBtn').addEventListener('click', async ()=>{
  const name = document.getElementById('newSupplierName').value.trim();
  const cat = document.getElementById('newSupplierCat').value;
  const sub = document.getElementById('newSupplierSub').value.trim();
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

  renderSupplierSelect();
  document.getElementById('supplierSelect').value = name;
  renderSupplierCatHint();
  renderManageSupplierList();
  document.getElementById('newSupplierName').value = "";
  document.getElementById('newSupplierSub').value = "";
  closeManageSuppliersModal();
  document.getElementById('invoiceInput').focus();
});

document.getElementById('quickAddForm').addEventListener('submit', async (ev)=>{
  ev.preventDefault();
  const supplier = document.getElementById('supplierSelect').value;
  const invoice = document.getElementById('invoiceInput').value.trim();
  const amount = parseFloat(document.getElementById('amountInput').value);
  const status = document.getElementById('btnPaid').classList.contains('active') ? 'paid' : 'unpaid';

  if(!supplier || !amount || amount <= 0){
    return;
  }
  const def = supplierDefaults[supplierKey(supplier)];
  if(!def || !categories[def.category]){
    openNewSupplierBox(supplier);
    alert("This supplier doesn't have a category set yet — fill it in below and save, then add the bill.");
    return;
  }
  const cat = def.category;
  const sub = def.subcategory || "";

  const entry = {
    id: uid(),
    category: cat,
    subcategory: sub,
    supplier: supplier,
    invoice: invoice,
    amount: amount,
    status: status,
    createdAt: Date.now()
  };
  entries.push(entry);
  await saveEntries();

  renderTable();
  renderTotals();
  renderBreakdown();

  // Reset for fast repeat entry — keep supplier & status selected, clear invoice/amount
  document.getElementById('invoiceInput').value = "";
  document.getElementById('amountInput').value = "";
  document.getElementById('invoiceInput').focus();
});

document.getElementById('tableBody').addEventListener('click', async (ev)=>{
  const btn = ev.target.closest('button');
  if(!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  if(action === 'toggle'){
    const e = entries.find(x=>x.id === id);
    if(e){
      e.status = e.status === 'paid' ? 'unpaid' : 'paid';
      await saveEntries();
      renderTable();
      renderTotals();
    }
  } else if(action === 'delete'){
    if(btn.classList.contains('confirming')){
      entries = entries.filter(x=>x.id !== id);
      await saveEntries();
      renderTable();
      renderTotals();
      renderBreakdown();
    } else {
      btn.classList.add('confirming');
      btn.textContent = 'Confirm?';
      setTimeout(()=>{
        btn.classList.remove('confirming');
        btn.textContent = 'Delete';
      }, 2500);
    }
  }
});

document.getElementById('datePick').addEventListener('change', async (ev)=>{
  currentDate = ev.target.value || todayStr();
  await loadEntries(currentDate);
  await loadSales(currentDate);
  renderTable();
  renderTotals();
  renderBreakdown();
});
document.getElementById('prevDay').addEventListener('click', async ()=>{
  const d = new Date(currentDate + "T00:00:00");
  d.setDate(d.getDate()-1);
  currentDate = toDateStr(d);
  await loadEntries(currentDate);
  await loadSales(currentDate);
  renderAll();
});
document.getElementById('nextDay').addEventListener('click', async ()=>{
  const d = new Date(currentDate + "T00:00:00");
  d.setDate(d.getDate()+1);
  currentDate = toDateStr(d);
  await loadEntries(currentDate);
  await loadSales(currentDate);
  renderAll();
});

document.getElementById('historyToggle').addEventListener('click', async ()=>{
  const panel = document.getElementById('historyPanel');
  panel.classList.toggle('open');
  if(!panel.classList.contains('open')) return;
  try{
    const monthKeys = await listBillMonthKeys();
    const dateSet = new Set();
    for(const mk of monthKeys){
      const monthData = await fetchMonthObject(mk);
      Object.keys(monthData).forEach(d=>{
        if((monthData[d] || []).length > 0) dateSet.add(d);
      });
    }
    const dates = Array.from(dateSet).sort().reverse();
    if(dates.length === 0){
      panel.innerHTML = '<span class="history-empty">No past days logged yet.</span>';
      return;
    }
    panel.innerHTML = "";
    dates.forEach(d=>{
      const chip = document.createElement('span');
      chip.className = 'history-chip';
      chip.textContent = fmtDateLabel(d);
      chip.addEventListener('click', async ()=>{
        currentDate = d;
        await loadEntries(currentDate);
        await loadSales(currentDate);
        renderAll();
        panel.classList.remove('open');
      });
      panel.appendChild(chip);
    });
  }catch(e){
    panel.innerHTML = '<span class="history-empty">Could not load history.</span>';
  }
});

