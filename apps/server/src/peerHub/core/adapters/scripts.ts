// @effect-diagnostics nodeBuiltinImport:off - Codex's hashes of hooks, as it computes them.
/**
 * The scripts Peer writes for agents (the hook their harness runs, its wake-up wait and the `peer`
 * shim) and the hook settings that point Claude Code and Codex at them: Peer's hooks among a
 * person's own, Codex's trust in them, and agents' access to their working contexts.
 *
 * @module peerHub/core/adapters/scripts
 */
import * as NodeCrypto from "node:crypto";

import { cliScript } from "./cliScript.ts";

/**
 * The scripts Peer writes for agents: the hook their harness runs, its wake-up wait, and `peer`,
 * which waits 15 s for Peer's answer, or as long as `waits` says for a command. With `launch`
 * (`coreLaunchCommand`), `peer mcp` starts Peer Core when no broker runs.
 */
export function coordinationScripts(
  socket: string,
  binDir: string,
  waits: ReadonlyArray<readonly [command: string, seconds: number]> = [],
  launch: ReadonlyArray<string> | null = null,
): {
  readonly hook: string;
  readonly wait: string;
  readonly peer: string;
} {
  const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
  const quoted = quote(socket);
  // Claude Code sessions learn PEER_SESSION when they start; Codex gives its commands their thread.
  const headers = `-H "X-Herdr-Pane: \${HERDR_PANE_ID:-}" -H "X-Peer-Session: \${PEER_SESSION:-\${CODEX_THREAD_ID:-}}"`;
  return {
    hook: `#!/bin/sh
# Peer coordination: hands an agent's hook event to Peer and prints its answer. The argument
# names the agent (codex); without one it is Claude Code. Prints nothing and lets the agent go
# on when Peer is not running.
agent="\${1:-claude}"
input=$(cat)
event=$(printf '%s' "$input" | sed -n 's/.*"hook_event_name"[[:space:]]*:[[:space:]]*"\\([^" ]*\\)".*/\\1/p' | head -n 1)
max_time=4
if [ "$agent" = codex ]; then
  case "$event" in SessionEnd|Interrupt) max_time=2.5 ;; esac
fi
# Peer's own runs of an agent (kontext wording knowledge, say) are no agents at work.
[ "\${PEER_COORDINATION:-}" = off ] && exit 0
# SessionStart exports reach Bash commands, not subsequent settings hooks.
set --
if [ -n "\${CLAUDE_ENV_FILE:-}" ] && [ "$agent" = claude ]; then
  sid=$(printf '%s' "$input" | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\\([^" ]*\\)".*/\\1/p' | head -n 1)
  source=$(printf '%s' "$input" | sed -n 's/.*"source"[[:space:]]*:[[:space:]]*"\\([^" ]*\\)".*/\\1/p' | head -n 1)
  # A new run of the session starts this file afresh: a resumed session keeps no token of the
  # run before it, which Bash would otherwise still source.
  [ "$event" = SessionStart ] && [ "$source" != compact ] && : > "$CLAUDE_ENV_FILE"
  printf 'export PATH=%s:"$PATH"\\n' ${quote(quote(binDir))} >> "$CLAUDE_ENV_FILE"
  [ -n "$sid" ] && printf 'export PEER_SESSION=%s\\n' "$sid" >> "$CLAUDE_ENV_FILE"
  if [ "$event" = SessionStart ] && [ "$source" != compact ]; then
    token=$(od -An -N16 -tx1 /dev/urandom | tr -d ' \\n')
    if [ \${#token} -eq 32 ]; then
      # Bash sources this file over the process environment. A live Claude Mod in the same
      # session (PEER_MOD_SESSION) owns the token Peer checks, so its shell keeps the Mod's.
      printf '[ -n "\${PEER_MOD_SESSION:-}" ] && [ "$PEER_MOD_SESSION" = "%s" ] || export PEER_SESSION_TOKEN=%s\\n' "$sid" "$token" >> "$CLAUDE_ENV_FILE"
      umask 077
      credential=$(mktemp "\${TMPDIR:-/tmp}/peer-hook.XXXXXX" 2>/dev/null) || exit 0
      trap 'rm -f "$credential"' 0
      printf 'X-Peer-Session-Token: %s\\n' "$token" > "$credential"
      set -- -H "@$credential"
    fi
  fi
fi
printf '%s' "$input" | curl -sf --max-time "$max_time" --unix-socket ${quoted} ${headers} "$@" -H "X-Peer-Agent: $agent" -H 'Content-Type: application/json' --data-binary @- http://peer/hook 2>/dev/null
exit 0
`,
    wait: `#!/bin/sh
# Peer coordination: while the agent is idle, waits for a note from another agent and wakes it.
agent="\${1:-claude}"
[ "\${PEER_COORDINATION:-}" = off ] && { cat >/dev/null; exit 0; }
out=$(curl -sf --max-time 1800 --unix-socket ${quoted} ${headers} -H "X-Peer-Agent: $agent" -H 'Content-Type: application/json' --data-binary @- http://peer/hook/wait 2>/dev/null) || exit 0
[ -n "$out" ] || exit 0
printf '%s\\n' "$out" >&2
exit 2
`,
    peer: cliScript(socket, waits, launch),
  };
}

export interface HookEntry {
  readonly [field: string]: unknown;
  readonly command?: unknown;
}
export interface HookGroup {
  readonly matcher?: unknown;
  readonly hooks?: ReadonlyArray<HookEntry>;
}
export type Settings = Record<string, unknown> & {
  hooks?: Record<string, ReadonlyArray<HookGroup>>;
};

export function hookCommand(path: string): string {
  return /^[A-Za-z0-9_./-]+$/.test(path) ? path : `'${path.replaceAll("'", "'\\''")}'`;
}

/** Claude Code's tools that edit files or run commands. */
const CLAUDE_EDITS = "Edit|Write|MultiEdit|NotebookEdit|Bash";
/**
 * kontext's capture tool as Claude Code names it: its MCP server registers as `kontext`. Only this
 * one of kontext's tools, so no other call costs a hook.
 */
export const KONTEXT_CAPTURE = "mcp__kontext__ctx_capture";

/** The hook groups Claude Code needs for coordination, pointing at Peer's scripts. */
export function claudeHookGroups(scripts: {
  readonly hook: string;
  readonly wait: string;
}): Record<string, ReadonlyArray<HookGroup>> {
  const hook = { type: "command", command: hookCommand(scripts.hook), timeout: 5 };
  return {
    SessionStart: [{ hooks: [hook] }],
    UserPromptSubmit: [{ hooks: [hook] }],
    PreToolUse: [{ matcher: CLAUDE_EDITS, hooks: [hook] }],
    // Bash too: agents edit with sed and friends, which Peer then reads from git. And kontext's
    // capture, whose learning or decision without a check Peer asks about (knowledge plugin).
    PostToolUse: [{ matcher: `${CLAUDE_EDITS}|${KONTEXT_CAPTURE}`, hooks: [hook] }],
    // A step that ends in an error, a command that exits non-zero among them, gets no PostToolUse.
    PostToolUseFailure: [{ matcher: CLAUDE_EDITS, hooks: [hook] }],
    // A permission prompt: the agent waits for its person, it does not work.
    Notification: [{ hooks: [hook] }],
    PreCompact: [{ hooks: [hook] }],
    Stop: [
      {
        hooks: [
          hook,
          {
            type: "command",
            command: hookCommand(scripts.wait),
            async: true,
            asyncRewake: true,
            timeout: 1800,
          },
        ],
      },
    ],
    SessionEnd: [{ hooks: [{ ...hook, timeout: 2 }] }],
  };
}

/**
 * The hook groups Codex needs for coordination, in its hooks.json: Peer's hook
 * told it is Codex's. Codex runs each only once its person trusts it.
 */
export function codexHookGroups(scripts: {
  readonly hook: string;
  readonly wait: string;
}): Record<string, ReadonlyArray<HookGroup>> {
  const hook = { type: "command", command: `${hookCommand(scripts.hook)} codex`, timeout: 5 };
  return {
    // Also after a compaction (source "compact"): its working context goes back then.
    SessionStart: [{ hooks: [hook] }],
    UserPromptSubmit: [{ hooks: [hook] }],
    // Codex runs commands as Bash and edits files with apply_patch.
    PreToolUse: [{ matcher: "Bash|apply_patch", hooks: [hook] }],
    // Codex has no failure event: this follows a command that exits non-zero too, and nothing
    // follows a patch it could not apply.
    PostToolUse: [{ matcher: "Bash|apply_patch", hooks: [hook] }],
    // Codex asks its person: Peer lets its own work through, and the agent waits for the rest.
    PermissionRequest: [{ hooks: [hook] }],
    PreCompact: [{ hooks: [hook] }],
    Stop: [{ hooks: [hook] }],
    Interrupt: [{ hooks: [{ ...hook, timeout: 3 }] }],
    SessionEnd: [{ hooks: [{ ...hook, timeout: 3 }] }],
  };
}

/**
 * Codex's rule (rules/peer.rules in its home) that runs Peer's own command
 * without asking and outside its sandbox, where it could not reach Peer.
 */
export function codexRules(peerScript: string): string {
  return `# Peer coordination: Peer's own command talks to Peer on this computer. Peer adds and removes this file.\nprefix_rule(pattern=[${JSON.stringify(peerScript)}], decision="allow")\n`;
}

// Codex runs a hook only once its person trusts it, and keeps that trust per
// hook in its config.toml: `[hooks.state."<file>:<event>:<group>:<hook>"]` with
// the hash of what the hook is. Peer reads it to say whether Codex runs Peer's
// hooks yet; trusting them stays with the person, in Codex.
const CODEX_EVENTS: Readonly<Record<string, string>> = {
  PreToolUse: "pre_tool_use",
  PermissionRequest: "permission_request",
  PostToolUse: "post_tool_use",
  PreCompact: "pre_compact",
  PostCompact: "post_compact",
  SessionStart: "session_start",
  SessionEnd: "session_end",
  UserPromptSubmit: "user_prompt_submit",
  SubagentStart: "subagent_start",
  SubagentStop: "subagent_stop",
  Stop: "stop",
  Interrupt: "interrupt",
};
const CODEX_UNMATCHED = new Set(["UserPromptSubmit", "Stop", "Interrupt"]);
const CODEX_CONTEXT_LIMIT = new Set([
  "PreToolUse",
  "PostToolUse",
  "SessionStart",
  "UserPromptSubmit",
  "SubagentStart",
]);

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The hash Codex trusts a hook by: what the hook is, as Codex normalizes it. */
export function codexHookHash(event: string, matcher: unknown, handler: HookEntry): string | null {
  const label = CODEX_EVENTS[event];
  if (label === undefined || handler.type !== "command" || typeof handler.command !== "string") {
    return null;
  }
  const timeout = typeof handler.timeout === "number" ? handler.timeout : undefined;
  const normalized: Record<string, unknown> = {
    type: "command",
    command: handler.command,
    timeout:
      event === "SessionEnd" || event === "Interrupt"
        ? Math.min(Math.max(timeout ?? 1, 1), 3)
        : Math.max(timeout ?? 600, 1),
    async: handler.async === true,
  };
  if (typeof handler.statusMessage === "string") normalized.statusMessage = handler.statusMessage;
  const limit = handler.additionalContextLimit;
  if (CODEX_CONTEXT_LIMIT.has(event) && typeof limit === "number" && limit !== 2500) {
    normalized.additionalContextLimit = limit;
  }
  const identity: Record<string, unknown> = { event_name: label, hooks: [normalized] };
  if (!CODEX_UNMATCHED.has(event) && typeof matcher === "string") identity.matcher = matcher;
  return `sha256:${NodeCrypto.createHash("sha256").update(canonicalJson(identity)).digest("hex")}`;
}

/** The trust Codex keeps per hook in its config.toml: the hash it trusts, and whether it is off. */
export function codexHookTrust(
  config: string,
): Map<string, { readonly hash: string | undefined; readonly enabled: boolean }> {
  const trust = new Map<string, { hash: string | undefined; enabled: boolean }>();
  let current: { hash: string | undefined; enabled: boolean } | null = null;
  for (const line of config.split("\n")) {
    const header = /^\s*\[\s*hooks\.state\."((?:[^"\\]|\\.)*)"\s*\]\s*(#.*)?$/.exec(line);
    if (header !== null) {
      current = { hash: undefined, enabled: true };
      trust.set(JSON.parse(`"${header[1] ?? ""}"`) as string, current);
      continue;
    }
    if (/^\s*\[/.test(line)) {
      current = null;
      continue;
    }
    if (current === null) continue;
    const hash = /^\s*trusted_hash\s*=\s*"([^"]*)"/.exec(line)?.[1];
    if (hash !== undefined) current.hash = hash;
    if (/^\s*enabled\s*=\s*false\b/.test(line)) current.enabled = false;
  }
  return trust;
}

/**
 * Whether Codex runs Peer's hooks from its hooks.json at `path`: each one is
 * trusted with the hash of what it is now, and none is turned off.
 */
export function codexTrustsPeerHooks(
  hooks: Settings,
  path: string,
  config: string,
  marker: string,
): boolean {
  const trust = codexHookTrust(config);
  let ours = 0;
  for (const [event, groups] of Object.entries(hooks.hooks ?? {})) {
    const label = CODEX_EVENTS[event];
    if (label === undefined) continue;
    for (const [g, group] of groups.entries()) {
      for (const [h, handler] of (group.hooks ?? []).entries()) {
        if (!isPeerEntry(handler, marker)) continue;
        ours += 1;
        const state = trust.get(`${path}:${label}:${g}:${h}`);
        if (
          state?.enabled === false ||
          state?.hash !== codexHookHash(event, group.matcher, handler)
        ) {
          return false;
        }
      }
    }
  }
  return ours > 0;
}

const isPeerEntry = (entry: HookEntry, marker: string) => {
  const hook = `${marker}/hook`;
  const wait = `${marker}/wait`;
  return [
    hook,
    wait,
    `${hook} codex`,
    hookCommand(hook),
    hookCommand(wait),
    `${hookCommand(hook)} codex`,
  ].includes(String(entry.command));
};

/**
 * An agent's hook settings (Claude Code's settings.json, Codex's hooks.json:
 * the same shape) with Peer's coordination hooks added (`install`) or taken
 * out, leaving every other hook as it was. Peer's groups keep their place when
 * they change: Codex trusts each hook by its position, so a person's hooks
 * after them keep theirs. `marker` names Peer's scripts' directory.
 */
export function withPeerHooks(
  settings: Settings,
  groups: Record<string, ReadonlyArray<HookGroup>>,
  marker: string,
  install: boolean,
): Settings {
  const hooks: Record<string, ReadonlyArray<HookGroup>> = {};
  const events = new Set([...Object.keys(settings.hooks ?? {}), ...Object.keys(groups)]);
  for (const event of events) {
    const ours = install ? (groups[event] ?? []) : [];
    const next: HookGroup[] = [];
    let placed = false;
    for (const group of settings.hooks?.[event] ?? []) {
      const entries = group.hooks ?? [];
      const kept = entries.filter((entry) => !isPeerEntry(entry, marker));
      if (kept.length < entries.length && !placed) {
        next.push(...ours);
        placed = true;
      }
      if (kept.length > 0)
        next.push(kept.length === entries.length ? group : { ...group, hooks: kept });
    }
    if (!placed) next.push(...ours);
    if (next.length > 0) hooks[event] = next;
  }
  const { hooks: _previous, ...rest } = settings;
  return Object.keys(hooks).length === 0 ? rest : { ...rest, hooks };
}

/** Whether two settings say different things: Peer rewrites a person's settings only then. */
export function settingsDiffer(a: Settings, b: Settings): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

/** Whether an agent's hook settings already run Peer's hooks. */
export function hasPeerHooks(settings: Settings, marker: string): boolean {
  return Object.values(settings.hooks ?? {}).some((list) =>
    list.some((group) => (group.hooks ?? []).some((entry) => isPeerEntry(entry, marker))),
  );
}

/** Claude Code permission rules that let agents read and edit their working contexts, unasked. */
export function withContextAccess(settings: Settings, dir: string, install: boolean): Settings {
  const absolute = `/${dir.replace(/^\/+/, "")}`;
  const ours = [`Read(/${absolute}/**)`, `Edit(/${absolute}/**)`];
  const permissions = (settings.permissions ?? {}) as Record<string, unknown>;
  const allow = Array.isArray(permissions.allow)
    ? (permissions.allow as unknown[]).filter((rule) => !ours.includes(String(rule)))
    : [];
  const next = install ? [...allow, ...ours] : allow;
  const { allow: _previous, ...restPermissions } = permissions;
  const merged = next.length > 0 ? { ...restPermissions, allow: next } : restPermissions;
  const { permissions: _old, ...rest } = settings;
  return Object.keys(merged).length > 0 ? { ...rest, permissions: merged } : rest;
}
