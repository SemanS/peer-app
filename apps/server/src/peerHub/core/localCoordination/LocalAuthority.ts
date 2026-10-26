// @effect-diagnostics nodeBuiltinImport:off globalDate:off - one environment's private durable coordination state.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import {
  PeerCoordEvent,
  PeerOverlapRecord,
  type PeerContextRead,
  type PeerStaleReads,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import {
  HubContextText,
  HubContextVersionText,
  HubFinding,
  type ContextRefusal,
  type HubContextVersion,
  type HubCoordSession,
  type HubCoordView,
  type HubIntentAnswer,
  type HubIntentRequest,
  type HubOverlap,
  type ReportedSession,
} from "../hub/coordApi.ts";
import { generatedFile, touches } from "../coordination/edits.ts";

const Stored = Schema.Struct({
  version: Schema.Literal(1),
  overlaps: Schema.Array(PeerOverlapRecord),
  contexts: Schema.Record(Schema.String, HubContextText),
  versions: Schema.Record(Schema.String, Schema.Array(HubContextVersionText)),
  findings: Schema.Array(HubFinding),
  events: Schema.Array(PeerCoordEvent),
  operations: Schema.Array(
    Schema.Struct({ key: Schema.String, input: Schema.String, result: Schema.String }),
  ),
});
const decodeStored = Schema.decodeUnknownSync(Stored);
type Stored = typeof Stored.Type;
const empty = (): Stored => ({
  version: 1,
  overlaps: [],
  contexts: {},
  versions: {},
  findings: [],
  events: [],
  operations: [],
});
const keyOf = (project: string, scope: string) => JSON.stringify([project, scope]);
const localEmail = "local";
const live = (session: HubCoordSession) => session.status !== "done";
const paths = (session: HubCoordSession) =>
  [...session.files, ...session.claims].filter((p) => !generatedFile(p));

/** One authority per environment. Runtime claims are ephemeral; history commits before a mutation answers. */
export class LocalAuthority {
  private state = empty();
  private sessions: HubCoordSession[] = [];
  private reads: PeerContextRead[] = [];
  private intents = new Map<string, readonly string[]>();
  private pending: Promise<unknown> = Promise.resolve();
  private ready: Promise<void> | undefined;
  private agreements: readonly string[] = [];

  private readonly file: string;
  readonly environment: string;
  private readonly now: () => string;

  constructor(file: string, environment: string, now = () => new Date().toISOString()) {
    this.file = file;
    this.environment = environment;
    this.now = now;
  }

  private async load() {
    const text = await NodeFSP.readFile(this.file, "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (text === null) return;
    this.state = decodeStored(JSON.parse(text));
    // A previous process cannot retain a lease. Epochs fence its delayed writes after a restart.
    this.state = {
      ...this.state,
      overlaps: this.state.overlaps.map((overlap) =>
        overlap.state === "open"
          ? {
              ...overlap,
              state: "resolved" as const,
              resolution: "The local agent runtimes ended before Peer restarted.",
              updatedAt: this.now(),
            }
          : overlap,
      ),
      contexts: Object.fromEntries(
        Object.entries(this.state.contexts).map(([key, context]) => {
          const { keeper: _keeper, ...rest } = context;
          return [key, { ...rest, epoch: (context.epoch ?? 0) + 1 }];
        }),
      ),
    };
  }

  private access<A>(work: () => A, write = false): Promise<A> {
    const ready = (this.ready ??= this.load());
    const result = this.pending
      .then(() => ready)
      .then(async () => {
        const before = this.state;
        const sessions = this.sessions;
        const reads = this.reads;
        const intents = this.intents;
        const agreements = this.agreements;
        try {
          const answer = work();
          if (write && this.state !== before) {
            await NodeFSP.mkdir(NodePath.dirname(this.file), { recursive: true, mode: 0o700 });
            const temp = `${this.file}.${NodeCrypto.randomUUID()}.tmp`;
            try {
              await NodeFSP.writeFile(temp, JSON.stringify(this.state), { mode: 0o600 });
              await NodeFSP.rename(temp, this.file);
            } finally {
              await NodeFSP.rm(temp, { force: true });
            }
          }
          return structuredClone(answer);
        } catch (error) {
          this.state = before;
          this.sessions = sessions;
          this.reads = reads;
          this.intents = intents;
          this.agreements = agreements;
          throw error;
        }
      });
    // A corrupt state file must keep refusing; a failed individual operation must not poison the queue.
    this.pending = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private event(project: string, kind: string, fields: Partial<PeerCoordEvent> = {}) {
    this.state = {
      ...this.state,
      events: [
        ...this.state.events,
        {
          id: NodeCrypto.randomUUID(),
          kind,
          project,
          at: this.now(),
          email: localEmail,
          environment: this.environment,
          paths: [],
          participants: [],
          ...fields,
        },
      ].slice(-2000),
    };
  }

  private once<A>(
    kind: string,
    scope: readonly unknown[],
    op: string | undefined,
    input: unknown,
    run: () => A,
  ): A {
    if (op === undefined) return run();
    const key = JSON.stringify([kind, ...scope, op]);
    const fingerprint = JSON.stringify(input);
    const previous = this.state.operations.find((item) => item.key === key);
    if (previous !== undefined) {
      if (previous.input !== fingerprint)
        throw new Error("This operation id was already used with different input.");
      return JSON.parse(previous.result) as A;
    }
    const result = run();
    this.state = {
      ...this.state,
      operations: [
        ...this.state.operations,
        { key, input: fingerprint, result: JSON.stringify(result) },
      ].slice(-1000),
    };
    return result;
  }

  private session(project: string, id: string) {
    const session = this.sessions.find((s) => s.id === id && s.project === project && live(s));
    if (session === undefined)
      throw new Error(
        "This local agent session is no longer active. Report it again before continuing.",
      );
    return session;
  }

  private overlap(project: string, id: string) {
    const overlap = this.state.overlaps.find((o) => o.id === id && o.project === project);
    if (overlap === undefined) throw new Error("This local overlap no longer exists.");
    return overlap;
  }

  private saveOverlap(overlap: HubOverlap) {
    if (this.state.overlaps.includes(overlap)) return overlap;
    this.state = {
      ...this.state,
      overlaps: [...this.state.overlaps.filter((o) => o.id !== overlap.id), overlap],
    };
    return overlap;
  }

  private reconcile() {
    const at = this.now();
    const found = new Set<string>();
    const sessions = this.sessions.filter(live);
    for (let a = 0; a < sessions.length; a += 1) {
      const first = sessions[a]!;
      for (const second of sessions.slice(a + 1)) {
        if (first.project !== second.project) continue;
        const files = [
          ...new Set(
            paths(first).flatMap((x) =>
              paths(second)
                .filter((y) => touches(x, y))
                .map((y) => (x.endsWith("/") ? y : x)),
            ),
          ),
        ].sort();
        if (files.length === 0) continue;
        const pair = [first.id, second.id].sort();
        const previous = this.state.overlaps.find(
          (o) =>
            o.project === first.project &&
            o.sessions.join("\0") === pair.join("\0") &&
            o.state === "open",
        );
        // A resolved agreement applies while these exact participants still hold the same paths.
        const resolved = this.state.overlaps.find(
          (o) =>
            this.agreements.includes(o.id) &&
            o.project === first.project &&
            o.state === "resolved" &&
            o.sessions.join("\0") === pair.join("\0") &&
            files.every((p) => o.resolvedFiles?.includes(p)),
        );
        if (previous === undefined && resolved !== undefined) continue;
        const sameFiles = previous?.files.join("\0") === files.join("\0");
        const filesAt =
          previous?.filesAt === undefined
            ? at
            : new Date(Math.max(Date.parse(at), Date.parse(previous.filesAt) + 1)).toISOString();
        const overlap: HubOverlap =
          previous === undefined
            ? {
                id: NodeCrypto.randomUUID(),
                project: first.project,
                sessions: pair,
                files,
                state: "open",
                notes: [],
                openedAt: at,
                updatedAt: at,
                filesAt: at,
                acks: {},
              }
            : sameFiles
              ? previous
              : { ...previous, files, filesAt, acks: {}, updatedAt: at };
        found.add(overlap.id);
        this.saveOverlap(overlap);
        if (previous === undefined)
          this.event(first.project, "overlap.opened", {
            overlap: overlap.id,
            paths: files,
            participants: pair,
          });
      }
    }
    for (const overlap of this.state.overlaps) {
      if (overlap.state !== "open" || found.has(overlap.id)) continue;
      this.saveOverlap({
        ...overlap,
        state: "resolved",
        resolution: "No active sessions still share these paths.",
        updatedAt: at,
      });
      this.event(overlap.project, "overlap.resolved", {
        overlap: overlap.id,
        paths: overlap.files,
        participants: overlap.sessions,
      });
    }
    for (const [key, context] of Object.entries(this.state.contexts)) {
      if (
        context.keeper === undefined ||
        sessions.some((s) => s.id === context.keeper?.session && s.project === context.project)
      )
        continue;
      const { keeper: _keeper, ...rest } = context;
      this.state = {
        ...this.state,
        contexts: { ...this.state.contexts, [key]: { ...rest, epoch: (context.epoch ?? 0) + 1 } },
      };
    }
  }

  private snapshot(): HubCoordView {
    return {
      sessions: this.sessions,
      overlaps: this.state.overlaps,
      contexts: Object.values(this.state.contexts),
      findings: this.state.findings,
      at: this.now(),
    };
  }

  view = () => this.access(() => this.snapshot());

  report = (reported: readonly ReportedSession[]) =>
    this.access(() => {
      const at = this.now();
      const retired = new Set(
        this.sessions
          .filter(
            (old) =>
              !reported.some(
                (s) =>
                  s.id === old.id &&
                  s.project === old.project &&
                  s.runtimeGeneration === old.runtimeGeneration &&
                  s.status !== "done",
              ),
          )
          .map((s) => s.id),
      );
      for (const overlap of this.state.overlaps) {
        if (overlap.state === "open" && overlap.sessions.some((id) => retired.has(id))) {
          this.saveOverlap({
            ...overlap,
            state: "resolved",
            resolution: "An agent runtime ended.",
            updatedAt: at,
          });
        }
      }
      this.agreements = this.agreements.filter(
        (id) => !this.state.overlaps.find((o) => o.id === id)?.sessions.some((s) => retired.has(s)),
      );
      for (const context of Object.values(this.state.contexts)) {
        if (context.keeper !== undefined && retired.has(context.keeper.session)) {
          const { keeper: _keeper, ...rest } = context;
          this.saveContext({ ...rest, epoch: (context.epoch ?? 0) + 1 });
        }
      }
      this.reads = this.reads.filter((r) => !retired.has(r.session));
      // Automatic intents belong to a live runtime, not to its heartbeat payload.
      this.intents = new Map([...this.intents].filter(([id]) => !retired.has(id)));
      this.sessions = reported.map((s) => ({
        ...s,
        claims: [...new Set([...s.claims, ...(this.intents.get(s.id) ?? [])])],
        email: localEmail,
        environment: this.environment,
        seenAt: at,
      }));
      for (const session of reported)
        for (const text of session.findings ?? []) {
          if (this.state.findings.some((f) => f.project === session.project && f.text === text))
            continue;
          this.state = {
            ...this.state,
            findings: [
              ...this.state.findings,
              {
                id: NodeCrypto.randomUUID(),
                project: session.project,
                text,
                email: localEmail,
                session: session.id,
                environment: this.environment,
                at,
              },
            ],
          };
        }
      this.reconcile();
      return this.snapshot();
    }, true);

  intent = (project: string, request: HubIntentRequest): Promise<HubIntentAnswer> =>
    this.access(() => {
      if (request.environment !== this.environment)
        throw new Error("Local coordination belongs to this environment.");
      const session = this.session(project, request.session);
      if (
        request.paths.length > 50 ||
        request.paths.some((p) => p === "" || p.startsWith("/") || p.split("/").includes(".."))
      )
        throw new Error("Use at most 50 repository-relative paths.");
      this.intents = new Map(this.intents).set(session.id, [
        ...new Set([...(this.intents.get(session.id) ?? []), ...request.paths]),
      ]);
      this.sessions = this.sessions.map((s) =>
        s === session ? { ...s, claims: [...new Set([...s.claims, ...request.paths])] } : s,
      );
      this.reconcile();
      const policy = request.policy ?? "coordinate";
      const overlaps = this.state.overlaps.filter(
        (o) => o.project === project && o.state === "open" && o.sessions.includes(session.id),
      );
      return {
        policy,
        policySource: "client",
        at: this.now(),
        overlaps,
        verdicts: request.paths.map((path) => {
          const relevant = overlaps.filter((o) => o.files.some((p) => touches(path, p)));
          const pending = relevant.some((o) => o.acks?.[session.id] === undefined);
          return {
            path,
            verdict: !pending
              ? "clear"
              : policy === "coordinate"
                ? "deny"
                : policy === "ask"
                  ? "ask"
                  : "notify",
            with: [
              ...new Set(relevant.flatMap((o) => o.sessions.filter((id) => id !== session.id))),
            ],
            overlaps: relevant.map((o) => o.id),
          };
        }),
      };
    }, true);

  note = (project: string, id: string, text: string, session?: string, op?: string) =>
    this.access(
      () =>
        this.once("note", [project, id, session], op, text, () => {
          if (session !== undefined) this.session(project, session);
          const overlap = this.overlap(project, id);
          if (session !== undefined && !overlap.sessions.includes(session))
            throw new Error("Only a participant can update this overlap.");
          const at = this.now();
          return this.saveOverlap({
            ...overlap,
            notes: [
              ...overlap.notes,
              {
                id: NodeCrypto.randomUUID(),
                email: localEmail,
                ...(session === undefined ? {} : { session }),
                text,
                at,
              },
            ],
            updatedAt: at,
            acks: {
              ...overlap.acks,
              ...Object.fromEntries(
                (session === undefined ? overlap.sessions : [session]).map((id) => [id, at]),
              ),
            },
          });
        }),
      true,
    );

  resolve = (project: string, id: string, resolution: string, session?: string, op?: string) =>
    this.access(
      () =>
        this.once("resolve", [project, id, session], op, resolution, () => {
          if (session !== undefined) this.session(project, session);
          const overlap = this.overlap(project, id);
          if (session !== undefined && !overlap.sessions.includes(session))
            throw new Error("Only a participant can update this overlap.");
          this.agreements = [...this.agreements, id];
          this.event(project, "overlap.resolved", {
            overlap: id,
            paths: overlap.files,
            participants: overlap.sessions,
            ...(session === undefined ? {} : { session }),
          });
          return this.saveOverlap({
            ...overlap,
            state: "resolved",
            resolution,
            resolvedFiles: overlap.files,
            updatedAt: this.now(),
          });
        }),
      true,
    );

  ack = (project: string, id: string, session: string, _op: string, filesAt?: string) =>
    this.access(() => {
      this.session(project, session);
      const overlap = this.overlap(project, id);
      if (!overlap.sessions.includes(session))
        throw new Error("Only a participant can acknowledge this overlap.");
      if (filesAt !== undefined && filesAt !== overlap.filesAt) return overlap;
      return this.saveOverlap({ ...overlap, acks: { ...overlap.acks, [session]: this.now() } });
    }, true);

  readContext = (project: string, scope: string) =>
    this.access(() => this.state.contexts[keyOf(project, scope)] ?? null);
  private context(project: string, scope: string): HubContextText {
    return (
      this.state.contexts[keyOf(project, scope)] ?? {
        project,
        scope,
        version: 0,
        epoch: 0,
        updatedAt: this.now(),
        text: "",
      }
    );
  }
  private saveContext(context: HubContextText) {
    this.state = {
      ...this.state,
      contexts: { ...this.state.contexts, [keyOf(context.project, context.scope)]: context },
    };
    return context;
  }

  keepContext = (
    project: string,
    scope: string,
    session: string,
    release: boolean,
    epoch?: number,
    _op?: string,
  ): Promise<HubContextText | ContextRefusal> =>
    this.access(() => {
      if (!release) this.session(project, session);
      const current = this.context(project, scope);
      if (
        current.keeper !== undefined &&
        (current.keeper.session !== session || (epoch !== undefined && current.epoch !== epoch))
      )
        return { refused: "kept", keeper: current.keeper };
      if (release) {
        const { keeper: _keeper, ...rest } = current;
        return this.saveContext({ ...rest, epoch: (current.epoch ?? 0) + 1 });
      }
      if (current.keeper !== undefined) return current;
      const nextEpoch = (current.epoch ?? 0) + 1;
      return this.saveContext({
        ...current,
        epoch: nextEpoch,
        keeper: {
          session,
          email: localEmail,
          environment: this.environment,
          since: this.now(),
          epoch: nextEpoch,
        },
      });
    }, true);

  writeContext = (
    project: string,
    scope: string,
    session: string,
    baseVersion: number,
    text: string,
    epoch?: number,
    op?: string,
  ): Promise<HubContextText | ContextRefusal> =>
    this.access(() => {
      this.session(project, session);
      const current = this.context(project, scope);
      if (current.keeper?.session !== session || epoch !== current.epoch)
        return { refused: "kept", keeper: current.keeper };
      return this.once("context", [project, scope, session, epoch], op, [baseVersion, text], () => {
        if (current.version !== baseVersion) return { refused: "stale" as const, current };
        if (Buffer.byteLength(text) > 256_000)
          throw new Error("Local contexts are limited to 256 KB.");
        return this.appendContext(current, text, session);
      });
    }, true);

  private appendContext(
    current: HubContextText,
    text: string,
    session?: string,
    restoredFrom?: number,
  ) {
    const at = this.now();
    const version = current.version + 1;
    const previous = current.text.split("\n");
    const next = text.split("\n");
    const { updatedSession: _session, restoredFrom: _restoredFrom, ...base } = current;
    const saved = this.saveContext({
      ...base,
      version,
      text,
      bytes: Buffer.byteLength(text),
      gist: next.find((s) => s.trim() !== "") ?? "",
      updatedAt: at,
      updatedBy: localEmail,
      ...(session === undefined ? {} : { updatedSession: session }),
      ...(restoredFrom === undefined ? {} : { restoredFrom }),
    });
    const key = keyOf(current.project, current.scope);
    this.state = {
      ...this.state,
      versions: {
        ...this.state.versions,
        [key]: [
          ...(this.state.versions[key] ?? []),
          {
            version,
            at,
            by: localEmail,
            ...(session === undefined ? {} : { session }),
            ...(restoredFrom === undefined ? {} : { restoredFrom }),
            added: next.filter((s) => !previous.includes(s)),
            dropped: previous.filter((s) => !next.includes(s)),
            text,
          },
        ],
      },
    };
    this.event(current.project, "context.written", {
      scope: current.scope,
      version,
      ...(session === undefined ? {} : { session }),
    });
    return saved;
  }

  contextVersions = (project: string, scope: string): Promise<readonly HubContextVersion[]> =>
    this.access(() =>
      [...(this.state.versions[keyOf(project, scope)] ?? [])]
        .toReversed()
        .map(({ text, added, dropped, ...rest }) => ({
          ...rest,
          bytes: Buffer.byteLength(text),
          added: added.length,
          dropped: dropped.length,
        })),
    );
  readContextVersion = (project: string, scope: string, version: number) =>
    this.access(
      () => this.state.versions[keyOf(project, scope)]?.find((v) => v.version === version) ?? null,
    );
  restoreContext = (project: string, scope: string, version: number) =>
    this.access(() => {
      const previous = this.state.versions[keyOf(project, scope)]?.find(
        (v) => v.version === version,
      );
      if (previous === undefined) throw new Error("This context version no longer exists.");
      return this.appendContext(this.context(project, scope), previous.text, undefined, version);
    }, true);
  contextRead = (project: string, scope: string, session: string, version: number, _op: string) =>
    this.access(() => {
      this.session(project, session);
      if (version > this.context(project, scope).version || version < 0)
        throw new Error("This context version does not exist.");
      const read = {
        project,
        scope,
        session,
        environment: this.environment,
        version,
        at: this.now(),
      };
      this.reads = [
        ...this.reads.filter(
          (r) => !(r.project === project && r.scope === scope && r.session === session),
        ),
        read,
      ];
      return read;
    });
  staleReads = (project: string, session: string): Promise<PeerStaleReads> =>
    this.access(() => {
      const reads = this.reads.filter((r) => r.project === project && r.session === session);
      const stale = reads.flatMap((r) => {
        const current = this.state.contexts[keyOf(project, r.scope)];
        return current?.version === r.version
          ? []
          : [
              {
                project,
                scope: r.scope,
                readVersion: r.version,
                currentVersion: current?.version ?? null,
                at: r.at,
                updatedAt: current?.updatedAt ?? null,
              },
            ];
      });
      return { fresh: stale.length === 0, reads, stale };
    });
  coordEvents = (
    project: string,
    filter: {
      readonly task?: string | undefined;
      readonly path?: string | undefined;
      readonly limit?: number | undefined;
    },
  ) =>
    this.access(() =>
      this.state.events
        .filter(
          (event) =>
            event.project === project &&
            (filter.task === undefined || event.task === filter.task) &&
            (filter.path === undefined || event.paths.some((p) => touches(filter.path!, p))),
        )
        .slice(-(filter.limit ?? 100))
        .toReversed(),
    );
}
