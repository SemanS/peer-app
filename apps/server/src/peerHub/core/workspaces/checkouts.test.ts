// @effect-diagnostics nodeBuiltinImport:off - a temporary origin and clone.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { localRepository } from "./checkouts.ts";

it.effect("shares a checkout with a detached HEAD on the remote's own default branch", () =>
  Effect.gen(function* () {
    const dir = NodeFS.realpathSync(
      NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "peer-share-")),
    );
    const git = (cwd: string, ...args: string[]) =>
      NodeChildProcess.execFileSync("git", args, {
        cwd,
        stdio: "ignore",
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: "Ana",
          GIT_AUTHOR_EMAIL: "ana@acme.test",
          GIT_COMMITTER_NAME: "Ana",
          GIT_COMMITTER_EMAIL: "ana@acme.test",
        },
      });
    const origin = NodePath.join(dir, "origin.git");
    const seed = NodePath.join(dir, "seed");
    const clone = NodePath.join(dir, "pay");
    git(dir, "init", "-q", "--bare", "-b", "trunk", origin);
    git(dir, "init", "-q", "-b", "trunk", seed);
    git(seed, "commit", "-q", "--allow-empty", "-m", "init");
    git(seed, "push", "-q", origin, "trunk");
    git(dir, "clone", "-q", origin, clone);
    // As under jj: no origin/HEAD, and HEAD detached.
    git(clone, "remote", "set-head", "origin", "-d");
    git(clone, "checkout", "-q", "--detach");
    const shared = yield* localRepository({ title: "Payments", workspaceRoot: clone });
    assert.strictEqual(shared.branch, "trunk");
    NodeFS.rmSync(dir, { recursive: true, force: true });
  }),
);
