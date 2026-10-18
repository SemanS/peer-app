import type { PeerHerdrStatus } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  capacityLine,
  launchGuidance,
  startFromBase,
  startFromOptions,
  startInput,
} from "./StartTaskAgent.logic";
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
      blocked:
        "Peer's herdr is off. Turn it on in Settings → Peer → Coordination & plugins, or start your own herdr.",
      installLink: false,
    });
  });

  it("gives the reason a failed herdr gave, without the install link", () => {
    expect(guidance({ source: "none", state: "failed", reason: "It exited at once." })).toEqual({
      blocked: "It exited at once. Restart it in Settings → Peer → Coordination & plugins.",
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

describe("the capacity an agent runs on", () => {
  it("is the person's own login of the chosen agent when the project allows it", () => {
    const any = { project: { capacity: { personal: "any" } } };
    expect(capacityLine(any, "claude")).toEqual({
      allowed: true,
      line: "Your own Claude Code login · runs only your work",
    });
    expect(capacityLine(any, "codex").line).toBe("Your own Codex login · runs only your work");
  });

  it("says the policy forbids it otherwise", () => {
    expect(capacityLine({ project: { capacity: { personal: "commercial" } } }, "claude")).toEqual({
      allowed: false,
      line: "This project's capacity policy does not let herdr agents run on your own login.",
    });
  });
});

describe("the Start from options", () => {
  const thread = (branch: string | undefined, vcs: "git" | "jj" = "jj", person = "ana") => ({
    key: `t-${branch}`,
    person,
    mine: false,
    branch,
    vcs,
    agent: { harness: "claude" },
  });
  const tasks = [
    {
      id: "a",
      key: "ORD-12",
      title: "Loyalty",
      done: false,
      threads: [thread("feature/ORD-12-x")],
    },
    {
      id: "b",
      key: "ORD-11",
      title: "Receipt totals in cents",
      done: false,
      threads: [thread("feature/ORD-11-cents"), thread("feature/ORD-11-cents"), thread(undefined)],
    },
    {
      id: "c",
      key: "ORD-14",
      title: "VAT",
      done: false,
      threads: [thread("feature/ORD-14", "git")],
    },
    { id: "d", key: "ORD-9", title: "Refund", done: true, threads: [thread("feature/ORD-9")] },
  ];

  it("lists other open tasks' jj bookmarks, once each, without the task being started", () => {
    expect(startFromOptions(tasks, "a", { person: (person) => person })).toEqual([
      {
        value: "feature/ORD-11-cents",
        bookmark: "feature/ORD-11-cents",
        title: "ana's change for ORD-11",
        detail: "ORD-11 Receipt totals in cents · ana · Claude Code",
      },
    ]);
  });

  it("keeps main as the repository's own base", () => {
    expect(startFromBase(null)).toBeUndefined();
    expect(startFromBase("feature/ORD-11-cents")).toBe("feature/ORD-11-cents");
  });
});
