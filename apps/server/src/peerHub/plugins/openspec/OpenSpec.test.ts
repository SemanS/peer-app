import { expect, it } from "@effect/vitest";
import { EnvironmentId, PeerHubError, type PeerProject, type PeerTask } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import { PeerHubClient } from "../../core/hub/PeerHubClient.ts";
import {
  PeerState,
  EMPTY_PERSISTED,
  type PersistedWorkspace,
  type RuntimeState,
} from "../../core/state/PeerState.ts";
import { PeerWork } from "../../core/work/PeerWork.ts";
import * as OpenSpec from "./OpenSpec.ts";

const task: PeerTask = {
  id: "task",
  title: "Task",
  status: "open",
  createdBy: "a@b.c",
  createdAt: "now",
  updatedAt: "now",
};
const project: PeerProject = {
  id: "app",
  name: "App",
  role: "member",
  members: [],
  repositories: [{ id: "app", url: "url", branch: "main" }],
  knowledge: { kontext: false, company: false },
  tools: [],
  capacity: { personal: "any", personalHarnesses: [] },
};
const workspace: PersistedWorkspace = {
  slug: "team",
  name: "Team",
  role: "member",
  allowedDomains: [],
  manifest: null,
  lastSyncAt: null,
};
const runtime: RuntimeState = {
  persisted: EMPTY_PERSISTED,
  syncing: false,
  error: null,
  workspaceErrors: new Map(),
  checkouts: new Map(),
  knowledge: new Map(),
  work: new Map(),
  localThreads: new Map(),
};
const input = { workspace: "team", projectId: "app", taskId: "task" };
function fixture(
  options: {
    signedIn?: boolean;
    membership?: boolean;
    tasks?: readonly PeerTask[];
    repositories?: PeerProject["repositories"];
    cloning?: boolean;
  } = {},
) {
  return OpenSpec.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(PeerHubClient)({
          api: new Proxy({} as PeerHubClient["Service"]["api"], {
            get: () => {
              throw new Error("Source reads must not call a Hub mutation.");
            },
          }),
          hubUrl: () => "https://hub.test",
          session:
            options.signedIn === false
              ? Effect.fail(new PeerHubError({ detail: "Sign in first." }))
              : Effect.succeed({ hubUrl: "https://hub.test", session: "session" }),
        }),
        Layer.mock(PeerState)({
          environmentId: EnvironmentId.make("test"),
          workspaceRoot: "/absent",
          hubHome: "/absent",
          lock: Semaphore.makeUnsafe(1),
          knowledgePath: () => "/absent",
          current: () => runtime,
          nameOf: (_workspace, email) => email,
          projectOfPath: () => undefined,
          pluginData: () => {
            throw new Error("Not used by source reads");
          },
          project: () =>
            options.membership === false
              ? Effect.fail(new PeerHubError({ detail: "Not a member." }))
              : Effect.succeed({
                  workspace,
                  project: {
                    ...project,
                    repositories: options.repositories ?? project.repositories,
                  },
                }),
          read: Effect.succeed({
            ...runtime,
            checkouts: options.cloning
              ? new Map([["/absent-repository", { state: "cloning" as const }]])
              : new Map(),
          }),
          checkoutPath: () => "/absent-repository",
        }),
        Layer.mock(PeerWork)({
          runtimeOf: () => null,
          tasks: () => Effect.succeed(options.tasks ?? [task]),
        }),
      ),
    ),
  );
}
it.effect("refuses signed-out callers, nonmembers, another project's tasks and repositories", () =>
  Effect.gen(function* () {
    for (const options of [{ signedIn: false }, { membership: false }, { tasks: [] }]) {
      const result = yield* Effect.gen(function* () {
        return yield* (yield* OpenSpec.OpenSpec).read(input);
      }).pipe(Effect.provide(fixture(options)), Effect.result);
      expect(result._tag).toBe("Failure");
    }
    const result = yield* Effect.gen(function* () {
      return yield* (yield* OpenSpec.OpenSpec).read({ ...input, repositoryId: "other" });
    }).pipe(Effect.provide(fixture()), Effect.result);
    expect(result._tag).toBe("Failure");
  }),
);
it.effect(
  "requires an explicit repository when ambiguous and explains absent or cloning repositories",
  () =>
    Effect.gen(function* () {
      for (const options of [
        { repositories: [] },
        { repositories: [...project.repositories, { id: "other", url: "url", branch: "main" }] },
        { cloning: true },
        {},
      ]) {
        const result = yield* Effect.gen(function* () {
          return yield* (yield* OpenSpec.OpenSpec).read(input);
        }).pipe(Effect.provide(fixture(options)));
        expect(result).toMatchObject({ state: "unavailable", code: "source-unavailable" });
      }
    }),
);
