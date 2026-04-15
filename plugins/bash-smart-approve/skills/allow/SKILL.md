---
name: bash-smart-approve:allow
description: Add a bash command pattern to the bash-smart-approve allowlist. Use when the user says "always allow this", "stop asking me about that", "whitelist this pattern", or similar phrases after a Bash permission prompt.
---

# Allow a Bash Pattern

Edit the `bash-smart-approve` config to auto-approve a recently prompted (or user-supplied) command.

## Step 1 — Get the command

If `$ARGUMENTS` contains a command, use it. Otherwise ask the user:

> "Which exact command should I add to the allowlist? Paste it as-is."

## Step 2 — Analyze

Tokenize the command mentally the same way the hook does:
1. Split on `&&`, `||`, `;`, `|`. Strip subshells `$(...)` / backticks / `<(...)` and recurse into them.
2. Strip env-var prefixes (`FOO=bar CMD …` → the invoked binary is `CMD`).
3. For each segment, identify the invoked binary.
4. For `curl` / `wget` — extract the target domain(s) from http(s) URLs.
5. For `rm` — extract the target path(s).

Refuse to auto-allow shell interpreters (`bash`, `sh`, `zsh`, `python -c`, `node -e`, `sudo`, `xargs`, `env`, `eval`, `source`, `ssh`) — the hook hard-denies these and adding them is unsafe.

## Step 3 — Choose config scope

Ask the user:

> "Add to user-global config (applies everywhere) or project-level `.claude/bash-smart-approve.json` (committed with the repo, shared with teammates)?"

Locations:
- **User-global**: `$CLAUDE_PLUGIN_DATA/config.json` if the plugin is installed via marketplace, otherwise `~/.claude/bash-smart-approve.json`.
- **Project**: `<repo-root>/.claude/bash-smart-approve.json`.

## Step 4 — Propose the minimal diff

Show the user the *smallest* change that makes the command pass:

- Only a new binary? → add to `allowedBinaries`.
- Only a new curl/wget host? → add to `allowedCurlDomains` (glob-capable, e.g. `*.example.com`).
- Only a new `rm` path? → add to `allowedRmPaths` (glob-capable, e.g. `/tmp/**`).

Prefer narrow domains/paths over broad ones. Never propose `*` as a value.

## Step 5 — Apply

On approval, Edit the target config file. Create it (with the default JSON shape) if it doesn't exist yet. Preserve existing entries — merge, don't replace.

## Step 6 — Confirm

Tell the user what was added, and where. Config reload is automatic on the next hook invocation — no restart needed.

If the user's command contained constructs the hook will still refuse (shell interpreters, redirect-following `curl -L`, variable-indirected binary names), say so explicitly and suggest a safer restatement.
