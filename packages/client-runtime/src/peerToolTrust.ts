import {
  AuthAccessWriteScope,
  AuthOrchestrationOperateScope,
  WS_METHODS,
  type AuthSessionState,
  type PeerHubStatus,
  type PeerProjectState,
  type PeerWorkspaceState,
  type PeerToolTrustStatus,
} from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";
import type * as EnvironmentRegistry from "./connection/registry.ts";
import { createEnvironmentRpcCommand } from "./state/runtime.ts";

type ReviewStatus = Pick<PeerHubStatus, "toolTrust"> & {
  readonly workspaces: ReadonlyArray<
    Pick<PeerWorkspaceState, "slug" | "name"> & {
      readonly projects: ReadonlyArray<Pick<PeerProjectState, "project" | "repositories">>;
    }
  >;
};
export const TOOL_TRUST_OWNER_MESSAGE =
  "Approve tools and manage secrets on that computer, or from a device paired with owner access.";
export const TOOL_TRUST_STDIO_NOTICE =
  "Approval pins this definition, not the program it runs or files in the project or company knowledge checkout.";
export const TOOL_TRUST_CODEX_NOTICE =
  "Running Codex conversations keep a tool until their session restarts.";
export const toolTrustStateLabel = {
  on: "On",
  review: "Needs review",
  changed: "Changed",
  secret: "Needs secret",
  off: "Off",
  invalid: "Invalid",
} as const;
export function toolTrustPermissions(
  session: Pick<AuthSessionState, "authenticated" | "scopes"> | null | undefined,
) {
  return {
    approve:
      session?.authenticated === true && session.scopes?.includes(AuthAccessWriteScope) === true,
    turnOff:
      session?.authenticated === true &&
      session.scopes?.includes(AuthOrchestrationOperateScope) === true,
  };
}
const secretNames = (value: string) =>
  [
    ...new Set([...value.matchAll(/\$\{secret:([A-Z_][A-Z0-9_]{0,63})\}/g)].map((m) => m[1]!)),
  ].sort();
const pairs = (entries: Readonly<Record<string, string>>) =>
  Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
type ToolState = "on" | PeerToolTrustStatus["workspaces"][number]["tools"][number]["state"];
export interface ToolTrustRow {
  readonly key: string;
  readonly workspace: string;
  readonly tool: string;
  readonly name: string;
  readonly state: ToolState;
  readonly fingerprint?: string;
  readonly projects: ReadonlyArray<string>;
  readonly projectIds: ReadonlyArray<string>;
  readonly providers: ReadonlyArray<string>;
  readonly changes: ReadonlyArray<string>;
  readonly missing: ReadonlyArray<string>;
  readonly reason?: string;
  readonly review:
    | {
        readonly transport: "stdio";
        readonly command: string;
        readonly args: ReadonlyArray<string>;
        readonly env: ReadonlyArray<readonly [string, string]>;
      }
    | {
        readonly transport: "http" | "sse";
        readonly url: string;
        readonly headers: ReadonlyArray<{
          readonly name: string;
          readonly secrets: ReadonlyArray<string>;
        }>;
      };
}
/** Build review data from manifest templates; remote header values never enter the result. */
export function toolTrustReview(status: ReviewStatus) {
  return status.workspaces.map((workspace) => {
    const block = status.toolTrust?.workspaces.find((w) => w.workspace === workspace.slug);
    const groups = new Map<string, ToolTrustRow>();
    for (const project of workspace.projects)
      for (const tool of project.project.tools) {
        const held = block?.tools.find(
          (t) => t.tool === tool.id && t.projects.includes(project.project.id),
        );
        const mcp = tool.mcp;
        // Internal grouping uses the exact template, including hidden headers, but never returns it.
        const canonical =
          mcp.transport === "stdio"
            ? [mcp.transport, mcp.command, mcp.args, pairs(mcp.env)]
            : [mcp.transport, mcp.url, pairs(mcp.headers)];
        const key = `${tool.id}/${held?.fingerprint ?? JSON.stringify(canonical)}`;
        const previous = groups.get(key);
        groups.set(key, {
          key: previous?.key ?? `${workspace.slug}/${tool.id}/${groups.size}`,
          workspace: workspace.slug,
          tool: tool.id,
          name: tool.name,
          state: held?.state ?? (block === undefined ? "off" : "on"),
          ...(held?.fingerprint === undefined ? {} : { fingerprint: held.fingerprint }),
          projects: [...new Set([...(previous?.projects ?? []), project.project.name])],
          projectIds: [...new Set([...(previous?.projectIds ?? []), project.project.id])],
          providers: mcp.transport === "sse" ? ["Claude"] : ["Claude", "Codex"],
          changes: held?.changes ?? [],
          missing: held?.missing ?? [],
          ...(held?.reason === undefined ? {} : { reason: held.reason }),
          review:
            mcp.transport === "stdio"
              ? { transport: "stdio", command: mcp.command, args: mcp.args, env: pairs(mcp.env) }
              : {
                  transport: mcp.transport,
                  url: mcp.url,
                  headers: pairs(mcp.headers).map(([name, value]) => ({
                    name,
                    secrets: secretNames(value),
                  })),
                },
        });
      }
    return {
      workspace: workspace.slug,
      name: workspace.name,
      appliedBy: block?.appliedBy,
      appliedAt: block?.appliedAt,
      tools: [...groups.values()],
      secrets: block?.secrets ?? [],
    };
  });
}
/** One count per held definition, limited to projects with a repository opened here. */
export function toolTrustNeedsYouCount(status: ReviewStatus): number {
  let count = 0;
  for (const workspace of toolTrustReview(status)) {
    const opened = new Set(
      status.workspaces
        .find((w) => w.slug === workspace.workspace)
        ?.projects.filter((p) => p.repositories.some((r) => r.projectId !== undefined))
        .map((p) => p.project.id),
    );
    count += workspace.tools.filter(
      (t) =>
        (t.state === "review" || t.state === "changed" || t.state === "secret") &&
        t.projectIds.some((id) => opened.has(id)),
    ).length;
  }
  return count;
}
export function createPeerToolTrustAtoms<R, ER>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry.EnvironmentRegistry | R, ER>,
) {
  return {
    peerToolTrustApprove: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer:tool-trust:approve",
      tag: WS_METHODS.peerToolTrustApprove,
    }),
    peerToolTrustSetSecret: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer:tool-trust:set-secret",
      tag: WS_METHODS.peerToolTrustSetSecret,
    }),
    peerToolTrustTurnOff: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer:tool-trust:turn-off",
      tag: WS_METHODS.peerToolTrustTurnOff,
    }),
  };
}
