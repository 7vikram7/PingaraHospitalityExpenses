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
firebase deploy --only hosting --project vendor-bills
```
See `firebase deploy`'s Windows-specific PATH requirement (Git's `usr\bin`
for `rm`/`cp` in the predeploy script) in `CONTEXT.md`'s deploy notes.

Verify a deploy actually landed by checking the live site's served files
(e.g. fetch a JS file and grep for a string only the new code has), not just
the CLI's exit code — this app has a known cosmetic Node/libuv crash on
Windows that returns non-zero even on success.

## For architecture, data model, and "why" questions
See `README.md` (quick start, features, structure) and `CONTEXT.md` (deep
architecture, data model, known limitations, and the reasoning behind every
non-obvious decision) — both are the current source of truth and should be
updated as part of any change that affects what they describe.
