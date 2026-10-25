import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  agentName,
  chatStateLabel,
  othersLine,
  pullRequestLabel,
  pullRequestsByThread,
} from "./taskChats.logic";
import { openKey, type AgentNeed, type WorkOpen, type WorkThreadNode } from "./workTree.logic";

const open = (id: string): WorkOpen => ({
  kind: "thread",
  environmentId: EnvironmentId.make("env"),
  threadId: ThreadId.make(id),
});

function chat(overrides: Partial<Pick<WorkThreadNode, "status" | "stale" | "open">> = {}) {
  return { status: "idle" as const, stale: false, open: open("a"), ...overrides };
}

describe("agentName", () => {
  it("says the agent as people do, and is just Agent when nobody reported one", () => {
    expect(agentName("claude")).toBe("Claude");
    expect(agentName("claude-code")).toBe("Claude");
    expect(agentName("Codex")).toBe("Codex");
    expect(agentName("cursor-agent")).toBe("Cursor");
    expect(agentName("Claude (work)")).toBe("Claude (work)");
    expect(agentName("aider")).toBe("Aider");
    expect(agentName(undefined)).toBe("Agent");
    expect(agentName("  ")).toBe("Agent");
  });
});

describe("chatStateLabel", () => {
  const say = (thread: ReturnType<typeof chat>, since?: string | null) =>
    chatStateLabel(thread, { agent: "Claude", since }).label;

  it("names the agent and what it does, with how long", () => {
    expect(say(chat({ status: "working" }), "3m")).toBe("Claude · working 3m");
    expect(say(chat({ status: "idle" }), "2h")).toBe("Claude · idle 2h");
  });

  it("leaves the time out while there is none or it is just now", () => {
    expect(say(chat({ status: "working" }))).toBe("Claude · working");
    expect(say(chat({ status: "working" }), null)).toBe("Claude · working");
    expect(say(chat({ status: "working" }), "now")).toBe("Claude · working");
    expect(say(chat({ status: "idle" }), "now")).toBe("Claude · idle");
  });

  it("tells an answer from an approval by what Needs you says it waits for", () => {
    const waiting = chat({ status: "blocked", open: open("w") });
    const needOf = (need: AgentNeed) => new Map([[openKey(waiting.open!), need]]);
    expect(chatStateLabel(waiting, { agent: "Claude", needOf: needOf("input") })).toEqual({
      kind: "asks",
      label: "Claude · asks you",
      tone: "needs",
    });
    expect(chatStateLabel(waiting, { agent: "Codex", needOf: needOf("approval") })).toEqual({
      kind: "approval",
      label: "Codex · needs approval",
      tone: "needs",
    });
    expect(chatStateLabel(waiting, { agent: "Claude" }).kind).toBe("asks");
    expect(
      chatStateLabel(chat({ status: "blocked", open: undefined }), { agent: "Claude" }).kind,
    ).toBe("asks");
  });

  it("says a finished turn, whether the chat was settled or its reply is still unread", () => {
    expect(say(chat({ status: "done" }))).toBe("Claude · turn finished");
    const unread = chat({ status: "idle", open: open("u") });
    const needOf = new Map<string, AgentNeed>([[openKey(unread.open!), "review"]]);
    expect(chatStateLabel(unread, { agent: "Claude", needOf, since: "5m" })).toEqual({
      kind: "finished",
      label: "Claude · turn finished",
      tone: "delivery",
    });
  });

  it("does not infer a disconnection from an old report, before anything else", () => {
    expect(say(chat({ status: "working", stale: true }), "3m")).toBe("Claude · status out of date");
    expect(chatStateLabel(chat({ status: "unknown", stale: true }), { agent: "Claude" })).toEqual({
      kind: "stale",
      label: "Claude · status out of date",
      tone: "neutral",
    });
  });

  it("never says the delivery's In progress, and keeps a quiet tone for idle and unknown", () => {
    for (const status of ["working", "blocked", "done", "idle", "unknown"] as const) {
      expect(say(chat({ status }), "1h")).not.toMatch(/In progress/i);
    }
    expect(chatStateLabel(chat({ status: "idle" }), { agent: "Claude" }).tone).toBe("neutral");
    expect(chatStateLabel(chat({ status: "unknown" }), { agent: "Claude" })).toEqual({
      kind: "unknown",
      label: "Claude · status unknown",
      tone: "neutral",
    });
    expect(chatStateLabel(chat({ status: "working" }), { agent: "Claude" }).tone).toBe("working");
  });
});

describe("othersLine", () => {
  const colleague = (person: string, stale = false) => ({ mine: false, person, stale });
  const mine = { mine: true, person: "You", stale: false };

  it("says nothing without colleagues' chats", () => {
    expect(othersLine([])).toBeUndefined();
    expect(othersLine([mine])).toBeUndefined();
  });

  it("counts and names one chat of a colleague, and says why it is not opened here", () => {
    expect(othersLine([mine, colleague("Ana")])).toEqual({
      headline: "1 more chat, by Ana",
      note: "It runs on Ana’s computer, so only Ana can open it. Its state counts on this task.",
    });
  });

  it("names a person once for several chats", () => {
    expect(othersLine([colleague("Ana"), colleague("Ana")])).toEqual({
      headline: "2 more chats, by Ana",
      note: "They run on Ana’s computer, so only Ana can open them. Their state counts on this task.",
    });
  });

  it("names several people, up to three, then counts the rest", () => {
    const line = (...names: string[]) => othersLine(names.map((name) => colleague(name)));
    expect(line("Ana", "Eva")).toEqual({
      headline: "2 more chats, by Ana and Eva",
      note: "They run on their computers, so only they can open them. Their state counts on this task.",
    });
    expect(line("Ana", "Eva", "Tom")?.headline).toBe("3 more chats, by Ana, Eva and Tom");
    expect(line("Ana", "Eva", "Tom", "Zoe", "Ola")?.headline).toBe(
      "5 more chats, by Ana, Eva and 3 others",
    );
  });

  it("does not claim a state that nobody reports counts on the task", () => {
    expect(othersLine([colleague("Eva", true)])).toEqual({
      headline: "1 more chat, by Eva",
      note: "It runs on Eva’s computer, so only Eva can open it. Nobody reports it now, so it doesn’t count on this task.",
    });
    expect(othersLine([colleague("Eva", true), colleague("Ana", true)])?.note).toBe(
      "They run on their computers, so only they can open them. Nobody reports them now, so they don’t count on this task.",
    );
    // One chat that reports is enough for the state to count.
    expect(othersLine([colleague("Eva", true), colleague("Eva")])?.note).toContain(
      "Their state counts on this task.",
    );
  });
});

describe("a chat's pull requests", () => {
  it("shows one pull request with its number and state, and nothing when there is none", () => {
    expect(pullRequestLabel([])).toBeUndefined();
    const url = (n: number) => `https://github.com/acme/app/pull/${n}`;
    expect(pullRequestLabel([{ url: url(42), state: "open" }])).toBe("PR #42 open");
    expect(pullRequestLabel([{ url: url(42), state: "merged" }])).toBe("PR #42 merged");
    expect(pullRequestLabel([{ url: url(42), state: "closed" }])).toBe("PR #42 closed");
    expect(pullRequestLabel([{ url: url(42), state: "unknown" }])).toBe("PR #42");
    expect(pullRequestLabel([{ url: "https://git.example/x", state: "open" }])).toBe("PR open");
    expect(
      pullRequestLabel([{ url: "https://gitlab.com/acme/app/-/merge_requests/7", state: "open" }]),
    ).toBe("PR #7 open");
  });

  it("sums up several by their state", () => {
    const pr = (n: number, state: string) => ({ url: `https://github.com/a/b/pull/${n}`, state });
    expect(pullRequestLabel([pr(1, "merged"), pr(2, "merged")])).toBe("2 PRs merged");
    expect(pullRequestLabel([pr(1, "merged"), pr(2, "open"), pr(3, "open")])).toBe(
      "3 PRs · 2 open",
    );
    expect(pullRequestLabel([pr(1, "merged"), pr(2, "closed")])).toBe("2 PRs");
  });

  it("finds a chat's pull requests by its key, GitHub's verified state first", () => {
    const map = pullRequestsByThread([
      {
        id: "peer:abc",
        environment: "env-1",
        pullRequests: [
          {
            url: "https://github.com/a/b/pull/9",
            state: "open",
            headBranch: "feat",
            github: {
              state: "merged",
              headBranch: "feat",
              baseBranch: "main",
              updatedAt: "",
              verifiedAt: "",
            },
          },
        ],
      },
      { id: "peer:none", environment: "env-1", pullRequests: [] },
      { id: "peer:old", environment: "env-1" },
    ]);
    const expected = [{ url: "https://github.com/a/b/pull/9", state: "merged" }];
    expect(map.get("peer:abc")).toEqual(expected);
    expect(map.get("env-1:peer:abc")).toEqual(expected);
    expect(map.has("peer:none")).toBe(false);
    expect(map.has("peer:old")).toBe(false);
  });
});
