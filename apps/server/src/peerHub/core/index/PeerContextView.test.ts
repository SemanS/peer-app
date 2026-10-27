// @effect-diagnostics nodeBuiltinImport:off - isolated authority state; never touches the running environment.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect } from "vite-plus/test";
import { describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  PEER_LOCAL_WORKSPACE,
  PeerHubError,
  type PeerHubStatus,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Option from "effect/Option";
import * as PeerCoordination from "../coordination/PeerCoordination.ts";
import * as PeerState from "../state/PeerState.ts";
import * as PeerStatus from "../status/PeerStatus.ts";
import { LocalAuthority } from "../localCoordination/LocalAuthority.ts";
import { PeerContextView, layer } from "./PeerContextView.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => NodeFSP.rm(dir, { recursive: true, force: true })));
});
const at = "2026-10-26T12:00:00.000Z";
const metadata = (scope: string) => ({
  workspace: "team",
  project: "app",
  scope,
  version: 1,
  updatedAt: at,
  bytes: 20,
});

function serving(
  options: {
    local?: LocalAuthority;
    disabled?: boolean;
    hubUrl?: string;
    signedIn?: boolean;
    workspaceError?: boolean;
    unsupportedFindings?: boolean;
    statusFindingCount?: number;
    pendingRead?: PeerCoordination.PeerCoordination["Service"]["pendingFindings"];
    read?: PeerCoordination.PeerCoordination["Service"]["readContext"];
  } = {},
) {
  const workspace = options.local === undefined ? "team" : PEER_LOCAL_WORKSPACE;
  let canonicalReads = 0;
  let attached:
    | Parameters<PeerCoordination.PeerCoordination["Service"]["contextViewsFrom"]>[0]
    | undefined;
  const getStatus = Effect.promise(
    async () =>
      ({
        hubUrl: options.hubUrl ?? "https://hub.webinson.com",
        signedIn: options.signedIn !== false,
        coordination: {
          enabled: options.disabled !== true,
          contexts:
            options.local === undefined
              ? [metadata("task:a"), metadata("task:b"), metadata("task:c")]
              : ((await options.local!.view()).contexts ?? []).map((context) => ({
                  ...context,
                  workspace,
                  bytes: context.bytes ?? 0,
                })),
          findings: Array.from({ length: options.statusFindingCount ?? 0 }, (_, index) => ({
            id: `status-${index}`,
            workspace,
            project: "app",
            text: `Cached finding ${index}`,
            email: "cached@example.test",
            at,
          })),
        },
        workspaces: [
          {
            slug: workspace,
            projects: [
              {
                project: { id: "app" },
                work: {
                  tasks: [
                    { id: "new", title: "Work without a keeper", status: "open", updatedAt: at },
                  ],
                },
              },
            ],
          },
        ],
      }) as unknown as PeerHubStatus,
  );
  const runtime = {
    persisted: { hubUrl: options.hubUrl ?? null },
    workspaceErrors: new Map(options.workspaceError === true ? [[workspace, "offline"]] : []),
  } as unknown as PeerState.RuntimeState;
  const provided = layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(PeerState.PeerState)({
          environmentId: EnvironmentId.make("test-environment"),
          workspaceRoot: "",
          hubHome: "",
          knowledgePath: () => "",
          current: () => runtime,
          lock: Semaphore.makeUnsafe(1),
          checkoutPath: () => "",
          projectOfPath: () => undefined,
          nameOf: () => "",
          pluginData: () => ({ read: Effect.succeed(Option.none()), update: () => Effect.void }),
          read: Effect.succeed(runtime),
        }),
        Layer.mock(PeerStatus.PeerStatus)({ publish: getStatus }),
        Layer.mock(PeerCoordination.PeerCoordination)({
          paths: {
            dir: "",
            socket: "",
            log: "",
            contexts: "",
            peer: "",
            scripts: { hook: "", wait: "" },
          },
          broker: () => null,
          contextViewsFrom: (readers) =>
            Effect.sync(() => {
              attached = readers;
            }),
          readContext: (input) => {
            canonicalReads++;
            return (
              options.read?.(input) ??
              Effect.promise(async () => {
                const context = await options.local!.readContext(input.project, input.scope);
                return context === null
                  ? null
                  : { ...context, workspace, bytes: context.bytes ?? 0 };
              })
            );
          },
          staleReads: (input) =>
            Effect.promise(() => options.local!.staleReads(input.project, input.session)),
          publishedInputs: (input) =>
            Effect.tryPromise({
              try: () => options.local!.publishedInputs(input.project, input.scope, input.version),
              catch: () => new PeerHubError({ detail: "Publication evidence unavailable" }),
            }),
          pendingFindings: (input) =>
            options.pendingRead?.(input) ??
            Effect.succeed({
              findings: [],
              omittedCount: 0,
              unsupported: options.unsupportedFindings === true,
            }),
        }),
      ),
    ),
  );
  return { provided, workspace, reads: () => canonicalReads, attached: () => attached };
}

describe("current context service", () => {
  it.effect("discovers the default Hub archive using its effective authority", () =>
    Effect.gen(function* () {
      const server = serving();
      const archive = yield* Effect.gen(function* () {
        return yield* (yield* PeerContextView).discover({ workspace: "team", project: "app" });
      }).pipe(Effect.provide(server.provided));
      expect(archive.identity.authority).toBe("https://hub.webinson.com");
      expect(archive.availability).toBe("available");
      expect(archive.entries.some((entry) => entry.scope === "task:new")).toBe(true);
    }),
  );
  it.effect("keeps signed-out and failed Hub archives unavailable", () =>
    Effect.gen(function* () {
      for (const options of [{ signedIn: false }, { workspaceError: true }]) {
        const server = serving(options);
        const archive = yield* Effect.gen(function* () {
          return yield* (yield* PeerContextView).discover({ workspace: "team", project: "app" });
        }).pipe(Effect.provide(server.provided));
        expect(archive.availability).toBe("unavailable");
      }
    }),
  );
  it.effect(
    "reads the published author's durable inputs after Local restart without a keeper",
    () =>
      Effect.gen(function* () {
        const dir = yield* Effect.promise(() =>
          NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-published-inputs-")),
        );
        dirs.push(dir);
        const file = NodePath.join(dir, "state.json");
        const local = new LocalAuthority(file, "test-environment", () => at);
        yield* Effect.promise(async () => {
          await local.report([
            {
              id: "author",
              project: "app",
              label: "author",
              status: "working",
              files: [],
              claims: [],
            },
          ]);
          const kept = await local.keepContext("app", "project", "author", false);
          if ("refused" in kept) throw new Error("keeper refused");
          await local.writeContext(
            "app",
            "project",
            "author",
            0,
            "## Provides\n- Result",
            kept.epoch,
          );
          await local.contextRead("app", "project", "author", 1, "read-result");
          await local.writeContext(
            "app",
            "project",
            "author",
            1,
            "## Provides\n- Updated result",
            kept.epoch,
          );
          await local.report([]);
        });
        const restarted = new LocalAuthority(file, "test-environment", () => at);
        const server = serving({ local: restarted });
        const result = yield* Effect.gen(function* () {
          return yield* (yield* PeerContextView).read({
            workspace: server.workspace,
            project: "app",
            scope: "project",
          });
        }).pipe(Effect.provide(server.provided));
        expect(result.inputs.state).toBe("complete");
        expect(result.inputs.required).toEqual([
          { scope: "project", revision: 2, currentRevision: 2, observedAt: at },
        ]);
        expect((yield* Effect.promise(() => restarted.view())).sessions).toEqual([]);
        yield* Effect.promise(async () => {
          await restarted.report([
            { id: "next", project: "app", label: "next", status: "working", files: [], claims: [] },
          ]);
          await restarted.keepContext("app", "project", "next", false);
        });
        const afterHandoff = yield* Effect.gen(function* () {
          return yield* (yield* PeerContextView).read({
            workspace: server.workspace,
            project: "app",
            scope: "project",
          });
        }).pipe(Effect.provide(server.provided));
        expect(afterHandoff.inputs).toEqual(result.inputs);
        yield* Effect.promise(() => restarted.restoreContext("app", "project", 1));
        const restored = yield* Effect.gen(function* () {
          return yield* (yield* PeerContextView).read({
            workspace: server.workspace,
            project: "app",
            scope: "project",
          });
        }).pipe(Effect.provide(server.provided));
        expect(restored.inputs.state).toBe("unavailable");
      }),
  );
  it.effect(
    "reads Local while offline with optional plugins absent and exposes the same registered command service",
    () =>
      Effect.gen(function* () {
        const local = yield* Effect.promise(async () => {
          const dir = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-view-"));
          dirs.push(dir);
          const authority = new LocalAuthority(
            NodePath.join(dir, "state.json"),
            "test-environment",
            () => at,
          );
          await authority.report([
            {
              id: "writer",
              project: "app",
              runtimeGeneration: "one",
              label: "writer",
              status: "working",
              files: [],
              claims: [],
            },
          ]);
          const kept = await authority.keepContext("app", "project", "writer", false);
          if ("refused" in kept) throw new Error("keeper refused");
          await authority.writeContext(
            "app",
            "project",
            "writer",
            0,
            "## Provides\n- Offline result\n## Next\n- Review it",
            kept.epoch,
          );
          return authority;
        });
        const server = serving({ local });
        yield* Effect.gen(function* () {
          const view = yield* PeerContextView;
          const result = yield* view.read({
            workspace: server.workspace,
            project: "app",
            scope: "project",
            session: "writer",
          });
          expect(result.identity.backend).toBe("local");
          expect(result.current.outcome[0]?.text).toBe("Offline result");
          expect(result.verifiedAt).toBeNull();
          expect(server.attached()).toBeDefined();
          expect(
            (yield* server
              .attached()!
              .read({ workspace: server.workspace, project: "app", scope: "project" })).current,
          ).toEqual(result.current);
          const aggregate = yield* view.read({
            workspace: server.workspace,
            project: "app",
            scope: "project-aggregate",
          });
          expect(aggregate.identity.scope).toBe("project-aggregate");
          expect(
            aggregate.current.goal.some((value) => value.text === "Work without a keeper"),
          ).toBe(true);
          expect(
            aggregate.current.outcome.some((value) => value.text.includes("1 open tasks")),
          ).toBe(true);
        }).pipe(Effect.provide(server.provided));
      }),
  );
  it.effect("keeps unavailable, forbidden and empty source observations separate", () =>
    Effect.gen(function* () {
      const server = serving({
        read: (input) =>
          input.scope === "task:a"
            ? Effect.fail(new PeerHubError({ detail: "offline" }))
            : input.scope === "task:b"
              ? Effect.fail(new PeerHubError({ detail: "access revoked", status: 403 }))
              : Effect.succeed(null),
      });
      yield* Effect.gen(function* () {
        const view = yield* (yield* PeerContextView).read({
          workspace: "team",
          project: "app",
          scope: "project-aggregate",
        });
        expect(view.sources.find((source) => source.scope === "task:a")?.availability).toBe(
          "unavailable",
        );
        expect(view.sources.find((source) => source.scope === "task:b")?.availability).toBe(
          "forbidden",
        );
        expect(view.sources.find((source) => source.scope === "task:c")?.availability).toBe(
          "empty",
        );
        expect(view.inputs.state).toBe("unavailable");
      }).pipe(Effect.provide(server.provided));
    }),
  );
  it.effect("returns readable canonical finding pages beyond the status window", () =>
    Effect.gen(function* () {
      const server = serving({
        read: () => Effect.succeed(null),
        statusFindingCount: 200,
        pendingRead: () =>
          Effect.succeed({
            findings: [
              {
                id: "finding-201",
                text: "Canonical text outside the status window",
                email: "author@example.test",
                at,
                project: "app",
                session: "writer",
                environment: "remote",
                task: "a",
              },
            ],
            omittedCount: 0,
            nextCursor: null,
          }),
      });
      const result = yield* Effect.gen(function* () {
        return yield* (yield* PeerContextView).read({
          workspace: "team",
          project: "app",
          scope: "task:a",
          findingCursor: "after-200",
        });
      }).pipe(Effect.provide(server.provided));
      expect(result.pendingFindings.items).toEqual([
        {
          id: "finding-201",
          text: "Canonical text outside the status window",
          email: "author@example.test",
          at,
          scope: "task:a",
        },
      ]);
      expect(result.pendingFindings.ids).toEqual(["finding-201"]);
    }),
  );
  it.effect("does not treat unsupported old-Hub finding coverage as empty", () =>
    Effect.gen(function* () {
      const server = serving({ read: () => Effect.succeed(null), unsupportedFindings: true });
      const result = yield* Effect.gen(function* () {
        return yield* (yield* PeerContextView).read({
          workspace: "team",
          project: "app",
          scope: "project",
        });
      }).pipe(Effect.provide(server.provided));
      expect(result.pendingFindings.availability).toBe("unavailable");
    }),
  );
  it.effect("does not call a disabled authority and limits aggregate canonical reads", () =>
    Effect.gen(function* () {
      const disabled = serving({ disabled: true });
      yield* Effect.gen(function* () {
        const result = yield* (yield* PeerContextView).read({
          workspace: "team",
          project: "app",
          scope: "task:a",
        });
        expect(result.sources.every((source) => source.availability === "disabled")).toBe(true);
      }).pipe(Effect.provide(disabled.provided));
      expect(disabled.reads()).toBe(0);
      const limited = serving({ read: () => Effect.succeed(null) });
      yield* Effect.gen(function* () {
        const result = yield* (yield* PeerContextView).read({
          workspace: "team",
          project: "app",
          scope: "project-aggregate",
          limit: 2,
        });
        expect(result.coverage.omittedCount).toBe(2);
        expect(result.coverage.nextCursor).not.toBeNull();
      }).pipe(Effect.provide(limited.provided));
      expect(limited.reads()).toBe(2);
    }),
  );
});
