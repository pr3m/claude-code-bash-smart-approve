---
name: bash-smart-approve:uninstall
description: Cleanly remove bash-smart-approve from Claude Code. Use when user says "uninstall bash-smart-approve", "remove the hook", "tear it down", "/bash-smart-approve:uninstall".
---

# Uninstall

Reverse what `/bash-smart-approve:install` did. Asks for confirmation at each step — nothing is silently deleted.

## Step 1 — Confirm intent

> "This will remove the PreToolUse hook from `~/.claude/settings.json` and (optionally) delete your config + log. Proceed?"

If no → stop.

## Step 2 — Unwire the hook

Read `~/.claude/settings.json`. Find entries under `hooks.PreToolUse[*].hooks[*]` whose `command` references `bash-smart-approve` / `approve.js` and remove them. If a `matcher` block becomes empty, remove the whole block.

Show the diff. Apply on approval.

Also check project-level settings (`.claude/settings.json`, `.claude/settings.local.json`) and offer to unwire there too.

## Step 3 — Offer to delete config

Ask: "Delete the bash-smart-approve config file(s) too? (you can keep them if you plan to reinstall)"

Candidates:
- `$CLAUDE_PLUGIN_DATA/config.json`
- `~/.claude/bash-smart-approve.json`
- `<cwd>/.claude/bash-smart-approve.json`

## Step 4 — Offer to delete log

Ask: "Delete the audit log at `~/.claude/bash-smart-approve.log`?" Default: keep.

## Step 5 — Do NOT

- Do not delete the plugin directory itself. That's managed by `/plugin uninstall` (marketplace) or `rm -rf <clone-path>` (manual).
- Do not touch `permissions.allow` rules — those were already the user's, not our creation.

## Step 6 — Summary

Confirm what was removed and remind user:
- Reinstall anytime via `/bash-smart-approve:install`
- Restart Claude Code (or `/hooks`) for the hook removal to take effect
