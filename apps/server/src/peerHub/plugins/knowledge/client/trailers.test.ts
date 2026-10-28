import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { PeerSessionView, PeerToolContext } from "../../../core/plugin.ts";
import type { KontextClientShape } from "../../../kontext.ts";
import {
  applyTrailers,
  describedChange,
  prepareTrailers,
  trailerFlows,
  trailersIn,
  withTrailers,
  type JjRunner,
  type PreparedTrailers,
} from "./trailers.ts";

const REPORT = `# Prepare the commit

## Knowledge in this change
- \`2026-10-28-prices-are-cents\` [decision] Prices are integer cents

## Checks
- 2 knowledge file(s) valid, no secrets found.

## Commit trailers (add them to the commit message: the prepare-commit-msg hook is not installed in this clone)
    Decision: 2026-10-28-prices-are-cents
    Learning: rounding-drifts-in-floats

## Worth recording?
This change touches 9 files.
`;

describe("the change a jj command describes", () => {
  it("is the parent after a commit or a plain squash, the working copy after a plain describe", () => {
    assert.strictEqual(describedChange('jj commit -m "feat: cents"'), "@-");
    assert.strictEqual(describedChange("jj --quiet squash -m done src/pricing.ts"), "@-");
    assert.strictEqual(describedChange('jj describe -m "feat: cents"'), "@");
    assert.strictEqual(describedChange("jj describe --message=cents --no-edit"), "@");
    assert.strictEqual(describedChange('jj git fetch && jj commit -m "x" && jj git push'), "@-");
  });

  it("is none for another revision, picked hunks, or no landing command at all", () => {
    assert.isNull(describedChange("jj describe -r xyz -m other"));
    assert.isNull(describedChange("jj describe xyz"));
    assert.isNull(describedChange("jj squash --into main"));
    assert.isNull(describedChange("jj squash -i"));
    assert.isNull(describedChange("jj new main"));
    assert.isNull(describedChange("jj git push"));
    assert.isNull(describedChange('git commit -m "x"'));
    assert.isNull(describedChange('echo "jj commit"'));
  });
});

describe("kontext's trailers", () => {
  it("are the lines of the report's section, each once", () => {
    assert.deepStrictEqual(trailersIn(REPORT), [
      "Decision: 2026-10-28-prices-are-cents",
      "Learning: rounding-drifts-in-floats",
    ]);
    assert.deepStrictEqual(
      trailersIn(
        "## Commit trailers (added automatically by the prepare-commit-msg hook)\n    Decision: 2026-10-28-prices-are-cents\n    Decision: 2026-10-28-prices-are-cents\n",
      ),
      ["Decision: 2026-10-28-prices-are-cents"],
    );
  });

  it("are none in a report without the section", () => {
    assert.deepStrictEqual(trailersIn("# Prepare the commit\n\n## Checks\n- ok\n"), []);
  });
});

describe("a description with its trailers", () => {
  const trailers = ["Decision: 2026-10-28-prices-are-cents", "Learning: rounding-drifts-in-floats"];

  it("gets the missing ones after a blank line, or in an ending block of trailers", () => {
    assert.deepStrictEqual(withTrailers("feat: cents\n", trailers), {
      text: "feat: cents\n\nDecision: 2026-10-28-prices-are-cents\nLearning: rounding-drifts-in-floats\n",
      added: trailers,
    });
    assert.deepStrictEqual(
      withTrailers("feat: cents\n\nCo-Authored-By: Pat <pat@acme.test>\n", trailers),
      {
        text: "feat: cents\n\nCo-Authored-By: Pat <pat@acme.test>\nDecision: 2026-10-28-prices-are-cents\nLearning: rounding-drifts-in-floats\n",
        added: trailers,
      },
    );
  });

  it("repeats none it has, and leaves an undescribed change alone", () => {
    assert.deepStrictEqual(
      withTrailers("feat: cents\n\nDecision: 2026-10-28-prices-are-cents\n", trailers),
      {
        text: "feat: cents\n\nDecision: 2026-10-28-prices-are-cents\nLearning: rounding-drifts-in-floats\n",
        added: ["Learning: rounding-drifts-in-floats"],
      },
    );
    assert.isNull(
      withTrailers(
        "feat: cents\n\nDecision: 2026-10-28-prices-are-cents\nLearning: rounding-drifts-in-floats\n",
        trailers,
      ),
    );
    assert.isNull(withTrailers("", trailers));
    assert.isNull(withTrailers("\n\n", trailers));
  });
});

/** A kontext whose `prepare-commit` prints `report`, or fails when it is null (not installed). */
const kontextWith = (report: string | null): KontextClientShape & { calls: string[][] } => {
  const calls: string[][] = [];
  return {
    calls,
    run: async (args) => {
      calls.push([...args]);
      if (report === null) return { code: -1, stdout: "", stderr: "spawn kontext ENOENT" };
      if (args[2] === "api" && args[3] === "status")
        return {
          code: 0,
          stdout: JSON.stringify({
            schema_version: 1,
            ok: true,
            result: {
              api_version: 1,
              version: "0.7.0",
              store: { configured: true, dir: ".ai" },
              capabilities: ["status"],
              llm: { available: false },
            },
          }),
          stderr: "",
        };
      return { code: 0, stdout: report, stderr: "" };
    },
  };
};

/** A jj whose `@-` is `change`, with `files` and a `description` that `describe` rewrites. */
const jjWith = (input: { readonly description: string; readonly files: ReadonlyArray<string> }) => {
  const change = "uzwwvsywxvvookrsrqutxsyuxzlowxtr";
  const state = { description: input.description, describes: 0, calls: [] as string[][] };
  const jj: JjRunner = async (_cwd, args) => {
    state.calls.push([...args]);
    if (args[0] === "log") return `${change}\n${state.description}`;
    if (args[0] === "diff") return input.files.join("\n");
    if (args[0] === "describe") {
      if (args.includes("--ignore-immutable")) throw new Error("never");
      state.describes++;
      state.description = args.at(-1)!;
      return "";
    }
    throw new Error(`unexpected jj ${args.join(" ")}`);
  };
  return { jj, state, change };
};

const prepared: PreparedTrailers = {
  command: 'jj commit -m "feat: cents"',
  target: "@-",
  trailers: ["Decision: 2026-10-28-prices-are-cents", "Learning: rounding-drifts-in-floats"],
};

describe("preparing and applying trailers", () => {
  it("reads them from kontext's report before the command, and none without kontext", async () => {
    const kontext = kontextWith(REPORT);
    assert.deepStrictEqual(
      await prepareTrailers(kontext, "/repo", prepared.command, 1_000),
      prepared,
    );
    assert.deepStrictEqual(kontext.calls, [["-C", "/repo", "prepare-commit"]]);
    assert.isNull(await prepareTrailers(kontextWith(null), "/repo", prepared.command, 1_000));
    assert.isNull(await prepareTrailers(kontext, "/repo", "jj git push", 1_000));
  });

  it("adds them to the change once, never twice", async () => {
    const { jj, state, change } = jjWith({
      description: "feat: cents\n",
      files: [".ai/decisions/2026-10-28-prices-are-cents.md", "src/pricing.ts"],
    });
    assert.deepStrictEqual(await applyTrailers(jj, "/repo", prepared, ".ai", 1_000), {
      changeId: change,
      added: prepared.trailers,
    });
    assert.strictEqual(
      state.description,
      "feat: cents\n\nDecision: 2026-10-28-prices-are-cents\nLearning: rounding-drifts-in-floats\n",
    );
    assert.isNull(await applyTrailers(jj, "/repo", prepared, ".ai", 1_000));
    assert.strictEqual(state.describes, 1);
    // Every read and the rewrite leave the working copy alone, and the rewrite names the change, not `@-`.
    for (const call of state.calls) assert.include(call, "--ignore-working-copy");
    assert.include(state.calls.at(-1), change);
  });

  it("leaves a change that ships no knowledge, and one jj refuses to rewrite", async () => {
    const quiet = jjWith({ description: "fix: tests\n", files: ["src/pricing.test.ts"] });
    assert.isNull(await applyTrailers(quiet.jj, "/repo", prepared, ".ai", 1_000));
    assert.strictEqual(quiet.state.describes, 0);
    const refusing: JjRunner = async (_cwd, args) => {
      if (args[0] === "describe") throw new Error("Commit uzwwvsyw is immutable");
      return quiet.jj("/repo", args, 1_000);
    };
    const theirs = jjWith({ description: "theirs\n", files: [".ai/learnings/x.md"] });
    assert.isNull(
      await applyTrailers(
        async (cwd, args, ms) =>
          args[0] === "describe" ? refusing(cwd, args, ms) : theirs.jj(cwd, args, ms),
        "/repo",
        prepared,
        ".ai",
        1_000,
      ),
    );
  });
});

/** An agent session in `cwd`, with the per-session state the knowledge plugin keeps for it. */
const sessionIn = (cwd: string, id = "codex:one"): PeerSessionView => {
  const locals = new Map<string, unknown>();
  return {
    id,
    agent: "codex",
    adapter: "hooks",
    runtimeGeneration: "g1",
    workspace: "acme",
    project: "pay",
    repositoryId: "api",
    root: cwd,
    cwd,
    task: "krk-1",
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
  };
};

const stepOf = (
  session: PeerSessionView,
  event: "pre-tool" | "post-tool",
  command: string,
  options: { readonly failed?: boolean; readonly remainingMs?: number } = {},
): PeerToolContext => ({
  session,
  event,
  tool: "Bash",
  paths: [],
  command,
  remainingMs: options.remainingMs ?? 3_000,
  ...(options.failed === undefined ? {} : { failed: options.failed }),
});

const flowsWith = (input: {
  readonly kontext: KontextClientShape;
  readonly jj: JjRunner;
  readonly kind?: "jj" | "git";
}) => {
  const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
  const flows = trailerFlows({
    kontext: input.kontext,
    jj: input.jj,
    checkout: async (cwd) =>
      input.kind === "git"
        ? { kind: "git", root: cwd }
        : { kind: "jj", root: cwd, mainRoot: cwd, gitDir: `${cwd}/.git` },
    freshMs: 60_000,
    log: (event, fields) => Effect.sync(() => void logs.push({ event, fields })),
    slot: (session) =>
      session.local("knowledge-test", (): { trailers: PreparedTrailers | undefined } => ({
        trailers: undefined,
      })),
  });
  return { ...flows, logs };
};

describe("the landing step's two halves", () => {
  it.effect("read the trailers before a jj commit and put them on the change after it", () =>
    Effect.gen(function* () {
      const { jj, state } = jjWith({
        description: "feat: cents\n",
        files: [".ai/decisions/2026-10-28-prices-are-cents.md"],
      });
      const flows = flowsWith({ kontext: kontextWith(REPORT), jj });
      const session = sessionIn("/repo");
      assert.isNull(yield* flows.before(stepOf(session, "pre-tool", prepared.command)));
      const said = yield* flows.after(stepOf(session, "post-tool", prepared.command));
      assert.match(
        said ?? "",
        /Added to change uzwwvsyw the commit trailers .*Decision: 2026-10-28-prices-are-cents, Learning: rounding-drifts-in-floats/,
      );
      assert.strictEqual(state.describes, 1);
      // The same step again, as a hook may replay it, has nothing prepared and rewrites nothing.
      assert.isNull(yield* flows.after(stepOf(session, "post-tool", prepared.command)));
      assert.strictEqual(state.describes, 1);
      assert.deepStrictEqual(
        flows.logs.map((log) => log.event),
        ["knowledge.trailers"],
      );
    }),
  );

  it.effect("rewrite nothing after a command that failed, or another command", () =>
    Effect.gen(function* () {
      const { jj, state } = jjWith({ description: "feat: cents\n", files: [".ai/x.md"] });
      const flows = flowsWith({ kontext: kontextWith(REPORT), jj });
      const session = sessionIn("/repo");
      yield* flows.before(stepOf(session, "pre-tool", prepared.command));
      assert.isNull(
        yield* flows.after(stepOf(session, "post-tool", prepared.command, { failed: true })),
      );
      yield* flows.before(stepOf(session, "pre-tool", prepared.command));
      assert.isNull(yield* flows.after(stepOf(session, "post-tool", "jj git push")));
      assert.strictEqual(state.describes, 0);
    }),
  );

  it.effect(
    "say once per session that a checkout has no kontext store, and ask a Git checkout nothing",
    () =>
      Effect.gen(function* () {
        const absent = kontextWith(null);
        const { jj, state } = jjWith({ description: "feat: cents\n", files: [".ai/x.md"] });
        const flows = flowsWith({ kontext: absent, jj });
        const session = sessionIn("/repo");
        for (let i = 0; i < 2; i++) {
          yield* flows.before(stepOf(session, "pre-tool", prepared.command));
          assert.isNull(yield* flows.after(stepOf(session, "post-tool", prepared.command)));
        }
        assert.strictEqual(state.describes, 0);
        assert.deepStrictEqual(
          flows.logs.map((log) => log.event),
          ["knowledge.trailers-skipped"],
        );
        // The store's absence is remembered: kontext was asked once, not at every step.
        assert.strictEqual(absent.calls.length, 1);

        const git = kontextWith(REPORT);
        const onGit = flowsWith({ kontext: git, jj, kind: "git" });
        yield* onGit.before(stepOf(sessionIn("/git"), "pre-tool", prepared.command));
        assert.deepStrictEqual(git.calls, []);
      }),
  );
});
