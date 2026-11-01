/**
 * The rooms plugin: a task's conversation between people and their agents (the Hub's `rooms`
 * feature), which is how they coordinate. The Hub decides who answers and who pays, and this plugin
 * carries what it assigned to this computer, tells agents in fenced text, and reads the diff from
 * git. A colleague's words reach a running agent at its next step; only its owner's yes starts a turn.
 *
 * @module peerHub/plugins/rooms
 */
import { PEER_ROOMS_PLUGIN } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import { roomCommands } from "./cli.ts";
import { roomsRpc, roomTools } from "./client/transport.ts";
import { roomHooks } from "./hooks.ts";
import * as Rooms from "./Rooms.ts";

export const RoomsPlugin = bindPlugin({
  ...PEER_ROOMS_PLUGIN,
  id: "rooms",
  commandNames: ["room", "ready", "blocked", "ask", "note"],
  layer: Rooms.layer,
  make: Effect.gen(function* () {
    const rooms = yield* Rooms.Rooms;
    const work = yield* PeerWork.PeerWork;
    const state = yield* PeerState.PeerState;
    const agents = yield* PeerAgents.PeerAgents;
    return {
      commands: roomCommands(rooms, work, state, agents),
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
