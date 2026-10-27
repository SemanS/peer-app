// @effect-diagnostics nodeBuiltinImport:off preferSchemaOverJson:off - editors' MCP settings are JSON files on this computer.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import {
  PeerHubError,
  type PeerMcpClient,
  type PeerMcpClientList,
  type PeerMcpConnectResult,
  type PeerMcpProjectInput,
  type PeerMcpScope,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import * as ServerConfig from "../../../config.ts";
import { readJsonSettings, writeJsonSettings } from "../../core/adapters/files.ts";
import { coordinationScripts } from "../../core/adapters/scripts.ts";
import { coordSocketPath, coreLaunchCommand } from "../../core/broker/owner.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import {
  entryOf,
  MCP_CLIENTS,
  MCP_SERVER_NAME,
  mcpClient,
  type McpBase,
  type McpClientDefinition,
  type McpFile,
  type McpServerCommand,
} from "./clients.ts";

/** A workspace project by its ids, or a folder already known to be a project's root. */
export type McpProject = PeerMcpProjectInput | { readonly root: string };

export interface McpConnectRequest {
  readonly client: string;
  readonly scope: PeerMcpScope;
  readonly project?: McpProject | undefined;
}

export type McpBases = Readonly<Record<Exclude<McpBase, "root">, string>> & {
  readonly root?: string;
};

/**
 * Writes Peer's scripts (`coord/hook`, `coord/wait`, `coord/bin/peer`) when no broker ever wrote
 * them, so an editor connected before Peer runs finds `peer`, which starts Peer Core on demand.
 * A broker rewrites them when it starts; scripts already there stay as they are.
 */
export async function ensureShim(stateDir: string): Promise<void> {
  const dir = NodePath.join(stateDir, "coord");
  const binDir = NodePath.join(dir, "bin");
  const paths = {
    hook: NodePath.join(dir, "hook"),
    wait: NodePath.join(dir, "wait"),
    peer: NodePath.join(binDir, "peer"),
  };
  if (await exists(paths.peer)) return;
  await NodeFSP.mkdir(binDir, { recursive: true });
  const texts = coordinationScripts(
    coordSocketPath(stateDir),
    binDir,
    [],
    coreLaunchCommand(stateDir),
  );
  for (const [name, text] of Object.entries(texts)) {
    const path = paths[name as keyof typeof texts];
    if (name !== "peer" && (await exists(path))) continue;
    const temporary = `${path}.${process.pid}.tmp`;
    await NodeFSP.writeFile(temporary, text, { mode: 0o755 });
    await NodeFSP.chmod(temporary, 0o755);
    await NodeFSP.rename(temporary, path);
  }
}

/** The platform's per-user settings folder, where VS Code keeps its user `mcp.json`. */
export function userBases(
  home: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
): McpBases {
  const config =
    platform === "darwin"
      ? NodePath.join(home, "Library", "Application Support")
      : platform === "win32"
        ? (env.APPDATA ?? NodePath.join(home, "AppData", "Roaming"))
        : env.XDG_CONFIG_HOME?.trim() || NodePath.join(home, ".config");
  return { home, config };
}

const pathOf = (bases: McpBases, place: { base: McpBase; path: ReadonlyArray<string> }) => {
  const base = bases[place.base];
  return base === undefined ? undefined : NodePath.join(base, ...place.path);
};

const exists = (path: string) =>
  NodeFSP.stat(path).then(
    () => true,
    () => false,
  );

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The text a person pastes when Peer leaves a file alone. */
export const entryText = (client: McpClientDefinition, file: McpFile, server: McpServerCommand) =>
  JSON.stringify({ [file.key]: { [MCP_SERVER_NAME]: entryOf(client.format, server) } }, null, 2);

/** Whether a file names the `peer` server; a file Peer cannot read counts as not connected. */
export async function fileConnected(path: string, key: string): Promise<boolean> {
  const settings = await readJsonSettings(path);
  const servers = settings?.[key];
  return isObject(servers) && MCP_SERVER_NAME in servers;
}

/**
 * Adds (`connect`) or removes (`disconnect`) only the `peer` entry and keeps everything else. A
 * file that is not a plain JSON object (JSONC with comments, say) is never rewritten: the answer is
 * `manual`, with the entry to paste.
 */
export async function changeFile(
  change: "connect" | "disconnect",
  client: McpClientDefinition,
  file: McpFile,
  path: string,
  server: McpServerCommand,
): Promise<Pick<PeerMcpConnectResult, "outcome" | "entry">> {
  const entry = entryText(client, file, server);
  const settings = await readJsonSettings(path);
  const servers = settings?.[file.key];
  if (settings === null || (servers !== undefined && !isObject(servers)))
    return { outcome: "manual", entry };
  const current = servers ?? {};
  const wanted = entryOf(client.format, server);
  if (change === "connect") {
    if (JSON.stringify(current[MCP_SERVER_NAME]) === JSON.stringify(wanted))
      return { outcome: "unchanged", entry };
    await writeJsonSettings(path, {
      ...settings,
      [file.key]: { ...current, [MCP_SERVER_NAME]: wanted },
    });
    return { outcome: "written", entry };
  }
  if (!(MCP_SERVER_NAME in current)) return { outcome: "unchanged", entry };
  const { [MCP_SERVER_NAME]: _removed, ...rest } = current;
  await writeJsonSettings(path, { ...settings, [file.key]: rest });
  return { outcome: "written", entry };
}

/** Each client with whether it is on this computer and whether its files name Peer. */
export async function listClients(bases: McpBases): Promise<ReadonlyArray<PeerMcpClient>> {
  return Promise.all(
    MCP_CLIENTS.map(async (client): Promise<PeerMcpClient> => {
      const place = async (file: McpFile | undefined) => {
        const path = file === undefined ? undefined : pathOf(bases, file);
        return file === undefined || path === undefined
          ? undefined
          : { path, connected: await fileConnected(path, file.key) };
      };
      const detected = await Promise.all(
        client.detect.map((spot) => {
          const path = pathOf(bases, spot);
          return path === undefined ? false : exists(path);
        }),
      );
      const [user, project] = await Promise.all([place(client.user), place(client.project)]);
      return {
        id: client.id,
        title: client.title,
        installed: detected.some(Boolean),
        ...(user === undefined ? {} : { user }),
        ...(project === undefined ? {} : { project }),
      };
    }),
  );
}

const hubError = (detail: string) => new PeerHubError({ detail });
const messageOf = (failure: unknown) =>
  failure instanceof Error ? failure.message : String(failure);

/** Connects Peer's MCP server to the editors and agents on this computer. */
export class McpClients extends Context.Service<
  McpClients,
  {
    readonly list: (project?: McpProject) => Effect.Effect<PeerMcpClientList, PeerHubError>;
    readonly connect: (
      input: McpConnectRequest,
    ) => Effect.Effect<PeerMcpConnectResult, PeerHubError>;
    readonly disconnect: (
      input: McpConnectRequest,
    ) => Effect.Effect<PeerMcpConnectResult, PeerHubError>;
    /** Ids of the clients connected at user scope, as last read (no I/O). */
    readonly connected: Effect.Effect<ReadonlyArray<string>>;
  }
>()("t3/peerHub/plugins/mcp/connect/McpClients") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const state = yield* PeerState.PeerState;
  const status = yield* PeerStatus.PeerStatus;
  const server: McpServerCommand = {
    command: NodePath.join(config.stateDir, "coord", "bin", "peer"),
    args: ["mcp"],
  };
  const user = userBases(
    yield* HostProcess.HomeDirectory,
    yield* HostProcess.Platform,
    yield* HostProcess.Environment,
  );
  const remember = (clients: ReadonlyArray<PeerMcpClient>) =>
    clients.filter((client) => client.user?.connected === true).map((client) => client.id);
  const initial = yield* Effect.promise(() => listClients(user).catch(() => []));
  const connectedRef = yield* Ref.make<ReadonlyArray<string>>(remember(initial));

  const rootOf = (project: McpProject) =>
    Effect.gen(function* () {
      if ("root" in project) return project.root;
      const found = yield* state.project(project.workspace, project.project);
      const repository = found.project.repositories[0];
      if (repository === undefined)
        return yield* Effect.fail(hubError("This project has no repository."));
      const root = state.checkoutPath(
        state.current().persisted,
        project.workspace,
        project.project,
        repository.id,
      );
      if (!(yield* Effect.promise(() => exists(root))))
        return yield* Effect.fail(hubError("This project has no checkout on this computer."));
      return root;
    });

  const list = (project?: McpProject) =>
    Effect.gen(function* () {
      const root = project === undefined ? undefined : yield* rootOf(project);
      const clients = yield* Effect.tryPromise({
        try: () => listClients(root === undefined ? user : { ...user, root }),
        catch: (failure) => hubError(`Could not read the editors' settings: ${messageOf(failure)}`),
      });
      const ids = remember(clients);
      const before = yield* Ref.getAndSet(connectedRef, ids);
      if (before.join() !== ids.join()) yield* status.publish;
      return { clients };
    });

  const change = (kind: "connect" | "disconnect") => (input: McpConnectRequest) =>
    Effect.gen(function* () {
      const client = mcpClient(input.client);
      if (client === undefined)
        return yield* Effect.fail(
          hubError(
            `Peer does not know ${input.client}. Known: ${MCP_CLIENTS.map((c) => c.id).join(", ")}.`,
          ),
        );
      const file = input.scope === "user" ? client.user : client.project;
      if (file === undefined)
        return yield* Effect.fail(
          hubError(
            input.scope === "user"
              ? `${client.title} has no settings file for everything on this computer.`
              : `${client.title} has no per-project settings file; connect it for this computer.`,
          ),
        );
      if (input.scope === "project" && input.project === undefined)
        return yield* Effect.fail(hubError("Name the project to connect."));
      const root =
        input.scope === "project" && input.project !== undefined
          ? yield* rootOf(input.project)
          : undefined;
      const path = pathOf(root === undefined ? user : { ...user, root }, file);
      if (path === undefined) return yield* Effect.fail(hubError("Name the project to connect."));
      const answer = yield* Effect.tryPromise({
        try: () => changeFile(kind, client, file, path, server),
        catch: (failure) => hubError(`Could not change ${path}: ${messageOf(failure)}`),
      });
      if (input.scope === "user" && answer.outcome === "written") {
        yield* Ref.update(connectedRef, (ids) =>
          kind === "connect"
            ? ids.includes(client.id)
              ? ids
              : [...ids, client.id]
            : ids.filter((id) => id !== client.id),
        );
        yield* status.publish;
      }
      return { client: client.id, scope: input.scope, path, ...answer };
    });

  return McpClients.of({
    list,
    connect: change("connect"),
    disconnect: change("disconnect"),
    connected: Ref.get(connectedRef),
  });
});

export const layer = Layer.effect(McpClients, make);
