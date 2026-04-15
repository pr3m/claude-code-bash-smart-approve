---
name: bash-smart-approve:test
description: Run a self-test — pipe synthetic bash commands through the hook and verify each returns the expected decision. Use when user says "test bash-smart-approve", "is the hook working", "run a smoke test", "/bash-smart-approve:test".
---

# Self-Test

Validate that the hook logic is working by running a fixed set of synthetic inputs through `approve.js` and checking the decisions match expectations. This does NOT execute any real bash — just exercises the hook.

## Step 1 — Locate the hook

Resolve `$CLAUDE_PLUGIN_ROOT/hooks/approve.js`. If `$CLAUDE_PLUGIN_ROOT` is not set, fall back to `~/dev/claude-code-bash-smart-approve/hooks/approve.js` and ask the user to confirm the path if it doesn't exist.

## Step 2 — Run the test cases

For each case below, pipe the JSON into the hook via Bash and parse the resulting `permissionDecision`.

```sh
echo '<JSON>' | node "<plugin-root>/hooks/approve.js"
```

### Cases (expected decisions)

| # | Command | Expect | Why it matters |
|---|---|---|---|
| 1 | `git diff --stat HEAD && echo "---" && git log --oneline -3` | `allow` | Compound `&&` with two well-known binaries |
| 2 | `ls /tmp \| head -5 \| sort` | `allow` | Pipe chain |
| 3 | `FOO=$(date +%s) && echo "tick $FOO"` | `allow` | Env-var prefix + subshell + compound |
| 4 | `bash -c 'rm -rf /'` | `ask` | Hard-deny: shell interpreter |
| 5 | `curl -L https://api.github.com/zen` | `ask` | `-L` redirect-following rejected |
| 6 | `$CMD arg` | `ask` | Variable-indirected binary name |
| 7 | `node -e "console.log(1)"` | `ask` | Inline-exec flag rejected |
| 8 | `obscuretool --flag` | `ask` | Unknown binary |

### Sample invocations

```sh
echo '{"tool_name":"Bash","tool_input":{"command":"git diff --stat HEAD && echo \"---\" && git log --oneline -3"}}' \
  | node "$CLAUDE_PLUGIN_ROOT/hooks/approve.js"

echo '{"tool_name":"Bash","tool_input":{"command":"ls /tmp | head -5 | sort"}}' \
  | node "$CLAUDE_PLUGIN_ROOT/hooks/approve.js"

echo '{"tool_name":"Bash","tool_input":{"command":"FOO=$(date +%s) && echo \"tick $FOO\""}}' \
  | node "$CLAUDE_PLUGIN_ROOT/hooks/approve.js"

echo '{"tool_name":"Bash","tool_input":{"command":"bash -c '\''rm -rf /'\''"}}' \
  | node "$CLAUDE_PLUGIN_ROOT/hooks/approve.js"

echo '{"tool_name":"Bash","tool_input":{"command":"curl -L https://api.github.com/zen"}}' \
  | node "$CLAUDE_PLUGIN_ROOT/hooks/approve.js"

echo '{"tool_name":"Bash","tool_input":{"command":"$CMD arg"}}' \
  | node "$CLAUDE_PLUGIN_ROOT/hooks/approve.js"

echo '{"tool_name":"Bash","tool_input":{"command":"node -e \"console.log(1)\""}}' \
  | node "$CLAUDE_PLUGIN_ROOT/hooks/approve.js"

echo '{"tool_name":"Bash","tool_input":{"command":"obscuretool --flag"}}' \
  | node "$CLAUDE_PLUGIN_ROOT/hooks/approve.js"
```

## Step 3 — Render the report

```
bash-smart-approve self-test

 ✅ 1. compound git && echo && git       →  allow
 ✅ 2. ls | head | sort                  →  allow
 ✅ 3. FOO=$(date) && echo               →  allow
 ✅ 4. bash -c 'rm -rf /'                →  ask   (hard-deny)
 ✅ 5. curl -L ...                       →  ask   (redirect risk)
 ✅ 6. $CMD arg                          →  ask   (variable-indirected)
 ✅ 7. node -e "..."                     →  ask   (inline-exec)
 ✅ 8. obscuretool --flag                →  ask   (unknown binary)

8/8 passed — hook logic is healthy.
```

Use ❌ for any mismatch and show the actual decision + reason.

## Step 4 — Harness-wiring check (separate from hook logic)

The above proves the hook *logic* works. To verify Claude Code is actually *invoking* the hook on real Bash tool calls, tell the user:

> "Now try running a real compound bash command in this session — e.g. `ls /tmp | head -3`. If no permission prompt appears, the harness is wired correctly. If a prompt appears, run `/hooks` (or restart Claude Code) to reload settings."

This second check can't be automated from inside a skill because the skill itself runs via tool calls that may or may not trigger the hook depending on settings state.

## Step 5 — On failure

If any case fails:
- **`shfmt not installed`** in reason → tell user how to install it per their OS (see README).
- **Parse failure** on an expected-allow case → flag as a parser bug, ask user to file an issue with the command.
- **Unexpected `ask` on an allow case** → check if `allowedBinaries` is customized in user/project config and missing a default. Suggest `/bash-smart-approve:list` to inspect.
- **Unexpected `allow` on an ask case** → this is a security concern. Tell user to run `BASH_SMART_APPROVE_DISABLE=1` and file a bug report immediately.
