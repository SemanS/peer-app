// @effect-diagnostics nodeBuiltinImport:off - deterministic SHA-256 fingerprints for snapshot-bound pagination.
import * as NodeCrypto from "node:crypto";
import {
  PeerHubError,
  contextGist,
  type PeerContextIdentity,
  type PeerContextView,
  type PeerContextArchive,
  type PeerTask,
  type PeerWorkContextText,
  type PeerFinding,
  type PeerStaleReads,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const Cursor = Schema.Struct({
  key: Schema.String,
  snapshot: Schema.String,
  offset: Schema.Number,
});
const decodeCursor = Schema.decodeUnknownSync(Schema.fromJsonString(Cursor));
const digest = (value: unknown) =>
  NodeCrypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** A changed collection invalidates the cursor explicitly, rather than skipping dependencies. */
export function contextPage<T>(items: ReadonlyArray<T>, key: string, limit = 20, cursor?: string) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new PeerHubError({ detail: "Context page limit must be between 1 and 100." });
  const snapshot = digest(items);
  let offset = 0;
  if (cursor !== undefined) {
    let decoded;
    try {
      decoded = decodeCursor(Buffer.from(cursor, "base64url").toString("utf8"));
    } catch {
      throw new PeerHubError({ detail: "Invalid context cursor." });
    }
    if (decoded.key !== key || decoded.snapshot !== snapshot)
      throw new PeerHubError({
        detail:
          "Context sources changed. Restart pagination to read the current complete collection.",
      });
    offset = decoded.offset;
    if (!Number.isInteger(offset) || offset < 0 || offset > items.length)
      throw new PeerHubError({ detail: "Invalid context cursor offset." });
  }
  const selected = items.slice(offset, offset + limit);
  const next = offset + selected.length;
  return {
    selected,
    coverage: {
      total: items.length,
      omittedCount: items.length - next,
      nextCursor:
        next < items.length
          ? Buffer.from(JSON.stringify({ key, snapshot, offset: next })).toString("base64url")
          : null,
      historyAvailableFrom: null,
    },
  };
}

export function contextArchive(input: {
  identity: PeerContextIdentity;
  tasks: ReadonlyArray<PeerTask>;
  contexts: ReadonlyArray<Omit<PeerWorkContextText, "text">>;
  generatedAt: string;
  availability: PeerContextArchive["availability"];
  history?: boolean | undefined;
  topic?: string | undefined;
  limit?: number | undefined;
  cursor?: string | undefined;
}): PeerContextArchive {
  const tasksByScope = new Map(input.tasks.map((task) => [`task:${task.id}`, task]));
  const contextsByScope = new Map(input.contexts.map((context) => [context.scope, context]));
  const scopes = new Set([
    ...input.contexts.map((context) => context.scope),
    ...input.tasks.map((task) => `task:${task.id}`),
  ]);
  const topic = input.topic?.trim().toLowerCase();
  const entries = [...scopes]
    .flatMap((scope) => {
      const task = tasksByScope.get(scope);
      const context = contextsByScope.get(scope);
      const closed = task?.status === "done";
      if (!input.history && closed) return [];
      const title = task?.title ?? (scope === "project" ? "Work outside tasks" : scope);
      if (
        topic &&
        !`${title} ${task?.key ?? ""} ${context?.gist ?? ""}`.toLowerCase().includes(topic)
      )
        return [];
      return [
        {
          scope,
          title,
          gist: context?.gist ?? null,
          revision: context?.version ?? null,
          updatedAt: context?.updatedAt ?? task?.updatedAt ?? input.generatedAt,
          closed,
        },
      ];
    })
    .sort((a, b) => a.scope.localeCompare(b.scope));
  const page = contextPage(
    entries,
    JSON.stringify([input.identity, input.history ?? false, topic ?? ""]),
    input.limit,
    input.cursor,
  );
  return {
    identity: input.identity,
    entries: page.selected,
    coverage: page.coverage,
    generatedAt: input.generatedAt,
    availability:
      input.availability === "available" && entries.length === 0 ? "empty" : input.availability,
  };
}

export function composeContextView(input: {
  identity: PeerContextIdentity;
  contexts: ReadonlyArray<PeerWorkContextText>;
  tasks: ReadonlyArray<PeerTask>;
  taskScopes?: ReadonlyArray<string> | undefined;
  findings: ReadonlyArray<PeerFinding>;
  reads: PeerStaleReads | null;
  availability: PeerContextArchive["availability"];
  generatedAt: string;
  limit?: number | undefined;
  cursor?: string | undefined;
  inputCursor?: string | undefined;
  findingCursor?: string | undefined;
}): PeerContextView {
  const key = JSON.stringify(input.identity);
  const sourceId = (kind: string, object: string, revision: unknown) =>
    JSON.stringify([input.identity, kind, object, revision]);
  const page = contextPage(input.contexts, `${key}:contexts`, input.limit, input.cursor);
  const sources: PeerContextView["sources"][number][] = [];
  const current: {
    -readonly [K in keyof PeerContextView["current"]]: PeerContextView["current"][K][number][];
  } = { goal: [], outcome: [], attention: [], next: [] };
  const taskScopes = new Set(
    input.taskScopes ?? input.tasks.slice(0, input.limit ?? 20).map((task) => `task:${task.id}`),
  );
  if (input.identity.scope === "project-aggregate" && input.tasks.length > 0) {
    const id = sourceId(
      "task",
      "project-tasks",
      digest(input.tasks.map((task) => [task.id, task.status, task.updatedAt])),
    );
    sources.push({
      id,
      kind: "task",
      objectId: "project-tasks",
      scope: "project-aggregate",
      revision: digest(input.tasks.map((task) => [task.id, task.status, task.updatedAt])),
      observedAt: input.generatedAt,
      availability: input.availability,
    });
    current.outcome.push({
      text: `${input.tasks.filter((task) => task.status === "open").length} open tasks · ${input.tasks.filter((task) => task.status === "review").length} in review · ${input.tasks.filter((task) => task.status === "done").length} closed`,
      sourceRefs: [id],
    });
  }
  for (const task of input.tasks.filter((task) => taskScopes.has(`task:${task.id}`))) {
    const id = sourceId("task", task.id, task.updatedAt);
    sources.push({
      id,
      kind: "task",
      objectId: task.id,
      scope: `task:${task.id}`,
      revision: task.updatedAt,
      observedAt: input.generatedAt,
      availability: input.availability,
    });
    current.goal.push({ text: task.title, sourceRefs: [id] });
  }
  for (const context of page.selected) {
    const id = sourceId("context", context.scope, context.version);
    sources.push({
      id,
      kind: "context",
      objectId: context.scope,
      scope: context.scope,
      revision: String(context.version),
      observedAt: input.generatedAt,
      availability: context.version === 0 ? "empty" : "available",
    });
    let section: "goal" | "outcome" | "attention" | "next" | undefined;
    const before = current.outcome.length;
    for (const raw of context.text.replace(/<!--[\s\S]*?(?:-->|$)/g, "").split(/\r?\n/)) {
      if (/^#{1,6}\s/.test(raw)) {
        const name = raw
          .replace(/^#+\s*/, "")
          .trim()
          .toLowerCase();
        section =
          name === "goal"
            ? "goal"
            : name === "provides" || name === "state"
              ? "outcome"
              : name === "blockers"
                ? "attention"
                : name === "next"
                  ? "next"
                  : undefined;
      } else if (section !== undefined && raw.trim()) {
        // A current view is a bounded report, never a second copy of the full Markdown history.
        if (current[section].length < 20)
          current[section].push({
            text: raw
              .trim()
              .replace(/^[-*+]\s+/, "")
              .slice(0, 500),
            sourceRefs: [id],
          });
      }
    }
    const gist = contextGist(context.text, context.gist);
    if (before === current.outcome.length && gist)
      current.outcome.push({ text: gist, sourceRefs: [id] });
  }
  if (sources.length === 0)
    sources.push({
      id: sourceId("context", input.identity.scope, null),
      kind: "context",
      objectId: input.identity.scope,
      scope: input.identity.scope,
      revision: null,
      observedAt: input.generatedAt,
      availability: input.availability,
    });
  const pending = input.findings
    .filter((finding) => finding.decision === undefined)
    .sort((a, b) => a.id.localeCompare(b.id));
  const findingsPage = contextPage(
    pending.map((finding) => finding.id),
    `${key}:findings`,
    input.limit,
    input.findingCursor,
  );
  const reads = input.reads;
  const required = [...(reads?.reads ?? [])]
    .sort((a, b) => a.scope.localeCompare(b.scope))
    .map((read) => ({
      scope: read.scope,
      revision: read.version,
      currentRevision: reads?.stale.some((stale) => stale.scope === read.scope)
        ? reads.stale.find((stale) => stale.scope === read.scope)!.currentVersion
        : read.version,
      observedAt: read.at,
    }));
  const inputs = contextPage(required, `${key}:inputs`, input.limit, input.inputCursor);
  return {
    identity: input.identity,
    current,
    sources,
    inputs: {
      state:
        reads === null || reads.recovery === "unavailable"
          ? "unavailable"
          : !reads.fresh
            ? "revalidation-required"
            : (reads.recovery ?? "revalidation-required"),
      required: inputs.selected,
      coverage: inputs.coverage,
    },
    pendingFindings: {
      availability: "available",
      ids: findingsPage.selected,
      items: pending
        .filter((finding) => findingsPage.selected.includes(finding.id))
        .map((finding) => ({
          id: finding.id,
          text: finding.text,
          email: finding.email,
          at: finding.at,
          scope: finding.task === undefined ? "project" : `task:${finding.task}`,
        })),
      coverage: findingsPage.coverage,
    },
    coverage: page.coverage,
    generatedAt: input.generatedAt,
    verifiedAt: null,
  };
}
