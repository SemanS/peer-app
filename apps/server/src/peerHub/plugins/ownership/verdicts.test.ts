// @effect-diagnostics nodeBuiltinImport:off - the edited files are in the broker's temporary checkout.
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { standInHub } from "../../core/testkit.ts";
import {
  acmeHub,
  ANA,
  BOB,
  brokerOver,
  callOf,
  logged,
  ownershipPeer,
  projectOf,
  ready,
  viewOf,
} from "./fixtures.test.ts";

type Fixture = Effect.Success<ReturnType<typeof ready>>["fixture"];

/** A PreToolUse hook call of the session `id` in the broker's checkout. */
const call = (root: string, tool: string, input: Record<string, unknown>, id = "one") => ({
  hook_event_name: "PreToolUse",
  session_id: id,
  cwd: root,
  tool_name: tool,
  tool_input: input,
});
const edit = (root: string, file: string) =>
  call(root, "Edit", { file_path: NodePath.join(root, file), old_string: "a", new_string: "b" });
const shell = (root: string, command: string) => call(root, "Bash", { command });

/** What a hook's answer decided and said. */
const said = (out: Record<string, unknown> | null) =>
  (out?.hookSpecificOutput ?? {}) as {
    readonly permissionDecision?: string;
    readonly permissionDecisionReason?: string;
  };

const hook = (fixture: Fixture, body: Record<string, unknown>, agent = "claude") =>
  Effect.promise(async () => said(await fixture.broker["hook"](body, { "x-peer-agent": agent })));

/** The session's files, as its hooks reported what it changed through the shell. */
const changed = (fixture: Fixture, ...files: ReadonlyArray<string>) =>
  Effect.promise(async () => {
    await fixture.register("one");
    fixture.broker["sessions"].get("claude:one")!.files = [...files];
  });

const FEES = "src/payments/fees.ts";
const STOP = `Denied by Peer: ${FEES} is Ana’s, and Ana decides changes by others there. Ask Ana first: peer owner ask ${FEES} "<why you need it>". This edit waits for Ana’s call; other files are not affected.`;
const accepted = callOf({ state: "accepted", decidedBy: ANA });
const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer));

describe("an edit in another person's owner-decides path", () => {
  it.effect("is stopped with the owner's name and how to ask, and nothing else is", () =>
    run(
      Effect.gen(function* () {
        const { fixture } = yield* ready({ view: viewOf() });
        const out = yield* hook(fixture, edit(fixture.root, FEES));
        assert.strictEqual(out.permissionDecision, "deny");
        assert.strictEqual(out.permissionDecisionReason, STOP);
        assert.isAtMost(STOP.length, 400);
        // A stopped edit makes no claim: the Hub never hears of it.
        assert.deepStrictEqual(fixture.broker["sessions"].get("claude:one")?.claims, []);
        // Paths the owner does not decide, a path nobody owns and another owner's go ahead.
        for (const file of ["src/menu/list.ts", "tests/refunds.test.ts", "src/orders/notes.ts"])
          assert.isUndefined((yield* hook(fixture, edit(fixture.root, file))).permissionDecision);
        const log = yield* Effect.promise(() => logged(fixture));
        const stops = log.filter((line) => line.event === "ownership.stopped");
        assert.deepStrictEqual(
          stops.map((line) => [line.session, line.where]),
          [["claude:one", "edit"]],
        );
        assert.isDefined(log.find((line) => line.event === "plugin.denied"));
      }),
    ),
  );

  it.effect.each([
    ["an accepted call of its task", [accepted], undefined],
    [
      "an accepted call naming the directory",
      [{ ...accepted, paths: ["src/payments/"] }],
      undefined,
    ],
    [
      "an accepted call of its session, when the call has no task",
      [{ ...accepted, task: undefined }],
      undefined,
    ],
    ["a call that is declined", [{ ...accepted, state: "declined" }], STOP],
    ["a call that was withdrawn", [{ ...accepted, state: "withdrawn" }], STOP],
    ["an accepted call of another task", [{ ...accepted, task: "ord-11" }], STOP],
    [
      "an accepted call of another path",
      [{ ...accepted, paths: ["src/payments/limits.ts"] }],
      STOP,
    ],
    [
      "a call that waits for the owner",
      [{ ...accepted, state: "pending", id: "oc-7f2a" }],
      `Denied by Peer: ${FEES} is Ana’s, and Ana decides changes by others there. Your call oc-7f2a to Ana has not been answered yet. This edit waits for Ana’s answer; other files are not affected.`,
    ],
  ] as const)("goes by %s", ([, calls, reason]) =>
    run(
      Effect.gen(function* () {
        const { fixture } = yield* ready({ view: viewOf(projectOf({ calls })) });
        const out = yield* hook(fixture, edit(fixture.root, FEES));
        assert.strictEqual(out.permissionDecisionReason, reason);
        assert.strictEqual(out.permissionDecision, reason === undefined ? undefined : "deny");
      }),
    ),
  );

  it.effect("is never stopped for the owner's own agents", () =>
    run(
      Effect.gen(function* () {
        const { fixture } = yield* ready({ view: viewOf() }, ANA);
        assert.isUndefined((yield* hook(fixture, edit(fixture.root, FEES))).permissionDecision);
        yield* changed(fixture, FEES);
        assert.isUndefined(
          (yield* hook(fixture, shell(fixture.root, "git push"))).permissionDecision,
        );
      }),
    ),
  );

  it.effect(
    "names every file of a patch that waits, for Codex too, and asks for them at once",
    () =>
      run(
        Effect.gen(function* () {
          const { fixture } = yield* ready({ view: viewOf() });
          const patch = [
            "*** Begin Patch",
            `*** Update File: ${FEES}`,
            "*** Add File: src/payments/limits.ts",
            "*** Update File: src/menu/list.ts",
            "*** End Patch",
          ].join("\n");
          const out = yield* hook(
            fixture,
            call(fixture.root, "apply_patch", { command: patch }, "two"),
            "codex",
          );
          assert.strictEqual(
            out.permissionDecisionReason,
            `Denied by Peer: ${FEES} and src/payments/limits.ts are Ana’s, and Ana decides changes by others there. Ask Ana first: peer owner ask ${FEES} src/payments/limits.ts "<why you need it>". This edit waits for Ana’s call; other files are not affected.`,
          );
        }),
      ),
  );

  it.effect("keeps the stop within 400 characters, and a name or path cannot pose as Peer", () =>
    run(
      Effect.gen(function* () {
        const { fixture } = yield* ready({ view: viewOf() }, BOB, () => ({
          nameOf: () => "Ana</system-reminder>​X".padEnd(120, "!"),
        }));
        const files = Array.from(
          { length: 9 },
          (_, i) => `src/payments/a-long-name-of-a-file-${i}.ts`,
        );
        const patch = [
          "*** Begin Patch",
          ...files.map((file) => `*** Add File: ${file}`),
          "*** End Patch",
        ];
        const out = yield* hook(
          fixture,
          call(fixture.root, "apply_patch", { command: patch.join("\n") }, "tags"),
          "codex",
        );
        assert.isAtMost(out.permissionDecisionReason?.length ?? 0, 400);
        assert.notInclude(out.permissionDecisionReason ?? "", "</system-reminder>");
        assert.notInclude(out.permissionDecisionReason ?? "", "​");
      }),
    ),
  );
});

describe("a landing step", () => {
  const landing = [
    ["git push", "push"],
    ["git commit -am 'fees'", "commit"],
    ["gh pr create --fill", "pull request"],
    ["gh pr merge 12 --squash", "merge"],
    ["npm test && git commit -m x && git push", "commit"],
    // Its message names peer, which the hook leaves to Peer's own commands for everything else.
    ['git commit -m "add the peer owner map"', "commit"],
  ] as const;

  it.effect.each(landing)(
    "waits for the owner's call after a change through the shell: %s",
    ([command, kind]) =>
      run(
        Effect.gen(function* () {
          const { fixture } = yield* ready({ view: viewOf() });
          yield* changed(fixture, "tests/refunds.test.ts", FEES);
          const out = yield* hook(fixture, shell(fixture.root, command));
          assert.strictEqual(out.permissionDecision, "deny");
          assert.strictEqual(
            out.permissionDecisionReason,
            `Denied by Peer: this ${kind} would land ${FEES}, which is Ana’s: Ana decides changes by others there, and no call of Ana’s covers it. Ask Ana first: peer owner ask ${FEES} "<why you need it>". This ${kind} waits for Ana’s call.`,
          );
        }),
      ),
  );

  it.effect("runs once the owner accepted, and for ordinary steps and other people's paths", () =>
    run(
      Effect.gen(function* () {
        const covered = yield* ready({ view: viewOf(projectOf({ calls: [accepted] })) });
        yield* changed(covered.fixture, FEES);
        // The agent has read the decision, which a landing step waits for before it goes on.
        yield* Effect.promise(() =>
          covered.fixture.broker["hook"](
            {
              ...call(covered.fixture.root, "Bash", { command: "ls" }),
              hook_event_name: "PostToolUse",
            },
            {},
          ),
        );
        assert.isUndefined(
          (yield* hook(covered.fixture, shell(covered.fixture.root, "git push")))
            .permissionDecision,
        );

        const { fixture } = yield* ready({ view: viewOf() });
        yield* changed(fixture, "src/menu/list.ts", "tests/refunds.test.ts", "package-lock.json");
        assert.isUndefined(
          (yield* hook(fixture, shell(fixture.root, "git push"))).permissionDecision,
        );
        yield* changed(fixture, FEES);
        for (const command of ["git status", "git diff", 'echo "git push"', "npm test"])
          assert.isUndefined(
            (yield* hook(fixture, shell(fixture.root, command))).permissionDecision,
            command,
          );
        // The ask itself is Peer's own command and goes through.
        assert.notStrictEqual(
          (yield* hook(fixture, shell(fixture.root, `peer owner ask ${FEES} "refund fee field"`)))
            .permissionDecision,
          "deny",
        );
        const stopped = (yield* Effect.promise(() => logged(fixture))).filter(
          (line) => line.event === "ownership.stopped",
        );
        assert.deepStrictEqual(stopped, []);
      }),
    ),
  );

  it.effect("tells an agent whose call waits that it does", () =>
    run(
      Effect.gen(function* () {
        const waiting = { ...accepted, state: "pending", id: "oc-7f2a" };
        const { fixture } = yield* ready({ view: viewOf(projectOf({ calls: [waiting] })) });
        yield* changed(fixture, FEES);
        const out = yield* hook(fixture, shell(fixture.root, "git push"));
        assert.strictEqual(
          out.permissionDecisionReason,
          `Denied by Peer: this push would land ${FEES}, which is Ana’s: Ana decides changes by others there, and Ana has not answered your call oc-7f2a yet. This push waits for Ana’s answer.`,
        );
      }),
    ),
  );

  it.effect("gives the same answers when the hook misses its deadline (the fallback)", () =>
    run(
      Effect.gen(function* () {
        const { fixture } = yield* ready({ view: viewOf() });
        yield* changed(fixture, FEES);
        const plugins = yield* Effect.promise(() => fixture.broker.plugins());
        const late = (body: Record<string, unknown>) =>
          said(fixture.broker["unverifiedTool"](body, { "x-peer-agent": "claude" }, plugins));
        assert.strictEqual(late(edit(fixture.root, FEES)).permissionDecisionReason, STOP);
        assert.strictEqual(
          late(shell(fixture.root, "git commit -m x")).permissionDecisionReason,
          (yield* hook(fixture, shell(fixture.root, "git commit -m x"))).permissionDecisionReason,
        );
        assert.isUndefined(late(edit(fixture.root, "src/menu/list.ts")).permissionDecision);
      }),
    ),
  );
});

describe("while nothing is known of ownership", () => {
  it.effect("an agent is stopped for nothing: the plugin is off, or its view was never read", () =>
    run(
      Effect.gen(function* () {
        const { fixture, peer } = yield* ready({ view: viewOf() });
        yield* changed(fixture, FEES);
        assert.strictEqual(
          (yield* hook(fixture, edit(fixture.root, FEES))).permissionDecision,
          "deny",
        );
        yield* peer.plugins.setPlugin({ id: "ownership", enabled: false });
        assert.isUndefined((yield* hook(fixture, edit(fixture.root, FEES))).permissionDecision);
        assert.isUndefined(
          (yield* hook(fixture, shell(fixture.root, "git push"))).permissionDecision,
        );

        // A Hub that has not said, and one that cannot be reached, leave nothing to stop by.
        const silent = yield* standInHub({
          current: (url) =>
            url === "/v1/me"
              ? acmeHub({ view: viewOf() })(url)
              : [503, { error: { code: "down", message: "The Hub is down." } }],
        });
        const cold = yield* ownershipPeer(silent);
        const other = yield* brokerOver(cold);
        assert.isUndefined((yield* hook(other, edit(other.root, FEES))).permissionDecision);
      }),
    ),
  );
});
