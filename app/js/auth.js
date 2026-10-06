/* ---------- Login: profile choice (Owner/Manager) + restaurant gate wiring ----------
   Storage primitives (getProfile/setProfile/getUnlockedRestaurantId/etc) live in
   core.js alongside the other small state accessors — this file is just the
   screens and the flow between them. Same "soft deterrent" security model as
   every other password in this app (see CONTEXT.md): client-side only, not real
   access control, just a UI-level boundary.

   Flow: profileGate -> (Owner: ownerLoginGate -> straight to the app, no
                          restaurant gate at all — the owner gets a restaurant
                          selector directly in the Add Expenses toolbar instead,
                          same pattern as Reports/Vendor Ledger's own selectors)
                      -> (Manager: restaurantGate w/ per-restaurant password,
                          still required — that's a real boundary between
                          restaurants' managers, not just a UX step)
                      -> restaurantConfirmedBar + appTabsWrap
   "Switch profile" (in the confirmed bar) and "Back" (on each gate screen) reset
   session state and return to profileGate. */

function hideAllGates(){
  document.getElementById('profileGate').style.display = 'none';
  document.getElementById('ownerLoginGate').style.display = 'none';
  document.getElementById('restaurantGate').style.display = 'none';
  document.getElementById('restaurantConfirmedBar').style.display = 'none';
  document.getElementById('appTabsWrap').style.display = 'none';
}
function showProfileGate(){
  hideAllGates();
  document.getElementById('profileGate').style.display = 'flex';
}
function showOwnerLoginGate(){
  hideAllGates();
  document.getElementById('ownerLoginPasswordInput').value = '';
  document.getElementById('ownerLoginError').classList.remove('show');
  document.getElementById('ownerLoginGate').style.display = 'flex';
}
function showRestaurantGateStep(){
  hideAllGates();
  const owner = isOwnerProfile();
  document.getElementById('restaurantPasswordField').style.display = owner ? 'none' : 'block';
  document.getElementById('restaurantPasswordInput').value = '';
  document.getElementById('restaurantPasswordError').classList.remove('show');
  document.getElementById('restaurantGate').style.display = 'flex';
}

// Only the owner profile (or the elevated Central Kitchen profile, added
// 2026-10-03 -- see core.js's hasElevatedAccess()) gets every tab; a normal
// manager sees Add Expenses + Staff Expenses only. If a manager is somehow
// left on a hidden tab (shouldn't happen via normal clicks, since the
// buttons themselves are hidden), fall back to Add Expenses. Also toggles
// the two restaurant-switching affordances between profiles: an owner gets
// the in-toolbar selector (no gate, no password) instead of "Change
// restaurant" (which re-triggers the gate — meaningless for an owner who
// never goes through it). Central Kitchen gets the same in-toolbar selector
// and no restaurant gate, so it can add and view bills for every restaurant.
function updateTabVisibilityForProfile(){
  const owner = isOwnerProfile();
  const elevated = hasElevatedAccess();
  document.getElementById('tabBtnReports').style.display = elevated ? '' : 'none';
  document.getElementById('tabBtnLedger').style.display = elevated ? '' : 'none';
  document.getElementById('tabBtnSuppliers').style.display = elevated ? '' : 'none';
  // Staff Expenses (added 2026-10-01, renamed from "Staff OT & Salary" 2026-10-02) deliberately stays visible for every
  // profile -- a Manager can add/view staff and log OT/salary for their own
  // restaurant, the one real boundary that still applies (via the
  // restaurant password gate itself, same as Add Expenses). The restaurant
  // SELECTOR inside that tab is shown to Owner and Central Kitchen alike
  // (full cross-restaurant staff-data rights for both); a normal Manager has
  // nothing to pick between and operates on currentRestaurantId directly.
  document.getElementById('staffRestaurantControl').style.display = elevated ? 'flex' : 'none';
  document.getElementById('expensesRestaurantControl').style.display = elevated ? 'flex' : 'none';
  document.getElementById('restaurantChangeBtn').style.display = elevated ? 'none' : '';
  document.getElementById('salesInlineSection').style.display = '';
  document.getElementById('ledSalesCell').style.display = '';
  if(!owner){
    const activePanel = document.querySelector('.tab-panel.active');
    const allowedPanelIds = elevated
      ? ['tabPanelExpenses', 'tabPanelStaff', 'tabPanelReports', 'tabPanelLedger', 'tabPanelSuppliers']
      : ['tabPanelExpenses', 'tabPanelStaff'];
    if(activePanel && !allowedPanelIds.includes(activePanel.id) && typeof switchTab === 'function'){
      switchTab('expenses');
    }
  }
  // Verify controls are built per profile, so rebuild them whenever the
  // profile changes, not just on data changes (added 2026-10-06).
  renderTable();
  renderSalesVerifyControl();
}

function renderAuthGateState(){
  const profile = getProfile();
  if(!profile){
    showProfileGate();
    return;
  }
  updateTabVisibilityForProfile();
  if(isRestaurantUnlockedForSession(currentRestaurantId)){
    showConfirmedRestaurant();
  } else {
    showRestaurantGateStep();
  }
}

document.getElementById('profileChooseOwner').addEventListener('click', showOwnerLoginGate);
document.getElementById('profileChooseManager').addEventListener('click', ()=>{
  setProfile('manager');
  updateTabVisibilityForProfile();
  showRestaurantGateStep();
});
document.getElementById('ownerLoginBack').addEventListener('click', showProfileGate);
document.getElementById('ownerLoginBtn').addEventListener('click', async ()=>{
  const input = document.getElementById('ownerLoginPasswordInput');
  const errEl = document.getElementById('ownerLoginError');
  const hash = await sha256Hex(input.value);
  if(hash === REPORTS_PASSWORD_HASH){
    setProfile('owner');
    // Owner login also satisfies the Reports/Vendor Ledger tabs' own password gate —
    // "once the owner logs in, no other passwords are required" applies there too.
    try{ localStorage.setItem(REPORTS_UNLOCK_KEY, '1'); }catch(e){}
    updateTabVisibilityForProfile();
    // No restaurant gate for the owner — straight into the app. Whichever
    // restaurant was last active (or the default) is already selected; the
    // owner can switch it via the Add Expenses toolbar's own selector.
    showConfirmedRestaurant();
  } else {
    errEl.classList.add('show');
  }
});
document.getElementById('ownerLoginPasswordInput').addEventListener('keydown', (ev)=>{
  if(ev.key === 'Enter') document.getElementById('ownerLoginBtn').click();
});

document.getElementById('restaurantGateBack').addEventListener('click', ()=>{
  setProfile(null);
  setUnlockedRestaurantId(null);
  showProfileGate();
});
document.getElementById('restaurantConfirmBtn').addEventListener('click', async ()=>{
  const selectedId = document.getElementById('restaurantSelect').value;
  if(!isOwnerProfile()){
    const pwInput = document.getElementById('restaurantPasswordInput');
    const errEl = document.getElementById('restaurantPasswordError');
    const hash = await sha256Hex(pwInput.value);
    if(hash !== RESTAURANT_PASSWORD_HASH[selectedId]){
      errEl.classList.add('show');
      return;
    }
    errEl.classList.remove('show');
  }
  setUnlockedRestaurantId(selectedId); // marks it confirmed this session for both profiles
  // Re-run tab visibility now that the restaurant (and therefore whether
  // this is the elevated Central Kitchen profile, added 2026-10-03) is
  // actually known -- the earlier call from profileChooseManager's handler
  // ran before any restaurant was selected, so it couldn't have known yet.
  updateTabVisibilityForProfile();
  showConfirmedRestaurant();
});
document.getElementById('restaurantChangeBtn').addEventListener('click', ()=>{
  setUnlockedRestaurantId(null);
  showRestaurantGateStep();
});
document.getElementById('desktopViewToggle').addEventListener('click', ()=>{
  setDesktopViewEnabled(!isDesktopViewEnabled());
  applyViewportMode();
});
// The one and only way back to the login screens now that profile/restaurant/
// reports-unlock state all persist in localStorage (2026-08-28) instead of
// resetting on browser close — clears every piece of login state so a fresh
// login is a genuinely clean slate, not just profile/restaurant.
document.getElementById('switchProfileBtn').addEventListener('click', ()=>{
  setProfile(null);
  setUnlockedRestaurantId(null);
  try{ localStorage.removeItem(REPORTS_UNLOCK_KEY); }catch(e){}
  showProfileGate();
});
