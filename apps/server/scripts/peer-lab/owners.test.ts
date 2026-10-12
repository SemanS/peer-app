import { PeerOwnershipSetMapInput, type PeerOwnerCall } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { render } from "../../src/peerHub/core/broker/cliContract.ts";
import { ownerCallRefusal, stopText } from "../../src/peerHub/core/broker/landing.ts";
import type { Directory } from "../../src/peerHub/plugins/ownership/Ownership.ts";
import { matches, ownerToAsk } from "../../src/peerHub/plugins/ownership/client/rules.ts";
import {
  askedText,
  decisionText,
  editStop,
  factText,
  landingStop,
  startBlock,
} from "../../src/peerHub/plugins/ownership/text.ts";
import { ANA, BOARD_NOTE, BOB, DECISION_NOTES, expected, FILES, OWNER_MAP, WHY } from "./owners.ts";

const decodeMapInput = Schema.decodeUnknownSync(PeerOwnershipSetMapInput);

const people = new Map([
  [ANA, "Ana"],
  [BOB, "Bob"],
]);
const directory: Directory = {
  projectName: "Lab",
  people,
  task: () => undefined,
  label: (id) => (id === "ord-9" ? "ORD-9" : id),
  name: (email) => people.get(email) ?? email,
};
const project = {
  workspace: "acme",
  project: "lab",
  at: "2026-10-13T08:00:00.000Z",
  leads: [],
  map: { version: 1, ...OWNER_MAP, updatedAt: "2026-10-13T08:00:00.000Z", updatedBy: ANA },
  tasks: {},
  calls: [],
};
const call = (state: "accepted" | "declined", path: string, note: string): PeerOwnerCall => ({
  id: "oc-1",
  project: "lab",
  task: "ord-9",
  session: "claude:lab-bob-owner",
  email: BOB,
  environment: "bob-computer",
  owner: ANA,
  paths: [path],
  reason: WHY,
  state,
  decidedBy: ANA,
  onBehalf: false,
  note,
  createdAt: "2026-10-13T08:00:00.000Z",
  updatedAt: "2026-10-13T08:01:00.000Z",
  expiresAt: "2026-10-20T08:00:00.000Z",
});

describe("the texts the owners step checks", () => {
  it("are the ones the plugin says, for the same people and paths", () => {
    const start = (person: string) => startBlock({ project, person, environment: "e" }, directory);
    expect(start(BOB)).toBe(expected.start);
    expect(start(ANA)).toBe(expected.startOwner);
    for (const path of [FILES.fees, FILES.refunds]) {
      expect(editStop("Ana", [path])).toBe(expected.editStop(path));
      expect(landingStop("push", "Ana", [path])).toBe(expected.landingStop("push", [path]));
    }
    expect(landingStop("commit", "Ana", [FILES.fees, FILES.refunds])).toBe(
      expected.landingStop("commit", [FILES.fees, FILES.refunds]),
    );
    expect(decisionText(call("accepted", FILES.fees, DECISION_NOTES.accept), directory)).toBe(
      expected.accepted(FILES.fees, DECISION_NOTES.accept),
    );
    expect(decisionText(call("declined", FILES.refunds, DECISION_NOTES.decline), directory)).toBe(
      expected.declined(FILES.refunds, DECISION_NOTES.decline),
    );
    const asking = { ...call("accepted", FILES.fees, ""), state: "pending" };
    expect(askedText(asking, directory)).toBe(expected.heardCall(FILES.fees));
    expect(factText("Bob", "ORD-9", [FILES.ordersNotes])).toBe(
      expected.heardFact(FILES.ordersNotes),
    );
  });

  it("stop a landing step and refuse a review as the shared contract renders them", () => {
    const block = `[teammate text] ORD-11 · Ana’s agent, in your overlap on ${FILES.totals}:\n"${BOARD_NOTE}"`;
    expect(
      stopText({
        head: "Denied by Peer: a message from a teammate waits for you. Read it before this commit lands.",
        blocks: [block],
        tail: "Run the commit again once you have taken it into account.",
        cli: "peer",
      }),
    ).toBe(expected.commitStop(BOARD_NOTE));
    const broker = {
      nameOf: () => (email: string) => people.get(email) ?? email,
      taskNamer: () => () => "ORD-9 · Refund fee field",
    };
    const error = ownerCallRefusal.call(
      broker as never,
      { workspace: "acme", project: "lab", task: "ord-9" } as never,
      "review",
      { owner: ANA, paths: [FILES.refunds] },
      true,
    );
    expect(render(error)).toBe(expected.reviewRefused(FILES.refunds));
  });
});

describe("the owner map of the step", () => {
  it("is a map the Hub accepts, where Ana decides payments and not orders", () => {
    const sent = { workspace: "acme", project: "lab", version: 0, ...OWNER_MAP };
    expect(() => decodeMapInput(sent)).not.toThrow();
    expect(ownerToAsk(project.map, BOB, FILES.fees)).toBe(ANA);
    expect(ownerToAsk(project.map, ANA, FILES.fees)).toBeUndefined();
    expect(ownerToAsk(project.map, BOB, FILES.ordersNotes)).toBeUndefined();
    expect(ownerToAsk(project.map, BOB, FILES.totals)).toBeUndefined();
    for (const path of [FILES.fees, FILES.refunds, FILES.credits])
      expect(matches("src/payments/**", path)).toBe(true);
  });
});
