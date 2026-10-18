// @effect-diagnostics nodeBuiltinImport:off - real git and jj repositories in a private temporary directory.
/**
 * Real repositories for the forecast's Jujutsu suites: a bare origin, a person's colocated clone,
 * agent workspaces, and the forecast service on top. jj 0.46 keeps repo and workspace config under
 * the user's config directory, so every process of a suite runs with a home inside its directory.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Effect from "effect/Effect";
import * as Context from "effect/Context";
import * as Layer from "effect/Layer";
import { PeerState } from "../../../core/state/PeerState.ts";
import { coreLayer, paymentsSeed, seedState } from "../../../core/testkit.ts";
import * as VcsProcess from "../../../../vcs/VcsProcess.ts";
import { makeForecast } from "../ForecastService.ts";
import { createJj } from "./jj.ts";
import { createGit } from "./git.ts";

export const jjAvailable = (() => {
  try {
    return NodeChildProcess.spawnSync("jj", ["--version"]).status === 0;
  } catch {
    return false;
  }
})();

const saved: Record<string, string | undefined> = {};
const KEYS = ["HOME", "XDG_CONFIG_HOME", "JJ_USER", "JJ_EMAIL", "JJ_TIMESTAMP"] as const;
/** A home for jj inside the suite's directory; `restore` puts the environment back and deletes it. */
export function useHome() {
  const home = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-fc-")));
  for (const key of KEYS) saved[key] = process.env[key];
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = NodePath.join(home, ".config");
  process.env.JJ_USER = "Slavo";
  process.env.JJ_EMAIL = "slavo@acme.test";
  delete process.env.JJ_TIMESTAMP;
  return {
    home,
    restore: () => {
      for (const key of KEYS)
        if (saved[key] === undefined) delete process.env[key];
        else process.env[key] = saved[key];
      NodeFS.rmSync(home, { recursive: true, force: true });
    },
  };
}

const exec = (command: string, cwd: string, args: ReadonlyArray<string>, env = {}) =>
  NodeChildProcess.execFileSync(command, [...args], {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Ana",
      GIT_AUTHOR_EMAIL: "ana@acme.test",
      GIT_COMMITTER_NAME: "Ana",
      GIT_COMMITTER_EMAIL: "ana@acme.test",
      ...env,
    },
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
export const git = (cwd: string, ...args: string[]) => exec("git", cwd, args);
export const jj = (cwd: string, ...args: string[]) => exec("jj", cwd, args);
/** jj as another person, at a given time: a change's start is its author time. */
export const jjAs = (cwd: string, who: string, at: string, ...args: string[]) =>
  exec("jj", cwd, args, {
    JJ_USER: who,
    JJ_EMAIL: `${who.toLowerCase()}@acme.test`,
    JJ_TIMESTAMP: at,
  });
export const write = (cwd: string, file: string, text: string) =>
  NodeFS.writeFileSync(NodePath.join(cwd, file), text);

/** Visible changes, bookmarks and workspaces: what no check or read may change. */
export const surface = (cwd: string) => ({
  bookmarks: jj(cwd, "--ignore-working-copy", "bookmark", "list", "--all"),
  changes: jj(
    cwd,
    "--ignore-working-copy",
    "log",
    "--no-graph",
    "-r",
    "all()",
    "-T",
    'commit_id ++ "\\n"',
  ),
  workspaces: jj(cwd, "--ignore-working-copy", "workspace", "list"),
});

export const ORDER = `const rate = 1;\nexport const orderTotal = (price) => {\n  return price * rate;\n};\nexport default orderTotal;\n`;

/** A bare origin with main, and a colocated jj clone of it (`slavo`), the person's own checkout. */
export function team(
  home: string,
  files: Readonly<Record<string, string>> = { "order.js": ORDER },
) {
  const dir = NodeFS.mkdtempSync(NodePath.join(home, "team-"));
  const origin = NodePath.join(dir, "origin.git");
  git(dir, "init", "--quiet", "--bare", "--initial-branch=main", origin);
  const seed = NodePath.join(dir, "seed");
  git(dir, "clone", "--quiet", origin, seed);
  for (const [name, text] of Object.entries(files)) write(seed, name, text);
  git(seed, "add", ".");
  git(seed, "commit", "--quiet", "-m", "start");
  git(seed, "push", "--quiet", "origin", "HEAD:main");
  const clone = (name: string) => {
    const path = NodePath.join(dir, name);
    git(dir, "clone", "--quiet", origin, path);
    jj(path, "git", "init", "--colocate");
    return path;
  };
  /** An agent's workspace: named like its bookmark, as Peer's task checkouts are. */
  const agent = (checkout: string, name: string) => {
    const path = NodePath.join(dir, "trees", name);
    NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
    jj(checkout, "workspace", "add", "--colocate", "--name", name, "-r", "main", path);
    jj(path, "bookmark", "create", `feature/${name}`, "-r", "@");
    return path;
  };
  return { dir, origin, clone, agent, slavo: clone("slavo") };
}

export type Thread = {
  branch: string;
  email?: string;
  task?: string;
  harness?: string;
};

/** The forecast service on a real checkout, with the given threads of this computer and of teammates. */
export const serviceFor = (
  checkout: string,
  threads: { local: ReadonlyArray<Thread>; remote?: ReadonlyArray<Thread> },
  options: { checkMs?: number } = {},
) =>
  Effect.gen(function* () {
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed("https://hub.invalid"))),
    );
    const state = Context.get(core, PeerState);
    yield* state.updatePersisted((p) => ({ ...p, localCheckouts: { "acme/pay/api": checkout } }));
    const row = (thread: Thread) => ({
      id: thread.branch,
      repository: "api",
      branch: thread.branch,
      title: thread.branch,
      status: "working" as const,
      source: "peer" as const,
      ...(thread.task === undefined ? {} : { task: thread.task }),
      ...(thread.harness === undefined ? {} : { harness: thread.harness }),
    });
    const setThreads = (next: typeof threads) =>
      state.updateRuntime((s) => ({
        ...s,
        localThreads: new Map([
          ["acme", next.local.map((thread) => ({ ...row(thread), project: "pay" }))],
        ]),
        work: new Map([
          [
            "acme/pay",
            {
              areas: [],
              tasks: [],
              threads: (next.remote ?? []).map((thread) => ({
                ...row(thread),
                email: thread.email ?? "eva@acme.test",
                environment: "eva-mac",
                seenAt: "2026-10-18T12:00:00Z",
              })),
            },
          ],
        ]),
      }));
    yield* setThreads(threads);
    const real = yield* VcsProcess.VcsProcess,
      calls: VcsProcess.VcsProcessInput[] = [];
    const vcs = VcsProcess.VcsProcess.of({
      run: (input) => {
        calls.push(input);
        return real.run(input);
      },
    });
    const gitClient = createGit(vcs, NodePath.join(state.hubHome, "coord", "forecast")),
      logged: Array<{ event: string; fields: Readonly<Record<string, unknown>> }> = [];
    const forecast = yield* makeForecast(
      state,
      gitClient,
      (event, fields) => Effect.sync(() => void logged.push({ event, fields })),
      false,
      createJj(vcs, gitClient),
      options.checkMs,
    );
    return { forecast, state, calls, logged, setThreads, git: gitClient };
  });
