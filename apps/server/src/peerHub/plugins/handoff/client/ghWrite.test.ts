import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { adapter, GhError, makeGh } from "./ghWrite.ts";
it.effect(
  "caches visibility/login with the Effect clock, keeps body off argv and validates before spawn",
  () =>
    Effect.gen(function* () {
      const calls: Array<{ args: ReadonlyArray<string>; body?: string }> = [];
      const gh = adapter((args, body) =>
        Effect.sync(() => {
          calls.push({ args, ...(body ? { body } : {}) });
          return args[0] === "repo"
            ? "PUBLIC"
            : args[1] === "user"
              ? "ana"
              : args.includes("--paginate")
                ? ""
                : args.includes("body,state")
                  ? "{}"
                  : "";
        }),
      );
      yield* gh.visibility("o/r");
      yield* gh.visibility("o/r");
      assert.strictEqual(calls.length, 1);
      yield* TestClock.adjust("10 minutes");
      yield* gh.visibility("o/r");
      assert.strictEqual(calls.length, 2);
      const secret = "private package body";
      yield* gh.write("https://github.com/o/r/pull/1", secret);
      assert.deepStrictEqual(calls.at(-1), {
        args: ["pr", "edit", "https://github.com/o/r/pull/1", "--body-file", "-"],
        body: secret,
      });
      yield* gh.editComment("https://github.com/o/r/pull/1", 3, secret);
      assert.deepStrictEqual(calls.at(-1)?.args, [
        "api",
        "--method",
        "PATCH",
        "repos/o/r/issues/comments/3",
        "--input",
        "-",
      ]);
      const count = calls.length;
      const invalid = yield* gh
        .write("https://github.com/o/r/pull/1;rm", secret)
        .pipe(Effect.result);
      assert.strictEqual(invalid._tag, "Failure");
      assert.strictEqual(calls.length, count);
      const missing = yield* makeGh(null)(["api", "user"]).pipe(Effect.result);
      assert.strictEqual(missing._tag, "Failure");
      if (missing._tag === "Failure") assert.isTrue(missing.failure instanceof GhError);
    }),
);

// @effect-diagnostics nodeBuiltinImport:off - a temporary stand-in executable, never the person's gh.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as Schema from "effect/Schema";
const decodeEcho = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      args: Schema.Array(Schema.String),
      body: Schema.String,
      env: Schema.Array(Schema.String),
    }),
  ),
);
it.effect(
  "executes argv without a shell, sends bodies only on stdin and maps signed-out status",
  () =>
    Effect.gen(function* () {
      const dir = yield* Effect.acquireRelease(
        Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-gh-write-"))),
        (dir) => Effect.promise(() => NodeFSP.rm(dir, { recursive: true, force: true })),
      );
      const path = NodePath.join(dir, "gh");
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          path,
          '#!/usr/bin/env node\nlet body="";process.stdin.setEncoding("utf8");process.stdin.on("data",v=>body+=v);process.stdin.on("end",()=>{if(process.argv.includes("signed-out")){process.stderr.write("gh auth login");process.exit(4);}else process.stdout.write(JSON.stringify({args:process.argv.slice(2),body,env:[process.env.GH_PROMPT_DISABLED,process.env.GH_NO_UPDATE_NOTIFIER,process.env.NO_COLOR]}));});\n',
          { mode: 0o700 },
        ),
      );
      const run = makeGh(path);
      const out = decodeEcho(
        yield* run(
          ["pr", "edit", "https://github.com/o/r/pull/1", "--body-file", "-"],
          "private fixture",
        ),
      );
      assert.deepStrictEqual(out.args, [
        "pr",
        "edit",
        "https://github.com/o/r/pull/1",
        "--body-file",
        "-",
      ]);
      assert.strictEqual(out.body, "private fixture");
      assert.deepStrictEqual(out.env, ["1", "1", "1"]);
      const failure = yield* run(["signed-out"]).pipe(Effect.result);
      assert.strictEqual(failure._tag, "Failure");
      if (failure._tag === "Failure")
        assert.strictEqual(failure.failure.kind, "GitHub CLI signed out");
    }).pipe(Effect.scoped),
);
