// @effect-diagnostics nodeBuiltinImport:off globalDate:off globalDateInEffect:off preferSchemaOverJson:off - real repositories and transcripts on disk, stamped now, on purpose.
/**
 * The boundary, end to end: real transcripts through the real usage engine, real `git remote`, the
 * plugin's service and a stand-in Hub that keeps every request.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { PeerUsageReportBody, ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import * as CursorAccountReader from "@t3tools/provider-cursor/server/CursorAccountReader";
import * as CursorKeychain from "@t3tools/provider-cursor/server/CursorKeychain";
import * as CursorUsageAccounts from "@t3tools/provider-cursor/server/CursorUsageAccounts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ServerSecretStore from "../../../auth/ServerSecretStore.ts";
import * as BackgroundPolicy from "../../../background/BackgroundPolicy.ts";
import * as ServerConfig from "../../../config.ts";
import * as AntigravityUsage from "../../../provider/Drivers/AntigravityUsage.ts";
import * as ProviderHostLive from "../../../provider/ProviderHostLive.ts";
import * as ServerSettings from "../../../serverSettings.ts";
import * as UsageService from "../../../usage/UsageService.ts";
import * as PeerHubClient from "../../core/hub/PeerHubClient.ts";
import * as PeerState from "../../core/state/PeerState.ts";
import { coreLayer, meAnswer, paymentsSeed, seedState, standInHub } from "../../core/testkit.ts";
import { remoteFile, remoteWhenPresent } from "./remoteMemory.ts";
import { createReporter } from "./reporter.ts";
import { PeerUsageService, layer } from "./service.ts";

const SENTINELS = {
  repository: "SENTINEL-repository-path",
  personal: "SENTINEL-personal-path",
  gone: "SENTINEL-deleted-worktree",
  folder: "SENTINEL-transcript-folder",
  branch: "SENTINEL-branch",
  title: "SENTINEL-title",
  prompt: "SENTINEL-prompt",
  reply: "SENTINEL-reply",
  inRepository: "SENTINEL-session-in-repository",
  named: "SENTINEL-session-a-run-names",
  outside: "SENTINEL-session-outside",
  deleted: "SENTINEL-session-deleted-dir",
  twoWorkspaces: "SENTINEL-session-two-workspaces",
  modelPath: "SENTINEL-model-path",
  modelArn: "SENTINEL-model-arn",
};

const SHARED_REMOTE = "https://github.com/both/lib.git";

/** Output tokens that identify each session in a sum. */
const OUTPUT = {
  inRepository: 1,
  named: 10,
  outside: 100,
  deleted: 1000,
  twoWorkspaces: 10000,
};

const git = (cwd: string, ...args: ReadonlyArray<string>) =>
  NodeChildProcess.execFileSync("git", args, { cwd, stdio: "ignore" });

const repository = async (path: string, remote: string) => {
  await NodeFSP.mkdir(path, { recursive: true });
  git(path, "init", "--quiet", "--initial-branch", SENTINELS.branch);
  git(path, "remote", "add", "origin", remote);
};

const decodeBody = Schema.decodeUnknownSync(Schema.fromJsonString(PeerUsageReportBody));

/** A transcript as Claude Code writes one, with everything a report must leave behind. */
const transcript = (
  sessionId: string,
  cwd: string,
  output: number,
  at: string,
  model = "priced-model",
) =>
  [
    { type: "summary", summary: SENTINELS.title, sessionId },
    {
      type: "user",
      sessionId,
      cwd,
      gitBranch: SENTINELS.branch,
      message: { content: SENTINELS.prompt },
    },
    {
      type: "assistant",
      timestamp: at,
      requestId: `req-${sessionId}`,
      sessionId,
      cwd,
      gitBranch: SENTINELS.branch,
      message: {
        id: `msg-${sessionId}`,
        model,
        content: [{ type: "text", text: SENTINELS.reply }],
        usage: { input_tokens: 1, output_tokens: output },
      },
    },
  ]
    .map((line) => JSON.stringify(line))
    .join("\n") + "\n";

/** The engine as the app runs it, over a home of the test's own. */
const engineLayer = (home: string, stateDir: string) =>
  Layer.fresh(CursorUsageAccounts.layer).pipe(
    Layer.provide(CursorAccountReader.layer.pipe(Layer.provide(CursorKeychain.layer))),
    Layer.provideMerge(AntigravityUsage.layer),
    Layer.provideMerge(ProviderHostLive.layer),
    Layer.provideMerge(Layer.mock(BackgroundPolicy.BackgroundPolicy)({})),
    Layer.provideMerge(Layer.mock(ServerSecretStore.ServerSecretStore)({})),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), stateDir)),
    Layer.provideMerge(NodeServices.layer),
    Layer.provideMerge(Layer.succeed(HostProcess.Platform, "linux")),
    Layer.provideMerge(
      ServerSettings.layerTest({
        providerInstances: {
          [ProviderInstanceId.make("claudeAgent")]: {
            driver: ProviderDriverKind.make("claudeAgent"),
            config: { homePath: NodePath.join(home, "claude") },
          },
          [ProviderInstanceId.make("codex")]: {
            driver: ProviderDriverKind.make("codex"),
            config: { homePath: NodePath.join(home, "codex") },
          },
        },
      }),
    ),
    Layer.provideMerge(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.succeed(
            HttpClientResponse.fromWeb(
              request,
              Response.json({
                "priced-model": { input_cost_per_token: 1, output_cost_per_token: 1 },
              }),
            ),
          ),
        ),
      ),
    ),
    Layer.provideMerge(
      Layer.succeed(HostProcess.Environment, {
        HOME: home,
        GROK_HOME: NodePath.join(home, "grok"),
        PI_CODING_AGENT_DIR: NodePath.join(home, "pi"),
        OPENCODE_DATA_DIR: NodePath.join(home, "opencode"),
        ANTIGRAVITY_DATA_DIR: NodePath.join(home, "antigravity"),
        XDG_CONFIG_HOME: NodePath.join(home, "config"),
        APPDATA: NodePath.join(home, "config"),
      }),
    ),
  );

/** Ana in acme and beta, with acme's `pay` on github.com/acme/api and a repository in both. */
const seed = (hubUrl: string, runSessions: ReadonlyArray<string>) => {
  const state = JSON.parse(paymentsSeed(hubUrl));
  const [acme] = state.workspaces;
  const project = acme.manifest.projects[0];
  const both = {
    ...project,
    id: "lib",
    repositories: [{ ...project.repositories[0], id: "lib", url: SHARED_REMOTE }],
  };
  acme.manifest.projects.push(both);
  state.workspaces.push({
    ...acme,
    slug: "beta",
    name: "Beta",
    manifest: {
      ...acme.manifest,
      workspace: { ...acme.manifest.workspace, slug: "beta", name: "Beta" },
      projects: [both],
    },
  });
  state.runs.run_named = {
    ...Object.values<Record<string, unknown>>(state.runs)[0],
    id: "run_named",
    local: false,
    sessions: runSessions.map((id) => ({ id, from: "2026-10-01T09:00:00.000Z" })),
  };
  return JSON.stringify(state);
};

interface Stage {
  readonly sessions: ReadonlyArray<{
    readonly id: string;
    readonly cwd: string;
    readonly output: number;
    readonly model?: string;
  }>;
  /** Transcripts of these sessions cannot be read. */
  readonly unreadable?: ReadonlyArray<string>;
  /** Deleted after this report, for a second one by a new reporter. */
  readonly thenDelete?: keyof Paths;
  readonly runSessions?: ReadonlyArray<string>;
}

type Paths = Record<"repository" | "personal" | "lib" | "gone", string>;

const reportOf = ({ sessions, unreadable = [], thenDelete, runSessions = [] }: Stage) =>
  Effect.gen(function* () {
    const home = yield* Effect.acquireRelease(
      Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "usage-privacy-"))),
      (path) => Effect.promise(() => NodeFSP.rm(path, { recursive: true, force: true })),
    );
    const paths: Paths = {
      repository: NodePath.join(home, SENTINELS.repository),
      personal: NodePath.join(home, SENTINELS.personal),
      lib: NodePath.join(home, "lib"),
      gone: NodePath.join(home, SENTINELS.gone),
    };
    const at = new Date().toISOString();
    yield* Effect.promise(async () => {
      await repository(paths.repository, "git@github.com:acme/api.git");
      await repository(paths.personal, "https://github.com/ana/notes.git");
      await repository(paths.lib, SHARED_REMOTE);
      const folder = NodePath.join(home, "claude", "projects", SENTINELS.folder);
      await NodeFSP.mkdir(folder, { recursive: true });
      for (const { id, cwd, output, model } of sessions)
        await NodeFSP.writeFile(
          NodePath.join(folder, `${id}.jsonl`),
          transcript(id, paths[cwd as keyof typeof paths] ?? cwd, output, at, model),
        );
      for (const id of unreadable) await NodeFSP.chmod(NodePath.join(folder, `${id}.jsonl`), 0);
    });

    const hub = yield* standInHub({
      current: (url, method) =>
        url === "/v1/me"
          ? [200, meAnswer({ usage: 1 })]
          : url.endsWith("/usage/sharing") && method === "GET"
            ? [200, { sharing: true, at: "2026-10-01T00:00:00Z" }]
            : [200, { stored: true }],
    });
    const base = yield* seedState(seed(hub.url, runSessions));
    const core = yield* Layer.build(coreLayer(base, { session: "s" }));
    const engine = yield* UsageService.make.pipe(
      Effect.provide(engineLayer(home, NodePath.join(home, "state"))),
    );
    const client = yield* PeerHubClient.PeerHubClient.pipe(Effect.provide(core));
    const state = yield* PeerState.PeerState.pipe(Effect.provide(core));
    const usage = yield* PeerUsageService.pipe(Effect.provide(layer), Effect.provide(core));
    yield* client.me;
    const remotesPath = NodePath.join(home, "memory", "remotes.json");
    const reporterNow = () =>
      createReporter({
        state,
        features: client.features,
        usage,
        read: engine.readSessionTotals,
        remoteOf: remoteWhenPresent(PeerState.remoteOf),
        remotesFile: remoteFile(remotesPath),
        now: () => Date.now(),
      });
    yield* reporterNow().pass;
    if (thenDelete !== undefined) {
      yield* Effect.promise(() => NodeFSP.rm(paths[thenDelete], { recursive: true }));
      yield* reporterNow().pass;
    }
    return {
      calls: hub.calls,
      reports: hub.calls.filter((call) => call.url?.includes("/usage/reports/")),
      remotesPath,
      paths,
    };
  });

const everyText = (
  calls: ReadonlyArray<{ readonly url: string | undefined; readonly body: string }>,
) => calls.flatMap((call) => [call.url ?? "", call.body]);

describe("what leaves the computer", () => {
  it.live("is a rollup of a workspace's sessions, without one of their paths, ids or titles", () =>
    Effect.gen(function* () {
      const { calls, reports } = yield* reportOf({
        sessions: [
          { id: SENTINELS.inRepository, cwd: "repository", output: OUTPUT.inRepository },
          { id: SENTINELS.named, cwd: "gone", output: OUTPUT.named },
          { id: SENTINELS.outside, cwd: "personal", output: OUTPUT.outside },
          { id: SENTINELS.deleted, cwd: "gone", output: OUTPUT.deleted },
          { id: SENTINELS.twoWorkspaces, cwd: "lib", output: OUTPUT.twoWorkspaces },
        ],
        runSessions: [`claude:${SENTINELS.named}`],
      });

      assert.lengthOf(reports, 1);
      assert.match(reports[0]?.url ?? "", /^\/v1\/workspaces\/acme\/usage\/reports\/pay\//);
      const body = decodeBody(reports[0]?.body ?? "");
      assert.deepStrictEqual(Object.keys(JSON.parse(reports[0]?.body ?? "")).toSorted(), [
        "environment",
        "rev",
        "rows",
      ]);
      assert.lengthOf(body.rows, 1);
      // The two sessions the rule lets through, and no token of the three it does not.
      assert.strictEqual(body.rows[0]?.output, OUTPUT.inRepository + OUTPUT.named);
      assert.strictEqual(body.rows[0]?.sessions, 2);
      assert.strictEqual(body.rows[0]?.usd, 2 + OUTPUT.inRepository + OUTPUT.named);
      assert.strictEqual(body.rows[0]?.capacity, "personal");

      for (const text of everyText(calls))
        for (const sentinel of Object.values(SENTINELS)) assert.notInclude(text, sentinel);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("names no model that is a path or an ARN", () =>
    Effect.gen(function* () {
      const { calls, reports } = yield* reportOf({
        sessions: [
          {
            id: "local",
            cwd: "repository",
            output: 3,
            model: `/Users/ana/${SENTINELS.modelPath}/llama.gguf`,
          },
          {
            id: "cloud",
            cwd: "repository",
            output: 4,
            model: `arn:aws:bedrock:eu-west-1:123456789012:${SENTINELS.modelArn}/x`,
          },
        ],
      });
      assert.lengthOf(reports, 1);
      const { rows } = decodeBody(reports[0]?.body ?? "");
      assert.deepStrictEqual(
        rows.map(({ model, output, sessions }) => ({ model, output, sessions })),
        [{ model: "other", output: 7, sessions: 2 }],
      );
      for (const text of everyText(calls))
        for (const sentinel of [SENTINELS.modelPath, SENTINELS.modelArn])
          assert.notInclude(text, sentinel);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("still goes out when one transcript cannot be read, without that transcript", () =>
    Effect.gen(function* () {
      const { reports } = yield* reportOf({
        sessions: [
          { id: "readable", cwd: "repository", output: 3 },
          { id: "unreadable", cwd: "repository", output: 4 },
        ],
        unreadable: ["unreadable"],
      });
      assert.lengthOf(reports, 1);
      assert.strictEqual(decodeBody(reports[0]?.body ?? "").rows[0]?.output, 3);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("never holds what the computer keeps of its directories, which stays private", () =>
    Effect.gen(function* () {
      const { calls, reports, remotesPath, paths } = yield* reportOf({
        sessions: [{ id: "one", cwd: "repository", output: 3 }],
      });
      assert.lengthOf(reports, 1);
      const kept = yield* Effect.promise(() => NodeFSP.readFile(remotesPath, "utf8"));
      const stat = yield* Effect.promise(() => NodeFSP.stat(remotesPath));
      assert.strictEqual(stat.mode & 0o777, 0o600);
      const entries = Object.entries<string>(JSON.parse(kept));
      assert.lengthOf(entries, 1);
      assert.include(entries[0]?.[0], SENTINELS.repository);
      for (const text of everyText(calls)) {
        assert.notInclude(text, paths.repository);
        assert.notInclude(text, entries[0]?.[1] ?? "unset");
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("keeps a deleted worktree's session in its day, after a restart too", () =>
    Effect.gen(function* () {
      const { calls, reports } = yield* reportOf({
        sessions: [{ id: "one", cwd: "repository", output: 3 }],
        thenDelete: "repository",
      });
      // The second reporter remembers nothing it sent, so it sends the same rows again.
      assert.lengthOf(reports, 2);
      assert.deepStrictEqual(
        decodeBody(reports[1]?.body ?? "").rows,
        decodeBody(reports[0]?.body ?? "").rows,
      );
      for (const text of everyText(calls)) assert.notInclude(text, SENTINELS.repository);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.live("is nothing at all for sessions outside every workspace", () =>
    Effect.gen(function* () {
      const { calls, reports } = yield* reportOf({
        sessions: [
          { id: SENTINELS.outside, cwd: "personal", output: OUTPUT.outside },
          { id: SENTINELS.deleted, cwd: "gone", output: OUTPUT.deleted },
          { id: SENTINELS.twoWorkspaces, cwd: "lib", output: OUTPUT.twoWorkspaces },
        ],
      });
      assert.deepStrictEqual(reports, []);
      // Only the sharing questions and sign-in: nothing of a session, in any request.
      assert.deepStrictEqual(
        calls.filter((call) => call.method !== "GET"),
        [],
      );
      for (const text of everyText(calls))
        for (const sentinel of Object.values(SENTINELS)) assert.notInclude(text, sentinel);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
