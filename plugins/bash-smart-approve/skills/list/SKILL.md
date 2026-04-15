---
name: bash-smart-approve:list
description: Show the current bash-smart-approve config — merged user + project layers. Use when user says "show my bsa config", "list rules", "what's allowed", "show bash-smart-approve settings".
---

# List Config

Display the effective bash-smart-approve configuration.

## Step 1 — Load config

Read and merge (later overrides earlier for scalars; arrays union):
1. Plugin defaults (from `hooks/approve.js` `DEFAULT_CONFIG`)
2. User config: `$CLAUDE_PLUGIN_DATA/config.json` OR `~/.claude/bash-smart-approve.json`
3. Project config: `<cwd>/.claude/bash-smart-approve.json`

Also check `BASH_SMART_APPROVE_DISABLE` env var.

## Step 2 — Render

Show a readable grouped summary:

```
bash-smart-approve — effective config

Status:       enabled (kill-switch off)
Scope:        everywhere  (or: <list of scopeDirectories>)
Config files: ~/.claude/bash-smart-approve.json
              /Users/.../project/.claude/bash-smart-approve.json

Allowed binaries (from defaults + user + project):
  defaults:  ls, cat, grep, sed, awk, jq, git, node, npm, ...
  + user:    aws-vault, jira, wunda-deploy
  + project: wunda-ecs

Allowed curl domains:
  *.atlassian.net, api.github.com

Allowed rm paths:
  /tmp/**

Denied patterns:
  (none)

Log file:  ~/.claude/bash-smart-approve.log  (last modified: 5 min ago)
Log decisions: allow, ask
```

## Step 3 — Hint

At the bottom, point the user at:
- `/bash-smart-approve:allow <cmd>` to add
- `/bash-smart-approve:remove <item>` to remove
- `/bash-smart-approve:status` for health check
- `/bash-smart-approve:review-log` for recent activity

## Notes

- Distinguish defaults from user additions in the output — helps users see what they've customized.
- If no config file exists, show defaults only and note: "No user config yet. Run `/bash-smart-approve:install` to create one."
