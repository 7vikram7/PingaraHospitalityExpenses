/* ---------- Init ---------- */
(async function init(){
  renderRestaurantSelect();
  renderRestaurantGateState();
  renderFirebaseStatus("", false);
  await loadCategories();
  await loadSuppliers();
  await loadSupplierDefaults();
  await loadEntries(currentDate);
  await loadSales(currentDate);
  renderAll();
})();
