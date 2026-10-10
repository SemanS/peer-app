/**
 * A terminal window attached to Peer's herdr: opened when the owner asks, and before an agent is
 * shown when none is attached. herdr 0.9.3 cannot say whether a client is attached, so Peer then
 * opens one window per server run and trusts it is still there.
 *
 * @module peerHub/plugins/herdr/client/window
 */
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import type { HerdrProcessShape } from "./HerdrProcess.ts";
import type { HerdrSupervisor } from "./supervisor.ts";

/** How long a window may take to attach, polled while herdr can say; else this long, once. */
export const HERDR_ATTACH_WAIT = Duration.seconds(5);
const ATTACH_POLL = Duration.millis(250);
const UNKNOWN_WAIT = Duration.seconds(1);

export interface HerdrWindows {
  /**
   * Opens a terminal attached to Peer's herdr whether or not one is. With a pane, brings it
   * forward once the window is there. The reason it could not, with the command to attach by hand.
   */
  readonly open: (paneId?: string) => Effect.Effect<string | undefined>;
  /**
   * Makes sure a window is attached before an agent is shown, opening one if not (see the module
   * comment for "unknown"). Does nothing where the herdr in use is not Peer's.
   */
  readonly ensure: Effect.Effect<string | undefined>;
}

export function makeHerdrWindows(deps: {
  readonly port: HerdrProcessShape;
  readonly supervisor: HerdrSupervisor;
  readonly focus: (paneId: string, socketPath: string) => Promise<void>;
}): HerdrWindows {
  const { port, supervisor } = deps;
  /** Peer opened a window during this server run. */
  let opened = false;

  const launch = Effect.gen(function* () {
    const home = supervisor.home();
    const runtime = supervisor.snapshot();
    if (home === undefined)
      return "This computer has no herdr of Peer's own. Open your own herdr in a terminal.";
    if (runtime.source !== "peer" || runtime.state !== "running")
      return runtime.source === "own"
        ? "That herdr is yours: open it in your own terminal."
        : "Peer's herdr is not running. Start it in Settings → Workspaces first.";
    const result = yield* Effect.promise(() => port.openTerminal(home));
    if (!result.opened)
      return `${result.reason} To attach by hand, run: ${port.attachCommand(home)}`;
    opened = true;
    return undefined;
  });

  /** Waits for the window to attach: polling while herdr can say, else a moment. */
  const attached = Effect.gen(function* () {
    const home = supervisor.home();
    if (home === undefined) return;
    for (let waited = Duration.zero; Duration.isLessThan(waited, HERDR_ATTACH_WAIT);) {
      const clients = yield* Effect.promise(() => port.attachedClients(home));
      if (clients === "unknown") return yield* Effect.sleep(UNKNOWN_WAIT);
      if (clients > 0) return;
      yield* Effect.sleep(ATTACH_POLL);
      waited = Duration.sum(waited, ATTACH_POLL);
    }
  });

  return {
    open: (paneId) =>
      Effect.gen(function* () {
        const failure = yield* launch;
        if (failure !== undefined || paneId === undefined) return failure;
        yield* attached;
        return yield* Effect.promise(() => deps.focus(paneId, supervisor.socketPath())).pipe(
          Effect.as(undefined),
          Effect.orElseSucceed(() => "herdr could not bring that agent forward."),
        );
      }),
    ensure: Effect.gen(function* () {
      const home = supervisor.home();
      const runtime = supervisor.snapshot();
      if (home === undefined || runtime.source !== "peer" || runtime.state !== "running") return;
      const clients = yield* Effect.promise(() => port.attachedClients(home));
      if (clients === "unknown" ? opened : clients > 0) return;
      const failure = yield* launch;
      if (failure === undefined) yield* attached;
      return failure;
    }),
  };
}
