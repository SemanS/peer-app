import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, describe, it } from "@effect/vitest";
import { PeerHubError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { vi } from "vite-plus/test";

import type { CoordinationBroker } from "../broker/Broker.ts";
import { PeerPromptStale, type PeerPromptExpect } from "../plugin.ts";
import * as PeerAgents from "./PeerAgents.ts";

afterEach(() => vi.unstubAllEnvs());

/** A broker that only reports, writing down what it was asked and failing while `failing`. */
const reportingBroker = () => {
  const state = { reported: [] as Array<string>, failing: false };
  const broker = {
    onViewChange: () => () => undefined,
    reportNow: (workspace: string) => {
      state.reported.push(workspace);
      return state.failing ? Promise.reject(new Error("The broker stopped.")) : Promise.resolve();
    },
  } as unknown as CoordinationBroker;
  return { state, broker };
};

describe("PeerAgents.report", () => {
  it.effect("reports through the running broker, and does nothing while coordination is off", () =>
    Effect.gen(function* () {
      const agents = yield* PeerAgents.PeerAgents;
      const { state, broker } = reportingBroker();
      yield* agents.report("acme");
      assert.deepStrictEqual(state.reported, []);
      yield* agents.attach(broker);
      yield* agents.report("acme");
      assert.deepStrictEqual(state.reported, ["acme"]);
      yield* agents.attach(null);
      yield* agents.report("acme");
      assert.deepStrictEqual(state.reported, ["acme"]);
    }).pipe(Effect.provide(PeerAgents.layer)),
  );

  it.effect("fails with a typed error, not a defect, when the report could not run", () =>
    Effect.gen(function* () {
      const agents = yield* PeerAgents.PeerAgents;
      const { state, broker } = reportingBroker();
      state.failing = true;
      yield* agents.attach(broker);
      const failure = yield* agents.report("acme").pipe(Effect.flip);
      assert.strictEqual(failure._tag, "PeerHubError");
      assert.strictEqual(
        failure.detail,
        "This computer's sessions could not be reported to the Hub: The broker stopped.",
      );
    }).pipe(Effect.provide(PeerAgents.layer)),
  );
});

it.effect(
  "prompts only a live local runtime with matching pane and current coordinated session",
  () =>
    Effect.gen(function* () {
      const agents = yield* PeerAgents.PeerAgents;
      const asked: string[] = [];
      let present = true,
        level: "A" | "B" | "C" = "B";
      const broker = {
        onViewChange: () => () => undefined,
        localRuntimeAgents: async () =>
          present
            ? [{ id: "herdr:claude:one", paneId: "p", status: "running", title: "Mine" }]
            : [],
        sessionViews: () => [{ id: "claude:one", pane: "p" }],
        coordinationLevel: () => level,
        plugins: async () => ({
          runtime: {
            prefix: "herdr:",
            prompt: (id: string, text: string) =>
              Effect.sync(() => void asked.push(`${id}:${text}`)),
          },
        }),
        host: { run: Effect.runPromise },
      } as unknown as CoordinationBroker;
      yield* agents.attach(broker);
      yield* agents.promptRuntime("herdr:claude:one", "words");
      assert.deepStrictEqual(asked, ["herdr:claude:one:words"]);
      present = false;
      assert.strictEqual(
        (yield* agents.promptRuntime("herdr:claude:one", "words").pipe(Effect.flip))._tag,
        "PeerHubError",
      );
      present = true;
      level = "C";
      yield* agents.promptRuntime("herdr:claude:one", "words").pipe(Effect.flip);
      assert.strictEqual(asked.length, 1);
      yield* agents.promptRuntime("herdr:colleague", "words").pipe(Effect.flip);
      assert.strictEqual(asked.length, 1);
    }).pipe(Effect.provide(PeerAgents.layer)),
);

/** A runtime that lists one agent, `herdr:claude:one` in pane `p`, and notes what it is prompted with. */
const promptingBroker = () => {
  const world = {
    present: true,
    status: "idle" as "idle" | "blocked",
    level: "B" as "A" | "B" | "C",
    /** What the runtime answers when asked to prompt; it types when nothing is set. */
    refusal: undefined as PeerHubError | PeerPromptStale | undefined,
    prompted: [] as Array<readonly [string, string, PeerPromptExpect | undefined]>,
  };
  const broker = {
    onViewChange: () => () => undefined,
    localRuntimeAgents: async () =>
      world.present
        ? [{ id: "herdr:claude:one", paneId: "p", status: world.status, title: "Mine" }]
        : [],
    sessionViews: () => [{ id: "claude:one", pane: "p" }],
    coordinationLevel: () => world.level,
    plugins: async () => ({
      runtime: {
        prefix: "herdr:",
        prompt: (id: string, text: string, expect?: PeerPromptExpect) =>
          world.refusal === undefined
            ? Effect.sync(() => void world.prompted.push([id, text, expect]))
            : Effect.fail(world.refusal),
      },
    }),
    host: { run: Effect.runPromise },
  } as unknown as CoordinationBroker;
  return { world, broker };
};

describe("PeerAgents.promptRuntime with what the caller read", () => {
  const expect = { session: "one", turn: 3 } satisfies PeerPromptExpect;

  it.effect("hands it to the runtime, and hands the runtime nothing when there is none", () =>
    Effect.gen(function* () {
      const agents = yield* PeerAgents.PeerAgents;
      const { world, broker } = promptingBroker();
      yield* agents.attach(broker);
      yield* agents.promptRuntime("herdr:claude:one", "words", expect);
      yield* agents.promptRuntime("herdr:claude:one", "more");
      assert.deepStrictEqual(world.prompted, [
        ["herdr:claude:one", "words", expect],
        ["herdr:claude:one", "more", undefined],
      ]);
    }).pipe(Effect.provide(PeerAgents.layer)),
  );

  it.effect("tells an agent that is not the one it read from a prompt that failed", () =>
    Effect.gen(function* () {
      const agents = yield* PeerAgents.PeerAgents;
      const { world, broker } = promptingBroker();
      yield* agents.attach(broker);

      // The runtime read the agent again and found it changed: that reaches the caller as it is.
      world.refusal = new PeerPromptStale({ reason: "turn" });
      const stale = yield* agents
        .promptRuntime("herdr:claude:one", "words", expect)
        .pipe(Effect.flip);
      assert.deepStrictEqual(
        [stale._tag, stale._tag === "PeerPromptStale" && stale.reason],
        ["PeerPromptStale", "turn"],
      );
      // A runtime that could not type the text is a failure, with or without what the caller read.
      world.refusal = new PeerHubError({ detail: "herdr did not take the prompt." });
      for (const asked of [expect, undefined]) {
        const failed = yield* agents
          .promptRuntime("herdr:claude:one", "words", asked)
          .pipe(Effect.flip);
        assert.deepStrictEqual(
          [failed._tag, failed.message],
          ["PeerHubError", "herdr did not take the prompt."],
        );
      }
      assert.deepStrictEqual(world.prompted, []);
    }).pipe(Effect.provide(PeerAgents.layer)),
  );

  it.effect(
    "calls an agent that is gone or waiting for an answer stale, and asks the runtime nothing",
    () =>
      Effect.gen(function* () {
        const agents = yield* PeerAgents.PeerAgents;
        const { world, broker } = promptingBroker();
        yield* agents.attach(broker);
        const refusedAs = (asked: PeerPromptExpect | undefined) =>
          agents.promptRuntime("herdr:claude:one", "words", asked).pipe(
            Effect.flip,
            Effect.map((failure) =>
              failure._tag === "PeerPromptStale" ? `stale ${failure.reason}` : failure.message,
            ),
          );
        const before = "That agent no longer coordinates here or waits for an answer.";

        world.present = false;
        assert.strictEqual(yield* refusedAs(expect), "stale gone");
        assert.strictEqual(yield* refusedAs(undefined), before);
        world.present = true;
        world.status = "blocked";
        assert.strictEqual(yield* refusedAs(expect), "stale busy");
        assert.strictEqual(yield* refusedAs(undefined), before);
        // An agent Peer does not follow cannot be prompted at all; that is no reading gone stale.
        world.status = "idle";
        world.level = "C";
        assert.strictEqual(yield* refusedAs(expect), before);
        assert.deepStrictEqual(world.prompted, []);
      }).pipe(Effect.provide(PeerAgents.layer)),
  );

  it.effect("is a failed prompt, not a stale agent, while coordination is off", () =>
    Effect.gen(function* () {
      const agents = yield* PeerAgents.PeerAgents;
      for (const asked of [expect, undefined]) {
        const off = yield* agents
          .promptRuntime("herdr:claude:one", "words", asked)
          .pipe(Effect.flip);
        assert.strictEqual(off._tag, "PeerHubError");
      }
    }).pipe(Effect.provide(PeerAgents.layer)),
  );
});

/** The agents service, and the files a transcript is kept in. */
const withFiles = Layer.mergeAll(NodeServices.layer, PeerAgents.layer);

/** Claude Code's transcript lines, one record each. */
let recorded = 0;
const record = (type: "user" | "assistant", content: unknown, extra: object = {}) =>
  JSON.stringify({
    type,
    uuid: `record-${recorded++}`,
    message: { role: type, content },
    ...extra,
  });
const said = (text: string, extra: object = {}) =>
  record("assistant", [{ type: "text", text }], extra);

describe("PeerAgents.lastMessage", () => {
  /** A broker whose hooks know the session in pane `w1:p1`, with its transcript at `path`. */
  const hookedBroker = (path: string | undefined) =>
    ({
      onViewChange: () => () => undefined,
      sessionInPane: (pane: string) => (pane === "w1:p1" ? { id: "abc12345", path } : undefined),
    }) as unknown as CoordinationBroker;

  /** The agents service with `lines` as the transcript of pane `w1:p1`'s session. */
  const withTranscript = (lines: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const dir = yield* fs.makeTempDirectoryScoped({ prefix: "peer-agents-transcript-" });
      // Peer finds a transcript by its session id in Claude Code's folders when its path is gone.
      vi.stubEnv("CLAUDE_CONFIG_DIR", dir);
      const file = (yield* Path.Path).join(dir, "abc12345.jsonl");
      yield* fs.writeFileString(file, lines.map((line) => `${line}\n`).join(""));
      const agents = yield* PeerAgents.PeerAgents;
      yield* agents.attach(hookedBroker(file));
      return agents;
    });

  it.effect("reads the last words of the agent in the session of a pane", () =>
    Effect.gen(function* () {
      const agents = yield* withTranscript([
        record("user", "Fix the price rounding."),
        record("assistant", [
          { type: "text", text: "Looking at the code." },
          { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/work/pay.ts" } },
        ]),
        record("user", [{ type: "tool_result", tool_use_id: "t1", content: "const price = 1;" }]),
        said("Done. Round half up, or to even?"),
        // What a subagent said in between is not the agent's own last message.
        said("A helper's note.", { isSidechain: true }),
      ]);
      assert.strictEqual(yield* agents.lastMessage("w1:p1"), "Done. Round half up, or to even?");
    }).pipe(Effect.scoped, Effect.provide(withFiles)),
  );

  it.effect("knows nothing of a pane without a session, and of coordination being off", () =>
    Effect.gen(function* () {
      const agents = yield* withTranscript([said("Done.")]);
      assert.isUndefined(yield* agents.lastMessage("w9:p9"));
      yield* agents.attach(null);
      assert.isUndefined(yield* agents.lastMessage("w1:p1"));
    }).pipe(Effect.scoped, Effect.provide(withFiles)),
  );

  it.effect("knows nothing when the transcript is gone or holds no words of the agent", () =>
    Effect.gen(function* () {
      const agents = yield* PeerAgents.PeerAgents;
      const dir = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({
        prefix: "peer-agents-transcript-",
      });
      vi.stubEnv("CLAUDE_CONFIG_DIR", dir);
      yield* agents.attach(hookedBroker(undefined));
      assert.isUndefined(yield* agents.lastMessage("w1:p1"));
      yield* agents.attach(hookedBroker(`${dir}/moved.jsonl`));
      assert.isUndefined(yield* agents.lastMessage("w1:p1"));
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(`${dir}/empty.jsonl`, record("user", "Hello") + "\n");
      yield* agents.attach(hookedBroker(`${dir}/empty.jsonl`));
      assert.isUndefined(yield* agents.lastMessage("w1:p1"));
    }).pipe(Effect.scoped, Effect.provide(withFiles)),
  );

  it.effect(
    "reads no more than the end of a long transcript, and never an older message for it",
    () =>
      Effect.gen(function* () {
        // A long session whose last words are short are found at its end.
        const long = yield* withTranscript([
          said("x".repeat(100_000)),
          record("user", "And now?"),
          said("Ready."),
        ]);
        assert.strictEqual(yield* long.lastMessage("w1:p1"), "Ready.");
        // Last words longer than the end it reads are unknown, not the message before them.
        const longer = yield* withTranscript([said("Old words."), said("y".repeat(40_000))]);
        assert.isUndefined(yield* longer.lastMessage("w1:p1"));
      }).pipe(Effect.scoped, Effect.provide(withFiles)),
  );
});
