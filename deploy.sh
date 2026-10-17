#!/bin/bash
# Deploys one tenant's portal. Usage: ./deploy.sh <tenant>
#   ./deploy.sh pingara
#   ./deploy.sh rk-twelve21
#
# Copies app/tenants/<tenant>.js over app/tenant.js (the file index.html
# actually loads) so the right restaurant list / Firebase project / branding
# / Reports password go out, then runs the normal predeploy+deploy pipeline
# against that tenant's Firebase project. app/tenant.js always ends up
# reflecting whichever tenant was deployed last -- also what file:// local
# testing uses, so re-run this after switching which tenant you're working on
# locally, not just before a real deploy.
set -euo pipefail

TENANT="${1:-}"
if [ -z "$TENANT" ]; then
  echo "Usage: ./deploy.sh <tenant>"
  echo "Available tenants:"
  ls app/tenants/ | sed 's/\.js$//' | sed 's/^/  /'
  exit 1
fi

TENANT_FILE="app/tenants/${TENANT}.js"
if [ ! -f "$TENANT_FILE" ]; then
  echo "No such tenant config: $TENANT_FILE"
  exit 1
fi

if grep -q '"TODO"' "$TENANT_FILE"; then
  echo "Refusing to deploy $TENANT -- $TENANT_FILE still has TODO placeholder values."
  exit 1
fi

# Tenant name -> (Firebase project ID, hosting target). Project IDs
# deliberately don't have to match the tenant name (e.g. "pingara" the
# tenant is project "vendor-bills", picked before this was multi-tenant).
# TARGET is a hosting target applied once per project via `firebase
# target:apply hosting <target> <site-id> --project <project>` (recorded in
# .firebaserc, matched against a "target" key in firebase.json's hosting
# array) -- this indirection exists so a tenant's site id can differ from
# its project id (shree-krishna-palace's project is "expenses-d85ec" but its
# site/URL is "skpexpenses", a nicer name the owner asked for). A tenant
# whose site id already equals its project id (pingara, rk-twelve21) still
# needs a target applied, just pointing at that same default site -- add a
# line here AND run target:apply for every new tenant.
case "$TENANT" in
  pingara)              PROJECT="vendor-bills";   TARGET="pingara" ;;
  rk-twelve21)          PROJECT="rk-twelve21";    TARGET="rktwelve21" ;;
  shree-krishna-palace) PROJECT="expenses-d85ec"; TARGET="skp" ;;
  *)
    echo "No Firebase project mapping for tenant '$TENANT' -- add one to the case statement in deploy.sh"
    exit 1
    ;;
esac

echo "Activating tenant: $TENANT"
cp "$TENANT_FILE" app/tenant.js
cp "app/tenants/${TENANT}-manifest.json" app/manifest.json
cp "app/tenants/${TENANT}-icon-192.png" app/icon-192.png
cp "app/tenants/${TENANT}-icon-512.png" app/icon-512.png
# Logo is optional (TENANT_LOGO can be null, e.g. RK Twelve21) -- only swap
# app/logo.png if this tenant actually has one, so a tenant without a logo
# file doesn't break the deploy and doesn't touch whatever's already there.
if [ -f "app/tenants/${TENANT}-logo.png" ]; then
  cp "app/tenants/${TENANT}-logo.png" app/logo.png
fi

echo "Deploying to Firebase project: $PROJECT (hosting target: $TARGET)"
firebase deploy --only "hosting:$TARGET" --project "$PROJECT"
