// @effect-diagnostics globalTimers:off globalDate:off - hook deadlines in the broker's wall-clock time.
/**
 * The hook pipeline: what the active plugins add to the broker's hook answers, after core's own.
 *
 * Core's text comes first (its start text, its news); each active plugin's text follows in registry
 * order, cut to its bound and ending with the plugin's command when cut. Plugins' text is read
 * concurrently, and what is not ready by the hook's deadline goes to the agent's next step, so a
 * plugin never holds a hook. On a tool call core's local checks come first, then the plugins'
 * verdicts within their budget (one that misses it gets its fallback, and the log says so), then
 * core's Hub intent: a plugin's deny skips the intent, so the Hub records no claim. Waking an idle
 * agent uses only the notices it must answer. With no plugin active, nothing here runs.
 *
 * @module peerHub/core/broker/pipeline
 */
import * as Effect from "effect/Effect";

import { cutText } from "../../peerText.ts";
import { contestKey, type EditAnswer } from "../coordination/edits.ts";
import type {
  PeerHookContext,
  PeerHookText,
  PeerSessionView,
  PeerToolContext,
  PeerVerdict,
} from "../plugin.ts";
import type { ActivePlugin } from "../plugins/PeerPlugins.ts";
import type { PeerBrokerHost, PeerBrokerPlugins } from "./host.ts";

/** How much one plugin adds to a session's start text, and to one step. */
export const START_BLOCK_MAX = 2000;
export const NOTICE_MAX = 1200;
/**
 * How long plugins' verdicts on a tool call may take together. It leaves core's Hub intent (2 s)
 * inside the hook's deadline (3.3 s; 7.5 s for Peer Mod).
 */
export const VERDICT_BUDGET_MS = 1000;
export const MOD_VERDICT_BUDGET_MS = 2500;
/** Text a hook carries is ready this long before the hook's deadline, so the answer still makes it. */
const TEXT_MARGIN_MS = 300;
/** How long a wake waits for plugins' notices; what comes later waits for the next step. */
const WAKE_TEXT_MS = 1000;

/** One hook of one session, as the pipeline runs plugins for it. */
export interface PipelineStep {
  readonly plugins: PeerBrokerPlugins;
  readonly session: PeerSessionView;
  readonly run: PeerBrokerHost["run"];
  readonly log: (event: string, fields: Record<string, unknown>) => void;
  /** Queues text for the session's next step. */
  readonly later: (
    text: string,
    deliveries?: ReadonlyArray<PreparedDelivery>,
    first?: boolean,
  ) => void;
  readonly deliveries?: PreparedDelivery[] | undefined;
  readonly cli: string;
  /** When the hook's answer is due (epoch ms). */
  readonly deadline: number;
}

/** Core retains the exact block with opaque plugin refs, never exposing refs on the wire. */
export interface PreparedDelivery {
  readonly text: string;
  readonly notify: (state: "offered" | "modelInput" | "dropped") => Promise<void>;
}
export interface PipelineText {
  readonly before: string | null;
  readonly after: string | null;
}

export const notifyDeliveries = async (
  deliveries: ReadonlyArray<PreparedDelivery>,
  state: "offered" | "modelInput" | "dropped",
  text?: string,
) => {
  await Promise.all(
    deliveries.map((delivery) =>
      delivery.notify(text === undefined || text.includes(delivery.text) ? state : "dropped"),
    ),
  );
};

/** The time plugins' text has left in a step. */
export const remainingMs = (step: PipelineStep) =>
  Math.max(0, step.deadline - TEXT_MARGIN_MS - Date.now());

/** The command that shows the rest of a plugin's cut text: its first. */
const commandOf = (plugin: ActivePlugin) => plugin.contributions.commands?.[0]?.name;

/** A plugin's text cut to `max` characters, ending with the `peer` command that shows the rest. */
export function cutPluginText(
  text: string,
  max: number,
  cli: string,
  command: string | undefined,
): string {
  if (text.length <= max) return text;
  const more = command === undefined ? "…" : `… (\`${cli} ${command}\` shows the rest)`;
  return `${cutText(text, max - more.length).trimEnd()}${more}`;
}

/** Joins what was said, in order; null when nothing was. */
const joinText = (...parts: ReadonlyArray<string | null>) => {
  const said = parts.filter((part) => part !== null && part !== "");
  return said.length === 0 ? null : said.join("\n\n");
};

/** Core's text with the plugins' after it: core's alone, exactly, while they add nothing. */
export const withPluginText = (core: string | null, theirs: string | PipelineText | null) =>
  theirs === null
    ? core
    : typeof theirs === "string"
      ? joinText(core, theirs)
      : joinText(theirs.before, core, theirs.after);

interface PluginText {
  readonly plugin: string;
  readonly command: string | undefined;
  readonly parts: ReadonlyArray<Effect.Effect<PeerHookText | null>>;
  readonly first?: boolean;
  readonly delivery?: ActivePlugin["contributions"]["hooks"];
}

/**
 * Each plugin's parts read at once, joined and cut to `max`, in registry order, as far as they are
 * ready by `until` (epoch ms); a plugin's text that comes later goes to the next step. A part that
 * fails says nothing, and the log says which plugin failed.
 */
function gather(
  step: PipelineStep,
  max: number,
  texts: ReadonlyArray<PluginText>,
  hook: string,
  until: number,
): Promise<PipelineText | null> {
  if (texts.length === 0) return Promise.resolve(null);
  const reading = texts.map(({ plugin, command, parts, first, delivery }) =>
    step
      .run(
        Effect.all(
          parts.map((part) =>
            part.pipe(
              Effect.catchCause((cause) =>
                Effect.sync(() => {
                  step.log("plugin.failed", {
                    plugin,
                    hook,
                    session: step.session.id,
                    cause: String(cause),
                  });
                  return null;
                }),
              ),
            ),
          ),
          { concurrency: "unbounded" },
        ),
      )
      .then(
        async (said) => {
          const blocks = said.filter((part): part is PeerHookText => part !== null);
          const text = joinText(
            ...blocks.map((part) => (typeof part === "string" ? part : part.text)),
          );
          if (text === null) return null;
          const deliveries = blocks.flatMap((part) =>
            typeof part === "string" || part.refs.length === 0 || delivery?.delivery === undefined
              ? []
              : [
                  {
                    text: part.text,
                    notify: (state: "offered" | "modelInput" | "dropped") =>
                      step
                        .run(delivery.delivery!({ session: step.session, refs: part.refs, state }))
                        .catch((cause: unknown) => {
                          step.log("plugin.failed", {
                            plugin,
                            hook: "delivery",
                            cause: String(cause),
                          });
                        }),
                  },
                ],
          );
          if (deliveries.length > 0 && text.length > max) {
            await notifyDeliveries(deliveries, "dropped");
            step.log("plugin.text.dropped", {
              plugin,
              hook,
              session: step.session.id,
              chars: text.length,
              max,
            });
            return null;
          }
          return {
            text: cutPluginText(text, max, step.cli, command),
            deliveries,
            first: first === true,
          };
        },
        () => null,
      ),
  );
  return new Promise((resolve) => {
    const ready = new Map<number, Awaited<(typeof reading)[number]>>();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // What is not ready yet reaches the agent at its next step.
      reading.forEach((text, at) => {
        if (ready.has(at)) return;
        void text.then((late) => {
          if (late === null) return;
          step.later(late.text, late.deliveries, late.first);
          step.log("plugin.late", { plugin: texts[at]?.plugin, hook, session: step.session.id });
        });
      });
      const blocks = reading.flatMap((_, at) => ready.get(at) ?? []);
      step.deliveries?.push(...blocks.flatMap((block) => block.deliveries));
      const before = joinText(...blocks.filter((block) => block.first).map((block) => block.text));
      const after = joinText(...blocks.filter((block) => !block.first).map((block) => block.text));
      resolve(before === null && after === null ? null : { before, after });
    };
    const timer = setTimeout(finish, Math.max(0, until - Date.now()));
    reading.forEach(
      (text, at) =>
        void text.then((said) => {
          if (done) return;
          ready.set(at, said);
          if (ready.size === reading.length) finish();
        }),
    );
  });
}

/** The active plugins' blocks of a session's start text. */
export function startBlocks(step: PipelineStep, source: string): Promise<PipelineText | null> {
  const ctx: PeerHookContext = {
    session: step.session,
    event: "session-start",
    source,
    remainingMs: remainingMs(step),
  };
  return gather(
    step,
    START_BLOCK_MAX,
    step.plugins.active.flatMap((plugin) => {
      const start = plugin.contributions.hooks?.sessionStart;
      return start === undefined
        ? []
        : [
            {
              plugin: plugin.id,
              command: commandOf(plugin),
              parts: [start(ctx)],
              first: plugin.contributions.hooks?.priority === "first",
              delivery: plugin.contributions.hooks,
            },
          ];
    }),
    "sessionStart",
    step.deadline - TEXT_MARGIN_MS,
  );
}

/**
 * The active plugins' notices for a step, with what each says of the tool call it finished
 * (`postTool`). Waking an idle agent reads only the notices it must answer, for a while of its own.
 */
export function stepNotices(
  step: PipelineStep,
  ctx: PeerHookContext | PeerToolContext,
  options: { readonly waking?: boolean } = {},
): Promise<PipelineText | null> {
  const waking = options.waking === true;
  const finished = ctx.event === "post-tool" && "tool" in ctx ? ctx : undefined;
  return gather(
    step,
    NOTICE_MAX,
    step.plugins.active.flatMap((plugin) => {
      const hooks = plugin.contributions.hooks;
      const parts = [
        ...(hooks?.notices ?? [])
          .filter((notice) => !waking || notice.wakes)
          .map((notice) => notice.read({ ...ctx, waking })),
        ...(finished === undefined || waking || hooks?.postTool === undefined
          ? []
          : [hooks.postTool(finished)]),
      ];
      return parts.length === 0
        ? []
        : [
            {
              plugin: plugin.id,
              command: commandOf(plugin),
              parts,
              first: hooks?.priority === "first",
              delivery: hooks,
            },
          ];
    }),
    waking ? "wake" : ctx.event,
    waking ? Date.now() + WAKE_TEXT_MS : step.deadline - TEXT_MARGIN_MS,
  );
}

/** What the active plugins add before a session's context is compacted. */
export function compactText(step: PipelineStep): Promise<PipelineText | null> {
  const ctx: PeerHookContext = {
    session: step.session,
    event: "pre-compact",
    remainingMs: remainingMs(step),
  };
  return gather(
    step,
    NOTICE_MAX,
    step.plugins.active.flatMap((plugin) => {
      const compact = plugin.contributions.hooks?.preCompact;
      return compact === undefined
        ? []
        : [{ plugin: plugin.id, command: commandOf(plugin), parts: [compact(ctx)] }];
    }),
    "preCompact",
    step.deadline - TEXT_MARGIN_MS,
  );
}

/** Runs the active plugins' handlers of an event that answers nothing, by the hook's deadline. */
export async function handlers(step: PipelineStep, event: "stop" | "session-end"): Promise<void> {
  const ctx: PeerHookContext = { session: step.session, event, remainingMs: remainingMs(step) };
  const running = step.plugins.active.flatMap((plugin) => {
    const handle =
      event === "stop" ? plugin.contributions.hooks?.stop : plugin.contributions.hooks?.sessionEnd;
    return handle === undefined
      ? []
      : [
          step.run(handle(ctx)).catch((error: unknown) => {
            step.log("plugin.failed", {
              plugin: plugin.id,
              hook: event,
              session: step.session.id,
              cause: String(error),
            });
          }),
        ];
  });
  if (running.length === 0) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(running),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, remainingMs(step));
    }),
  ]);
  clearTimeout(timer);
}

/** What a plugin says of a tool call. */
export interface PluginVerdict {
  readonly plugin: string;
  readonly verdict: PeerVerdict;
}

/** Which tool calls a plugin judges: those that edit files, shell commands, or both. */
const judges = (on: "edits" | "shell" | "all", kind: "edits" | "shell") =>
  on === "all" || on === kind;

/**
 * The verdicts of the active plugins that judge a call, in registry order, each decided within
 * `budgetMs`; a plugin that misses it, or fails, gets its fallback, and the log says so.
 */
export async function verdicts(
  step: PipelineStep,
  ctx: PeerToolContext,
  kind: "edits" | "shell",
  budgetMs: number,
): Promise<ReadonlyArray<PluginVerdict>> {
  const judging = step.plugins.active.flatMap((plugin) => {
    const preTool = plugin.contributions.hooks?.preTool;
    return preTool === undefined || !judges(preTool.on, kind)
      ? []
      : [{ plugin: plugin.id, preTool }];
  });
  if (judging.length === 0) return [];
  const missed = Symbol("missed");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<typeof missed>((resolve) => {
    timer = setTimeout(() => resolve(missed), budgetMs);
  });
  const said = await Promise.all(
    judging.map(async ({ plugin, preTool }) => {
      const decided = step.run(preTool.decide(ctx)).then(
        (verdict) => ({ verdict }),
        (error: unknown) => ({ error: String(error) }),
      );
      const outcome = await Promise.race([decided, expired]);
      if (outcome !== missed && "verdict" in outcome) {
        return outcome.verdict === null ? [] : [{ plugin, verdict: outcome.verdict }];
      }
      const fallback = preTool.fallback(ctx);
      step.log("plugin.verdict.fallback", {
        plugin,
        session: step.session.id,
        tool: ctx.tool,
        paths: ctx.paths,
        reason: outcome === missed ? "budget" : outcome.error,
        verdict: fallback?.decision ?? "none",
      });
      return fallback === null ? [] : [{ plugin, verdict: fallback }];
    }),
  );
  clearTimeout(timer);
  return said.flat();
}

/** What the active plugins' fallbacks say of a call, when the hook's own deadline passed. */
export function fallbacks(
  plugins: PeerBrokerPlugins,
  ctx: PeerToolContext,
  kind: "edits" | "shell",
): ReadonlyArray<PluginVerdict> {
  return plugins.active.flatMap((plugin) => {
    const preTool = plugin.contributions.hooks?.preTool;
    if (preTool === undefined || !judges(preTool.on, kind)) return [];
    const verdict = preTool.fallback(ctx);
    return verdict === null ? [] : [{ plugin: plugin.id, verdict }];
  });
}

/** A plugin's verdict worded as core's answers are: one key per file, which its person's approval settles. */
export const verdictAnswer = (
  { plugin, verdict }: PluginVerdict,
  files: ReadonlyArray<string>,
): EditAnswer => ({
  decision: verdict.decision,
  reason: verdict.reason,
  keys: files.map((file) => contestKey(`plugin:${plugin}`, file)),
  overlaps: [],
  with: [],
});

/**
 * A hook answer with the plugins' asks' reasons after its own: the stricter decision stands, and
 * its person or agent reads every reason.
 */
export function withReasons(
  output: Record<string, unknown>,
  reasons: ReadonlyArray<string>,
): Record<string, unknown> {
  const answer = output.hookSpecificOutput as Record<string, unknown> | undefined;
  const own = answer?.permissionDecisionReason;
  if (answer === undefined || typeof own !== "string" || reasons.length === 0) return output;
  const more = reasons.filter((reason) => !own.includes(reason));
  return more.length === 0
    ? output
    : {
        ...output,
        hookSpecificOutput: { ...answer, permissionDecisionReason: [own, ...more].join("\n\n") },
      };
}

/** The paths active plugins let a session touch without asking its person (Codex). */
export const ownPaths = (plugins: PeerBrokerPlugins, session: PeerSessionView) =>
  plugins.active.flatMap((plugin) => plugin.contributions.hooks?.ownPaths?.(session) ?? []);
