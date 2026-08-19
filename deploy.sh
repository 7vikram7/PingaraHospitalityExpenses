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

# Tenant name -> actual Firebase project ID. These deliberately do not have
# to match (e.g. "pingara" the tenant is project "vendor-bills", picked before
# this was multi-tenant) -- add a line here for every new tenant.
case "$TENANT" in
  pingara)     PROJECT="vendor-bills" ;;
  rk-twelve21) PROJECT="rk-twelve21" ;;
  *)
    echo "No Firebase project mapping for tenant '$TENANT' -- add one to the case statement in deploy.sh"
    exit 1
    ;;
esac

echo "Activating tenant: $TENANT"
cp "$TENANT_FILE" app/tenant.js

echo "Deploying to Firebase project: $PROJECT"
firebase deploy --only hosting --project "$PROJECT"
