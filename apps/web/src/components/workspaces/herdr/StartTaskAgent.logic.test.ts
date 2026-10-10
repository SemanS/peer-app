import type { PeerHerdrStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { launchGuidance, startInput } from "./StartTaskAgent.logic";
describe("task launch input", () => {
  it("keeps sender data out of request instructions without changing normal prompts", () => {
    const request = { id: "one" } as Parameters<typeof startInput>[0];
    expect(startInput(request, "  My own instruction  ")).toEqual({
      requestId: "one",
      instruction: "My own instruction",
    });
    expect(startInput(undefined, "  Ordinary prompt  ")).toEqual({ prompt: "Ordinary prompt" });
  });
});

describe("the launch guidance per herdr state", () => {
  const project = {
    project: { capacity: { personal: "any" } },
    repositories: [{ state: "ready" }],
  };
  const guidance = (runtime: Partial<PeerHerdrStatus["runtime"]> | null, herdrRunning = false) =>
    launchGuidance(
      {
        signedIn: true,
        agents: { herdr: herdrRunning ? "running" : "not-running" },
        herdr:
          runtime === null
            ? undefined
            : {
                bundled: true,
                runtime: {
                  source: "peer",
                  state: "running",
                  agents: 0,
                  resumable: 0,
                  otherRunning: false,
                  ...runtime,
                },
                integrations: [],
              },
      },
      project,
    );

  it("starts and offers no install link while herdr runs", () => {
    expect(guidance({})).toEqual({ blocked: null, installLink: false });
    expect(guidance({ source: "own" })).toEqual({ blocked: null, installLink: false });
  });

  it("says Peer's herdr is off, without the install link", () => {
    expect(guidance({ source: "none", state: "off" })).toEqual({
      blocked: "Peer's herdr is off. Turn it on in Settings → Workspaces, or start your own herdr.",
      installLink: false,
    });
  });

  it("gives the reason a failed herdr gave, without the install link", () => {
    expect(guidance({ source: "none", state: "failed", reason: "It exited at once." })).toEqual({
      blocked: "It exited at once. Restart it in Settings → Workspaces.",
      installLink: false,
    });
  });

  it("waits while herdr starts or restarts, without the install link", () => {
    expect(guidance({ state: "starting" })).toEqual({
      blocked: "herdr is starting on this computer",
      installLink: false,
    });
    expect(guidance({ state: "stopping" }).installLink).toBe(false);
  });

  it("offers the install link only where no herdr is available", () => {
    expect(guidance({ source: "none", state: "unavailable" })).toEqual({
      blocked: "Install and start herdr on the selected environment, then try again.",
      installLink: true,
    });
  });

  it("keeps today's behavior with a server that predates the runtime", () => {
    expect(guidance(null).installLink).toBe(true);
    expect(guidance(null, true)).toEqual({ blocked: null, installLink: false });
  });
});
