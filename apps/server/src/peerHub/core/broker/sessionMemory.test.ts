// @effect-diagnostics nodeBuiltinImport:off globalDate:off - notes written minutes ago, in wall-clock time, and an edit in the checkout.
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import type {
  HubContextText,
  HubCoordSession,
  HubCoordView,
  HubFinding,
  HubOverlap,
} from "../hub/coordApi.ts";
import { CoordinationBroker } from "./Broker.ts";
import { NO_PLUGINS } from "./host.ts";
import { brokerFixture } from "./testkit.ts";

const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/**
 * Ana's agent (`one`) and Zed's, on another computer, both change orders.js: each wrote a note half
 * an hour ago, so the overlap is quiet and Ana's agent, which closes it, is asked to.
 */
const overlap: HubOverlap = {
  id: "c579e63feba4",
  project: "app",
  sessions: ["claude:one", "claude:zed"],
  files: ["src/orders.js"],
  state: "open",
  notes: [
    {
      id: "n1",
      session: "claude:zed",
      email: "zed@acme.test",
      text: "I rename total() in orders.js",
      at: ago(33),
    },
    {
      id: "n2",
      session: "claude:one",
      email: "ana@acme.test",
      text: "Fine, I only add a discount",
      at: ago(32),
    },
  ],
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

describe("what an agent heard, across a Peer restart", () => {
  it("does not wake an agent for an overlap it heard before Peer restarted", async () => {
    const fixture = await brokerFixture();
    try {
      const before = await meet(fixture.broker, fixture.root, viewWith(overlap));
      const heard = await fixture.broker.wakingNews(before, NO_PLUGINS);
      expect(heard).toContain("I rename total()");
      expect(heard).toContain("quiet");
      // Peer quits for an update and starts again; the agent still waits in its runtime.
      await fixture.broker.stop();
      const again = new CoordinationBroker(fixture.broker.host);
      const after = await meet(again, fixture.root, viewWith(overlap));
      expect(await again.wakingNews(after, NO_PLUGINS)).toBeNull();
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });

  it("still wakes it for a note or an overlap that came while Peer was down", async () => {
    const fixture = await brokerFixture();
    try {
      const before = await meet(fixture.broker, fixture.root, viewWith(overlap));
      expect(await fixture.broker.wakingNews(before, NO_PLUGINS)).not.toBeNull();
      await fixture.broker.stop();
      const again = new CoordinationBroker(fixture.broker.host);
      const note = {
        id: "n3",
        session: "claude:zed",
        email: "zed@acme.test",
        text: "Renamed; pull before you push",
        at: ago(0),
      };
      const after = await meet(
        again,
        fixture.root,
        viewWith({ ...overlap, notes: [...overlap.notes, note], updatedAt: note.at }),
      );
      const told = await again.wakingNews(after, NO_PLUGINS);
      expect(told).toContain("pull before you push");
      expect(told).not.toContain("I rename total()");
      const cart: HubOverlap = {
        ...overlap,
        id: "d81f0c2a9b77",
        files: ["src/cart.js"],
        notes: [],
        openedAt: ago(0),
        updatedAt: ago(0),
      };
      again.views.set("acme", viewWith({ ...overlap, notes: [...overlap.notes, note] }, cart));
      expect(await again.wakingNews(after, NO_PLUGINS)).toContain("src/cart.js");
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });

  it("tells it again what still waited for its next step when Peer stopped", async () => {
    const fixture = await brokerFixture();
    try {
      const before = await meet(fixture.broker, fixture.root, viewWith(overlap));
      const heard = await fixture.broker.wakingNews(before, NO_PLUGINS);
      // It went back to work before the wake reached it: the news waits for its next step.
      before.pending.push(heard!);
      await fixture.broker.stop();
      const again = new CoordinationBroker(fixture.broker.host);
      const after = await meet(again, fixture.root, viewWith(overlap));
      expect(await again.wakingNews(after, NO_PLUGINS)).toContain("I rename total()");
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });

  it("keeps what it heard when Peer ends without stopping", async () => {
    const fixture = await brokerFixture();
    try {
      const before = await meet(fixture.broker, fixture.root, viewWith(overlap));
      expect(await fixture.broker.wakingNews(before, NO_PLUGINS)).not.toBeNull();
      // What the broker's tick writes; then the process is gone, without `stop`.
      await fixture.broker.saveMemories();
      const again = new CoordinationBroker(fixture.broker.host);
      const after = await meet(again, fixture.root, viewWith(overlap));
      expect(await again.wakingNews(after, NO_PLUGINS)).toBeNull();
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

/** What Zed's agent shared about the work outside tasks, which Ana's agent is on too. */
const finding: HubFinding = {
  id: "f-cents",
  project: "app",
  text: "Totals are integer cents everywhere",
  email: "zed@acme.test",
  session: "claude:zed",
  environment: "zeds-mac",
  at: ago(5),
};

/** The shared context of the work outside tasks, kept by another agent, at `version`. */
const shared = (version: number, text: string): HubContextText => ({
  project: "app",
  scope: "project",
  version,
  updatedAt: ago(10),
  updatedBy: "zed@acme.test",
  text,
});

/** Peer quits (for an update) and starts again: a broker on the same computer's directories. */
async function restart(broker: CoordinationBroker) {
  await broker.stop();
  return new CoordinationBroker(broker.host);
}

describe("what else an agent was told, across a Peer restart", () => {
  it("does not give it the index of the others' work again, only what changed meanwhile", async () => {
    const fixture = await brokerFixture();
    try {
      const before = await meet(fixture.broker, fixture.root, team());
      expect(fixture.broker.discoveryFor(before)).toContain("Rename totals");
      const again = await restart(fixture.broker);
      const after = await meet(again, fixture.root, team());
      expect(again.discoveryFor(after)).toBeNull();
      again.views.set("acme", team({ sessions: [zed({ intent: "Split totals by tax" })] }));
      const changed = again.discoveryFor(after);
      expect(changed).toContain("since you were told");
      expect(changed).toContain("Split totals by tax");
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });

  it("tells it nothing while Peer, just started, does not know the project's tasks yet", async () => {
    // Peer reads the project's tasks from the Hub a moment after it starts; until then a work goes
    // by its task's id, which would make it news.
    const known = { current: true };
    const fixture = await brokerFixture(() => ({
      workKnown: () => known.current,
      tasks: () => (known.current ? [{ id: "t_cart", key: "ORD-9", title: "Cart totals" }] : []),
      taskName: (_workspace, _project, task) =>
        known.current && task === "t_cart" ? "ORD-9 · Cart totals" : task,
    }));
    try {
      const before = await meet(fixture.broker, fixture.root, team());
      expect(fixture.broker.discoveryFor(before)).toContain("ORD-9 Cart totals");
      known.current = false;
      const again = await restart(fixture.broker);
      const after = await meet(again, fixture.root, team());
      expect(again.discoveryFor(after)).toBeNull();
      known.current = true;
      expect(again.discoveryFor(after)).toBeNull();
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });

  it("tells a conversation that started again what the old one was told, though Peer stopped before its next step", async () => {
    const fixture = await brokerFixture();
    try {
      const before = await meet(fixture.broker, fixture.root, team());
      expect(fixture.broker.discoveryFor(before)).not.toBeNull();
      await fixture.broker.saveMemories();
      // Its context is compacted, and something waits for its next step when Peer quits.
      await fixture.broker.startContextFor(before, "compact", NO_PLUGINS);
      before.pending.push("Peer: a note that waits for its next step");
      const again = await restart(fixture.broker);
      const after = await meet(again, fixture.root, team());
      expect(again.discoveryFor(after)).toContain("Rename totals");
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });

  it("does not tell it again a finding it heard, which it still reports heard", async () => {
    const fixture = await brokerFixture();
    try {
      const before = await meet(fixture.broker, fixture.root, team({ findings: [finding] }));
      expect(fixture.broker.findingNews(before)).toContain("team findings available");
      const again = await restart(fixture.broker);
      const after = await meet(again, fixture.root, team({ findings: [finding] }));
      expect(again.findingNews(after)).toBeNull();
      // Should its agent say it again, the Hub's knowledge counts no independent discovery.
      expect(again.reportFor("acme")[0]?.heard).toContain("f-cents");
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });

  it("does not tell a reader its work's shared context changed when it did not", async () => {
    const fixture = await brokerFixture();
    try {
      await fixture.broker.mirror("acme", shared(2, "# app\n- totals are cents\n"));
      const before = await meet(fixture.broker, fixture.root, team());
      // It starts reading its work's shared context, which another agent keeps.
      await fixture.broker.startContextFor(before, "startup", NO_PLUGINS);
      const again = await restart(fixture.broker);
      // The new broker reads the context again from the Hub, as it does after a restart.
      await again.mirror("acme", shared(2, "# app\n- totals are cents\n"));
      const after = await meet(again, fixture.root, team());
      expect(again.sharedNews(after)).toBeNull();
      // A version written while Peer was down is news; Peer no longer has the lines it read.
      await again.mirror("acme", shared(3, "# app\n- totals are cents\n- tax on top\n"));
      const changed = again.sharedNews(after);
      expect(changed).toContain("changed (version 3");
      expect(changed).not.toContain("lines added");
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });

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
            id: "knowledge",
            title: "knowledge",
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
      const before = await meet(fixture.broker, fixture.root, team({ findings: [finding] }));
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
      // The broker's tick, while the answer, with the finding in it, waits for the plugin.
      await fixture.broker.saveMemories();
      late.passed = true;
      answer();
      await hook;
      const queued = before.pending.map((part) => (typeof part === "string" ? part : part.text));
      expect(queued.join("\n")).toContain("team findings available");
      const again = await restart(fixture.broker);
      const after = await meet(again, fixture.root, team({ findings: [finding] }));
      expect(again.findingNews(after)).toContain("team findings available");
      await again.stop();
    } finally {
      await fixture.dispose();
    }
  });
});
