/**
 * The Jujutsu workspaces plugin: in a colocated jj repository, an agent's workspace is named in
 * jj's operation log, snapshotted after every tool step, protected from the other agents' rewrites,
 * and stopped from the one way around that. It has no Hub feature, so it works with any Hub and its
 * safety never depends on one. It is active unless the environment forces it off with
 * `PEER_JUJUTSU=off`, and a Git checkout never meets it.
 *
 * @module peerHub/plugins/jujutsu
 */
import {
  JujutsuRpcGroup,
  PEER_JUJUTSU_METHODS,
  PEER_JUJUTSU_PLUGIN,
  PeerHubError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { bindPlugin, refused, type PeerContributions } from "../../core/plugin.ts";
import * as Jujutsu from "./Jujutsu.ts";

/** Methods another part of this plugin builds (undo, following, integrating) answer until it lands. */
const notYet = (method: string) =>
  Effect.fail(new PeerHubError({ detail: `${method} is not available yet.` }));

export const JujutsuPlugin = bindPlugin({
  ...PEER_JUJUTSU_PLUGIN,
  id: "jujutsu",
  commandNames: ["follow"],
  forcedOff: () => (Jujutsu.forcedOff() ? "PEER_JUJUTSU=off" : undefined),
  layer: Jujutsu.layer,
  make: Effect.gen(function* () {
    const jujutsu = yield* Jujutsu.Jujutsu;
    const m = PEER_JUJUTSU_METHODS;
    return {
      // `peer follow` is built with following; until then the name is taken and says so.
      commands: [
        {
          name: "follow",
          usage: "follow [<task>] [--stop]",
          summary: "build on another task's change",
          run: () =>
            Effect.fail(
              refused("peer follow is not available yet", "keep working on your own change"),
            ),
        },
      ],
      hooks: {
        sessionStart: ({ session }) => jujutsu.sessionStart(session).pipe(Effect.as(null)),
        preTool: { on: "shell", decide: jujutsu.stopFor, fallback: jujutsu.stopFallback },
        postTool: jujutsu.afterStep,
      },
      taskWorktreeCreated: jujutsu.taskWorktreeCreated,
      status: { read: jujutsu.status },
      turnOff: jujutsu.turnOff,
      run: jujutsu.run,
      rpc: {
        group: JujutsuRpcGroup,
        handlers: (wrap) =>
          JujutsuRpcGroup.of({
            [m.peerJujutsuConfigure]: (input) =>
              wrap.effect(m.peerJujutsuConfigure, jujutsu.configure(input)),
            [m.peerJujutsuOperations]: () =>
              wrap.effect(m.peerJujutsuOperations, notYet("Operations")),
            [m.peerJujutsuPreviewUndo]: () => wrap.effect(m.peerJujutsuPreviewUndo, notYet("Undo")),
            [m.peerJujutsuUndo]: () => wrap.effect(m.peerJujutsuUndo, notYet("Undo")),
            [m.peerJujutsuAtOp]: () =>
              wrap.effect(m.peerJujutsuAtOp, notYet("Reading an earlier operation")),
            [m.peerJujutsuFollow]: () => wrap.effect(m.peerJujutsuFollow, notYet("Following")),
            [m.peerJujutsuIntegrate]: () =>
              wrap.effect(m.peerJujutsuIntegrate, notYet("Integrating")),
          }),
      },
    } satisfies PeerContributions;
  }),
});
