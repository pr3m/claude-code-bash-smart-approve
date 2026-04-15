# bash-smart-approve

**A Claude Code plugin that auto-approves Bash commands via an AST-based allowlist.**

Claude Code's built-in `Bash(...)` permission rules do literal prefix matching, so compound commands like `FOO=bar curl ...`, `cd /repo && git status`, or `grep x | sed y | jq .` trigger a prompt even when every individual tool is safe. This plugin parses the command with `shfmt` and auto-approves only when *every* invoked binary passes a configurable allowlist — with first-class handling for `curl`/`wget` domains and `rm` paths.

> ⚠️ **Alpha.** Works on Mac, Linux, and Windows. Designed to fail **closed to "ask"** (the normal permission prompt) on any uncertainty — never silently broadens what you approve.

## What it handles

| Pattern | Before | After |
|---|---|---|
| `FOO=$(grep ...) curl https://api.github.com/...` | prompt | auto-allow (if `github.com` is listed) |
| `git diff && cd ../other && git diff` | prompt | auto-allow |
| `grep x file \| sed y \| jq .` | prompt | auto-allow |
| `bash -c "rm -rf /"` | prompt | **never auto-approved** (hard-deny) |
| `curl -L https://x.com/...` | prompt | **never auto-approved** (redirect risk) |
| `$CMD arg` (variable-indirected) | prompt | **never auto-approved** |

## Requirements

- [Node.js](https://nodejs.org) 18+ (bundled with Claude Code on most installs)
- [shfmt](https://github.com/mvdan/sh) in `PATH` — the parser
  - **macOS**: `brew install shfmt`
  - **Linux**: `apt install shfmt` / `dnf install shfmt` / download [release binary](https://github.com/mvdan/sh/releases)
  - **Windows**: `scoop install shfmt` or `choco install shfmt`

The hook falls through to the normal permission prompt if `shfmt` is missing.

## Install

### Via Claude Code plugin marketplace (recommended)

```
/plugin marketplace add pr3m/claude-code-bash-smart-approve
/plugin install bash-smart-approve@bash-smart-approve-marketplace
/bash-smart-approve:install
```

The third step runs the bundled installer — it checks `shfmt`, wires the hook, creates your config, and offers to import existing `Bash(...)` rules from your Claude Code settings.

### Manual

```sh
git clone https://github.com/pr3m/claude-code-bash-smart-approve ~/dev/claude-code-bash-smart-approve
```

Then run `/bash-smart-approve:install` (the skill is auto-discovered from the cloned repo once you add it to your plugins dir) — or wire the hook by hand:

```json
{
  "hooks": {
    "PreToolUse": [{
      "matcher": "Bash",
      "hooks": [{
        "type": "command",
        "command": "node \"$HOME/dev/claude-code-bash-smart-approve/hooks/approve.js\"",
        "timeout": 5
      }]
    }]
  }
}
```

On Windows PowerShell, replace `$HOME` with `$env:USERPROFILE` or use a full path.

**Restart Claude Code or run `/hooks` once** after wiring — the settings watcher only picks up new hooks on reload.

## Configuration

Copy `config.example.json` to one of:

- `$CLAUDE_PLUGIN_DATA/config.json` — set automatically when installed via marketplace; survives plugin upgrades
- `~/.claude/bash-smart-approve.json` — user-global fallback
- `<repo>/.claude/bash-smart-approve.json` — project-scoped, merges on top of user config (commit this to share with teammates)

### Config schema

| Field | Type | Description |
|---|---|---|
| `enabled` | boolean | Master switch. `false` = disable entirely. |
| `scopeDirectories` | string[] | If non-empty, the hook only acts when `cwd` is inside one of these. Supports `~`. |
| `allowedBinaries` | string[] | Binaries that may be auto-approved. Supports globs (e.g. `wunda-*`). |
| `allowedCurlDomains` | string[] | Hosts allowed for `curl` / `wget`. Supports globs (e.g. `*.atlassian.net`). |
| `allowedRmPaths` | string[] | Paths allowed for `rm` / `rmdir`. Supports `**` (e.g. `/tmp/**`). |
| `deniedPatterns` | string[] | Regex patterns — matching commands are always sent to the normal prompt. |
| `logFile` | string | Audit log path. Supports `~`. |
| `logDecisions` | string[] | Which decisions to log. Default `["allow", "ask"]`. |

### Hard-denied, unconditionally

The following binaries are **never** auto-approved — adding them to `allowedBinaries` has no effect:

```
bash sh zsh dash fish csh tcsh ksh ash pwsh powershell
sudo doas su runas
eval source .
xargs env exec
```

Interpreters with inline-code-execution flags are also rejected:
- `python / python3 / python2 / py -c …`
- `node -e / --eval / -p / --print …`
- `deno eval …`, `bun -e …`, `perl -e / -E …`, `ruby -e …`, `php -r …`

These categories exist specifically to bypass allowlist analysis, so the hook won't green-light them no matter what the config says.

### Security notes

- **`curl`/`wget` with `-L` / `--location`** is always rejected — HTTP redirects can bypass a domain allowlist (301 → attacker.com).
- **Variable-indirected binary names** (`$CMD arg`) are rejected — the hook can't verify what `$CMD` expands to.
- **`rm` path arguments are compared literally** — shell glob expansion happens after the hook sees them, so `rm -rf ~/$VAR` fails the allowlist (good).
- **Settings.json `deny`/`ask` rules always win** over the hook's `allow`. Use your existing deny rules as a hard floor.

## Kill switch

Temporarily disable without editing config:

```sh
BASH_SMART_APPROVE_DISABLE=1 claude
```

## Bundled skills

All are invocable by slash command *and* via natural language.

| Skill | Purpose | Example phrases |
|---|---|---|
| `/bash-smart-approve:install` | One-shot setup — checks `shfmt`, wires the hook, creates config, offers import | "install bash-smart-approve", "set it up" |
| `/bash-smart-approve:import` | Parse existing `Bash(...)` rules from `settings.json` → allowlist config; offer to remove now-redundant rules | "import my existing rules", "migrate my allowlist" |
| `/bash-smart-approve:list` | Show the effective merged config with source annotations | "show bsa config", "what's allowed" |
| `/bash-smart-approve:allow <command>` | Add a minimal allowlist entry derived from a pasted command | "always allow this", "stop asking me about X" |
| `/bash-smart-approve:remove <item>` | Remove a binary / domain / path from the allowlist | "drop X from the allowlist" |
| `/bash-smart-approve:status` | Health check — deps, hook wiring, enabled state, recent activity | "is bsa working", "bash-smart-approve status" |
| `/bash-smart-approve:review-log` | Summarize recent auto-approval / prompt decisions from the audit log | "show recent approvals", "audit the log" |
| `/bash-smart-approve:test` | Smoke test — run 8 synthetic cases through the hook and verify decisions | "test bash-smart-approve", "smoke test" |
| `/bash-smart-approve:uninstall` | Cleanly remove the hook and (optionally) config + log | "uninstall bash-smart-approve" |

## How it decides

1. Read hook input from stdin → extract `tool_input.command`.
2. Check `BASH_SMART_APPROVE_DISABLE` env var and `enabled` config flag → ask if off.
3. Check `cwd` against `scopeDirectories` → ask if outside.
4. Run `shfmt -tojson` → get shell AST. Parse failure → ask.
5. Walk AST, collect every `CallExpr` (command invocation), descending into `$(...)`, `<(...)`, backticks, pipes, `&&`, `||`, `;`, blocks, subshells.
6. For each invocation:
   - Reject if the binary is a shell/interpreter.
   - Reject if it's an interpreter invoked with an inline-exec flag.
   - Reject if the binary name contains variable/subshell expansion.
   - Apply `deniedPatterns` regex.
   - `curl` / `wget` → require explicit http(s) URL, reject `-L`, check host against `allowedCurlDomains`.
   - `rm` / `rmdir` → check every non-flag argument against `allowedRmPaths`.
   - Otherwise → require the binary to match `allowedBinaries`.
7. All invocations pass → emit `permissionDecision: "allow"`. Any failure → `"ask"` (normal prompt).

## Contributing

Bug reports and PRs welcome. Please attach a minimal bash command that demonstrates the parser issue.

## License

MIT © [Christjan Schumann](https://github.com/pr3m)
