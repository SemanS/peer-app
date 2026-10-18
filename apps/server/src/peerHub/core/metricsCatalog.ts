import { taskRef } from "@t3tools/shared/peerRef";
export type FieldKind =
  | "id"
  | "count"
  | "ms"
  | "bytes"
  | "flag"
  | "ids"
  | "task"
  | "tasks"
  | { readonly enum: readonly string[] }
  | { readonly tally: readonly string[] };
export const defineEvents = <const E extends Record<string, Record<string, FieldKind>>>(
  events: E,
) => events;
const common = {
  session: "id",
  workspace: "id",
  project: "id",
  adapter: { enum: ["claude_mod", "claude_hooks", "codex_hooks"] },
  fileCount: "count",
  reasonClass: { enum: ["timeout", "unreachable", "refused", "error", "hook_deadline"] },
} as const;
const ev = <const E extends Record<string, FieldKind>>(fields: E) => ({ ...common, ...fields });
/**
 * What Peer's herdr runtime logs: which herdr, its versions, how many agents it ran and a class for
 * why. Never a path, a command, an environment value or terminal text.
 */
const herdrRuntime = {
  source: { enum: ["own", "peer"] },
  version: "id",
  fromVersion: "id",
  agents: "count",
  reasonClass: {
    enum: [
      "superseded",
      "turned-off",
      "restart",
      "upgrade",
      "spawn",
      "exited",
      "timeout",
      "unresponsive",
    ],
  },
} as const;
export const CATALOG = defineEvents({
  catchup: ev({ entries: "count", chars: "count", windowSeconds: "count" }),
  "forecast.git": ev({
    state: { enum: ["supported", "git-missing", "git-old", "git-unreadable"] },
  }),
  "forecast.round": ev({
    branches: "count",
    reused: "count",
    merges: "count",
    deferred: "count",
    ms: "ms",
  }),
  "forecast.told": ev({ pairs: "count", chars: "count" }),
  "impact.check": ev({
    changed: "count",
    uses: "count",
    deferred: "flag",
    state: {
      enum: [
        "ready",
        "missing",
        "uninitialized",
        "corrupt",
        "pending",
        "partial",
        "mismatch",
        "failed",
      ],
    },
  }),
  "impact.report": ev({ sessions: "count", changed: "count", uses: "count", success: "flag" }),
  "impact.told": ev({ chars: "count" }),
  "impact.codegraph.failed": ev({ failures: "count" }),
  "impact.off": ev({}),
  "plans.declared": ev({
    version: "count",
    changes: "count",
    maybes: "count",
    uses: "count",
    provides: "count",
    relations: "count",
    unresolved: "count",
    chars: "count",
    ms: "ms",
  }),
  "plans.withdrawn": ev({ count: "count" }),
  "plans.told": ev({ relations: "count", chars: "count" }),
  "plans.nudged": ev({ where: { enum: ["start", "plan-mode"] } }),
  "plans.resent": ev({ outcome: { enum: ["sent", "stale", "refused", "failed"] } }),
  "resource.claim": ev({}),
  "resource.refused": ev({}),
  "resource.release": ev({}),
  "resource.lost": ev({}),
  "ask.unopened": ev({}),
  ask: ev({}),
  "ask.dropped": ev({ ms: "ms" }),
  "handoff.compose": ev({
    task: "task",
    ms: "ms",
    at: { enum: ["publish", "review", "done"] },
    staleCount: "count",
    refusal: { enum: ["stale_context", "unmerged_work", "not_your_session", "other"] },
    number: "count",
    changed: "flag",
    targets: "count",
    budgetLeft: "ms",
  }),
  "handoff.publish": ev({
    task: "task",
    at: { enum: ["publish", "review", "done"] },
    staleCount: "count",
    refusal: { enum: ["stale_context", "unmerged_work", "not_your_session", "other"] },
    number: "count",
    changed: "flag",
    targets: "count",
    budgetLeft: "ms",
    outcomes: { tally: ["written", "current", "skipped", "failed", "removed", "not-finished"] },
  }),
  "handoff.withdraw": ev({
    task: "task",
    at: { enum: ["publish", "review", "done"] },
    staleCount: "count",
    refusal: { enum: ["stale_context", "unmerged_work", "not_your_session", "other"] },
    number: "count",
    changed: "flag",
    targets: "count",
    budgetLeft: "ms",
  }),
  "dependencies.told": ev({ chars: "count" }),
  "knowledge.candidates-skipped": ev({ count: "count" }),
  "knowledge.read": ev({ entryCount: "count" }),
  "knowledge.failed": ev({ entryCount: "count" }),
  "knowledge.governs": ev({ entryCount: "count" }),
  "knowledge.opened": ev({ entryCount: "count" }),
  "find.skipped": ev({}),
  "find.failed": ev({}),
  "find.asked": ev({ works: "tasks" }),
  "context.updated": ev({ bytes: "bytes" }),
  "context.nudged": ev({}),
  "context.checkpoint": ev({}),
  "context.checkpoint.failed": ev({}),
  "shared.mirror.failed": ev({}),
  "shared.stashed": ev({ bytes: "bytes" }),
  "shared.failed": ev({}),
  "shared.read": ev({ version: "count", keeper: "id" }),
  "shared.kept": ev({ version: "count" }),
  "shared.released": ev({}),
  "shared.release.failed": ev({}),
  "shared.linked": ev({}),
  "shared.too_large": ev({ scope: "task", bytes: "bytes" }),
  "shared.unsent": ev({ scope: "task" }),
  "shared.compact": ev({ scope: "task" }),
  "shared.written": ev({ already: "flag", version: "count", bytes: "bytes", scope: "task" }),
  "shared.stale": ev({ version: "count", scope: "task" }),
  "shared.lost": ev({ keeper: "id", scope: "task" }),
  "shared.replaced": ev({ restoredFrom: "count", version: "count" }),
  "shared.resumed": ev({ version: "count" }),
  "shared.handed": ev({ version: "count" }),
  "context.read.unverified": ev({ version: "count" }),
  "finding.requested": ev({ findings: "ids", runtimeGeneration: "id" }),
  "follow.told": ev({}),
  "finding.prepared": ev({ findings: "ids", runtimeGeneration: "id", keeps: "flag" }),
  "shared.closed": ev({ task: "task" }),
  "shared.told": ev({ version: "count", scope: "task" }),
  wake: ev({ peer: "id", immediate: "flag" }),
  wait: ev({}),
  "wake.failed": ev({}),
  "runtime.wake.unavailable": ev({}),
  "broker.started": ev({ policy: { enum: ["notify", "coordinate", "enforce"] } }),
  "plugin.failed": ev({
    hook: {
      enum: [
        "plugins",
        "reportSessions",
        "notice",
        "notices",
        "verdict",
        "report",
        "threadReport",
        "afterReview",
        "commandReply",
        "sessionStart",
        "session-start",
        "step",
        "beforeEdit",
        "beforeTool",
        "beforeToolCall",
        "afterTool",
        "prepareEdit",
        "taskGate",
        "beforePublish",
      ],
    },
    plugin: "id",
  }),
  "plugin.late": ev({ plugin: "id" }),
  "plugin.verdict.fallback": ev({
    tool: "id",
    verdict: { enum: ["clear", "notify", "deny", "ask", "held"] },
  }),
  "cli.id-only": ev({ agent: "id" }),
  "credential.bound": ev({
    source: {
      enum: [
        "first-use",
        "codex-hooks",
        "claude-hooks",
        "claude-mod",
        "prompt",
        "compact",
        "resume",
        "start",
        "shared",
        "own",
      ],
    },
  }),
  "note.agent": ev({}),
  "resolve.agent": ev({}),
  claim: ev({}),
  release: ev({}),
  "context.ack": ev({ version: "count" }),
  "intent.unverified": ev({ wentOn: "flag" }),
  "hook.stale": ev({
    runtimeGeneration: "id",
    hookEvent: {
      enum: [
        "SessionStart",
        "SessionEnd",
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "Stop",
        "PermissionRequest",
        "PreCompact",
        "Notification",
        "SubagentStop",
      ],
    },
  }),
  hook: ev({
    hookEvent: {
      enum: [
        "SessionStart",
        "SessionEnd",
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "Stop",
        "PermissionRequest",
        "PreCompact",
        "Notification",
        "SubagentStop",
      ],
    },
    tool: "id",
    chars: "count",
    ms: "ms",
  }),
  "delivery.prepared": ev({
    id: "id",
    runtimeGeneration: "id",
    chars: "count",
    hookEvent: {
      enum: [
        "SessionStart",
        "SessionEnd",
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "Stop",
        "PermissionRequest",
        "PreCompact",
        "Notification",
        "SubagentStop",
      ],
    },
  }),
  "hook.late": ev({
    decided: "flag",
    hookEvent: {
      enum: [
        "SessionStart",
        "SessionEnd",
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "Stop",
        "PermissionRequest",
        "PreCompact",
        "Notification",
        "SubagentStop",
      ],
    },
    ms: "ms",
    queued: "flag",
  }),
  "ask.approved": ev({}),
  "session.blocked": ev({ tool: "id" }),
  "permission.allowed": ev({ tool: "id" }),
  "session.ended": ev({
    tokenEstimate: "count",
    tokenEstimateMethod: "id",
    injected: {
      tally: [
        "SessionStart",
        "SessionEnd",
        "UserPromptSubmit",
        "PreToolUse",
        "PostToolUse",
        "Stop",
        "PermissionRequest",
        "PreCompact",
        "Notification",
        "SubagentStop",
      ],
    },
  }),
  "cli.unplain": ev({}),
  "handoff.stale": ev({
    task: "task",
    at: { enum: ["publish", "review", "done"] },
    staleCount: "count",
    refusal: { enum: ["stale_context", "unmerged_work", "not_your_session", "other"] },
    number: "count",
    changed: "flag",
    targets: "count",
    budgetLeft: "ms",
  }),
  "handoff.unverified": ev({
    task: "task",
    at: { enum: ["publish", "review", "done"] },
    staleCount: "count",
    refusal: { enum: ["stale_context", "unmerged_work", "not_your_session", "other"] },
    number: "count",
    changed: "flag",
    targets: "count",
    budgetLeft: "ms",
  }),
  "plugin.denied": ev({ plugin: "id" }),
  // Nothing lands unread: how many messages a landing step waited for and how many characters the
  // stop gave the agent, never what they said; and a hook that missed its deadline at one.
  "landing.stopped": ev({ messages: "count", chars: "count" }),
  "landing.late": ev({}),
  // Ownership: a step stopped for an owner's call (edit or landing), what an agent was told (its
  // kind and size) and what became of a call; never whose, what or why.
  "ownership.stopped": ev({ where: { enum: ["edit", "landing"] } }),
  "ownership.told": ev({
    kind: { enum: ["decision", "expiry", "asked", "fact", "owner", "start"] },
    chars: "count",
  }),
  "ownership.call": ev({
    outcome: { enum: ["asked", "merged", "withdrawn", "refused", "uncertain"] },
  }),
  // Jujutsu: how long a snapshot of a session's working copy took and whether it missed its step's
  // budget, how many divergent changes were converged, what a protection stop covered, what an agent
  // was told (its kind and size), and undo and follow outcomes; never a change id, bookmark, path or
  // command.
  "jujutsu.snapshot": ev({ ms: "ms", changed: "flag" }),
  "jujutsu.snapshot.late": ev({ ms: "ms" }),
  "jujutsu.converged": ev({ changes: "count", ms: "ms", outcome: { enum: ["done", "refused"] } }),
  "jujutsu.stopped": ev({ named: "flag" }),
  "jujutsu.told": ev({
    kind: { enum: ["moved", "push", "protected", "undone"] },
    chars: "count",
  }),
  "jujutsu.followed": ev({
    action: { enum: ["follow", "stop", "fetch"] },
    outcome: { enum: ["done", "refused", "timeout"] },
  }),
  "jujutsu.undo": ev({ operations: "count", outcome: { enum: ["done", "refused", "conflict"] } }),
  // Changes: how many changes a report held, never which, whose or what they said.
  "changes.reported": ev({ changes: "count", ms: "ms" }),
  // Forecast's Jujutsu sources: work shared as refs and the merge checks run on it, in counts.
  "forecast.shared": ev({ refs: "count", outcome: { enum: ["pushed", "skipped", "refused"] } }),
  "forecast.check": ev({
    pairs: "count",
    ms: "ms",
    outcome: { enum: ["clean", "conflicts", "unknown"] },
  }),
  // Agreements: how much of an agreement an agent was told (its size, never its words), that one
  // fell due, and how one closed; never which one, between which tasks, or whose.
  "agreements.told": ev({ chars: "count" }),
  "agreements.due": ev({}),
  "agreements.closed": ev({
    why: { enum: ["handled", "not-needed", "replaced", "removed", "expired", "landed"] },
  }),
  cli: ev({
    outcome: { enum: ["ok", "refused", "failed"] },
    command: {
      enum: [
        "status",
        "note",
        "resolve",
        "claim",
        "release",
        "index",
        "context",
        "ack",
        "review",
        "done",
        "log",
        "help",
        "other",
      ],
    },
    argCount: "count",
    outBytes: "bytes",
  }),
  "broker.error": ev({}),
  "session.ignored": ev({}),
  "session.started": ev({ task: "task", remembered: "count" }),
  "session.thread": ev({}),
  "git.slow": ev({}),
  "git.failed": ev({}),
  "files.shell": ev({}),
  "context.injected": ev({ version: "count", scope: "task", keeps: "flag" }),
  news: ev({ seen: "count", announced: "flag" }),
  "delivery.verified": ev({
    id: "id",
    chars: "count",
    runtimeGeneration: "id",
    evidence: {
      enum: [
        "model-input",
        "model-input-receipt",
        "receipt",
        "verified",
        "model_input",
        "model-input",
      ],
    },
  }),
  "provider.usage": ev({
    agentId: "id",
    runtimeGeneration: "id",
    turnId: "id",
    index: "count",
    inputTokens: "count",
    cacheReadTokens: "count",
    cacheWriteTokens: "count",
    outputTokens: "count",
  }),
  "session.expired": ev({}),
  "session.memory.failed": ev({}),
  "session.task": ev({ from: "task", to: "task" }),
  sync: ev({
    id: "id",
    status: {
      enum: [
        "queued",
        "delivered",
        "failed",
        "unavailable",
        "running",
        "idle",
        "waiting",
        "active",
      ],
    },
    reportedCount: "count",
    overlapCount: "count",
    ms: "ms",
  }),
  "sync.failed": ev({}),
  "overlap.opened": ev({ overlap: "id" }),
  "note.person": ev({}),
  "resolve.person": ev({}),
  "settle.person": ev({ overlap: "id" }),
  "shared.denied": ev({ scope: "task" }),
  "intent.failed": ev({ ms: "ms" }),
  "intent.legacy": ev({}),
  intent: ev({
    policySource: { enum: ["workspace", "environment", "default", "project", "legacy"] },
    policy: { enum: ["notify", "coordinate", "enforce"] },
    ms: "ms",
    verdictCounts: { tally: ["clear", "notify", "deny", "ask", "held"] },
  }),
  ack: ev({}),
  "ack.failed": ev({}),
  decision: ev({}),
  "settle.nudged": ev({}),
  "index.failed": ev({}),
  "index.asked": ev({ version: "count", works: "tasks", told: "flag", scope: "task" }),
  "board.mirrored": ev({ version: "count", scope: "task" }),
  "broker.stopped": ev({}),
  "shared.handout": ev({}),
  "runtime.wake": ev({
    status: {
      enum: [
        "queued",
        "delivered",
        "failed",
        "unavailable",
        "running",
        "idle",
        "waiting",
        "active",
      ],
    },
  }),
  "handoff.refused": ev({
    task: "task",
    at: { enum: ["publish", "review", "done"] },
    staleCount: "count",
    refusal: { enum: ["stale_context", "unmerged_work", "not_your_session", "other"] },
    number: "count",
    changed: "flag",
    targets: "count",
    budgetLeft: "ms",
  }),
  "log.format": { v: "count" },
  "metrics.failed": { where: { enum: ["fold", "flush", "upload"] }, count: "count" },
  "memory.started": ev({}),
  "memory.prepare.failed": ev({}),
  "memory.legacy.failed": ev({}),
  "herdr.runtime.started": herdrRuntime,
  "herdr.runtime.adopted": herdrRuntime,
  "herdr.runtime.stopped": herdrRuntime,
  "herdr.runtime.restarted": herdrRuntime,
  "herdr.runtime.upgraded": herdrRuntime,
  "herdr.runtime.failed": herdrRuntime,
  "announcement.told": ev({}),
  "announcement.ack": ev({}),
  "mcp.session": ev({ listChars: "count" }),
  "mcp.call": ev({ chars: "count", isError: "flag" }),
} as const);
export type MetricEvent = keyof typeof CATALOG | `${string}.metric`;
type FieldValue<K> = K extends "flag"
  ? boolean
  : K extends "count" | "ms" | "bytes"
    ? number
    : K extends "ids" | "tasks"
      ? readonly string[]
      : K extends { readonly enum: infer A extends readonly string[] }
        ? A[number]
        : K extends { readonly tally: infer A extends readonly string[] }
          ? Partial<Record<A[number], number>>
          : string;
export type EventFields<E extends MetricEvent> = E extends keyof typeof CATALOG
  ? Partial<{ [K in keyof (typeof CATALOG)[E]]: FieldValue<(typeof CATALOG)[E][K]> }>
  : {
      readonly name?: string;
      readonly n?: number;
      readonly workspace?: string;
      readonly project?: string;
    };
export type MetricRecord = Readonly<{ t: string; event: string } & Record<string, unknown>>;
const ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const count = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
export function reasonClassOf(error: unknown) {
  if (typeof error === "object" && error !== null && "code" in error && error.code)
    return "refused";
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/timeout|deadline|timed out/i.test(message)) return "timeout";
  if (/Could not reach|unreachable|ECONNREFUSED|offline/i.test(message)) return "unreachable";
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    error._tag === "PeerHubError"
  )
    return "unreachable";
  return "error";
}
export function project(event: string, fields: Readonly<Record<string, unknown>>) {
  const catalog: Readonly<Record<string, Readonly<Record<string, FieldKind>>>> = CATALOG;
  const kinds =
    catalog[event] ??
    (/^[a-z][a-z0-9-]*\.metric$/.test(event)
      ? {
          name: "id" as const,
          n: "count" as const,
          workspace: "id" as const,
          project: "id" as const,
        }
      : {});
  const out: Record<string, unknown> = {};
  for (const [key, kind] of Object.entries(kinds)) {
    const v = fields[key];
    if (kind === "id") {
      if (typeof v === "string" && ID.test(v)) out[key] = v;
    } else if (kind === "count" || kind === "ms" || kind === "bytes") {
      if (count(v)) out[key] = v;
    } else if (kind === "flag") {
      if (typeof v === "boolean") out[key] = v;
    } else if (kind === "task") {
      if (typeof v === "string" || v == null) out[key] = taskRef(v);
    } else if (kind === "tasks") {
      if (Array.isArray(v) && v.length <= 50 && v.every((x) => typeof x === "string"))
        out[key] = Object.freeze(v.map(taskRef));
    } else if (kind === "ids") {
      if (Array.isArray(v) && v.length <= 50 && v.every((x) => typeof x === "string" && ID.test(x)))
        out[key] = Object.freeze([...v]);
    } else if (typeof kind === "object" && "enum" in kind) {
      if (typeof v === "string" && kind.enum.includes(v)) out[key] = v;
    } else if (
      typeof kind === "object" &&
      "tally" in kind &&
      typeof v === "object" &&
      v !== null &&
      !Array.isArray(v)
    ) {
      out[key] = Object.freeze(
        Object.fromEntries(
          Object.entries(v).filter(([k, n]) => kind.tally.includes(k) && count(n)),
        ),
      );
    }
  }
  return out;
}
/** Legacy broker detail is converted here before reaching the same strict catalog boundary. */
export function metricsOf(event: string, detail: Readonly<Record<string, unknown>>) {
  const out: Record<string, unknown> = { ...detail };
  for (const [field, metric] of [
    ["files", "fileCount"],
    ["claims", "claimCount"],
    ["args", "argCount"],
    ["stale", "staleCount"],
    ["entries", "entryCount"],
    ["works", "workCount"],
    ["overlaps", "overlapCount"],
    ["reported", "reportedCount"],
  ] as const)
    if (Array.isArray(detail[field])) out[metric] = detail[field].length;
    else if (typeof detail[field] === "number" && count(detail[field])) out[metric] = detail[field];
  if (typeof detail.out === "string") out.outBytes = new TextEncoder().encode(detail.out).length;
  if (typeof detail.text === "string") out.chars = detail.text.length;
  if (detail.reason !== undefined || detail.error !== undefined)
    out.reasonClass = detail.reasonClass ?? reasonClassOf(detail.error ?? detail.reason);
  if (event === "cli") {
    out.command =
      typeof detail.command === "string" &&
      (CATALOG.cli.command.enum as readonly string[]).includes(detail.command)
        ? detail.command
        : "other";
    out.outcome =
      detail.outcome === "done"
        ? "ok"
        : detail.outcome === "refused" || detail.outcome === "usage"
          ? "refused"
          : "failed";
  }
  if (event === "intent" && Array.isArray(detail.verdicts)) {
    out.verdictCounts = {};
    const counts: Record<string, number> = {};
    for (const v of detail.verdicts)
      if (typeof v === "object" && v !== null && "verdict" in v && typeof v.verdict === "string")
        counts[v.verdict] = (counts[v.verdict] ?? 0) + 1;
    out.verdictCounts = counts;
  }
  if (event === "provider.usage" && typeof detail.usage === "object" && detail.usage !== null) {
    const u = detail.usage as Record<string, unknown>;
    out.inputTokens = u.input_tokens ?? u.inputTokens;
    out.cacheReadTokens = u.cache_read_input_tokens ?? u.cacheReadTokens;
    out.cacheWriteTokens = u.cache_creation_input_tokens ?? u.cacheWriteTokens;
    out.outputTokens = u.output_tokens ?? u.outputTokens;
  }
  return out;
}
