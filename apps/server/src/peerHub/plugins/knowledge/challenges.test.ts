import { assert, describe, it } from "@effect/vitest";
import { PeerHubError, type PeerKnowledgeChallenge } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import type { KontextClientShape, KontextEntry } from "../../kontext.ts";
import { entryRevision } from "../../kontext.ts";
import { challengeFlows, type FlowDeps } from "./client/challengeFlows.ts";
import {
  challengeCache,
  challengeUpdates,
  type ChallengesHub,
  type DecideBody,
} from "./client/challenges.ts";
import { challengeActions, evidenceOf } from "./client/resolve.ts";

const CHALLENGE: PeerKnowledgeChallenge = {
  id: "ch1",
  project: "app",
  entry: "prices",
  reason: "formatPrice takes decimals",
  sources: [
    {
      finding: "f1",
      email: "vir@acme.test",
      session: "claude:vir",
      task: "krk-412",
      text: "formatPrice takes decimals since krk-412",
      tagged: false,
      independent: true,
      at: "2026-10-18T10:00:00Z",
    },
  ],
  finders: 1,
  people: [],
  status: "open",
  firstAt: "2026-10-18T10:00:00Z",
  lastAt: "2026-10-18T10:00:00Z",
};

const ENTRY: KontextEntry = {
  id: "prices",
  kind: "decision",
  title: "Prices are integer cents",
  status: "accepted",
  date: "2026-10-04",
  summary: "Cents.",
  tags: [],
  paths: ["src/pricing/**"],
  file: ".ai/decisions/prices.md",
  body: "Integer cents.",
  markdown: "# Prices are integer cents\n",
};
const REVISION = entryRevision(ENTRY.markdown);

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

/** A kontext with `operations`, its entry as `entry.current` is, and the receipts it keeps. */
const fakeKontext = (operations: ReadonlyArray<string>, entry = { current: ENTRY }) => {
  const asked: Array<{ readonly operation: string; readonly input: Record<string, unknown> }> = [];
  const receipts = new Map<string, unknown>();
  const client: KontextClientShape = {
    run: async (args, _cwd, stdin) => {
      const operation = args[3] ?? "";
      const input = JSON.parse(stdin ?? "{}") as Record<string, unknown>;
      asked.push({ operation, input });
      if (operation === "status")
        return envelope({
          api_version: 1,
          version: "0.3.0",
          store: { configured: true, dir: ".ai" },
          capabilities: ["status", "entries.get", "drafts.stage", "operations.get", ...operations],
          llm: { available: true },
        });
      if (operation === "entries.get")
        return input.id === entry.current.id
          ? envelope({
              entry: { ...entry.current, publication: { state: "committed", revision: "HEAD1" } },
            })
          : refusal("not_found");
      if (operation === "operations.get") {
        const kept = receipts.get(String(input.operation_id));
        return kept === undefined ? refusal("not_found") : envelope(kept);
      }
      if (operation === "drafts.stage" || operation === "drafts.retire") {
        const result = {
          entry: {
            ...ENTRY,
            title: operation === "drafts.retire" ? ENTRY.title : "Prices are decimals",
          },
          path: operation === "drafts.retire" ? ENTRY.file : ".ai/decisions/decimals.md",
        };
        receipts.set(String(input.operation_id), result);
        return envelope(result);
      }
      if (operation === "drafts.revise")
        return envelope({
          entry: {
            kind: "decision",
            title: "Prices are decimals",
            body: "Decimals.",
            supersedes: ["prices"],
          },
          notes: [],
        });
      if (operation === "entries.related")
        return input.llm === true
          ? refusal("model_unavailable")
          : envelope({
              candidates: [
                {
                  id: "prices",
                  title: ENTRY.title,
                  kind: "decision",
                  reason: "reads alike",
                  label: "related, check",
                },
              ],
            });
      return refusal("unsupported_operation");
    },
  };
  return { client, asked, receipts };
};

describe("a project's challenges as hooks read them", () => {
  it.effect(
    "keeps the last list when the Hub cannot be read, and changes its version only on change",
    () =>
      Effect.gen(function* () {
        const answers: Array<Effect.Effect<ReadonlyArray<PeerKnowledgeChallenge>, PeerHubError>> = [
          Effect.succeed([CHALLENGE]),
          Effect.fail(new PeerHubError({ detail: "down" })),
          Effect.succeed([CHALLENGE]),
        ];
        const cache = challengeCache(() => answers.shift() ?? Effect.succeed([]));
        assert.isTrue(cache.want("acme", "app"));
        assert.isFalse(cache.want("acme", "app"));
        yield* cache.refresh("acme");
        assert.deepStrictEqual(cache.of("acme", "app"), [CHALLENGE]);
        const version = cache.version("acme", "app");
        yield* cache.refresh("acme");
        assert.deepStrictEqual(cache.of("acme", "app"), [CHALLENGE]);
        yield* cache.refresh("acme");
        assert.strictEqual(cache.version("acme", "app"), version);
        // Another workspace's refresh reads nothing of acme's.
        yield* cache.refresh("other");
        assert.strictEqual(answers.length, 0);
        cache.clear();
        assert.deepStrictEqual(cache.of("acme", "app"), []);
      }),
  );
});

describe("verified resolution", () => {
  const now = (status: string | undefined, state: string | undefined) => () => ({
    file: ENTRY.file,
    title: ENTRY.title,
    kind: ENTRY.kind,
    status,
    state,
    revision: REVISION,
  });
  const resolving = { ...CHALLENGE, status: "resolving" as const, entryRevision: REVISION };

  it("leaves a challenge resolving while its change is only staged", () => {
    assert.deepStrictEqual(challengeUpdates([resolving], now("superseded", "staged")), []);
    assert.deepStrictEqual(challengeUpdates([resolving], now("accepted", "committed")), []);
  });
  it("resolves it once a committed or reviewed revision shows the entry retired", () => {
    for (const state of ["committed", "reviewed_ref"])
      assert.deepStrictEqual(challengeUpdates([resolving], now("superseded", state)), [
        { id: "ch1", bodies: [{ status: "resolved" }] },
      ]);
    assert.deepStrictEqual(
      challengeUpdates([resolving], now("deprecated", "committed"))[0]?.bodies,
      [{ status: "resolved" }],
    );
  });
  it("does not guess when the entry is gone from the checkout", () => {
    assert.deepStrictEqual(
      challengeUpdates([resolving], () => null),
      [],
    );
    assert.deepStrictEqual(
      challengeUpdates([resolving], () => undefined),
      [],
    );
  });
  it("resolves an open challenge of an entry superseded outside Peer through resolving", () => {
    const bodies = challengeUpdates([CHALLENGE], now("superseded", "committed"))[0]?.bodies;
    assert.deepStrictEqual(
      bodies?.map((body: DecideBody) => body.status),
      ["resolving", "resolved"],
    );
  });
  it("gives a challenge without one the entry's revision, once", () => {
    assert.deepStrictEqual(challengeUpdates([CHALLENGE], now("accepted", "committed")), [
      { id: "ch1", bodies: [{ status: "open", entryRevision: REVISION }] },
    ]);
    assert.deepStrictEqual(
      challengeUpdates([{ ...CHALLENGE, entryRevision: "md:old" }], now("accepted", "committed")),
      [],
    );
    // Decided ones are left alone.
    assert.deepStrictEqual(
      challengeUpdates([{ ...CHALLENGE, status: "dismissed" }], now("superseded", "committed")),
      [],
    );
  });
});

describe("acting on a challenge with kontext", () => {
  const draft = {
    kind: "decision",
    title: "Prices are decimals",
    body: "Decimals.",
    paths: ["src/pricing/**"],
  };

  it("refuses an entry that changed since it was challenged until it was read again", async () => {
    const entry = { current: ENTRY };
    const kontext = fakeKontext(["drafts.retire"], entry);
    const actions = challengeActions(kontext.client, "/repo");
    entry.current = { ...ENTRY, markdown: "# Prices are decimals now\n" };
    const changed = { ...CHALLENGE, entryRevision: REVISION };
    await actions.retire({ challenge: changed, seenRevision: undefined }).then(
      () => assert.fail("retired a changed entry"),
      (error: Error) => assert.include(error.message, "changed since it was challenged"),
    );
    const read = entryRevision(entry.current.markdown);
    const kept = await actions.retire({ challenge: changed, seenRevision: read });
    assert.strictEqual(kept.path, ENTRY.file);
    // kontext's own conflict check gets the revision it publishes, not Peer's.
    const retire = kontext.asked.find((call) => call.operation === "drafts.retire");
    assert.strictEqual(retire?.input.entry_revision, "HEAD1");
    assert.strictEqual(retire?.input.reason, "formatPrice takes decimals since krk-412");
  });

  it("stages the same draft once, and another draft under another operation", async () => {
    const kontext = fakeKontext([]);
    const actions = challengeActions(kontext.client, "/repo");
    const input = { challenge: CHALLENGE, draft, seenRevision: undefined, source: "peer://x" };
    const first = await actions.replace(input);
    const again = await actions.replace(input);
    assert.deepStrictEqual(again, first);
    const stages = () => kontext.asked.filter((call) => call.operation === "drafts.stage");
    assert.strictEqual(stages().length, 1);
    assert.deepStrictEqual(
      (stages()[0]?.input.entry as { supersedes?: unknown } | undefined)?.supersedes,
      ["prices"],
    );
    await actions.replace({ ...input, draft: { ...draft, body: "Decimals, rounded once." } });
    assert.strictEqual(stages().length, 2);
    assert.notStrictEqual(stages()[0]?.input.operation_id, stages()[1]?.input.operation_id);
  });
});

/** The flows over a Hub that keeps `challenge` and fails decisions while `failing`. */
const flowsOver = (operations: ReadonlyArray<string>, llm = true) => {
  const kontext = fakeKontext(operations);
  let challenge = CHALLENGE;
  const hubState = { failing: false, decided: [] as DecideBody[] };
  const hub: ChallengesHub = {
    list: () => Effect.succeed([challenge]),
    open: () => Effect.succeed(challenge),
    decide: (_workspace, _project, _id, body) =>
      hubState.failing
        ? Effect.fail(new PeerHubError({ detail: "Hub down." }))
        : Effect.sync(() => {
            hubState.decided.push(body);
            challenge = { ...challenge, status: body.status };
            return challenge;
          }),
  };
  const deps: FlowDeps = {
    hub,
    cache: challengeCache(hub.list),
    kontext: kontext.client,
    served: Effect.succeed(true),
    storeOf: () => Effect.succeed({ checkout: "/repo", llm }),
    book: () => Effect.succeed([]),
    candidates: () =>
      Effect.succeed([
        {
          id: "c1",
          project: "app",
          text: "Prices are decimals",
          sources: [],
          finders: 1,
          status: "proposed",
          firstAt: "",
          lastAt: "",
        },
      ]),
    changed: Effect.void,
    log: () => Effect.void,
  };
  return { flows: challengeFlows(deps), kontext, hubState };
};

describe("what people can do with a challenge here", () => {
  const place = { workspace: "acme", project: "app" };

  it.effect("reads one saved entry without opening a challenge or running a model", () =>
    Effect.gen(function* () {
      const { flows, kontext, hubState } = flowsOver([]);
      const entry = yield* flows.entry({ ...place, entry: ENTRY.id });
      assert.strictEqual(entry?.title, ENTRY.title);
      assert.strictEqual(entry?.body, ENTRY.body);
      assert.strictEqual(entry?.file, ENTRY.file);
      assert.isNotEmpty(entry?.revision);
      assert.deepStrictEqual(kontext.asked, [
        { operation: "entries.get", input: { id: ENTRY.id } },
      ]);
      assert.isEmpty(hubState.decided);
      assert.isNull(yield* flows.entry({ ...place, entry: "removed-entry" }));
    }),
  );

  it.effect("offers a replacement only where kontext can draft one, and says why not", () =>
    Effect.gen(function* () {
      const older = yield* flowsOver([]).flows.list(place);
      assert.deepStrictEqual(older.replace, {
        available: false,
        reason: "This needs kontext 0.3.0 or newer here (it has no drafts.revise).",
      });
      assert.isFalse(older.retire.available);
      const noModel = yield* flowsOver(["drafts.revise", "drafts.retire"], false).flows.list(place);
      assert.include(noModel.replace.reason ?? "", "llm adapter");
      assert.isTrue(noModel.retire.available);
      const newer = yield* flowsOver(["drafts.revise", "drafts.retire"]).flows.list(place);
      assert.isTrue(newer.replace.available);
      assert.strictEqual(newer.rows[0]?.current?.title, ENTRY.title);
      assert.isFalse(newer.rows[0]?.changed);
    }),
  );

  it.effect("keeps what it staged when the Hub fails after, and does not stage it again", () =>
    Effect.gen(function* () {
      const { flows, kontext, hubState } = flowsOver(["drafts.retire"]);
      hubState.failing = true;
      const failed = yield* flows
        .decide({ ...place, id: "ch1", decision: "retire" })
        .pipe(Effect.result);
      assert.isTrue(Result.isFailure(failed));
      if (Result.isFailure(failed)) assert.include(failed.failure.detail, `Staged ${ENTRY.file}`);
      hubState.failing = false;
      const done = yield* flows.decide({ ...place, id: "ch1", decision: "retire" });
      assert.strictEqual(done.staged?.path, ENTRY.file);
      assert.strictEqual(done.challenge.status, "resolving");
      assert.strictEqual(
        kontext.asked.filter((call) => call.operation === "drafts.retire").length,
        1,
      );
    }),
  );

  it.effect("resolves by hand through resolving, as the Hub asks", () =>
    Effect.gen(function* () {
      const { flows, hubState } = flowsOver([]);
      yield* flows.decide({ ...place, id: "ch1", decision: "resolved" });
      assert.deepStrictEqual(
        hubState.decided.map((body) => body.status),
        ["resolving", "resolved"],
      );
    }),
  );
});

describe("how a candidate relates to kept entries", () => {
  it.effect("asks kontext once per candidate and book, falling back to no model", () =>
    Effect.gen(function* () {
      const place = { workspace: "acme", project: "app", id: "c1" };
      const older = yield* flowsOver([]).flows.related(place);
      assert.include(older.unavailable ?? "", "entries.related");
      const { flows, kontext } = flowsOver(["entries.related"]);
      const first = yield* flows.related(place);
      assert.deepStrictEqual(first.relations, [
        { entry: "prices", title: ENTRY.title, relation: "related", reason: "reads alike" },
      ]);
      assert.deepStrictEqual(yield* flows.related(place), first);
      assert.strictEqual(
        kontext.asked.filter((call) => call.operation === "entries.related").length,
        2,
      );
    }),
  );
});

describe("evidence a kept candidate carries", () => {
  it("names tasks, origins and code at a revision, never an address or a session", () => {
    const evidence = evidenceOf({
      sources: [
        { text: "Totals round in src/pricing/total.ts", task: "krk-1" },
        { text: "Same in src/pricing/total.ts", task: "krk-2", origin: "context:task:krk-2@v7" },
        { text: "Also docs/missing.md", task: "krk-3" },
      ],
      finders: 3,
      code: { repo: "shop", rev: "abc123", files: new Set(["src/pricing/total.ts"]) },
    });
    assert.deepStrictEqual(evidence, {
      external_refs: [
        "task:krk-1",
        "code:shop@abc123:src/pricing/total.ts",
        "task:krk-2",
        "context:task:krk-2@v7",
        "task:krk-3",
      ],
      finders: "3",
    });
    assert.notInclude(JSON.stringify(evidence), "@acme");
  });
});
