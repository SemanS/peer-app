// @effect-diagnostics nodeBuiltinImport:off - reads the environment's settings.json once.
/**
 * T3's settings without T3's database: Peer Core reads `<stateDir>/settings.json` (what Peer's
 * adapters need: Codex homes, hooks, provider instances) with the app's schema and defaults, and
 * refuses every change, which belongs to the Peer app. Secret fields stay redacted here.
 *
 * @module peerHub/headless/HeadlessSettings
 */
import * as NodeFSP from "node:fs/promises";

import { DEFAULT_SERVER_SETTINGS, ServerSettings, ServerSettingsError } from "@t3tools/contracts";
import { fromLenientJson } from "@t3tools/shared/schemaJson";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import * as ServerConfig from "../../config.ts";
import * as Settings from "../../serverSettings.ts";

const decodeSettingsJson = Schema.decodeUnknownExit(fromLenientJson(ServerSettings));

/** The settings in `text`, or the defaults when it does not decode. */
export const settingsFrom = (text: string | null): ServerSettings => {
  if (text === null) return DEFAULT_SERVER_SETTINGS;
  const decoded = decodeSettingsJson(text);
  return Exit.isSuccess(decoded) ? decoded.value : DEFAULT_SERVER_SETTINGS;
};

/** `ServerSettingsService` reading settings.json at each call; writes are refused. */
export const layer = Layer.effect(
  Settings.ServerSettingsService,
  Effect.gen(function* () {
    const { settingsPath } = yield* ServerConfig.ServerConfig;
    const getSettings = Effect.promise(() =>
      NodeFSP.readFile(settingsPath, "utf8").then(
        (text) => settingsFrom(text),
        () => settingsFrom(null),
      ),
    );
    const refuse = Effect.fail(
      new ServerSettingsError({
        settingsPath,
        operation: "write-file",
        cause: new Error("Peer Core does not change settings; change them in the Peer app."),
      }),
    );
    return Settings.ServerSettingsService.of({
      start: Effect.void,
      ready: Effect.void,
      getSettings,
      updateSettings: () => refuse,
      updateProviderInstance: () => refuse,
      withSettingsSnapshot: (use) => getSettings.pipe(Effect.flatMap(use)),
      streamChanges: Stream.empty,
      subscribeChanges: Effect.succeed(Stream.empty),
    });
  }),
);
