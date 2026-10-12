import {
  AuthOrchestrationOperateScope,
  AuthOrchestrationReadScope,
  OwnershipRpcScopes,
  PEER_OWNERSHIP_LIMITS,
  PeerOwnershipDecideInput,
} from "@t3tools/contracts";
import type { NeedsYouEnvironment } from "@t3tools/client-runtime/peer/needs-you";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  DECIDE_ON_YOUR_COMPUTER,
  canDecide,
  clampNote,
  noteCounter,
  ownerCallCardText,
  ownerCallContext,
  ownerCallControls,
  ownerCallDecision,
  ownerCallLabels,
  ownerCallSheetText,
  type OwnerCallItem,
} from "./ownerCall.logic";
import { ANA, MEMBERS, NOW, SLAVO, call, computer, needsOf } from "./ownership.testkit";

const decodeDecision = Schema.decodeUnknownSync(PeerOwnershipDecideInput);

/** The owner's call that Needs you holds for these computers. */
function ownerCallIn(environments: ReadonlyArray<NeedsYouEnvironment>): OwnerCallItem {
  const item = needsOf(environments).find((candidate) => candidate.kind === "owner-call");
  if (item?.kind !== "owner-call") throw new Error("Needs you holds no owner's call");
  return item;
}

/** Ana's phone: Bob's agent asked her 40 minutes ago to change one of her paths. */
const owners = [computer({ viewer: ANA })];
/** Slavo, a lead, with Ana gone from the project: the call to her waits on him. */
const leads = [computer({ viewer: SLAVO, members: MEMBERS.filter(({ email }) => email !== ANA) })];

describe("the card in Needs you", () => {
  it("says who asks, where, for which paths, and in whose words, as the design has it", () => {
    const item = ownerCallIn(owners);
    expect(ownerCallCardText(item, ownerCallContext(item, owners), NOW)).toEqual({
      title: "Bob's agent asks to change your path",
      context: "Ordering demo · ORD-9 Refund fee field",
      paths: ["src/payments/fees.ts"],
      morePaths: 0,
      quote: "“add a refund fee field” · 40 min ago",
      guidance: undefined,
    });
    expect(ownerCallLabels(item)).toEqual({
      entry: "Decide…",
      accept: "Accept",
      decline: "Decline",
    });
  });

  it("lists three paths and counts the rest, leaving the sheet to list them all", () => {
    const paths = ["a/1.ts", "a/2.ts", "a/3.ts", "a/4.ts", "a/5.ts"];
    const many = [computer({ viewer: ANA, ownership: { calls: [call({ paths })] } })];
    const item = ownerCallIn(many);
    const context = ownerCallContext(item, many);
    expect(ownerCallCardText(item, context, NOW)).toMatchObject({
      paths: ["a/1.ts", "a/2.ts", "a/3.ts"],
      morePaths: 2,
    });
    expect(ownerCallSheetText(item, context, NOW).paths).toEqual(paths);
  });

  it("names the project alone for a call that is about no task, and the age alone for no reason", () => {
    const loose = [
      computer({ viewer: ANA, ownership: { calls: [call({ task: undefined, reason: "  " })] } }),
    ];
    const item = ownerCallIn(loose);
    const context = ownerCallContext(item, loose);
    expect(context.task).toBeUndefined();
    expect(ownerCallCardText(item, context, NOW)).toMatchObject({
      context: "Ordering demo",
      quote: "40 min ago",
    });
    expect(ownerCallSheetText(item, context, NOW).subtitle).toBe(
      "asked 40 min ago · expires in 6 days",
    );
  });

  it("holds nothing for a person who is neither the owner nor a lead", () => {
    const cyril = computer({ viewer: "cyril@acme.test" });
    expect(needsOf([cyril]).filter((item) => item.kind === "owner-call")).toEqual([]);
  });
});

describe("the sheet", () => {
  it("shows the call in full, in the design's words", () => {
    const item = ownerCallIn(owners);
    expect(ownerCallSheetText(item, ownerCallContext(item, owners), NOW)).toEqual({
      title: "Bob's agent asks to change your path",
      subtitle: "ORD-9 Refund fee field · asked 40 min ago · expires in 6 days",
      paths: ["src/payments/fees.ts"],
      reason: "add a refund fee field",
      footnote: "Bob's agent's words. You decide changes by others in src/payments/**.",
      noteLabel: "Note for Bob's agent (optional)",
      hears: "Bob's agent hears your answer and note once and is woken if it is idle.",
    });
  });

  it("names only the patterns that cover the call's paths, and none where the map says nothing", () => {
    const wide = [
      computer({
        viewer: ANA,
        ownership: {
          map: {
            version: 8,
            areas: {},
            paths: { "src/payments/**": ANA, "src/orders/**": ANA },
            decide: ["src/payments/**", "src/orders/**", "docs/**"],
          },
        },
      }),
    ];
    const item = ownerCallIn(wide);
    expect(ownerCallContext(item, wide).patterns).toEqual(["src/payments/**"]);
    const none = [
      computer({
        viewer: ANA,
        ownership: {
          map: { version: 9, areas: {}, paths: { "src/payments/**": ANA }, decide: [] },
        },
      }),
    ];
    const bare = ownerCallIn(none);
    expect(ownerCallSheetText(bare, ownerCallContext(bare, none), NOW).footnote).toBe(
      "Bob's agent's words.",
    );
  });

  it("says, for a lead deciding for an owner who left, that it is the owner's call and that the record says so", () => {
    const item = ownerCallIn(leads);
    const context = ownerCallContext(item, leads);
    expect(item).toMatchObject({
      onBehalf: true,
      owner: "Ana",
      title: "Bob's agent asks Ana to change their path",
    });
    expect(ownerCallLabels(item)).toEqual({
      entry: "Decide for Ana",
      accept: "Accept for Ana",
      decline: "Decline for Ana",
    });
    expect(ownerCallCardText(item, context, NOW).guidance).toBe(
      "As a lead you can decide for the owner. The record says you did.",
    );
    expect(ownerCallSheetText(item, context, NOW)).toMatchObject({
      footnote: "Bob's agent's words. Ana decides changes by others in src/payments/**.",
      hears:
        "Bob's agent hears the answer and your note once and is woken if it is idle. The record says you decided for Ana.",
    });
  });
});

describe("what a decision sends", () => {
  const item = ownerCallIn(owners);

  it("sends the call, the decision and the note as written", () => {
    expect(ownerCallDecision(item, "accept", "keep fees in integer cents")).toEqual({
      workspace: "acme",
      project: "ordering",
      id: "oc-1",
      decision: "accept",
      note: "keep fees in integer cents",
    });
    expect(ownerCallDecision(item, "decline", "use the existing fee table")).toMatchObject({
      decision: "decline",
      note: "use the existing fee table",
    });
  });

  it("sends no note, rather than a blank one, when there is nothing to say", () => {
    for (const note of ["", "   ", "\n \n"]) {
      const sent = ownerCallDecision(item, "accept", note);
      expect(sent).toEqual({
        workspace: "acme",
        project: "ordering",
        id: "oc-1",
        decision: "accept",
      });
      expect("note" in sent).toBe(false);
    }
  });

  it("trims the note's edges and keeps what is inside", () => {
    expect(ownerCallDecision(item, "accept", "  one\n\ntwo \n").note).toBe("one\n\ntwo");
  });

  it("never sends more than the Hub accepts, counting characters as it does", () => {
    const limit = PEER_OWNERSHIP_LIMITS.textChars;
    expect(limit).toBe(300);
    // An emoji is two UTF-16 units and one character: the Hub counts one.
    for (const unit of ["é", "😀"]) {
      const sent = ownerCallDecision(item, "accept", unit.repeat(400));
      expect(Array.from(sent.note ?? "")).toHaveLength(limit);
      expect(decodeDecision(sent)).toEqual(sent);
    }
    expect(clampNote("short")).toBe("short");
    expect(Array.from(clampNote("😀".repeat(301)))).toHaveLength(limit);
  });

  it("counts the note as the design does", () => {
    expect(noteCounter("keep fees in integer cents")).toBe("26 / 300");
    expect(noteCounter("")).toBe("0 / 300");
    expect(noteCounter("😀😀")).toBe("2 / 300");
  });
});

describe("when the buttons wait", () => {
  const item = ownerCallIn(owners);
  const ready = { connected: true, hubError: false, canOperate: true };

  it("lets the owner accept or decline once the computer answers and the pairing may operate", () => {
    expect(ownerCallControls(item, ready)).toEqual({
      entry: "Decide…",
      accept: "Accept",
      decline: "Decline",
      reason: null,
      onYourComputer: false,
    });
  });

  it("sends a pairing without operate access to its computer, with the reason", () => {
    expect(DECIDE_ON_YOUR_COMPUTER).toBe("Decide on your computer");
    expect(ownerCallControls(item, { ...ready, canOperate: false })).toMatchObject({
      reason: "This pairing cannot operate on this computer.",
      onYourComputer: true,
    });
  });

  it("holds both buttons back, without sending anyone elsewhere, while the computer is away or its Hub is not answering", () => {
    expect(ownerCallControls(item, { ...ready, connected: false })).toMatchObject({
      reason: "Connect this computer first.",
      onYourComputer: false,
    });
    expect(ownerCallControls(item, { ...ready, hubError: true })).toMatchObject({
      reason: "The Peer Hub is unreachable.",
      onYourComputer: false,
    });
    // An away computer comes first: no pairing can be judged on a computer that does not answer.
    expect(
      ownerCallControls(item, { connected: false, hubError: true, canOperate: false }),
    ).toMatchObject({ reason: "Connect this computer first.", onYourComputer: false });
  });

  it("keeps the lead's wording while it waits", () => {
    const lead = ownerCallIn(leads);
    expect(ownerCallControls(lead, { ...ready, canOperate: false })).toMatchObject({
      entry: "Decide for Ana",
      accept: "Accept for Ana",
      onYourComputer: true,
    });
  });

  it("asks of a pairing the scope the Hub's method asks for: operate, not read", () => {
    expect(OwnershipRpcScopes["peer.ownership.decide"]).toBe(AuthOrchestrationOperateScope);
    expect(canDecide([AuthOrchestrationReadScope])).toBe(false);
    expect(canDecide([AuthOrchestrationReadScope, AuthOrchestrationOperateScope])).toBe(true);
    expect(canDecide(undefined)).toBe(false);
    expect(canDecide(null)).toBe(false);
  });
});

describe("where it is decided", () => {
  it("goes to a connected computer that reports the call when the one the item came from is away", () => {
    const laptop = computer({ viewer: ANA }, { label: "Laptop", connected: false });
    const desktop = computer({ viewer: ANA, environmentId: "env-desktop" }, { label: "Desktop" });
    const environments = [laptop, desktop];
    const items = needsOf(environments).filter((item) => item.kind === "owner-call");
    // Two computers of one person read the same call: one item.
    expect(items).toHaveLength(1);
    const item = ownerCallIn(environments);
    expect(item.environmentId).toBe(laptop.environmentId);
    expect(item.offline).toBe(false);
    expect(ownerCallContext(item, environments).host?.label).toBe("Desktop");
    // Back on the computer it came from, that one is used.
    expect(ownerCallContext(item, [{ ...laptop, connected: true }, desktop]).host?.label).toBe(
      "Laptop",
    );
  });

  it("has no computer to decide on while none that reports the call is connected", () => {
    const away = [computer({ viewer: ANA }, { connected: false })];
    const item = ownerCallIn(away);
    const context = ownerCallContext(item, away);
    expect(context.host).toBeUndefined();
    // The names still come from the computer's last word.
    expect(context.projectName).toBe("Ordering demo");
    expect(context.task).toBe("ORD-9 Refund fee field");
  });

  it("does not decide on a computer that does not know the call", () => {
    const other = computer({ viewer: ANA, ownership: { calls: [] } }, { label: "Other" });
    const home = computer({ viewer: ANA }, { label: "Home" });
    const item = ownerCallIn([home]);
    expect(ownerCallContext(item, [other, home]).host?.label).toBe("Home");
    expect(ownerCallContext(item, [other]).host).toBeUndefined();
  });
});

describe("what the phone shows of a call stays within what Bob's agent said", () => {
  it("carries no chat title, session label or request of anyone", () => {
    for (const environments of [owners, leads]) {
      const item = ownerCallIn(environments);
      const context = ownerCallContext(item, environments);
      const shown = JSON.stringify([
        ownerCallCardText(item, context, NOW),
        ownerCallSheetText(item, context, NOW),
        ownerCallLabels(item),
      ]);
      expect(shown).not.toContain("SECRET");
      // Names, never addresses.
      expect(shown).not.toContain("@");
    }
  });
});
