// @effect-diagnostics nodeBuiltinImport:off - checkouts cloned into a temporary directory, read with git.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, describe, it } from "@effect/vitest";
import type { PeerGitHubState, PeerHubStatus } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { vi } from "vite-plus/test";

import * as PeerPlugins from "../../core/plugins/PeerPlugins.ts";
import * as PeerStatus from "../../core/status/PeerStatus.ts";
import {
  bareRepository,
  coreLayer,
  paymentsSeed,
  paymentsT3,
  seedState,
  standInHub,
} from "../../core/testkit.ts";
import * as PeerWork from "../../core/work/PeerWork.ts";
import * as PeerWorkspaces from "../../core/workspaces/PeerWorkspaces.ts";
import { GitHubCli, type GitHubCliShape } from "./client/gh.ts";
import { GitHubPlugin } from "./index.ts";

afterEach(() => vi.unstubAllEnvs());

const coordination: PeerHubStatus["coordination"] = {
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

/** What `gh auth status --json hosts` prints while Ana is signed in to github.com. */
const SIGNED_IN = `{"hosts":{"github.com":[{"state":"success","active":true,"host":"github.com","login":"ana"}]}}`;

/** GitHub CLI signed in as Ana; every other command it runs goes to `asked`. */
const anaGitHubCli = (asked: Queue.Queue<ReadonlyArray<string>>): GitHubCliShape => ({
  find: Effect.succeed("/opt/fake/gh"),
  run: async (_gh, args) => {
    if (args[0] === "auth") return SIGNED_IN;
    Queue.offerUnsafe(asked, args);
    return "[]";
  },
  signIn: () => Promise.reject(new Error("No sign-in in tests.")),
});

/**
 * Ana's Peer in acme's Payments project, whose repository is https://github.com/acme/api.git, with
 * the GitHub plugin started over `cli`. Her checkouts go under `root`.
 */
const anaWithGitHub = (cli: GitHubCliShape, root?: string) =>
  Effect.gen(function* () {
    if (root !== undefined) vi.stubEnv("PEER_WORKSPACE", root);
    const hub = yield* standInHub({
      current: (url) => (url === "/v1/workspaces/acme/work" ? [200, { projects: {} }] : [200, {}]),
    });
    const core = yield* Layer.build(
      coreLayer(yield* seedState(paymentsSeed(hub.url)), {
        session: "phs_test",
        plugins: [GitHubPlugin],
        t3: paymentsT3,
      }),
    );
    return yield* Effect.gen(function* () {
      const status = yield* PeerStatus.PeerStatus;
      yield* status.setFacadeParts(() => Effect.succeed({ coordination }));
      yield* PeerPlugins.startPlugins.pipe(Effect.provideService(GitHubCli, cli));
      return {
        status,
        plugins: yield* PeerPlugins.PeerPlugins,
        work: yield* PeerWork.PeerWork,
        workspaces: yield* PeerWorkspaces.PeerWorkspaces,
      };
    }).pipe(Effect.provide(core));
  });

/** The first status, now or later, whose GitHub part satisfies `seen`. */
const gitHubWhen = (
  status: PeerStatus.PeerStatus["Service"],
  seen: (github: PeerGitHubState) => boolean,
) =>
  status.changes.pipe(
    Stream.map((next) => next.github),
    Stream.filter(seen),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

/** The credential helpers a checkout's own git config gives github.com. */
const credentialHelpers = (checkout: string) =>
  NodeChildProcess.spawnSync(
    "git",
    ["-C", checkout, "config", "--local", "--get-all", "credential.https://github.com.helper"],
    { encoding: "utf8" },
  ).stdout;

describe("GitHub", () => {
  it.effect("clones with GitHub CLI's account while on, and with plain git while off", () =>
    Effect.gen(function* () {
      const { dir, origin } = yield* bareRepository;
      // git takes acme's repository on github.com from the local origin, however it signs in.
      vi.stubEnv("GIT_CONFIG_COUNT", "1");
      vi.stubEnv("GIT_CONFIG_KEY_0", `url.${origin}.insteadOf`);
      vi.stubEnv("GIT_CONFIG_VALUE_0", "https://github.com/acme/api.git");
      const root = NodePath.join(dir, "Peer");
      const asked = yield* Queue.unbounded<ReadonlyArray<string>>();
      const { plugins, workspaces } = yield* anaWithGitHub(anaGitHubCli(asked), root);
      const checkout = NodePath.join(root, "acme", "pay", "api");

      yield* workspaces.openProject({ workspace: "acme", projectId: "pay" });
      assert.isTrue(NodeFS.existsSync(NodePath.join(checkout, "README.md")));
      assert.include(credentialHelpers(checkout), "'/opt/fake/gh' auth git-credential");

      NodeFS.rmSync(checkout, { recursive: true, force: true });
      yield* plugins.setPlugin({ id: "github", enabled: false });
      yield* workspaces.openProject({ workspace: "acme", projectId: "pay" });
      assert.isTrue(NodeFS.existsSync(NodePath.join(checkout, "README.md")));
      assert.strictEqual(credentialHelpers(checkout), "");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("shows GitHub CLI's account while on, and GitHub not connected while off", () =>
    Effect.gen(function* () {
      const asked = yield* Queue.unbounded<ReadonlyArray<string>>();
      const { status, plugins } = yield* anaWithGitHub(anaGitHubCli(asked));
      assert.deepStrictEqual(yield* gitHubWhen(status, (github) => github.account !== null), {
        cli: true,
        account: "ana",
        signIn: null,
        error: null,
      });

      yield* plugins.setPlugin({ id: "github", enabled: false });
      assert.deepStrictEqual((yield* status.publish).github, {
        cli: false,
        account: null,
        signIn: null,
        error: null,
      });
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("looks up no pull request while off, and a work's own once on", () =>
    Effect.gen(function* () {
      const asked = yield* Queue.unbounded<ReadonlyArray<string>>();
      const { status, plugins, work } = yield* anaWithGitHub(anaGitHubCli(asked));
      yield* gitHubWhen(status, (github) => github.account !== null);

      yield* plugins.setPlugin({ id: "github", enabled: false });
      yield* work.refresh();
      assert.strictEqual(yield* Queue.size(asked), 0);

      yield* plugins.setPlugin({ id: "github", enabled: true });
      yield* gitHubWhen(status, (github) => github.account !== null);
      yield* work.refresh();
      // Ana's thread-1 works on feat/split in acme/api.
      const lookup = yield* Queue.take(asked);
      assert.deepStrictEqual(lookup.slice(0, 6), [
        "pr",
        "list",
        "--repo",
        "acme/api",
        "--head",
        "feat/split",
      ]);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
