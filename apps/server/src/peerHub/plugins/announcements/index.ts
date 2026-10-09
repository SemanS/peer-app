import {
  PEER_ANNOUNCEMENTS_PLUGIN,
  PEER_ANNOUNCEMENTS_METHODS,
  AnnouncementsRpcGroup,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { bindPlugin, usage, type PeerContributions } from "../../core/plugin.ts";
import { PeerState } from "../../core/state/PeerState.ts";
import { PeerAnnouncements, layer } from "./service.ts";

/**
 * C1: core/broker/pipeline.ts:254,287 and hooks.ts:169 compose first-priority blocks.
 * C2: pipeline.ts:62 and delivery.ts:281 bind exact refs to Mod proofs, with no legacy-string change.
 * C3: wake.ts:84,155,212 reaches Stop/Mod, Codex and the runtime with offered-only receipts.
 * C4: this service's run owns periodic reads/outbox; core/hub/PeerHubEvents.ts:77 forwards dynamic
 * change names and reconnect resync. hooks.ts:558 flushes before the Hub session report disappears.
 * C5: core/state/PeerState.ts:264 pluginData; core/status/PeerStatus.ts:74 statusField.
 * C6: contracts peer/announcements.rpc.ts scopes join peer/rpcRegistry.ts.
 * C8: web components/workspaces/slots.ts and mobile features/peer/slots.ts list the UI slots.
 * The step path reads memory only; a full referenced block either reaches its adapter or is retried.
 */
export const AnnouncementsPlugin = bindPlugin({
  ...PEER_ANNOUNCEMENTS_PLUGIN,
  id: "announcements",
  layer,
  make: Effect.gen(function* () {
    const service = yield* PeerAnnouncements;
    const state = yield* PeerState;
    const m = PEER_ANNOUNCEMENTS_METHODS;
    return {
      agentTools: [
        {
          name: "peer_announcements",
          description:
            "Read project announcements or acknowledge eligible handles. Offered does not mean read. This tool cannot post announcements.",
          inputSchema: {
            type: "object",
            properties: {
              action: { type: "string", enum: ["read", "ack"] },
              ids: { type: "array", items: { type: "string" } },
            },
            additionalProperties: false,
          },
          command: "announcements",
          arguments: (input) => {
            if (input.action !== undefined && input.action !== "read" && input.action !== "ack")
              throw usage("Unknown announcement action.", "use read or ack.");
            if (
              input.ids !== undefined &&
              (!Array.isArray(input.ids) || !input.ids.every((id) => typeof id === "string"))
            )
              throw usage("Invalid announcement handles.", "provide an array of handle strings.");
            return input.action === "ack"
              ? ["ack", ...((input.ids as string[] | undefined) ?? [])]
              : [];
          },
        },
      ],
      commands: [
        {
          name: "announcements",
          usage: "announcements [ack [id...]]",
          summary: "read and acknowledge project announcements",
          run: ({ session, args }) => service.command(session, args),
        },
      ],
      hooks: {
        priority: "first",
        sessionStart: service.start,
        notices: [{ wakes: true, read: service.step }],
        delivery: service.delivery,
        sessionEnding: () => service.flush(),
      },
      hubChanges: {
        changes: ["announcements", "projects"],
        ownEcho: true,
        onPing: (ping) => service.queueRefresh(ping.workspace),
      },
      status: { read: Effect.sync(service.status) },
      rpc: {
        group: AnnouncementsRpcGroup,
        handlers: (wrap) =>
          AnnouncementsRpcGroup.of({
            [m.peerAnnouncementsList]: (input) =>
              wrap.effect(m.peerAnnouncementsList, service.list(input)),
            [m.peerAnnouncementsDetail]: (input) =>
              wrap.effect(m.peerAnnouncementsDetail, service.detail(input)),
            [m.peerAnnouncementsPost]: (input) =>
              wrap.effect(m.peerAnnouncementsPost, service.post(input)),
            [m.peerAnnouncementsWithdraw]: (input) =>
              wrap.effect(m.peerAnnouncementsWithdraw, service.withdraw(input)),
            [m.peerAnnouncementsCredentials]: (input) =>
              wrap.effect(m.peerAnnouncementsCredentials, service.credentials(input)),
            [m.peerAnnouncementsCreateCredential]: (input) =>
              wrap.effect(m.peerAnnouncementsCreateCredential, service.createCredential(input)),
            [m.peerAnnouncementsRevokeCredential]: (input) =>
              wrap.effect(m.peerAnnouncementsRevokeCredential, service.revokeCredential(input)),
            [m.peerAnnouncementsSetWake]: (input) =>
              wrap.effect(m.peerAnnouncementsSetWake, service.setWake(input)),
          }),
      },
      workspaceCleanup: (event) =>
        service.cleanup(
          event.kind === "signing-out"
            ? []
            : event.kind === "synced"
              ? event.workspaces
              : state
                  .current()
                  .persisted.workspaces.filter((workspace) => workspace.slug !== event.workspace),
        ),
      lifecycle: () =>
        Effect.forEach(
          state.current().persisted.workspaces,
          (workspace) => service.queueRefresh(workspace.slug),
          { discard: true },
        ),
      run: service.run,
      turnOff: service.cleanup([]),
    } satisfies PeerContributions;
  }),
});
