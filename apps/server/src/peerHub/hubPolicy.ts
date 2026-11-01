/**
 * hubPolicy — which agent tools a Peer workspace gives one thread.
 *
 * The PeerHub service publishes the provisioned state here; adapters read it synchronously, the
 * way they read `McpProviderSession`. Everything below is pure apart from that one slot, so the
 * rules are testable without a server.
 *
 * @module peerHub/hubPolicy
 */
import {
  type PeerHarness,
  type PeerMcpServer,
  type PeerProject,
  type PeerTool,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";

export interface HubWorkspaceRef {
  readonly slug: string;
  readonly name: string;
}

export interface HubBoundProject {
  readonly workspace: HubWorkspaceRef;
  readonly project: PeerProject;
  /** Local checkout of the repository this T3 project is rooted at. */
  readonly repositoryPath: string;
}

export interface HubPolicyState {
  /** T3 project id → the workspace project and repository it was provisioned for. */
  readonly projects: ReadonlyMap<string, HubBoundProject>;
  /** Realpath of a checkout → the same, for projects added by hand. */
  readonly roots: ReadonlyMap<string, HubBoundProject>;
}

/** Workspace tools reach providers only through this fail-closed gate. */
export type WorkspaceToolDecision =
  | { readonly give: true; readonly secrets: ReadonlyMap<string, string> }
  | { readonly give: false };
export type WorkspaceToolGate = (input: {
  readonly workspace: string;
  readonly project: string;
  readonly tool: PeerTool;
}) => WorkspaceToolDecision;
let workspaceToolGate: WorkspaceToolGate | null = null;
export function setWorkspaceToolGate(gate: WorkspaceToolGate | null): void {
  workspaceToolGate = gate;
}
let current: HubPolicyState | null = null;
const threadProjects = new Map<ThreadId, ProjectId>();
type PluginMcpProvider = (
  thread: string,
  harness: PeerHarness,
) => Readonly<Record<string, PeerMcpServer>>;
let pluginMcpProviders: ReadonlyArray<PluginMcpProvider> = [];
export function setPluginMcpProviders(providers: ReadonlyArray<PluginMcpProvider>): void {
  pluginMcpProviders = providers;
}
/** Active plugin servers for workspace-bound threads; Claude and Codex retain their native hooks. */
export function pluginMcpServers(thread: ThreadId, driver: string): Record<string, PeerMcpServer> {
  const harness = harnessForDriver(driver);
  if (harness === undefined || boundProjectForThread(thread) === undefined) return {};
  return Object.assign({}, ...pluginMcpProviders.map((provider) => provider(thread, harness)));
}

export function setHubPolicyState(next: HubPolicyState | null): void {
  current = next;
}

export function readHubPolicyState(): HubPolicyState | null {
  return current;
}

/** Remembered when a provider session opens, so adapters can resolve a thread's project. */
export function bindThreadProject(threadId: ThreadId, projectId: ProjectId): void {
  threadProjects.set(threadId, projectId);
}

function hubProjectFor(
  state: HubPolicyState,
  input: { readonly projectId: string; readonly workspaceRoot?: string | null | undefined },
): HubBoundProject | undefined {
  return (
    state.projects.get(input.projectId) ??
    (input.workspaceRoot ? state.roots.get(input.workspaceRoot) : undefined)
  );
}

const HARNESS_BY_DRIVER: Readonly<Record<string, PeerHarness>> = {
  claudeAgent: "claude",
  codex: "codex",
  cursor: "cursor",
  grok: "grok",
  opencode: "opencode",
  antigravity: "antigravity",
};

export function harnessForDriver(driver: string): PeerHarness | undefined {
  return HARNESS_BY_DRIVER[driver];
}

/** Resolves ${project.root} and ${secret:NAME} in a tool value. */
export function resolveToolValue(
  value: string,
  context: {
    readonly projectRoot: string;
    readonly secrets: ReadonlyMap<string, string>;
  },
): string {
  return value.replace(/\$\{([^}]+)\}/g, (match, key: string) => {
    if (key === "project.root") return context.projectRoot;
    if (key.startsWith("secret:")) return context.secrets.get(key.slice("secret:".length)) ?? match;
    return match;
  });
}

function resolvedToolServers(bound: HubBoundProject): Record<string, PeerMcpServer> {
  const servers: Record<string, PeerMcpServer> = {};
  for (const tool of bound.project.tools) {
    const decision = workspaceToolGate?.({
      workspace: bound.workspace.slug,
      project: bound.project.id,
      tool,
    });
    if (decision?.give !== true) continue;
    const context = { projectRoot: bound.repositoryPath, secrets: decision.secrets };
    const values =
      tool.mcp.transport === "stdio"
        ? [tool.mcp.command, ...tool.mcp.args, ...Object.values(tool.mcp.env)]
        : [tool.mcp.url, ...Object.values(tool.mcp.headers)];
    if (
      values.some((value) =>
        [...value.matchAll(/\$\{secret:([^}]+)\}/g)].some(
          (match) => !decision.secrets.has(match[1]!),
        ),
      )
    )
      continue;
    const mcp = tool.mcp;
    if (mcp.transport === "stdio") {
      servers[tool.id] = {
        transport: "stdio",
        command: resolveToolValue(mcp.command, context),
        args: mcp.args.map((arg) => resolveToolValue(arg, context)),
        env: Object.fromEntries(
          Object.entries(mcp.env).map(([name, value]) => [name, resolveToolValue(value, context)]),
        ),
      };
    } else {
      servers[tool.id] = {
        transport: mcp.transport,
        url: resolveToolValue(mcp.url, context),
        headers: Object.fromEntries(
          Object.entries(mcp.headers).map(([name, value]) => [
            name,
            resolveToolValue(value, context),
          ]),
        ),
      };
    }
  }
  return servers;
}

function boundProjectForThread(
  threadId: ThreadId,
): { state: HubPolicyState; bound: HubBoundProject } | undefined {
  const state = current;
  const projectId = threadProjects.get(threadId);
  if (state === null || projectId === undefined) return undefined;
  const bound = hubProjectFor(state, { projectId });
  return bound === undefined ? undefined : { state, bound };
}

type ClaudeMcpServer =
  | { type: "stdio"; command: string; args: string[]; env: Record<string, string> }
  | { type: "http" | "sse"; url: string; headers: Record<string, string> };

/** The workspace project's tools as Claude Agent SDK `mcpServers` entries. */
export function claudeHubMcpServers(threadId: ThreadId): Record<string, ClaudeMcpServer> {
  const found = boundProjectForThread(threadId);
  if (found === undefined) return {};
  const servers: Record<string, ClaudeMcpServer> = {};
  for (const [id, server] of Object.entries(resolvedToolServers(found.bound))) {
    servers[id] =
      server.transport === "stdio"
        ? { type: "stdio", command: server.command, args: [...server.args], env: { ...server.env } }
        : { type: server.transport, url: server.url, headers: { ...server.headers } };
  }
  return servers;
}

/**
 * The workspace project's tools as Codex `mcp_servers` entries. Codex speaks
 * stdio and streamable HTTP; SSE-only servers are left out.
 */
export function codexHubMcpServers(threadId: ThreadId): Record<string, Record<string, unknown>> {
  const found = boundProjectForThread(threadId);
  if (found === undefined) return {};
  const servers: Record<string, Record<string, unknown>> = {};
  for (const [id, server] of Object.entries(resolvedToolServers(found.bound))) {
    if (server.transport === "stdio") {
      servers[id] = { command: server.command, args: [...server.args], env: { ...server.env } };
    } else if (server.transport === "http") {
      servers[id] = { url: server.url, http_headers: { ...server.headers } };
    }
  }
  return servers;
}

/** A short system-prompt addition naming the project. */
export function hubInstructionsForThread(threadId: ThreadId): string {
  const found = boundProjectForThread(threadId);
  if (found === undefined) return "";
  const { project, workspace } = found.bound;
  return [
    "",
    `## ${workspace.name} project: ${project.name}`,
    `This workspace belongs to the ${workspace.name} project "${project.name}".`,
    "",
  ].join("\n");
}
