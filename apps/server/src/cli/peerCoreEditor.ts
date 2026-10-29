// @effect-diagnostics nodeBuiltinImport:off - which editors' folders exist in the person's home.
/**
 * Connecting an editor from Peer Core without the app: Peer's hooks for Claude Code and Codex
 * (`peer core hooks install`), the MCP entry for the others (`peer core connect <client>`). `join
 * --editor` runs the same code as those commands, in-process.
 *
 * @module cli/peerCoreEditor
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { PeerHubStatus } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";

import * as PeerAdapters from "../peerHub/core/coordination/PeerAdapters.ts";
import { MCP_CLIENTS, mcpClient } from "../peerHub/plugins/mcp/clients.ts";
import * as McpConnect from "../peerHub/plugins/mcp/connect.ts";
import { fail, type OneShotIo } from "./peerCoreIo.ts";

/** What `--editor` takes: the two with hooks, then every MCP client. */
export const EDITORS: ReadonlyArray<string> = [
  "claude",
  "codex",
  ...MCP_CLIENTS.map((client) => client.id),
];

export const editorTitle = (id: string) =>
  id === "claude" ? "Claude Code" : id === "codex" ? "Codex" : (mcpClient(id)?.title ?? id);

export const claudeSettingsPath = () =>
  NodePath.join(
    process.env.CLAUDE_CONFIG_DIR?.trim() || NodePath.join(NodeOS.homedir(), ".claude"),
    "settings.json",
  );

const exists = (path: string) =>
  NodeFSP.stat(path).then(
    () => true,
    () => false,
  );

/** The editors whose folders are in this person's home, in `EDITORS` order. */
export const detectedEditors = Effect.gen(function* () {
  const home = yield* HostProcess.HomeDirectory;
  const platform = yield* HostProcess.Platform;
  const env = yield* HostProcess.Environment;
  return yield* Effect.promise(async () => {
    const hooks = [
      { id: "claude", path: env.CLAUDE_CONFIG_DIR?.trim() || NodePath.join(home, ".claude") },
      { id: "codex", path: env.CODEX_HOME?.trim() || NodePath.join(home, ".codex") },
    ];
    const found = await Promise.all(hooks.map((editor) => exists(editor.path)));
    const clients = await McpConnect.listClients(McpConnect.userBases(home, platform, env)).catch(
      () => [],
    );
    return [
      ...hooks.filter((_, index) => found[index]).map((editor) => editor.id),
      ...clients.filter((client) => client.installed).map((client) => client.id),
    ];
  });
});

/**
 * What `hooks install` and `hooks remove` say of the status they left: Claude Code's hooks, and
 * with `codex` each Codex home's, with the commands awaiting the person's approval.
 */
export const sayHooks = (
  status: PeerHubStatus,
  options: { readonly claude: boolean; readonly codex: boolean; readonly install: boolean },
  io: OneShotIo,
) =>
  Effect.gen(function* () {
    const coordination = status.coordination;
    if (options.claude)
      yield* io.say(
        `Claude Code: ${coordination.claudeHooks ? "hooks installed" : coordination.claudeHooksPresent ? "hooks partly present" : "no Peer hooks"} in ${claudeSettingsPath()} (and every Claude home your provider settings name).`,
      );
    if (!options.codex) return;
    for (const codex of coordination.codexHookHomes ?? []) {
      yield* io.say(
        `Codex: ${codex.installed ? (codex.trusted ? "hooks installed and trusted" : "hooks installed, awaiting your approval") : codex.present ? "hooks partly present" : "no Peer hooks"} in ${codex.hooksPath}${codex.error === undefined ? "" : ` (${codex.error})`}.`,
      );
      if (!options.install || !codex.installed || codex.trusted) continue;
      yield* io.say(`Codex runs these commands for Peer in ${codex.home}:`);
      for (const hook of codex.hooks)
        yield* io.say(
          `  ${hook.event}${hook.matcher === undefined ? "" : ` (${hook.matcher})`}: ${hook.command}`,
        );
      yield* io.say(
        `Approve them: peer core hooks install --codex-approve ${codex.home} ${codex.reviewId}`,
      );
    }
  });

/** Writes Peer's MCP entry into `client`'s settings at `scope` and says what happened. */
export const connectClient = (
  input: {
    readonly client: string;
    readonly scope: "user" | "project";
    readonly folder: string;
    readonly stateDir: string;
  },
  io: OneShotIo,
) =>
  Effect.gen(function* () {
    const client = mcpClient(input.client);
    if (client === undefined)
      return yield* fail(
        `peer core: ${input.client} is not a known client: ${MCP_CLIENTS.map((c) => c.id).join(", ")}.`,
      );
    yield* Effect.tryPromise({
      try: () => McpConnect.ensureShim(input.stateDir),
      catch: (cause) =>
        fail(
          `peer core: could not write the peer command: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
    });
    const clients = yield* McpConnect.McpClients;
    const answer = yield* clients.connect({
      client: client.id,
      scope: input.scope,
      ...(input.scope === "project" ? { project: { root: input.folder } } : {}),
    });
    if (answer.outcome === "manual")
      yield* io.say(
        `${answer.path} is not plain JSON, so Peer left it alone. Add this entry by hand:\n${answer.entry}`,
      );
    else if (answer.outcome === "unchanged")
      yield* io.say(`${client.title} already has Peer's MCP entry in ${answer.path}.`);
    else
      yield* io.say(
        `Connected ${client.title} in ${answer.path}. Reload ${client.title}; Peer Core starts when it first needs Peer.`,
      );
  });

/** `join --editor <id>`: hooks for Claude Code or Codex, the user-scope MCP entry for the rest. */
export const connectEditor = (id: string, stateDir: string, io: OneShotIo) =>
  Effect.gen(function* () {
    if (id === "claude" || id === "codex") {
      const adapters = yield* PeerAdapters.PeerAdapters;
      const status = yield* adapters.setCoordination(
        id === "claude" ? { claudeHooks: true } : { codexHooks: true },
      );
      return yield* sayHooks(
        status,
        { claude: id === "claude", codex: id === "codex", install: true },
        io,
      );
    }
    // The clone is not there yet, so the entry goes where every folder sees it.
    return yield* connectClient(
      { client: id, scope: "user", folder: NodeOS.homedir(), stateDir },
      io,
    );
  });

/** The way out of `connectEditor`: Peer's hooks out of Claude Code or Codex, the MCP entry out of the rest. */
export const disconnectEditor = (id: string, io: OneShotIo) =>
  Effect.gen(function* () {
    if (id === "claude" || id === "codex") {
      const adapters = yield* PeerAdapters.PeerAdapters;
      const status = yield* adapters.setCoordination(
        id === "claude" ? { claudeHooks: false } : { codexHooks: false },
      );
      return yield* sayHooks(
        status,
        { claude: id === "claude", codex: id === "codex", install: false },
        io,
      );
    }
    const answer = yield* (yield* McpConnect.McpClients).disconnect({ client: id, scope: "user" });
    yield* io.say(
      answer.outcome === "manual"
        ? `${answer.path} is not plain JSON, so Peer left it alone. Remove this entry by hand:\n${answer.entry}`
        : answer.outcome === "unchanged"
          ? `${editorTitle(id)} had no Peer entry in ${answer.path}.`
          : `Disconnected ${editorTitle(id)}: removed Peer's entry from ${answer.path}.`,
    );
  });
