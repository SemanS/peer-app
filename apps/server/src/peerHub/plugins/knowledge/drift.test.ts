import { assert, describe, it } from "@effect/vitest";
import {
  PeerHubError,
  type PeerKnowledgeChallenge,
  type PeerKnowledgeChallenges,
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
const fakeKontext = (options: { readonly newer: boolean; drifted?: ReadonlyArray<DriftEntry> }) => {
  const asked: Array<{ readonly operation: string; readonly input: Record<string, unknown> }> = [];
  const client: KontextClientShape = {
    run: async (args, _cwd, stdin) => {
      const operation = args[3] ?? "";
      const input = JSON.parse(stdin ?? "{}") as Record<string, unknown>;
      asked.push({ operation, input });
      const extra = options.newer ? ["entries.drift", "drafts.confirm"] : [];
      if (operation === "status")
        return envelope({
          api_version: 1,
          version: options.newer ? "0.4.0" : "0.3.0",
          store: { configured: true, dir: ".ai" },
          capabilities: ["status", "entries.get", ...extra],
          llm: { available: false },
        });
      if (operation === "entries.get")
        return envelope({ entry: { ...ENTRY, publication: { state: "committed" } } });
      if (!extra.includes(operation)) return refusal("unsupported_operation");
      if (operation === "entries.drift")
        return envelope({ base: input.base, head: input.head, entries: options.drifted ?? [] });
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
    log: () => Effect.void,
  });
  return { flows, opened, decided, head, hubDown };
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
          { id: "rounding" },
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
