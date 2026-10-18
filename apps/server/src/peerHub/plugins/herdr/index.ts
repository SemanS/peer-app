/**
 * The herdr plugin: the coding agents herdr (https://herdr.dev) runs on this computer, beside
 * Peer's own threads. Peer shows and reports them, wakes an idle one through herdr, and starts one
 * on a task through `peerHub.startAgent` (this plugin's `taskLauncher`). It needs no Hub feature.
 * While it is off, Peer leaves herdr alone: the status shows no herdr agent, starting one on a task
 * fails saying so, and news for an idle agent waits for its next step.
 *
 * @module peerHub/plugins/herdr
 */
import { HerdrRpcGroup, PEER_HERDR_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { bindPlugin, type PeerContributions } from "../../core/plugin.ts";
import * as Herdr from "./Herdr.ts";
import { HerdrRuntime } from "./runtime.ts";

/** Traced as Peer's methods always were. */
const TRACE = { "rpc.aggregate": "peerHub" } as const;

export const HerdrPlugin = bindPlugin({
  id: "herdr",
  title: "herdr agents",
  summary: "Show and start the coding agents herdr runs on this computer, and wake them for news.",
  defaultEnabled: true,
  layer: Herdr.layer,
  make: Effect.gen(function* () {
    const herdr = yield* Herdr.Herdr;
    const runtime = yield* HerdrRuntime;
    return {
      status: { read: herdr.agents, field: runtime.status },
      rpc: {
        group: HerdrRpcGroup,
        handlers: (wrap) =>
          HerdrRpcGroup.of({
            [PEER_HERDR_METHODS.peerHubFocusAgent]: (input) =>
              wrap.effect(PEER_HERDR_METHODS.peerHubFocusAgent, herdr.focus(input), TRACE),
            [PEER_HERDR_METHODS.peerHubWatchAgent]: (input) =>
              wrap.stream(PEER_HERDR_METHODS.peerHubWatchAgent, herdr.watch(input), TRACE),
            [PEER_HERDR_METHODS.peerHubPromptAgent]: (input) =>
              wrap.effect(PEER_HERDR_METHODS.peerHubPromptAgent, herdr.prompt(input), TRACE),
            [PEER_HERDR_METHODS.peerHerdrSetRuntime]: (input) =>
              wrap.effect(PEER_HERDR_METHODS.peerHerdrSetRuntime, runtime.setRuntime(input), TRACE),
            [PEER_HERDR_METHODS.peerHerdrRestartRuntime]: () =>
              wrap.effect(PEER_HERDR_METHODS.peerHerdrRestartRuntime, runtime.restart(), TRACE),
            [PEER_HERDR_METHODS.peerHerdrOpenTerminal]: (input) =>
              wrap.effect(
                PEER_HERDR_METHODS.peerHerdrOpenTerminal,
                runtime.openTerminal(input),
                TRACE,
              ),
            [PEER_HERDR_METHODS.peerHerdrSetIntegration]: (input) =>
              wrap.effect(
                PEER_HERDR_METHODS.peerHerdrSetIntegration,
                runtime.setIntegration(input),
                TRACE,
              ),
          }),
      },
      run: Effect.all([herdr.follow, runtime.run, herdr.checkouts.run], {
        concurrency: "unbounded",
        discard: true,
      }),
      taskWorktreeCreated: herdr.checkouts.created,
      workspaceCleanup: (event) =>
        event.kind === "signing-out"
          ? herdr.checkouts.forget()
          : event.kind === "left-workspace"
            ? herdr.checkouts.forget(event.workspace)
            : Effect.void,
      turnOff: runtime.turnOff,
      runtime: herdr.runtime,
      taskLauncher: herdr.launcher,
      reportSessions: herdr.reportSessions,
    } satisfies PeerContributions;
  }),
});
