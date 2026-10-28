/**
 * What the plugin offers beyond its hooks, each a thin transport over its service: the RPC methods
 * the apps call, and the MCP tool for agents that have no shell (their `peer role`).
 *
 * @module peerHub/plugins/roles/client/transport
 */
import { PEER_ROLES_METHODS as methods, RolesRpcGroup } from "@t3tools/contracts";

import { usage, type PeerContributions } from "../../../core/plugin.ts";
import type { Roles } from "../Roles.ts";

export const rolesRpc = (roles: Roles["Service"]) =>
  ({
    group: RolesRpcGroup,
    handlers: (wrap) =>
      RolesRpcGroup.of({
        [methods.peerRolesList]: (input) => wrap.effect(methods.peerRolesList, roles.list(input)),
        [methods.peerRolesSet]: (input) => wrap.effect(methods.peerRolesSet, roles.set(input)),
        [methods.peerRolesClear]: (input) =>
          wrap.effect(methods.peerRolesClear, roles.clear(input)),
        [methods.peerRolesStartReview]: (input) =>
          wrap.effect(methods.peerRolesStartReview, roles.startReview(input)),
      }),
  }) satisfies NonNullable<PeerContributions["rpc"]>;

export const roleTools = [
  {
    name: "peer_role",
    description:
      "Your session's role (action show); take the role review before you change anything (action review). Only your person clears it.",
    command: "role",
    inputSchema: {
      type: "object",
      properties: { action: { type: "string", enum: ["show", "review"] } },
      additionalProperties: false,
    },
    arguments: (input) => {
      const action = input.action ?? "show";
      if (action === "show") return [];
      if (action === "review") return ["review"];
      throw usage("Invalid role action.", "use show, or review.");
    },
  },
] satisfies NonNullable<PeerContributions["agentTools"]>;
