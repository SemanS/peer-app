// @effect-diagnostics nodeBuiltinImport:off globalDate:off - git and jj repositories in a temporary directory, polling a stand-in Hub in real time.
/**
 * What this plugin's tests share: acme's Ordering demo (`app`), a bare origin with Ana's and Bob's
 * colocated jj clones of it, a Peer signed in as Bob to a stand-in Hub that serves the changes
 * feature, and a broker whose checkout is Bob's repository, so Bob's agent's hooks run the plugin.
 * jj keeps repo and workspace config under the user's config directory, so every jj process of a
 * suite (its own and Peer's) runs with a home inside the suite's directory.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterAll, assert, beforeAll, it } from "@effect/vitest";
import {
  ChangeRow,
  ChangesRpcGroup,
  type EnvironmentAuthorizationError,
  type PeerHubError,
  type PeerHubStatus,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as RpcTest from "effect/rpc/RpcTest";

import * as PeerHub from "../../PeerHub.ts";
import { brokerFixture, pluginsOf } from "../../core/broker/testkit.ts";
import type { PeerBrokerHost } from "../../core/broker/host.ts";
import * as PeerAgents from "../../core/coordination/PeerAgents.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerHubEvents from "../../core/hub/PeerHubEvents.ts";
import type { PeerPluginEntry, PeerRpcWrap } from "../../core/plugin.ts";
import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import { resetVcsCaches } from "../../core/vcs.ts";
import {
  coreLayer,
  coreRpcStandIns,
  meAnswer,
  seedState,
  standInHub,
  TEST_ENVIRONMENT,
  type HubAnswer,
  type HubCall,
} from "../../core/testkit.ts";
import { ChangesPlugin } from "./index.ts";

export const ANA = "ana@acme.test";
export const BOB = "bob@acme.test";
export const EVA = "eva@acme.test";
export const NAMES: Readonly<Record<string, string>> = { [ANA]: "Ana", [BOB]: "Bob", [EVA]: "Eva" };
export const ACME = "/v1/workspaces/acme";
export const CHANGES = `${ACME}/changes`;
export const REPORT = `${CHANGES}/app`;
export const WITHDRAW = `${CHANGES}/withdraw`;
export const EVENTS = `${ACME}/events`;

/** Runs a suite's jj with a home of its own, as Bob (Ana's commands say so themselves). */
export function jjHome() {
  const home = NodeFS.realpathSync(NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-chg-")));
  const saved = {
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    PEER_WORKSPACE: process.env.PEER_WORKSPACE,
  };
  beforeAll(() => {
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = NodePath.join(home, ".config");
    process.env.JJ_USER = "Bob";
    process.env.JJ_EMAIL = BOB;
    process.env.PEER_WORKSPACE = NodePath.join(home, "Peer");
  });
  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    delete process.env.JJ_USER;
    delete process.env.JJ_EMAIL;
    resetVcsCaches();
    NodeFS.rmSync(home, { recursive: true, force: true });
  });
  return home;
}

const exec = (command: string, cwd: string, env: NodeJS.ProcessEnv, ...args: Array<string>) =>
  NodeChildProcess.execFileSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    stdio: "pipe",
  });
const AS = {
  ana: { JJ_USER: "Ana", JJ_EMAIL: ANA },
  bob: { JJ_USER: "Bob", JJ_EMAIL: BOB },
} as const;
export const git = (cwd: string, ...args: Array<string>) =>
  exec(
    "git",
    cwd,
    {
      GIT_AUTHOR_NAME: "Ana",
      GIT_AUTHOR_EMAIL: ANA,
      GIT_COMMITTER_NAME: "Ana",
      GIT_COMMITTER_EMAIL: ANA,
    },
    ...args,
  );
/** jj in `cwd` as `who`. */
export const jj = (who: keyof typeof AS, cwd: string, ...args: Array<string>) =>
  exec("jj", cwd, AS[who], ...args);
export const write = (cwd: string, file: string, text: string) =>
  NodeFS.writeFileSync(NodePath.join(cwd, file), text);
export const changeIdOf = (who: keyof typeof AS, cwd: string, revset: string) =>
  jj(who, cwd, "log", "--no-graph", "-r", revset, "-T", "change_id").trim();
export const commitIdOf = (who: keyof typeof AS, cwd: string, revset: string) =>
  jj(who, cwd, "log", "--no-graph", "-r", revset, "-T", "commit_id").trim();

/** A bare origin with main, and colocated jj clones of it: Ana's and Bob's. */
export function team(home: string) {
  const directory = NodeFS.mkdtempSync(NodePath.join(home, "team-"));
  const origin = NodePath.join(directory, "origin.git");
  git(directory, "init", "--quiet", "--bare", "--initial-branch=main", origin);
  const seed = NodePath.join(directory, "seed");
  git(directory, "clone", "--quiet", origin, seed);
  write(seed, "order.js", "export const total = 1;\n");
  git(seed, "add", ".");
  git(seed, "commit", "--quiet", "-m", "start");
  git(seed, "push", "--quiet", "origin", "HEAD:main");
  const clone = (name: string, who: keyof typeof AS) => {
    // Bob's checkout is where the project's repository lives for this Peer (`PEER_WORKSPACE`).
    const path =
      name === "bob"
        ? NodePath.join(directory, "Peer", "acme", "app", "api")
        : NodePath.join(directory, name);
    NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
    git(directory, "clone", "--quiet", origin, path);
    jj(who, path, "git", "init", "--colocate");
    return path;
  };
  process.env.PEER_WORKSPACE = NodePath.join(directory, "Peer");
  return { directory, origin, seed, ana: clone("ana", "ana"), bob: clone("bob", "bob") };
}

/** Ana pushes ORD-11 as a bookmark; Bob fetches it and starts ORD-12 on it. Returns the ids. */
export function bobOnAna(t: ReturnType<typeof team>) {
  jj("ana", t.ana, "new", "main", "-m", "ORD-11: receipt totals in cents");
  write(t.ana, "order.js", "export const total = 100;\n");
  jj("ana", t.ana, "bookmark", "create", "ana-ord-11", "-r", "@");
  jj("ana", t.ana, "git", "push", "-b", "ana-ord-11");
  jj("bob", t.bob, "git", "fetch");
  jj("bob", t.bob, "new", "ana-ord-11@origin", "-m", "ORD-12: loyalty points");
  write(t.bob, "loyalty.js", "export const points = (t) => t / 10;\n");
  // The plugin reads without snapshotting, so the working copy is snapshotted here.
  jj("bob", t.bob, "status");
  return {
    ana: changeIdOf("ana", t.ana, "ana-ord-11"),
    anaCommit: commitIdOf("ana", t.ana, "ana-ord-11"),
    bobChange: changeIdOf("bob", t.bob, "@"),
    bobCommit: commitIdOf("bob", t.bob, "@"),
  };
}

export const hubRow = (over: Partial<ChangeRow> & Pick<ChangeRow, "changeId">): ChangeRow => ({
  project: "app",
  commitId: "a".repeat(40),
  parents: [],
  subject: "ORD-11: receipt totals in cents",
  paths: ["order.js"],
  bookmarks: [],
  conflict: false,
  empty: false,
  divergent: false,
  working: true,
  author: { email: ANA, agent: "claude" },
  versions: [{ commit: "a".repeat(40), at: "2026-10-18T14:31:00.000Z", kind: "edit" }],
  sessions: [{ email: ANA, agent: "claude", environment: "ana-laptop", working: true }],
  lastReportAt: "2026-10-18T14:58:00.000Z",
  ...over,
});

/** `peer-hub.json` of Bob signed in to `hubUrl`, a member of acme's Ordering demo (`app`). */
export const changesSeed = (hubUrl: string, email: string = BOB) =>
  JSON.stringify({
    hubUrl,
    email,
    pendingSignIn: null,
    workspaces: [
      {
        slug: "acme",
        name: "Acme",
        role: "member",
        allowedDomains: [],
        manifest: {
          version: 2,
          workspace: { slug: "acme", name: "Acme", currency: "EUR" },
          member: { email, name: NAMES[email] ?? email, role: "member" },
          knowledge: {},
          projects: [
            {
              id: "app",
              name: "Ordering demo",
              role: "member",
              members: [ANA, BOB, EVA].map((member) => ({ email: member, name: NAMES[member] })),
              repositories: [{ id: "api", url: "https://github.com/acme/api.git", branch: "main" }],
              knowledge: { kontext: false, company: false },
              tools: [],
              capacity: { personal: "any", personalHarnesses: [] },
            },
          ],
        },
        lastSyncAt: null,
      },
    ],
    joinable: [],
    lastSyncAt: null,
    sharedInstances: {},
  });

const COORDINATION: PeerHubStatus["coordination"] = {
  enabled: false,
  policy: "coordinate",
  claudeHooks: false,
  logPath: "/tmp/coordination.jsonl",
  sessions: [],
  overlaps: [],
  findings: [],
  contexts: [],
  candidates: [],
};

/** What a test makes its Hub do: the rows it serves, and the answer to a report. */
export interface HubScript {
  rows: ReadonlyArray<ChangeRow>;
  features: Record<string, number>;
  /** Answers a report or withdrawal; undefined leaves the usual 200. */
  route?: (call: { url: string; body: string }) => ReturnType<HubAnswer> | undefined;
  /** The status the Hub answers a report with while this is set, to play an unreachable Hub. */
  down?: boolean;
}

export const scriptedHub = (script: HubScript, calls: () => ReadonlyArray<HubCall>): HubAnswer => {
  let stored = 0;
  return (url) => {
    const last = calls().at(-1);
    const custom = script.route?.({ url, body: last?.body ?? "" });
    if (custom !== undefined) return custom;
    if (url === "/v1/me") return [200, meAnswer(script.features)];
    if (url === EVENTS) return { events: ":\n\n", open: true };
    if (script.down === true && url.startsWith(CHANGES))
      return [503, { error: { code: "down", message: "down" } }];
    if (url === WITHDRAW) return [200, { withdrawn: 1, at: "2026-10-18T15:00:00.000Z" }];
    if (url === REPORT) {
      stored = Math.max(stored, (JSON.parse(last?.body ?? "{}") as { seq?: number }).seq ?? 0);
      return [200, { seq: stored, at: "2026-10-18T15:00:00.000Z" }];
    }
    if (url === CHANGES || url.startsWith(`${CHANGES}?project=`))
      return [200, { changes: script.rows }];
    return [404, { error: { code: "not_found", message: "Not here." } }];
  };
};

/**
 * Peer signed in as Bob to a Hub that serves `script`, the plugin (or `plugin`) started, and a broker
 * whose checkout is `checkout`, so Bob's agent's hooks run in it.
 */
export const changesPeer = (
  script: HubScript,
  checkout: string,
  plugin: PeerPluginEntry = ChangesPlugin,
  more: (host: PeerBrokerHost) => Partial<PeerBrokerHost> = () => ({}),
) =>
  Effect.gen(function* () {
    let hubCalls: () => ReadonlyArray<HubCall> = () => [];
    const answer = { current: ((url) => scriptedHub(script, () => hubCalls())(url)) as HubAnswer };
    const hub = yield* standInHub(answer);
    hubCalls = () => hub.calls;
    const core = yield* Layer.build(
      coreLayer(yield* seedState(changesSeed(hub.url)), { session: "phs_test", plugins: [plugin] }),
    );
    const peer = yield* Effect.gen(function* () {
      const status = yield* PeerStatus.PeerStatus;
      yield* status.coordinationFrom(() => Effect.succeed(COORDINATION));
      const state = yield* PeerState.PeerState;
      yield* state.updateRuntime((runtime) => ({
        ...runtime,
        work: new Map([
          [
            "acme/app",
            {
              areas: [],
              tasks: [
                {
                  id: "ord-12",
                  key: "ORD-12",
                  title: "Loyalty points",
                  status: "open",
                  createdBy: BOB,
                  createdAt: "2026-10-18T10:00:00.000Z",
                  updatedAt: "2026-10-18T10:00:00.000Z",
                },
              ],
              threads: [],
            },
          ],
        ]),
      }));
      const client = yield* PeerHubClient.PeerHubClient;
      yield* client.me;
      yield* PeerPlugins.startPlugins;
      return {
        status,
        client,
        state,
        agents: yield* PeerAgents.PeerAgents,
        plugins: yield* PeerPlugins.PeerPlugins,
        events: yield* PeerHubEvents.PeerHubEvents,
      };
    }).pipe(Effect.provide(core));
    const fixture = yield* Effect.acquireRelease(
      Effect.gen(function* () {
        const made = yield* Effect.promise(() =>
          brokerFixture((host) => ({
            ...pluginsOf(peer.plugins),
            environment: TEST_ENVIRONMENT,
            email: () => BOB,
            nameOf: (_workspace, who) => NAMES[who] ?? who,
            taskOf: () => "ord-12",
            taskName: (_workspace, _project, id) => (id === "ord-12" ? "ORD-12" : id),
            placeOf: async () => ({ workspace: "acme", project: "app", root: checkout }),
            ...more(host),
          })),
        );
        yield* peer.agents.attach(made.broker);
        return made;
      }),
      (made) => Effect.promise(() => made.dispose()),
    );
    return { hub, peer, fixture, script };
  });

/** The hooks of Bob's agent session `id` in `checkout`, as its harness runs them. */
export const hooks = (
  fixture: Awaited<ReturnType<typeof brokerFixture>>,
  checkout: string,
  id = "bob-1",
  headers: Record<string, string> = {},
) => {
  const body = (event: string, more: Record<string, unknown> = {}) => ({
    hook_event_name: event,
    session_id: id,
    cwd: checkout,
    ...more,
  });
  const added = async (event: string, more: Record<string, unknown> = {}) =>
    ((
      (await fixture.broker["hook"](body(event, more), headers))?.hookSpecificOutput as
        | { readonly additionalContext?: string }
        | undefined
    )?.additionalContext ?? "") as string;
  return {
    start: (source = "startup") => added("SessionStart", { source }),
    step: () => added("PostToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }),
    stop: () => fixture.broker["hook"](body("Stop"), headers),
    end: () => fixture.broker["hook"](body("SessionEnd"), headers),
  };
};

/** The CLI output of `peer changes` for the session `id`. */
export const peerChanges = (fixture: Awaited<ReturnType<typeof brokerFixture>>, id = "bob-1") =>
  fixture.broker["runCli"]("changes", [], { "x-peer-session": `claude:${id}` });

/** Waits (in real time, under `it.live`) until `ready` holds, or fails the test. */
export const eventually = <A>(read: () => A, ready: (value: A) => boolean, ms = 15_000) =>
  Effect.gen(function* () {
    const until = (yield* Clock.currentTimeMillis) + ms;
    let value = read();
    while (!ready(value) && (yield* Clock.currentTimeMillis) < until) {
      yield* Effect.sleep("50 millis");
      value = read();
    }
    assert.isTrue(ready(value), "the condition was not met in time");
    return value;
  });

export interface Put {
  readonly url: string;
  readonly body: Record<string, unknown> & {
    readonly session: string;
    readonly seq: number;
    readonly changes: ReadonlyArray<Record<string, unknown>>;
  };
}
export const puts = (hub: { readonly calls: ReadonlyArray<HubCall> }): ReadonlyArray<Put> =>
  hub.calls
    .filter((call) => call.method === "PUT" && call.url === REPORT)
    .map((call) => ({ url: call.url ?? "", body: JSON.parse(call.body) }));
export const withdrawals = (hub: { readonly calls: ReadonlyArray<HubCall> }) =>
  hub.calls.filter((call) => call.url === WITHDRAW).map((call) => JSON.parse(call.body) as unknown);

export const refusedWith = <A>(
  call: Effect.Effect<A, EnvironmentAuthorizationError | PeerHubError>,
): Effect.Effect<PeerHubError> =>
  call.pipe(
    Effect.result,
    Effect.flatMap((result) =>
      Result.isFailure(result) && result.failure._tag === "PeerHubError"
        ? Effect.succeed(result.failure)
        : Effect.die("the call was not refused by the Hub"),
    ),
  );

const wrap: PeerRpcWrap = { effect: (_, effect) => effect, stream: (_, stream) => stream };

/** A client of the plugin's RPC methods, as the apps call them. */
export const rpcOver = (plugins: PeerPlugins.PeerPlugins["Service"]) =>
  RpcTest.makeClient(ChangesRpcGroup).pipe(
    Effect.provide(
      PeerHub.rpcLayer(wrap).pipe(
        Layer.provide(
          Layer.mergeAll(coreRpcStandIns, Layer.succeed(PeerPlugins.PeerPlugins, plugins)),
        ),
      ),
    ),
  );

const decodeRow = Schema.decodeUnknownSync(ChangeRow);

it("keeps a row the way the Hub's wire contract reads it", () => {
  const decoded = decodeRow(hubRow({ changeId: "l".repeat(32) }));
  assert.strictEqual(decoded.author.agent, "claude");
});

/** Waits until the plugin has read the Hub's changes (its status counts them). */
export const viewLoaded = (peer: { readonly status: PeerStatus.PeerStatus["Service"] }) =>
  Effect.gen(function* () {
    for (let tries = 0; tries < 300; tries += 1) {
      if (((yield* peer.status.publish).changes?.projects.length ?? 0) > 0) return;
      yield* Effect.sleep("50 millis");
    }
    return yield* Effect.die("the Hub's changes were not read");
  });

/** The four changes of the spec's scenario as the Hub lists them: Ana's, Eva's, Slavo's and Bob's. */
export const scenarioRows = (ids: { readonly ana: string; readonly bobChange: string }) => [
  hubRow({ changeId: ids.ana }),
  hubRow({
    changeId: `smptwtuk${"k".repeat(24)}`,
    subject: "ORD-14: totals include VAT",
    author: { email: EVA, agent: "claude" },
  }),
  hubRow({
    changeId: `qpvuntsm${"k".repeat(24)}`,
    subject: "ORD-15: refund reasons",
    paths: ["a.js", "b.js", "c.js"],
    author: { email: "slavo@acme.test", agent: "claude" },
  }),
  hubRow({
    changeId: ids.bobChange,
    parents: [ids.ana],
    subject: "ORD-12: loyalty points",
    task: "ORD-12",
    author: { email: BOB, agent: "codex" },
  }),
];
