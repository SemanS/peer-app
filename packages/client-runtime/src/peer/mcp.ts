import { WS_METHODS, type PeerMcpClient } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "../state/runtime.ts";

/** Installed clients first, then by title; the order does not move when one connects. */
export const orderMcpClients = (clients: ReadonlyArray<PeerMcpClient>) =>
  [...clients].sort(
    (a, b) => Number(b.installed) - Number(a.installed) || a.title.localeCompare(b.title),
  );

/** What a connect or disconnect did, for the line under the list. */
export function mcpConnectMessage(
  kind: "connect" | "disconnect",
  title: string,
  result: { readonly outcome: string; readonly path: string },
) {
  if (result.outcome === "manual")
    return `${result.path} has comments or is not plain JSON, so Peer left it alone. ${
      kind === "connect" ? "Add" : "Remove"
    } the peer entry by hand.`;
  return kind === "connect"
    ? `Connected. Reload ${title} to get Peer's tools.`
    : `Disconnected ${title}.`;
}

/** Read when the settings row opens; connect and disconnect read it again. */
export function createMcpEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    clients: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:peer:mcp:clients",
      tag: WS_METHODS.peerMcpClients,
      staleTimeMs: 0,
      idleTtlMs: 0,
    }),
    connect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer:mcp:connect",
      tag: WS_METHODS.peerMcpConnect,
    }),
    disconnect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer:mcp:disconnect",
      tag: WS_METHODS.peerMcpDisconnect,
    }),
  };
}
