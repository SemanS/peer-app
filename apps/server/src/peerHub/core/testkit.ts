// @effect-diagnostics nodeBuiltinImport:off - seeds peer-hub.json in a temporary state directory.
/**
 * Peer's core services for tests: the real layers on a temporary state directory, with fakes only
 * at the edges (this environment's id, the secret store keeping the Hub session).
 *
 * @module peerHub/core/testkit
 */
import * as NodeFSP from "node:fs/promises";
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
import * as PeerHubClient from "./hub/PeerHubClient.ts";
import * as PeerState from "./state/PeerState.ts";

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

/** PeerState and PeerHubClient on the state under `baseDir`, signed in when `session` is given. */
export const coreLayer = (baseDir: string, options: { readonly session?: string } = {}) =>
  PeerHubClient.layer.pipe(
    Layer.provideMerge(PeerState.layer),
    Layer.provide(
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
