---
name: bash-smart-approve:review-log
description: Review recent bash-smart-approve auto-approval decisions. Use when user says "show recent approvals", "audit the log", "what did the hook auto-approve lately", or similar.
---

# Review Audit Log

Summarize recent decisions from the bash-smart-approve log file.

## Step 1 — Locate the log

Default: `~/.claude/bash-smart-approve.log`.

If the user has set `logFile` in `$CLAUDE_PLUGIN_DATA/config.json`, `~/.claude/bash-smart-approve.json`, or the project's `.claude/bash-smart-approve.json`, use that path instead (the project override takes precedence).

## Step 2 — Read entries

Each line is one JSON object:

```json
{"ts":"2026-04-15T09:00:00Z","cwd":"/path","decision":"allow|ask","reason":"...","command":"..."}
```

Show the last 20 entries by default. If the user asks for a specific decision (allow / ask / deny), filter accordingly.

## Step 3 — Summarize

Group the output:
- **Allowed** — count + top 5 binaries/commands.
- **Asked / prompted** — count + top reasons (helps the user spot allow-list gaps).
- **Denied** — if any, show them all (rare).

Flag anything surprising: repeated asks for the same command (candidate for the allowlist), unexpected binaries, commands from unusual cwds.

## Step 4 — Offer follow-up

> "Spot a command you'd like auto-approved going forward? I can run `/bash-smart-approve:allow <command>` to whitelist it."
