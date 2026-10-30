/**
 * The rooms plugin: a task's conversation between people and their agents (the Hub's `rooms`
 * feature). Peer routes nothing here: the Hub decides who answers and who pays, and this plugin
 * carries what it assigned to this computer, tells agents in fenced text, and reads the diff from
 * git. A message that names no agent starts no turn, and an agent's message wakes nobody.
 *
 * @module peerHub/plugins/rooms
 */
import { PEER_ROOMS_PLUGIN } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import { roomCommand } from "./cli.ts";
import { roomsRpc, roomTools } from "./client/transport.ts";
import { roomHooks } from "./hooks.ts";
import * as Rooms from "./Rooms.ts";

export const RoomsPlugin = bindPlugin({
  ...PEER_ROOMS_PLUGIN,
  id: "rooms",
  commandNames: ["room"],
  layer: Rooms.layer,
  make: Effect.gen(function* () {
    const rooms = yield* Rooms.Rooms;
    const work = yield* PeerWork.PeerWork;
    const state = yield* PeerState.PeerState;
    return {
      commands: [roomCommand(rooms, work, state)],
      agentTools: roomTools,
      hooks: roomHooks(rooms),
      hubChanges: {
        changes: ["rooms"],
        // A pass made here is work for this computer too.
        ownEcho: true,
        onPing: (ping) => rooms.readSoon(ping.workspace),
      },
      lifecycle: (event) =>
        event.kind === "synced"
          ? Effect.forEach(event.workspaces, (workspace) => rooms.readSoon(workspace.slug), {
              discard: true,
            })
          : Effect.void,
      workspaceCleanup: (event) =>
        event.kind === "signing-out"
          ? rooms.forget()
          : event.kind === "left-workspace"
            ? rooms.forget(event.workspace)
            : rooms.keep(event.workspaces.map((workspace) => workspace.slug)),
      status: { read: rooms.status },
      turnOff: rooms.forget(),
      rpc: roomsRpc(rooms),
      run: rooms.follow,
    } satisfies PeerContributions;
  }),
});
