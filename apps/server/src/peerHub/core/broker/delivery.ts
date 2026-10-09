// @effect-diagnostics nodeBuiltinImport:off globalDate:off - agents' working contexts on disk, and Peer Mod's receipts in wall-clock time.
/* oxlint-disable oxc/no-this-in-exported-function -- The broker's methods: Broker.ts lists them on each broker, and their `this` parameter lets them run on nothing else. */
/**
 * What reaches an agent: what it hears when its session starts, Peer's news at each step, and
 * for a Peer Mod session the receipt saying its model got a delivery, which only then counts
 * as injected.
 *
 * @module peerHub/core/broker/delivery
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeHttp from "node:http";
import * as NodePath from "node:path";

import {
  contextTemplate,
  contextWritten,
  findingsOnWork,
  startContext,
  teamLines,
} from "../contexts/text.ts";
import { closerOf, newsFor } from "../coordination/news.ts";
import type { HubFinding } from "../hub/coordApi.ts";
import { INDEX_ALL, INDEX_SHOWN, indexText, KNOWLEDGE_SHOWN } from "../index/text.ts";
import type { CoordinationBroker } from "./Broker.ts";
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
import { sleepMs } from "./sync.ts";

/**
 * How long a session's start waits for this computer's copies of its project's other works' shared
 * contexts (`mirrorBoard`): its hook has a few seconds in all.
 */
const BOARD_START_WAIT_MS = 1200;

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
 * What a session hears when it starts: how to keep its working context (its
 * own, made now if it has none, or its work's shared one when it keeps that),
 * the context itself after a compaction or a resume, the shared context of its
 * work, and the findings it should hear now.
 */
export async function startContextFor(
  this: CoordinationBroker,
  session: LocalSession,
  source: string,
  plugins: PeerBrokerPlugins,
): Promise<string> {
  session.starting = true;
  try {
    return await this.startedContext(session, source, plugins);
  } finally {
    session.starting = false;
  }
}

export async function startedContext(
  this: CoordinationBroker,
  session: LocalSession,
  source: string,
  plugins: PeerBrokerPlugins,
): Promise<string> {
  await NodeFSP.mkdir(NodePath.dirname(session.ownContextPath), { recursive: true });
  let saved: string | undefined;
  try {
    saved = await NodeFSP.readFile(session.ownContextPath, "utf8");
    session.contextAt = (await NodeFSP.stat(session.ownContextPath)).mtimeMs;
  } catch {
    await NodeFSP.writeFile(
      session.ownContextPath,
      contextTemplate(
        session.label,
        session.task === undefined
          ? undefined
          : this.host.taskName(session.workspace, session.project, session.task),
      ),
    );
  }
  session.team = saved === undefined ? [] : teamLines(saved);
  // What the team found, and who keeps the work's shared context, are worth a fresh look now.
  await this.syncNow(session.workspace, 1500);
  await this.takeUp(session);
  // What it would be told at its next step is in what it hears now.
  for (const pending of session.pending.splice(0)) {
    if (typeof pending !== "string") await notifyDeliveries(pending.deliveries, "dropped");
  }
  const mirror = this.mirrorOf(session);
  const onWork = findingsOnWork(
    this.holder(session),
    this.findingsOf(session.workspace),
    session.heard,
  );
  let findings: HubFinding[] = [];
  if (session.keeps) {
    // What was found before the context last changed was there for the last keeper to fold in.
    const since = mirror === undefined || mirror.version === 0 ? 0 : Date.parse(mirror.updatedAt);
    findings = onWork.filter((finding) => Date.parse(finding.at) > since).slice(0, 10);
    for (const finding of onWork) session.heard.add(finding.id);
  } else if (this.keeperOf(session) === undefined) {
    findings = onWork.slice(0, 8);
    for (const finding of findings) session.heard.add(finding.id);
  } else if (mirror !== undefined && contextWritten(mirror.text)) {
    // Kept by another agent: what it has not folded in yet goes along with the context.
    const since = Date.parse(mirror.updatedAt);
    findings = onWork.filter((finding) => Date.parse(finding.at) > since).slice(0, 8);
    for (const finding of findings) session.heard.add(finding.id);
  }
  if (session.keeps) session.roster = this.agentsOn(session);
  if (!session.keeps && mirror !== undefined) {
    // It reads the context now; the first change after this is news at once.
    session.sharedHeard = mirror.version;
    session.sharedHeardText = mirror.text;
    session.sharedToldAt = 0;
  }
  // The project's other work, and where to read each: the index the agent chooses from. Its
  // hook waits a few seconds at most: copies still on their way are named by `peer context`.
  await Promise.race([this.mirrorBoard(session.workspace), sleepMs(BOARD_START_WAIT_MS)]);
  session.index = await this.indexOf(session, plugins);
  const works = this.indexWorks(session, INDEX_ALL);
  // A new conversation, or one that was compacted, knows nothing of the others' work yet: what
  // each builds comes with its next ask.
  session.told.clear();
  session.askIndexAt = 0;
  const text = startContext({
    me: this.me(session),
    ...(session.agent === "codex" ? { cliPath: this.scripts.peer } : {}),
    index: indexText({
      works,
      knowledge: this.indexSection(plugins, session.index.entries, KNOWLEDGE_SHOWN),
      now: Date.now(),
      cli: this.cli,
      shown: INDEX_SHOWN,
    }),
    on: session.index.on,
    own: {
      path: session.ownContextPath,
      saved: source === "compact" || source === "resume" ? saved : undefined,
    },
    shared: mirror === undefined ? undefined : { ...this.sharedOf(mirror), keeps: session.keeps },
    findings,
    agents: this.agentsOn(session).map((agent) => agent.name),
    nameOf: this.nameOf(session.workspace),
  });
  this.log("context.injected", {
    session: session.id,
    source,
    path: session.contextPath,
    keeps: session.keeps,
    shared: mirror === undefined ? undefined : { scope: mirror.scope, version: mirror.version },
    saved: saved?.length ?? 0,
    findings: findings.map((finding) => finding.id),
    index: works.slice(0, INDEX_SHOWN).map((entry) => entry.scope),
    knowledge: session.index.entries.length,
    bytes: text.length,
  });
  return text;
}

/**
 * What happened on the session's overlaps since it last heard, and (unless
 * `team` is false) what Peer has to tell it, what changed in its work's
 * shared context and what other agents found that concerns it.
 */
export function news(
  this: CoordinationBroker,
  session: LocalSession,
  options: {
    readonly team?: boolean;
    readonly waking?: boolean;
    readonly discovery?: boolean;
    readonly deliveries?: PreparedDelivery[] | undefined;
  } = {},
): string | null {
  const view = this.merged(session.workspace, this.views.get(session.workspace));
  const news = newsFor({
    me: this.asHub(session),
    view,
    memory: session.memory,
    nameOf: this.nameOf(session.workspace),
    taskName: this.taskNamer(session.workspace, session.project),
    closer: (overlap) => closerOf(overlap, view.sessions),
    ...(options.waking === true ? { waking: true } : {}),
    cli: this.cli,
  });
  if (news !== null) {
    for (const id of news.announced) session.memory.announced.add(id);
    for (const id of news.seen) session.memory.seenNotes.add(id);
    this.log("news", {
      session: session.id,
      text: news.text,
      announced: news.announced,
      seen: news.seen,
    });
  }
  // An overlap gone quiet that this agent closes is overlap news too: it may wake the agent.
  const parts = [news?.text ?? null, this.settleNews(session)];
  // Findings and shared contexts wait for the agent's next step; they never wake it.
  const before: string[] = [];
  if (options.team !== false) {
    const pending = session.pending.splice(0).flatMap((part) => {
      if (typeof part === "string") return [part];
      options.deliveries?.push(...part.deliveries);
      if (part.first) {
        before.push(part.text);
        return [];
      }
      return [part.text];
    });
    parts.push(
      ...pending,
      this.closeNews(session),
      this.rosterNews(session),
      this.sharedNews(session),
      this.findingNews(session),
      this.advise(session, "followed", () => this.followedNews(session), null),
      options.discovery === false
        ? null
        : this.advise(session, "index", () => this.discoveryFor(session), null),
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
  const text = withPluginText(this.news(session, { deliveries: step.deliveries }), await notices);
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
      this.log("delivery.verified", {
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
    this.log("provider.usage", {
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
