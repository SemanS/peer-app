import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { keepingFlows } from "./keeping.ts";
import { kontextIn, type KontextClientShape } from "./kontext.ts";

type Deps = Parameters<typeof keepingFlows>[0];

/** Only what harvest reaches; the rest of keeping's dependencies stay unused. */
function harvestOnly(contextText: string | null) {
  const read: string[] = [];
  const proposed: Array<{ text: string; origin?: string; task?: string }> = [];
  const store = {
    checkout: "/repo",
    llm: true,
    kontext: {
      harvest: async (input: { text: string }) => {
        read.push(input.text);
        return [{ title: "Prices are whole cents", kind: "decision", body: "", paths: [] }];
      },
    },
  };
  const deps = {
    state: { pluginData: () => ({}) },
    client: {
      session: Effect.succeed({ hubUrl: "https://hub", session: "s" }),
      api: {
        readContext: () =>
          Effect.succeed(contextText === null ? null : { text: contextText, version: 3 }),
      },
    },
    agents: { hubChanged: Effect.void },
    work: { taskName: () => Effect.succeed("Checkout") },
    status: {},
    hub: {
      propose: (_workspace: string, _project: string, input: (typeof proposed)[number]) =>
        Effect.sync(() => void proposed.push(input)),
    },
    statusOf: () => Effect.die("unused"),
    checkoutOf: () => Effect.die("unused"),
    storeOf: () => Effect.succeed(store),
  } as unknown as Deps;
  return { flows: keepingFlows(deps), read, proposed };
}

describe("harvest", () => {
  it.effect("reads the conversations a person sends instead of the shared context", () =>
    Effect.gen(function* () {
      const { flows, read, proposed } = harvestOnly("the saved context");
      const result = yield* flows.harvest({
        workspace: "acme",
        project: "shop",
        scope: "project",
        conversations: "## Prices\nAgent reply: prices are integers now.",
      });
      expect(result).toEqual({ proposed: 1 });
      expect(read).toEqual(["## Prices\nAgent reply: prices are integers now."]);
      expect(proposed[0]?.origin).toBe("conversations:project");
    }),
  );

  it.effect("reads the shared context, naming its version, when no conversations are sent", () =>
    Effect.gen(function* () {
      const { flows, read, proposed } = harvestOnly("the saved context");
      yield* flows.harvest({ workspace: "acme", project: "shop", scope: "task:t1" });
      expect(read).toEqual(["the saved context"]);
      expect(proposed[0]).toMatchObject({ origin: "context:task:t1@v3", task: "t1" });
    }),
  );
});

/** A kontext machine with `drafts.extend` that answers as design D3 says, and what it was asked. */
function extendingKontext(options: { readonly refuse?: string } = {}) {
  const calls: Array<{ readonly operation: string; readonly input: Record<string, unknown> }> = [];
  const ok = (result: unknown) => ({
    code: 0,
    stdout: JSON.stringify({ schema_version: 1, ok: true, result }),
    stderr: "",
  });
  const no = (code: string, message = code) => ({
    code: 1,
    stdout: JSON.stringify({ schema_version: 1, ok: false, error: { code, message } }),
    stderr: "",
  });
  const learning = {
    id: "hls-test-fixtures",
    kind: "learning",
    title: "HLS test fixtures",
    file: ".ai/learnings/hls-test-fixtures.md",
    body: "Fixtures live in tests/hls.",
    paths: ["tests/hls/**"],
    tags: ["testing"],
  };
  const client: KontextClientShape = {
    run: async (args, _cwd, stdin) => {
      const operation = args[3] ?? "";
      const input = JSON.parse(stdin ?? "{}") as Record<string, unknown>;
      calls.push({ operation, input });
      switch (operation) {
        case "drafts.extend":
          if (options.refuse !== undefined)
            return no(options.refuse, "Decisions change only by supersession.");
          return ok({
            entry: {
              ...learning,
              body: `${learning.body}\n\n## Added 2026-10-29\n\n${String(input.text)}`,
            },
            old_body: learning.body,
            as_written: true,
            notes: ["no llm adapter"],
          });
        case "operations.get":
          return no("not_found");
        case "entries.search":
          return ok({ entries: [] });
        case "entries.get":
          return input.id === "worker-only"
            ? ok({
                entry: {
                  id: "worker-only",
                  kind: "decision",
                  title: "Worker-only is the server default",
                },
              })
            : no("not_found");
        case "drafts.stage": {
          if (
            options.refuse === "stale_entry" ||
            (input.entry as { amends?: unknown }).amends === "stale"
          )
            return no("stale_entry");
          const entry = input.entry as Record<string, unknown>;
          return ok({
            entry: { ...learning, ...entry, title: String(entry.title ?? learning.title) },
            path:
              (entry.amends as unknown) === undefined
                ? ".ai/conventions/relay-tests.md"
                : learning.file,
            staged: true,
            replayed: false,
            related: [],
            notes: [],
          });
        }
        default:
          return no("unsupported_operation");
      }
    },
  };
  return {
    client,
    calls,
    count: (operation: string) => calls.filter((c) => c.operation === operation).length,
  };
}

/** Keeping's flows over a fake Hub and a project whose kontext (`extends`) can add to entries. */
function keepingOver(
  kontext: KontextClientShape,
  can: { readonly extends: boolean } = { extends: true },
) {
  const decided: Array<{ readonly id: string; readonly keptAs?: unknown }> = [];
  const candidate = {
    id: "c1",
    project: "shop",
    text: "Relay tests put their fake speech and chat servers behind the node.",
    sources: [
      {
        finding: "f",
        email: "ana@acme.test",
        session: "s1",
        task: "t1",
        text: "x",
        tagged: true,
        independent: true,
        at: "2026-10-29T00:00:00Z",
      },
    ],
    finders: 2,
    status: "proposed",
    firstAt: "2026-10-29T00:00:00Z",
    lastAt: "2026-10-29T00:00:00Z",
  };
  const store = {
    checkout: "/repo",
    store: true,
    llm: false,
    guidance: null,
    extends: can.extends,
    kontext: kontextIn(kontext, "/repo"),
  };
  const deps = {
    state: { pluginData: () => ({}) },
    client: {
      session: Effect.succeed({ hubUrl: "https://hub", session: "s" }),
      api: { readContext: () => Effect.succeed(null) },
    },
    agents: { hubChanged: Effect.void },
    work: { taskName: () => Effect.succeed("Relay") },
    status: { publish: Effect.void },
    hub: {
      candidates: () => Effect.succeed([candidate]),
      decide: (_w: string, _p: string, id: string, _status: string, keptAs?: unknown) =>
        Effect.sync(() => void decided.push({ id, keptAs })),
    },
    statusOf: () => Effect.die("unused"),
    checkoutOf: () => Effect.die("unused"),
    storeOf: () => Effect.succeed(store),
  } as unknown as Deps;
  return { flows: keepingFlows(deps), decided };
}

const place = { workspace: "acme", project: "shop", id: "c1" };
const into = { entry: "hls-test-fixtures", revision: "r1" };

describe("previewing a keep", () => {
  it.effect("drafts once per entry revision and again when the revision moved", () =>
    Effect.gen(function* () {
      const kontext = extendingKontext();
      const { flows } = keepingOver(kontext.client);
      const first = yield* flows.preview({ ...place, operation: "add", entry: into });
      const again = yield* flows.preview({ ...place, operation: "add", entry: into });
      expect(again).toEqual(first);
      expect(kontext.count("drafts.extend")).toBe(1);
      expect(kontext.calls.find((c) => c.operation === "drafts.extend")?.input).toEqual({
        entry_id: "hls-test-fixtures",
        entry_revision: "r1",
        text: "Relay tests put their fake speech and chat servers behind the node.",
      });
      expect(first).toMatchObject({
        operation: "add",
        entry: {
          id: "hls-test-fixtures",
          kind: "learning",
          path: ".ai/learnings/hls-test-fixtures.md",
        },
        oldBody: "Fixtures live in tests/hls.",
        asWritten: "no llm adapter",
      });
      expect(first.body).toContain("## Added 2026-10-29");
      expect(first.words).toBe(first.body.split(/\s+/).filter(Boolean).length);
      yield* flows.preview({ ...place, operation: "add", entry: { ...into, revision: "r2" } });
      expect(kontext.count("drafts.extend")).toBe(2);
    }),
  );

  it.effect("names a new entry's links by title and refuses adding on an older kontext", () =>
    Effect.gen(function* () {
      const kontext = extendingKontext();
      const linked = yield* keepingOver(kontext.client).flows.preview({
        ...place,
        operation: "new",
        extends: ["worker-only"],
      });
      expect(linked.links).toEqual([
        { entry: "worker-only", title: "Worker-only is the server default" },
      ]);
      expect(linked.entry.path).toBeNull();
      expect(kontext.count("drafts.stage")).toBe(0);
      const older = yield* keepingOver(kontext.client, { extends: false })
        .flows.preview({ ...place, operation: "add", entry: into })
        .pipe(Effect.flip);
      expect(older.detail).toContain("drafts.extend");
    }),
  );
});

describe("keeping by an operation", () => {
  it.effect("adds into the entry it showed, staging the shown draft with amends", () =>
    Effect.gen(function* () {
      const kontext = extendingKontext();
      const { flows, decided } = keepingOver(kontext.client);
      const shown = yield* flows.preview({ ...place, operation: "add", entry: into });
      const kept = yield* flows.keep({ ...place, into });
      expect(kontext.count("drafts.extend")).toBe(1);
      const stage = kontext.calls.find((c) => c.operation === "drafts.stage")!.input;
      expect(stage.entry).toMatchObject({
        body: shown.body,
        amends: { id: "hls-test-fixtures", revision: "r1" },
      });
      expect(kept).toMatchObject({
        way: "amended",
        keptAs: { path: ".ai/learnings/hls-test-fixtures.md", kind: "learning" },
      });
      expect(decided[0]?.keptAs).toEqual(kept.keptAs);
    }),
  );

  it.effect("tells a stale entry and a decision apart from other failures", () =>
    Effect.gen(function* () {
      const stale = yield* keepingOver(extendingKontext({ refuse: "stale_entry" }).client)
        .flows.keep({ ...place, into })
        .pipe(Effect.flip);
      expect(stale).toMatchObject({
        code: "stale_entry",
        detail: "This entry changed since it was compared; compare again",
      });
      const decision = yield* keepingOver(
        extendingKontext({ refuse: "decision_not_amended" }).client,
      )
        .flows.keep({ ...place, into })
        .pipe(Effect.flip);
      expect(decision).toMatchObject({
        code: "decision_not_amended",
        detail: "Decisions change only by supersession.",
      });
    }),
  );

  it.effect("links a new entry to the decision it builds on without superseding it", () =>
    Effect.gen(function* () {
      const kontext = extendingKontext();
      const kept = yield* keepingOver(kontext.client).flows.keep({
        ...place,
        extends: ["worker-only"],
      });
      const stage = kontext.calls.find((c) => c.operation === "drafts.stage")!.input;
      expect(stage.entry).toMatchObject({ extends: ["worker-only"] });
      expect(stage.entry).not.toHaveProperty("supersedes");
      expect(stage.entry).not.toHaveProperty("amends");
      expect(kept.way).toBe("new");
    }),
  );

  it.effect("keeps a new entry, with a note, where kontext cannot add to one", () =>
    Effect.gen(function* () {
      const kontext = extendingKontext();
      const kept = yield* keepingOver(kontext.client, { extends: false }).flows.keep({
        ...place,
        into,
      });
      expect(kontext.count("drafts.extend")).toBe(0);
      const stage = kontext.calls.find((c) => c.operation === "drafts.stage")!.input;
      expect(stage.entry).not.toHaveProperty("amends");
      expect(kept).toMatchObject({
        way: "new",
        note: expect.stringContaining("cannot add to an entry"),
      });
    }),
  );

  it.effect("replaces as today and says so", () =>
    Effect.gen(function* () {
      const kontext = extendingKontext();
      const kept = yield* keepingOver(kontext.client).flows.keep({
        ...place,
        supersedes: ["prices"],
      });
      const stage = kontext.calls.find((c) => c.operation === "drafts.stage")!.input;
      expect(stage.entry).toMatchObject({ supersedes: ["prices"] });
      expect(kept.way).toBe("superseding");
    }),
  );
});
