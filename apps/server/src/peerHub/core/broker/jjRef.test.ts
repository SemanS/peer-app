// @effect-diagnostics nodeBuiltinImport:off - a temporary jj checkout under the broker fixture.
import * as NodeChildProcess from "node:child_process";

import { assert, it } from "@effect/vitest";

import { chosenBookmarkConfigKey } from "../../../jj/JjStatus.ts";
import { currentRef } from "../vcs.ts";
import { brokerFixture } from "./testkit.ts";

const jj = (cwd: string, ...args: string[]) =>
  NodeChildProcess.execFileSync("jj", ["--quiet", ...args], {
    cwd,
    env: { ...process.env, JJ_USER: "Ana", JJ_EMAIL: "ana@acme.test" },
    stdio: "ignore",
  });

it("matches a session in a jj workspace to its task by the bookmark under its working copy", async () => {
  const seen: Array<ReadonlyArray<string | undefined>> = [];
  const fixture = await brokerFixture(() => ({
    branchOf: currentRef,
    taskOf: (_workspace, _project, _ids, refs) => {
      seen.push(refs);
      return refs.includes("feature/KRK-1-ab12") ? "KRK-1" : undefined;
    },
  }));
  try {
    jj(fixture.root, "git", "init", "--colocate");
    jj(fixture.root, "commit", "-m", "decision");
    jj(fixture.root, "bookmark", "create", "feature/KRK-1-ab12", "-r", "@-");
    await fixture.register("s1");
    const session = fixture.broker["sessions"].get("claude:s1");
    assert.strictEqual(session?.branch, "feature/KRK-1-ab12");
    assert.strictEqual(session?.task, "KRK-1");
    assert.notInclude(seen.flat(), "HEAD");
  } finally {
    await fixture.dispose();
  }
});

it("matches no merged task once the person picked main, which shares its commit", async () => {
  const fixture = await brokerFixture(() => ({
    branchOf: currentRef,
    taskOf: (_workspace, _project, _ids, refs) =>
      refs.includes("feature/KRK-1-ab12") ? "KRK-1" : undefined,
  }));
  try {
    jj(fixture.root, "git", "init", "--colocate");
    jj(fixture.root, "commit", "-m", "decision");
    jj(fixture.root, "bookmark", "create", "feature/KRK-1-ab12", "main", "-r", "@-");
    NodeChildProcess.execFileSync("git", [
      "-C",
      fixture.root,
      "config",
      chosenBookmarkConfigKey("default"),
      "main",
    ]);
    await fixture.register("s1");
    const session = fixture.broker["sessions"].get("claude:s1");
    assert.strictEqual(session?.branch, "main");
    assert.isUndefined(session?.task);
  } finally {
    await fixture.dispose();
  }
});
