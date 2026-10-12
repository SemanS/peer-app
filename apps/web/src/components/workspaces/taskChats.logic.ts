import type { PeerWorkThread } from "@t3tools/contracts";

import type { SignalTone } from "./signals";
import { openKey, type AgentNeed, type WorkThreadNode } from "./workTree.logic";

/** The tones a task's or a chat's state takes: needs you, at work, delivered, or quiet. */
export type StateTone = Extract<SignalTone, "needs" | "working" | "delivery" | "neutral">;

export type ChatStateKind =
  | "working"
  | "asks"
  | "approval"
  | "finished"
  | "idle"
  | "offline"
  | "unknown";

/** A chat's state as the expanded task row says it: whose agent, and what it does or waits for. */
export interface ChatState {
  readonly kind: ChatStateKind;
  /** "Claude · working 3m", "Codex · needs approval". */
  readonly label: string;
  readonly tone: StateTone;
}

/**
 * What an agent is called in a state: the name the provider instance carries, as people say it
 * ("claude-code" is Claude). An agent nobody reported is just "Agent".
 */
export function agentName(reported: string | undefined): string {
  const name = reported?.trim() ?? "";
  if (name === "") return "Agent";
  const known: Readonly<Record<string, string>> = {
    claude: "Claude",
    "claude-code": "Claude",
    codex: "Codex",
    cursor: "Cursor",
    "cursor-agent": "Cursor",
    opencode: "OpenCode",
    grok: "Grok",
    antigravity: "Antigravity",
  };
  return known[name.toLowerCase()] ?? `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
}

/**
 * One of the person's own chats on a task, as "‹agent› · ‹state›". The state is the agent's alone:
 * what the chat's pull request or the task is doing is said elsewhere. `since` is how long ago the
 * chat was last active ("3m", "2h"); `needOf` tells an approval from an answer.
 */
export function chatStateLabel(
  thread: Pick<WorkThreadNode, "status" | "stale" | "open">,
  input: {
    readonly agent: string;
    readonly needOf?: ReadonlyMap<string, AgentNeed> | undefined;
    readonly since?: string | null | undefined;
  },
): ChatState {
  const say = (kind: ChatStateKind, state: string, tone: StateTone): ChatState => ({
    kind,
    label: `${input.agent} · ${state}`,
    tone,
  });
  const since =
    input.since === undefined || input.since === null || input.since === "now"
      ? ""
      : ` ${input.since}`;
  if (thread.stale) return say("offline", "offline", "neutral");
  const need = thread.open === undefined ? undefined : input.needOf?.get(openKey(thread.open));
  if (thread.status === "blocked") {
    return need === "approval"
      ? say("approval", "needs approval", "needs")
      : say("asks", "asks you", "needs");
  }
  if (thread.status === "working") return say("working", `working${since}`, "working");
  if (thread.status === "done" || need === "review") {
    return say("finished", "turn finished", "delivery");
  }
  if (thread.status === "idle") return say("idle", `idle${since}`, "neutral");
  return say("unknown", "status unknown", "neutral");
}

/** "Ana", "Ana and Eva", "Ana, Eva and Tom", "Ana, Eva and 2 others". */
function nameList(names: ReadonlyArray<string>): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= 3) return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
  return `${names.slice(0, 2).join(", ")} and ${names.length - 2} others`;
}

/** The line that stands for a task's colleagues' chats: how many, whose, and why they are not listed. */
export interface OthersLine {
  /** "1 more chat, by Ana". */
  readonly headline: string;
  /** Why only they can open it, and whether its state counts on the task. */
  readonly note: string;
}

/**
 * Colleagues' chats on a task are counted and named in one line, never listed: they run on their
 * owners' computers. Chats nobody reports any more do not count toward the task's state, and the
 * note says so. Undefined when the task has none.
 */
export function othersLine(
  threads: ReadonlyArray<Pick<WorkThreadNode, "mine" | "person" | "stale">>,
): OthersLine | undefined {
  const others = threads.filter((thread) => !thread.mine);
  if (others.length === 0) return undefined;
  const names = [...new Set(others.map((thread) => thread.person))];
  const many = others.length > 1;
  const owner = names.length === 1 ? `${names[0]}’s computer` : "their computers";
  const who = names.length === 1 ? names[0] : "they";
  const counts = others.some((thread) => !thread.stale);
  return {
    headline: `${others.length} more chat${many ? "s" : ""}, by ${nameList(names)}`,
    note: [
      `${many ? "They run" : "It runs"} on ${owner}, so only ${who} can open ${many ? "them" : "it"}.`,
      counts
        ? `${many ? "Their" : "Its"} state counts on this task.`
        : `Nobody reports ${many ? "them" : "it"} now, so ${many ? "they don’t" : "it doesn’t"} count on this task.`,
    ].join(" "),
  };
}

/** The pull request a chat has, as the Hub reports it. */
export interface ChatPullRequest {
  readonly url: string;
  readonly state: string;
}

/**
 * Each chat's pull requests by the key its node has in the work tree (`WorkThreadNode.key`), in the
 * state GitHub verified where it did, else the one the chat's Peer reported.
 */
export function pullRequestsByThread(
  workThreads: ReadonlyArray<Pick<PeerWorkThread, "id" | "environment" | "pullRequests">>,
): ReadonlyMap<string, ReadonlyArray<ChatPullRequest>> {
  const map = new Map<string, ReadonlyArray<ChatPullRequest>>();
  for (const thread of workThreads) {
    const pullRequests = (thread.pullRequests ?? []).map((pullRequest) => ({
      url: pullRequest.url,
      state: pullRequest.github?.state ?? pullRequest.state,
    }));
    if (pullRequests.length === 0) continue;
    // This computer's chats are known by their own id, any other computer's after it.
    map.set(thread.id, pullRequests);
    map.set(`${thread.environment}:${thread.id}`, pullRequests);
  }
  return map;
}

/**
 * What a chat says about its pull requests: "PR #42 open", "PR #42 merged", "2 PRs merged". Nothing
 * while it has none, since a chat with no pull request has nothing to deliver yet.
 */
export function pullRequestLabel(pullRequests: ReadonlyArray<ChatPullRequest>): string | undefined {
  const [first, ...rest] = pullRequests;
  if (first === undefined) return undefined;
  const known = (state: string) =>
    state === "open" || state === "merged" || state === "closed" ? state : undefined;
  if (rest.length === 0) {
    const number = /\/(?:pull|pull-requests|merge_requests)\/(\d+)/i.exec(first.url)?.[1];
    return [number === undefined ? "PR" : `PR #${number}`, known(first.state)]
      .filter((part) => part !== undefined)
      .join(" ");
  }
  const states = new Set(pullRequests.map((pullRequest) => known(pullRequest.state)));
  const only = states.size === 1 ? [...states][0] : undefined;
  if (only !== undefined) return `${pullRequests.length} PRs ${only}`;
  const open = pullRequests.filter((pullRequest) => pullRequest.state === "open").length;
  return open > 0 ? `${pullRequests.length} PRs · ${open} open` : `${pullRequests.length} PRs`;
}
