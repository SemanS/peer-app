/**
 * The Jujutsu workspaces plugin: in a colocated jj repository, an agent's workspace is named in
 * jj's operation log, snapshotted after every tool step, protected from the other agents' rewrites,
 * and stopped from the one way around that. It has no Hub feature, so it works with any Hub and its
 * safety never depends on one. It is active unless the environment forces it off with
 * `PEER_JUJUTSU=off`, and a Git checkout never meets it.
 *
 * @module peerHub/plugins/jujutsu
 */
import { JujutsuRpcGroup, PEER_JUJUTSU_METHODS, PEER_JUJUTSU_PLUGIN } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as Jujutsu from "./Jujutsu.ts";
import { followCommand } from "./cli.ts";

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
      commands: [followCommand(jujutsu)],
      hooks: {
        sessionStart: ({ session }) => jujutsu.sessionStart(session).pipe(Effect.as(null)),
        preTool: { on: "shell", decide: jujutsu.stopFor, fallback: jujutsu.stopFallback },
        postTool: jujutsu.afterStep,
        // The push notice is a message to the session about its own push: a landing step gives it once.
        notices: [{ wakes: false, landing: true, read: jujutsu.pushNotice }],
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
            [m.peerJujutsuOperations]: (input) =>
              wrap.effect(m.peerJujutsuOperations, jujutsu.operations(input)),
            [m.peerJujutsuPreviewUndo]: (input) =>
              wrap.effect(m.peerJujutsuPreviewUndo, jujutsu.previewUndo(input)),
            [m.peerJujutsuUndo]: (input) => wrap.effect(m.peerJujutsuUndo, jujutsu.undo(input)),
            [m.peerJujutsuAtOp]: (input) => wrap.effect(m.peerJujutsuAtOp, jujutsu.atOp(input)),
            [m.peerJujutsuFollow]: (input) =>
              wrap.effect(m.peerJujutsuFollow, jujutsu.follow(input)),
            [m.peerJujutsuIntegrate]: (input) =>
              wrap.effect(m.peerJujutsuIntegrate, jujutsu.integrate(input)),
            [m.peerJujutsuConverge]: (input) =>
              wrap.effect(m.peerJujutsuConverge, jujutsu.converge(input)),
          }),
      },
    } satisfies PeerContributions;
  }),
});
