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
  // Optional per-tenant accent color override (TENANT_ACCENT/_DEEP/_LIGHT in
  // app/tenants/<tenant>.js) -- replaces the shared --brass/--brass-deep/
  // --brass-light CSS variables site-wide for this tenant only. Undefined
  // for Pingara/RK Twelve21, so they keep styles.css's default palette.
  if(typeof TENANT_ACCENT !== 'undefined' && typeof TENANT_ACCENT_DEEP !== 'undefined' && typeof TENANT_ACCENT_LIGHT !== 'undefined'){
    const root = document.documentElement.style;
    root.setProperty('--brass', TENANT_ACCENT);
    root.setProperty('--brass-deep', TENANT_ACCENT_DEEP);
    root.setProperty('--brass-light', TENANT_ACCENT_LIGHT);
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
  await loadSupplierBankDetails();
  await loadStaffBankDefaults();
  await loadEntries(currentDate);
  await loadSales(currentDate);
  renderAll();
  // Non-blocking — scans every restaurant's bill history to work out which
  // suppliers are relevant to which restaurant (see data-store.js's
  // buildSupplierUsageIndex()). Until this resolves every supplier shows
  // (supplierVisibleForRestaurant() treats an empty index as unrestricted),
  // so this only narrows the dropdown down shortly after load — it's never
  // the reason something that should show doesn't, even mid-load.
  loadSupplierUsageIndex().then(()=>{ renderSupplierSelect(); });
})();
