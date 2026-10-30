import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "../auth.ts";
import { CLIENT_GUARDED_RPC_SCOPES } from "../clientRpcPermissions.ts";
import { PeerHubStatus } from "../peerHub.ts";
import { PEER_PLUGIN_IDS } from "./plugin.ts";
import { PEER_ROOMS_METHODS as methods, RoomsRpcScopes } from "./rooms.rpc.ts";
import {
  PEER_ROOM_DELIVERY_STATES,
  PeerRoomDiff,
  PeerRoomInbox,
  PeerRoomMessage,
  PeerRoomRead,
  PeerRoomsPostInput,
  PeerRoomsSetReachInput,
} from "./rooms.ts";

const decodeMessage = Schema.decodeUnknownSync(PeerRoomMessage);
const decodeRead = Schema.decodeUnknownSync(PeerRoomRead);
const decodeInbox = Schema.decodeUnknownSync(PeerRoomInbox);
const decodePost = Schema.decodeUnknownSync(PeerRoomsPostInput);
const decodeReach = Schema.decodeUnknownSync(PeerRoomsSetReachInput);
const decodeDiff = Schema.decodeUnknownSync(PeerRoomDiff);

const message = {
  seq: 12,
  task: "t-1",
  at: "2026-10-30T10:00:00Z",
  author: { email: "bob@acme.test" },
  text: "Why this?",
  to: [
    { kind: "agent", email: "ana@acme.test", state: "waiting", at: "2026-10-30T10:00:00Z" },
    { kind: "person", email: "eva@acme.test" },
  ],
};

describe("room rows", () => {
  it.each(PEER_ROOM_DELIVERY_STATES)("decode the delivery state %s", (state) => {
    expect(decodeMessage({ ...message, to: [{ ...message.to[0], state }] }).to[0]?.state).toBe(
      state,
    );
  });

  it("decode what a newer Hub says, a state, a kind and a side they do not know", () => {
    const newer = decodeMessage({
      ...message,
      anchor: { path: "a.ts", line: 3, side: "both", extra: true },
      to: [{ kind: "group", email: "ana@acme.test", state: "snoozed", more: 1 }],
    });
    expect(newer.to[0]).toMatchObject({ kind: "group", state: "snoozed" });
    expect(newer.anchor?.side).toBe("both");
  });

  it("read as the routes answer", () => {
    const read = decodeRead({
      seq: 12,
      seen: 3,
      messages: [message],
      reaches: [{ run: "run_1", reach: "team", capacity: "shared" }],
    });
    expect(read.reaches[0]?.reach).toBe("team");
    const inbox = decodeInbox({
      waiting: [{ project: "app", task: "t-1", message }],
      mentions: [],
      work: [],
      seqs: { app: { "t-1": 12 } },
      revs: { app: { "t-1": 15 } },
    });
    expect(inbox.seqs.app?.["t-1"]).toBe(12);
    expect(inbox.revs.app?.["t-1"]).toBe(15);
  });
});

describe("room inputs", () => {
  it("name people and agents, and nothing else", () => {
    const post = { workspace: "acme", project: "app", task: "t", op: "o", text: "hi" };
    expect(
      decodePost({ ...post, to: [{ kind: "agent", email: "a@b.c", harness: "codex" }] }).to,
    ).toEqual([{ kind: "agent", email: "a@b.c", harness: "codex" }]);
    expect(() => decodePost({ ...post, to: [{ kind: "group", email: "a@b.c" }] })).toThrow();
  });

  it("set a reach to own or team, with no capacity from a client", () => {
    const input = { workspace: "acme", project: "app", run: "run_1", reach: "team" };
    expect(decodeReach({ ...input, capacity: "shared" })).toEqual(input);
    expect(() => decodeReach({ ...input, reach: "everyone" })).toThrow();
  });

  it("answer a diff from here or say it is not here", () => {
    expect(decodeDiff({ state: "notHere", reason: "Not pushed.", files: ["a.ts"] }).state).toBe(
      "notHere",
    );
    expect(
      decodeDiff({
        state: "here",
        source: "pushed",
        base: "a",
        head: "b",
        patch: "",
        truncated: false,
      }).state,
    ).toBe("here");
  });
});

describe("the rooms plugin's place", () => {
  it("comes right after roles", () => {
    expect(PEER_PLUGIN_IDS[PEER_PLUGIN_IDS.indexOf("roles") + 1]).toBe("rooms");
  });

  it("guards what acts and leaves reading open", () => {
    for (const method of [
      methods.peerRoomsPost,
      methods.peerRoomsSeen,
      methods.peerRoomsPass,
      methods.peerRoomsDecline,
      methods.peerRoomsWithdraw,
      methods.peerRoomsSetReach,
    ]) {
      expect(CLIENT_GUARDED_RPC_SCOPES).toHaveProperty([method], AuthOrchestrationOperateScope);
      expect(RoomsRpcScopes[method]).toBe(AuthOrchestrationOperateScope);
    }
    for (const method of [methods.peerRoomsRead, methods.peerRoomsDiff]) {
      expect(CLIENT_GUARDED_RPC_SCOPES).not.toHaveProperty([method]);
      expect(RoomsRpcScopes[method]).toBe(AuthOrchestrationReadScope);
    }
  });

  it("adds an optional status field", () => {
    expect(Object.keys(PeerHubStatus.fields)).toContain("rooms");
  });
});
