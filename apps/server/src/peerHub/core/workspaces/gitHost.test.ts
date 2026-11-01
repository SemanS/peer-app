// @effect-diagnostics nodeBuiltinImport:off - checkouts cloned into a temporary directory, read with git.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";

import { bareRepository } from "../testkit.ts";
import { cloneRepository } from "./checkouts.ts";
import { activeGitHubAccount, explainGitHubCloneFailure, GitHubCli, gitWay } from "./gitHost.ts";

afterEach(() => vi.unstubAllEnvs());

/** What `gh auth status --json hosts` prints while Ana is signed in to github.com. */
const SIGNED_IN = JSON.stringify({
  hosts: {
    "github.com": [{ state: "success", active: true, host: "github.com", login: "ana" }],
  },
});
const signedIn = { find: Effect.succeed("/opt/fake/gh"), run: async () => SIGNED_IN };
const noCli = { find: Effect.succeed(null), run: async () => "" };

/** The credential helpers a checkout's own git config gives github.com. */
const credentialHelpers = (checkout: string) =>
  NodeChildProcess.spawnSync(
    "git",
    ["-C", checkout, "config", "--local", "--get-all", "credential.https://github.com.helper"],
    { encoding: "utf8" },
  ).stdout;

describe("cloning from github.com", () => {
  it.effect("signs in with GitHub CLI's account, in the clone and in the checkout", () =>
    Effect.gen(function* () {
      const { dir, origin } = yield* bareRepository;
      // git takes acme's repository on github.com from the local origin, however it signs in.
      vi.stubEnv("GIT_CONFIG_COUNT", "1");
      vi.stubEnv("GIT_CONFIG_KEY_0", `url.${origin}.insteadOf`);
      vi.stubEnv("GIT_CONFIG_VALUE_0", "https://github.com/acme/api.git");
      const repo = { url: "git@github.com:acme/api.git", branch: "main" };

      const checkout = NodePath.join(dir, "with-gh");
      yield* cloneRepository(repo, checkout).pipe(Effect.provideService(GitHubCli, signedIn));
      assert.include(credentialHelpers(checkout), "'/opt/fake/gh' auth git-credential");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("leaves git its own way without GitHub CLI, and elsewhere", () =>
    Effect.gen(function* () {
      const github = yield* gitWay("https://github.com/acme/api.git").pipe(
        Effect.provideService(GitHubCli, noCli),
      );
      assert.deepStrictEqual(github.args, []);
      assert.strictEqual(github.url, "https://github.com/acme/api.git");
      const elsewhere = yield* gitWay("https://git.example.test/acme/api.git").pipe(
        Effect.provideService(GitHubCli, signedIn),
      );
      assert.deepStrictEqual(elsewhere.args, []);
    }),
  );
});

describe("activeGitHubAccount", () => {
  it("takes the active signed-in account, as git's credential helper does", () => {
    const status = JSON.stringify({
      hosts: {
        "github.com": [
          { state: "success", active: false, host: "github.com", login: "maruska-lab" },
          { state: "success", active: true, host: "github.com", login: "SemanS" },
        ],
      },
    });
    assert.strictEqual(activeGitHubAccount(status), "SemanS");
    assert.isNull(activeGitHubAccount(JSON.stringify({ hosts: {} })));
    const expired = status.replace(
      '"state":"success","active":true',
      '"state":"error","active":true',
    );
    assert.isNull(activeGitHubAccount(expired));
  });
});

describe("explainGitHubCloneFailure", () => {
  const target = {
    url: "https://github.com/acme/app",
    branch: "main",
    nameWithOwner: "acme/app",
    account: "ana-dev",
    cli: true,
  };
  const notFound =
    "remote: Repository not found.\nfatal: repository 'https://github.com/acme/app.git/' not found";

  it("names the GitHub account that may not open a private repository", () => {
    assert.include(
      explainGitHubCloneFailure(notFound, target),
      "GitHub account ana-dev cannot open acme/app",
    );
  });

  it("asks to sign GitHub CLI in, or to install it first", () => {
    const prompt =
      "fatal: could not read Username for 'https://github.com': terminal prompts disabled";
    assert.include(
      explainGitHubCloneFailure(prompt, { ...target, account: null }),
      "gh auth login",
    );
    assert.include(
      explainGitHubCloneFailure(prompt, { ...target, account: null, cli: false }),
      "brew install gh",
    );
  });

  it("explains other failures as any clone", () => {
    assert.include(
      explainGitHubCloneFailure("fatal: Remote branch krk-812 not found in upstream origin", {
        ...target,
        branch: "krk-812",
      }),
      'no branch "krk-812"',
    );
  });
});
