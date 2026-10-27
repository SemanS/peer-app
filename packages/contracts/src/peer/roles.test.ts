import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import { AuthOrchestrationOperateScope, AuthOrchestrationReadScope } from "../auth.ts";
import { PEER_PLUGIN_IDS } from "./plugin.ts";
import { peerPluginStatusFields } from "./registry.ts";
import { PEER_ROLES_METHODS, RolesRpcScopes } from "./roles.rpc.ts";
import {
  PEER_ROLES_PLUGIN,
  PeerRolesProject,
  PeerRolesSetInput,
  PeerRolesStatus,
} from "./roles.ts";
import { PEER_RPC_SCOPES } from "./rpcRegistry.ts";

const decodeProject = Schema.decodeUnknownSync(PeerRolesProject);
const decodeSet = Schema.decodeUnknownExit(PeerRolesSetInput);
const decodeStatus = Schema.decodeSync(PeerRolesStatus);
const isStatusFields = Schema.is(Schema.Struct(peerPluginStatusFields));

const row = {
  session: "claude:one",
  role: "review",
  email: "slavo@acme.test",
  environment: "slavo-mac",
  setBy: "person",
  at: "2026-10-27T10:00:00Z",
};

describe("the roles contracts", () => {
  it("name the plugin, its Hub feature, and keep its id in the registry", () => {
    expect(PEER_ROLES_PLUGIN.id).toBe("roles");
    expect(PEER_ROLES_PLUGIN.hubFeature).toEqual({ id: "roles", revision: 1 });
    expect(PEER_PLUGIN_IDS).toContain("roles");
  });

  it("read the Hub's rows, a newer Hub's role and fields included", () => {
    const project = decodeProject({
      workspace: "acme",
      project: "app",
      at: "2026-10-27T10:00:01Z",
      roles: [
        { ...row, changedFiles: true },
        { ...row, session: "codex:two", role: "triage", setBy: "lead", extra: 1 },
      ],
    });
    expect(project.roles.map((r) => r.role)).toEqual(["review", "triage"]);
    expect(project.roles[0]?.changedFiles).toBe(true);
    expect(project.roles[1]?.changedFiles).toBeUndefined();
  });

  it("let a person set only the roles known today", () => {
    expect(
      Exit.isSuccess(
        decodeSet({ workspace: "acme", project: "app", role: "review", thread: "peer:t1" }),
      ),
    ).toBe(true);
    expect(
      Exit.isFailure(decodeSet({ workspace: "acme", project: "app", role: "none", session: "x" })),
    ).toBe(true);
  });

  it("place the status slice in its own optional field", () => {
    const roles = decodeStatus({ projects: [], threads: [] });
    expect(isStatusFields({ roles })).toBe(true);
    expect(isStatusFields({})).toBe(true);
  });

  it("read with read access and change with operate access", () => {
    expect(RolesRpcScopes[PEER_ROLES_METHODS.peerRolesList]).toBe(AuthOrchestrationReadScope);
    for (const method of [
      PEER_ROLES_METHODS.peerRolesSet,
      PEER_ROLES_METHODS.peerRolesClear,
      PEER_ROLES_METHODS.peerRolesStartReview,
    ])
      expect(PEER_RPC_SCOPES[method]).toBe(AuthOrchestrationOperateScope);
    expect(Object.values(PEER_ROLES_METHODS).every((m) => m.startsWith("peer.roles."))).toBe(true);
  });
});
