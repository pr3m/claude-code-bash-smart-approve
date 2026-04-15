---
name: bash-smart-approve:status
description: Health check for bash-smart-approve — is shfmt installed, is the hook wired, is the plugin enabled, what's the recent activity. Use when user says "is bsa working", "bash-smart-approve status", "check the hook", "/bash-smart-approve:status".
---

# Status / Health Check

## Step 1 — Dependencies

- `shfmt --version` → report version or ❌ missing
- `node --version` → report version

## Step 2 — Hook wired

Read `~/.claude/settings.json` and check `hooks.PreToolUse`.
Find any entry whose `command` references `bash-smart-approve` or `approve.js`.

Report:
- ✅ Hook wired at `<path>` with timeout `<N>s`
- ❌ Hook not found in settings → suggest `/bash-smart-approve:install`

Also check `.claude/settings.json` and `.claude/settings.local.json` in cwd for project-level hook overrides.

## Step 3 — Enabled state

- Config `enabled` flag: read user + project config. Report effective value.
- `BASH_SMART_APPROVE_DISABLE` env var: check `process.env` via a bash probe (`echo "${BASH_SMART_APPROVE_DISABLE:-unset}"`).
- If either disables the plugin, flag it prominently.

## Step 4 — Scope

If `scopeDirectories` is set, report whether the current `cwd` is in scope.

## Step 5 — Recent activity

If the log file exists, report:
- Entries in the last 24h
- Split: allowed vs asked vs denied
- Most recent entry timestamp

Use: `tail -n 200 <logFile>` and parse JSON lines.

## Step 6 — Output

Single compact status block:

```
bash-smart-approve — status

Dependencies:     shfmt 3.13.1 ✅ · node v20.11.0 ✅
Hook wired:       ✅ ~/.claude/settings.json (timeout 5s)
Plugin enabled:   ✅ (config + env)
Scope:            everywhere  (cwd is in scope)
Config:           ~/.claude/bash-smart-approve.json
                  42 binaries · 3 domains · 1 rm path
Recent (24h):     17 allowed · 3 asked · 0 denied
Last activity:    2 min ago

OK → plugin is operational.
```

If any ❌, lead with remediation steps.
