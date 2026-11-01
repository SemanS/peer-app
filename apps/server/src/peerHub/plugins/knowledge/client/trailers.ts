/** kontext selects knowledge trailers before a jj landing command; Peer appends missing ones after it.
 * All jj calls use --ignore-working-copy so they cannot snapshot between the command's steps.
 * Immutable changes and steps without enough time are left for a later landing.
 */
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

import { jjInvocations, type PeerSessionView, type PeerToolContext } from "../../../core/plugin.ts";
import type { CheckoutKind } from "../../../core/vcs.ts";
import { engineStatus, type KontextClientShape } from "../../../kontext.ts";

/** Runs jj in `cwd` and answers its output; rejects when jj fails. */
export type JjRunner = (
  cwd: string,
  args: ReadonlyArray<string>,
  timeoutMs: number,
) => Promise<string>;

/** The trailers a landing command's change should carry, read before it ran. */
export interface PreparedTrailers {
  /** The shell command they were read for: the step after it applies them, no other. */
  readonly command: string;
  /** The revision the command describes once it ran: `@-` after a commit or squash, `@` after a describe. */
  readonly target: "@" | "@-";
  /** `Decision: <id>` lines, as kontext printed them. */
  readonly trailers: ReadonlyArray<string>;
}

/** What `applyTrailers` did to a change. */
export interface AppliedTrailers {
  readonly changeId: string;
  readonly added: ReadonlyArray<string>;
}

/** Subcommand options that name another revision or pick hunks, which Peer leaves alone. */
const DESCRIBE_ELSEWHERE = new Set(["-r", "--revision", "--revisions"]);
const SQUASH_ELSEWHERE = new Set([
  "-r",
  "--revision",
  "--revisions",
  "-f",
  "--from",
  "-t",
  "--to",
  "--into",
  "-i",
  "--interactive",
  "--tool",
]);
/** Options that take the next word as their value, jj's own global ones included. */
const VALUED = new Set([
  "-m",
  "--message",
  "--author",
  "-R",
  "--repository",
  "--at-op",
  "--at-operation",
  "--config",
  "--config-toml",
  "--config-file",
  "--color",
]);

/** `--opt=value` names `--opt`; `-mtext` names `-m`. */
const optionName = (word: string) =>
  word.startsWith("--") ? word.split("=")[0]! : word.length > 2 ? word.slice(0, 2) : word;

/**
 * The change a jj command line describes, from its words alone: `jj commit` (then `@-` holds it),
 * `jj squash` into the parent (`@-`), or `jj describe` of the working copy (`@`). A describe or
 * squash that names another revision, or picks hunks, is not read; nor is a line with none of
 * them. The first such run of a compound line counts.
 */
export function describedChange(command: string): PreparedTrailers["target"] | null {
  for (const run of jjInvocations(command)) {
    const word = run.subcommand[0];
    const { args } = run;
    if (word === "commit") return "@-";
    if (word !== "describe" && word !== "squash") continue;
    const elsewhere = word === "describe" ? DESCRIBE_ELSEWHERE : SQUASH_ELSEWHERE;
    let positional = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--") {
        positional ||= i + 1 < args.length;
        break;
      }
      if (arg.startsWith("-") && arg !== "-") {
        const name = optionName(arg);
        if (elsewhere.has(name)) return null;
        if (VALUED.has(name) && arg === name) i++;
        continue;
      }
      positional = true;
    }
    // A describe of a named revision targets it, not `@`; a squash of named files still goes into `@-`.
    if (word === "describe" && positional) return null;
    return word === "describe" ? "@" : "@-";
  }
  return null;
}

/** A trailer line as kontext prints it: `Key: id`. */
const TRAILER = /^\s*([A-Z][\w-]*: \S+)\s*$/;

/**
 * The trailers of kontext's `prepare-commit` report: the lines of its "Commit trailers" section.
 * A report without the section (nothing to ship, or a team that turned trailers off) has none.
 */
export function trailersIn(report: string): ReadonlyArray<string> {
  const lines = report.split("\n");
  const start = lines.findIndex((line) => line.startsWith("## Commit trailers"));
  if (start === -1) return [];
  const found: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    const match = TRAILER.exec(line);
    if (match !== null) found.push(match[1]!);
  }
  return [...new Set(found)];
}

/** A line that reads as a trailer (`Key: value`), as git takes them. */
const isTrailerLine = (line: string) => /^[A-Za-z][\w-]*: \S/.test(line);

/**
 * The description with the trailers it lacks appended, or null when it has them all. They join an
 * ending paragraph of trailers, or start one after a blank line (the subject alone is never a
 * trailer paragraph, however `feat: cents` reads); an undescribed change gets none, since a
 * description of trailers alone would make the first of them its subject.
 */
export function withTrailers(
  description: string,
  trailers: ReadonlyArray<string>,
): { readonly text: string; readonly added: ReadonlyArray<string> } | null {
  const body = description.trimEnd();
  if (body.trim() === "") return null;
  const present = new Set(body.split("\n").map((line) => line.trim()));
  const added = trailers.filter((trailer) => !present.has(trailer));
  if (added.length === 0) return null;
  const paragraphs = body.split(/\n[ \t]*\n/);
  const last = paragraphs.at(-1) ?? "";
  const joins = paragraphs.length > 1 && last.split("\n").every(isTrailerLine);
  return { text: `${body}${joins ? "\n" : "\n\n"}${added.join("\n")}\n`, added };
}

/**
 * The trailers a landing command's change should carry, from kontext's `prepare-commit` report of
 * the working copy in `root` (under jj, that report is the one). Null when kontext is not there,
 * the report fails, or it names none.
 */
export async function prepareTrailers(
  kontext: KontextClientShape,
  root: string,
  command: string,
  timeoutMs: number,
): Promise<PreparedTrailers | null> {
  const target = describedChange(command);
  if (target === null) return null;
  const run = await kontext.run(["-C", root, "prepare-commit"], root, undefined, timeoutMs);
  if (run.code !== 0) return null;
  const trailers = trailersIn(run.stdout);
  return trailers.length === 0 ? null : { command, target, trailers };
}

const READ = ["--ignore-working-copy", "--no-graph"] as const;

/**
 * Appends the prepared trailers a change's description lacks, when the change touches the store
 * (`storeDir`, relative to `root`, the jj workspace root). Null when the change touches no
 * knowledge, is undescribed, has the trailers already, or jj refused to read or rewrite it.
 */
export async function applyTrailers(
  jj: JjRunner,
  root: string,
  prepared: PreparedTrailers,
  storeDir: string,
  timeoutMs: number,
): Promise<AppliedTrailers | null> {
  try {
    const shown = await jj(
      root,
      ["log", ...READ, "-r", prepared.target, "-T", 'change_id ++ "\\n" ++ description'],
      timeoutMs,
    );
    const newline = shown.indexOf("\n");
    const changeId = (newline === -1 ? shown : shown.slice(0, newline)).trim();
    if (!/^[k-z]{8,}$/.test(changeId)) return null;
    const description = newline === -1 ? "" : shown.slice(newline + 1);
    const store = storeDir.replace(/^\.\//, "").replace(/\/+$/, "");
    const files = (
      await jj(root, ["diff", "--ignore-working-copy", "-r", changeId, "--name-only"], timeoutMs)
    )
      .split("\n")
      .map((line) => line.trim());
    if (!files.some((file) => file === store || file.startsWith(`${store}/`))) return null;
    const next = withTrailers(description, prepared.trailers);
    if (next === null) return null;
    await jj(
      root,
      ["describe", "--ignore-working-copy", "-r", changeId, "-m", next.text],
      timeoutMs,
    );
    return { changeId, added: next.added };
  } catch {
    return null;
  }
}

/** What the step after the command says: which trailers Peer added to which change. */
export const trailersNotice = (applied: AppliedTrailers) =>
  `[peer knowledge] Added to change ${applied.changeId.slice(0, 8)} the commit trailer${applied.added.length === 1 ? "" : "s"} jj's commit left out (kontext's hook would have): ${applied.added.join(", ")}.`;

/** What a landing step's reads leave the rest of the step, and the least they need. */
const MARGIN_MS = 1_000;
const LEAST_MS = 400;

/**
 * The two halves at a session's tool steps: `before` a shell command that describes a change in a
 * jj checkout with a store, the trailers it should carry go into the session's `slot`; `after` it
 * ran, they go onto the change. A checkout without kontext or a store is said once per session in
 * the log and never asked again until `freshMs` passes.
 */
export function trailerFlows(input: {
  readonly kontext: KontextClientShape;
  readonly jj: JjRunner;
  readonly checkout: (cwd: string) => Promise<CheckoutKind | null>;
  /** How long a checkout's store, or its absence, is remembered. */
  readonly freshMs: number;
  readonly log: (event: string, fields: Record<string, unknown>) => Effect.Effect<void>;
  /** The session's place for what `before` read, kept by the knowledge plugin's per-session state. */
  readonly slot: (session: PeerSessionView) => { trailers: PreparedTrailers | undefined };
}) {
  const stores = new Map<string, { readonly at: number; readonly dir: string | null }>();
  const saidAbsent = new Set<string>();

  /** The store directory of a jj checkout, from kontext's status; null without kontext or a store. */
  const storeOf = Effect.fn("KnowledgeTrailers.storeOf")(function* (ctx: PeerToolContext) {
    const checkout = yield* Effect.promise(() => input.checkout(ctx.session.cwd));
    if (checkout === null || checkout.kind !== "jj") return null;
    const now = yield* Clock.currentTimeMillis;
    const known = stores.get(checkout.root);
    const dir =
      known !== undefined && now - known.at < input.freshMs
        ? known.dir
        : yield* Effect.promise(() =>
            engineStatus(input.kontext, checkout.root).then(
              (engine) => (engine.store.configured ? engine.store.dir : null),
              () => null,
            ),
          );
    stores.set(checkout.root, { at: now, dir });
    if (dir === null && !saidAbsent.has(ctx.session.id)) {
      saidAbsent.add(ctx.session.id);
      yield* input.log("knowledge.trailers-skipped", {
        session: ctx.session.id,
        reason: "no kontext store",
      });
    }
    return dir === null ? null : { root: checkout.root, dir };
  });

  const before = Effect.fn("KnowledgeTrailers.before")(function* (ctx: PeerToolContext) {
    const slot = input.slot(ctx.session);
    slot.trailers = undefined;
    if (
      ctx.command === undefined ||
      ctx.session.public === true ||
      describedChange(ctx.command) === null ||
      ctx.remainingMs < MARGIN_MS + LEAST_MS
    )
      return null;
    const store = yield* storeOf(ctx);
    if (store === null) return null;
    const command = ctx.command;
    slot.trailers = yield* Effect.promise(() =>
      prepareTrailers(input.kontext, store.root, command, ctx.remainingMs - MARGIN_MS).then(
        (prepared) => prepared ?? undefined,
      ),
    );
    return null;
  });

  const after = Effect.fn("KnowledgeTrailers.after")(function* (ctx: PeerToolContext) {
    const slot = input.slot(ctx.session);
    const prepared = slot.trailers;
    slot.trailers = undefined;
    if (prepared === undefined || prepared.command !== ctx.command || ctx.failed === true)
      return null;
    if (ctx.remainingMs < MARGIN_MS + LEAST_MS) {
      yield* input.log("knowledge.trailers-late", { session: ctx.session.id });
      return null;
    }
    const store = yield* storeOf(ctx);
    if (store === null) return null;
    const applied = yield* Effect.promise(() =>
      applyTrailers(
        input.jj,
        store.root,
        prepared,
        store.dir,
        Math.min(2_000, ctx.remainingMs - MARGIN_MS),
      ),
    );
    if (applied === null) return null;
    yield* input.log("knowledge.trailers", {
      session: ctx.session.id,
      change: applied.changeId,
      added: applied.added.length,
    });
    return trailersNotice(applied);
  });

  return { before, after };
}
