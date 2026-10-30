import {
  PEER_ROOM_DELIVERY_STATES,
  type PeerRoomMessage,
  type PeerRoomTarget,
  type PeerRoomsStatus,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  anchorState,
  anchorText,
  availableActions,
  deliveryOf,
  deliveryWords,
  needsYouByTask,
  roomBadgeCount,
  roomNeedsYou,
  roomRev,
  roomSeq,
  targetsFor,
  waitsOnMe,
} from "./rooms.ts";

const ANA = "ana@acme.test";
const BOB = "bob@acme.test";
const EVA = "eva@acme.test";
const nameOf = (email: string) => (email === ANA ? "Ana" : email === BOB ? "Bob" : "Eva");

const delivery = (state: string, extra: Partial<PeerRoomTarget> = {}): PeerRoomTarget => ({
  kind: "agent",
  email: ANA,
  state,
  ...extra,
});
const message = (to: ReadonlyArray<PeerRoomTarget>, author = BOB): PeerRoomMessage => ({
  seq: 12,
  task: "t-1",
  at: "2026-10-30T10:00:00Z",
  author: { email: author },
  text: "Why?",
  to,
});
const words = (target: PeerRoomTarget, me = BOB) => deliveryWords(target, { me, nameOf });

describe("deliveryWords", () => {
  it.each([
    ["waiting", {}, "Waiting for Ana"],
    ["passed", {}, "Passed on to Ana's agent"],
    ["taken", { run: "run_1" }, "With Ana's agent"],
    ["taken", {}, "Ana's agent may not have started"],
    ["heard", { run: "run_1" }, "Ana's agent read it and has not answered"],
    ["answered", {}, "Answered"],
    ["declined", {}, "Declined"],
    ["declined", { reason: "Not now" }, "Declined: Not now"],
    ["withdrawn", {}, "Withdrawn"],
    ["expired", {}, "Expired"],
    ["failed", {}, "Did not start"],
    ["failed", { reason: "No checkout" }, "Did not start: No checkout"],
  ])("says %s %j", (state, extra, said) => {
    expect(words(delivery(state, extra))).toBe(said);
  });

  it("covers every state", () => {
    for (const state of PEER_ROOM_DELIVERY_STATES)
      expect(words(delivery(state)), state).not.toBeNull();
  });

  it("says you to the owner", () => {
    expect(words(delivery("waiting"), ANA)).toBe("Waiting for you");
    expect(words(delivery("taken"), ANA)).toBe("Your agent may not have started");
  });

  it("falls back to a newer Hub's state, and says nothing of a person", () => {
    expect(words(delivery("snoozed"))).toBe("snoozed");
    expect(words({ kind: "person", email: ANA })).toBeNull();
  });
});

describe("availableActions", () => {
  const cases: ReadonlyArray<readonly [string, Partial<PeerRoomTarget>, string, string[]]> = [
    ["waiting", {}, ANA, ["pass", "decline"]],
    ["waiting", {}, BOB, ["withdraw"]],
    ["waiting", {}, EVA, []],
    ["passed", {}, ANA, []],
    ["passed", {}, BOB, []],
    ["taken", { run: "run_1" }, ANA, []],
    ["taken", {}, ANA, ["tryAgain"]],
    ["taken", {}, BOB, []],
    ["heard", { run: "run_1" }, ANA, []],
    ["answered", {}, ANA, []],
    ["declined", {}, ANA, []],
    ["withdrawn", {}, BOB, []],
    ["expired", {}, ANA, []],
    ["expired", {}, BOB, []],
    ["failed", {}, ANA, ["tryAgain"]],
    ["failed", {}, BOB, []],
    ["failed", {}, EVA, []],
    ["snoozed", {}, ANA, []],
  ];
  it.each(cases)("%s %j as %s", (state, extra, me, actions) => {
    const target = delivery(state, extra);
    expect(availableActions(message([target]), target, me)).toEqual(actions);
  });

  it("gives an owner who asked their own agent both sets", () => {
    const target = delivery("waiting");
    expect(availableActions(message([target], ANA), target, ANA)).toEqual([
      "pass",
      "decline",
      "withdraw",
    ]);
  });

  it("offers nothing on a person", () => {
    const target = { kind: "person", email: ANA };
    expect(availableActions(message([target]), target, ANA)).toEqual([]);
  });
});

describe("waitsOnMe", () => {
  it("is the owner's waiting delivery only", () => {
    const row = message([delivery("waiting"), { kind: "person", email: EVA }]);
    expect(waitsOnMe(row, ANA)).toBe(true);
    expect(waitsOnMe(row, "ANA@acme.test")).toBe(true);
    expect(waitsOnMe(row, BOB)).toBe(false);
    expect(waitsOnMe(row, EVA)).toBe(false);
    expect(waitsOnMe(message([delivery("passed")]), ANA)).toBe(false);
    expect(deliveryOf(row, EVA)).toBeUndefined();
  });
});

describe("targetsFor", () => {
  const project = {
    members: [
      { email: ANA, name: "Ana" },
      { email: BOB, name: "Bob" },
      { email: EVA, name: "Eva" },
    ],
  };
  const task = { id: "t-1", createdBy: EVA };
  const runs = [
    { id: "run_1", task: "t-1", email: ANA, state: "running" as const },
    { id: "run_2", task: "t-2", email: "other@acme.test", state: "running" as const },
  ];

  it("starts with Team and your agent, then each person on the task and their agent", () => {
    const row = targetsFor(project, task, runs, BOB);
    expect(row.map((choice) => choice.key)).toEqual([
      "team",
      "own-agent",
      `person:${ANA}`,
      `agent:${ANA}`,
      `person:${EVA}`,
      `agent:${EVA}`,
    ]);
    expect(row[0]?.to).toEqual([]);
    expect(row[1]?.to).toEqual([{ kind: "agent", email: BOB }]);
  });

  it("says who decides on personal capacity, and that team reach goes straight there", () => {
    expect(targetsFor(project, task, runs, BOB)[3]?.note).toBe(
      "Ana decides whether to pass this on.",
    );
    const reaches = [{ run: "run_1", reach: "team" }];
    expect(targetsFor(project, task, runs, BOB, { reaches })[3]?.note).toContain("shared capacity");
    const ended = [{ ...runs[0]!, state: "ended" as const }];
    expect(targetsFor(project, task, ended, BOB, { reaches })[3]?.note).toBe(
      "Ana decides whether to pass this on.",
    );
  });

  it("disables your agent without a checkout, unless you have a run on the task", () => {
    expect(targetsFor(project, task, runs, BOB, { hasCheckout: false })[1]?.disabled).toBe(
      "This computer has no checkout of the project.",
    );
    expect(
      targetsFor(project, task, runs, ANA, { hasCheckout: false })[1]?.disabled,
    ).toBeUndefined();
  });
});

describe("anchorState", () => {
  it("tells the current diff from an earlier version", () => {
    expect(anchorState({ commit: "abc" }, "abc")).toBe("current");
    expect(anchorState({ commit: "abc" }, "def")).toBe("earlier");
    expect(anchorState({}, "def")).toBe("unknown");
    expect(anchorState({ commit: "abc" }, undefined)).toBe("unknown");
  });

  it("writes an anchor as the phone shows it", () => {
    expect(anchorText({ path: "a.ts", line: 3 })).toBe("a.ts:3");
    expect(anchorText({ path: "a.ts", line: 3, endLine: 5 })).toBe("a.ts:3-5");
  });
});

describe("needs you", () => {
  const need = (task: string, seq: number, at: string) => ({
    workspace: "acme",
    project: "app",
    task,
    seq,
    author: BOB,
    text: "Why?",
    at,
  });
  const rooms: PeerRoomsStatus = {
    waiting: [need("t-1", 3, "2026-10-30T10:00:00Z"), need("t-1", 5, "2026-10-30T11:00:00Z")],
    mentions: [{ ...need("t-2", 1, "2026-10-30T12:00:00Z"), agent: true }],
    seqs: { acme: { app: { "t-1": 5 } } },
    revs: { acme: { app: { "t-1": 9 } } },
  };
  const place = { workspace: "acme", project: "app", task: "t-1" };

  it("lists each item newest first, with what it offers", () => {
    const items = roomNeedsYou(rooms, (row) => nameOf(row.author));
    expect(items.map((item) => [item.kind, item.seq])).toEqual([
      ["mention", 1],
      ["waiting", 5],
      ["waiting", 3],
    ]);
    expect(items[0]).toMatchObject({ title: "Bob's agent mentioned you", actions: ["open"] });
    expect(items[1]).toMatchObject({
      title: "Bob asks your agent",
      actions: ["pass", "decline", "open"],
    });
  });

  it("groups them per task, and counts them for the badge", () => {
    const groups = needsYouByTask(roomNeedsYou(rooms, (row) => row.author));
    expect(groups.map((group) => group.items.length)).toEqual([1, 2]);
    expect(roomBadgeCount(rooms, place)).toBe(2);
    expect(roomBadgeCount(undefined, place)).toBe(0);
  });

  it("reads a room's newest sequence", () => {
    expect(roomSeq(rooms, place)).toBe(5);
    expect(roomSeq(rooms, { ...place, task: "t-9" })).toBe(0);
  });

  it("reads a room's revision, 0 where it has none, by workspace first", () => {
    expect(roomRev(rooms, place)).toBe(9);
    expect(roomRev(rooms, { ...place, workspace: "other" })).toBe(0);
    expect(roomRev(rooms, { ...place, task: "t-9" })).toBe(0);
    expect(roomRev(undefined, place)).toBe(0);
  });
});
