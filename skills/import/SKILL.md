---
name: bash-smart-approve:import
description: Parse existing Claude Code Bash(...) allow rules from settings.json files and convert them into bash-smart-approve config. Use when user says "import my existing rules", "migrate my allowlist", "read my settings", or during first-time install.
---

# Import Existing Allow Rules

Convert `Bash(...)` permission rules from Claude Code settings into bash-smart-approve config.

## Step 1 — Locate settings files

Read (in order of precedence, later overrides earlier):

1. `~/.claude/settings.json` (user-global)
2. `<cwd>/.claude/settings.json` (project, committed)
3. `<cwd>/.claude/settings.local.json` (project, gitignored)

Also check `~/.claude/settings.local.json` if it exists.

For each file, extract `permissions.allow` array. Ignore `permissions.deny`, `permissions.ask`, and non-Bash rules (e.g. `Read(...)`, `Edit(...)`, `mcp__...`).

## Step 2 — Parse each Bash(...) rule

For every string matching `Bash(<pattern>)`:

1. Strip the `Bash(` prefix and trailing `)`.
2. Normalize the pattern:
   - If it starts with `$HOME/`, `$HOME\`, `~/`, or `~\` → strip that prefix.
   - If it starts with an absolute path like `/Users/.../bin/X` or `/usr/bin/X` → keep only the last segment (`X`).
   - Strip trailing `.exe`.
3. Identify the **first token** (the binary name):
   - Pattern `git *` → binary `git`
   - Pattern `npm view:*` → binary `npm`
   - Pattern `aws-vault exec:*` → binary `aws-vault`
   - Pattern `bin/jira:*` → binary `jira`
4. Classify:
   - **shell interpreter** (`bash`, `sh`, `zsh`, `sudo`, `python`, `node -e`, `xargs`, `env`, etc.) → **skip with a warning** to the user: "Rule `Bash(bash:*)` cannot be imported — shell interpreters are hard-denied for security."
   - **`curl` or `wget`** → also try to extract a domain from the pattern (regex: `[a-zA-Z0-9*.-]+\.[a-zA-Z]{2,}`). If a domain is found, add it to `allowedCurlDomains`. If no domain is extractable, skip with a note (too broad to auto-allow).
   - **`rm` or `rmdir`** → try to extract path arguments. If the pattern is too broad (`rm *` / `rm -rf *`), skip with a warning. If concrete paths are present (`/tmp/jira*`), add to `allowedRmPaths`.
   - **anything else** → add the binary to `allowedBinaries`.

## Step 3 — Dedupe and propose diff

Merge against the existing bash-smart-approve config (don't re-add things already present).

Show the user a clear summary:

```
Import plan:

Binaries to add:
  + aws-vault
  + jira
  + wunda-deploy
  + wunda-ecs
  + afplay

Curl domains to add:
  + *.atlassian.net
  + wundamental.atlassian.net

Skipped (require manual review):
  ! Bash(bash:*) — shell interpreter, hard-denied
  ! Bash(rm *) — too broad
  ! Bash(curl -s:*) — no extractable domain
```

Ask: "Apply all? Apply with edits? Cancel?"

## Step 4 — Write the config

On approval, update the target config file (user-global by default — ask if they want project-level instead). Merge arrays — never overwrite.

## Step 5 — Offer cleanup

After writing the new config, ask:

> "These `Bash(...)` rules in settings.json are now redundant (the hook covers them). Want me to remove them from settings.json?"

List each rule that can be removed. Get **explicit per-rule approval** (or a blanket "yes remove all"). Never silently strip rules.

## Step 6 — Summary

Tell the user:
- N binaries imported
- N domains imported
- N rules skipped (with reasons)
- N redundant rules removed from settings.json (if approved)
- Suggest `/bash-smart-approve:list` to inspect the final config

## Edge cases

- **Pattern with `cd && ...` compound** → the first token is `cd`. Record `cd` (already in defaults). The chained binary is typically a signal the user wanted the downstream tool — parse and add it too.
- **Pattern with `$()` subshell** → too complex to parse reliably. Skip with a warning.
- **Absolute path to user binary** (`/home/alice/bin/mytool:*`) → extract `mytool`, add as binary. Note to the user: the plugin uses `$PATH` resolution, so `mytool` must be in `PATH` at runtime.
- **Windows paths with backslashes** → normalize to forward slashes before parsing.
