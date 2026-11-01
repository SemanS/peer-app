// @effect-diagnostics nodeBuiltinImport:off globalDate:off - one environment's private durable coordination state.
import * as NodeCrypto from "node:crypto";
import type { PeerCoordEvent } from "@t3tools/contracts";
import {
  type HubCoordSession,
  type HubCoordView,
  type HubIntentAnswer,
  type HubIntentRequest,
  type HubOverlap,
  type ReportedSession,
} from "../hub/coordApi.ts";
import { decodeStored, empty } from "./localStore.ts";
import { LocalStateStorage } from "./LocalStateStorage.ts";
import { generatedFile, touches } from "../coordination/edits.ts";

const localEmail = "local";
const live = (session: HubCoordSession) => session.status !== "done";
const paths = (session: HubCoordSession) =>
  [...session.files, ...session.claims].filter((p) => !generatedFile(p));

/** One authority per environment. Runtime claims are ephemeral; history commits before a mutation answers. */
export class LocalAuthority {
  private state = empty();
  private sessions: HubCoordSession[] = [];
  private intents = new Map<string, readonly string[]>();
  private pending: Promise<unknown> = Promise.resolve();
  private ready: Promise<void> | undefined;
  private agreements: readonly string[] = [];

  private readonly storage: LocalStateStorage;
  readonly environment: string;
  private readonly now: () => string;

  constructor(file: string, environment: string, now = () => new Date().toISOString()) {
    this.storage = new LocalStateStorage(file);
    this.environment = environment;
    this.now = now;
  }

  private async load() {
    const stored = await this.storage.load(decodeStored);
    if (stored === null) return;
    this.state = stored;
    // A previous process cannot retain a lease.
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
    };
  }

  private access<A>(work: () => A, write = false): Promise<A> {
    const ready = (this.ready ??= this.load());
    const result = this.pending
      .then(() => ready)
      .then(async () => {
        this.storage.assertHealthy();
        const before = this.state;
        const sessions = this.sessions;
        const intents = new Map(this.intents);
        const agreements = this.agreements;
        try {
          const answer = work();
          if (write && this.state !== before) {
            await this.storage.save(this.state);
          }
          return structuredClone(answer);
        } catch (error) {
          this.state = before;
          this.sessions = sessions;
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
  }

  private snapshot(): HubCoordView {
    return {
      sessions: this.sessions,
      overlaps: this.state.overlaps,
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
      // Automatic intents belong to a live runtime, not to its heartbeat payload.
      this.intents = new Map([...this.intents].filter(([id]) => !retired.has(id)));
      this.sessions = reported.map((s) => ({
        ...s,
        claims: [...new Set([...s.claims, ...(this.intents.get(s.id) ?? [])])],
        email: localEmail,
        environment: this.environment,
        seenAt: at,
      }));
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
