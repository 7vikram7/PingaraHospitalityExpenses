# Instructions for Claude Code

Standing workflow rules for this repo. These apply automatically — no need
to ask before following them.

## Before starting any feature or bugfix
**Always pull the latest code from GitHub first:**
```
git pull origin main
```
Do this before making any edits, every session — never assume the local
checkout is current. If the pull can't fast-forward (local commits ahead,
or a conflict), resolve that first (rebase/merge as appropriate) rather than
skipping the pull.

## After every change
Commit, push, and deploy — without waiting to be asked each time:
```
git add -A
git commit -m "..."
git push origin main
bash deploy.sh pingara        # or: bash deploy.sh rk-twelve21
```
This repo is **multi-tenant** — both Pingara and RK Twelve21 are served from
this one codebase (`app/tenant.js` + `app/tenants/*.js`, see CONTEXT.md's
"Multi-tenant" section). A change to any shared `app/js/*.js` file applies to
both and should generally be **deployed to both**, one `deploy.sh` call each.
Don't hand-run `firebase deploy` directly — `deploy.sh` is what activates the
right tenant config first.

**Gotcha:** `deploy.sh` overwrites the git-tracked `app/tenant.js` with
whichever tenant you last deployed, and leaves it that way. Check
`git status` before committing anything else — if `app/tenant.js` shows as
modified from an unrelated tenant switch, `git restore app/tenant.js` first
so you don't commit a tenant swap as a side effect of an unrelated change.

**The two tenants are owned by two different Google accounts** —
`vendor-bills` (Pingara) by `akash2628@gmail.com`, `rk-twelve21` by
`rktwelve21@gmail.com`. Deploy each via its own **service account key**, not
an interactive `firebase login` session — this needs *no* login/logout
dance and works even with no interactive session active at all (confirmed:
`GOOGLE_APPLICATION_CREDENTIALS` alone, no `firebase login`, authenticates
fine for both `projects:list` and a real `deploy`):
```
export GOOGLE_APPLICATION_CREDENTIALS="<path to that tenant's key>"
bash deploy.sh <tenant>
```
Key locations (outside the repo, per the isolation convention —
never commit these):
- Pingara: `C:\pingara vendor project\documents\vendor-bills-firebase-adminsdk-fbsvc-cddd5e0b76.json`
- RK Twelve21: `C:\rktwelve21\documents\rk-twelve21-firebase-adminsdk-fbsvc-71086d442b.json`

**Only fall back to interactive `firebase login`** if a *stored* CLI login
session is active and taking priority over the service account (it does —
an active interactive session wins over `GOOGLE_APPLICATION_CREDENTIALS`
even when it's the wrong account, which is what caused this problem
originally). Run `firebase login:list` first — if it says "No authorized
accounts," the service account alone is sufficient and nothing else is
needed. If some other interactive session **is** active, prefer
`firebase.cmd logout` (still doesn't need re-login) over touching whatever
account is currently signed in. Never attempt `firebase login` yourself —
it needs a real interactive browser + terminal and can't be driven by an
agent; ask the human running the session to do it directly if it's ever
genuinely required.

See `CONTEXT.md`'s deploy notes for the Windows-specific PATH requirement
(Git's `usr\bin` for `rm`/`cp` in the predeploy script) if running the
underlying `firebase` commands directly for any reason.

Verify a deploy actually landed by checking the live site's served files
(e.g. fetch a JS file and grep for a string only the new code has, and
confirm `/tenants/*.js` 404s on both live sites — that's the other tenant's
secrets staying out of this one's bundle), not just the CLI's exit code —
this app has a known cosmetic Node/libuv crash on Windows that returns
non-zero even on success.

## For architecture, data model, and "why" questions
See `README.md` (quick start, features, structure) and `CONTEXT.md` (deep
architecture, data model, known limitations, and the reasoning behind every
non-obvious decision) — both are the current source of truth and should be
updated as part of any change that affects what they describe.
