import { targetsFor } from "@t3tools/client-runtime/peer/rooms";
import type { EnvironmentId, PeerHubStatus, PeerRoomMessage } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_ROOM_DRAFT,
  afterSend,
  atEnd,
  beginSend,
  chosenTarget,
  composerChoices,
  composerState,
  declineInput,
  messageView,
  olderLeftOut,
  roomBadgeText,
  roomFailureWords,
  roomNeedGroups,
  roomNeedsAcross,
  seenToSend,
  withMessage,
  ROOM_READ_LIMIT,
  type RoomDraft,
} from "./rooms.logic";

const ME = "me@team.dev";
const ANA = "ana@team.dev";
const place = { workspace: "w", project: "p", task: "t" };
const project = { members: [{ email: ANA, name: "Ana" }] } as never;
const task = { id: "t", createdBy: ANA } as never;
const nameOf = (email: string) => (email === ANA ? "Ana" : email);

const message = (over: Partial<PeerRoomMessage>): PeerRoomMessage => ({
  seq: 1,
  task: "t",
  at: "2026-10-30T10:00:00Z",
  author: { email: ANA },
  text: "hello",
  to: [],
  ...over,
});

const choices = (hasCheckout: boolean, runs: Parameters<typeof targetsFor>[2] = []) =>
  composerChoices(targetsFor(project, task, runs, ME, { hasCheckout }));

describe("following the newest message", () => {
  const at = (y: number) => ({
    contentOffset: { y },
    contentSize: { height: 1000 },
    layoutMeasurement: { height: 400 },
  });

  it("follows a reader at the end, and leaves one reading further back", () => {
    expect(atEnd(at(600))).toBe(true);
    expect(atEnd(at(520))).toBe(true);
    expect(atEnd(at(100))).toBe(false);
  });
});

describe("the composer's targets", () => {
  it("offers Team, the default, and the person's own agent, no colleagues", () => {
    expect(choices(true).map((choice) => choice.key)).toEqual(["team", "own-agent"]);
    expect(chosenTarget(choices(true), EMPTY_ROOM_DRAFT.target)?.kind).toBe("team");
  });

  it("disables Your agent with the reason when this computer has no checkout", () => {
    const own = chosenTarget(choices(false), "own-agent");
    expect(own?.disabled).toBe("This computer has no checkout of the project.");
    expect(
      composerState({ text: "why?", sending: false, allowed: true, me: ME, target: own }),
    ).toEqual({ canSend: false, reason: "This computer has no checkout of the project." });
  });

  it("keeps Your agent for a person with an open run, checkout or not", () => {
    const runs = [{ id: "r", task: "t", email: ME, state: "running" as const }];
    expect(chosenTarget(choices(false, runs), "own-agent")?.disabled).toBeUndefined();
  });

  it("sends only with words, a confirmed sign-in and the right to post", () => {
    const target = chosenTarget(choices(true), "team");
    const base = { text: "hi", sending: false, allowed: true, me: ME, target };
    expect(composerState(base).canSend).toBe(true);
    expect(composerState({ ...base, text: "  " })).toEqual({ canSend: false, reason: null });
    expect(composerState({ ...base, sending: true }).canSend).toBe(false);
    expect(composerState({ ...base, allowed: false }).reason).not.toBeNull();
    expect(composerState({ ...base, me: null }).reason).not.toBeNull();
  });
});

describe("a draft", () => {
  const typed: RoomDraft = { ...EMPTY_ROOM_DRAFT, text: "  is this safe? " };
  const ops = () => {
    let next = 0;
    return () => `op${++next}`;
  };

  it("stays until the post is confirmed", () => {
    const sending = beginSend(typed, ops());
    expect(sending).toMatchObject({ sending: true, text: typed.text });
    expect(sending.pending).toEqual({ op: "op1", text: "is this safe?", target: "team" });
    expect(afterSend(sending, { kind: "done", value: {} })).toEqual(EMPTY_ROOM_DRAFT);
  });

  it("survives a refusal and an unknown result, with the words and a reason", () => {
    const sending = beginSend(typed, ops());
    expect(afterSend(sending, { kind: "failed", message: "Too many" })).toMatchObject({
      text: typed.text,
      sending: false,
      notice: "Too many",
    });
    expect(afterSend(sending, { kind: "unknown" }).text).toBe(typed.text);
    expect(afterSend(sending, { kind: "unknown" }).notice).toContain("still here");
  });

  it("repeats an unconfirmed send under the same op, so it posts once", () => {
    const newOp = ops();
    const lost = afterSend(beginSend(typed, newOp), { kind: "unknown" });
    expect(beginSend(lost, newOp).pending?.op).toBe("op1");
  });

  it("takes a new op once the words or the target change", () => {
    const newOp = ops();
    const lost = afterSend(beginSend(typed, newOp), { kind: "unknown" });
    expect(beginSend({ ...lost, text: "edited" }, newOp).pending?.op).toBe("op2");
    expect(beginSend({ ...lost, target: "own-agent" }, newOp).pending?.op).toBe("op3");
  });
});

describe("a message as a row", () => {
  it("names a person, an agent and the phone's plain anchor", () => {
    expect(
      messageView(
        message({
          author: { email: ANA, run: "r", agent: "claude" },
          replyTo: 3,
          anchor: { path: "src/a.ts", line: 4, endLine: 9, side: "new" },
        }),
        { me: ME, nameOf },
      ),
    ).toMatchObject({
      author: "Ana's agent · Claude",
      fromAgent: true,
      reply: "Reply to #3",
      anchor: "src/a.ts:4-9",
    });
    expect(messageView(message({ author: { email: ME } }), { me: ME, nameOf }).author).toBe("You");
  });

  it("gives the owner Pass on and Decline, and a bystander only the words", () => {
    const row = message({ to: [{ kind: "agent", email: ME, state: "waiting" }] });
    expect(messageView(row, { me: ME, nameOf }).deliveries[0]).toMatchObject({
      words: "Waiting for you",
      actions: ["pass", "decline"],
    });
    expect(messageView(row, { me: "bob@team.dev", nameOf }).deliveries[0]?.actions).toEqual([]);
  });

  it("offers Try again on a lost start, to its owner alone", () => {
    const row = message({ to: [{ kind: "agent", email: ME, state: "taken" }] });
    expect(messageView(row, { me: ME, nameOf }).deliveries[0]).toMatchObject({
      words: "Your agent may not have started",
      actions: ["tryAgain"],
      state: "taken",
    });
    expect(messageView(row, { me: ANA, nameOf }).deliveries[0]?.actions).toEqual([]);
  });

  it("offers Withdraw once, since it withdraws every waiting delivery of the message", () => {
    const row = message({
      author: { email: ME },
      to: [
        { kind: "agent", email: ANA, state: "waiting" },
        { kind: "agent", email: "bob@team.dev", state: "waiting" },
      ],
    });
    expect(messageView(row, { me: ME, nameOf }).deliveries.map((d) => d.actions)).toEqual([
      ["withdraw"],
      [],
    ]);
  });

  it("has no delivery line for a person it names", () => {
    const view = messageView(message({ to: [{ kind: "person", email: ME }] }), { me: ME, nameOf });
    expect(view.deliveries).toEqual([]);
    expect(view.names).toBe("For you");
  });
});

describe("reading a room", () => {
  const read = {
    seq: 2,
    seen: 1,
    reaches: [],
    messages: [message({ seq: 1 }), message({ seq: 2 })],
  };

  it("puts the Hub's answer in place and adds a new message in order", () => {
    const moved = message({ seq: 1, text: "moved" });
    expect(withMessage(read, moved).messages.map((row) => row.text)).toEqual(["moved", "hello"]);
    expect(withMessage(read, message({ seq: 3 }))).toMatchObject({ seq: 3 });
    expect(withMessage(read, message({ seq: 3 })).messages.map((row) => row.seq)).toEqual([
      1, 2, 3,
    ]);
  });

  it("marks seen once per new sequence and never backwards", () => {
    expect(seenToSend(null, 0)).toBeNull();
    expect(seenToSend(read, 0)).toBe(2);
    expect(seenToSend(read, 2)).toBeNull();
    expect(seenToSend({ seq: 2, seen: 2 }, 0)).toBeNull();
  });

  it("says older messages were left out only when the limit cut them", () => {
    const full = Array.from({ length: ROOM_READ_LIMIT }, (_, index) => ({ seq: index + 5 }));
    expect(olderLeftOut(full)).toBe(true);
    expect(olderLeftOut(full.map((_, index) => ({ seq: index + 1 })))).toBe(false);
    expect(olderLeftOut([{ seq: 5 }])).toBe(false);
  });

  it("turns a stale move into plain words and keeps other refusals' own", () => {
    expect(roomFailureWords({ code: "stale_delivery" })).toContain("moved on");
    expect(roomFailureWords(new Error("Too many waiting"))).toBe("Too many waiting");
    expect(roomFailureWords(undefined)).toBe("That did not go through.");
  });

  it("sends a decline's reason only when the person wrote one", () => {
    expect(declineInput(place, 4, "  ", "waiting")).toEqual({
      ...place,
      seq: 4,
      expect: "waiting",
    });
    expect(declineInput(place, 4, " not now ", "waiting").reason).toBe("not now");
  });
});

describe("rooms in Needs you", () => {
  const need = (seq: number, over = {}) => ({
    workspace: "w",
    project: "p",
    task: "t",
    seq,
    author: ANA,
    text: "may I?",
    at: `2026-10-30T10:00:0${seq}Z`,
    ...over,
  });
  const status = (over: Partial<PeerHubStatus> = {}) =>
    ({
      signedIn: true,
      email: ME,
      plugins: [{ id: "rooms", title: "Task rooms", enabled: true, active: true }],
      rooms: { waiting: [need(1)], mentions: [need(2)], seqs: {}, revs: {} },
      workspaces: [
        {
          slug: "w",
          projects: [
            {
              project: { id: "p", name: "Payments", members: [{ email: ANA, name: "Ana" }] },
              work: { tasks: [{ id: "t", key: "T-1", title: "Checkout" }] },
            },
          ],
        },
      ],
      ...over,
    }) as unknown as PeerHubStatus;
  const environment = (id: string, connected: boolean, value: PeerHubStatus | null) => ({
    environmentId: id as EnvironmentId,
    label: id,
    connected,
    status: value,
  });

  it("names the task and the author, with Pass on and Decline on what waits", () => {
    const needs = roomNeedsAcross([environment("mac", true, status())]);
    expect(needs.map((item) => [item.title, item.actions])).toEqual([
      ["Ana mentioned you", ["open"]],
      ["Ana asks your agent", ["pass", "decline", "open"]],
    ]);
    expect(needs[0]).toMatchObject({ taskTitle: "T-1 · Checkout", projectName: "Payments" });
  });

  it("counts a message two computers report once, on the connected one", () => {
    const needs = roomNeedsAcross([
      environment("away", false, status()),
      environment("mac", true, status()),
    ]);
    expect(needs).toHaveLength(2);
    expect(needs.every((item) => item.environmentId === "mac" && !item.offline)).toBe(true);
  });

  it("shows nothing while the plugin is off, the Hub does not serve it, or nobody signed in", () => {
    const off = status({
      plugins: [
        { id: "rooms", title: "Task rooms", enabled: true, active: false, reason: "hub" },
      ] as never,
    });
    expect(roomNeedsAcross([environment("mac", true, off)])).toEqual([]);
    expect(roomNeedsAcross([environment("mac", true, status({ signedIn: false }))])).toEqual([]);
    expect(roomNeedsAcross([environment("mac", true, null)])).toEqual([]);
  });

  it("groups per task, keeping each item's computer", () => {
    const needs = roomNeedsAcross([environment("mac", true, status())]);
    const groups = roomNeedGroups(needs);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.environmentLabel)).toEqual(["mac", "mac"]);
  });

  it("says the count on a task's row, and nothing with none", () => {
    expect(
      roomBadgeText({ waiting: [need(1) as never], mentions: [], seqs: {}, revs: {} }, place),
    ).toBe("Room · 1 needs you");
    expect(
      roomBadgeText(
        { waiting: [need(1) as never], mentions: [need(2) as never], seqs: {}, revs: {} },
        place,
      ),
    ).toBe("Room · 2 need you");
    expect(roomBadgeText(undefined, place)).toBeNull();
  });
});
