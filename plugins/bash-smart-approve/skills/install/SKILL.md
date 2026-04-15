---
name: bash-smart-approve:install
description: One-shot installer for bash-smart-approve. Use when the user says "install bash-smart-approve", "set it up", "wire up the hook", "get me started", or after cloning the repo for the first time.
---

# Install bash-smart-approve

Wire the plugin into Claude Code settings, create an initial config, and (optionally) import existing permission rules.

## Step 1 — Preflight

Run `shfmt --version` via Bash.
- ✅ Installed → continue.
- ❌ Missing → tell the user the install command for their OS and **stop**:
  - macOS: `brew install shfmt`
  - Linux (Debian/Ubuntu): `sudo apt install shfmt`
  - Linux (Fedora): `sudo dnf install shfmt`
  - Windows: `scoop install shfmt` or `choco install shfmt`

Also confirm `node --version` ≥ 18.

## Step 2 — Locate the plugin & determine install mode

Resolve the plugin root directory and pick one of two install modes:

- **Marketplace install** — `$CLAUDE_PLUGIN_ROOT` is set (plugin came from `/plugin install`). The plugin's own `hooks/hooks.json` is auto-registered by Claude Code; **skip Step 3 entirely**. Verify `$CLAUDE_PLUGIN_ROOT/hooks/approve.js` exists, then continue at Step 4.
- **Local / manual install** — `$CLAUDE_PLUGIN_ROOT` is unset. Ask the user: "Where did you clone this repo?" Default suggestion: `~/dev/claude-code-bash-smart-approve`. Verify `hooks/approve.js` exists. Proceed to Step 3 to wire the hook manually.

## Step 3 — Wire the hook into ~/.claude/settings.json (manual install only)

**Skip this step if `$CLAUDE_PLUGIN_ROOT` was set in Step 2** — adding a second hook registration would fire the hook twice per Bash call.

Use the `update-config` skill (or direct Read + Edit) to add this hook to `~/.claude/settings.json`, **merging** with any existing `hooks.PreToolUse` array:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "node \"<plugin-root>/hooks/approve.js\"",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Use the absolute plugin path resolved in Step 2. On Windows, prefer forward slashes or `%USERPROFILE%` — both are accepted by Node.

**Check for duplicates**: if a hook already points at this `approve.js`, skip (don't add twice).

## Step 4 — Create starter config

Target path:
- If `$CLAUDE_PLUGIN_DATA` is set → `$CLAUDE_PLUGIN_DATA/config.json`
- Else → `~/.claude/bash-smart-approve.json`

If the file already exists, leave it alone. Otherwise copy `config.example.json` from the plugin root, then remove the placeholder `scopeDirectories` entry (user can add their own). Ask: "Any scope directories you want to add now? (empty = works everywhere)"

## Step 5 — Offer import

Ask the user:

> "Want me to scan your existing Claude Code settings (`~/.claude/settings.json` and `.claude/settings.local.json`) for `Bash(...)` allow rules and import them into the bash-smart-approve config?"

If yes → invoke `/bash-smart-approve:import`.

## Step 6 — Smoke test

Run a test invocation:

```sh
echo '{"tool_name":"Bash","tool_input":{"command":"git status"}}' | node "<plugin-root>/hooks/approve.js"
```

Expected output: JSON with `"permissionDecision":"allow"`. Show it to the user as proof the hook is wired.

## Step 7 — Summary

Tell the user:
- ✅ Hook registered (marketplace-auto OR wired into `~/.claude/settings.json` — state which)
- ✅ Config at `<path>`
- ⚠️ **Restart Claude Code or run `/hooks` once** — the settings watcher only picks up new hooks on reload.
- Point them at `/bash-smart-approve:status` for anytime health check and `/bash-smart-approve:list` to inspect config.

## Do not

- Do not overwrite an existing `bash-smart-approve.json` without asking.
- Do not add duplicate hooks to `PreToolUse`.
- Do not touch `permissions.allow` in settings.json during install — that's the `import` skill's job, with its own approval.
