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
  // Optional full per-tenant color theme (TENANT_THEME in
  // app/tenants/<tenant>.js) -- overrides styles.css's shared :root CSS
  // variables site-wide for this tenant only (text/background/border colors
  // plus the accent trio), whichever keys it defines. Undefined for Pingara/
  // RK Twelve21, so they keep styles.css's default palette untouched.
  // Deliberately does NOT cover --green/--green-bg/--red/--red-bg/
  // --margin-red/--led-green/--led-red -- those are functional paid/unpaid
  // status signal colors, not brand chrome, and changing them per-tenant
  // would undermine their universal meaning.
  if(typeof TENANT_THEME !== 'undefined'){
    const root = document.documentElement.style;
    const cssVarByThemeKey = {
      ink: '--ink', inkSoft: '--ink-soft',
      paper: '--paper', paperDark: '--paper-dark', paperLine: '--paper-line',
      accent: '--brass', accentDeep: '--brass-deep', accentLight: '--brass-light',
      ledBg: '--led-bg', ledDim: '--led-dim', ledAmber: '--led-amber'
    };
    Object.keys(cssVarByThemeKey).forEach(key => {
      if(TENANT_THEME[key]) root.setProperty(cssVarByThemeKey[key], TENANT_THEME[key]);
    });
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
  await loadDismissedSimilarVendorPairs();
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
  // Also re-renders the Suppliers tab / Manage Suppliers modal lists if
  // either happens to already be open (added 2026-10-18, alongside
  // supplierRestaurantLabel() starting to read this same index for
  // display) -- otherwise a view opened in this brief window could show a
  // misleading "Not billed yet" for a supplier that's actually billed
  // plenty, just not indexed yet. Harmless no-op into empty/hidden DOM if
  // neither is open.
  loadSupplierUsageIndex().then(()=>{
    renderSupplierSelect();
    renderSuppliersTabList();
    renderManageSupplierList();
  });
})();
