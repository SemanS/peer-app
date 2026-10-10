/**
 * The herdr runtime as the plugin shows and changes it: the supervisor that decides which herdr
 * serves, with what the status adds to it (the integrations, read when Peer's herdr comes up and
 * after a change, never while the status is read) and the reasons an agent cannot start yet.
 *
 * @module peerHub/plugins/herdr/client/runtimeControl
 */
import type {
  PeerHerdrIntegration,
  PeerHerdrIntegrationAgent,
  PeerHerdrStatus,
} from "@t3tools/contracts";

import { herdrBlocker, HERDR_INSTALL_TEXT } from "./runtimeText.ts";
import {
  makeHerdrSupervisor,
  type HerdrSupervisor,
  type HerdrSupervisorOptions,
} from "./supervisor.ts";

interface HerdrRuntimeControl {
  readonly supervisor: HerdrSupervisor;
  /** The `herdr` field of the status: the setting, the runtime and the cached integrations. */
  readonly status: () => PeerHerdrStatus;
  /** One look at both herdrs (`supervisor.tick`); the first one makes the launch reasons trustworthy. */
  readonly tick: () => Promise<void>;
  /** Reads the integrations again; `onChange` hears of it. */
  readonly refreshIntegrations: () => Promise<void>;
  /** Installs or removes an integration; the reason it did not, or undefined. */
  readonly setIntegration: (
    agent: PeerHerdrIntegrationAgent,
    installed: boolean,
  ) => Promise<string | undefined>;
  /**
   * Why an agent cannot start now, or null; it first waits for the first look at herdr if that has
   * not finished, so "starting" is never only "not looked at yet". Where Peer has no herdr of its own to start, `list`
   * asks the herdr that answers there (the person's own), as Peer always did.
   */
  readonly launchBlocker: (
    list: (socketPath: string) => Promise<ReadonlyArray<unknown> | null>,
  ) => Promise<string | null>;
}

export function makeHerdrRuntimeControl(options: HerdrSupervisorOptions): HerdrRuntimeControl {
  let integrations: ReadonlyArray<PeerHerdrIntegration> = [];
  let peerWasUp = false;
  let looked = false;

  const refreshIntegrations = async () => {
    const home = supervisor.home();
    if (home === undefined) return;
    integrations = await options.port.integrations(home).catch(() => integrations);
    options.onChange?.(supervisor.snapshot());
  };

  const supervisor: HerdrSupervisor = makeHerdrSupervisor({
    ...options,
    onChange: (snapshot) => {
      const peerUp = snapshot.source === "peer" && snapshot.state === "running";
      if (peerUp && !peerWasUp) void refreshIntegrations();
      peerWasUp = peerUp;
      options.onChange?.(snapshot);
    },
  });

  const control: HerdrRuntimeControl = {
    supervisor,
    status: () => ({
      bundled: supervisor.bundled(),
      runtime: supervisor.snapshot(),
      integrations,
    }),
    tick: () => supervisor.tick().finally(() => void (looked = true)),
    refreshIntegrations,
    setIntegration: async (agent, installed) => {
      const home = supervisor.home();
      if (home === undefined) return "This computer has no herdr of Peer's own to change.";
      const change = await options.port
        .setIntegration(home, agent, installed)
        .catch(() => ({ ok: false, reason: "herdr could not change its integration." }) as const);
      await refreshIntegrations();
      return change.ok ? undefined : change.reason;
    },
    launchBlocker: async (list) => {
      if (!looked) await control.tick();
      const runtime = supervisor.snapshot();
      if (runtime.state !== "unavailable") return herdrBlocker(runtime);
      return (await list(supervisor.socketPath())) === null ? HERDR_INSTALL_TEXT : null;
    },
  };
  return control;
}
