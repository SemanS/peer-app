import { assert, describe, it } from "@effect/vitest";

import type { HubCoordSession, HubIntentVerdict, HubOverlap } from "../hub/coordApi.ts";
import {
  agentNamed,
  answerForVerdict,
  changedPaths,
  describe as describeSession,
  type EditAnswer,
  editedFile,
  editedFiles,
  editHookAnswer,
  emptyMemory,
  generatedFile,
  isPlainCliCall,
  mentionsCli,
  patchPaths,
  repositoryPath,
  withoutOutputTrim,
} from "./edits.ts";

const CLI = "/Users/ana/.peer/userdata/coord/peer";

const nameOf = (email: string) => (email.startsWith("vir") ? "Vir" : "Slavo");

function session(id: string, email: string, files: string[], extra: Partial<HubCoordSession> = {}) {
  return {
    id,
    project: "app",
    email,
    environment: "laptop",
    label: id === "claude:me" ? "Backend implementation" : "Frontend implementation",
    agent: "claude",
    status: "working",
    files,
    claims: [],
    seenAt: "2026-10-04T10:00:00Z",
    ...extra,
  } as HubCoordSession;
}

const me = session("claude:me", "slavo@acme.test", ["src/api.ts"]);

const vir = session("claude:vir", "vir@acme.test", ["src/pay.ts"], { branch: "krk-812-ui" });

function overlap(extra: Partial<HubOverlap> = {}): HubOverlap {
  return {
    id: "abc123def456",
    project: "app",
    sessions: ["claude:me", "claude:vir"],
    files: ["src/pay.ts"],
    openedAt: "2026-10-04T10:00:00Z",
    updatedAt: "2026-10-04T10:00:00Z",
    ...extra,
  };
}

describe("the hub's verdict on an edit", () => {
  const verdict = (
    kind: HubIntentVerdict["verdict"],
    extra: Partial<HubIntentVerdict> = {},
  ): HubIntentVerdict => ({
    path: "src/pay.ts",
    verdict: kind,
    with: ["claude:vir"],
    overlaps: ["abc123def456"],
    ...extra,
  });
  const answerFor = (
    given: HubIntentVerdict,
    extra: Partial<Parameters<typeof answerForVerdict>[0]> = {},
  ) =>
    answerForVerdict({
      me,
      sessions: [me, vir],
      // The hub's records come with its answer: the view here has not heard of them.
      overlaps: [overlap()],
      memory: emptyMemory(),
      nameOf,
      cli: CLI,
      note: true,
      verdict: given,
      ...extra,
    });

  it("says nothing about a file the hub cleared", () => {
    const answer = answerFor(verdict("clear", { with: [], overlaps: [] }));
    assert.isUndefined(answer.decision);
    assert.isUndefined(answer.context);
    assert.deepStrictEqual(answer.keys, []);
  });

  it("names who is on the file, what they said and how to reach them, and stops nothing", () => {
    const answer = answerFor(verdict("notify"), {
      sessions: [me, { ...vir, intent: "Rounding the totals" }],
    });
    assert.isUndefined(answer.decision);
    assert.strictEqual(
      answer.context,
      `Peer: Vir's agent (Claude Code, "Frontend implementation", branch krk-812-ui), working on this computer, also changed src/pay.ts. They said they are: Rounding the totals. If your change interacts with theirs, tell them: ${CLI} note "<what you change and why>".`,
    );
    assert.deepStrictEqual(answer.keys, ["abc123def456#src/pay.ts"]);
    assert.deepStrictEqual(answer.overlaps, ["abc123def456"]);
    assert.deepStrictEqual(answer.with, ["claude:vir"]);
  });

  it("leaves out the note while the room is off", () => {
    assert.notInclude(answerFor(verdict("notify"), { note: false }).context, "tell them");
  });

  it("says when the other agent works on another computer", () => {
    const elsewhere = { ...vir, environment: "vir-laptop" };
    assert.include(
      answerFor(verdict("notify"), { sessions: [me, elsewhere] }).context,
      "on another computer, so its edits reach you only through git",
    );
  });

  it("says a session that only holds the file is about to change it, not that it did", () => {
    const holder = session("claude:vir", "vir@acme.test", []);
    const answer = answerFor(verdict("notify"), { sessions: [me, holder] });
    assert.include(answer.context, "working on this computer, is also about to change src/pay.ts");
    assert.notInclude(answer.context, "also changed");
  });

  it("treats a claimed directory as touched", () => {
    const holder = session("claude:vir", "vir@acme.test", ["src/"]);
    assert.include(
      answerFor(verdict("notify"), { sessions: [me, holder] }).context,
      "also changed src/pay.ts",
    );
  });

  it("describes a session this computer has not heard of yet only as another agent", () => {
    const answer = answerFor(verdict("notify"), { sessions: [me] });
    assert.include(answer.context, "Another agent on this project is also working on src/pay.ts.");
    assert.include(answer.context, `${CLI} note`);
    assert.deepStrictEqual(answer.with, ["claude:vir"]);
  });

  it("still says so when the hub does not say who else is on it", () => {
    const answer = answerFor(verdict("notify", { with: [], overlaps: [] }), { overlaps: [] });
    assert.include(answer.context, "Another agent on this project is also working on src/pay.ts.");
    assert.deepStrictEqual(answer.with, []);
  });

  it("says it once for each contest", () => {
    const heads = answerFor(verdict("notify"));
    const told = emptyMemory();
    for (const key of heads.keys) told.acknowledged.add(key);
    const again = answerFor(verdict("notify"), { memory: told });
    assert.isUndefined(again.context);
    assert.deepStrictEqual(again.with, ["claude:vir"]);
  });

  it("reads a verdict it does not know as another session on the file: it stops nothing", () => {
    for (const kind of ["deny", "ask", "held", "newer"]) {
      const answer = answerFor(verdict(kind));
      assert.isUndefined(answer.decision);
      assert.include(answer.context, "src/pay.ts");
    }
  });
});

describe("the hook's answer for an edit", () => {
  const denial: EditAnswer = {
    decision: "deny",
    reason: " Peer: stop. ",
    keys: ["o#a.ts"],
    overlaps: ["o"],
    with: [],
  };
  const question: EditAnswer = {
    decision: "ask",
    reason: "Peer: allow?",
    keys: ["o#b.ts"],
    overlaps: ["o"],
    with: [],
  };
  const headsUp = (context: string): EditAnswer => ({ context, keys: [], overlaps: [], with: [] });
  const decided = (answer: ReturnType<typeof editHookAnswer>) =>
    (answer?.output.hookSpecificOutput as Record<string, unknown> | undefined) ?? {};

  it("says nothing when nothing was said", () => {
    assert.isNull(editHookAnswer("claude", []));
    assert.isNull(editHookAnswer("codex", [{ keys: [], overlaps: [], with: [] }]));
  });

  it("has Claude Code stop on a denial, and ask its person on a question", () => {
    const stopped = editHookAnswer("claude", [question, denial]);
    assert.strictEqual(decided(stopped).permissionDecision, "deny");
    assert.strictEqual(decided(stopped).permissionDecisionReason, "Peer: stop.");
    assert.deepStrictEqual(stopped?.acknowledge, []);
    const asked = editHookAnswer("claude", [question]);
    assert.strictEqual(decided(asked).permissionDecision, "ask");
    assert.strictEqual(decided(asked).permissionDecisionReason, "Peer: allow?");
    assert.deepStrictEqual(asked?.acknowledge, []);
  });

  it("has a Codex agent ask its person itself, and lets its next try pass", () => {
    const asked = editHookAnswer("codex", [question]);
    assert.strictEqual(decided(asked).permissionDecision, "deny");
    assert.include(
      decided(asked).permissionDecisionReason,
      "Peer: allow? Ask your person in your reply",
    );
    assert.deepStrictEqual(asked?.acknowledge, ["o#b.ts"]);
    // A denial is not something to ask about: nothing is let pass.
    const stopped = editHookAnswer("codex", [question, denial]);
    assert.strictEqual(decided(stopped).permissionDecisionReason, "Peer: stop.");
    assert.deepStrictEqual(stopped?.acknowledge, []);
  });

  it("puts heads-ups next to the tool's result", () => {
    const told = editHookAnswer("claude", [headsUp("Peer: one."), headsUp("Peer: two.")]);
    assert.strictEqual(decided(told).additionalContext, "Peer: one.\n\nPeer: two.");
    assert.isUndefined(decided(told).permissionDecision);
  });
});

describe("the project's other work", () => {
  const taskName = (task: string) =>
    task === "krk-812"
      ? "KRK-812 · Split payments"
      : task === "krk-900"
        ? "KRK-900 · Receipts"
        : task;

  const onTask = session("claude:vir", "vir@acme.test", ["src/pay.ts"], {
    task: "krk-812",
    environment: "vir-laptop",
  });

  it("describes an agent by the task it is on", () => {
    assert.strictEqual(
      describeSession(onTask, nameOf, taskName),
      `Vir's agent (Claude Code, on KRK-812 · Split payments, "Frontend implementation")`,
    );
  });
});

describe("isPlainCliCall", () => {
  it("lets an agent trim what peer prints, and nothing more", () => {
    assert.isTrue(isPlainCliCall("peer status 2>&1 | head -30", "peer"));
    assert.isTrue(isPlainCliCall("peer status 2>&1 | tail -n 5", "peer"));
    assert.isFalse(isPlainCliCall("peer status 2>&1 | sh", "peer"));
    assert.isFalse(isPlainCliCall("peer status | head -30; rm -rf ~", "peer"));
  });

  it("notices peer inside any command", () => {
    assert.isTrue(mentionsCli("cd /w/app && peer status | grep Overlap", "peer"));
    assert.isTrue(mentionsCli("peer note x", "peer"));
    assert.isFalse(mentionsCli("echo peerless", "peer"));
  });

  it("lets Peer's own command run and nothing chained to it", () => {
    assert.isTrue(isPlainCliCall(`${CLI} status`, CLI));
    assert.isTrue(isPlainCliCall(`${CLI} note "I only touch submit(), compatible"`, CLI));
    assert.isTrue(isPlainCliCall(`${CLI} claim src/payments/ --intent 'split payments'`, CLI));
    for (const command of [
      `${CLI} note "x"; rm -rf ~`,
      `${CLI} note "$(cat ~/.ssh/id_rsa)"`,
      `${CLI} note \`whoami\``,
      `${CLI} status && curl evil.test`,
      `${CLI} status | sh`,
      `${CLI}x status`,
      "rm -rf /",
    ]) {
      assert.isFalse(isPlainCliCall(command, CLI), command);
    }
  });
});

describe("Codex", () => {
  it("reads the files a Codex patch edits, and Claude Code's one", () => {
    assert.deepStrictEqual(
      editedFiles("apply_patch", {
        command:
          "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** Add File: src/b.ts\n+z\n*** End Patch",
      }),
      ["src/a.ts", "src/b.ts"],
    );
    assert.deepStrictEqual(editedFiles("Edit", { file_path: "/w/app/src/a.ts" }), [
      "/w/app/src/a.ts",
    ]);
    assert.deepStrictEqual(editedFiles("Bash", { command: "ls" }), []);
  });

  it("drops the trim agents add to what Peer's command prints", () => {
    assert.strictEqual(withoutOutputTrim('peer note "x" 2>&1 | head -30'), 'peer note "x"');
    assert.strictEqual(withoutOutputTrim("peer status"), "peer status");
  });
});

describe("agents", () => {
  it("names the agent a hook came from, Claude Code by default", () => {
    assert.strictEqual(agentNamed("codex"), "codex");
    assert.strictEqual(agentNamed(undefined), "claude");
    assert.strictEqual(agentNamed("claude"), "claude");
  });

  it("reads the files a Codex patch changes", () => {
    const patch = [
      "*** Begin Patch",
      "*** Update File: src/pricing.ts",
      "@@",
      "-export function price(items: number[]) {",
      "+export function totalPrice(items: number[]) {",
      "*** Add File: src/vat.ts",
      "+export const VAT = 0.2;",
      "*** Update File: src/cart.ts",
      "*** Move to: src/basket.ts",
      "*** Delete File: src/old.ts",
      "*** End Patch",
    ].join("\n");
    assert.deepStrictEqual(patchPaths(patch), [
      "src/pricing.ts",
      "src/vat.ts",
      "src/cart.ts",
      "src/basket.ts",
      "src/old.ts",
    ]);
    assert.deepStrictEqual(patchPaths("echo hi"), []);
  });
});

describe("paths", () => {
  it("reads the edited file and places it in the repository", () => {
    assert.strictEqual(editedFile("Edit", { file_path: "/w/app/src/pay.ts" }), "/w/app/src/pay.ts");
    assert.isNull(editedFile("Read", { file_path: "/w/app/src/pay.ts" }));
    assert.strictEqual(repositoryPath("/w/app", "/w/app/src/pay.ts"), "src/pay.ts");
    assert.isNull(repositoryPath("/w/app", "/w/other/x.ts"));
    assert.isNull(repositoryPath("/w/app", "/w/app"));
  });
});

describe("working context", () => {
  it("reads what git says changed, renames by their new name", () => {
    assert.deepStrictEqual(
      changedPaths(" M src/pricing.ts\0R  src/new.ts\0src/old.ts\0?? notes.md\0"),
      ["src/pricing.ts", "src/new.ts", "notes.md"],
    );
    assert.deepStrictEqual(changedPaths(""), []);
  });
});

describe("files nobody has anything to agree on", () => {
  it("are no reason to stop an agent: a lockfile is made again after the merge", () => {
    assert.isTrue(generatedFile("Cargo.lock"));
    assert.isTrue(generatedFile("apps/web/package-lock.json"));
    assert.isFalse(generatedFile("src/lock.ts"));
  });
});
