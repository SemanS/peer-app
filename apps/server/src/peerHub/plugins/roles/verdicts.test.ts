// @effect-diagnostics nodeBuiltinImport:off - the edited files are in the broker's temporary checkout.
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import type { PeerRoleRow } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { CliError, render, type PeerToolContext } from "../../core/plugin.ts";
import { acmeHubOf, BOB, logged, NOW, ready } from "./fixtures.test.ts";
import { editStop, landingStop, shellStop, startBlock } from "./text.ts";
import { judge } from "./verdicts.ts";

const row = (session: string): PeerRoleRow => ({
  session,
  role: "review",
  email: BOB,
  environment: "ana-laptop",
  setBy: "person",
  at: NOW,
});
/** A Hub where Bob's sessions `claude:one` and `codex:two` review. */
const reviewing = () => ({ ...acmeHubOf(), rows: [row("claude:one"), row("codex:two")] });

const call = (root: string, tool: string, input: Record<string, unknown>, id = "one") => ({
  hook_event_name: "PreToolUse",
  session_id: id,
  cwd: root,
  tool_name: tool,
  tool_input: input,
});
const said = (out: Record<string, unknown> | null) =>
  (out?.hookSpecificOutput ?? {}) as {
    readonly permissionDecision?: string;
    readonly permissionDecisionReason?: string;
  };
type Fixture = Effect.Success<ReturnType<typeof ready>>["fixture"];
const hook = (fixture: Fixture, body: Record<string, unknown>, agent = "claude") =>
  Effect.promise(async () => said(await fixture.broker["hook"](body, { "x-peer-agent": agent })));
const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

const ORDER = "src/order.js";

describe("a review session's shell", () => {
  const bash = (command: string) =>
    ({
      tool: "Bash",
      command,
      paths: [],
      session: {},
      event: "pre-tool",
      remainingMs: 0,
    }) as unknown as PeerToolContext;
  const shell = (command: string) => judge("review", bash(command));

  it.each([
    "echo x >> src/pricing.ts",
    "echo x > src/pricing.ts",
    "echo x>out.txt",
    "npm test &> log.txt",
    "npm test 2> errors.txt",
    "cat x | tee y",
    "sed -i 's/a/b/' x",
    "sed -i.bak 's/a/b/' x",
    "perl -pi -e 's/a/b/' x",
    "rm x",
    "mv a b",
    "cp a b",
    "truncate -s 0 x",
    "dd if=a of=b",
    "patch -p1 < x.diff",
    "git apply x.diff",
    "git checkout -- src/pricing.ts",
    "git restore src/pricing.ts",
    "git reset --hard",
    "git clean -fd",
    "git stash",
    "git -C sub stash push",
    "npm test && rm x",
  ])("denies %s", (command) => {
    const stop = shell(command);
    assert.strictEqual(stop?.where, "edit");
    assert.strictEqual(stop?.verdict.decision, "deny");
  });

  it.each([
    "npm test 2>/dev/null",
    "npm test > /dev/null",
    "npm test 2>&1",
    "npm test >&2",
    "npm test > /dev/null 2>&1",
    "grep '>' x",
    'grep ">>" x',
    "grep \\> x",
    "git log --format='%h > %s'",
    "echo 'rm x'",
    "git diff",
    "git checkout main",
    "git stash list",
    "sed -n 1,5p x",
    "perl -ne 'print' x",
    "dd if=a",
    "cat <<EOF\necho x > y\nEOF",
  ])("lets %s run", (command) => {
    assert.isNull(shell(command));
  });

  it("names landing first", () => {
    assert.strictEqual(shell("git commit -m x > log")?.where, "landing");
  });

  it("leaves every other session's shell alone", () => {
    assert.isNull(judge(undefined, bash("rm x")));
  });
});

describe("a review session", () => {
  it.effect("cannot edit a file, on Claude Code or Codex", () =>
    run(
      Effect.gen(function* () {
        const { fixture } = yield* ready(reviewing());
        const file = NodePath.join(fixture.root, ORDER);
        for (const [tool, input] of [
          ["Edit", { file_path: file, old_string: "a", new_string: "b" }],
          ["Write", { file_path: file, content: "x" }],
        ] as const) {
          const out = yield* hook(fixture, call(fixture.root, tool, input));
          assert.strictEqual(out.permissionDecision, "deny");
          assert.strictEqual(out.permissionDecisionReason, editStop([ORDER]));
        }
        const patch = ["*** Begin Patch", `*** Update File: ${ORDER}`, "*** End Patch"].join("\n");
        const codex = yield* hook(
          fixture,
          call(fixture.root, "apply_patch", { command: patch }, "two"),
          "codex",
        );
        assert.strictEqual(codex.permissionDecisionReason, editStop([ORDER]));
        const log = yield* Effect.promise(() => logged(fixture));
        assert.deepStrictEqual(
          log.filter((line) => line.event === "roles.denied").map((line) => line.where),
          ["edit", "edit", "edit"],
        );
      }),
    ),
  );

  it.effect("is stopped by the hook before a shell write runs", () =>
    run(
      Effect.gen(function* () {
        const { fixture } = yield* ready(reviewing());
        const out = yield* hook(
          fixture,
          call(fixture.root, "Bash", { command: "echo x >> src/order.js" }),
        );
        assert.strictEqual(out.permissionDecision, "deny");
        assert.strictEqual(out.permissionDecisionReason, shellStop("redirect to src/order.js"));
      }),
    ),
  );

  it.effect("cannot land work, in git, jj or gh form, and may read and run anything else", () =>
    run(
      Effect.gen(function* () {
        const { fixture } = yield* ready(reviewing());
        const shell = (command: string) => hook(fixture, call(fixture.root, "Bash", { command }));
        for (const [command, kind] of [
          ["git push origin HEAD", "push"],
          ["jj git push", "push"],
          ["gh pr create --fill", "pull request"],
          ['git commit -am "fix"', "commit"],
        ] as const) {
          const out = yield* shell(command);
          assert.strictEqual(out.permissionDecision, "deny", command);
          assert.strictEqual(out.permissionDecisionReason, landingStop(kind));
        }
        for (const command of ["git status", "git log -3", "npm test", "cat src/order.js"])
          assert.isUndefined((yield* shell(command)).permissionDecision, command);
      }),
    ),
  );

  it.effect("writes Peer's own working context, as every session does", () =>
    run(
      Effect.gen(function* () {
        const { fixture } = yield* ready(reviewing());
        yield* Effect.promise(() => fixture.register("one"));
        const own = fixture.broker["sessions"].get("claude:one")!.ownContextPath;
        const out = yield* hook(
          fixture,
          call(fixture.root, "Write", { file_path: own, content: "notes" }),
        );
        assert.notStrictEqual(out.permissionDecision, "deny");
      }),
    ),
  );

  it.effect("is denied the same while the Hub cannot be reached", () =>
    run(
      Effect.gen(function* () {
        const current = reviewing();
        const { fixture } = yield* ready(current);
        current.route = () => [503, { error: { code: "unavailable", message: "Down." } }];
        const out = yield* hook(
          fixture,
          call(fixture.root, "Write", {
            file_path: NodePath.join(fixture.root, ORDER),
            content: "",
          }),
        );
        assert.strictEqual(out.permissionDecision, "deny");
        const write = yield* hook(fixture, call(fixture.root, "Bash", { command: "rm x" }));
        assert.strictEqual(write.permissionDecision, "deny");
      }),
    ),
  );

  it.effect("cannot hand its task over with peer review", () =>
    run(
      Effect.gen(function* () {
        let moved = false;
        const { fixture } = yield* ready(reviewing(), () => ({
          finishTask: async () => {
            moved = true;
            return {};
          },
        }));
        yield* Effect.promise(() => fixture.register("one"));
        const printed = yield* Effect.promise(() =>
          fixture.broker["runCli"]("review", [], {
            "x-peer-cwd": fixture.root,
            "x-peer-session": "claude:one",
          }).then(
            () => "done",
            (error: unknown) => (error instanceof CliError ? render(error) : String(error)),
          ),
        );
        assert.include(printed, "a review session hands nothing over");
        assert.isFalse(moved);
      }),
    ),
  );

  it.effect("hears its role and limits at its start, in at most 300 characters", () =>
    run(
      Effect.gen(function* () {
        const { fixture } = yield* ready(reviewing());
        const out = (yield* Effect.promise(() =>
          fixture.broker["hook"](
            {
              hook_event_name: "SessionStart",
              session_id: "one",
              cwd: fixture.root,
              source: "startup",
            },
            { "x-peer-agent": "claude" },
          ),
        )) as { hookSpecificOutput?: { additionalContext?: string } } | null;
        assert.include(out?.hookSpecificOutput?.additionalContext ?? "", startBlock());
        assert.isAtMost(startBlock().length, 300);
        for (const word of ["review", "read", "edit", "peer tests"])
          assert.include(startBlock(), word);
      }),
    ),
  );
});

describe("the verdict", () => {
  const ctx = (over: Partial<PeerToolContext>) =>
    ({
      tool: "Edit",
      paths: [],
      session: {},
      event: "pre-tool",
      remainingMs: 0,
      ...over,
    }) as PeerToolContext;

  it("is the same function from memory as decide and as fallback, and needs the role", () => {
    assert.deepStrictEqual(judge("review", ctx({ paths: [ORDER] }))?.verdict, {
      decision: "deny",
      reason: editStop([ORDER]),
    });
    assert.strictEqual(
      judge("review", ctx({ tool: "Bash", command: "jj git push" }))?.where,
      "landing",
    );
    assert.isNull(judge(undefined, ctx({ paths: [ORDER] })));
    assert.isNull(judge("triage", ctx({ paths: [ORDER] })));
    assert.isNull(judge("review", ctx({ tool: "Bash", command: 'echo "git push"' })));
    assert.isNull(judge("review", ctx({ tool: "Read" })));
  });
});
