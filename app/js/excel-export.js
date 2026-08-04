/* ---------- Spreadsheet export / live sync ---------- */

function csvEscape(v){
  const s = v == null ? "" : String(v);
  if(/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
  return s;
}
async function buildCsv(){
  const rows = [["Date","Category","Subcategory","Supplier","Invoice #","Amount","Status"]];
  const monthKeys = (await listBillMonthKeys()).sort();
  for(const k of monthKeys){
    let monthData = {};
    try{ monthData = JSON.parse(await safeGet(k)) || {}; }catch(e){}
    Object.keys(monthData).sort().forEach(date=>{
      (monthData[date] || []).slice().sort((a,b)=>a.createdAt-b.createdAt).forEach(e=>{
        rows.push([date, e.category, e.subcategory||"", e.supplier, e.invoice||"", Number(e.amount||0).toFixed(2), e.status]);
      });
    });
  }
  return rows.map(r=>r.map(csvEscape).join(",")).join("\n");
}
async function downloadCsv(){
  const csv = await buildCsv();
  const blob = new Blob([csv], {type:"text/csv;charset=utf-8;"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = currentRestaurantId + "-vendor-bills.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------- Excel workbook: FY register, supplier x date grid, one sheet per month ---------- */
function fyStartYearForDate(dateStr){
  const y = Number(dateStr.slice(0,4));
  const m = Number(dateStr.slice(5,7));
  return (m >= 4) ? y : y - 1; // Apr-Dec belongs to the FY starting that year; Jan-Mar belongs to the FY that started the previous year
}
function fyLabel(fyStartYear){
  return `FY ${fyStartYear}-${String((fyStartYear+1) % 100).padStart(2,'0')}`;
}
function monthsForFY(fyStartYear){
  const months = [];
  for(let m=4; m<=12; m++) months.push({year: fyStartYear, month: m});
  for(let m=1; m<=3; m++) months.push({year: fyStartYear+1, month: m});
  return months;
}
function daysInMonth(year, month){
  return new Date(year, month, 0).getDate(); // month is 1-indexed here
}
function monthSheetLabel(year, month){
  const d = new Date(year, month-1, 1);
  const label = d.toLocaleDateString('en-IN', {month:'short', year:'numeric'});
  return label.replace(/[\\\/\?\*\[\]:]/g,'-').slice(0,31);
}
function sheetSafeName(name){
  return name.replace(/[\\\/\?\*\[\]:]/g,'-').slice(0,31);
}

function buildCalendarSheet(wb, fyStartYear, fyRows, salesRows){
  const salesByDate = {};
  salesRows.forEach(r=>{ salesByDate[r.date] = r.amount; });
  const purchasesByDate = {};
  fyRows.forEach(r=>{ purchasesByDate[r.date] = (purchasesByDate[r.date] || 0) + r.amount; });

  const header = ["Date","Day","Sales","Purchases","Purchases % of Sales"];
  const aoaRows = [header];
  monthsForFY(fyStartYear).forEach(({year, month})=>{
    const nDays = daysInMonth(year, month);
    for(let d=1; d<=nDays; d++){
      const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dayName = new Date(year, month-1, d).toLocaleDateString('en-IN', {weekday:'short'});
      const sales = salesByDate[dateStr];
      const purchases = purchasesByDate[dateStr];
      const pct = (sales && purchases) ? ((purchases/sales)*100).toFixed(1) + "%" : "";
      aoaRows.push([dateStr, dayName, sales || "", purchases || "", pct]);
    }
  });
  const ws = XLSX.utils.aoa_to_sheet(aoaRows);
  ws['!cols'] = [{wch:12},{wch:8},{wch:12},{wch:12},{wch:16}];
  XLSX.utils.book_append_sheet(wb, ws, sheetSafeName("Calendar " + fyLabel(fyStartYear)));
}

function monthShortYY(year, month){
  const d = new Date(year, month-1, 1);
  return d.toLocaleDateString('en-IN', {month:'short'}) + "-" + String(year).slice(-2);
}
// Rows cascade Monday -> Sunday through as many consecutive weeks as the FY's
// longest month needs; each month gets its own Day + Sales column pair, placed
// on whichever row matches that date's weekday. Scanning a row compares the
// same weekday-in-sequence (e.g. every "week 1 Wednesday") across all months.
// Sunday rows are labelled in full caps to stand out, matching how they're
// highlighted in the reference sheet.
function buildSalesWeekdayGridSheet(wb, fyStartYear, salesRows){
  const salesByDate = {};
  salesRows.forEach(r=>{ salesByDate[r.date] = r.amount; });
  const months = monthsForFY(fyStartYear);
  const weekdayNames = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const MAX_ROWS = 42; // 6 full weeks — enough to cover any month regardless of start weekday

  const grid = [];
  for(let r=0; r<MAX_ROWS; r++) grid.push(new Array(months.length*2).fill(""));
  const monthTotals = new Array(months.length).fill(0);

  months.forEach(({year, month}, mIdx)=>{
    const nDays = daysInMonth(year, month);
    const day1Weekday = (new Date(year, month-1, 1).getDay() + 6) % 7; // 0=Mon..6=Sun
    for(let d=1; d<=nDays; d++){
      const rowIdx = day1Weekday + (d-1);
      if(rowIdx >= MAX_ROWS) continue; // safety net, shouldn't happen
      const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const sales = salesByDate[dateStr];
      grid[rowIdx][mIdx*2] = d;
      grid[rowIdx][mIdx*2+1] = (sales !== undefined) ? sales : "";
      if(sales !== undefined) monthTotals[mIdx] += sales;
    }
  });

  let lastUsedRow = -1;
  for(let r=0; r<MAX_ROWS; r++){
    if(grid[r].some(c=>c !== "")) lastUsedRow = r;
  }
  const rowsToUse = lastUsedRow + 1;

  const header = [""];
  months.forEach(({year, month})=>{ header.push(monthShortYY(year, month)); header.push("Sales"); });
  const aoaRows = [header];

  for(let r=0; r<rowsToUse; r++){
    const wd = weekdayNames[r % 7];
    aoaRows.push([wd.toUpperCase(), ...grid[r]]);
  }

  const totalRow = new Array(1 + months.length*2).fill("");
  totalRow[1] = "Total";
  months.forEach((m, idx)=>{
    totalRow[1 + idx*2 + 1] = monthTotals[idx] || "";
  });
  aoaRows.push(totalRow);

  const ws = XLSX.utils.aoa_to_sheet(aoaRows);
  const cols = [{wch:11}];
  months.forEach(()=>{ cols.push({wch:6}); cols.push({wch:11}); });
  ws['!cols'] = cols;

  // Best-effort: highlight Sunday rows. Cell fill colors are a Pro-only
  // feature of the SheetJS library this app uses for free, so this may not
  // render — if it doesn't show up, you can add it yourself in Excel with
  // one conditional formatting rule ("text contains SUNDAY" -> yellow fill)
  // and it'll apply to every future export automatically.
  try{
    for(let r=0; r<rowsToUse; r++){
      if(r % 7 === 6){
        for(let c=0; c<header.length; c++){
          const ref = XLSX.utils.encode_cell({r: r+1, c});
          if(!ws[ref]) ws[ref] = { t:'s', v:'' };
          ws[ref].s = { fill: { patternType:"solid", fgColor:{rgb:"FFFF00"} } };
        }
      }
    }
  }catch(e){ /* styling not supported by this build — ignore */ }

  XLSX.utils.book_append_sheet(wb, ws, sheetSafeName("Weekly Sales " + fyLabel(fyStartYear)));
}

function buildMonthSheets(wb, fyStartYear, fyRows){
  monthsForFY(fyStartYear).forEach(({year, month})=>{
    const monthKey = `${year}-${String(month).padStart(2,'0')}`;
    const monthRows = fyRows.filter(r=>r.date.startsWith(monthKey));
    const nDays = daysInMonth(year, month);

    const supplierTotals = {}; // supplier -> { day: amount }
    monthRows.forEach(r=>{
      const day = Number(r.date.slice(8,10));
      if(!supplierTotals[r.supplier]) supplierTotals[r.supplier] = {};
      supplierTotals[r.supplier][day] = (supplierTotals[r.supplier][day] || 0) + r.amount;
    });
    const supplierNames = Object.keys(supplierTotals).sort((a,b)=>a.localeCompare(b));

    // Total column comes right after Supplier, so it's visible without scrolling.
    const header = ["Supplier","Total"];
    for(let d=1; d<=nDays; d++) header.push(d);
    const aoaRows = [header];

    const dayTotals = new Array(nDays).fill(0);
    let grandTotal = 0;
    supplierNames.forEach(sup=>{
      let supTotal = 0;
      const dayVals = [];
      for(let d=1; d<=nDays; d++){
        const amt = supplierTotals[sup][d] || 0;
        dayVals.push(amt || "");
        supTotal += amt;
        dayTotals[d-1] += amt;
      }
      grandTotal += supTotal;
      aoaRows.push([sup, supTotal, ...dayVals]);
    });

    if(supplierNames.length > 0){
      const totalRow = ["Total", grandTotal];
      dayTotals.forEach(v=>totalRow.push(v || ""));
      aoaRows.push(totalRow);
    } else {
      aoaRows.push(["No bills logged this month."]);
    }

    const ws = XLSX.utils.aoa_to_sheet(aoaRows);
    const cols = [{wch:22},{wch:12}];
    for(let d=1; d<=nDays; d++) cols.push({wch:6});
    ws['!cols'] = cols;

    // Live SUM() formulas for each supplier's Total (so editing a day's amount
    // in Excel recalculates the total automatically) and for the bottom Total row.
    if(supplierNames.length > 0){
      const rangeFormula = (r0,c0,r1,c1) =>
        `SUM(${XLSX.utils.encode_cell({r:r0,c:c0})}:${XLSX.utils.encode_cell({r:r1,c:c1})})`;
      supplierNames.forEach((sup, idx)=>{
        const r = idx + 1; // 0-based row; row0 is the header
        const ref = XLSX.utils.encode_cell({r, c:1});
        if(ws[ref]) ws[ref].f = rangeFormula(r, 2, r, 1+nDays);
      });
      const totalRowR = supplierNames.length + 1; // 0-based row of the Total row
      const totalRef = XLSX.utils.encode_cell({r: totalRowR, c:1});
      if(ws[totalRef]) ws[totalRef].f = rangeFormula(1, 1, supplierNames.length, 1);
      for(let d=0; d<nDays; d++){
        const c = 2 + d;
        const dayTotalRef = XLSX.utils.encode_cell({r: totalRowR, c});
        if(ws[dayTotalRef]) ws[dayTotalRef].f = rangeFormula(1, c, supplierNames.length, c);
      }
    }
    XLSX.utils.book_append_sheet(wb, ws, monthSheetLabel(year, month));
  });
}

function buildAnalysisSheet(wb, fyStartYear, fyRows, salesRows){
  const totalPurchases = fyRows.reduce((s,r)=>s+r.amount, 0);
  const totalSales = salesRows.reduce((s,r)=>s+r.amount, 0);
  const totalPct = totalSales > 0 ? ((totalPurchases/totalSales)*100).toFixed(1) + "%" : "";

  const monthlyRows = monthsForFY(fyStartYear).map(({year, month})=>{
    const monthKey = `${year}-${String(month).padStart(2,'0')}`;
    const purchases = fyRows.filter(r=>r.date.startsWith(monthKey)).reduce((s,r)=>s+r.amount, 0);
    const sales = salesRows.filter(r=>r.date.startsWith(monthKey)).reduce((s,r)=>s+r.amount, 0);
    const pct = sales > 0 ? ((purchases/sales)*100).toFixed(1) + "%" : "";
    return [monthSheetLabel(year, month), sales || "", purchases || "", pct];
  });

  const categoryTotals = {};
  fyRows.forEach(r=>{ categoryTotals[r.category] = (categoryTotals[r.category] || 0) + r.amount; });
  const categoryRows = Object.entries(categoryTotals)
    .sort((a,b)=>b[1]-a[1])
    .map(([cat, amt])=>[cat, amt, totalPurchases > 0 ? ((amt/totalPurchases)*100).toFixed(1) + "%" : ""]);

  const supplierTotals = {};
  fyRows.forEach(r=>{ supplierTotals[r.supplier] = (supplierTotals[r.supplier] || 0) + r.amount; });
  const supplierRows = Object.entries(supplierTotals)
    .sort((a,b)=>b[1]-a[1])
    .slice(0, 20)
    .map(([sup, amt])=>[sup, amt, totalPurchases > 0 ? ((amt/totalPurchases)*100).toFixed(1) + "%" : ""]);

  const aoaRows = [];
  aoaRows.push(["Monthly Summary — " + fyLabel(fyStartYear)]);
  aoaRows.push(["Month","Sales","Purchases","Purchases % of Sales"]);
  monthlyRows.forEach(r=>aoaRows.push(r));
  aoaRows.push(["Total", totalSales || "", totalPurchases || "", totalPct]);
  aoaRows.push([]);
  aoaRows.push(["Spend by Category"]);
  aoaRows.push(["Category","Amount","% of Total Purchases"]);
  if(categoryRows.length){ categoryRows.forEach(r=>aoaRows.push(r)); }
  else { aoaRows.push(["No purchases logged this year."]); }
  aoaRows.push([]);
  aoaRows.push(["Top Suppliers by Spend (top 20)"]);
  aoaRows.push(["Supplier","Amount","% of Total Purchases"]);
  if(supplierRows.length){ supplierRows.forEach(r=>aoaRows.push(r)); }
  else { aoaRows.push(["No purchases logged this year."]); }

  const ws = XLSX.utils.aoa_to_sheet(aoaRows);
  ws['!cols'] = [{wch:26},{wch:14},{wch:14},{wch:18}];
  XLSX.utils.book_append_sheet(wb, ws, sheetSafeName("Analysis " + fyLabel(fyStartYear)));
}

function buildFYSection(wb, fyStartYear, fyRows, salesRows){
  buildCalendarSheet(wb, fyStartYear, fyRows, salesRows);
  buildSalesWeekdayGridSheet(wb, fyStartYear, salesRows);
  buildMonthSheets(wb, fyStartYear, fyRows);
  buildAnalysisSheet(wb, fyStartYear, fyRows, salesRows);
}

async function downloadFYExcel(fyStartYear){
  const btn = document.getElementById('downloadExcelBtn');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Building…";
  try{
    if(typeof XLSX === 'undefined'){
      throw new Error("Excel library did not load (check your internet connection) — try Download CSV instead.");
    }
    const fyRows = await collectFYBillRows(fyStartYear);
    const fySales = await collectFYSalesRows(fyStartYear);
    const wb = XLSX.utils.book_new();
    buildFYSection(wb, fyStartYear, fyRows, fySales);
    XLSX.writeFile(wb, `${currentRestaurantId}-vendor-bills-${fyLabel(fyStartYear).replace(/\s+/g,'-')}.xlsx`);
  }catch(e){
    console.error("excel export failed", e);
    alert(e.message || "Couldn't build the Excel file.");
  }
  btn.disabled = false;
  btn.textContent = original;
}
async function buildFullWorkbook(){
  const fys = await getAvailableFYs();
  const wb = XLSX.utils.book_new();
  for(const fy of fys.slice().sort((a,b)=>a-b)){
    const fyRows = await collectFYBillRows(fy);
    const fySales = await collectFYSalesRows(fy);
    buildFYSection(wb, fy, fyRows, fySales);
  }
  return wb;
}
async function handleDownloadExcelClick(){
  const fyList = await getAvailableFYs();
  if(fyList.length <= 1){
    await downloadFYExcel(fyList[0] !== undefined ? fyList[0] : fyStartYearForDate(todayStr()));
  } else {
    openFYModal(fyList);
  }
}
function openFYModal(fyList){
  const box = document.getElementById('fyModalOptions');
  box.innerHTML = "";
  fyList.forEach(fy=>{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'modal-btn-secondary';
    btn.style.width = '100%';
    btn.style.marginBottom = '8px';
    btn.style.textAlign = 'left';
    btn.textContent = fyLabel(fy);
    btn.addEventListener('click', async ()=>{
      closeFYModal();
      await downloadFYExcel(fy);
    });
    box.appendChild(btn);
  });
  document.getElementById('fyModal').classList.add('open');
}
function closeFYModal(){
  document.getElementById('fyModal').classList.remove('open');
}
async function connectExcelFile(){
  if(!window.showSaveFilePicker){
    alert("Live Excel sync needs Chrome or Edge on desktop. Use 'Download Excel (FY register)' instead — it works everywhere, you'll just need to re-download it for updates.");
    return false;
  }
  try{
    const handle = await window.showSaveFilePicker({
      suggestedName: currentRestaurantId + "-vendor-bills.xlsx",
      types: [{ description: "Excel file", accept: {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"]} }]
    });
    fileHandles[currentRestaurantId] = handle;
    fileHandle = handle;
    updateSyncBtnLabel();
    document.getElementById('syncBtn').title = "Click 'Save to Excel File' below to update this file with " + restaurantLabel(currentRestaurantId) + "'s latest entries.";
    return true;
  }catch(e){
    if(e.name !== 'AbortError') console.error("connect failed", e);
    return false;
  }
}
async function syncToConnectedFile(){
  if(!fileHandle) return false;
  try{
    const wb = await buildFullWorkbook();
    const arrayBuffer = XLSX.write(wb, {bookType:'xlsx', type:'array'});
    const writable = await fileHandle.createWritable();
    await writable.write(arrayBuffer);
    await writable.close();
    return true;
  }catch(e){
    console.error("sync write failed", e);
    fileHandle = null;
    delete fileHandles[currentRestaurantId];
    document.getElementById('syncBtn').textContent = "⚠ Link lost — click to reconnect";
    return false;
  }
}
async function saveToSpreadsheet(){
  const btn = document.getElementById('saveSpreadsheetBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving…";
  let ok = false;
  if(fileHandle){
    ok = await syncToConnectedFile();
  } else if(window.showSaveFilePicker){
    ok = await connectExcelFile();
    if(ok) ok = await syncToConnectedFile();
  } else {
    const wb = await buildFullWorkbook();
    XLSX.writeFile(wb, currentRestaurantId + "-vendor-bills-all.xlsx");
    ok = true;
  }
  btn.disabled = false;
  if(ok){
    const now = new Date();
    btn.textContent = "Saved ✓ " + now.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
    setTimeout(()=>{ btn.textContent = originalText; }, 3000);
  } else {
    btn.textContent = originalText;
  }
}

