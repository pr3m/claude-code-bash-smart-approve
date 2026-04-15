#!/usr/bin/env node
/*
 * bash-smart-approve — PreToolUse hook for Claude Code Bash tool.
 *
 * Reads the hook input JSON on stdin, parses the bash command via shfmt's AST,
 * and auto-approves (permissionDecision: "allow") only if every invoked binary
 * passes the allowlist. Falls through to "ask" on any uncertainty.
 *
 * Cross-platform: Mac, Linux, Windows (requires Node.js + shfmt in PATH).
 */

'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function emit(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: reason,
    },
  }));
  process.exit(0);
}

const ask = (r) => emit('ask', r);
const allow = (r) => emit('allow', r);
const deny = (r) => emit('deny', r);

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Hard-denied binaries — these can never be auto-approved. Including them in
// the user allowlist has no effect. Shell interpreters + privilege escalators +
// tools whose primary purpose is to evade allowlist analysis.
const HARD_DENY_BINARIES = new Set([
  'bash', 'sh', 'zsh', 'dash', 'fish', 'csh', 'tcsh', 'ksh', 'ash', 'pwsh', 'powershell',
  'sudo', 'doas', 'su', 'runas',
  'eval', 'source', '.',
  'xargs', 'env',
  'exec',
]);

// Binaries dangerous only with inline-code-execution flags.
const INLINE_EXEC_FLAGS = {
  python: ['-c'],
  python2: ['-c'],
  python3: ['-c'],
  py: ['-c'],
  node: ['-e', '--eval', '-p', '--print'],
  deno: ['eval'],
  bun: ['-e'],
  perl: ['-e', '-E'],
  ruby: ['-e'],
  php: ['-r'],
};

const DEFAULT_CONFIG = {
  enabled: true,
  scopeDirectories: [],
  allowedBinaries: [
    'ls', 'cat', 'head', 'tail', 'wc', 'file', 'stat', 'tree',
    'grep', 'egrep', 'fgrep', 'rg', 'sed', 'awk', 'cut', 'sort', 'uniq', 'tr', 'tee',
    'jq', 'yq',
    'echo', 'printf', 'true', 'false', 'date', 'pwd', 'basename', 'dirname',
    'mkdir', 'touch', 'ln', 'readlink', 'realpath',
    'cd', 'test',
    'base64', 'md5sum', 'sha1sum', 'sha256sum', 'shasum', 'xxd', 'od',
    'diff', 'patch', 'cmp',
    'tar', 'gzip', 'gunzip', 'zip', 'unzip',
    'git',
    'node', 'npm', 'npx', 'pnpm', 'yarn',
    'make',
  ],
  allowedCurlDomains: [],
  allowedRmPaths: [],
  deniedPatterns: [],
  logFile: path.join(os.homedir(), '.claude', 'bash-smart-approve.log'),
  logDecisions: ['allow', 'ask'],
};

function expandPath(p) {
  if (typeof p !== 'string') return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function mergeConfig(base, over) {
  if (!over || typeof over !== 'object') return base;
  for (const k of Object.keys(over)) {
    if (Array.isArray(base[k]) && Array.isArray(over[k])) {
      base[k] = Array.from(new Set([...base[k], ...over[k]]));
    } else {
      base[k] = over[k];
    }
  }
  return base;
}

function tryReadJson(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function loadConfig() {
  const cfg = JSON.parse(JSON.stringify(DEFAULT_CONFIG));

  const userPath = process.env.CLAUDE_PLUGIN_DATA
    ? path.join(process.env.CLAUDE_PLUGIN_DATA, 'config.json')
    : path.join(os.homedir(), '.claude', 'bash-smart-approve.json');
  mergeConfig(cfg, tryReadJson(userPath));

  const projectPath = path.join(process.cwd(), '.claude', 'bash-smart-approve.json');
  mergeConfig(cfg, tryReadJson(projectPath));

  if (typeof cfg.logFile === 'string') cfg.logFile = expandPath(cfg.logFile);
  cfg.scopeDirectories = (cfg.scopeDirectories || []).map(expandPath);

  return cfg;
}

// ---------------------------------------------------------------------------
// Matchers
// ---------------------------------------------------------------------------

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = escaped
    .replace(/\*\*/g, '\u0000')   // ** placeholder
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/\u0000/g, '.*');
  return new RegExp('^' + body + '$');
}

function anyGlob(patterns, value) {
  if (!Array.isArray(patterns)) return false;
  return patterns.some((p) => {
    try { return globToRegExp(p).test(value); }
    catch (_) { return false; }
  });
}

function inScope(cwd, scopes) {
  if (!scopes || scopes.length === 0) return true;
  const resolvedCwd = path.resolve(cwd);
  return scopes.some((s) => {
    const r = path.resolve(s);
    return resolvedCwd === r || resolvedCwd.startsWith(r + path.sep);
  });
}

// ---------------------------------------------------------------------------
// Parsing via shfmt
// ---------------------------------------------------------------------------

function shfmtAvailable() {
  try {
    execFileSync('shfmt', ['--version'], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false;
  }
}

function parseWithShfmt(command) {
  try {
    const out = execFileSync('shfmt', ['-tojson'], {
      input: command,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 2000,
    });
    return { ok: true, ast: JSON.parse(out) };
  } catch (e) {
    return { ok: false, error: (e && e.message) || String(e) };
  }
}

// ---------------------------------------------------------------------------
// AST walking — extract CallExpr invocations
// ---------------------------------------------------------------------------

function wordToLiteral(word) {
  // Convert a shfmt Word node to a best-effort literal string.
  // Returns { text, hasSubshell, hasParamExp }.
  if (!word || !Array.isArray(word.Parts)) return { text: '', hasSubshell: false, hasParamExp: false };
  let text = '';
  let hasSubshell = false;
  let hasParamExp = false;
  for (const part of word.Parts) {
    switch (part.Type) {
      case 'Lit':
        text += part.Value || '';
        break;
      case 'SglQuoted':
        text += part.Value || '';
        break;
      case 'DblQuoted':
        for (const inner of (part.Parts || [])) {
          if (inner.Type === 'Lit') text += inner.Value || '';
          else if (inner.Type === 'ParamExp') { hasParamExp = true; text += '${?}'; }
          else if (inner.Type === 'CmdSubst') { hasSubshell = true; text += '$(...)'; }
          else hasParamExp = true;
        }
        break;
      case 'ParamExp':
        hasParamExp = true;
        text += '${?}';
        break;
      case 'CmdSubst':
        hasSubshell = true;
        text += '$(...)';
        break;
      default:
        hasParamExp = true;
    }
  }
  return { text, hasSubshell, hasParamExp };
}

function extractInvocations(node, out, flags) {
  if (!node || typeof node !== 'object') return;

  const t = node.Type;

  // A simple command: shfmt represents this as a CallExpr
  if (t === 'CallExpr') {
    const args = (node.Args || []).map(wordToLiteral);
    if (args.length > 0) {
      out.push({
        argvText: args.map((a) => a.text),
        argvFlags: args,
      });
    }
    // Even in a simple command there may be $() in args or assigns — recurse to find nested invocations
    for (const k of Object.keys(node)) {
      const v = node[k];
      if (k === 'Args' || k === 'Assigns') {
        if (Array.isArray(v)) v.forEach((c) => extractInvocations(c, out, flags));
      }
    }
    return;
  }

  // Unsupported constructs — fall through to ask
  if (t === 'FuncDecl') {
    flags.unsupported = 'function definition';
    return;
  }

  // Command substitutions / process substitutions add nested commands
  if (t === 'CmdSubst' || t === 'ProcSubst') {
    flags.hasSubshell = true;
  }

  // Generic recursion — any child node, array or object
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => extractInvocations(c, out, flags));
    else if (v && typeof v === 'object') extractInvocations(v, out, flags);
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

function basenameOf(arg) {
  // Strip directory and common Windows `.exe` suffix so aliases like
  // `/usr/bin/git` and `git.exe` normalize to `git`.
  let b = path.basename(arg);
  if (b.toLowerCase().endsWith('.exe')) b = b.slice(0, -4);
  return b;
}

function classifyInvocation(inv, cfg) {
  const argv = inv.argvText;
  if (!argv || argv.length === 0) return { ok: true, reason: 'empty' };

  const firstFlags = inv.argvFlags[0];
  if (firstFlags.hasSubshell || firstFlags.hasParamExp) {
    return { ok: false, reason: `binary name comes from variable/subshell: ${argv[0]}` };
  }

  const bin = basenameOf(argv[0]);

  if (HARD_DENY_BINARIES.has(bin)) {
    return { ok: false, reason: `'${bin}' is a shell/interpreter — never auto-approved` };
  }

  if (INLINE_EXEC_FLAGS[bin]) {
    const danger = INLINE_EXEC_FLAGS[bin];
    if (argv.slice(1).some((a) => danger.includes(a))) {
      return { ok: false, reason: `'${bin}' with inline-exec flag not auto-approved` };
    }
  }

  const joined = argv.join(' ');
  for (const pat of (cfg.deniedPatterns || [])) {
    try {
      if (new RegExp(pat).test(joined)) {
        return { ok: false, reason: `matches deniedPatterns /${pat}/` };
      }
    } catch (_) { /* ignore invalid regex */ }
  }

  if (bin === 'curl' || bin === 'wget') {
    return classifyHttpFetch(bin, argv, cfg);
  }

  if (bin === 'rm' || bin === 'rmdir') {
    return classifyRm(bin, argv, cfg);
  }

  if (anyGlob(cfg.allowedBinaries || [], bin)) {
    return { ok: true, reason: `'${bin}' matches allowedBinaries` };
  }

  return { ok: false, reason: `'${bin}' not in allowedBinaries` };
}

function classifyHttpFetch(bin, argv, cfg) {
  const rest = argv.slice(1);

  // Reject redirect-following flags (exfil risk).
  if (rest.some((a) => a === '-L' || a === '--location')) {
    return { ok: false, reason: `${bin} with -L/--location not auto-approved (redirect risk)` };
  }

  const urls = rest.filter((a) => /^https?:\/\//i.test(a));
  if (urls.length === 0) {
    return { ok: false, reason: `${bin} without explicit http(s) URL not auto-approved` };
  }

  for (const u of urls) {
    let host;
    try { host = new URL(u).hostname; }
    catch (_) { return { ok: false, reason: `${bin}: invalid URL ${u}` }; }
    if (!anyGlob(cfg.allowedCurlDomains || [], host)) {
      return { ok: false, reason: `${bin}: host '${host}' not in allowedCurlDomains` };
    }
  }
  return { ok: true, reason: `${bin} to allowed domain(s)` };
}

function classifyRm(bin, argv, cfg) {
  const rest = argv.slice(1);
  const targets = rest.filter((a) => !a.startsWith('-'));
  if (targets.length === 0) return { ok: false, reason: `${bin} without targets` };
  for (const p of targets) {
    if (!anyGlob(cfg.allowedRmPaths || [], p)) {
      return { ok: false, reason: `${bin}: path '${p}' not in allowedRmPaths` };
    }
  }
  return { ok: true, reason: `${bin} to allowed path(s)` };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function logDecision(cfg, decision, command, reason) {
  if (!cfg.logFile || !(cfg.logDecisions || []).includes(decision)) return;
  try {
    fs.mkdirSync(path.dirname(cfg.logFile), { recursive: true });
    fs.appendFileSync(cfg.logFile, JSON.stringify({
      ts: new Date().toISOString(),
      cwd: process.cwd(),
      decision,
      reason,
      command,
    }) + '\n');
  } catch (_) { /* non-fatal */ }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); }
  catch (_) { return ''; }
}

function main() {
  if (process.env.BASH_SMART_APPROVE_DISABLE === '1') {
    ask('disabled via BASH_SMART_APPROVE_DISABLE env var');
  }

  const cfg = loadConfig();
  if (!cfg.enabled) ask('disabled via config (enabled=false)');

  const raw = readStdin();
  if (!raw) ask('no stdin to hook');

  let input;
  try { input = JSON.parse(raw); }
  catch (_) { ask('hook stdin is not JSON'); }

  const command = input && input.tool_input && input.tool_input.command;
  if (typeof command !== 'string' || command.length === 0) ask('no command to evaluate');

  if (!inScope(process.cwd(), cfg.scopeDirectories)) {
    ask('cwd outside scopeDirectories');
  }

  if (!shfmtAvailable()) {
    ask('shfmt not installed — see plugin README for install instructions');
  }

  const parsed = parseWithShfmt(command);
  if (!parsed.ok) {
    logDecision(cfg, 'ask', command, 'parse failure');
    ask('shfmt parse failure — manual approval required');
  }

  const invocations = [];
  const flags = {};
  extractInvocations(parsed.ast, invocations, flags);

  if (flags.unsupported) {
    logDecision(cfg, 'ask', command, `unsupported: ${flags.unsupported}`);
    ask(`unsupported construct (${flags.unsupported}) — manual approval`);
  }

  if (invocations.length === 0) {
    logDecision(cfg, 'ask', command, 'no invocations found');
    ask('no binary invocations extracted');
  }

  const reasons = [];
  for (const inv of invocations) {
    const r = classifyInvocation(inv, cfg);
    if (!r.ok) {
      logDecision(cfg, 'ask', command, r.reason);
      const seg = (inv.argvText || []).slice(0, 3).join(' ');
      ask(`${r.reason} (in: ${seg})`);
    }
    reasons.push(r.reason);
  }

  const summary = reasons.slice(0, 3).join(' | ') + (reasons.length > 3 ? ` (+${reasons.length - 3} more)` : '');
  logDecision(cfg, 'allow', command, summary);
  allow(summary);
}

try { main(); }
catch (e) {
  // Anything unexpected: fall through to the normal permission prompt.
  try { ask('internal error: ' + (e && e.message ? e.message : String(e)).slice(0, 120)); }
  catch (_) { process.exit(0); }
}
