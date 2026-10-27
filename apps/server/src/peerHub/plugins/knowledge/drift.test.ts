import { assert, describe, it } from "@effect/vitest";
import {
  PeerHubError,
  type PeerKnowledgeChallenge,
  type PeerKnowledgeChallenges,
  type PeerKnowledgeVerification,
  type PeerKnowledgeVerified,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import type { KontextClientShape, KontextEntry } from "../../kontext.ts";
import { challengeFlows } from "./client/challengeFlows.ts";
import {
  challengeCache,
  challengeUpdates,
  type ChallengesHub,
  type DecideBody,
} from "./client/challenges.ts";
import {
  challengedIn,
  driftBody,
  driftReason,
  entriesDrift,
  reviewRefusal,
  type DriftEntry,
  type DriftGit,
} from "./client/drift.ts";
import { reviewChecks } from "./client/reviewChecks.ts";

const HEAD_1 = "1".repeat(40);
const HEAD_2 = "2".repeat(40);
const COMMIT = "c".repeat(40);

const ROUNDING: DriftEntry = {
  id: "rounding",
  kind: "decision",
  title: "Round each line before the total",
  path: ".ai/decisions/rounding.md",
  changed: ["src/pricing/total.ts"],
  commits: [{ sha: COMMIT, subject: "Round the total once" }],
};

const ENTRY: KontextEntry = {
  id: "rounding",
  kind: "decision",
  title: "Round each line before the total",
  status: "accepted",
  date: "2026-10-04",
  summary: "Per line.",
  tags: [],
  paths: ["src/pricing/**"],
  file: ".ai/decisions/rounding.md",
  body: "Round per line.",
  markdown: "# Rounding\n",
};

const envelope = (result: unknown) => ({
  code: 0,
  stdout: JSON.stringify({ schema_version: 1, ok: true, result }),
  stderr: "",
});
const refusal = (code: string) => ({
  code: 1,
  stdout: JSON.stringify({ schema_version: 1, ok: false, error: { code, message: code } }),
  stderr: "",
});

/** A kontext with drift and confirm where `newer`, listing `drifted` over any range. */
const fakeKontext = (options: {
  readonly newer: boolean;
  drifted?: ReadonlyArray<DriftEntry>;
  /** What `drafts.verify` answers (for the entry asked); a kontext without the ledger has no such operation. */
  verified?: Record<string, unknown> | ((id: string) => Record<string, unknown>);
  /** What `entries.get` adds to the entry, as a kontext with the ledger sends it. */
  ledger?: Record<string, unknown>;
}) => {
  const asked: Array<{ readonly operation: string; readonly input: Record<string, unknown> }> = [];
  const client: KontextClientShape = {
    run: async (args, _cwd, stdin) => {
      const operation = args[3] ?? "";
      const input = JSON.parse(stdin ?? "{}") as Record<string, unknown>;
      asked.push({ operation, input });
      const extra = [
        ...(options.newer ? ["entries.drift", "drafts.confirm"] : []),
        ...(options.verified === undefined ? [] : ["drafts.verify"]),
      ];
      if (operation === "status")
        return envelope({
          api_version: 1,
          version: options.newer ? "0.4.0" : "0.3.0",
          store: { configured: true, dir: ".ai" },
          capabilities: ["status", "entries.get", ...extra],
          llm: { available: false },
        });
      if (operation === "entries.get")
        return envelope({
          entry: { ...ENTRY, ...options.ledger, publication: { state: "committed" } },
        });
      if (!extra.includes(operation)) return refusal("unsupported_operation");
      if (operation === "entries.drift")
        return envelope({ base: input.base, head: input.head, entries: options.drifted ?? [] });
      if (operation === "drafts.verify")
        return envelope(
          typeof options.verified === "function"
            ? options.verified(String(input.id))
            : options.verified,
        );
      return envelope({ id: input.id, path: ENTRY.file, checked: "2026-10-20" });
    },
  };
  return { client, asked };
};

const challengeOf = (more: Partial<PeerKnowledgeChallenge> = {}): PeerKnowledgeChallenge => ({
  id: "ch1",
  project: "app",
  entry: "rounding",
  reason: driftReason(ROUNDING),
  sources: [],
  finders: 0,
  people: [],
  status: "open",
  drift: { head: HEAD_2, commits: [COMMIT], paths: ["src/pricing/total.ts"] },
  firstAt: "2026-10-18T10:00:00Z",
  lastAt: "2026-10-18T10:00:00Z",
  ...more,
});

/** The flows over a Hub at revision 3 (unless `servesDrift` says not), and a checkout whose default branch is at `git.head`. */
const flowsOver = (
  kontext: KontextClientShape,
  servesDrift = true,
  /** The head the repository keeps, shared by a Peer started again on it. */
  checked: { current: string | null } = { current: null },
) => {
  const opened: Array<Record<string, unknown>> = [];
  const logged: Array<{ readonly event: string; readonly fields: Record<string, unknown> }> = [];
  const hubDown = { current: false };
  const decided: DecideBody[] = [];
  let challenge = challengeOf();
  const hub: ChallengesHub = {
    list: () => Effect.succeed([challenge]),
    open: (_workspace, _project, body) =>
      hubDown.current
        ? Effect.fail(new PeerHubError({ detail: "Hub down." }))
        : Effect.sync(() => {
            opened.push(body);
            return challenge;
          }),
    decide: (_workspace, _project, _id, body) =>
      Effect.sync(() => {
        decided.push(body);
        challenge = {
          ...challenge,
          status: body.status,
          ...(body.resolvedAs === undefined ? {} : { resolvedAs: body.resolvedAs }),
        };
        return challenge;
      }),
  };
  const head = { current: HEAD_1 as string | null };
  const git: DriftGit = {
    defaultHead: async () => head.current,
    checkedHead: async () => checked.current,
    setCheckedHead: async (_checkout, sha) => {
      checked.current = sha;
    },
    subjects: async (_checkout, shas) =>
      new Map(shas.filter((sha) => sha === COMMIT).map((sha) => [sha, "Round the total once"])),
  };
  const cache = challengeCache(hub.list);
  const flows = challengeFlows({
    hub,
    cache,
    kontext,
    served: Effect.succeed(true),
    servesDrift: Effect.succeed(servesDrift),
    git,
    storeOf: () => Effect.succeed({ checkout: "/repo", llm: false }),
    book: () => Effect.succeed([]),
    candidates: () => Effect.succeed([]),
    changed: Effect.void,
    log: (event, fields) => Effect.sync(() => void logged.push({ event, fields })),
  });
  return { flows, opened, decided, head, hubDown, logged };
};

describe("drift at peer review", () => {
  it("lists what is not settled, and counts an [against] line in the agent's own context", () => {
    const drift = { base: HEAD_1, head: "working", entries: [ROUNDING] };
    const stopped = reviewRefusal(drift, new Set());
    assert.include(stopped?.reason ?? "", "- rounding (decision:");
    assert.include(stopped?.reason ?? "", "you changed src/pricing/total.ts in 1 commit");
    assert.strictEqual(stopped?.next, "settle each entry above, then run peer review again.");
    const challenged = challengedIn(["- [against rounding] Totals round once since KRK-2"]);
    assert.isNull(reviewRefusal(drift, challenged));
    assert.isNull(reviewRefusal({ ...drift, entries: [] }, new Set()));
  });

  it("finds nothing, without an error, where kontext is older or missing", async () => {
    const older = fakeKontext({ newer: false });
    assert.isNull(await entriesDrift(older.client, "/repo", {}));
    const missing: KontextClientShape = {
      run: async () => ({ code: 127, stdout: "", stderr: "kontext: not found" }),
    };
    assert.isNull(await entriesDrift(missing, "/repo", {}));
  });
});

describe("drift challenges after the default branch moved", () => {
  const place = { workspace: "acme", project: "app" };

  it.effect("files one challenge per listed entry, once per head, and nothing at first sight", () =>
    Effect.gen(function* () {
      const kontext = fakeKontext({ newer: true, drifted: [ROUNDING] });
      const { flows, opened, head } = flowsOver(kontext.client);
      yield* flows.verify(place.workspace, place.project, "/repo");
      assert.isEmpty(opened);
      head.current = HEAD_2;
      yield* flows.verify(place.workspace, place.project, "/repo");
      assert.deepStrictEqual(opened, [
        {
          entry: "rounding",
          reason:
            "Code it governs changed in 1 commit since it was last checked: src/pricing/total.ts",
          origin: "drift",
          drift: { head: HEAD_2, commits: [COMMIT], paths: ["src/pricing/total.ts"] },
        },
      ]);
      const drift = kontext.asked.find((call) => call.operation === "entries.drift");
      assert.deepStrictEqual(drift?.input, { base: HEAD_1, head: HEAD_2 });
      // The same head again files nothing; nor does a head filed before, should the branch come back to it.
      yield* flows.verify(place.workspace, place.project, "/repo");
      assert.lengthOf(opened, 1);
      head.current = HEAD_1;
      yield* flows.verify(place.workspace, place.project, "/repo");
      head.current = HEAD_2;
      yield* flows.verify(place.workspace, place.project, "/repo");
      assert.deepStrictEqual(
        opened.map((body) => (body.drift as { head: string }).head),
        [HEAD_2, HEAD_1],
      );
    }),
  );

  it.effect("files what landed while Peer was not running from the head the repository kept", () =>
    Effect.gen(function* () {
      const kontext = fakeKontext({ newer: true, drifted: [ROUNDING] });
      const checked = { current: null as string | null };
      const before = flowsOver(kontext.client, true, checked);
      yield* before.flows.verify(place.workspace, place.project, "/repo");
      assert.strictEqual(checked.current, HEAD_1);
      const after = flowsOver(kontext.client, true, checked);
      after.head.current = HEAD_2;
      yield* after.flows.verify(place.workspace, place.project, "/repo");
      assert.lengthOf(after.opened, 1);
      assert.strictEqual(checked.current, HEAD_2);
    }),
  );

  it.effect("files again what a Hub that could not be reached missed", () =>
    Effect.gen(function* () {
      const { flows, opened, head, hubDown } = flowsOver(
        fakeKontext({ newer: true, drifted: [ROUNDING] }).client,
      );
      yield* flows.verify(place.workspace, place.project, "/repo");
      head.current = HEAD_2;
      hubDown.current = true;
      yield* flows.verify(place.workspace, place.project, "/repo");
      assert.isEmpty(opened);
      hubDown.current = false;
      yield* flows.verify(place.workspace, place.project, "/repo");
      assert.lengthOf(opened, 1);
    }),
  );

  it.effect("files nothing with an older kontext or an older Hub", () =>
    Effect.gen(function* () {
      for (const over of [
        flowsOver(fakeKontext({ newer: false }).client),
        flowsOver(fakeKontext({ newer: true, drifted: [ROUNDING] }).client, false),
      ]) {
        yield* over.flows.verify(place.workspace, place.project, "/repo");
        over.head.current = HEAD_2;
        yield* over.flows.verify(place.workspace, place.project, "/repo");
        assert.isEmpty(over.opened);
      }
    }),
  );

  it.effect("keeps what the Hub takes of a drift within its bounds", () =>
    Effect.sync(() => {
      const many = Array.from({ length: 80 }, (_, i) => `src/f${i}.ts`);
      const body = driftBody(HEAD_2, {
        ...ROUNDING,
        changed: [...many, "/etc/passwd", "../up.ts"],
        commits: [{ sha: "abc1234", subject: "short" }, ...ROUNDING.commits],
      });
      assert.lengthOf(body.paths, 50);
      assert.deepStrictEqual(body.commits, [COMMIT]);
      assert.isAtMost(driftReason({ ...ROUNDING, changed: many }).length, 300);
    }),
  );
});

describe("still holds", () => {
  const place = { workspace: "acme", project: "app" };

  it.effect(
    "offers it where kontext can confirm and the Hub takes it, with the commits' subjects",
    () =>
      Effect.gen(function* () {
        const newer: PeerKnowledgeChallenges = yield* flowsOver(
          fakeKontext({ newer: true }).client,
        ).flows.list(place);
        assert.deepStrictEqual(newer.confirm, { available: true, reason: null });
        assert.deepStrictEqual(newer.rows[0]?.commits, [
          { sha: COMMIT, subject: "Round the total once" },
        ]);
        const older = yield* flowsOver(fakeKontext({ newer: false }).client).flows.list(place);
        assert.strictEqual(
          older.confirm?.reason,
          "This needs kontext 0.4.0 or newer here (it has no drafts.confirm).",
        );
        const olderHub = yield* flowsOver(fakeKontext({ newer: true }).client, false).flows.list(
          place,
        );
        assert.isUndefined(olderHub.confirm);
      }),
  );

  it.effect(
    "stages the confirmation and leaves the challenge resolving until a commit shows it",
    () =>
      Effect.gen(function* () {
        const kontext = fakeKontext({ newer: true });
        const { flows, decided } = flowsOver(kontext.client);
        const done = yield* flows.decide({ ...place, id: "ch1", decision: "confirmed" });
        assert.deepStrictEqual(
          kontext.asked.find((call) => call.operation === "drafts.confirm")?.input,
          { id: "rounding", kind: "read" },
        );
        assert.strictEqual(decided[0]?.status, "resolving");
        assert.deepStrictEqual(decided[0]?.resolvedAs, {
          path: ENTRY.file,
          title: ENTRY.title,
          kind: "confirmed",
        });
        assert.strictEqual(done.staged?.path, ENTRY.file);
      }),
  );

  it.effect("records a person's reason with the confirmation as a read", () =>
    Effect.gen(function* () {
      const kontext = fakeKontext({ newer: true });
      const { flows } = flowsOver(kontext.client);
      yield* flows.decide({
        ...place,
        id: "ch1",
        decision: "confirmed",
        because: "Totals still round per line in total.ts",
      });
      assert.deepStrictEqual(
        kontext.asked.find((call) => call.operation === "drafts.confirm")?.input,
        { id: "rounding", kind: "read", because: "Totals still round per line in total.ts" },
      );
    }),
  );

  it("resolves a confirmation once a committed entry is checked on or after the challenge's first day", () => {
    const entry =
      (checked: string | undefined, state = "committed") =>
      () => ({
        file: ENTRY.file,
        title: ENTRY.title,
        kind: ENTRY.kind,
        status: "accepted",
        state,
        revision: "md:1",
        checked,
      });
    const resolving = challengeOf({
      status: "resolving",
      entryRevision: "md:1",
      resolvedAs: { path: ENTRY.file, title: ENTRY.title, kind: "confirmed" },
    });
    assert.deepStrictEqual(challengeUpdates([resolving], entry("2026-10-18"))[0]?.bodies, [
      { status: "resolved" },
    ]);
    assert.deepStrictEqual(challengeUpdates([resolving], entry("2026-10-18", "staged")), []);
    assert.deepStrictEqual(challengeUpdates([resolving], entry("2026-10-17")), []);
    // A drift challenge confirmed outside Peer (`kontext confirm` in a merged task) goes through
    // resolving; a person's challenge waits for people.
    const open = challengeOf({ entryRevision: "md:1" });
    assert.deepStrictEqual(
      challengeUpdates([open], entry("2026-10-19"))[0]?.bodies.map((body) => body.status),
      ["resolving", "resolved"],
    );
    const { drift: _drift, ...person } = open;
    assert.deepStrictEqual(challengeUpdates([person], entry("2026-10-19")), []);
  });
});

describe("an entry's own check", () => {
  const place = { workspace: "acme", project: "app", entry: "rounding" };

  it.effect(
    "runs it through kontext and returns the outcome, its output's end and the commit",
    () =>
      Effect.gen(function* () {
        const kontext = fakeKontext({
          newer: true,
          verified: {
            id: "rounding",
            command: "cargo test rounding",
            passed: false,
            exit_code: 101,
            output_tail: `${"x".repeat(3000)}\ntest rounding ... FAILED\u0007`,
            at: "2026-10-27T10:00:00Z",
            commit: "A7450A5".padEnd(40, "0"),
          },
        });
        const { flows, logged } = flowsOver(kontext.client);
        const done = yield* flows.verifyCheck(place);
        assert.deepStrictEqual(
          kontext.asked.find((call) => call.operation === "drafts.verify")?.input,
          { id: "rounding" },
        );
        assert.isTrue(done.available);
        if (!done.available) return;
        assert.isFalse(done.passed);
        assert.strictEqual(done.exitCode, 101);
        assert.isAtMost(done.outputTail.length, 2048);
        assert.isTrue(done.outputTail.endsWith("test rounding ... FAILED"));
        assert.strictEqual(done.commit, "a7450a5".padEnd(40, "0"));
        assert.deepStrictEqual(logged.at(-1), {
          event: "knowledge.entry-verified",
          fields: { ...place, passed: false, exitCode: 101, commit: done.commit },
        });
      }),
  );

  it.effect("says it is not available, without an error, where kontext has no ledger", () =>
    Effect.gen(function* () {
      const done = yield* flowsOver(fakeKontext({ newer: true }).client).flows.verifyCheck(place);
      assert.isFalse(done.available);
    }),
  );

  it.effect("passes how the entry was verified and what changed since to the detail", () =>
    Effect.gen(function* () {
      const kontext = fakeKontext({
        newer: true,
        ledger: {
          verification: {
            at: "2026-10-25T08:00:00Z",
            kind: "bulk",
            commit: "4b33342".padEnd(40, "0"),
            by: "Ana",
            because: null,
            passed: null,
          },
          since: { commits: 3, head: HEAD_2, paths: ["src/pricing/total.ts", "../outside.ts"] },
          verify: "cargo test rounding",
          premises: [{ id: "old-rounding", status: "superseded" }],
        },
      });
      const detail = yield* flowsOver(kontext.client).flows.entry(place);
      assert.strictEqual(detail?.verification?.kind, "bulk");
      assert.deepStrictEqual(detail?.since, {
        commits: 3,
        head: HEAD_2,
        paths: ["src/pricing/total.ts"],
      });
      assert.strictEqual(detail?.verify, "cargo test rounding");
      assert.deepStrictEqual(detail?.premises, [{ id: "old-rounding", status: "superseded" }]);
      assert.notProperty(detail?.verification, "landed");
    }),
  );

  it.effect("passes where a verification landed: a commit, or null while only staged", () =>
    Effect.gen(function* () {
      const at = (landed: unknown) =>
        flowsOver(
          fakeKontext({
            newer: true,
            ledger: {
              verification: {
                at: "2026-10-27T10:00:00Z",
                kind: "verify",
                commit: HEAD_2,
                by: "Ana",
                because: null,
                passed: true,
                landed,
              },
            },
          }).client,
        ).flows.entry(place);
      assert.strictEqual(
        (yield* at("ABC1234".padEnd(40, "0")))?.verification?.landed,
        "abc1234".padEnd(40, "0"),
      );
      assert.isNull((yield* at(null))?.verification?.landed);
      assert.isNull((yield* at("not a commit"))?.verification?.landed);
    }),
  );
});

const CHECK = "cargo test rounding";
const CHECKED = { ...ROUNDING, verify: CHECK };
const ran = (passed: boolean, id = "rounding") => ({
  id,
  command: CHECK,
  passed,
  exit_code: passed ? 0 : 101,
  timed_out: false,
  output_tail: passed
    ? "test result: ok"
    : "running 1 test\ntest rounding ... FAILED\nerror: 1 failed",
  at: "2026-10-27T10:00:00Z",
  commit: HEAD_2,
  path: ".ai/confirmations.log",
});

describe("an entry's check before its drift is filed", () => {
  const place = { workspace: "acme", project: "app" };
  /** The flows with the default branch moved once, filing what `kontext` lists. */
  const moved = (kontext: ReturnType<typeof fakeKontext>) =>
    Effect.gen(function* () {
      const over = flowsOver(kontext.client);
      yield* over.flows.verify(place.workspace, place.project, "/repo");
      over.head.current = HEAD_2;
      yield* over.flows.verify(place.workspace, place.project, "/repo");
      return over;
    });
  const runs = (kontext: ReturnType<typeof fakeKontext>) =>
    kontext.asked.filter((call) => call.operation === "drafts.verify");

  it.effect("files a passed check's challenge already resolving as verified", () =>
    Effect.gen(function* () {
      const kontext = fakeKontext({ newer: true, drifted: [CHECKED], verified: ran(true) });
      const { opened, decided, logged } = yield* moved(kontext);
      assert.deepStrictEqual(
        runs(kontext).map((call) => call.input),
        [{ id: "rounding" }],
      );
      assert.lengthOf(opened, 1);
      assert.notProperty(opened[0]?.drift, "verify");
      assert.deepStrictEqual(decided[0], {
        status: "resolving",
        resolvedAs: { path: ROUNDING.path, title: ROUNDING.title, kind: "verified" },
      });
      assert.deepStrictEqual(
        logged.find((line) => line.event === "knowledge.drift-verified")?.fields,
        { ...place, head: HEAD_2, checked: 1, passed: 1, failed: 0, skipped: 0 },
      );
    }),
  );

  it.effect("files a failed check with what it said, and says so in the reason", () =>
    Effect.gen(function* () {
      const kontext = fakeKontext({ newer: true, drifted: [CHECKED], verified: ran(false) });
      const { opened, decided } = yield* moved(kontext);
      assert.deepStrictEqual(opened[0]?.drift, {
        ...driftBody(HEAD_2, ROUNDING),
        verify: {
          passed: false,
          command: CHECK,
          exitCode: 101,
          outputTail: "running 1 test\ntest rounding ... FAILED\nerror: 1 failed",
          at: "2026-10-27T10:00:00Z",
          commit: HEAD_2,
        },
      });
      assert.match(
        String(opened[0]?.reason),
        /^Its check `cargo test rounding` exited 101\. Code it governs changed/,
      );
      assert.isAtMost(String(opened[0]?.reason).length, 300);
      assert.isFalse(decided.some((body) => body.resolvedAs?.kind === "verified"));
    }),
  );

  it.effect("files as before where kontext cannot run checks or the entry names none", () =>
    Effect.gen(function* () {
      const without = fakeKontext({ newer: true, drifted: [CHECKED] });
      const plain = fakeKontext({ newer: true, drifted: [ROUNDING], verified: ran(true) });
      for (const kontext of [without, plain]) {
        const { opened, decided } = yield* moved(kontext);
        assert.isEmpty(runs(kontext));
        assert.deepStrictEqual(opened, [
          {
            entry: "rounding",
            reason: driftReason(ROUNDING),
            origin: "drift",
            drift: driftBody(HEAD_2, ROUNDING),
          },
        ]);
        assert.isFalse(decided.some((body) => body.resolvedAs?.kind === "verified"));
      }
    }),
  );

  it.effect("runs eight checks a filing, never twice for one entry and head", () =>
    Effect.gen(function* () {
      const many = Array.from({ length: 10 }, (_, i) => ({ ...CHECKED, id: `rule-${i}` }));
      const kontext = fakeKontext({
        newer: true,
        drifted: many,
        verified: (id) => ran(false, id),
      });
      const over = flowsOver(kontext.client);
      yield* over.flows.verify(place.workspace, place.project, "/repo");
      over.head.current = HEAD_2;
      // The Hub misses the filing: it is retried with the outcomes, not with the checks again.
      over.hubDown.current = true;
      yield* over.flows.verify(place.workspace, place.project, "/repo");
      assert.lengthOf(runs(kontext), 8);
      over.hubDown.current = false;
      yield* over.flows.verify(place.workspace, place.project, "/repo");
      assert.lengthOf(runs(kontext), 8);
      assert.lengthOf(over.opened, 10);
      assert.lengthOf(
        over.opened.filter((body) => (body.drift as { verify?: unknown }).verify !== undefined),
        8,
      );
      assert.deepStrictEqual(
        over.logged.find((line) => line.event === "knowledge.drift-verified")?.fields,
        { ...place, head: HEAD_2, checked: 8, passed: 0, failed: 8, skipped: 2 },
      );
    }),
  );
});

describe("a committed check resolves", () => {
  const verification = (
    more: Partial<PeerKnowledgeVerification> = {},
  ): PeerKnowledgeVerification => ({
    at: "2026-10-18T12:00:00Z",
    kind: "verify",
    commit: HEAD_2,
    by: "Ana",
    because: null,
    passed: true,
    landed: COMMIT,
    ...more,
  });
  const entry = (verified: PeerKnowledgeVerification) => () => ({
    file: ENTRY.file,
    title: ENTRY.title,
    kind: ENTRY.kind,
    status: "accepted",
    state: "staged",
    revision: "md:1",
    verification: verified,
  });
  const statuses = (challenge: PeerKnowledgeChallenge, verified: PeerKnowledgeVerification) =>
    challengeUpdates([challenge], entry(verified))[0]?.bodies.map((body) => body.status) ?? [];

  it("resolves a drift challenge once a passed check landed on or after its first day", () => {
    const open = challengeOf({ entryRevision: "md:1" });
    assert.deepStrictEqual(challengeUpdates([open], entry(verification()))[0]?.bodies, [
      {
        status: "resolving",
        resolvedAs: { path: ENTRY.file, title: ENTRY.title, kind: "verified" },
      },
      { status: "resolved" },
    ]);
    for (const kind of ["verified", "confirmed"])
      assert.deepStrictEqual(
        statuses(
          challengeOf({
            status: "resolving",
            entryRevision: "md:1",
            resolvedAs: { path: ENTRY.file, title: ENTRY.title, kind },
          }),
          verification(),
        ),
        ["resolved"],
      );
  });

  it("does not resolve on a pass only staged, a failure, an older one or a person's challenge", () => {
    const open = challengeOf({ entryRevision: "md:1" });
    assert.isEmpty(statuses(open, verification({ landed: null })));
    assert.isEmpty(statuses(open, verification({ landed: undefined })));
    assert.isEmpty(statuses(open, verification({ passed: false })));
    assert.isEmpty(statuses(open, verification({ at: "2026-10-17T23:00:00Z" })));
    assert.isEmpty(statuses(open, verification({ kind: "agent", passed: null })));
    const { drift: _drift, ...person } = open;
    assert.isEmpty(statuses(person, verification()));
  });
});

describe("an entry's check at peer review", () => {
  const drift = { base: HEAD_1, head: "working", entries: [CHECKED] };
  const outcome = (passed: boolean): PeerKnowledgeVerified => ({
    available: true,
    passed,
    exitCode: passed ? 0 : 101,
    outputTail: passed ? "ok" : "running 1 test\ntest rounding ... FAILED\nerror: 1 failed",
    at: "2026-10-27T10:00:00Z",
    commit: HEAD_2,
  });

  it.effect("settles an entry whose check passed, for the session at that head", () =>
    Effect.gen(function* () {
      const asked: string[] = [];
      const check = reviewChecks(async (_checkout, id) => {
        asked.push(id);
        return outcome(true);
      });
      const first = yield* check("s1", "/repo", drift, 5000);
      assert.deepStrictEqual([...first.passed], ["rounding"]);
      assert.isNull(reviewRefusal({ ...drift, entries: [] }, new Set(), first.checks));
      yield* check("s1", "/repo", drift, 5000);
      assert.deepStrictEqual(asked, ["rounding"]);
      yield* check("s2", "/repo", drift, 5000);
      assert.deepStrictEqual(asked, ["rounding", "rounding"]);
    }),
  );

  it.effect("names a failed check with the end of its output, and runs it again next time", () =>
    Effect.gen(function* () {
      let runs = 0;
      const check = reviewChecks(async () => {
        runs += 1;
        return outcome(false);
      });
      const said = yield* check("s1", "/repo", drift, 5000);
      assert.isEmpty(said.passed);
      const stopped = reviewRefusal(drift, new Set(), said.checks)?.reason ?? "";
      assert.include(
        stopped,
        "  its check `cargo test rounding` exited 101 at 2222222: running 1 test / test rounding ... FAILED / error: 1 failed",
      );
      yield* check("s1", "/repo", drift, 5000);
      assert.strictEqual(runs, 2);
    }),
  );

  it.effect("says a check still runs when the review cannot wait, and reads it next time", () =>
    Effect.gen(function* () {
      let finish: (verified: PeerKnowledgeVerified) => void = () => undefined;
      const pending = new Promise<PeerKnowledgeVerified>((resolve) => {
        finish = resolve;
      });
      const check = reviewChecks(() => pending);
      const said = yield* check("s1", "/repo", drift, 0);
      assert.include(
        reviewRefusal(drift, new Set(), said.checks)?.reason ?? "",
        "its check `cargo test rounding` is still running",
      );
      finish(outcome(true));
      yield* Effect.promise(() => pending);
      const next = yield* check("s1", "/repo", drift, 1000);
      assert.deepStrictEqual([...next.passed], ["rounding"]);
      assert.strictEqual(next.started, 0);
    }),
  );
});
