import * as NodeServices from "@effect/platform-node/NodeServices";
import { afterEach, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import { vi } from "vite-plus/test";

import type { CoordinationBroker } from "../broker/Broker.ts";
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

describe("PeerAgents.asking", () => {
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
      assert.deepStrictEqual(yield* agents.asking("w1:p1"), {
        kind: "words",
        text: "Done. Round half up, or to even?",
      });
    }).pipe(Effect.scoped, Effect.provide(withFiles)),
  );

  it.effect("reads the question of an agent that waits for an answer, else its last words", () =>
    Effect.gen(function* () {
      const agents = yield* withTranscript([
        said("I need a decision."),
        record("assistant", [
          {
            type: "tool_use",
            id: "q1",
            name: "AskUserQuestion",
            input: {
              questions: [
                { header: "Rounding", question: "Round half up, or to even?", options: [] },
                { header: "Scope", question: "", options: [] },
              ],
            },
          },
        ]),
      ]);
      assert.deepStrictEqual(yield* agents.asking("w1:p1"), {
        kind: "question",
        text: "Round half up, or to even? · Scope",
      });
      const plain = yield* withTranscript([said("Which one?")]);
      assert.deepStrictEqual(yield* plain.asking("w1:p1"), { kind: "words", text: "Which one?" });
    }).pipe(Effect.scoped, Effect.provide(withFiles)),
  );

  it.effect("knows nothing of a pane without a session, and of coordination being off", () =>
    Effect.gen(function* () {
      const agents = yield* withTranscript([said("Done.")]);
      assert.isUndefined(yield* agents.asking("w9:p9"));
      yield* agents.attach(null);
      assert.isUndefined(yield* agents.asking("w1:p1"));
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
      assert.isUndefined(yield* agents.asking("w1:p1"));
      yield* agents.attach(hookedBroker(`${dir}/moved.jsonl`));
      assert.isUndefined(yield* agents.asking("w1:p1"));
      const fs = yield* FileSystem.FileSystem;
      yield* fs.writeFileString(`${dir}/empty.jsonl`, record("user", "Hello") + "\n");
      yield* agents.attach(hookedBroker(`${dir}/empty.jsonl`));
      assert.isUndefined(yield* agents.asking("w1:p1"));
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
        assert.deepStrictEqual(yield* long.asking("w1:p1"), { kind: "words", text: "Ready." });
        // Last words longer than the end it reads are unknown, not the message before them.
        const longer = yield* withTranscript([said("Old words."), said("y".repeat(40_000))]);
        assert.isUndefined(yield* longer.asking("w1:p1"));
      }).pipe(Effect.scoped, Effect.provide(withFiles)),
  );
});
