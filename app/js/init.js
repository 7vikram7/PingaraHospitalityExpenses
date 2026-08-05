/* ---------- Init ---------- */
(async function init(){
  renderRestaurantSelect();
  renderAuthGateState();
  renderFirebaseStatus("", false);
  await loadCategories();
  await loadSuppliers();
  await loadSupplierDefaults();
  await loadEntries(currentDate);
  await loadSales(currentDate);
  renderAll();
})();
