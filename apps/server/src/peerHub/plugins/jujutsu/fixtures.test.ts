// @effect-diagnostics nodeBuiltinImport:off - real jj and git in a temporary directory, with a home of their own.
/**
 * What this plugin's tests share: a home inside the suite's directory (jj 0.46 keeps repository and
 * workspace configuration under the user's config directory, so every jj process runs with it), a
 * colocated repository with workspaces, Bob signed in to a Peer core, and agent sessions in the
 * workspaces. It holds the module's one test of its own, that the home is kept, because a file that
 * is not a test counts against the plugin's line budget.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterAll, assert, beforeAll, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { layer as vcsLayer } from "../../../vcs/VcsProcess.ts";
import type { PeerSessionView, PeerToolContext } from "../../core/plugin.ts";
import { resetVcsCaches } from "../../core/vcs.ts";
import { PeerAgents } from "../../core/coordination/PeerAgents.ts";
import { PeerState } from "../../core/state/PeerState.ts";
import { coreLayer, paymentsSeed, seedState } from "../../core/testkit.ts";
import { makeJujutsu } from "./Jujutsu.ts";

const home = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-jj-")));
const KEYS = ["HOME", "XDG_CONFIG_HOME", "JJ_USER", "JJ_EMAIL"] as const;
const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));

/** Gives every jj and git process of the calling suite a home of its own; call it at the top of a test file. */
export function isolatedHome() {
  beforeAll(() => {
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = NodePath.join(home, ".config");
    delete process.env.JJ_USER;
    delete process.env.JJ_EMAIL;
  });
  afterAll(() => {
    for (const key of KEYS) {
      const value = saved[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    resetVcsCaches();
    NodeFS.rmSync(home, { recursive: true, force: true });
  });
  return home;
}

export const exec = (command: string, cwd: string, ...args: Array<string>) =>
  NodeChildProcess.execFileSync(command, args, {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null" },
    encoding: "utf8",
    stdio: "pipe",
  });
export const jj = (cwd: string, ...args: Array<string>) => exec("jj", cwd, ...args);

/** A colocated jj repository with one commit, `main`, and a person configured for jj. */
export function repository(options: { readonly person?: boolean } = {}) {
  if (options.person !== false) {
    jj(home, "config", "set", "--user", "user.name", "Test Person");
    jj(home, "config", "set", "--user", "user.email", "person@home.test");
  }
  const dir = NodeFS.mkdtempSync(NodePath.join(home, "repo-"));
  const main = NodePath.join(dir, "main");
  NodeFS.mkdirSync(main);
  exec("git", main, "init", "--quiet", "--initial-branch=main");
  NodeFS.writeFileSync(NodePath.join(main, "order.js"), "export const total = 1;\n");
  exec("git", main, "-c", "user.name=T", "-c", "user.email=t@t.test", "add", ".");
  exec(
    "git",
    main,
    "-c",
    "user.name=T",
    "-c",
    "user.email=t@t.test",
    "commit",
    "--quiet",
    "-m",
    "start",
  );
  jj(main, "git", "init", "--colocate");
  return {
    dir,
    main,
    /** A second workspace on a new change above `main`, as herdr makes one. */
    workspace: (name: string, rev = "main") => {
      const path = NodePath.join(dir, name);
      jj(main, "workspace", "add", "--name", name, "-r", rev, path);
      return path;
    },
  };
}

/** Bob's Peer core with the plugin's service, over a clean state. */
export const bobsJujutsu = (options: { readonly debounceMs?: number } = {}) =>
  Effect.gen(function* () {
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed("https://hub.invalid"))),
    );
    const state = Context.get(core, PeerState);
    yield* state.updatePersisted((persisted) => ({ ...persisted, email: "bob@acme.test" }));
    const logs: Array<{
      readonly event: string;
      readonly fields: Readonly<Record<string, unknown>>;
    }> = [];
    const agents = Context.get(core, PeerAgents);
    const service = yield* makeJujutsu({ debounceMs: options.debounceMs ?? 0 }).pipe(
      Effect.provideService(PeerAgents, {
        ...agents,
        log: (event, fields) => Effect.sync(() => void logs.push({ event, fields })),
      }),
      Effect.provide(vcsLayer.pipe(Layer.provide(NodeServices.layer))),
      Effect.provide(core),
    );
    return { core, state, service, logs };
  });

/** An agent session whose cwd is `cwd`, with the per-session memory core keeps for it. */
export function sessionIn(
  cwd: string,
  options: { readonly id?: string; readonly agent?: string; readonly task?: string } = {},
): PeerSessionView {
  const locals = new Map<string, unknown>();
  const told = new Map<string, Set<string>>();
  return {
    id: options.id ?? "codex:one",
    agent: options.agent ?? "codex",
    adapter: "hooks",
    runtimeGeneration: "g1",
    workspace: "acme",
    project: "pay",
    repositoryId: "api",
    root: cwd,
    cwd,
    task: options.task ?? "krk-1",
    thread: undefined,
    pane: undefined,
    status: "working",
    keeps: false,
    files: [],
    claims: [],
    local: <S>(plugin: string, init: () => S) => {
      if (!locals.has(plugin)) locals.set(plugin, init());
      return locals.get(plugin) as S;
    },
    told: (plugin) => {
      const known = told.get(plugin) ?? new Set<string>();
      told.set(plugin, known);
      return known;
    },
  };
}

/** The context of a tool step the session just finished. */
export const stepOf = (
  session: PeerSessionView,
  options: { readonly command?: string; readonly remainingMs?: number } = {},
): PeerToolContext => ({
  session,
  event: "post-tool",
  tool: options.command === undefined ? "Write" : "Bash",
  paths: [],
  remainingMs: options.remainingMs ?? 5_000,
  ...(options.command === undefined ? {} : { command: options.command }),
});

/** Lists a workspace's own jj configuration as `key = value` lines. */
export const workspaceConfig = (cwd: string) => jj(cwd, "config", "list", "--workspace");

it("gives jj a home of its own", () => {
  assert.isTrue(home.startsWith(NodeFS.realpathSync(NodeOS.tmpdir())));
});
