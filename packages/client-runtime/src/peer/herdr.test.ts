import { describe, expect, it } from "@effect/vitest";
import type { PeerHerdrRuntime, PeerHerdrStatus, PeerHubFocusAgentInput } from "@t3tools/contracts";
import * as Layer from "effect/Layer";
import { Atom } from "effect/reactivity";

import * as EnvironmentRegistry from "../connection/registry.ts";
import {
  createPeerHerdrAtoms,
  herdrAttachOffer,
  herdrNeedsInstall,
  herdrRuntimeLabel,
  peerAgentStartBlocker,
  peerLaunchBlocker,
  peerCoordinationDetail,
  peerCoordinationLabel,
} from "./herdr.ts";

const status = { signedIn: true, agents: { herdr: "running" as const } };
const project = { project: { capacity: { personal: "any" } }, repositories: [{ state: "ready" }] };
describe("the shared task launch blocker", () => {
  it("prioritizes sign in, herdr, capacity, then a ready checkout", () => {
    expect(peerLaunchBlocker({ ...status, signedIn: false }, project)).toContain("Sign in");
    expect(peerLaunchBlocker({ ...status, agents: { herdr: "not-running" } }, project)).toContain(
      "herdr",
    );
    expect(
      peerLaunchBlocker(status, { ...project, project: { capacity: { personal: "approved" } } }),
    ).toContain("approved provider");
    expect(
      peerLaunchBlocker(status, { ...project, repositories: [{ state: "cloning" }] }),
    ).toContain("Clone");
    expect(peerLaunchBlocker(status, project)).toBeNull();
  });
});
describe("coordination level labels", () => {
  it("renders advisory tools on C without upgrading the wire level", () => {
    expect(peerCoordinationLabel("C", true)).toBe("B-mcp · advisory tools");
    expect(peerCoordinationDetail("C", true)).toContain("cannot stop");
    for (const level of ["A", "B"] as const) {
      expect(peerCoordinationLabel(level, true)).toBe(peerCoordinationLabel(level));
      expect(peerCoordinationDetail(level, true)).toBe(peerCoordinationDetail(level));
    }
    expect(peerCoordinationLabel("C")).toBe("C · observed after work");
  });
});

/** A status whose herdr runtime is `runtime`, on a server that reports it. */
const withRuntime = (
  runtime: Partial<PeerHerdrRuntime>,
  legacy: "running" | "not-running" = "running",
) => {
  const herdr: PeerHerdrStatus = {
    bundled: true,
    runtime: {
      source: "none",
      state: "running",
      agents: 0,
      resumable: 0,
      otherRunning: false,
      ...runtime,
    },
    integrations: [],
  };
  return { signedIn: true, agents: { herdr: legacy }, herdr };
};

describe("the herdr runtime in a line", () => {
  it("names which herdr serves, its version and its state", () => {
    const peers = {
      source: "peer",
      version: "0.9.3",
      attachCommand: "herdr --session peer-1",
    } as const;
    expect(herdrRuntimeLabel(withRuntime({ ...peers, agents: 2 }))).toBe(
      "Peer's herdr 0.9.3 · running · 2 agents",
    );
    expect(herdrRuntimeLabel(withRuntime({ ...peers, agents: 1 }))).toBe(
      "Peer's herdr 0.9.3 · running · 1 agent",
    );
    expect(herdrRuntimeLabel(withRuntime({ ...peers }))).toBe(
      "Peer's herdr 0.9.3 · running · no agents",
    );
    expect(herdrRuntimeLabel(withRuntime({ source: "own", version: "0.9.4", agents: 3 }))).toBe(
      "Your herdr 0.9.4",
    );
    expect(herdrRuntimeLabel(withRuntime({ state: "starting" }))).toBe("Starting…");
    expect(herdrRuntimeLabel(withRuntime({ state: "stopping" }))).toBe("Restarting…");
    expect(herdrRuntimeLabel(withRuntime({ state: "off" }))).toBe("Off");
    expect(
      herdrRuntimeLabel(
        withRuntime({ state: "failed", reason: "herdr did not answer within 15 seconds." }),
      ),
    ).toBe("Failed: herdr did not answer within 15 seconds.");
    expect(herdrRuntimeLabel(withRuntime({ state: "unavailable" }))).toBe(
      "No herdr · install herdr on this computer",
    );
  });

  it("falls back on whether herdr answers when the server reports no runtime", () => {
    expect(herdrRuntimeLabel({ agents: { herdr: "running" } })).toBe("herdr is running");
    expect(herdrRuntimeLabel({ agents: { herdr: "not-running" } })).toBe(
      "No herdr · install herdr on this computer",
    );
  });
});

describe("why an agent cannot start in herdr", () => {
  it("says it for each state of the runtime", () => {
    const blocker = (runtime: Partial<PeerHerdrRuntime>) =>
      peerAgentStartBlocker(withRuntime(runtime, "not-running"));
    expect(blocker({ source: "peer", state: "running" })).toBeNull();
    expect(blocker({ source: "own", state: "running" })).toBeNull();
    expect(blocker({ state: "starting" })).toBe("herdr is starting on this computer");
    expect(blocker({ state: "stopping" })).toBe("herdr is restarting on this computer");
    expect(blocker({ state: "off" })).toBe(
      "Peer's herdr is off. Turn it on in Settings → Peer → Coordination & plugins, or start your own herdr.",
    );
    expect(
      blocker({ state: "failed", reason: "herdr exited right after it started (code 1)." }),
    ).toBe(
      "herdr exited right after it started (code 1). Restart it in Settings → Peer → Coordination & plugins.",
    );
    expect(blocker({ state: "unavailable" })).toBe(
      "Install and start herdr on the selected environment, then try again.",
    );
  });

  it("keeps today's words from a server that reports no runtime", () => {
    expect(peerAgentStartBlocker({ signedIn: true, agents: { herdr: "running" } })).toBeNull();
    expect(peerAgentStartBlocker({ signedIn: true, agents: { herdr: "not-running" } })).toBe(
      "Install and start herdr on the selected environment, then try again.",
    );
  });

  it("asks to sign in before anything about herdr, and feeds the launch blocker", () => {
    expect(peerAgentStartBlocker({ ...withRuntime({ state: "off" }), signedIn: false })).toContain(
      "Sign in",
    );
    expect(peerLaunchBlocker(withRuntime({ state: "off" }), project)).toContain(
      "Peer's herdr is off",
    );
    expect(peerLaunchBlocker(withRuntime({ state: "starting" }), project)).toBe(
      "herdr is starting on this computer",
    );
    expect(peerLaunchBlocker(withRuntime({ source: "peer" }), project)).toBeNull();
  });

  it("offers the install link only where Peer has no herdr to run and none answers", () => {
    expect(herdrNeedsInstall(withRuntime({ state: "unavailable" }, "not-running"))).toBe(true);
    for (const state of ["running", "starting", "stopping", "off", "failed"] as const)
      expect(herdrNeedsInstall(withRuntime({ state }, "not-running"))).toBe(false);
    expect(herdrNeedsInstall({ agents: { herdr: "not-running" } })).toBe(true);
    expect(herdrNeedsInstall({ agents: { herdr: "running" } })).toBe(false);
  });
});

describe("attaching a terminal to Peer's herdr", () => {
  const peers = { source: "peer", attachCommand: "herdr --session peer-1" } as const;
  it("opens a window only from the desktop app on its own computer", () => {
    expect(herdrAttachOffer(withRuntime(peers), true)).toBe("open");
    expect(herdrAttachOffer(withRuntime(peers), false)).toBe("copy");
  });

  it("offers nothing where Peer's herdr does not run, or is not Peer's", () => {
    expect(herdrAttachOffer(withRuntime({ source: "own", version: "0.9.4" }), true)).toBe("none");
    for (const state of ["starting", "stopping", "off", "failed", "unavailable"] as const)
      expect(herdrAttachOffer(withRuntime({ ...peers, state }), true)).toBe("none");
    expect(herdrAttachOffer({ agents: { herdr: "running" } }, true)).toBe("none");
  });

  it("has no command to copy when the server sent none", () => {
    expect(herdrAttachOffer(withRuntime({ source: "peer" }), false)).toBe("none");
  });
});

describe("the herdr atoms", () => {
  it("have a command for each of the owner's controls and for showing an agent", () => {
    const environments = {} as EnvironmentRegistry.EnvironmentRegistry["Service"];
    const atoms = createPeerHerdrAtoms(
      Atom.runtime(Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environments)),
    );
    expect(Object.keys(atoms).toSorted()).toEqual([
      "peerHerdrOpenTerminal",
      "peerHerdrRestartRuntime",
      "peerHerdrSetIntegration",
      "peerHerdrSetRuntime",
      "peerHubFocusAgent",
      "peerHubPromptAgent",
      "peerHubWatchAgent",
    ]);
  });

  it("take openWindow beside the pane when showing an agent", () => {
    // Compile-time: the focus command's input is the contract's, with its optional openWindow.
    const input = { paneId: "w1:p1", openWindow: true } satisfies PeerHubFocusAgentInput;
    expect(input.openWindow).toBe(true);
  });
});
