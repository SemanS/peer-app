import * as Schema from "effect/Schema";
import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import {
  AuthAccessReadScope,
  AuthAccessWriteScope,
  EnvironmentAuthorizationError,
  type AuthEnvironmentScope,
} from "../auth.ts";
import { PeerHubError } from "./base.ts";
import {
  PeerMcpClientList,
  PeerMcpClientsInput,
  PeerMcpConnectInput,
  PeerMcpConnectResult,
} from "./mcp.ts";

export const PEER_MCP_METHODS = {
  peerMcpClients: "peer.mcp.clients",
  peerMcpConnect: "peer.mcp.connect",
  peerMcpDisconnect: "peer.mcp.disconnect",
} as const;

const error = Schema.Union([PeerHubError, EnvironmentAuthorizationError]);
export const McpRpcGroup = RpcGroup.make(
  Rpc.make(PEER_MCP_METHODS.peerMcpClients, {
    payload: PeerMcpClientsInput,
    success: PeerMcpClientList,
    error,
  }),
  Rpc.make(PEER_MCP_METHODS.peerMcpConnect, {
    payload: PeerMcpConnectInput,
    success: PeerMcpConnectResult,
    error,
  }),
  Rpc.make(PEER_MCP_METHODS.peerMcpDisconnect, {
    payload: PeerMcpConnectInput,
    success: PeerMcpConnectResult,
    error,
  }),
);

export const McpRpcScopes = {
  [PEER_MCP_METHODS.peerMcpClients]: AuthAccessReadScope,
  [PEER_MCP_METHODS.peerMcpConnect]: AuthAccessWriteScope,
  [PEER_MCP_METHODS.peerMcpDisconnect]: AuthAccessWriteScope,
} as const satisfies Record<RpcGroup.Rpcs<typeof McpRpcGroup>["_tag"], AuthEnvironmentScope>;
