/* ---------- Init ---------- */
// Applies the active tenant's branding (app/tenant.js) to the header. Runs
// first and unconditionally for every tenant — the HTML ships with empty
// placeholders rather than one tenant's defaults, so nobody sees a flash of
// the wrong company's name/logo before this runs.
function applyTenantBranding(){
  document.title = TENANT_TITLE;
  document.getElementById('brandTitle').textContent = TENANT_TITLE;
  document.getElementById('restaurantEyebrow').textContent = TENANT_EYEBROW;
  if(TENANT_LOGO){
    const logo = document.getElementById('brandLogo');
    logo.src = TENANT_LOGO;
    logo.alt = TENANT_BRAND_NAME;
    logo.style.display = '';
    document.getElementById('brandDivider').style.display = '';
  }
}

(async function init(){
  applyTenantBranding();
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
