// @effect-diagnostics globalDate:off - notes written minutes ago, in wall-clock time.
import { describe, expect, it } from "@effect/vitest";

import type { HubCoordView, HubOverlap } from "../hub/coordApi.ts";
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
