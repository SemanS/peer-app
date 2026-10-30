import * as PeerContextView from "./index/PeerContextView.ts";
import * as PeerLog from "./log/PeerLog.ts";
// @effect-diagnostics nodeBuiltinImport:off - peer-hub.json and git repositories in temporary directories, a stand-in Hub on a local port.
/**
 * Peer's core services for tests: the real layers on a temporary state directory, with fakes only
 * at the edges (this environment's id, the secret store keeping the Hub session, a stand-in Hub).
 *
 * @module peerHub/core/testkit
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodePath from "node:path";

import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { FetchHttpClient } from "effect/http";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import { AgentAwarenessRelay } from "../../relay/AgentAwarenessRelay.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as Settings from "../../serverSettings.ts";
import * as PeerAdapters from "./coordination/PeerAdapters.ts";
import * as PeerAgents from "./coordination/PeerAgents.ts";
import * as PeerCoordination from "./coordination/PeerCoordination.ts";
import * as PeerHubClient from "./hub/PeerHubClient.ts";
import * as PeerHubEvents from "./hub/PeerHubEvents.ts";
import * as PeerIndex from "./index/PeerIndex.ts";
import type { PeerPluginEntry } from "./plugin.ts";
import * as PeerPlugins from "./plugins/PeerPlugins.ts";
import { PeerPluginRegistry } from "./registry.ts";
import * as PeerState from "./state/PeerState.ts";
import * as PeerStatus from "./status/PeerStatus.ts";
import * as PeerWork from "./work/PeerWork.ts";
import * as PeerRuns from "./work/runs.ts";
import * as PeerWorkspaces from "./workspaces/PeerWorkspaces.ts";

export const TEST_ENVIRONMENT = EnvironmentId.make("ana-laptop");

/** Where PeerState keeps `peer-hub.json` under a test's base directory. */
export const stateFile = (baseDir: string) => NodePath.join(baseDir, "userdata", "peer-hub.json");

/** A fresh base directory, holding `seed` as `peer-hub.json` when given. */
export const seedState = (seed?: string) =>
  Effect.gen(function* () {
    const baseDir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
      prefix: "peer-core-",
    });
    if (seed !== undefined) {
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(NodePath.dirname(stateFile(baseDir)), { recursive: true });
        await NodeFSP.writeFile(stateFile(baseDir), seed);
      });
    }
    return baseDir;
  });

/** A repository with one commit on `main`, bare, under a fresh directory; its path. */
export const bareRepository = Effect.gen(function* () {
  const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
    prefix: "peer-clone-",
  });
  const git = (cwd: string, ...args: Array<string>) =>
    NodeChildProcess.execFileSync("git", args, { cwd, stdio: "ignore" });
  const work = NodePath.join(dir, "work");
  NodeFS.mkdirSync(work);
  git(work, "init", "--quiet", "--initial-branch=main");
  NodeFS.writeFileSync(NodePath.join(work, "README.md"), "Payments\n");
  git(work, "add", "README.md");
  git(
    work,
    "-c",
    "user.name=Ana",
    "-c",
    "user.email=ana@acme.test",
    "commit",
    "--quiet",
    "-m",
    "start",
  );
  git(dir, "clone", "--quiet", "--bare", work, "origin.git");
  return { dir, origin: NodePath.join(dir, "origin.git") };
});

/** A secret store in memory, holding the Hub session `session` when given. */
export const memorySecrets = (session?: string) => {
  const secrets = new Map<string, Uint8Array>();
  if (session !== undefined) secrets.set("peer-hub-session", Buffer.from(session, "utf8"));
  return Layer.mock(ServerSecretStore.ServerSecretStore)({
    get: (name) => Effect.sync(() => Option.fromNullishOr(secrets.get(name))),
    set: (name, value) => Effect.sync(() => void secrets.set(name, value)),
    remove: (name) => Effect.sync(() => void secrets.delete(name)),
  });
};

/** The T3 services core reads this computer's projects and threads from. */
export type T3Services =
  | ProjectService.ProjectService
  | ProjectionStore.ProjectionStoreV2
  | Settings.ServerSettingsService;

/** T3 with nothing in it: no checkout is a project, no thread runs, no provider is configured. */
export const emptyT3: Layer.Layer<T3Services> = Layer.mergeAll(
  Layer.mock(ProjectService.ProjectService)({
    getByWorkspaceRoot: () => Effect.succeed(Option.none()),
  }),
  Layer.mock(ProjectionStore.ProjectionStoreV2)({
    getShellSnapshot: () => Effect.succeed({ threads: [] } as never),
  }),
  Layer.mock(Settings.ServerSettingsService)({
    getSettings: Effect.succeed({ providerInstances: {} } as never),
  }),
);

/** The run that puts Ana's thread-1 on krk-1 in `paymentsSeed`. */
export const SEED_RUN = "run_0000000000SEEDRUN001";

/**
 * peer-hub.json of Ana signed in to `hubUrl`, in acme's Payments project (its one repository is
 * `api`), with her Peer thread-1 put on task krk-1.
 */
export const paymentsSeed = (hubUrl: string) =>
  JSON.stringify({
    hubUrl,
    email: "ana@acme.test",
    pendingSignIn: null,
    workspaces: [
      {
        slug: "acme",
        name: "Acme",
        role: "member",
        allowedDomains: [],
        manifest: {
          version: 2,
          workspace: { slug: "acme", name: "Acme", currency: "EUR" },
          member: { email: "ana@acme.test", name: "Ana", role: "member" },
          knowledge: {},
          projects: [
            {
              id: "pay",
              name: "Payments",
              role: "lead",
              members: [],
              repositories: [{ id: "api", url: "https://github.com/acme/api.git", branch: "main" }],
              knowledge: { kontext: false, company: false },
              tools: [],
              capacity: { personal: "any", personalHarnesses: [] },
            },
          ],
        },
        lastSyncAt: null,
      },
    ],
    joinable: [],
    lastSyncAt: null,
    sharedInstances: {},
    // Ana's thread-1 on krk-1, as a person placed it before runs reached the Hub.
    runs: {
      [SEED_RUN]: {
        id: SEED_RUN,
        workspace: "acme",
        project: "pay",
        task: "krk-1",
        email: "ana@acme.test",
        environment: "ana-laptop",
        agent: "unknown",
        runtime: "peer",
        thread: "peer:thread-1",
        startedAt: "2026-10-01T09:00:00.000Z",
        sessions: [],
        sessionsBefore: 0,
        local: true,
      },
    },
  });

/** T3 where Ana's Payments checkout is project `t3-pay`, and Claude Code runs thread-1 there now. */
export const paymentsT3: Layer.Layer<T3Services> = Layer.mergeAll(
  Layer.mock(ProjectService.ProjectService)({
    getByWorkspaceRoot: (root) =>
      Effect.succeed(
        root.endsWith("/acme/pay/api")
          ? Option.some({ id: ProjectId.make("t3-pay") } as never)
          : Option.none(),
      ),
  }),
  Layer.mock(ProjectionStore.ProjectionStoreV2)({
    getShellSnapshot: () =>
      Effect.succeed({
        threads: [
          {
            id: "thread-1",
            projectId: "t3-pay",
            title: "Split payments",
            providerInstanceId: "claude-1",
            activeProviderThreadId: "provider-1",
            branch: "feat/split",
            status: "running",
            activityRunStatus: "running",
            pendingRuntimeRequest: null,
            settledAt: null,
          },
        ],
      } as never),
    getThreadRecords: () =>
      Effect.succeed({
        providerThreads: [
          {
            id: "provider-1",
            driver: "claudeAgent",
            status: "active",
            providerSessionId: "session-1",
            nativeThreadRef: { nativeId: "native-1" },
          },
        ],
        providerSessions: [{ id: "session-1", status: "running" }],
      } as never),
    getThreadShell: () =>
      Effect.succeed({
        title: "Split payments",
        status: "running",
        activityRunStatus: "running",
        pendingRuntimeRequest: null,
        settledAt: null,
      } as never),
    getTimelinePage: () => Effect.succeed({ totalItems: 0, items: [] } as never),
  }),
  Layer.mock(Settings.ServerSettingsService)({
    getSettings: Effect.succeed({
      providerInstances: { "claude-1": { driver: "claudeAgent" } },
    } as never),
  }),
);

/**
 * Core on the state under `baseDir`: signed in when `session` is given, running `plugins` (none by
 * default) as its registry, over `t3` (`emptyT3` by default), which it offers plugins too.
 */
export const coreLayer = (
  baseDir: string,
  options: {
    readonly session?: string;
    readonly plugins?: ReadonlyArray<PeerPluginEntry>;
    readonly t3?: Layer.Layer<T3Services>;
    readonly relay?: Layer.Layer<AgentAwarenessRelay>;
  } = {},
) =>
  PeerWorkspaces.layer.pipe(
    Layer.provideMerge(PeerAgents.layer),
    Layer.provideMerge(PeerIndex.layer),
    Layer.provideMerge(PeerHubEvents.layer),
    Layer.provideMerge(PeerWork.layer),
    Layer.provideMerge(PeerStatus.layer),
    Layer.provideMerge(PeerRuns.layer),
    Layer.provideMerge(PeerPlugins.layer),
    Layer.provideMerge(PeerHubClient.layer),
    Layer.provideMerge(PeerState.layer),
    Layer.provideMerge(PeerLog.layer),
    Layer.provideMerge(Layer.succeed(PeerPluginRegistry, options.plugins ?? [])),
    // Plugins may use T3's services too (shared capacity's provider instances), and the server's
    // configuration and HTTP client (memory's local queue and Hub calls).
    Layer.provideMerge(options.t3 ?? emptyT3),
    Layer.provideMerge(
      options.relay ??
        Layer.mock(AgentAwarenessRelay)({
          publishThread: () => Effect.void,
          publishExternal: () => Effect.void,
          externalCatchUp: () => Effect.void,
          publishingState: Effect.succeed("unlinked"),
          requestCatchUp: () => Effect.void,
          drain: Effect.void,
          start: () => Effect.void,
        }),
    ),
    Layer.provideMerge(
      Layer.mergeAll(
        ServerConfig.layerTest(process.cwd(), baseDir),
        Layer.mock(ServerEnvironment.ServerEnvironment)({
          getEnvironmentId: Effect.succeed(TEST_ENVIRONMENT),
        }),
        memorySecrets(options.session),
        FetchHttpClient.layer,
      ),
    ),
  );

/** One request a stand-in Hub received. */
export interface HubCall {
  readonly method: string | undefined;
  readonly url: string | undefined;
  readonly authorization: string | undefined;
  readonly body: string;
}

/**
 * What a stand-in Hub answers a path with: an HTTP status and a JSON body, or server-sent events,
 * after which it ends the stream unless it keeps it `open` for `push`.
 */
export type HubAnswer = (
  url: string,
  method?: string,
) => readonly [number, unknown] | { readonly events: string; readonly open?: boolean };

/**
 * A Hub on a local port answering as `answer.current` says now, keeping what it was asked. `push`
 * sends more events down the streams it keeps open on a path.
 */
export const standInHub = (answer: { current: HubAnswer }) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{
          readonly url: string;
          readonly server: NodeHttp.Server;
          readonly calls: ReadonlyArray<HubCall>;
          readonly push: (url: string, events: string) => void;
        }>((resolve) => {
          const calls: HubCall[] = [];
          const open: Array<{ readonly url: string; readonly response: NodeHttp.ServerResponse }> =
            [];
          const server = NodeHttp.createServer((request, response) => {
            let body = "";
            request.setEncoding("utf8");
            request.on("data", (chunk: string) => (body += chunk));
            request.on("end", () => {
              calls.push({
                method: request.method,
                url: request.url,
                authorization: request.headers.authorization,
                body,
              });
              const answered = answer.current(request.url ?? "", request.method);
              if ("events" in answered) {
                response.writeHead(200, { "content-type": "text/event-stream" });
                if (answered.open !== true) {
                  response.end(answered.events);
                  return;
                }
                response.write(answered.events);
                open.push({ url: request.url ?? "", response });
                return;
              }
              const [status, json] = answered;
              response
                .writeHead(status, { "content-type": "application/json" })
                .end(JSON.stringify(json));
            });
          });
          server.listen(0, "127.0.0.1", () =>
            resolve({
              url: `http://127.0.0.1:${(server.address() as NodeNet.AddressInfo).port}`,
              server,
              calls,
              push: (url, events) => {
                for (const stream of open) if (stream.url === url) stream.response.write(events);
              },
            }),
          );
        }),
    ),
    ({ server }) =>
      Effect.promise(
        () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      ),
  );

/** peer-hub.json of Ana signed in to `hubUrl`, a member of the acme workspace. */
export const signedInSeed = (hubUrl: string) =>
  [
    `{"hubUrl":"${hubUrl}","email":"ana@acme.test","pendingSignIn":null,`,
    '"workspaces":[{"slug":"acme","name":"Acme","role":"member","allowedDomains":[],',
    '"manifest":null,"lastSyncAt":null}],"joinable":[],"lastSyncAt":null,',
    '"sharedInstances":{}}\n',
  ].join("");

/**
 * What `/v1/me` answers for Ana, with the Hub's feature catalog, and what a newer Hub adds to it (the
 * features its operator turned off, its build), when given.
 */
export const meAnswer = (
  features?: Readonly<Record<string, number>>,
  more: {
    readonly featuresOff?: ReadonlyArray<string>;
    readonly hub?: { readonly version?: string; readonly commit?: string };
  } = {},
) => ({
  email: "ana@acme.test",
  workspaces: [{ slug: "acme", name: "Acme", allowedDomains: [], role: "member" }],
  joinable: [],
  ...(features === undefined ? {} : { features }),
  ...more,
});

/**
 * A service a test never calls: anything asked of it fails. Its plain members are missing too,
 * which is why it is cast.
 */
const unused = <I, S extends object>(service: Context.Key<I, S>) =>
  Layer.mock(service)({} as never);

/**
 * Stand-ins for the core services behind core's own RPC methods: what a test of plugins' methods
 * gives `PeerHub.rpcLayer` besides the plugins.
 */
export const coreRpcStandIns = Layer.mergeAll(
  unused(PeerContextView.PeerContextView),
  unused(PeerState.PeerState),
  unused(PeerHubClient.PeerHubClient),
  unused(PeerStatus.PeerStatus),
  unused(PeerWork.PeerWork),
  unused(PeerRuns.PeerRuns),
  unused(PeerAgents.PeerAgents),
  unused(PeerWorkspaces.PeerWorkspaces),
  unused(PeerCoordination.PeerCoordination),
  unused(PeerAdapters.PeerAdapters),
);
