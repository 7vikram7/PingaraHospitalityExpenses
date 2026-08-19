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

**The two tenants are owned by two different Google accounts**, so the
Firebase CLI login has to be switched between deploys:
- `vendor-bills` (Pingara) → `akash2628@gmail.com`
- `rk-twelve21` → `rktwelve21@gmail.com`

Check which is currently active with `firebase projects:list` before
deploying — don't assume. To switch: `firebase.cmd logout` then
`firebase.cmd login` (use the `.cmd` shim, not bare `firebase` — PowerShell's
default execution policy blocks the npm `.ps1` wrapper). **`firebase login`
needs a real interactive browser + terminal and can't be driven by an
agent** — ask the human running the session to do it directly and confirm
once logged in, don't attempt to script around it.

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
