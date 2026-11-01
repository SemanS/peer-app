// @effect-diagnostics nodeBuiltinImport:off globalDate:off - overlaps opened minutes ago, in wall-clock time, and memory files on disk.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import type { HubCoordSession, HubCoordView, HubOverlap } from "../hub/coordApi.ts";
import { CoordinationBroker } from "./Broker.ts";
import { NO_PLUGINS } from "./host.ts";
import type { LocalSession } from "./sessions.ts";
import { brokerFixture, wakingNotices } from "./testkit.ts";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** Ana's agent (`one`) and Zed's, on another computer, both change orders.js. */
const overlap: HubOverlap = {
  id: "c579e63feba4",
  project: "app",
  sessions: ["claude:one", "claude:zed"],
  files: ["src/orders.js"],
  openedAt: ago(34),
  updatedAt: ago(32),
};

const viewWith = (...overlaps: HubOverlap[]): HubCoordView => ({
  sessions: [
    {
      id: "claude:zed",
      project: "app",
      email: "zed@acme.test",
      environment: "zeds-mac",
      label: "Rename totals",
      agent: "claude",
      status: "idle",
      files: ["src/orders.js", "src/cart.js"],
      claims: [],
      seenAt: ago(1),
    },
  ],
  overlaps,
  at: new Date().toISOString(),
});

/** A broker with this view meets Ana's agent, waiting for its person: as its Stop hook's wait does. */
async function meet(broker: CoordinationBroker, root: string, view: HubCoordView) {
  broker.views.set("acme", view);
  await broker.sessionFor("claude", { session_id: "one", cwd: root }, undefined);
  const session = broker.sessions.get("claude:one")!;
  session.status = "idle";
  return session;
}

const decided = () => {
  const notices = wakingNotices();
  notices.tell("accepted", "Vir accepted your call.");
  return notices;
};

/** What its next step tells it of its overlaps. */
const overlapNews = (broker: CoordinationBroker, session: LocalSession) =>
  broker.news(session, { pending: false });

describe("what an agent heard, across a Peer restart", () => {
  it("does not wake an agent for what it heard before Peer restarted, or tell it again", async () => {
    const notices = decided();
    const fixture = await brokerFixture();
    try {
      const before = await meet(fixture.broker, fixture.root, viewWith(overlap));
      expect(overlapNews(fixture.broker, before)).toContain("src/orders.js");
      expect(await fixture.broker.wakingNews(before, notices.plugins)).toContain("Vir accepted");
      // Peer quits for an update and starts again; the agent still waits in its runtime.
      await fixture.broker.stop();
      const again = new CoordinationBroker(fixture.broker.host);
      const after = await meet(again, fixture.root, viewWith(overlap));
      expect(await again.wakingNews(after, notices.plugins)).toBeNull();
      expect(overlapNews(again, after)).toBeNull();
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });

  it("still wakes it for a notice that came while Peer was down, and leaves an overlap for its next step", async () => {
    const notices = decided();
    const fixture = await brokerFixture();
    try {
      const before = await meet(fixture.broker, fixture.root, viewWith(overlap));
      expect(overlapNews(fixture.broker, before)).not.toBeNull();
      expect(await fixture.broker.wakingNews(before, notices.plugins)).not.toBeNull();
      await fixture.broker.stop();
      const again = new CoordinationBroker(fixture.broker.host);
      notices.tell("declined", "Vir declined your other call.");
      const after = await meet(again, fixture.root, viewWith(overlap));
      expect(await again.wakingNews(after, notices.plugins)).toBe("Vir declined your other call.");
      expect(overlapNews(again, after)).toBeNull();
      const cart: HubOverlap = {
        ...overlap,
        id: "d81f0c2a9b77",
        files: ["src/cart.js"],
        openedAt: ago(0),
        updatedAt: ago(0),
      };
      again.views.set("acme", viewWith(overlap, cart));
      expect(await again.wakingNews(after, notices.plugins)).toBeNull();
      expect(overlapNews(again, after)).toContain("src/cart.js");
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });

  it("tells it again what still waited for its next step when Peer stopped", async () => {
    const notices = decided();
    const fixture = await brokerFixture();
    try {
      const before = await meet(fixture.broker, fixture.root, viewWith(overlap));
      const news = overlapNews(fixture.broker, before);
      const woken = await fixture.broker.wakingNews(before, notices.plugins);
      // It went back to work before the wake reached it: both wait for its next step.
      before.pending.push(news!, woken!);
      await fixture.broker.stop();
      const again = new CoordinationBroker(fixture.broker.host);
      const after = await meet(again, fixture.root, viewWith(overlap));
      expect(await again.wakingNews(after, notices.plugins)).toContain("Vir accepted");
      expect(overlapNews(again, after)).toContain("src/orders.js");
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });

  it("keeps what it heard when Peer ends without stopping", async () => {
    const notices = decided();
    const fixture = await brokerFixture();
    try {
      const before = await meet(fixture.broker, fixture.root, viewWith(overlap));
      expect(overlapNews(fixture.broker, before)).not.toBeNull();
      expect(await fixture.broker.wakingNews(before, notices.plugins)).not.toBeNull();
      // What the broker's tick writes; then the process is gone, without `stop`.
      await fixture.broker.saveMemories();
      const again = new CoordinationBroker(fixture.broker.host);
      const after = await meet(again, fixture.root, viewWith(overlap));
      expect(await again.wakingNews(after, notices.plugins)).toBeNull();
      expect(overlapNews(again, after)).toBeNull();
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });
});

/** Zed's agent, on another computer, at work on the cart's totals (task `t_cart`). */
const zed = (over: Partial<HubCoordSession> = {}): HubCoordSession => ({
  id: "claude:zed",
  project: "app",
  email: "zed@acme.test",
  environment: "zeds-mac",
  label: "Cart totals",
  agent: "claude",
  task: "t_cart",
  status: "working",
  intent: "Rename totals",
  files: ["src/cart.js"],
  claims: [],
  seenAt: ago(1),
  activeAt: ago(1),
  ...over,
});

/** The project as Ana's computer sees it: Zed's agent at work, and what `over` adds. */
const team = (over: Partial<HubCoordView> = {}): HubCoordView => ({
  sessions: [zed()],
  overlaps: [],
  at: new Date().toISOString(),
  ...over,
});

/** Peer quits (for an update) and starts again: a broker on the same computer's directories. */
async function restart(broker: CoordinationBroker) {
  await broker.stop();
  return new CoordinationBroker(broker.host);
}

describe("what else an agent was told, across a Peer restart", () => {
  it("does not show people an overlap again, but one that opened while Peer was down", async () => {
    const fixture = await brokerFixture();
    try {
      const shown = vi.fn(async (_title: string, _body: string) => undefined);
      fixture.broker.notifyPeople = shown;
      await meet(fixture.broker, fixture.root, viewWith(overlap));
      fixture.broker.afterViewChange("acme");
      expect(shown).toHaveBeenCalledOnce();
      const again = await restart(fixture.broker);
      again.notifyPeople = shown;
      await meet(again, fixture.root, viewWith(overlap));
      again.afterViewChange("acme");
      expect(shown).toHaveBeenCalledOnce();
      again.views.set("acme", viewWith(overlap, { ...overlap, id: "d81f0c2a9b77" }));
      again.afterViewChange("acme");
      expect(shown).toHaveBeenCalledTimes(2);
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });

  it("keeps what a plugin told a session across a restart, and forgets it with a new conversation", async () => {
    const fixture = await brokerFixture();
    try {
      const before = await meet(fixture.broker, fixture.root, team());
      fixture.broker.sessionView(before).told!("observe").add("rounding");
      const again = await restart(fixture.broker);
      const after = await meet(again, fixture.root, team());
      expect(again.sessionView(after).told!("observe").has("rounding")).toBe(true);
      // A new conversation starts, and something waits for its next step when Peer quits.
      await again.hook(
        {
          session_id: "one",
          cwd: fixture.root,
          hook_event_name: "SessionStart",
          source: "startup",
        },
        {},
      );
      after.pending.push("Peer: a note that waits for its next step");
      const third = await restart(again);
      const last = await meet(third, fixture.root, team());
      expect(third.sessionView(last).told!("observe").has("rounding")).toBe(false);
      await third.stop();
    } finally {
      await fixture.dispose();
    }
  });

  it("forgets on disk what a plugin dropped, though something waits for its next step", async () => {
    const fixture = await brokerFixture();
    try {
      const before = await meet(fixture.broker, fixture.root, team());
      const told = fixture.broker.sessionView(before).told!("audit");
      told.add("free:resource:cache");
      await fixture.broker.saveMemories();
      // Told again once it is free again; meanwhile a note waits for its next step.
      told.delete("free:resource:cache");
      before.pending.push("Peer: a note that waits for its next step");
      const again = await restart(fixture.broker);
      const after = await meet(again, fixture.root, team());
      expect(again.sessionView(after).told!("audit").has("free:resource:cache")).toBe(false);
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });

  it("reads a file from where a Peer from before kept it, and writes it in the new place", async () => {
    const fixture = await brokerFixture();
    try {
      const before = await meet(fixture.broker, fixture.root, team());
      const memoryPath = before.memoryPath;
      await fixture.broker.stop();
      const former = fixture.broker.host.formerMemoryPath(memoryPath);
      await NodeFSP.mkdir(NodePath.dirname(former), { recursive: true });
      await NodeFSP.writeFile(
        former,
        JSON.stringify({
          announced: ["overlap-1:1"],
          acknowledged: ["overlap-1"],
          // What a Peer from before kept besides: read back as nothing.
          read: [["project", 4, 4, 0]],
          told: ["task:other"],
          plugins: { observe: ["rounding"] },
        }),
      );
      await NodeFSP.rm(memoryPath, { force: true });
      const again = new CoordinationBroker(fixture.broker.host);
      const after = await meet(again, fixture.root, team());
      expect(after.memory.announced.has("overlap-1:1")).toBe(true);
      expect(after.memory.acknowledged.has("overlap-1")).toBe(true);
      expect(again.sessionView(after).told!("observe").has("rounding")).toBe(true);
      after.memory.notified.add("overlap-2");
      await again.saveMemories();
      expect(JSON.parse(await NodeFSP.readFile(memoryPath, "utf8"))).toEqual({
        announced: ["overlap-1:1"],
        acknowledged: ["overlap-1"],
        notified: ["overlap-2"],
        plugins: { observe: ["rounding"] },
      });
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });

  it("forgets the memory files nobody wrote for months, except those of sessions it holds", async () => {
    const fixture = await brokerFixture();
    try {
      const session = await meet(fixture.broker, fixture.root, team());
      const dir = fixture.broker.host.memoryDir;
      const old = NodePath.join(dir, "acme", "app", "gone.memory.json");
      const recent = NodePath.join(dir, "acme", "app", "recent.memory.json");
      await NodeFSP.mkdir(NodePath.dirname(old), { recursive: true });
      await NodeFSP.mkdir(NodePath.dirname(session.memoryPath), { recursive: true });
      for (const path of [old, recent, session.memoryPath]) await NodeFSP.writeFile(path, "{}");
      const longAgo = new Date(0);
      await NodeFSP.utimes(old, longAgo, longAgo);
      await NodeFSP.utimes(session.memoryPath, longAgo, longAgo);
      await fixture.broker.forgetOldMemories();
      await expect(NodeFSP.access(old)).rejects.toThrow();
      await expect(NodeFSP.access(recent)).resolves.toBeUndefined();
      await expect(NodeFSP.access(session.memoryPath)).resolves.toBeUndefined();
    } finally {
      await fixture.dispose();
    }
  });

  it("keeps it hearing what a late answer queued for its next step, should Peer quit first", async () => {
    // A plugin's notice takes its time, so the hook's answer is ready only after its script gave up.
    let reading!: () => void;
    const read = new Promise<void>((resolve) => {
      reading = resolve;
    });
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => {
      answer = resolve;
    });
    const fixture = await brokerFixture(() => ({
      plugins: async () => ({
        ...NO_PLUGINS,
        active: [
          {
            id: "observe",
            title: "observe",
            contributions: {
              hooks: {
                notices: [
                  {
                    wakes: false,
                    read: () =>
                      Effect.promise(() => {
                        reading();
                        return answered.then(() => "Lore applies to your change.");
                      }),
                  },
                ],
              },
            },
          },
        ],
      }),
    }));
    try {
      const before = await meet(fixture.broker, fixture.root, viewWith(overlap));
      const late = { passed: false };
      const hook = fixture.broker.hook(
        {
          session_id: "one",
          cwd: fixture.root,
          hook_event_name: "PostToolUse",
          tool_name: "Edit",
          tool_input: { file_path: NodePath.join(fixture.root, "src/cart.js") },
        },
        {},
        late,
      );
      await read;
      // The broker's tick, while the answer, with the overlap in it, waits for the plugin.
      await fixture.broker.saveMemories();
      late.passed = true;
      answer();
      await hook;
      const queued = before.pending.map((part) => (typeof part === "string" ? part : part.text));
      expect(queued.join("\n")).toContain("src/orders.js");
      const again = await restart(fixture.broker);
      const after = await meet(again, fixture.root, viewWith(overlap));
      expect(overlapNews(again, after)).toContain("src/orders.js");
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });
});
