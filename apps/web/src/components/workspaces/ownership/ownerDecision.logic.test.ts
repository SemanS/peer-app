import { projectOwnership } from "@t3tools/client-runtime/peer/ownership";
import { describe, expect, it } from "vite-plus/test";

import {
  NOTE_MAX,
  clampNote,
  decideInput,
  decisionCopy,
  noteLength,
  ownerCallCard,
} from "./ownerDecision.logic";
import {
  ANA,
  BOB,
  CYRIL,
  EVA,
  NOW,
  minutesAgo,
  ownerCall,
  ownerCallItem,
  statusFor,
  type Looking,
} from "./ownership.testkit";

describe("what a decision sends", () => {
  const send = (note: string, decision: "accept" | "decline" = "accept") =>
    decideInput({
      workspace: "acme",
      project: "ordering",
      call: ownerCall(),
      decision,
      note,
    });

  it("names the call and the decision, with the note the person wrote", () => {
    expect(send("keep fees in integer cents")).toEqual({
      workspace: "acme",
      project: "ordering",
      id: "call-1",
      decision: "accept",
      note: "keep fees in integer cents",
    });
    expect(send("use the existing fee table", "decline")).toMatchObject({ decision: "decline" });
  });

  it("leaves out a note that is empty or only spaces, and trims the rest", () => {
    expect(send("")).not.toHaveProperty("note");
    expect(send("  \n ")).not.toHaveProperty("note");
    expect(send("  yes, go ahead \n")).toMatchObject({ note: "yes, go ahead" });
  });

  it("counts a note as the Hub does, in Unicode characters, and never sends more than it takes", () => {
    const emoji = "👍".repeat(NOTE_MAX + 5);
    expect(emoji.length).toBeGreaterThan(NOTE_MAX);
    expect(noteLength(emoji)).toBe(NOTE_MAX + 5);
    expect(noteLength(clampNote(emoji))).toBe(NOTE_MAX);
    expect(clampNote("short")).toBe("short");
    expect(noteLength(send("x".repeat(400)).note ?? "")).toBe(NOTE_MAX);
  });
});

describe("the owner's call card", () => {
  const card = (email: string, overrides = {}, item = {}, looking: Looking = {}) => {
    const status = statusFor(email, looking);
    const workspace = status.workspaces[0]!;
    return ownerCallCard({
      ownership: projectOwnership(status, workspace, workspace.projects[0]!.project),
      item: ownerCallItem(ownerCall(overrides), item),
      now: NOW,
    });
  };

  it("offers the owner Accept… and Decline…, with what the agent asked for and when it ends", () => {
    expect(card(ANA)).toEqual({
      stand: "decide",
      title: "Bob's agent asks to change your path",
      paths: ["src/payments/fees.ts"],
      morePaths: 0,
      reason: "add a refund fee field",
      meta: "Bob's agent's words · 40 min ago · expires in 6 days",
      explanation: undefined,
      accept: { label: "Accept…", disabled: false },
      decline: { label: "Decline…" },
      withdraw: false,
    });
  });

  it("offers a lead the same for an owner who left, and says the record says so", () => {
    // Ana left the project: her call waits on the leads, who decide for her.
    const left = {
      members: [
        { email: BOB, name: "Bob" },
        { email: CYRIL, name: "Cyril" },
        { email: EVA, name: "Eva" },
      ],
    };
    const lead = card(
      EVA,
      {},
      { title: "Bob's agent asks Ana to change their path", onBehalf: true },
      left,
    );
    expect(lead).toMatchObject({
      stand: "on-behalf",
      title: "Bob's agent asks Ana to change their path",
      explanation: "As a lead you can decide on Ana's behalf. The record says you decided for Ana.",
      accept: { label: "Accept for Ana…", disabled: false },
      decline: { label: "Decline for Ana…" },
      withdraw: false,
    });
  });

  it("does not let a person decide the call their own agent opened: Accept is disabled, and why", () => {
    const own = card(BOB);
    expect(own).toMatchObject({
      stand: "own",
      title: "Your agent asked Ana to change their path",
      explanation:
        "You can't decide a call your own agent opened. Ana decides it, or another lead or an admin.",
      accept: { label: "Accept", disabled: true },
      decline: undefined,
      withdraw: true,
    });
    expect(own.meta).toMatch(/^Your agent's words · 40 min ago/);
    // A lead who opened it is no exception.
    const lead = card(EVA, { email: EVA });
    expect(lead).toMatchObject({ stand: "own", accept: { disabled: true }, withdraw: true });
  });

  it("offers nothing for a call that was decided, withdrawn or has expired", () => {
    for (const closed of [
      { state: "accepted" },
      { state: "declined" },
      { state: "withdrawn" },
      { expiresAt: minutesAgo(1) },
    ]) {
      expect(card(ANA, closed), JSON.stringify(closed)).toMatchObject({
        stand: "closed",
        explanation: "This call is no longer pending.",
        accept: undefined,
        decline: undefined,
        withdraw: false,
      });
    }
  });

  it("names the paths of the call, a few at a time, and counts the rest", () => {
    expect(card(ANA, { paths: ["src/payments/fees.ts", "src/payments/tax.ts"] })).toMatchObject({
      paths: ["src/payments/fees.ts", "src/payments/tax.ts"],
      morePaths: 0,
    });
    const many = Array.from({ length: 20 }, (_, index) => `src/payments/file${index}.ts`);
    expect(card(ANA, { paths: many })).toMatchObject({
      paths: many.slice(0, 4),
      morePaths: 16,
    });
  });
});

describe("what the decision dialog says", () => {
  const copy = (input: Partial<Parameters<typeof decisionCopy>[0]> = {}) =>
    decisionCopy({
      decision: "accept",
      asker: "Bob",
      owner: "Ana",
      onBehalf: false,
      paths: ["src/payments/fees.ts"],
      task: "ORD-9",
      ...input,
    });

  it("says accepting lets the edits go ahead, and that the agent is woken and reads the note", () => {
    expect(copy()).toEqual({
      title: "Accept Bob's agent's call?",
      body: "Its edits of src/payments/fees.ts for ORD-9 will go ahead. It is woken and reads your note.",
      onBehalf: undefined,
      noteLabel: "Note for Bob's agent (optional)",
      confirm: "Accept",
      busy: "Accepting…",
    });
  });

  it("says declining keeps the edits stopped, and that the agent can ask again", () => {
    expect(copy({ decision: "decline" })).toMatchObject({
      title: "Decline Bob's agent's call?",
      body: "Its edits of src/payments/fees.ts stay stopped. It reads your note and can ask again.",
      confirm: "Decline",
      busy: "Declining…",
    });
  });

  it("names the owner a lead decides for, and what the record will say", () => {
    expect(copy({ onBehalf: true })).toMatchObject({
      title: "Accept Bob's agent's call for Ana?",
      onBehalf: "The record says you decided for Ana.",
      confirm: "Accept for Ana",
    });
    expect(copy({ onBehalf: true, decision: "decline" }).confirm).toBe("Decline for Ana");
  });

  it("names a few paths, counts the rest, and leaves out a task it has none of", () => {
    expect(copy({ paths: ["a.ts", "b.ts", "c.ts", "d.ts"], task: undefined }).body).toBe(
      "Its edits of a.ts, b.ts and 2 more will go ahead. It is woken and reads your note.",
    );
  });
});
