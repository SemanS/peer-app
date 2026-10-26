// @effect-diagnostics nodeBuiltinImport:off globalDate:off - private, durable input references beside session context.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { PeerContextRead, type PeerStaleReads } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { neutral } from "../../peerText.ts";
import type { CoordinationBroker } from "./Broker.ts";
import { hubRead, hubWrite, refused, usage } from "./cliContract.ts";
import type { CommandArguments } from "./cli.ts";
import { messageOf } from "./log.ts";
import { safePart, type LocalSession } from "./sessions.ts";
import { newOp } from "./sync.ts";

const Checkpoint = Schema.Struct({
  schema: Schema.Literal(1),
  environment: Schema.String,
  authority: Schema.String,
  workspace: Schema.String,
  project: Schema.String,
  session: Schema.String,
  thread: Schema.optional(Schema.String),
  at: Schema.String,
  recovery: Schema.Literals(["complete", "revalidation-required", "unavailable"]),
  reads: Schema.Array(PeerContextRead),
});
type Checkpoint = typeof Checkpoint.Type;
const decode = Schema.decodeUnknownSync(Checkpoint);
const History = Schema.Array(Schema.Struct({ id: Schema.String, at: Schema.String }));
const decodeHistory = Schema.decodeUnknownSync(History);
const digest = (text: string) => NodeCrypto.createHash("sha256").update(text).digest("hex");
const PAGE = 25;
const HISTORY_KEPT = 50;
const nextStep =
  "read the required contexts again and reconstruct inputs explicitly with peer inputs recover.";
const authority = (broker: CoordinationBroker, session: LocalSession) => {
  const value = broker.host.contextAuthority?.(session.workspace);
  if (value === undefined) throw refused("context authority identity is unavailable", nextStep);
  return value;
};
const directory = (broker: CoordinationBroker, session: LocalSession) =>
  NodePath.join(
    broker.host.contextsDir,
    safePart(session.workspace),
    safePart(session.project),
    "inputs",
    digest(authority(broker, session)),
  );
const pointerPath = (
  broker: CoordinationBroker,
  session: LocalSession,
  key: string,
  suffix: string,
) => NodePath.join(directory(broker, session), `${digest(key)}.${suffix}`);
const writes = new Map<string, Promise<unknown>>();

async function atomic(path: string, text: string) {
  await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${NodeCrypto.randomUUID()}.tmp`;
  try {
    await NodeFSP.writeFile(temp, text, { mode: 0o600 });
    await NodeFSP.rename(temp, path);
  } finally {
    await NodeFSP.rm(temp, { force: true });
  }
}

async function inputs(broker: CoordinationBroker, session: LocalSession): Promise<PeerStaleReads> {
  if (broker.host.staleReads === undefined)
    throw refused(
      "this authority cannot verify input recovery",
      "update Peer and its Hub, then retry.",
    );
  return hubRead(
    "inputs",
    () => broker.host.staleReads!(session.workspace, session.project, session.id),
    nextStep,
  );
}

async function head(broker: CoordinationBroker, session: LocalSession, key: string) {
  try {
    return await NodeFSP.readFile(pointerPath(broker, session, key, "head"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function history(broker: CoordinationBroker, session: LocalSession, key: string) {
  try {
    return decodeHistory(
      JSON.parse(await NodeFSP.readFile(pointerPath(broker, session, key, "history"), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw refused("input checkpoint history is unavailable", nextStep);
  }
}

async function load(
  broker: CoordinationBroker,
  session: LocalSession,
  id: string,
): Promise<Checkpoint> {
  if (!/^[a-f0-9]{64}$/.test(id))
    throw usage("invalid input checkpoint", "use the ID from peer inputs checkpoint.");
  let text: string;
  try {
    text = await NodeFSP.readFile(NodePath.join(directory(broker, session), `${id}.json`), "utf8");
  } catch {
    throw refused("input checkpoint is unavailable", nextStep);
  }
  if (digest(text) !== id) throw refused("input checkpoint changed", nextStep);
  let checkpoint: Checkpoint;
  try {
    checkpoint = decode(JSON.parse(text));
  } catch {
    throw refused("input checkpoint has invalid evidence", nextStep);
  }
  if (
    checkpoint.authority !== authority(broker, session) ||
    checkpoint.environment !== broker.host.environment ||
    checkpoint.workspace !== session.workspace ||
    checkpoint.project !== session.project
  )
    throw refused(
      "input checkpoint belongs to another authority or project",
      "read the sources in this project's authority.",
    );
  if (
    !Number.isFinite(Date.parse(checkpoint.at)) ||
    new Set(checkpoint.reads.map((read) => read.scope)).size !== checkpoint.reads.length ||
    checkpoint.reads.some(
      (read) =>
        read.project !== checkpoint.project ||
        read.environment !== checkpoint.environment ||
        read.session !== checkpoint.session ||
        !Number.isSafeInteger(read.version) ||
        read.version < 0,
    )
  )
    throw refused("input checkpoint has invalid source references", nextStep);
  return checkpoint;
}

const references = (state: Pick<Checkpoint, "recovery" | "reads">) =>
  JSON.stringify({
    recovery: state.recovery,
    reads: state.reads
      .map(({ scope, version }) => [scope, version])
      .toSorted(([a], [b]) => String(a).localeCompare(String(b))),
  });

/** Only unreferenced rolling snapshots expire; every live session and thread head remains pinned. */
async function collect(
  broker: CoordinationBroker,
  session: LocalSession,
  dropped: readonly string[],
) {
  if (dropped.length === 0) return;
  const retained = new Set<string>();
  const dir = directory(broker, session);
  for (const name of await NodeFSP.readdir(dir)) {
    if (name.endsWith(".head"))
      retained.add(await NodeFSP.readFile(NodePath.join(dir, name), "utf8"));
    if (name.endsWith(".history")) {
      try {
        for (const entry of decodeHistory(
          JSON.parse(await NodeFSP.readFile(NodePath.join(dir, name), "utf8")),
        ))
          retained.add(entry.id);
      } catch {
        return;
      }
    }
  }
  for (const id of dropped)
    if (/^[a-f0-9]{64}$/.test(id) && !retained.has(id))
      await NodeFSP.rm(NodePath.join(dir, `${id}.json`), { force: true });
}

/** A checkpoint contains references, never private notes or a claim that a transferred agent read them. */
export async function saveInputCheckpoint(broker: CoordinationBroker, session: LocalSession) {
  const dir = directory(broker, session);
  const before = writes.get(dir) ?? Promise.resolve();
  const run = before
    .catch(() => undefined)
    .then(async () => {
      const state = await inputs(broker, session);
      session.inputRecovery = state.recovery ?? "revalidation-required";
      const checkpoint: Checkpoint = {
        schema: 1,
        environment: broker.host.environment,
        authority: authority(broker, session),
        workspace: session.workspace,
        project: session.project,
        session: session.id,
        ...(session.thread === undefined ? {} : { thread: session.thread }),
        at: new Date().toISOString(),
        recovery: session.inputRecovery,
        reads: state.reads ?? [],
      };
      const oldId = await head(broker, session, session.id);
      if (oldId !== undefined) {
        const old = await load(broker, session, oldId).catch(() => null);
        if (
          old !== null &&
          old.session === session.id &&
          old.thread === session.thread &&
          references(old) === references(checkpoint)
        )
          return oldId;
      }
      const text = JSON.stringify(checkpoint);
      const id = digest(text);
      await atomic(NodePath.join(dir, `${id}.json`), text);
      const dropped: string[] = [];
      for (const key of new Set([
        session.id,
        ...(session.thread === undefined ? [] : [session.thread]),
      ])) {
        const previous = await history(broker, session, key);
        const entries = [...previous, { id, at: checkpoint.at }];
        dropped.push(...entries.slice(0, -HISTORY_KEPT).map((entry) => entry.id));
        await atomic(
          pointerPath(broker, session, key, "history"),
          JSON.stringify(entries.slice(-HISTORY_KEPT)),
        );
        await atomic(pointerPath(broker, session, key, "head"), id);
      }
      await collect(broker, session, dropped);
      return id;
    });
  writes.set(dir, run);
  try {
    return await run;
  } finally {
    if (writes.get(dir) === run) writes.delete(dir);
  }
}

/** Lifecycle hooks must keep working offline; the last committed checkpoint survives a failed refresh. */
export async function checkpointInputs(broker: CoordinationBroker, session: LocalSession) {
  if (broker.host.staleReads === undefined) return;
  try {
    await saveInputCheckpoint(broker, session);
  } catch (error) {
    broker.record("inputs.checkpoint.failed", { session: session.id, reason: messageOf(error) });
  }
}

async function importCheckpoint(
  broker: CoordinationBroker,
  session: LocalSession,
  id: string,
  reason: string,
) {
  const checkpoint = await load(broker, session, id);
  const merged = new Map(
    checkpoint.reads.map((read) => [read.scope, { scope: read.scope, version: read.version }]),
  );
  for (const [scope, read] of session.read) merged.set(scope, { scope, version: read.version });
  // References survive an offline import, with unknown coverage; they are never fabricated reads.
  for (const [scope, read] of merged)
    if (!session.read.has(scope))
      session.read.set(scope, {
        version: read.version,
        notifiedVersion: read.version,
        text: undefined,
        toldAt: 0,
      });
  session.inputRecovery = "unavailable";
  if (broker.host.recoverInputs === undefined) {
    await broker.saveMemories();
    throw refused(
      "this authority cannot import input manifests",
      "update Peer and its Hub, then retry.",
    );
  }
  let current: PeerStaleReads;
  try {
    current = await inputs(broker, session);
  } catch (error) {
    await broker.saveMemories();
    throw error;
  }
  for (const read of current.reads ?? [])
    merged.set(read.scope, { scope: read.scope, version: read.version });
  const recover = (coverage: "transferred" | "unavailable") =>
    hubWrite(
      "inputs",
      () =>
        broker.host.recoverInputs!(
          session.workspace,
          session.project,
          session.id,
          reason,
          [...merged.values()],
          coverage,
          newOp(),
        ),
      nextStep,
    );
  let result: PeerStaleReads;
  try {
    result =
      checkpoint.recovery === "complete"
        ? await recover("transferred")
        : await recover("unavailable");
  } catch (error) {
    if (checkpoint.recovery !== "complete") {
      await broker.saveMemories();
      throw error;
    }
    // A retained checkpoint can reference a revision removed from the authority in the meantime.
    try {
      result = await recover("unavailable");
    } catch (failure) {
      await broker.saveMemories();
      throw failure;
    }
  }
  session.inputRecovery = result.recovery ?? "revalidation-required";
  session.inputImports = [...new Set([...(session.inputImports ?? []), id])];
  for (const read of result.reads ?? [])
    if (!session.read.has(read.scope))
      session.read.set(read.scope, {
        version: read.version,
        notifiedVersion: read.version,
        text: undefined,
        toldAt: 0,
      });
  await broker.saveMemories();
  return `Imported ${merged.size} input references from ${id}. ${result.recovery === "unavailable" ? "Source coverage is incomplete or unavailable; reconstruct the baseline explicitly with a reason." : "Re-read them with peer context before relying on them; transfer does not record a read."}`;
}

async function unavailable(broker: CoordinationBroker, session: LocalSession, reason: string) {
  session.inputRecovery = "unavailable";
  if (broker.host.recoverInputs !== undefined) {
    try {
      const current = await inputs(broker, session);
      const known = new Map(
        [...session.read].map(([scope, read]) => [scope, { scope, version: read.version }]),
      );
      for (const read of current.reads ?? [])
        if ((known.get(read.scope)?.version ?? -1) <= read.version)
          known.set(read.scope, { scope: read.scope, version: read.version });
      await broker.host.recoverInputs(
        session.workspace,
        session.project,
        session.id,
        reason,
        [...known.values()],
        "unavailable",
        newOp(),
      );
    } catch (error) {
      broker.record("inputs.recovery.failed", { session: session.id, reason: messageOf(error) });
    }
  }
  await broker.saveMemories();
  return `Peer input recovery: unavailable. ${reason} No empty input list proves freshness; ${nextStep}`;
}

const lineageBoundary = (
  broker: CoordinationBroker,
  session: LocalSession,
  source: { thread: string; cutoff: string },
) =>
  digest(
    JSON.stringify([
      broker.host.environment,
      authority(broker, session),
      session.workspace,
      session.project,
      source.thread,
      source.cutoff,
    ]),
  );

/** Re-entry and transfer use only source snapshots at or before their lineage cutoff. */
export async function resumeInputCheckpoint(
  broker: CoordinationBroker,
  session: LocalSession,
): Promise<string | null> {
  if (session.thread === undefined || broker.host.staleReads === undefined) return null;
  try {
    const notices: string[] = [];
    const canonical = await inputs(broker, session);
    const known = new Map(
      [...session.read].map(([scope, read]) => [scope, { scope, version: read.version }]),
    );
    const ownId = await head(broker, session, session.id);
    if (ownId !== undefined) {
      const own = await load(broker, session, ownId);
      if (own.session !== session.id)
        throw refused("the session input checkpoint belongs to another session", nextStep);
      for (const read of own.reads)
        if ((known.get(read.scope)?.version ?? -1) < read.version)
          known.set(read.scope, { scope: read.scope, version: read.version });
    }
    if (
      [...known].some(
        ([scope, knownRead]) =>
          !(canonical.reads ?? []).some(
            (read) => read.scope === scope && read.version >= knownRead.version,
          ),
      )
    ) {
      for (const [scope, read] of known)
        if ((session.read.get(scope)?.version ?? -1) < read.version)
          session.read.set(scope, {
            version: read.version,
            notifiedVersion: read.version,
            text: undefined,
            toldAt: 0,
          });
      notices.push(
        await unavailable(
          broker,
          session,
          "The context authority lost receipts for inputs retained by this session's recovery evidence.",
        ),
      );
    }
    const lineage = await broker.host.contextLineage?.(session.thread);
    const sources = lineage?.sources ?? [];
    const ids: string[] = [];
    const boundaries: string[] = [];
    for (const source of sources) {
      const boundary = lineageBoundary(broker, session, source);
      if (session.inputLineage?.includes(boundary)) continue;
      boundaries.push(boundary);
      const cutoff = Date.parse(source.cutoff);
      const entry = (await history(broker, session, source.thread)).findLast(
        (item) => Date.parse(item.at) <= cutoff,
      );
      if (entry === undefined)
        return unavailable(
          broker,
          session,
          "A required transfer source checkpoint is missing at its fork or handoff boundary.",
        );
      const checkpoint = await load(broker, session, entry.id);
      if (checkpoint.thread !== source.thread || Date.parse(checkpoint.at) > cutoff)
        return unavailable(
          broker,
          session,
          "The source checkpoint does not match its transfer boundary.",
        );
      ids.push(entry.id);
    }
    if (sources.length === 0) {
      const id = await head(broker, session, session.thread);
      if (id !== undefined) ids.push(id);
      else if (lineage?.required || session.inputRecovery !== "complete")
        return unavailable(
          broker,
          session,
          "The returning work has no recoverable input checkpoint.",
        );
    }
    for (const id of new Set(ids)) {
      const checkpoint = await load(broker, session, id);
      if (checkpoint.session === session.id || session.inputImports?.includes(id)) continue;
      notices.push(
        await importCheckpoint(
          broker,
          session,
          id,
          "Inherited input references from the thread's declared context lineage.",
        ),
      );
    }
    session.inputLineage = [...new Set([...(session.inputLineage ?? []), ...boundaries])];
    const state = await inputs(broker, session);
    session.inputRecovery = state.recovery ?? "revalidation-required";
    if (state.recovery !== "complete" || !state.fresh)
      notices.push(
        `Peer inputs: ${state.recovery ?? "revalidation-required"}; ${state.stale.length} changed or missing source revisions. Run peer inputs changes for the retained checkpoint and re-read affected contexts.`,
      );
    await broker.saveMemories();
    return notices.length === 0 ? null : notices.join("\n");
  } catch (error) {
    return unavailable(broker, session, messageOf(error));
  }
}

export async function inputCommand(
  broker: CoordinationBroker,
  session: LocalSession,
  args: CommandArguments,
): Promise<string> {
  const action = args.plain[0] ?? "status";
  const drop = args.flag("--drop");
  if (drop !== undefined && action !== "recover")
    throw usage(
      "dropping an input requires explicit recovery",
      'run peer inputs recover "<why this dependency is no longer needed>" --drop <scope>.',
    );
  if (action === "checkpoint") {
    const id = await saveInputCheckpoint(broker, session);
    return `Input checkpoint ${id}. Use peer inputs changes --since ${id} after returning.`;
  }
  if (action === "import") {
    const id = args.plain[1];
    const reason = args.plain[2];
    if (!id || !reason?.trim())
      throw usage(
        "import needs a checkpoint and reason",
        'run peer inputs import <id> "<reason>".',
      );
    return importCheckpoint(broker, session, id, reason);
  }
  if (action === "recover") {
    const reason = args.plain[1]?.trim();
    if (!reason)
      throw usage(
        "recovery needs a reason",
        `read the required contexts, then peer inputs recover "<what was reconstructed and what is missing>".`,
      );
    if (broker.host.recoverInputs === undefined)
      throw refused("this authority cannot recover inputs", "update Peer and its Hub.");
    const current = await inputs(broker, session);
    const known = new Map(
      [...session.read].map(([scope, read]) => [scope, { scope, version: read.version }]),
    );
    for (const read of current.reads ?? [])
      if ((known.get(read.scope)?.version ?? -1) <= read.version)
        known.set(read.scope, { scope: read.scope, version: read.version });
    // Explicit reconstruction acknowledges only the lineage known at this operation's boundary.
    const lineage =
      session.thread === undefined ? null : await broker.host.contextLineage?.(session.thread);
    const acknowledgedBoundaries = (lineage?.sources ?? []).map((source) =>
      lineageBoundary(broker, session, source),
    );
    if (drop !== undefined && !known.has(drop))
      throw usage(
        "that scope is not a declared input",
        "run peer inputs status and use its exact scope.",
      );
    const recovered = await hubWrite(
      "inputs",
      () =>
        broker.host.recoverInputs!(
          session.workspace,
          session.project,
          session.id,
          drop === undefined ? reason : `Explicitly removed dependency ${drop}. ${reason}`,
          [...known.values()]
            .filter((read) => read.scope !== drop)
            .map(({ scope, version }) => ({ scope, version })),
          "reconstructed",
          newOp(),
        ),
      nextStep,
    );
    session.inputRecovery = recovered.recovery ?? "unavailable";
    if (drop !== undefined) session.read.delete(drop);
    session.inputLineage = [
      ...new Set([...(session.inputLineage ?? []), ...acknowledgedBoundaries]),
    ];
    await broker.saveMemories();
    await checkpointInputs(broker, session);
    return `Input recovery: ${recovered.recovery ?? "unavailable"}.${drop === undefined ? "" : ` Removed declared input ${neutral(drop)} with the recorded reason.`} This records an explicit reconstructed baseline; it does not verify the content of any source.`;
  }
  if (action !== "status" && action !== "changes")
    throw usage("unknown inputs action", "run peer inputs [checkpoint|changes|recover|import].");
  const current = await inputs(broker, session);
  let id =
    args.flag("--since") ??
    (action === "changes" ? await head(broker, session, session.id) : undefined);
  if (action === "changes" && id === undefined)
    throw refused("no input checkpoint is available", nextStep);
  if (id === undefined && (current.reads?.length ?? 0) > PAGE)
    id = await saveInputCheckpoint(broker, session);
  const checkpoint = id === undefined ? undefined : await load(broker, session, id);
  const incompleteBaseline = checkpoint !== undefined && checkpoint.recovery !== "complete";
  const reads = (checkpoint?.reads ?? current.reads ?? []).toSorted((a, b) =>
    a.scope.localeCompare(b.scope),
  );
  const page = Number(args.flag("--page") ?? 1);
  if (!Number.isSafeInteger(page) || page < 1)
    throw usage("invalid inputs page", "use --page 1 or a later positive page.");
  const selected = reads.slice((page - 1) * PAGE, page * PAGE);
  const lines = await Promise.all(
    selected.map(async (read) => {
      try {
        const now = await broker.host.readContext(session.workspace, session.project, read.scope);
        if (now === null)
          return `${neutral(read.scope)}: source unavailable (required v${read.version}).`;
        if (now.version === read.version)
          return `${neutral(read.scope)}: unchanged v${read.version} (revision match, not semantic verification).`;
        const old = await broker.host.readContextVersion(
          session.workspace,
          session.project,
          read.scope,
          read.version,
        );
        return `${neutral(read.scope)}: v${read.version} → v${now.version}; ${old === null ? "original revision unavailable; exact comparison is not possible" : "original revision available"}. Read peer context ${neutral(read.scope.replace(/^task:/, ""))}.`;
      } catch {
        return `${neutral(read.scope)}: source unavailable; no freshness claim.`;
      }
    }),
  );
  return [
    `Inputs: ${current.recovery ?? "revalidation-required"}; ${incompleteBaseline || lines.some((line) => line.includes("unavailable")) ? "comparison unavailable for some sources; no freshness claim" : current.fresh ? "declared revisions match" : "revalidation required"}.`,
    ...(checkpoint === undefined ? [] : [`Since ${checkpoint.at}, checkpoint ${id}.`]),
    ...(incompleteBaseline
      ? [
          `Baseline coverage: ${checkpoint!.recovery}; missing historical evidence cannot establish that nothing changed.`,
        ]
      : []),
    ...lines,
    `Coverage: ${selected.length} of ${reads.length} inputs, page ${page}.`,
    ...(page * PAGE < reads.length
      ? [
          `Next: peer inputs ${action}${id === undefined ? "" : ` --since ${id}`} --page ${page + 1}`,
        ]
      : []),
  ].join("\n");
}
