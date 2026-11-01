// @effect-diagnostics nodeBuiltinImport:off - Peer Mod's receipts on the broker's socket.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * What reaches an agent: what it hears when its session starts, Peer's news at each step, and
 * for a Peer Mod session the receipt saying its model got a delivery, which only then counts
 * as injected.
 *
 * @module peerHub/core/broker/delivery
 */
import { pluginsForWorkspace } from "./pluginScope.ts";
import type * as NodeHttp from "node:http";
import * as Effect from "effect/Effect";

import { newsFor, startText } from "../coordination/news.ts";
import { EVERY_COMMAND, INDEX_ALL, INDEX_SHOWN, indexText } from "../index/text.ts";
import type { CoordinationBroker } from "./Broker.ts";
import { commandsOn } from "./cli.ts";
import type { PeerBrokerPlugins } from "./host.ts";
import {
  type PipelineStep,
  type PreparedDelivery,
  notifyDeliveries,
  remainingMs,
  stepNotices,
  withPluginText,
} from "./pipeline.ts";
import { headerOf, parseJson, respond } from "./server.ts";
import type { LocalSession } from "./sessions.ts";

/** What a hook's answer puts into the agent's context, in characters: its text, and the reason of a refusal. */
export function injectedChars(out: Record<string, unknown> | null): number {
  const answer = out?.hookSpecificOutput as
    | {
        readonly additionalContext?: unknown;
        readonly permissionDecision?: unknown;
        readonly permissionDecisionReason?: unknown;
      }
    | undefined;
  const text = typeof answer?.additionalContext === "string" ? answer.additionalContext.length : 0;
  const reason =
    answer?.permissionDecision === "deny" && typeof answer.permissionDecisionReason === "string"
      ? answer.permissionDecisionReason.length
      : 0;
  return text + reason;
}

/**
 * The text a hook's answer puts into the agent's context: its additional context, and the reason of
 * a refusal, which the agent reads as well. A delivery whose text is in it reached the answer.
 */
export function carriedText(out: Record<string, unknown> | null): string {
  const answer = out?.hookSpecificOutput as
    | {
        readonly additionalContext?: unknown;
        readonly permissionDecision?: unknown;
        readonly permissionDecisionReason?: unknown;
      }
    | undefined;
  return [
    answer?.additionalContext,
    answer?.permissionDecision === "deny" ? answer.permissionDecisionReason : undefined,
  ]
    .filter((part): part is string => typeof part === "string")
    .join("\n");
}

/** What a session hears when it starts, with what a clone bound by its remote left for it. */
export async function startContextFor(
  this: CoordinationBroker,
  session: LocalSession,
  source: string,
  plugins: PeerBrokerPlugins,
  tools = false,
): Promise<string> {
  session.starting = true;
  try {
    // A clone bound by its remote as this session started: said once, before the start text.
    const bound = (await this.host.bindingNotice?.(session.root).catch(() => null)) ?? null;
    const start = await this.startedContext(
      session,
      source,
      pluginsForWorkspace(plugins, session.workspace),
      tools,
    );
    return bound === null ? start : `Peer: ${bound}\n\n${start}`;
  } finally {
    session.starting = false;
  }
}

export async function startedContext(
  this: CoordinationBroker,
  session: LocalSession,
  source: string,
  plugins: PeerBrokerPlugins,
  tools = false,
): Promise<string> {
  // Who else is at work is worth a fresh look now.
  await this.syncNow(session.workspace, 1500);
  // What it would be told at its next step is in what it hears now.
  for (const pending of tools ? [] : session.pending.splice(0)) {
    if (typeof pending !== "string") await notifyDeliveries(pending.deliveries, "dropped");
  }
  const startLines = (
    await Promise.all(
      plugins.active.map(({ contributions }) => {
        const read = contributions.hooks?.startLine;
        return read === undefined
          ? Promise.resolve(null)
          : this.host.run(
              read.pipe(
                Effect.timeout(100),
                Effect.catchCause(() => Effect.succeed(null)),
              ),
            );
      }),
    )
  )
    .filter((line): line is string => line !== null && line.length <= 300)
    .slice(0, 3);
  const text = startText({
    startLines,
    me: this.me(session),
    ...(tools || session.adapter === "mcp"
      ? { tools: true }
      : session.agent === "codex"
        ? { cliPath: this.scripts.peer }
        : {}),
    index: indexText({
      works: this.board(session, INDEX_ALL),
      cli: this.cli,
      shown: INDEX_SHOWN,
    }),
  });
  this.record("context.injected", { session: session.id, source, bytes: text.length });
  return text;
}

/**
 * The session's overlaps it was not told about and, unless `pending` is false, what waits for its
 * next step.
 */
export function news(
  this: CoordinationBroker,
  session: LocalSession,
  options: {
    readonly pending?: boolean;
    readonly deliveries?: PreparedDelivery[] | undefined;
    readonly plugins?: PeerBrokerPlugins | undefined;
  } = {},
): string | null {
  const news = newsFor({
    me: this.asHub(session),
    view: this.merged(session.workspace, this.views.get(session.workspace)),
    memory: session.memory,
    nameOf: this.nameOf(session.workspace),
    taskName: this.taskNamer(session.workspace, session.project),
    cli: this.cli,
    on: options.plugins === undefined ? EVERY_COMMAND : commandsOn(options.plugins),
  });
  if (news !== null) {
    for (const id of news.announced) session.memory.announced.add(id);
    this.record("news", { session: session.id, text: news.text, announced: news.announced });
  }
  const parts = [news?.text ?? null];
  const before: string[] = [];
  if (options.pending !== false) {
    parts.push(
      ...session.pending.splice(0).flatMap((part) => {
        if (typeof part === "string") return [part];
        if (
          options.plugins &&
          part.deliveries.some(
            (ref) => !options.plugins!.active.some((plugin) => plugin.id === ref.plugin),
          )
        ) {
          void notifyDeliveries(part.deliveries, "dropped");
          return [];
        }
        options.deliveries?.push(...part.deliveries);
        if (part.first) {
          before.push(part.text);
          return [];
        }
        return [part.text];
      }),
    );
  }
  const said = [...before, ...parts.filter((part) => part !== null)];
  return said.length === 0 ? null : said.join("\n\n");
}

/** Core's news for a step, then the active plugins' notices. */
export async function newsContext(
  this: CoordinationBroker,
  event: string,
  session: LocalSession,
  step: PipelineStep,
  body: Record<string, unknown>,
) {
  const notices = stepNotices(step, this.toolContext(session, body, "pre-tool", remainingMs(step)));
  const text = withPluginText(
    this.news(session, { deliveries: step.deliveries, plugins: step.plugins }),
    await notices,
  );
  return text === null
    ? null
    : { hookSpecificOutput: { hookEventName: event, additionalContext: text } };
}

/**
 * What a Peer Mod session reports: that its model got a delivery (`/delivery`), whose text only
 * then counts as injected, or its provider's token usage (`/usage`).
 */
export function modReport(
  this: CoordinationBroker,
  url: string,
  request: NodeHttp.IncomingMessage,
  raw: string,
  response: NodeHttp.ServerResponse,
): void {
  if (request.method !== "POST" || headerOf(request.headers, "x-peer-adapter") !== "mod") {
    respond(response, 400, "");
    return;
  }
  const body = parseJson(raw);
  const session = this.sessions.get(`claude:${String(body.session_id)}`);
  if (session === undefined || session.modAt === undefined) {
    respond(response, 404, "");
    return;
  }
  if (url === "/delivery") {
    const receipt = session.deliveries.get(String(body.id));
    if (receipt === undefined || body.evidence !== "model-input") {
      respond(response, 400, "");
      return;
    }
    if (!receipt.acknowledged) {
      receipt.acknowledged = true;
      session.injected.set(
        receipt.event,
        (session.injected.get(receipt.event) ?? 0) + receipt.text.length,
      );
      this.record("delivery.verified", {
        session: session.id,
        runtimeGeneration: session.runtimeGeneration,
        id: body.id,
        evidence: body.evidence,
        chars: receipt.text.length,
      });
      void notifyDeliveries(receipt.refs ?? [], "modelInput", receipt.text);
    }
  } else {
    const usage =
      typeof body.usage === "object" && body.usage !== null
        ? Object.fromEntries(
            Object.entries(body.usage)
              .filter(([, n]) => typeof n === "number" && Number.isFinite(n) && n >= 0)
              .slice(0, 30),
          )
        : {};
    if (Object.keys(usage).length === 0) {
      respond(response, 400, "");
      return;
    }
    this.record("provider.usage", {
      session: session.id,
      runtimeGeneration: session.runtimeGeneration,
      usage,
      turnId: typeof body.turnId === "string" ? body.turnId : undefined,
      index: typeof body.index === "number" ? body.index : undefined,
      agentId: typeof body.agentId === "string" ? body.agentId : undefined,
    });
  }
  respond(response, 204, "");
}
