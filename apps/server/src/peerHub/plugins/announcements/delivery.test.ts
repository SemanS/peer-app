// @effect-diagnostics globalDate:off - fixed ISO timestamps for the pure state machine.
import { describe, expect, it } from "@effect/vitest";
import {
  eligible,
  freshDelivery,
  seed,
  candidates,
  prepare,
  confirmed,
  begin,
} from "./delivery.ts";
import type { PeerAnnouncement } from "@t3tools/contracts";
const now = Date.parse("2026-10-09T08:00:00Z");
const row = (id: string, more: Partial<PeerAnnouncement> = {}): PeerAnnouncement => ({
  id,
  project: "app",
  text: "CI red",
  author: { kind: "person", email: "ana@example.test" },
  createdAt: new Date(now - 1000).toISOString(),
  expiresAt: new Date(now + 60000).toISOString(),
  wake: true,
  ...more,
});
const session = { id: "claude:one", project: "app", task: "t1", status: "idle" } as const;
describe("announcement session delivery", () => {
  it("filters projects, tasks, expiry and wake switches", () => {
    expect(eligible(row("one"), session, now)).toBe(true);
    for (const more of [
      { project: "other" },
      { task: "t2" },
      { expiresAt: new Date(now).toISOString() },
      { status: "withdrawn" as const },
    ])
      expect(eligible(row("one", more), session, now)).toBe(false);
    const state = freshDelivery();
    expect(
      candidates([row("one")], state, session, now, { waking: true, wake: false }).active,
    ).toEqual([]);
    expect(
      candidates([row("one", { wake: false })], state, session, now, { waking: true, wake: true })
        .active,
    ).toEqual([]);
    expect(
      candidates([row("one")], state, { ...session, status: "working" }, now, {
        waking: true,
        wake: true,
      }).active,
    ).toEqual([]);
  });
  it("prepares synchronously, offers once, drops for retry and bounds oldest first", () => {
    const rows = [5, 4, 3, 2, 1].map((n) =>
      row(`${n}`, { createdAt: new Date(now - (6 - n) * 1000).toISOString() }),
    );
    const state = freshDelivery();
    const first = candidates(rows, state, session, now).active;
    expect(first.map((r) => r.id)).toEqual(["1", "2", "3"]);
    const refs = prepare(state, first, []);
    expect(candidates(rows, state, session, now).active.map((r) => r.id)).toEqual(["4", "5"]);
    confirmed(state, refs.slice(0, 1), "dropped");
    expect(candidates(rows, state, session, now).active[0]?.id).toBe("1");
    confirmed(state, refs.slice(1), "offered");
    expect(state.told.get("2")).toBe("offered");
    confirmed(state, refs.slice(1), "modelInput");
    confirmed(state, refs.slice(1), "offered");
    expect(state.told.get("2")).toBe("modelInput");
  });
  it("seeds resumed sessions, resets clear/startup and repeats per compaction", () => {
    const state = freshDelivery();
    const receipts = [
      {
        project: "app",
        announcement: "one",
        session: session.id,
        state: "offered" as const,
        offeredAt: new Date(now - 1000).toISOString(),
      },
    ];
    seed(state, receipts, session);
    begin(state, "resume", now);
    expect(candidates([row("one")], state, session, now).active).toEqual([]);
    begin(state, "compact", now);
    const repeated = candidates([row("one")], state, session, now).active;
    expect(repeated).toHaveLength(1);
    confirmed(state, prepare(state, repeated, []), "offered");
    expect(candidates([row("one")], state, session, now).active).toEqual([]);
    begin(state, "compact", now);
    expect(candidates([row("one")], state, session, now).active).toHaveLength(1);
    begin(state, "clear", now);
    seed(state, receipts, session);
    expect(candidates([row("one")], state, session, now).active).toHaveLength(1);
    begin(state, "startup", now);
    expect(state.hubIgnoredBefore).toBe(now);
  });
  it("only tells withdrawal to a session offered it and never wakes for it", () => {
    const state = freshDelivery();
    state.told.set("one", "offered");
    const withdrawn = row("one", {
      withdrawnAt: new Date(now - 500).toISOString(),
      status: "withdrawn",
    });
    expect(
      candidates([withdrawn, row("unseen", { ...withdrawn, id: "unseen" })], state, session, now)
        .withdrawn,
    ).toEqual([withdrawn]);
    expect(
      candidates([withdrawn], state, session, now, { waking: true, wake: true }).withdrawn,
    ).toEqual([]);
    const refs = prepare(state, [], [withdrawn]);
    confirmed(state, refs, "dropped");
    expect(candidates([withdrawn], state, session, now).withdrawn).toHaveLength(1);
    confirmed(state, prepare(state, [], [withdrawn]), "offered");
    expect(candidates([withdrawn], state, session, now).withdrawn).toEqual([]);
  });
});
