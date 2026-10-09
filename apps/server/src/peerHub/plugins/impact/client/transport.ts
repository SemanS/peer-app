import { PEER_IMPACT_METHODS as methods, PeerImpactRpcs } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import {
  usage,
  hubFailure,
  CliError,
  type PeerCommand,
  type PeerContributions,
} from "../../../core/plugin.ts";
import type { PeerStatus } from "../../../core/status/PeerStatus.ts";
import type { Impact } from "../Impact.ts";
/** Thin MCP and RPC transports call the same service as the CLI. */
export const impactTools = [
  {
    name: "peer_impact",
    description: "Read impact advice or dismiss/reopen your own impact overlap.",
    command: "impact",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read", "dismiss", "reopen"] },
        id: { type: "string" },
      },
      additionalProperties: false,
    },
    arguments: (input) => {
      if (input.action === undefined || input.action === "read") return [];
      if (!["dismiss", "reopen"].includes(String(input.action)) || typeof input.id !== "string")
        throw usage("Invalid impact action.", "use read, dismiss or reopen with an id.");
      return [String(input.action), input.id];
    },
  },
] satisfies NonNullable<PeerContributions["agentTools"]>;
export const impactRpc = (service: Impact["Service"], published: PeerStatus["Service"]) =>
  ({
    group: PeerImpactRpcs,
    handlers: (wrap) =>
      PeerImpactRpcs.of({
        [methods.peerImpactList]: (input) =>
          wrap.effect(
            methods.peerImpactList,
            service.list(input).pipe(Effect.tap(() => published.publish)),
          ),
        [methods.peerImpactDismiss]: (input) =>
          wrap.effect(
            methods.peerImpactDismiss,
            service.act(input, "dismiss").pipe(Effect.tap(() => published.publish)),
          ),
        [methods.peerImpactReopen]: (input) =>
          wrap.effect(
            methods.peerImpactReopen,
            service.act(input, "reopen").pipe(Effect.tap(() => published.publish)),
          ),
        [methods.peerImpactConfigure]: (input) =>
          wrap.effect(
            methods.peerImpactConfigure,
            service.configure(input).pipe(Effect.tap(() => published.publish)),
          ),
      }),
  }) satisfies NonNullable<PeerContributions["rpc"]>;

export const impactCommand = (
  service: Impact["Service"],
  published: PeerStatus["Service"],
): PeerCommand => ({
  name: "impact",
  usage: "impact [dismiss|reopen <id>]",
  summary: "other works whose changes use symbols you change, or change symbols yours use",
  run: ({ session, args }) =>
    service.command(session, args).pipe(
      Effect.tap(() => published.publish),
      Effect.mapError((error) =>
        error instanceof CliError
          ? error
          : hubFailure(error, "impact", "read peer impact before retrying.", args.length === 0),
      ),
    ),
});
