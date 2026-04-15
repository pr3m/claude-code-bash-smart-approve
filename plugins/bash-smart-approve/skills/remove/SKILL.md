---
name: bash-smart-approve:remove
description: Remove a binary, domain, or path from the bash-smart-approve allowlist. Use when user says "remove X from allowlist", "stop allowing Y", "drop this rule", "/bash-smart-approve:remove ...".
---

# Remove from Allowlist

## Step 1 — Identify target

If `$ARGUMENTS` names an item, use it. Otherwise ask: "What should I remove? (binary name, curl domain, or rm path)"

Classify:
- Contains a `.` but no `/` → likely a domain (e.g. `example.com`, `*.example.com`)
- Starts with `/` or `~` or contains `**` → path (for `allowedRmPaths`)
- Otherwise → binary name

If ambiguous, ask the user.

## Step 2 — Locate

Check every config layer:
- User: `$CLAUDE_PLUGIN_DATA/config.json` or `~/.claude/bash-smart-approve.json`
- Project: `<cwd>/.claude/bash-smart-approve.json`

Find the item in the relevant array (`allowedBinaries`, `allowedCurlDomains`, `allowedRmPaths`, or `deniedPatterns`).

If the item is **only in defaults** (shipped with the plugin, not in any user config) → tell the user: "X is a built-in default. To block it, add it to `deniedPatterns` instead." Suggest the exact regex.

If the item appears in multiple layers → ask which to remove (or both).

## Step 3 — Confirm and edit

Show the user the proposed diff. On approval, Edit the config file(s) and remove the array entry.

## Step 4 — Summary

Report:
- Item removed from `<file>`
- No restart needed — config reloads on next hook invocation
- Hint: `/bash-smart-approve:list` to verify
