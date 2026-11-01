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

/** One overlap per pair of sessions in a project, whichever reported first, as on a Hub. */
const overlapId = (project: string, pair: readonly string[]) =>
  NodeCrypto.createHash("sha256")
    .update(JSON.stringify([project, ...pair]))
    .digest("hex")
    .slice(0, 12);

/**
 * One authority per environment. Its sessions, their claims and their overlaps live as long as this
 * process: agents report again after a restart, and the same pair then is the same overlap. Only
 * history is kept on disk, and it commits before a report answers.
 */
export class LocalAuthority {
  private state = empty();
  private sessions: HubCoordSession[] = [];
  private overlaps: HubOverlap[] = [];
  private intents = new Map<string, readonly string[]>();
  private pending: Promise<unknown> = Promise.resolve();
  private ready: Promise<void> | undefined;

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
    if (stored !== null) this.state = stored;
  }

  private access<A>(work: () => A, write = false): Promise<A> {
    const ready = (this.ready ??= this.load());
    const result = this.pending
      .then(() => ready)
      .then(async () => {
        this.storage.assertHealthy();
        const before = this.state;
        const sessions = this.sessions;
        const overlaps = this.overlaps;
        const intents = new Map(this.intents);
        try {
          const answer = work();
          if (write && this.state !== before) {
            await this.storage.save(this.state);
          }
          return structuredClone(answer);
        } catch (error) {
          this.state = before;
          this.sessions = sessions;
          this.overlaps = overlaps;
          this.intents = intents;
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

  private session(project: string, id: string) {
    const session = this.sessions.find((s) => s.id === id && s.project === project && live(s));
    if (session === undefined)
      throw new Error(
        "This local agent session is no longer active. Report it again before continuing.",
      );
    return session;
  }

  /** The overlaps of the sessions at work: those of a pair that shares paths now, and only those. */
  private reconcile() {
    const at = this.now();
    const sessions = this.sessions.filter(live);
    const found: HubOverlap[] = [];
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
        const id = overlapId(first.project, pair);
        const previous = this.overlaps.find((overlap) => overlap.id === id);
        if (previous?.files.join("\0") === files.join("\0")) {
          found.push(previous);
          continue;
        }
        found.push({
          id,
          project: first.project,
          sessions: pair,
          files,
          openedAt: previous?.openedAt ?? at,
          updatedAt: at,
        });
        this.event(first.project, "overlap", { overlap: id, paths: files, participants: pair });
      }
    }
    this.overlaps = found;
  }

  private snapshot(): HubCoordView {
    return { sessions: this.sessions, overlaps: this.overlaps, at: this.now() };
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
      const overlaps = this.overlaps.filter(
        (o) => o.project === project && o.sessions.includes(session.id),
      );
      return {
        at: this.now(),
        overlaps,
        verdicts: request.paths.map((path) => {
          const relevant = overlaps.filter((o) => o.files.some((p) => touches(path, p)));
          return {
            path,
            verdict: relevant.length === 0 ? "clear" : "notify",
            with: [
              ...new Set(relevant.flatMap((o) => o.sessions.filter((id) => id !== session.id))),
            ],
            overlaps: relevant.map((o) => o.id),
          };
        }),
      };
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
