// @effect-diagnostics nodeBuiltinImport:off globalDate:off preferSchemaOverJson:off - host-side lab checks: they run the lab's hook wrapper and git hook as the agents' shells do.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import type * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { PeerOwnershipSetMapInput, type PeerOwnerCall } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { claudeHookGroups } from "../../src/peerHub/core/adapters/scripts.ts";

import { render } from "../../src/peerHub/core/broker/cliContract.ts";
import { ownerCallRefusal, stopText } from "../../src/peerHub/core/broker/landing.ts";
import type { Directory } from "../../src/peerHub/plugins/ownership/Ownership.ts";
import { matches, ownerToAsk } from "../../src/peerHub/plugins/ownership/client/rules.ts";
import {
  askedText,
  decisionText,
  editStop,
  factText,
  landingStop,
  startBlock,
} from "../../src/peerHub/plugins/ownership/text.ts";
import {
  analyze,
  ANA,
  BOARD_NOTE,
  BOB,
  DECISION_NOTES,
  expected,
  feeLine,
  FILES,
  NOTE,
  OWNER_MAP,
  postCommitHook,
  reportLines,
  SEED,
  stubBob,
  totalsWithFee,
  WHY,
  withHookTimeout,
  wrapperScript,
  type Facts,
  type Hands,
  type LogEntry,
} from "./owners.ts";

const decodeMapInput = Schema.decodeUnknownSync(PeerOwnershipSetMapInput);

const people = new Map([
  [ANA, "Ana"],
  [BOB, "Bob"],
]);
const directory: Directory = {
  projectName: "Lab",
  people,
  task: () => undefined,
  label: (id) => (id === "ord-9" ? "ORD-9" : id),
  name: (email) => people.get(email) ?? email,
};
const project = {
  workspace: "acme",
  project: "lab",
  at: "2026-10-13T08:00:00.000Z",
  leads: [],
  map: { version: 1, ...OWNER_MAP, updatedAt: "2026-10-13T08:00:00.000Z", updatedBy: ANA },
  tasks: {},
  calls: [],
};
const call = (state: "accepted" | "declined", path: string, note: string): PeerOwnerCall => ({
  id: "oc-1",
  project: "lab",
  task: "ord-9",
  session: "claude:lab-bob-owner",
  email: BOB,
  environment: "bob-computer",
  owner: ANA,
  paths: [path],
  reason: WHY,
  state,
  decidedBy: ANA,
  onBehalf: false,
  note,
  createdAt: "2026-10-13T08:00:00.000Z",
  updatedAt: "2026-10-13T08:01:00.000Z",
  expiresAt: "2026-10-20T08:00:00.000Z",
});

describe("the texts the owners step checks", () => {
  it("are the ones the plugin says, for the same people and paths", () => {
    const start = (person: string) => startBlock({ project, person, environment: "e" }, directory);
    expect(start(BOB)).toBe(expected.start);
    expect(start(ANA)).toBe(expected.startOwner);
    for (const path of [FILES.fees, FILES.refunds]) {
      expect(editStop("Ana", [path])).toBe(expected.editStop(path));
      expect(landingStop("push", "Ana", [path])).toBe(expected.landingStop("push", [path]));
    }
    expect(landingStop("commit", "Ana", [FILES.fees, FILES.refunds])).toBe(
      expected.landingStop("commit", [FILES.fees, FILES.refunds]),
    );
    expect(decisionText(call("accepted", FILES.fees, DECISION_NOTES.accept), directory)).toBe(
      expected.accepted(FILES.fees, DECISION_NOTES.accept),
    );
    expect(decisionText(call("declined", FILES.refunds, DECISION_NOTES.decline), directory)).toBe(
      expected.declined(FILES.refunds, DECISION_NOTES.decline),
    );
    const asking = { ...call("accepted", FILES.fees, ""), state: "pending" };
    expect(askedText(asking, directory)).toBe(expected.heardCall(FILES.fees));
    expect(factText("Bob", "ORD-9", [FILES.ordersNotes])).toBe(
      expected.heardFact(FILES.ordersNotes),
    );
  });

  it("stop a landing step and refuse a review as the shared contract renders them", () => {
    const block = `[teammate text] ORD-11 · Ana’s agent, in your overlap on ${FILES.totals}:\n"${BOARD_NOTE}"`;
    expect(
      stopText({
        head: "Denied by Peer: a message from a teammate waits for you. Read it before this commit lands.",
        blocks: [block],
        tail: "Run the commit again once you have taken it into account.",
        cli: "peer",
      }),
    ).toBe(expected.commitStop(BOARD_NOTE));
    const broker = {
      nameOf: () => (email: string) => people.get(email) ?? email,
      taskNamer: () => () => "ORD-9 · Refund fee field",
    };
    const error = ownerCallRefusal.call(
      broker as never,
      { workspace: "acme", project: "lab", task: "ord-9" } as never,
      "review",
      { owner: ANA, paths: [FILES.refunds] },
      true,
    );
    expect(render(error)).toBe(expected.reviewRefused(FILES.refunds));
  });
});

describe("the owner map of the step", () => {
  it("is a map the Hub accepts, where Ana decides payments and not orders", () => {
    const sent = { workspace: "acme", project: "lab", version: 0, ...OWNER_MAP };
    expect(() => decodeMapInput(sent)).not.toThrow();
    expect(ownerToAsk(project.map, BOB, FILES.fees)).toBe(ANA);
    expect(ownerToAsk(project.map, ANA, FILES.fees)).toBeUndefined();
    expect(ownerToAsk(project.map, BOB, FILES.ordersNotes)).toBeUndefined();
    expect(ownerToAsk(project.map, BOB, FILES.totals)).toBeUndefined();
    for (const path of [FILES.fees, FILES.refunds, FILES.credits])
      expect(matches("src/payments/**", path)).toBe(true);
  });
});

describe("what the scenario reads of a code file", () => {
  it("tells a fee line that follows the note from one that ignores it", () => {
    expect(feeLine(totalsWithFee(true))).toBe("follows");
    expect(feeLine(totalsWithFee(false))).toBe("ignores");
    expect(feeLine(SEED[FILES.totals] ?? "")).toBe("absent");
    // The seed's own `amount` is not the fee line's: only what is around "Refund fee" counts.
    expect(feeLine(`${SEED[FILES.totals]}\n// Refund fee: later\n`)).toBe("ignores");
    expect(feeLine('const fee = { label: "refund fee", amountCents: 3 };')).toBe("follows");
  });
});

describe("the hook the lab gives Bob's agent", () => {
  /** The wrapper run as the agent's harness runs it, around a hook that writes down what it was given. */
  async function fixture(arm: "on" | "off") {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "owners-wrapper-"));
    const real = NodePath.join(dir, "hook");
    NodeFS.writeFileSync(
      real,
      [
        "#!/bin/sh",
        'dir=$(dirname "$0")',
        'cat >> "$dir/real.log"',
        'printf "\\n" >> "$dir/real.log"',
        `printf '{"answered":"%s"}' "$*"`,
      ].join("\n"),
      { mode: 0o755 },
    );
    let hits = 0;
    const server = NodeHttp.createServer((_request, response) => {
      hits += 1;
      response.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as NodeNet.AddressInfo).port;
    const log = NodePath.join(dir, "landing.jsonl");
    const script = NodePath.join(dir, "wrapper.sh");
    NodeFS.writeFileSync(script, wrapperScript({ hook: real, log, port, arm }));
    const lines = (file: string) =>
      NodeFS.existsSync(file)
        ? NodeFS.readFileSync(file, "utf8")
            .split("\n")
            .filter((line) => line !== "")
        : [];
    return {
      /** What the wrapper printed for one hook event. */
      run: (input: unknown, args: ReadonlyArray<string> = []) =>
        new Promise<string>((resolve, reject) => {
          const child = NodeChildProcess.spawn("sh", [script, ...args], {
            stdio: ["pipe", "pipe", "inherit"],
          });
          let out = "";
          child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
          child.on("error", reject);
          child.on("close", () => resolve(out));
          child.stdin.end(JSON.stringify(input));
        }),
      /** How many times the lab was asked for the note. */
      asked: () => hits,
      attempts: () => lines(log).map((line) => JSON.parse(line) as { t: number; at: string }),
      /** How many hook events reached Peer's hook. */
      reached: () => lines(NodePath.join(dir, "real.log")).length,
      close: () => {
        server.close();
        NodeFS.rmSync(dir, { recursive: true, force: true });
      },
    };
  }
  const pre = (command: string, tool = "Bash") => ({
    hook_event_name: "PreToolUse",
    tool_name: tool,
    tool_input: { command },
  });
  const commit = pre('git commit -am "ORD-9: refund fee"');

  it("gives Peer's hook everything that does not land work, as it was given, and keeps no record", async () => {
    const lab = await fixture("off");
    try {
      const answered = '{"answered":""}';
      expect(await lab.run({ hook_event_name: "SessionStart", source: "startup" })).toBe(answered);
      expect(await lab.run(pre("git status"))).toBe(answered);
      expect(await lab.run(pre("git log --oneline"))).toBe(answered);
      expect(await lab.run(pre("src/payments/fees.ts", "Edit"))).toBe(answered);
      // The agent's own words about committing are not a commit, and Peer's own command is Peer's.
      expect(await lab.run(pre('peer note "I git commit when the overlap is settled"'))).toBe(
        answered,
      );
      expect(await lab.run(pre('/work/bin/peer note "git push later"'))).toBe(answered);
      // What follows a commit is not the step before it.
      expect(
        await lab.run({
          hook_event_name: "PostToolUse",
          tool_name: "Bash",
          tool_input: { command: "git commit -m x" },
        }),
      ).toBe(answered);
      expect(await lab.run({ hook_event_name: "SessionStart" }, ["codex"])).toBe(
        '{"answered":"codex"}',
      );
      expect(lab.attempts()).toEqual([]);
      expect(lab.asked()).toBe(0);
      expect(lab.reached()).toBe(8);
    } finally {
      lab.close();
    }
  });

  it("notes the attempt, has the note written at a commit and then asks Peer, with the guard on", async () => {
    const lab = await fixture("on");
    try {
      const before = Date.now();
      expect(await lab.run(commit)).toBe('{"answered":""}');
      expect(lab.asked()).toBe(1);
      expect(lab.reached()).toBe(1);
      const [attempt] = lab.attempts();
      expect(attempt?.at).toBe("attempt");
      expect(attempt?.t).toBeGreaterThanOrEqual(before - 1000);
      expect(attempt?.t).toBeLessThanOrEqual(Date.now());
      // A push and a pull request are attempts too, but the note is written for the commit.
      expect(await lab.run(pre("git push"))).toBe('{"answered":""}');
      expect(await lab.run(pre("gh pr create --fill"))).toBe('{"answered":""}');
      expect(await lab.run(pre("npm test && git -C app commit -m x"))).toBe('{"answered":""}');
      expect(lab.attempts()).toHaveLength(4);
      expect(lab.asked()).toBe(2);
      expect(lab.reached()).toBe(4);
    } finally {
      lab.close();
    }
  });

  it("lets a step that lands work go without asking Peer, with the guard off", async () => {
    const lab = await fixture("off");
    try {
      expect(await lab.run(commit)).toBe("");
      expect(await lab.run(pre("git push"))).toBe("");
      expect(await lab.run(pre("gh pr merge 3"))).toBe("");
      expect(lab.asked()).toBe(1);
      expect(lab.attempts()).toHaveLength(3);
      expect(lab.reached()).toBe(0);
      // Nothing else is let go: an edit and a read still reach Peer.
      expect(await lab.run(pre("src/totals.ts", "Edit"))).toBe('{"answered":""}');
      expect(lab.reached()).toBe(1);
    } finally {
      lab.close();
    }
  });

  it("gives the hooks it wraps the time the wait takes, at the steps that need it", () => {
    const groups = claudeHookGroups({ hook: "/lab/owners-hook.sh", wait: "/peer/wait" });
    const timeouts = (made: ReturnType<typeof withHookTimeout>, event: string) =>
      (made[event] ?? []).flatMap((group) => (group.hooks ?? []).map((hook) => hook.timeout));
    const longer = withHookTimeout(groups, "/lab/owners-hook.sh", 60);
    expect(timeouts(longer, "PreToolUse")).toEqual([60]);
    // The rest keep Peer's own limits, and a hook that is not the wrapper keeps its own.
    expect(timeouts(longer, "PostToolUse")).toEqual(timeouts(groups, "PostToolUse"));
    expect(timeouts(longer, "SessionEnd")).toEqual([2]);
    expect(timeouts(longer, "Stop")).toEqual(timeouts(groups, "Stop"));
    expect(timeouts(withHookTimeout(groups, "/elsewhere", 60), "PreToolUse")).toEqual([5]);
  });
});

describe("the hook of git that writes down a commit", () => {
  it("records each commit that lands, with its time", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "owners-commit-"));
    try {
      const git = (...args: string[]) =>
        NodeChildProcess.execFileSync("git", args, {
          cwd: dir,
          encoding: "utf8",
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "lab",
            GIT_AUTHOR_EMAIL: "lab@acme.test",
            GIT_COMMITTER_NAME: "lab",
            GIT_COMMITTER_EMAIL: "lab@acme.test",
          },
        }).trim();
      git("init", "--quiet");
      const log = NodePath.join(dir, "landing.jsonl");
      NodeFS.writeFileSync(
        NodePath.join(dir, ".git", "hooks", "post-commit"),
        postCommitHook(log),
        {
          mode: 0o755,
        },
      );
      const before = Date.now();
      git("commit", "--allow-empty", "--quiet", "-m", "one");
      const first = git("rev-parse", "HEAD");
      git("commit", "--allow-empty", "--quiet", "-m", "two");
      const landed = NodeFS.readFileSync(log, "utf8")
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as { t: number; at: string; sha: string });
      expect(landed).toHaveLength(2);
      expect(landed.every((one) => one.at === "landed")).toBe(true);
      expect(landed[0]?.sha).toBe(first);
      expect(landed[1]?.sha).toBe(git("rev-parse", "HEAD"));
      expect(landed[0]?.t).toBeGreaterThanOrEqual(before - 1000);
      expect(landed[1]?.t).toBeGreaterThanOrEqual(landed[0]?.t ?? Infinity);
    } finally {
      NodeFS.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("the stand-in for Bob's agent", () => {
  /** Peer as the stand-in meets it: an edit of the fees waits for the owner, a second agent holds the totals, the note comes at a commit. */
  function peerFor(guard: boolean) {
    const files = new Map<string, string>();
    const commits: Array<Record<string, string>> = [];
    const state = { accepted: false, noted: false, noteSent: false };
    const hands: Hands = {
      prompt: async () => undefined,
      write: async (path, content) => {
        if (path === FILES.fees && !state.accepted)
          return { heard: [], stopped: expected.editStop(path) };
        if (path === FILES.totals && !state.noted)
          return {
            heard: [],
            stopped: `Peer: Ana's agent also changed ${path}. Before editing, tell them your plan with peer note "<your plan for ${path}>".`,
          };
        files.set(path, content);
        return { heard: [] };
      },
      run: async (command) => {
        expect(command).toMatch(/^git commit /);
        const first = !state.noteSent;
        state.noteSent = true;
        if (guard && first)
          return {
            heard: [],
            stopped: `Denied by Peer: a message from a teammate waits for you.\n[teammate text] ORD-11 · Ana’s agent:\n"${NOTE}"`,
          };
        commits.push(Object.fromEntries(files));
        return {
          heard: !guard && first ? [`Peer: Overlap with Ana's agent — Ana's agent: "${NOTE}"`] : [],
        };
      },
      peer: (...args) => {
        if (args[0] === "owner") return expected.asked("oc-1", FILES.fees);
        if (args[0] === "note") {
          state.noted = true;
          return "Noted on overlap abc";
        }
        return "Task moved to review";
      },
      idle: async () => {
        state.accepted = true;
        return expected.accepted(FILES.fees, DECISION_NOTES.accept);
      },
    };
    return { hands, files, commits };
  }

  it("meets a stop at the fees by asking, idling and going on when it is woken", async () => {
    const run = peerFor(true);
    const { heard } = await stubBob(run.hands);
    expect(heard.some((text) => text.includes("Ana accepted"))).toBe(true);
    expect(run.files.get(FILES.fees)).toContain("refundFeeCents");
    expect(heard.some((text) => text.startsWith("Asked Ana"))).toBe(true);
  });

  it("with the guard on, reads the note in the stop and lands one commit that follows it", async () => {
    const run = peerFor(true);
    await stubBob(run.hands);
    expect(run.commits).toHaveLength(1);
    expect(feeLine(run.commits[0]?.[FILES.totals] ?? "")).toBe("follows");
    expect(feeLine(run.files.get(FILES.totals) ?? "")).toBe("follows");
  });

  it("with the guard off, commits without the note and puts the code right after reading it", async () => {
    const run = peerFor(false);
    await stubBob(run.hands);
    expect(run.commits).toHaveLength(2);
    expect(feeLine(run.commits[0]?.[FILES.totals] ?? "")).toBe("ignores");
    expect(feeLine(run.commits[1]?.[FILES.totals] ?? "")).toBe("follows");
  });
});

describe("what a run is reported to have come to", () => {
  const start = Date.parse("2026-10-13T08:00:00.000Z");
  const entry = (ms: number, event: string, fields: Record<string, unknown> = {}): LogEntry => ({
    t: new Date(start + ms).toISOString(),
    event,
    session: "claude:s1",
    ...fields,
  });
  const answered = (
    ms: number,
    hookEvent: string,
    key: string,
    text: string,
    files: string[] = [],
  ) =>
    entry(ms, "hook", {
      hookEvent,
      chars: text.length,
      files,
      answer: { hookSpecificOutput: { hookEventName: hookEvent, [key]: text } },
    });
  const stop = `Denied by Peer: a message from a teammate waits for you. Read it before this commit lands.\n[teammate text] ORD-11 · Ana’s agent, in your overlap on ${FILES.totals}:\n"${NOTE}"\nRun the commit again once you have taken it into account.`;
  const woken = expected.accepted(FILES.fees, DECISION_NOTES.accept);
  const ownerStop = expected.editStop(FILES.fees);
  const common: LogEntry[] = [
    answered(0, "SessionStart", "additionalContext", "s".repeat(5000)),
    entry(1, "ownership.told", { kind: "start", chars: 142 }),
    entry(2000, "ownership.stopped", { where: "edit" }),
    answered(2000, "PreToolUse", "permissionDecisionReason", ownerStop),
    entry(5000, "wake", { text: woken }),
    entry(5000, "ownership.told", { kind: "decision", chars: woken.length }),
    answered(5500, "PostToolUse", "additionalContext", "", [`/work/${FILES.fees}`]),
    // What its own peer command printed (the log names its session without the harness), and another session's lines.
    {
      ...entry(3000, "cli", { outBytes: 168, out: "Asked Ana (call oc-1, ORD-9)." }),
      session: "s1",
    },
    { ...entry(6000, "wake", { text: NOTE }), session: "claude:other" },
  ];
  const call = {
    id: "oc-1",
    state: "accepted",
    paths: [FILES.fees],
    createdAt: new Date(start + 1500).toISOString(),
    updatedAt: new Date(start + 4900).toISOString(),
    decidedBy: ANA,
  };
  const facts = (arm: "on" | "off"): Facts => ({
    arm,
    agent: "stub",
    sessions: new Set(["claude:s1"]),
    noteWrittenAt: start + 10_100,
    ...(arm === "on"
      ? {
          log: [
            ...common,
            answered(10_700, "PreToolUse", "permissionDecisionReason", stop),
            entry(10_700, "landing.stopped", { messages: 1, chars: stop.length }),
          ],
          attempts: [start + 10_000, start + 20_000],
          landed: [
            { t: start + 20_300, sha: "a1", files: { [FILES.totals]: totalsWithFee(true) } },
          ],
        }
      : {
          log: [
            ...common,
            answered(10_900, "PostToolUse", "additionalContext", `Peer: Ana's agent: "${NOTE}"`),
          ],
          attempts: [start + 10_000, start + 15_000],
          landed: [
            { t: start + 10_300, sha: "b1", files: { [FILES.totals]: totalsWithFee(false) } },
            { t: start + 15_300, sha: "b2", files: { [FILES.totals]: totalsWithFee(true) } },
          ],
        }),
    final: { [FILES.totals]: totalsWithFee(true) },
    calls: [call],
  });

  it("says, with the guard on, that the note was read before the commit that landed and that code followed it", () => {
    const report = analyze(facts("on"));
    expect(report.note).toEqual({
      written: true,
      via: "the landing stop",
      lateMs: 600,
      beforeFirstAttempt: false,
      beforeFirstLanded: true,
    });
    expect(report.code).toEqual({ firstLanded: "follows", final: "follows" });
    expect(report.call).toEqual({
      opened: true,
      completed: true,
      waitedMs: 3400,
      decidedBy: ANA,
      editedAfter: true,
    });
    expect(report.stops).toEqual({ edit: 1, landing: 0, messages: 1 });
    expect(report.landed).toBe(1);
    expect(report.chars).toEqual({
      hooks: 5000 + ownerStop.length + stop.length,
      wakes: woken.length,
      total: 5000 + ownerStop.length + stop.length + woken.length,
      commands: 168,
      ownership: 142 + woken.length + ownerStop.length,
      landingStops: stop.length,
    });
    const lines = reportLines(report);
    expect(lines[0]).toBe("owners scenario, LAB_LANDING=on, Bob's agent: stub");
    expect(lines[1]).toContain("reached it through the landing stop, 0.6 s later");
    expect(lines[1]).toContain(
      "in its context before it first tried to land: no, before the commit that landed: yes",
    );
    expect(lines[2]).toBe(
      "the code of the first commit that landed follows it; as it ends it follows it",
    );
    expect(lines[3]).toContain("completed: accepted by ana@acme.test 3.4 s after it was opened");
    expect(lines[5]).toContain(`Peer added ${report.chars.total.toLocaleString("en")} characters`);
    expect(lines[5]).toContain("its own peer commands printed 168 more");
  });

  it("says, with the guard off, that the note came after the commit and the first commit ignored it", () => {
    const report = analyze(facts("off"));
    expect(report.note).toMatchObject({
      via: "an ordinary step (PostToolUse)",
      lateMs: 800,
      beforeFirstAttempt: false,
      beforeFirstLanded: false,
    });
    expect(report.code).toEqual({ firstLanded: "ignores", final: "follows" });
    expect(report.stops.messages).toBe(0);
    expect(report.landed).toBe(2);
    expect(report.chars.landingStops).toBe(0);
    expect(reportLines(report)[2]).toBe(
      "the code of the first commit that landed ignores it; as it ends it follows it",
    );
  });

  it("counts a note read with a peer command, and a change made through the shell once the call was accepted", () => {
    const report = analyze({
      arm: "on",
      agent: "claude",
      sessions: new Set(["claude:s1"]),
      log: [
        { ...entry(1000, "cli", { out: `Overlap: "${NOTE}"`, outBytes: 80 }), session: "s1" },
        entry(5000, "files.shell", { files: [FILES.fees] }),
      ],
      attempts: [start + 3000],
      landed: [],
      final: {},
      calls: [call],
      noteWrittenAt: start + 500,
    });
    expect(report.note).toMatchObject({
      via: "a peer command it ran",
      lateMs: 500,
      beforeFirstAttempt: true,
    });
    expect(report.call.editedAfter).toBe(true);
    expect(report.chars.commands).toBe(80);
  });

  it("is plain about what did not happen: no note, no commit, no call, a change through the shell", () => {
    const report = analyze({
      arm: "off",
      agent: "codex",
      sessions: new Set(["codex:t1"]),
      log: [
        {
          t: new Date(start).toISOString(),
          event: "files.shell",
          session: "codex:t1",
          files: [FILES.refunds, "README.md"],
        },
      ],
      attempts: [],
      landed: [],
      final: {},
      calls: [],
      noteRefused: "you share no files with another agent right now",
    });
    expect(report.note.written).toBe(false);
    expect(report.call.opened).toBe(false);
    expect(report.bypassed).toEqual([FILES.refunds]);
    const lines = reportLines(report);
    expect(lines[1]).toBe(
      "the teammate's note was not written (you share no files with another agent right now)",
    );
    expect(lines[2]).toBe("the code was never committed; as it ends it has no fee line");
    expect(lines[3]).toBe("the agent never opened an owner's call");
    expect(lines[4]).toContain(
      `changed through the shell where an owner decides: ${FILES.refunds}`,
    );
  });
});
