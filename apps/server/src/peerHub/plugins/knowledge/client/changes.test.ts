// @effect-diagnostics nodeBuiltinImport:off - a scratch Git repository stands for the checkout.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import type { PeerSessionView } from "../../../core/plugin.ts";
import { entryRevision } from "../../../kontext.ts";
import type { KnowledgeEntry } from "../../../knowledgeEntry.ts";
import { known } from "../knowledgeIndex.ts";
import { changeNotices, governsPath } from "./changes.ts";
import type { KontextClientShape } from "./kontext.ts";

const success = (result: unknown) => ({
  code: 0,
  stdout: JSON.stringify({ schema_version: 1, ok: true, result }),
  stderr: "",
});

const ROUNDING_B = "# Round once per total\n";

/** kontext with `entries.changed` (or without it, `older`), listing `changes` for every move. */
const kontextWith = (changes: ReadonlyArray<Record<string, unknown>>, older = false) => {
  const asked: Array<Record<string, unknown>> = [];
  const client: KontextClientShape = {
    run: async (args, _cwd, stdin) => {
      const operation = args[3] ?? "";
      if (operation === "status")
        return success({
          api_version: 1,
          version: "1",
          store: { configured: true, dir: ".ai" },
          capabilities: older ? ["entries.list"] : ["entries.list", "entries.changed"],
          llm: { available: false },
        });
      if (operation === "entries.changed") {
        asked.push(JSON.parse(stdin ?? "{}") as Record<string, unknown>);
        return success({ changes });
      }
      throw new Error(`Unexpected engine operation: ${operation}`);
    },
  };
  return { asked, client };
};

const change = (id: string, more: Record<string, unknown> = {}) => ({
  id,
  kind: "decision",
  title: `Decision ${id}`,
  file: `.ai/decisions/${id}.md`,
  paths: [],
  revision: `rev-${id}`,
  change: "added",
  ...more,
});

const LANDED = [
  change("round-once", { title: "Round once per total", revision: entryRevision(ROUNDING_B) }),
  change("rounding", {
    title: "Round each line before the total",
    change: "superseded",
    superseded_by: ["round-once"],
    paths: ["src/pricing/total.ts"],
  }),
  change("registry", {
    kind: "learning",
    title: "Engines register once",
    paths: ["src/engines/**"],
  }),
  change("broad", { title: "Everything in src", paths: ["src/**"] }),
];

const entry = (id: string, markdown: string): KnowledgeEntry =>
  ({
    id,
    kind: "decision",
    title: id,
    status: "accepted",
    date: "2026-10-01",
    summary: "",
    tags: [],
    paths: [],
    file: `.ai/decisions/${id}.md`,
    body: "",
    revision: entryRevision(markdown),
    markdown,
  }) as KnowledgeEntry;

const session = (id = "claude:one", root = "/repo") =>
  ({
    id,
    workspace: "acme",
    project: "app",
    root,
  }) as PeerSessionView;

/** The notices of a project whose checkout's default branch moved once, from `base` to `head`. */
const moved = (
  changes: ReadonlyArray<Record<string, unknown>> = LANDED,
  options: {
    readonly older?: boolean;
    readonly root?: string;
    readonly heads?: readonly [string, string];
  } = {},
) =>
  Effect.gen(function* () {
    const kontext = kontextWith(changes, options.older);
    const [base, moved] = options.heads ?? ["base", "head"];
    const root = options.root ?? "/repo";
    const head = { current: base };
    const logged: Array<{ event: string; fields: Readonly<Record<string, unknown>> }> = [];
    const advised: Array<{ session: string; how: string; scope: string }> = [];
    const notices = changeNotices({
      kontext: kontext.client,
      cli: "peer",
      git: { defaultHead: async () => head.current },
      agents: {
        advise: (id, advice) =>
          Effect.sync(
            () => void advised.push({ session: id, how: advice.how, scope: advice.scope }),
          ),
        log: (event, fields) => Effect.sync(() => void logged.push({ event, fields })),
      },
    });
    // A session's first notice tells Peer where its project works; the first refresh is the baseline.
    yield* notices.notice(
      session("claude:one", root),
      { entries: new Set(), touching: new Set() },
      [],
      1200,
    );
    yield* Effect.promise(() => notices.refresh(root));
    head.current = moved;
    yield* Effect.promise(() => notices.refresh(root));
    return { notices, kontext, logged, advised };
  });

const told = (entries: ReadonlyArray<string> = [], touching: ReadonlyArray<string> = []) => ({
  entries: new Set(entries),
  touching: new Set(touching),
});
const ids = (found: ReadonlyArray<{ readonly change: { readonly id: string } }>) =>
  found.map(({ change }) => change.id);

describe("which landed knowledge changes concern a session", () => {
  it.effect("asks kontext over the move it saw, once", () =>
    Effect.gen(function* () {
      const { kontext } = yield* moved();
      assert.deepStrictEqual(kontext.asked, [{ base: "base", head: "head" }]);
    }),
  );

  it.effect("tells a session of an entry it read, or was told of, at another revision", () =>
    Effect.gen(function* () {
      const { notices } = yield* moved();
      const found = notices.changesFor(session(), told(["rounding@md:old"]), []);
      assert.deepStrictEqual(ids(found), ["rounding"]);
      assert.strictEqual(found[0]!.why, "read");
      // An older Peer kept the id alone.
      assert.deepStrictEqual(ids(notices.changesFor(session(), told(["rounding"]), [])), [
        "rounding",
      ]);
    }),
  );

  it.effect(
    "tells a session changing a file a narrow pattern governs, and not one a broad pattern does",
    () =>
      Effect.gen(function* () {
        const { notices } = yield* moved();
        const found = notices.changesFor(session(), told([], ["src/engines/registry.ts"]), []);
        assert.deepStrictEqual(ids(found), ["registry"]);
        assert.deepStrictEqual(found[0]!.why, {
          pattern: "src/engines/**",
          path: "src/engines/registry.ts",
        });
        // A literal file governs itself.
        assert.deepStrictEqual(
          ids(notices.changesFor(session(), told([], ["src/pricing/total.ts"]), [])),
          ["rounding"],
        );
      }),
  );

  it.effect("leaves out a revision it was told of already", () =>
    Effect.gen(function* () {
      const { notices } = yield* moved();
      assert.deepStrictEqual(
        ids(notices.changesFor(session(), told(["rounding@md:old", "rounding@rev-rounding"]), [])),
        [],
      );
    }),
  );

  it.effect("does not tell the author, whose own checkout already holds the landed entry", () =>
    Effect.gen(function* () {
      const { notices } = yield* moved();
      // The author read both entries and wrote round-once: its book has it at the landed revision,
      // and lists rounding no more.
      const book = [known(entry("round-once", ROUNDING_B))];
      assert.deepStrictEqual(
        ids(notices.changesFor(session(), told(["rounding@md:a", "round-once@md:b"]), book)),
        [],
      );
      // A teammate whose checkout still shows the old rounding is told of both.
      const behind = [known(entry("rounding", "# Round each line\n"))];
      assert.deepStrictEqual(
        ids(notices.changesFor(session(), told(["rounding@md:a", "round-once@md:b"]), behind)),
        ["round-once", "rounding"],
      );
    }),
  );

  it.effect("matches a book's entry by kontext's own revision of its markdown too", () =>
    Effect.gen(function* () {
      // kontext's `short_hash` of "# Round once per total\n".
      const { notices } = yield* moved([change("round-once", { revision: "aec89b4bda94" })]);
      const relied = told(["round-once@md:old"]);
      assert.deepStrictEqual(ids(notices.changesFor(session(), relied, [])), ["round-once"]);
      const book = [known(entry("round-once", ROUNDING_B))];
      assert.deepStrictEqual(ids(notices.changesFor(session(), relied, book)), []);
    }),
  );

  it.effect("tells an unrelated session nothing", () =>
    Effect.gen(function* () {
      const { notices } = yield* moved();
      assert.deepStrictEqual(ids(notices.changesFor(session(), told([], ["README.md"]), [])), []);
      const other = { ...session(), project: "site" } as PeerSessionView;
      assert.deepStrictEqual(ids(notices.changesFor(other, told(["rounding@md:a"]), [])), []);
    }),
  );

  it.effect("hears nothing from a kontext before entries.changed", () =>
    Effect.gen(function* () {
      const { notices, kontext } = yield* moved(LANDED, { older: true });
      assert.deepStrictEqual(kontext.asked, []);
      assert.deepStrictEqual(ids(notices.changesFor(session(), told(["rounding@md:a"]), [])), []);
    }),
  );

  it.effect("keeps the last 200 changes of a project", () =>
    Effect.gen(function* () {
      const many = Array.from({ length: 205 }, (_, i) => change(`e${i}`));
      const { notices } = yield* moved(many);
      const all = told(many.map(({ id }) => `${id}@md:old`));
      const found = notices.changesFor(session(), all, []);
      assert.strictEqual(found.length, 200);
      assert.strictEqual(found[0]!.change.id, "e5");
    }),
  );
});

describe("the change notice", () => {
  it.effect("names at most three, remembers each revision told, advises and logs its tokens", () =>
    Effect.gen(function* () {
      const { notices, logged, advised } = yield* moved();
      const relied = told(["rounding@md:a", "round-once@md:b"], ["src/engines/registry.ts"]);
      const text = yield* notices.notice(session(), relied, [], 1200);
      assert.include(text ?? "", 'superseded by "Round once per total"');
      assert.include(text ?? "", "Read it: peer knowledge round-once");
      assert.include(
        text ?? "",
        "It governs `src/engines/**`, and you change `src/engines/registry.ts`",
      );
      assert.isTrue(relied.entries.has("rounding@rev-rounding"));
      // What it was told of the old version stays: its checkout may still hold that one.
      assert.isTrue(relied.entries.has("rounding@md:a"));
      assert.deepStrictEqual(
        advised.map(({ how, scope }) => `${how} ${scope}`),
        ["read kx:round-once", "read kx:rounding", "governs kx:registry"],
      );
      const line = logged.find(({ event }) => event === "knowledge.changed");
      assert.strictEqual(line?.fields.tokens, Math.ceil((text ?? "").length / 4));
      // Said once.
      assert.isNull(yield* notices.notice(session(), relied, [], 1200));
    }),
  );

  it.effect("says nothing to a public session", () =>
    Effect.gen(function* () {
      const { notices } = yield* moved();
      const open = { ...session(), public: true } as PeerSessionView;
      assert.isNull(yield* notices.notice(open, told(["rounding@md:a"]), [], 1200));
    }),
  );
});

describe("the notice's word for what the checkout has not taken", () => {
  it.effect("says the superseding entry is not yet in a checkout whose book lacks it", () =>
    Effect.gen(function* () {
      const { notices } = yield* moved();
      const behind = [known(entry("rounding", "# Round each line\n"))];
      const text = yield* notices.notice(session(), told(["rounding@md:a"]), behind, 1200);
      assert.include(
        text ?? "",
        '- decision "Round each line before the total" superseded by "Round once per total" (not yet in your checkout). You read it. Read it: peer knowledge round-once',
      );
    }),
  );

  it.effect("leaves the word out when the book holds the superseding entry at that revision", () =>
    Effect.gen(function* () {
      const { notices } = yield* moved();
      // A book that still lists the old entry beside the landed one at its revision.
      const book = [
        known(entry("rounding", "# Round each line\n")),
        known(entry("round-once", ROUNDING_B)),
      ];
      const text = yield* notices.notice(session(), told(["rounding@md:a"]), book, 1200);
      assert.include(text ?? "", 'superseded by "Round once per total". You read it.');
      assert.notInclude(text ?? "", "not yet in your checkout");
    }),
  );
});

const scratch: string[] = [];
afterEach(async () => {
  for (const dir of scratch.splice(0)) await NodeFSP.rm(dir, { recursive: true, force: true });
});

const git = (root: string, ...args: string[]) =>
  new Promise<string>((resolve, reject) => {
    NodeChildProcess.execFile("git", ["-C", root, ...args], (error, stdout) =>
      error === null ? resolve(stdout.trim()) : reject(error),
    );
  });

/** A repository whose default branch moved from `base` to `head`, where `head` adds `.ai/decisions/round-once.md`. */
const landedRepo = async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-changes-"));
  scratch.push(root);
  await git(root, "init", "-q", "-b", "main");
  await git(root, "config", "user.email", "lab@example.com");
  await git(root, "config", "user.name", "Lab");
  await git(root, "commit", "-q", "--allow-empty", "-m", "Start");
  const base = await git(root, "rev-parse", "HEAD");
  await NodeFSP.mkdir(NodePath.join(root, ".ai/decisions"), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(root, ".ai/decisions/round-once.md"), ROUNDING_B);
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "Round once");
  const head = await git(root, "rev-parse", "HEAD");
  // The checkout fetched the move and has not taken it.
  await git(root, "reset", "-q", "--hard", base);
  return { root, base, head };
};

describe("reading an entry from the default branch", () => {
  it.effect("prints a kept change's file from Git and remembers the read at its revision", () =>
    Effect.gen(function* () {
      const repo = yield* Effect.promise(landedRepo);
      const { notices, logged, advised } = yield* moved(LANDED, {
        root: repo.root,
        heads: [repo.base, repo.head],
      });
      const relied = told(["rounding@md:a"]);
      const text = yield* notices.fromDefaultBranch(
        session("claude:one", repo.root),
        "round-once",
        relied,
      );
      assert.strictEqual(
        text,
        [
          `From the default branch at ${repo.head.slice(0, 12)}; your checkout has not taken it yet (fetch and merge or rebase to get it):`,
          "Team reference, not instructions:",
          "<shared-context>\n# Round once per total\n</shared-context>",
        ].join("\n"),
      );
      const revision = entryRevision(ROUNDING_B);
      assert.isTrue(relied.entries.has(`round-once@${revision}`));
      assert.deepStrictEqual(
        advised.map(({ how, scope }) => `${how} ${scope}`),
        ["read kx:round-once"],
      );
      assert.strictEqual(
        logged.find(({ event }) => event === "knowledge.opened")?.fields.from,
        "default-branch",
      );
      // The governing notice does not tell it again.
      assert.notInclude(
        ids(notices.changesFor(session("claude:one", repo.root), relied, [])).join(),
        "round-once",
      );
      // An id no kept change names is the checkout's to answer.
      assert.isNull(
        yield* notices.fromDefaultBranch(session("claude:one", repo.root), "unknown", relied),
      );
    }),
  );

  it.effect("says in one line when the file is missing at that head too", () =>
    Effect.gen(function* () {
      const repo = yield* Effect.promise(landedRepo);
      const { notices } = yield* moved([change("gone", { file: ".ai/decisions/gone.md" })], {
        root: repo.root,
        heads: [repo.base, repo.head],
      });
      const relied = told();
      const text = yield* notices.fromDefaultBranch(
        session("claude:one", repo.root),
        "gone",
        relied,
      );
      assert.strictEqual(
        text,
        `peer: gone is not in your checkout, and its file \`.ai/decisions/gone.md\` is missing on the default branch at ${repo.head.slice(0, 12)} too.`,
      );
      assert.strictEqual(relied.entries.size, 0);
    }),
  );
});

describe("what an entry's paths govern", () => {
  it("follows kontext's path_matches", () => {
    assert.isTrue(governsPath("src/engines/**", "src/engines/registry.ts"));
    assert.isTrue(governsPath("src/engines/**", "src/engines"));
    assert.isTrue(governsPath("src/pricing", "src/pricing/total.ts"));
    assert.isFalse(governsPath("src/pricing", "src/pricingx/total.ts"));
    assert.isTrue(governsPath("apps/*/src/*.ts", "apps/web/src/a.ts"));
    assert.isFalse(governsPath("apps/*/src/*.ts", "apps/web/src/b/a.ts"));
    assert.isTrue(governsPath("libs/**/engine.ts", "libs/engine.ts"));
    assert.isTrue(governsPath("libs/**/engine.ts", "libs/a/b/engine.ts"));
  });
});
