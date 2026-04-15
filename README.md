# bash-smart-approve

**A Claude Code plugin that auto-approves Bash commands via an AST-based allowlist.**

## The problem, in plain English

Claude Code asks for permission every time it wants to run a terminal command. You can pre-approve simple ones like `git status` or `npm test`, but the moment Claude chains commands together — even totally safe things like `git diff && echo "---" && git log` — you get another prompt. Over a day of coding, that's hundreds of interruptions for commands you'd happily wave through.

This plugin reads what Claude is actually about to run, understands the pieces, and only auto-approves when *every single tool* in the command is one you've pre-approved. Anything else it stays out of the way — Claude Code's native permission system (your `settings.json` allow / deny / ask rules) still decides.

> ⚠️ **Alpha.** Works on Mac, Linux, and Windows. The hook is a *last layer*: it only ever upgrades a decision to `allow` for compound commands it fully understands. It never forces a prompt for a command you already allowed natively, and never silently broadens what you approve.

## The technical version

Claude Code's built-in `Bash(...)` permission rules do literal prefix matching, so compound commands like `FOO=bar curl ...`, `cd /repo && git status`, or `grep x | sed y | jq .` trigger a prompt even when every individual tool is safe. This plugin parses the command with [`shfmt`](https://github.com/mvdan/sh) into a shell AST, then auto-approves only when every invoked binary passes a configurable allowlist — with first-class handling for `curl` / `wget` domains and `rm` paths, and hard-denies for shell interpreters (`bash`, `sh`, `sudo`, `xargs`, `env`, inline-exec flags like `node -e`, etc.).

## What it handles

| Pattern | Before | After |
|---|---|---|
| `FOO=$(grep ...) curl https://api.github.com/...` | prompt | auto-allow (if `github.com` is listed) |
| `git diff && cd ../other && git diff` | prompt | auto-allow |
| `grep x file \| sed y \| jq .` | prompt | auto-allow |
| `bash -c "rm -rf /"` | prompt | hook declines to approve — native permission system decides |
| `curl -L https://x.com/...` | prompt | hook declines to approve (redirect risk) |
| `$CMD arg` (variable-indirected) | prompt | hook declines to approve |

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
- `<repo>/.claude/bash-smart-approve.json` — project-scoped, **off by default**; opt in globally by setting `allowProjectConfig: true` in your user config. Any repo you open would otherwise be able to widen your allowlist.

Config layers merge user → project (when enabled). Scalar fields override; array fields (`allowedBinaries`, `allowedCurlDomains`, `allowedRmPaths`, `trustedPathPrefixes`, `deniedPatterns`) are **unioned** — you can add entries in a later layer but not remove defaults. To shrink the effective allowlist, use `deniedPatterns`.

### Config schema

| Field | Type | Description |
|---|---|---|
| `enabled` | boolean | Master switch. `false` = disable entirely. |
| `scopeDirectories` | string[] | If non-empty, the hook only acts when `cwd` is inside one of these. Supports `~`, `$HOME`. |
| `allowedBinaries` | string[] | Binaries that may be auto-approved. Supports globs (e.g. `wunda-*`). |
| `allowedCurlDomains` | string[] | Hosts allowed for `curl` / `wget`. Supports globs (e.g. `*.atlassian.net`). |
| `allowedRmPaths` | string[] | Paths allowed for `rm` / `rmdir`. Supports `**` (e.g. `/tmp/**`). |
| `trustedPathPrefixes` | string[] | Directory prefixes whose executables are auto-approved as direct script invocations. Matched at path-segment boundaries — `~/foo/` does not match `~/foo-bar/`. Default: `~/.claude/plugins/` only. |
| `deniedPatterns` | string[] | Regex patterns — matching commands are pass-through (hook declines to approve). |
| `logFile` | string | Audit log path. Supports `~`, `$HOME`. |
| `logDecisions` | string[] | Which decisions to log. Default `["allow", "ask"]`. |
| `maxLogBytes` | number | Rotate `logFile` → `logFile.1` when it reaches this size. `0` disables rotation. Default 10 MB. |
| `allowProjectConfig` | boolean | Load `<cwd>/.claude/bash-smart-approve.json`. Off by default. |

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

- **`curl`/`wget` with `-L` / `--location`** is not auto-approved — HTTP redirects can bypass a domain allowlist (301 → attacker.com).
- **Variable-indirected binary names** (`$CMD arg`) are not auto-approved — the hook can't verify what `$CMD` expands to.
- **`rm` path arguments are compared literally** — shell glob expansion happens after the hook sees them, so `rm -rf ~/$VAR` fails the allowlist (good).
- **Claude Code's `deny` rules in `settings.json` evaluate before a hook `allow`** — a native `deny Bash(rm:*)` still blocks even if the hook would have approved. Use native deny rules as your hard floor.
- **`git` and `npm` are effectively interpreters**. `git -c core.pager="sh -c …"`, `git -c alias.x="!…"`, and `npm run <any-script>` execute arbitrary code despite the binary name looking safe. If that matters, add `deniedPatterns` entries like `^git\\s+-c\\s+(core\\.editor|core\\.pager|alias\\.|core\\.sshCommand)` or `^npm\\s+run(\\s|$)`.

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
2. Check `BASH_SMART_APPROVE_DISABLE` env var and `enabled` config flag → pass through if off.
3. Check `cwd` against `scopeDirectories` → pass through if outside.
4. Run `shfmt -tojson` → get shell AST. Parse failure → pass through.
5. Walk AST, collect every `CallExpr` (command invocation), descending into `$(...)`, `<(...)`, backticks, pipes, `&&`, `||`, `;`, blocks, subshells.
6. For each invocation:
   - Reject (don't approve) if the binary is a shell/interpreter.
   - Reject if it's an interpreter invoked with an inline-exec flag.
   - Reject if the binary name contains variable/subshell expansion.
   - Apply `deniedPatterns` regex.
   - `curl` / `wget` → require explicit http(s) URL, reject `-L`, check host against `allowedCurlDomains`.
   - `rm` / `rmdir` → check every non-flag argument against `allowedRmPaths`.
   - Otherwise → require the binary to match `allowedBinaries`.
7. All invocations pass → emit `permissionDecision: "allow"`. Any failure → pass through (no decision emitted; native permission system decides).

## Contributing

Bug reports and PRs welcome. Please attach a minimal bash command that demonstrates the parser issue.

## License

MIT © [Christjan Schumann](https://github.com/pr3m)
