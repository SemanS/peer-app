// @effect-diagnostics nodeBuiltinImport:off - herdr's integrations write into the person's Claude Code and Codex folders; their location and the programs they need are looked up on this computer.
/**
 * herdr's Claude Code and Codex integrations: the hooks that tell herdr an agent's own session, so
 * that herdr can resume the agent after it restarts. Peer only runs herdr's installer, and only
 * when the owner asks; it never edits those folders itself.
 *
 * @module peerHub/plugins/herdr/client/integration
 */
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import type { PeerHerdrIntegration, PeerHerdrIntegrationAgent } from "@t3tools/contracts";

import { runHerdrCommand, type HerdrCommandRunner } from "./server.ts";

export interface HerdrIntegrationHost {
  /** Whether a program exists on the computer's PATH. */
  readonly hasProgram: (program: string, env: Readonly<Record<string, string>>) => boolean;
  readonly directoryExists: (path: string) => boolean;
}

export const realIntegrationHost: HerdrIntegrationHost = {
  hasProgram: (program, env) =>
    (env.PATH ?? "")
      .split(NodePath.delimiter)
      .filter((dir) => dir !== "")
      .some((dir) => {
        try {
          NodeFS.accessSync(NodePath.join(dir, program), NodeFS.constants.X_OK);
          return true;
        } catch {
          return false;
        }
      }),
  directoryExists: (path) =>
    NodeFS.statSync(path, { throwIfNoEntry: false })?.isDirectory() === true,
};

export interface HerdrIntegrationDeps {
  readonly bin: string;
  /** The cleaned environment (`herdrServerEnv`): herdr and the folders it writes are looked up in it. */
  readonly env: Readonly<Record<string, string>>;
  readonly run?: HerdrCommandRunner;
  readonly host?: HerdrIntegrationHost;
}

const AGENTS: ReadonlyArray<PeerHerdrIntegrationAgent> = ["claude", "codex"];

const LABELS: Readonly<Record<PeerHerdrIntegrationAgent, string>> = {
  claude: "Claude Code",
  codex: "Codex",
};

/** The folder the agent keeps its configuration in, where herdr's installer writes. */
export function herdrIntegrationDir(
  agent: PeerHerdrIntegrationAgent,
  env: Readonly<Record<string, string>>,
): string {
  const home = env.HOME?.trim() || NodeOS.homedir();
  const named = (agent === "claude" ? env.CLAUDE_CONFIG_DIR : env.CODEX_HOME)?.trim();
  return named || NodePath.join(home, agent === "claude" ? ".claude" : ".codex");
}

/** The files installing or removing the integration changes, for the owner's confirmation. */
export function herdrIntegrationFiles(
  agent: PeerHerdrIntegrationAgent,
  env: Readonly<Record<string, string>>,
): ReadonlyArray<string> {
  const dir = herdrIntegrationDir(agent, env);
  return agent === "claude"
    ? [NodePath.join(dir, "settings.json"), NodePath.join(dir, "hooks", "herdr-agent-state.sh")]
    : [
        NodePath.join(dir, "hooks.json"),
        NodePath.join(dir, "config.toml"),
        NodePath.join(dir, "herdr-agent-state.sh"),
      ];
}

type HookState = "installed" | "outdated" | "missing";

/**
 * What `herdr integration status` prints in 0.9.3, one line per integration, the hook file last:
 *
 *     claude: not installed (/home/ana/.claude/hooks/herdr-agent-state.sh)
 *     codex: current (v8) (/home/ana/.codex/herdr-agent-state.sh)
 *     claude: outdated (v3 < v10) (/home/ana/.claude/hooks/herdr-agent-state.sh)
 *
 * Integrations that are not Peer's concern, and lines in a shape this does not know, are skipped.
 */
export function parseHerdrIntegrationStatus(
  output: string,
): ReadonlyMap<PeerHerdrIntegrationAgent, HookState> {
  const states = new Map<PeerHerdrIntegrationAgent, HookState>();
  for (const line of output.split("\n")) {
    const match = /^(claude|codex)(?: \([^)]*\))?: (.+)$/.exec(line.trim());
    if (match === null) continue;
    const agent = match[1] as PeerHerdrIntegrationAgent;
    const rest = match[2] ?? "";
    if (rest.startsWith("not installed")) states.set(agent, "missing");
    else if (rest.startsWith("current")) states.set(agent, "installed");
    else if (rest.startsWith("outdated")) states.set(agent, "outdated");
  }
  return states;
}

/** Why the integration cannot work here, in words for a person; undefined when it can. */
function unavailableReason(
  agent: PeerHerdrIntegrationAgent,
  deps: HerdrIntegrationDeps,
): string | undefined {
  const host = deps.host ?? realIntegrationHost;
  if (!host.hasProgram("python3", deps.env))
    return "python3 was not found on this computer; herdr's hook needs it.";
  const dir = herdrIntegrationDir(agent, deps.env);
  if (!host.directoryExists(dir))
    return `${LABELS[agent]}'s configuration folder (${dir}) does not exist; start ${LABELS[agent]} once first.`;
  return undefined;
}

/** The state of each integration, from one run of `herdr integration status`. */
export async function herdrIntegrationStatuses(
  deps: HerdrIntegrationDeps,
): Promise<ReadonlyArray<PeerHerdrIntegration>> {
  const result = await (deps.run ?? runHerdrCommand)(deps.bin, ["integration", "status"], {
    env: deps.env,
  });
  const states = result.code === 0 ? parseHerdrIntegrationStatus(result.stdout) : new Map();
  return AGENTS.map((agent): PeerHerdrIntegration => {
    const files = herdrIntegrationFiles(agent, deps.env);
    const hook: HookState | undefined = states.get(agent);
    if (hook === undefined)
      return {
        agent,
        state: "unavailable",
        reason: `herdr could not report its ${LABELS[agent]} integration.`,
        files,
      };
    const blocked = unavailableReason(agent, deps);
    if (hook === "missing")
      return blocked === undefined
        ? { agent, state: "missing", files }
        : { agent, state: "unavailable", reason: blocked, files };
    // Installed, but if it cannot run it is better said, and Remove stays possible.
    return blocked === undefined
      ? { agent, state: hook, files }
      : { agent, state: hook, reason: blocked, files };
  });
}

export type HerdrIntegrationChange =
  | { readonly ok: true; readonly messages: ReadonlyArray<string> }
  | { readonly ok: false; readonly reason: string };

/** First line of what a command said, cut short, for a reason shown to a person. */
function firstLine(text: string): string {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  return line.length > 200 ? `${line.slice(0, 197)}...` : line;
}

/**
 * Installs (or, with `installed: false`, removes) herdr's integration for `agent` by running
 * herdr's own installer. Installing is refused where the integration cannot work.
 */
export async function setHerdrIntegration(
  agent: PeerHerdrIntegrationAgent,
  installed: boolean,
  deps: HerdrIntegrationDeps,
): Promise<HerdrIntegrationChange> {
  if (installed) {
    const blocked = unavailableReason(agent, deps);
    if (blocked !== undefined) return { ok: false, reason: blocked };
  }
  const verb = installed ? "install" : "uninstall";
  const result = await (deps.run ?? runHerdrCommand)(deps.bin, ["integration", verb, agent], {
    env: deps.env,
  });
  if (result.code !== 0)
    return {
      ok: false,
      reason:
        firstLine(result.stderr || result.stdout) ||
        `herdr could not ${verb} its ${LABELS[agent]} integration.`,
    };
  return {
    ok: true,
    messages: result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== ""),
  };
}
