// @effect-diagnostics nodeBuiltinImport:off - peer-hub.json in a temporary directory, a stand-in Hub on a local port.
/**
 * Peer's core services for tests: the real layers on a temporary state directory, with fakes only
 * at the edges (this environment's id, the secret store keeping the Hub session, a stand-in Hub).
 *
 * @module peerHub/core/testkit
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodePath from "node:path";

import { EnvironmentId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { FetchHttpClient } from "effect/unstable/http";

import * as ServerSecretStore from "../../auth/ServerSecretStore.ts";
import * as ServerConfig from "../../config.ts";
import * as ServerEnvironment from "../../environment/ServerEnvironment.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as Settings from "../../serverSettings.ts";
import * as PeerHubClient from "./hub/PeerHubClient.ts";
import * as PeerHubEvents from "./hub/PeerHubEvents.ts";
import type { PeerPluginEntry } from "./plugin.ts";
import * as PeerPlugins from "./plugins/PeerPlugins.ts";
import { PeerPluginRegistry } from "./registry.ts";
import * as PeerState from "./state/PeerState.ts";
import * as PeerStatus from "./status/PeerStatus.ts";
import * as PeerWork from "./work/PeerWork.ts";

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

/** T3 with nothing in it that core asks about: no checkout is a project, and no thread runs. */
const noT3: Layer.Layer<T3Services> = Layer.mergeAll(
  Layer.mock(ProjectService.ProjectService)({}),
  Layer.mock(ProjectionStore.ProjectionStoreV2)({}),
  Layer.mock(Settings.ServerSettingsService)({}),
);

/**
 * Core on the state under `baseDir`: signed in when `session` is given, running `plugins` (none by
 * default) as its registry, over `t3` (nothing by default).
 */
export const coreLayer = (
  baseDir: string,
  options: {
    readonly session?: string;
    readonly plugins?: ReadonlyArray<PeerPluginEntry>;
    readonly t3?: Layer.Layer<T3Services>;
  } = {},
) =>
  PeerHubEvents.layer.pipe(
    Layer.provideMerge(PeerWork.layer),
    Layer.provideMerge(PeerStatus.layer),
    Layer.provideMerge(PeerPlugins.layer),
    Layer.provideMerge(PeerHubClient.layer),
    Layer.provideMerge(PeerState.layer),
    Layer.provideMerge(Layer.succeed(PeerPluginRegistry, options.plugins ?? [])),
    Layer.provide(
      Layer.mergeAll(
        ServerConfig.layerTest(process.cwd(), baseDir),
        Layer.mock(ServerEnvironment.ServerEnvironment)({
          getEnvironmentId: Effect.succeed(TEST_ENVIRONMENT),
        }),
        memorySecrets(options.session),
        options.t3 ?? noT3,
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

/** What a stand-in Hub answers a path with: an HTTP status and a JSON body, or server-sent events. */
export type HubAnswer = (url: string) => readonly [number, unknown] | { readonly events: string };

/** A Hub on a local port answering as `answer.current` says now, keeping what it was asked. */
export const standInHub = (answer: { current: HubAnswer }) =>
  Effect.acquireRelease(
    Effect.promise(
      () =>
        new Promise<{
          readonly url: string;
          readonly server: NodeHttp.Server;
          readonly calls: ReadonlyArray<HubCall>;
        }>((resolve) => {
          const calls: HubCall[] = [];
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
              const answered = answer.current(request.url ?? "");
              if ("events" in answered) {
                response
                  .writeHead(200, { "content-type": "text/event-stream" })
                  .end(answered.events);
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

/** What `/v1/me` answers for Ana, with the Hub's feature catalog when given. */
export const meAnswer = (features?: Readonly<Record<string, number>>) => ({
  email: "ana@acme.test",
  workspaces: [{ slug: "acme", name: "Acme", allowedDomains: [], role: "member" }],
  joinable: [],
  ...(features === undefined ? {} : { features }),
});
