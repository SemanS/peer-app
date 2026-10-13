import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "../auth.ts";
import {
  AgreementsRpcGroup,
  AgreementsRpcScopes,
  PEER_AGREEMENTS_METHODS,
} from "./agreements.rpc.ts";
import {
  PEER_AGREEMENT_CLOSE_REASONS,
  PEER_AGREEMENT_PERSON_REASONS,
  PEER_AGREEMENT_STATES,
  PeerAgreementCloseInput,
  PeerAgreementReopenInput,
  PeerAgreementResult,
  PeerAgreementsPlace,
  PeerAgreementsStatus,
  PeerAgreementsView,
  isPeerAgreementCloseReason,
  isPeerAgreementPersonReason,
  isPeerAgreementState,
} from "./agreements.ts";
import { PEER_PLUGIN_IDS } from "./plugin.ts";
import { peerPluginStatusFields } from "./registry.ts";
import { PEER_RPC_SCOPES, PEER_WS_METHODS, PeerRpcGroup } from "./rpcRegistry.ts";

const decodeView = Schema.decodeUnknownSync(PeerAgreementsView);
const decodeViewExit = Schema.decodeUnknownExit(PeerAgreementsView);
const decodeResult = Schema.decodeUnknownSync(PeerAgreementResult);
const decodePlace = Schema.decodeUnknownExit(PeerAgreementsPlace);
const decodeClose = Schema.decodeUnknownExit(PeerAgreementCloseInput);
const decodeReopen = Schema.decodeUnknownExit(PeerAgreementReopenInput);
const decodeStatus = Schema.decodeUnknownSync(PeerAgreementsStatus);
const isStatusFields = Schema.is(Schema.Struct(peerPluginStatusFields));

/** What the Hub serves for one agreement before its state: the settle, and the sessions that took part. */
const settled = {
  id: "3f9a0c1b2d4e5f60",
  project: "lab",
  tasks: ["krk-1", "krk-2"],
  words: "Loyalty keeps euros; src/loyalty.js divides by 100 once KRK-1 lands",
  by: { email: "bob@acme.test", task: "krk-2" },
  settledAt: "2026-10-13T11:18:22Z",
  sides: [
    { session: "claude:abc", environment: "env-a", email: "ana@acme.test", task: "krk-1" },
    { session: "codex:def", environment: "env-b", email: "bob@acme.test", task: "krk-2" },
  ],
};
const open = { ...settled, state: "open", landed: [] };
const due = { ...settled, state: "due", dueFor: "krk-2", landed: ["krk-1"] };
const handled = {
  ...settled,
  state: "closed",
  landed: ["krk-1"],
  closed: { at: "2026-10-13T12:30:00Z", by: "ana@acme.test", why: "handled" },
};
const replacedByHub = {
  ...settled,
  id: "0a1b2c3d4e5f6071",
  state: "closed",
  landed: [],
  closed: { at: "2026-10-13T11:40:00Z", why: "replaced" },
};
const at = "2026-10-13T12:00:00Z";

describe("the Hub's view of agreements", () => {
  it("reads what the Hub serves, field for field, in every state", () => {
    const wire = { agreements: [open, due, handled, replacedByHub], at };
    const read = decodeView(wire);
    expect(read).toEqual(wire);
    expect(read.agreements.map((agreement) => agreement.state)).toEqual([
      "open",
      "due",
      "closed",
      "closed",
    ]);
    expect(read.agreements[1]?.dueFor).toBe("krk-2");
    expect(read.agreements[1]?.landed).toEqual(["krk-1"]);
    expect(read.agreements[2]?.closed).toEqual({
      at: "2026-10-13T12:30:00Z",
      by: "ana@acme.test",
      why: "handled",
    });
    expect(read.agreements[0]?.sides.map((side) => [side.session, side.task])).toEqual([
      ["claude:abc", "krk-1"],
      ["codex:def", "krk-2"],
    ]);
  });

  it("reads an agreement without dueFor and closed, and a closing the Hub made without a person", () => {
    const [first, , , byHub] = decodeView({
      agreements: [open, due, handled, replacedByHub],
      at,
    }).agreements;
    expect(first).not.toHaveProperty("dueFor");
    expect(first).not.toHaveProperty("closed");
    expect(byHub?.closed?.why).toBe("replaced");
    expect(byHub?.closed).not.toHaveProperty("by");
    expect(decodeView({ agreements: [], at }).agreements).toEqual([]);
  });

  it("reads a Hub of another age: a state or a reason it does not know is no failure", () => {
    const newer = {
      agreements: [
        {
          ...handled,
          state: "snoozed",
          priority: "high",
          closed: { ...handled.closed, why: "superseded", ticket: 7 },
        },
        { ...open, state: "paused" },
      ],
      at,
      cursor: "x",
    };
    const read = decodeView(newer);
    expect(read.agreements.map((agreement) => agreement.state)).toEqual(["snoozed", "paused"]);
    expect(read.agreements[0]?.closed?.why).toBe("superseded");
    expect(read).not.toHaveProperty("cursor");
    expect(read.agreements[0]).not.toHaveProperty("priority");
    expect(read.agreements[0]?.closed).not.toHaveProperty("ticket");
    // A client tells a value it knows from one it does not by the guards.
    expect(isPeerAgreementState("snoozed")).toBe(false);
    expect(isPeerAgreementCloseReason("superseded")).toBe(false);
  });

  it("refuses a row without what a reader needs to place it", () => {
    const failing = (agreement: unknown) =>
      Exit.isFailure(decodeViewExit({ agreements: [agreement], at }));
    expect(failing(open)).toBe(false);
    for (const missing of [
      "id",
      "project",
      "tasks",
      "words",
      "by",
      "settledAt",
      "sides",
      "state",
    ]) {
      expect(failing({ ...open, [missing]: undefined })).toBe(true);
    }
    expect(failing({ ...open, landed: undefined })).toBe(true);
    expect(failing({ ...open, by: { email: "bob@acme.test" } })).toBe(true);
    expect(
      failing({ ...open, sides: [{ session: "claude:abc", environment: "env-a", task: "krk-1" }] }),
    ).toBe(true);
    expect(failing({ ...handled, closed: { at: "2026-10-13T12:30:00Z" } })).toBe(true);
    expect(Exit.isFailure(decodeViewExit({ agreements: [open] }))).toBe(true);
  });

  it("reads the answer to a close or a reopen: the agreement as it stands", () => {
    expect(decodeResult({ agreement: handled })).toEqual({ agreement: handled });
    expect(decodeResult({ agreement: { ...open, extra: true } })).toEqual({ agreement: open });
    expect(() => decodeResult({ agreement: { ...open, landed: undefined } })).toThrow();
    expect(() => decodeResult(open)).toThrow();
  });
});

describe("the vocabularies", () => {
  it("lists the states and the reasons the Hub writes today", () => {
    expect(PEER_AGREEMENT_STATES).toEqual(["open", "due", "closed"]);
    expect(PEER_AGREEMENT_CLOSE_REASONS).toEqual([
      "handled",
      "not-needed",
      "replaced",
      "removed",
      "expired",
      "landed",
    ]);
    expect(PEER_AGREEMENT_PERSON_REASONS).toEqual(["handled", "not-needed"]);
  });

  it("tells a known value from one a newer Hub names", () => {
    for (const state of PEER_AGREEMENT_STATES) expect(isPeerAgreementState(state)).toBe(true);
    for (const why of PEER_AGREEMENT_CLOSE_REASONS)
      expect(isPeerAgreementCloseReason(why)).toBe(true);
    for (const why of PEER_AGREEMENT_PERSON_REASONS)
      expect(isPeerAgreementPersonReason(why)).toBe(true);
    for (const unknown of ["", "Open", "paused", "closed "]) {
      expect(isPeerAgreementState(unknown)).toBe(false);
    }
    for (const unknown of ["", "Handled", "superseded", "not_needed"]) {
      expect(isPeerAgreementCloseReason(unknown)).toBe(false);
    }
    // The Hub closes as replaced, removed, expired and landed; a person only ever sends two.
    for (const hub of ["replaced", "removed", "expired", "landed"]) {
      expect(isPeerAgreementCloseReason(hub)).toBe(true);
      expect(isPeerAgreementPersonReason(hub)).toBe(false);
    }
  });
});

describe("what a client sends", () => {
  const base = { workspace: "acme", project: "lab", id: "3f9a0c1b2d4e5f60" };

  it("names a workspace, and narrows it to a project", () => {
    expect(Exit.isSuccess(decodePlace({ workspace: "acme" }))).toBe(true);
    expect(Exit.isSuccess(decodePlace({ workspace: "acme", project: "lab" }))).toBe(true);
    expect(Exit.isFailure(decodePlace({}))).toBe(true);
    expect(Exit.isFailure(decodePlace({ workspace: " " }))).toBe(true);
    expect(Exit.isFailure(decodePlace({ workspace: "acme", project: "" }))).toBe(true);
  });

  it("closes as handled or as not needed, and as nothing the Hub does not accept", () => {
    for (const why of ["handled", "not-needed"]) {
      expect(Exit.isSuccess(decodeClose({ ...base, why }))).toBe(true);
    }
    expect(Exit.isFailure(decodeClose({ ...base, why: "whatever" }))).toBe(true);
    expect(Exit.isFailure(decodeClose({ ...base, why: "Handled" }))).toBe(true);
    expect(Exit.isFailure(decodeClose({ ...base }))).toBe(true);
    // The reasons the Hub gives itself are not a person's to send.
    for (const why of ["replaced", "removed", "expired", "landed"]) {
      expect(Exit.isFailure(decodeClose({ ...base, why }))).toBe(true);
    }
  });

  it("closes and reopens one agreement of one project of one workspace", () => {
    for (const blank of ["workspace", "project", "id"] as const) {
      expect(Exit.isFailure(decodeClose({ ...base, why: "handled", [blank]: "" }))).toBe(true);
      expect(Exit.isFailure(decodeReopen({ ...base, [blank]: "" }))).toBe(true);
      expect(Exit.isFailure(decodeReopen({ ...base, [blank]: undefined }))).toBe(true);
    }
    expect(Exit.isSuccess(decodeReopen(base))).toBe(true);
  });
});

describe("the status field", () => {
  const status = {
    enabled: true,
    forcedOff: false,
    hubSupport: "supported",
    lastContact: "2026-10-13T12:00:00Z",
    workspaces: [
      { workspace: "acme", open: 3, dueForMe: [{ project: "lab", id: "3f9a0c1b2d4e5f60" }] },
      { workspace: "beta", open: 0, dueForMe: [] },
    ],
  } as const;

  it("holds counts and ids only, and is optional so a status without it stays valid", () => {
    expect(decodeStatus(status)).toEqual(status);
    expect(isStatusFields({})).toBe(true);
    expect(isStatusFields({ agreements: status })).toBe(true);
    expect(isStatusFields({ agreements: { ...status, workspaces: [] } })).toBe(true);
    expect(isStatusFields({ agreements: {} })).toBe(false);
    expect(isStatusFields({ agreements: { ...status, hubSupport: "maybe" } })).toBe(false);
    expect(isStatusFields({ agreements: { ...status, workspaces: [{ workspace: "acme" }] } })).toBe(
      false,
    );
  });

  it("carries per-task counts and the due agreements by id, and stays valid without them", () => {
    const withTasks = {
      ...status,
      workspaces: [
        {
          workspace: "acme",
          open: 1,
          dueForMe: [],
          tasks: [
            { project: "lab", task: "krk-1", open: 1, due: 0 },
            { project: "lab", task: "krk-2", open: 1, due: 1 },
          ],
          due: [{ project: "lab", id: "3f9a0c1b2d4e5f60", dueFor: "krk-2", landed: "krk-1" }],
        },
      ],
    };
    expect(decodeStatus(withTasks)).toEqual(withTasks);
    expect(decodeStatus(status).workspaces[0]).not.toHaveProperty("tasks");
    expect(
      isStatusFields({
        agreements: {
          ...status,
          workspaces: [
            {
              workspace: "acme",
              open: 1,
              dueForMe: [],
              tasks: [{ project: "lab", task: "x", open: -1, due: 0 }],
            },
          ],
        },
      }),
    ).toBe(false);
  });

  it("reads a status that has not met a Hub yet: unknown support, no last contact", () => {
    const fresh = { enabled: true, forcedOff: false, hubSupport: "unknown", workspaces: [] };
    expect(decodeStatus(fresh)).toEqual(fresh);
    expect(decodeStatus(fresh)).not.toHaveProperty("lastContact");
  });

  it("refuses a count that is not a whole number of agreements", () => {
    const one = (open: number) =>
      isStatusFields({
        agreements: { ...status, workspaces: [{ workspace: "acme", open, dueForMe: [] }] },
      });
    expect(one(0)).toBe(true);
    expect(one(-1)).toBe(false);
    expect(one(1.5)).toBe(false);
  });
});

describe("the agreements plugin in Peer's registries", () => {
  it("is listed right after plans and before settings, which stays last", () => {
    const listed = PEER_PLUGIN_IDS.indexOf("agreements");
    expect(listed).toBeGreaterThan(0);
    expect(listed).toBe(PEER_PLUGIN_IDS.indexOf("plans") + 1);
    expect(PEER_PLUGIN_IDS[listed + 1]).toBe("settings");
    expect(PEER_PLUGIN_IDS.at(-1)).toBe("settings");
  });

  it("names its methods peer.agreements.<name>, merged into the Peer group and its scopes", () => {
    expect(Object.values(PEER_AGREEMENTS_METHODS)).toEqual([
      "peer.agreements.view",
      "peer.agreements.close",
      "peer.agreements.reopen",
    ]);
    expect(new Set(AgreementsRpcGroup.requests.keys())).toEqual(
      new Set(Object.values(PEER_AGREEMENTS_METHODS)),
    );
    for (const method of Object.values(PEER_AGREEMENTS_METHODS)) {
      expect(Object.values(PEER_WS_METHODS)).toContain(method);
      expect(PeerRpcGroup.requests.has(method)).toBe(true);
      expect(PEER_RPC_SCOPES[method]).toBe(AgreementsRpcScopes[method]);
    }
    expect(PEER_WS_METHODS.peerAgreementsView).toBe("peer.agreements.view");
  });

  it("lets anyone who can read see agreements, and operators close and reopen them", () => {
    expect(AgreementsRpcScopes[PEER_AGREEMENTS_METHODS.peerAgreementsView]).toBe(
      AuthOrchestrationReadScope,
    );
    expect(AgreementsRpcScopes[PEER_AGREEMENTS_METHODS.peerAgreementsClose]).toBe(
      AuthOrchestrationOperateScope,
    );
    expect(AgreementsRpcScopes[PEER_AGREEMENTS_METHODS.peerAgreementsReopen]).toBe(
      AuthOrchestrationOperateScope,
    );
  });
});
