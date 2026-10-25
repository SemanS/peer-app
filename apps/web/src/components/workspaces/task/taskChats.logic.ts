/**
 * A task's chats as its page lists them: the person's own to open, a colleague's only to ask about,
 * each with its agent's state in words. Pure, like the rest of the task page's logic.
 */
import { harnessName, openKey, type AgentNeed } from "@t3tools/client-runtime/peer/work";
import type { PeerHubStatus, PeerProjectState, PeerWorkThread } from "@t3tools/contracts";

import type { SignalTone } from "../signals";
import type { WorkOpen, WorkThreadNode } from "../workTree.logic";
import { agoLabel, lastedLabel } from "./taskTime.logic";

/** What a row calls an agent nothing names, since its state always carries one. */
export const UNKNOWN_AGENT = "Agent";

export interface TaskChatState {
  /** "Claude · working 3 min", "Codex · idle 2 h": always with the agent's name. */
  readonly label: string;
  readonly tone: SignalTone;
}

export interface TaskChatRow {
  readonly key: string;
  readonly title: string;
  readonly mine: boolean;
  /** Whose chat it is, for the mark beside it. */
  readonly person: string;
  readonly agent: string;
  /** A colleague's address, for asking them; unknown when the Hub does not list the thread. */
  readonly email: string | undefined;
  readonly subtitle: string;
  readonly state: TaskChatState;
  readonly open: WorkOpen | undefined;
  /** Why a colleague's chat concerns the person, e.g. both agents change one file. */
  readonly concerns: string | undefined;
}

/** The hub's record of a thread the tree shows, found by the key the tree gave it. */
export function hubRecord(
  node: WorkThreadNode,
  state: PeerProjectState | undefined,
  status: Pick<PeerHubStatus, "email" | "environmentId">,
): PeerWorkThread | undefined {
  return state?.work.threads.find((record) => {
    const local = record.email === status.email && record.environment === status.environmentId;
    return (local ? record.id : `${record.environment}:${record.id}`) === node.key;
  });
}

/**
 * A chat's state as its row says it, always with the agent's name: working (and for how long),
 * asking the person, needing approval, turn finished, idle, or a status that is no longer current.
 */
export function chatState(
  thread: WorkThreadNode,
  input: { readonly agent: string; readonly need: AgentNeed | undefined; readonly now: number },
): TaskChatState {
  const { agent, need, now } = input;
  const say = (text: string, tone: SignalTone): TaskChatState => ({
    label: `${agent} · ${text}`,
    tone,
  });
  if (thread.stale) return say("status out of date", "neutral");
  if (thread.status === "unknown") return say("status unknown", "neutral");
  if (thread.status === "blocked") {
    if (!thread.mine) return say(`waiting on ${thread.person}`, "working");
    return say(need === "approval" ? "needs approval" : "asks you", "needs");
  }
  if (thread.status === "working") {
    const lasted = thread.activeAt === undefined ? null : lastedLabel(thread.activeAt, now);
    return say(lasted === null ? "working" : `working ${lasted}`, "working");
  }
  // How long an idle chat has been quiet is in its row's second line, as "last turn 2 h ago".
  if (thread.status === "done" || need === "review") return say("turn finished", "delivery");
  return say("idle", "neutral");
}

/** Where a chat runs and who can open it, in the words of its row. */
function whereLine(thread: WorkThreadNode): string {
  if (thread.mine) {
    if (thread.localEnvironment === true) return "this computer";
    return thread.open?.kind === "observe"
      ? "on your other computer, where you can watch it"
      : "on your other computer, so open it there";
  }
  const computer = `on ${thread.person}’s computer`;
  return thread.open?.kind === "observe"
    ? `${computer}, shared so you can watch it`
    : `${computer}, so only ${thread.person} can open it`;
}

/**
 * Everyone's chats on a task, the person's own first. `needs` is what Needs you says each of their
 * waiting chats waits for; `agentName` names an agent where the client knows more than its harness.
 */
export function chatRows(
  threads: ReadonlyArray<WorkThreadNode>,
  ctx: {
    readonly state: PeerProjectState | undefined;
    readonly status: PeerHubStatus;
    readonly needs: ReadonlyMap<string, AgentNeed>;
    readonly now: number;
    readonly agentName: ((thread: WorkThreadNode) => string | undefined) | undefined;
  },
): ReadonlyArray<TaskChatRow> {
  const { state, status, needs, now } = ctx;
  return threads
    .map((thread): TaskChatRow => {
      const agent = ctx.agentName?.(thread) ?? harnessName(thread.harness) ?? UNKNOWN_AGENT;
      const need = thread.open === undefined ? undefined : needs.get(openKey(thread.open));
      const idle = thread.status === "idle" || thread.status === "done";
      const lastTurn =
        thread.mine && thread.localEnvironment === true && idle && thread.activeAt !== undefined
          ? `last turn ${agoLabel(thread.activeAt, now)}`
          : undefined;
      const email = thread.mine
        ? (status.email ?? undefined)
        : (hubRecord(thread, state, status)?.email ??
          state?.project.members.find((member) => member.name === thread.person)?.email);
      return {
        key: thread.key,
        title: thread.title,
        mine: thread.mine,
        person: thread.person,
        agent,
        email,
        subtitle: [thread.mine ? "Yours" : `${thread.person}’s`, whereLine(thread), lastTurn]
          .filter((part) => part !== undefined)
          .join(" · "),
        state: chatState(thread, { agent, need, now }),
        open: thread.open,
        concerns: thread.concerns,
      };
    })
    .toSorted((a, b) => Number(b.mine) - Number(a.mine));
}
