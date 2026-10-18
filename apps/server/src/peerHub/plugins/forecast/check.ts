import type { PeerForecastCheck } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as Semaphore from "effect/Semaphore";
import type { JjClient } from "./client/jj.ts";
import type { Repository } from "./git.ts";
import { CHECK_GAP_MS, CHECK_MS } from "./limits.ts";

export type CheckJob = {
  key: string;
  cwd: string;
  repository: Repository;
  commits: readonly [string, string];
};
const outcomeOf = { passed: "clean", fails: "conflicts" } as const;

/**
 * The command a person set, run on each clean pair in a Jujutsu checkout. A pair runs again only
 * when a side's commit moved, at most once a minute, and the computer runs one check at a time.
 * Results are advice kept on the pair: they never stop a step and never mark work as landing.
 */
export function makeChecks(
  jj: JjClient,
  log: (event: string, fields: Readonly<Record<string, unknown>>) => Effect.Effect<void>,
  done: () => Effect.Effect<void>,
  timeoutMs = CHECK_MS,
) {
  return Effect.gen(function* () {
    const one = yield* Semaphore.make(1),
      signal = yield* Queue.dropping<void>(1);
    let command = "";
    const results = new Map<string, PeerForecastCheck>(),
      ran = new Map<string, { at: number; commits: string }>(),
      waiting = new Map<string, CheckJob>();
    const execute = (job: CheckJob) =>
      Effect.gen(function* () {
        const started = yield* Clock.currentTimeMillis,
          used = command;
        ran.set(job.key, { at: started, commits: job.commits.join("/") });
        const outcome = yield* jj
          .check(job.cwd, job.repository, job.commits, used, timeoutMs)
          .pipe(Effect.orElseSucceed(() => ({ state: "couldNotRead" as const })));
        const end = yield* Clock.currentTimeMillis;
        // A command changed meanwhile has cleared the results: this one is for the old command.
        if (used !== command) return;
        results.set(job.key, {
          state: outcome.state,
          ...("output" in outcome && outcome.output !== undefined
            ? { output: outcome.output }
            : {}),
          at: DateTime.formatIso(DateTime.makeUnsafe(end)),
          commits: job.commits,
        });
        yield* log("forecast.check", {
          pairs: 1,
          ms: end - started,
          outcome: outcomeOf[outcome.state as keyof typeof outcomeOf] ?? "unknown",
        });
      }).pipe(one.withPermits(1));
    const drain = Effect.gen(function* () {
      for (const [key, job] of [...waiting]) {
        waiting.delete(key);
        if (command !== "") yield* execute(job);
      }
      yield* done();
    });
    return {
      /** A new command forgets what the old one said. */
      setCommand: (next: string) =>
        Effect.sync(() => {
          if (next === command) return;
          command = next;
          results.clear();
          ran.clear();
          waiting.clear();
        }),
      /** "Check now": every pair may run again. */
      expedite: Effect.sync(() => ran.clear()),
      /** Queues the clean pairs whose commits moved. */
      consider: (jobs: ReadonlyArray<CheckJob>, now: number) =>
        Effect.gen(function* () {
          if (command === "") return;
          for (const job of jobs) {
            const last = ran.get(job.key);
            if (last?.commits === job.commits.join("/")) continue;
            if (last !== undefined && now - last.at < CHECK_GAP_MS) continue;
            waiting.set(job.key, job);
          }
          if (waiting.size > 0) yield* Queue.offer(signal, undefined);
        }),
      resultOf: (key: string) => results.get(key),
      /** Runs what is waiting, one at a time. */
      drain,
      work: Effect.forever(Queue.take(signal).pipe(Effect.andThen(drain))),
    };
  });
}
export type Checks = Effect.Success<ReturnType<typeof makeChecks>>;
