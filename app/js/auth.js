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

// Only the owner profile gets every tab; a manager sees Add Expenses only. If a
// manager is somehow left on a hidden tab (shouldn't happen via normal clicks,
// since the buttons themselves are hidden), fall back to Add Expenses. Also
// toggles the two restaurant-switching affordances between profiles: an owner
// gets the in-toolbar selector (no gate, no password) instead of "Change
// restaurant" (which re-triggers the gate — meaningless for an owner who
// never goes through it).
function updateTabVisibilityForProfile(){
  const owner = isOwnerProfile();
  document.getElementById('tabBtnReports').style.display = owner ? '' : 'none';
  document.getElementById('tabBtnLedger').style.display = owner ? '' : 'none';
  document.getElementById('expensesRestaurantControl').style.display = owner ? 'flex' : 'none';
  document.getElementById('restaurantChangeBtn').style.display = owner ? 'none' : '';
  if(!owner){
    const activePanel = document.querySelector('.tab-panel.active');
    if(activePanel && activePanel.id !== 'tabPanelExpenses' && typeof switchTab === 'function'){
      switchTab('expenses');
    }
  }
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
    try{ sessionStorage.setItem(REPORTS_UNLOCK_KEY, '1'); }catch(e){}
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
  showConfirmedRestaurant();
});
document.getElementById('restaurantChangeBtn').addEventListener('click', ()=>{
  setUnlockedRestaurantId(null);
  showRestaurantGateStep();
});
document.getElementById('switchProfileBtn').addEventListener('click', ()=>{
  setProfile(null);
  setUnlockedRestaurantId(null);
  showProfileGate();
});
