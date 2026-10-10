/**
 * waits — the decision points of this computer's agents that Slack may carry (D11).
 *
 * A pure function of what Peer knows locally: the Peer threads, with the request one of them
 * waits on, and the agents herdr runs. A wait is named by a key made of identities only (a thread
 * with its request or run, an agent session with its turn), never of text, so a key lasts exactly
 * as long as its wait and a reworded prompt cannot make a second one. The publisher opens a key
 * once and withdraws it when it is gone. Every text leaves cleaned (`redact.ts`), none is raw.
 *
 * @module peerHub/plugins/slack/waits
 */
import {
  PROVIDER_DISPLAY_NAMES,
  type OrchestrationV2ThreadShell,
  type PeerLocalAgent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as NodeCrypto from "node:crypto";

import { cleanForSlack, SLACK_TEXT_MAX, titleForSlack } from "./redact.ts";

/** The Hub takes keys up to 256 characters; a long request or run id (Codex) becomes its hash. */
const WAIT_KEY_MAX = 200;
export function waitKeyOf(prefix: string, id: string): string {
  const key = `${prefix}${id}`;
  if (key.length <= WAIT_KEY_MAX) return key;
  return `${prefix}~${NodeCrypto.createHash("sha256").update(id).digest("hex").slice(0, 32)}`;
}

export type SlackWaitKind = "approval" | "question" | "finished" | "blocked";

export interface SlackTask {
  readonly id: string;
  readonly key?: string | undefined;
  readonly title: string;
}

/** Where a thread or an agent works: a project of a Peer workspace, and its task if it has one. */
export interface SlackPlace {
  readonly workspace: string;
  readonly project: string;
  readonly task?: SlackTask | undefined;
}

export interface SlackQuestion {
  readonly id: string;
  readonly question: string;
  /** An option is answered by its `value`, else its label, as the web question panel does. */
  readonly options: ReadonlyArray<{ readonly label: string; readonly value?: string | undefined }>;
  readonly multiSelect?: boolean | undefined;
  /** False when only an option may answer. */
  readonly allowCustomAnswer?: boolean | undefined;
}

/** What the request a thread waits on asks, read from its turn item. */
export type SlackRequest =
  | { readonly kind: "approval"; readonly requestId: string; readonly prompt?: string | undefined }
  | {
      readonly kind: "user_input";
      readonly requestId: string;
      readonly questions: ReadonlyArray<SlackQuestion>;
    };

/** The fields of a thread shell that the rules read. */
export type SlackShell = Pick<
  OrchestrationV2ThreadShell,
  | "id"
  | "projectId"
  | "title"
  | "providerInstanceId"
  | "lineage"
  | "archivedAt"
  | "status"
  | "activeRunId"
  | "activityRunStatus"
  | "latestRunId"
  | "latestRunCompletedAt"
  | "latestUserMessageAt"
  | "pendingRuntimeRequest"
  | "latestVisibleMessage"
  | "pendingBackgroundTasks"
>;

export interface SlackWaitThread {
  readonly shell: SlackShell;
  /** The request in `shell.pendingRuntimeRequest`, when the caller has read it. */
  readonly request?: SlackRequest | undefined;
  /**
   * The thread's latest visible message. The server's shells leave `latestVisibleMessage` null (a
   * message body lives in the thread, not in the shell), so the caller reads it for a thread
   * that may have finished; the shell's own is the fallback.
   */
  readonly latestMessage?: { readonly role: string; readonly text: string } | null | undefined;
  /** Undefined when the thread is not in a project of a Peer workspace. */
  readonly place: SlackPlace | undefined;
}

/** A herdr agent as the herdr plugin lists it, with its session and the number of its turn. */
export type SlackLocalAgent = PeerLocalAgent & {
  readonly session?: string | undefined;
  readonly turn?: number | undefined;
};

export interface SlackWaitAgent {
  readonly agent: SlackLocalAgent;
  /** Undefined when the agent does not work in a project of a Peer workspace. */
  readonly place: SlackPlace | undefined;
  /** The last assistant text of the agent's session, when Peer can read it. */
  readonly lastMessage?: string | undefined;
  /** The id the agent had while only its terminal was known (`herdr:{terminal}`), if still known. */
  readonly previousId?: string | undefined;
  /** When the agent reached its state (ISO), if known. */
  readonly statusAt?: string | undefined;
}

export interface SlackWaitInput {
  readonly threads: ReadonlyArray<SlackWaitThread>;
  readonly agents: ReadonlyArray<SlackWaitAgent>;
  /** The workspaces that have Slack connected. */
  readonly connectedWorkspaces: ReadonlySet<string>;
  /** This computer's display name. */
  readonly computer: string;
  /** The time (ISO) standing in as `since` for an agent whose state time is unknown. */
  readonly now: string;
}

export interface SlackWait {
  /** Names this decision point for as long as it lasts. */
  readonly waitKey: string;
  /** The agent session whose Slack thread this decision point goes into. */
  readonly subject: {
    readonly key: string;
    /** The key the same agent had before its session was known, so its thread stays. */
    readonly previous?: string;
    readonly title: string;
    readonly agent: string;
    readonly computer: string;
  };
  readonly kind: SlackWaitKind;
  readonly workspace: string;
  readonly project: string;
  readonly task?: { readonly id: string; readonly key?: string; readonly title: string };
  /** The task (`KEY title`) when there is one, else the thread's or agent's title. */
  readonly title: string;
  readonly text?: string;
  readonly options?: ReadonlyArray<string>;
  readonly decisions?: ReadonlyArray<"accept" | "decline">;
  /** When it began as far as Peer knows. */
  readonly since: string;
}

/** The display name of the provider a word names, by driver or by name: `codex`, `Claude`. */
const providerNamed = (word: string) =>
  Object.entries(PROVIDER_DISPLAY_NAMES).find(([driver, name]) =>
    [driver, name].some((candidate) => candidate?.toLowerCase() === word.toLowerCase()),
  )?.[1];
/** The provider behind an instance id such as `claudeAgent` or `codex_work`; "Agent" when unclear. */
const providerLabel = (instanceId: string) =>
  providerNamed(/^[a-z]+/i.exec(instanceId)?.[0] ?? "") ?? "Agent";

/** herdr's kinds of agent that people know under another name. */
const HERDR_AGENTS: Readonly<Record<string, string>> = { claude: "Claude Code", codex: "Codex" };
const agentLabel = (kind: string | undefined) =>
  kind === undefined || kind === ""
    ? "Agent"
    : (HERDR_AGENTS[kind] ?? providerNamed(kind) ?? kind.charAt(0).toUpperCase() + kind.slice(1));

/** Ends the text of a question that Slack cannot answer for Peer. */
const ANSWER_IN_PEER = "\n\nAnswer in Peer";
/** The buttons Slack shows for one question, and the characters of a button. */
const MAX_BUTTONS = 5;
const BUTTON_MAX = 75;

/** A text cleaned for Slack, or undefined when nothing is left of it. */
function body(text: string | undefined, max = SLACK_TEXT_MAX): string | undefined {
  const clean = cleanForSlack(text?.trim() ?? "", max);
  return clean === "" ? undefined : clean;
}
const withText = (text: string | undefined): { text?: string } =>
  text === undefined ? {} : { text };

type Shape = Pick<SlackWait, "waitKey" | "kind" | "text" | "options" | "decisions" | "since">;

/** What a request makes of its thread: an approval, or a question with buttons or without. */
function asked(request: SlackRequest, requestKind: string): Omit<Shape, "waitKey" | "since"> {
  if (request.kind === "approval") {
    const text = body(request.prompt) ?? `Approval needed: ${requestKind}`;
    return { kind: "approval", text, decisions: ["accept", "decline"] };
  }
  const [first, ...more] = request.questions;
  const single = more.length === 0 ? first : undefined;
  const buttons = single === undefined || single.multiSelect === true ? 0 : single.options.length;
  if (single !== undefined && buttons >= 1 && buttons <= MAX_BUTTONS) {
    const options = single.options.map(
      (option, i) => titleForSlack(option.label, BUTTON_MAX) || `Option ${i + 1}`,
    );
    return { kind: "question", ...withText(body(single.question)), options };
  }
  const questions = request.questions.map((question) => question.question).join("\n");
  const shown = body(questions, SLACK_TEXT_MAX - ANSWER_IN_PEER.length) ?? "";
  return { kind: "question", text: `${shown}${ANSWER_IN_PEER}`.trim() };
}

/**
 * When a thread's last run completed, if nothing has happened since: the thread is at rest
 * (`completed`, or `idle`), no run is active, no request waits, no work that wakes the agent is
 * outstanding (a command left running does not count), and the person has written nothing after
 * it. Ask this before reading the agent's last message, which only a thread with such a turn needs.
 */
export function turnEndedAt(shell: SlackShell): DateTime.Utc | undefined {
  const completedAt = shell.latestRunCompletedAt;
  const userAt = shell.latestUserMessageAt;
  const ended =
    completedAt != null &&
    shell.pendingRuntimeRequest === null &&
    (shell.status === "completed" || shell.status === "idle") &&
    shell.activeRunId === null &&
    shell.activityRunStatus == null &&
    !(shell.pendingBackgroundTasks ?? []).some((task) => task.kind !== "command") &&
    (userAt === null || DateTime.toEpochMillis(completedAt) > DateTime.toEpochMillis(userAt));
  return ended ? completedAt : undefined;
}

/** What a thread waits on, if anything: its pending request, else a turn that ended unanswered. */
function threadShape({ shell, request, latestMessage }: SlackWaitThread): Shape | undefined {
  const key = `peer:${shell.id}`;
  const pending = shell.pendingRuntimeRequest;
  if (pending !== null) {
    if (request === undefined || request.requestId !== pending.id) return undefined;
    const since = DateTime.formatIso(pending.createdAt);
    const waitKey = waitKeyOf(`${key}:req:`, pending.id);
    return { waitKey, ...asked(request, pending.kind), since };
  }
  const endedAt = turnEndedAt(shell);
  const message = latestMessage ?? shell.latestVisibleMessage;
  if (endedAt === undefined || shell.latestRunId === null || message?.role !== "assistant") {
    return undefined;
  }
  const waitKey = waitKeyOf(`${key}:run:`, shell.latestRunId);
  return {
    waitKey,
    kind: "finished",
    ...withText(body(message.text)),
    since: DateTime.formatIso(endedAt),
  };
}

interface Context {
  readonly connected: ReadonlySet<string>;
  readonly computer: string;
  readonly now: string;
}

const placed = (place: SlackPlace | undefined, context: Context): place is SlackPlace =>
  place !== undefined && context.connected.has(place.workspace);

/** The parts of a wait that do not depend on what it waits on. */
function common(
  place: SlackPlace,
  who: { key: string; previous: string | undefined; agent: string; own: string; fallback: string },
  computer: string,
) {
  const { task } = place;
  const taskTitle = task === undefined ? "" : titleForSlack(`${task.key ?? ""} ${task.title}`);
  const title = taskTitle || titleForSlack(who.own) || who.fallback;
  const taskKey = task?.key === undefined ? "" : titleForSlack(task.key);
  return {
    subject: {
      key: who.key,
      ...(who.previous === undefined ? {} : { previous: who.previous }),
      title,
      agent: who.agent,
      computer,
    },
    workspace: place.workspace,
    project: place.project,
    ...(task === undefined
      ? {}
      : {
          task: {
            id: task.id,
            ...(taskKey === "" ? {} : { key: taskKey }),
            title: titleForSlack(task.title),
          },
        }),
    title,
  };
}

function threadWait(thread: SlackWaitThread, context: Context): SlackWait | undefined {
  const { shell, place } = thread;
  if (!placed(place, context)) return undefined;
  if (shell.lineage.relationshipToParent === "subagent" || shell.archivedAt !== null) {
    return undefined;
  }
  const shape = threadShape(thread);
  if (shape === undefined) return undefined;
  const agent = providerLabel(shell.providerInstanceId);
  const key = `peer:${shell.id}`;
  const who = { key, previous: undefined, agent, own: shell.title, fallback: "Peer thread" };
  return { ...common(place, who, context.computer), ...shape };
}

/** Names a herdr agent's Slack thread: its own session once known, so it outlives its terminal. */
export const agentKey = ({ id, agent, session }: SlackLocalAgent) =>
  session === undefined ? id : `herdr:${agent ?? "agent"}:${session}`;

function agentWait(item: SlackWaitAgent, context: Context): SlackWait | undefined {
  const { agent, place } = item;
  const blocked = agent.status === "blocked";
  if ((!blocked && agent.status !== "done") || !placed(place, context)) return undefined;
  const { session } = agent;
  const key = agentKey(agent);
  const earlier = item.previousId ?? agent.id;
  const label = agentLabel(agent.agent);
  const previous = session !== undefined && earlier !== key ? earlier : undefined;
  const who = { key, previous, agent: label, own: agent.title, fallback: label };
  return {
    ...common(place, who, context.computer),
    waitKey: `${key}:${blocked ? "blocked" : "done"}:${agent.turn ?? 0}`,
    kind: blocked ? "blocked" : "finished",
    // A blocked prompt is a notice: nothing of the terminal leaves the computer.
    ...withText(blocked ? undefined : body(item.lastMessage)),
    since: item.statusAt ?? context.now,
  };
}

/**
 * The decision points Slack may carry now: a Peer thread waiting on an approval or a question, one
 * that finished its turn, and a herdr agent that is blocked or done. Only what has a place in a
 * workspace with Slack connected, and never a subagent's or an archived thread.
 */
export function slackWaits(input: SlackWaitInput): ReadonlyArray<SlackWait> {
  const context: Context = {
    connected: input.connectedWorkspaces,
    computer: titleForSlack(input.computer) || "this computer",
    now: input.now,
  };
  return [
    ...input.threads.flatMap((thread) => threadWait(thread, context) ?? []),
    ...input.agents.flatMap((agent) => agentWait(agent, context) ?? []),
  ];
}
