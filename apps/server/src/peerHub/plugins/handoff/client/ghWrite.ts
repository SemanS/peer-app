// @effect-diagnostics nodeBuiltinImport:off - bodies are written to gh stdin, without a shell.
import * as NodeChildProcess from "node:child_process";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Clock from "effect/Clock";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import { commandPath } from "../../../core/local.ts";
import { pullRequest } from "../targets.ts";
const decodeBody = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ body: Schema.String, state: Schema.String })),
);
const decodeComment = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({ id: Schema.Number, login: Schema.String, body: Schema.String }),
  ),
);
const encodeBody = Schema.encodeSync(Schema.fromJsonString(Schema.Struct({ body: Schema.String })));
export class GhError extends Error {
  readonly kind: string;
  constructor(kind: string) {
    super(kind);
    this.kind = kind;
  }
}
export type Run = (args: ReadonlyArray<string>, body?: string) => Effect.Effect<string, GhError>;
export function makeGh(path: string | null) {
  const run: Run = (args, body) =>
    path === null
      ? Effect.fail(new GhError("GitHub CLI not installed"))
      : Effect.callback<string, GhError>((resume) => {
          const child = NodeChildProcess.execFile(
            path,
            [...args],
            {
              maxBuffer: 4 * 1024 * 1024,
              env: {
                ...process.env,
                GH_PROMPT_DISABLED: "1",
                GH_NO_UPDATE_NOTIFIER: "1",
                NO_COLOR: "1",
              },
            },
            (error, out, err) => {
              resume(
                error
                  ? Effect.fail(
                      new GhError(
                        Number(error.code) === 4 || err.includes("gh auth login")
                          ? "GitHub CLI signed out"
                          : /403|permission/i.test(err)
                            ? "no permission"
                            : /404|not found/i.test(err)
                              ? "pull request not found"
                              : /rate limit/i.test(err)
                                ? "rate limited"
                                : "GitHub CLI failed",
                      ),
                    )
                  : Effect.succeed(out.trim()),
              );
            },
          );
          child.stdin?.end(body ?? "");
          return Effect.sync(() => {
            child.kill("SIGTERM");
          });
        }).pipe(
          Effect.timeout("5 seconds"),
          Effect.catch((error) =>
            Effect.fail(error instanceof GhError ? error : new GhError("GitHub CLI timeout")),
          ),
        );
  return run;
}
export function adapter(run: Run) {
  const cache = new Map<string, { at: number; value: string }>();
  const locks = new Map<string, Semaphore.Semaphore>();
  const cached = (key: string, args: ReadonlyArray<string>) =>
    Effect.gen(function* () {
      let lock = locks.get(key);
      if (!lock) {
        lock = yield* Semaphore.make(1);
        locks.set(key, lock);
      }
      return yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis,
            hit = cache.get(key);
          if (hit && now - hit.at < 600000) return hit.value;
          const value = yield* run(args);
          cache.set(key, { at: now, value });
          return value;
        }),
      );
    });
  const checked = (
    url: string,
  ): Effect.Effect<NonNullable<ReturnType<typeof pullRequest>>, GhError> => {
    const p = pullRequest(url);
    return p ? Effect.succeed(p) : Effect.fail(new GhError("invalid pull request URL"));
  };
  return {
    run,
    visibility: (repo: string) =>
      cached(repo, ["repo", "view", repo, "--json", "visibility", "--jq", ".visibility"]),
    login: () => cached("login", ["api", "user", "--jq", ".login"]),
    read: (url: string) =>
      checked(url).pipe(
        Effect.andThen(run(["pr", "view", url, "--json", "body,state"])),
        Effect.flatMap(decodeBody),
        Effect.mapError((error) =>
          error instanceof GhError ? error : new GhError("invalid GitHub response"),
        ),
      ),
    write: (url: string, body: string) =>
      checked(url).pipe(Effect.andThen(run(["pr", "edit", url, "--body-file", "-"], body))),
    comments: (url: string) =>
      checked(url).pipe(
        Effect.flatMap((p) =>
          run([
            "api",
            `repos/${p.repository}/issues/${p.number}/comments`,
            "--paginate",
            "--jq",
            '.[] | select(.body | startswith("<!-- peer:handoff")) | {id, login: .user.login, body}',
          ]),
        ),
        Effect.flatMap((s) =>
          Effect.forEach(s.split("\n").filter(Boolean), (line) => decodeComment(line)),
        ),
        Effect.mapError((error) =>
          error instanceof GhError ? error : new GhError("invalid GitHub response"),
        ),
      ),
    editComment: (url: string, id: number, body: string) =>
      checked(url).pipe(
        Effect.flatMap((p) =>
          run(
            [
              "api",
              "--method",
              "PATCH",
              `repos/${p.repository}/issues/comments/${id}`,
              "--input",
              "-",
            ],
            encodeBody({ body }),
          ),
        ),
      ),
    addComment: (url: string, body: string) =>
      checked(url).pipe(Effect.andThen(run(["pr", "comment", url, "--body-file", "-"], body))),
    deleteComment: (url: string, id: number) =>
      checked(url).pipe(
        Effect.flatMap((p) =>
          run(["api", "--method", "DELETE", `repos/${p.repository}/issues/comments/${id}`]),
        ),
      ),
  };
}
export class GhWrite extends Context.Service<GhWrite, ReturnType<typeof adapter>>()(
  "t3/peerHub/plugins/handoff/client/ghWrite",
) {}
export const layer = Layer.sync(GhWrite, () => adapter(makeGh(commandPath("gh"))));
