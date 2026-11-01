/**
 * The settings plugin: workspace and project settings changed in the app (the Hub's `settings`
 * feature, which keeps them while the plugin is off) or by an agent for its person (`peer config`).
 *
 * @module peerHub/plugins/settings
 */
import { PEER_SETTINGS_METHODS, PEER_SETTINGS_PLUGIN, SettingsRpcGroup } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import { PeerState } from "../../core/state/PeerState.ts";
import { configCommand, configTools } from "./config.ts";
import { PeerSettings, layer } from "./service.ts";

const m = PEER_SETTINGS_METHODS;

export const SettingsPlugin = bindPlugin({
  ...PEER_SETTINGS_PLUGIN,
  id: "settings",
  defaultEnabled: true,
  layer,
  make: Effect.gen(function* () {
    const service = yield* PeerSettings;
    const state = yield* PeerState;
    return {
      commands: [configCommand(service)],
      agentTools: configTools,
      hubChanges: {
        changes: ["settings"],
        onPing: (ping) => service.readSoon(ping.workspace),
      },
      status: { read: service.status },
      rpc: {
        group: SettingsRpcGroup,
        handlers: (wrap) => {
          const on =
            <Input, A, E, R>(method: string, run: (input: Input) => Effect.Effect<A, E, R>) =>
            (input: Input) =>
              wrap.effect(method, run(input));
          return SettingsRpcGroup.of({
            [m.peerSettingsGet]: on(m.peerSettingsGet, service.get),
            [m.peerSettingsPreview]: on(m.peerSettingsPreview, service.preview),
            [m.peerSettingsSave]: on(m.peerSettingsSave, service.save),
            [m.peerSettingsSecrets]: on(m.peerSettingsSecrets, service.secrets),
            [m.peerSettingsPutSecret]: on(m.peerSettingsPutSecret, service.putSecret),
            [m.peerSettingsDeleteSecret]: on(m.peerSettingsDeleteSecret, service.deleteSecret),
            [m.peerSettingsDomainRecord]: on(m.peerSettingsDomainRecord, service.domainRecord),
            [m.peerSettingsVerifyDomain]: on(m.peerSettingsVerifyDomain, service.verifyDomain),
            [m.peerSettingsUpdateWorkspace]: on(
              m.peerSettingsUpdateWorkspace,
              service.updateWorkspace,
            ),
          });
        },
      },
      lifecycle: (event) =>
        event.kind === "signing-out"
          ? service.forget
          : event.kind === "signed-in" || event.kind === "synced"
            ? service.queueAll
            : Effect.void,
      workspaceCleanup: (event) =>
        service.keepOnly(
          event.kind === "signing-out"
            ? []
            : event.kind === "synced"
              ? event.workspaces.map(({ slug }) => slug)
              : state
                  .current()
                  .persisted.workspaces.map(({ slug }) => slug)
                  .filter((slug) => slug !== event.workspace),
        ),
      run: service.follow,
      turnOff: service.forget,
    } satisfies PeerContributions;
  }),
});
