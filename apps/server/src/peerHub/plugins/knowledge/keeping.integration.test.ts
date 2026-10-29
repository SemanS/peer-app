// @effect-diagnostics nodeBuiltinImport:off - keeps findings through the standalone engine in a scratch repository.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "@effect/vitest";
import type { PeerKnowledgeCandidate } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { engineStatus, kontextApi, KontextApiError, runKontext } from "../../kontext.ts";
import { challengeCache } from "./client/challenges.ts";
import { challengeFlows } from "./client/challengeFlows.ts";
import { DIRTY_ENTRY, STALE_ENTRY, keepingFlows } from "./client/keeping.ts";
import { changedEntries, extendsIn, kontextIn } from "./client/kontext.ts";

const client = { run: runKontext };
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((dir) => NodeFSP.rm(dir, { recursive: true, force: true })),
  );
});
const git = (root: string, ...args: string[]) =>
  new Promise<string>((resolve, reject) => {
    NodeChildProcess.execFile(
      "git",
      ["-C", root, ...args],
      {
        env: {
          ...process.env,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_AUTHOR_NAME: "Integration test",
          GIT_AUTHOR_EMAIL: "test@example.invalid",
          GIT_COMMITTER_NAME: "Integration test",
          GIT_COMMITTER_EMAIL: "test@example.invalid",
          KONTEXT_SKIP: "1",
        },
      },
      (error, output) => (error === null ? resolve(output.trimEnd()) : reject(error)),
    );
  });

/** A repository whose knowledge has a committed learning and a committed decision. */
const repository = async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-keeping-"));
  directories.push(root);
  await git(root, "init", "-q", "-b", "main");
  await NodeFSP.mkdir(NodePath.join(root, ".ai"), { recursive: true });
  await NodeFSP.mkdir(NodePath.join(root, "src/relay"), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(root, "src/relay/server.ts"), "export {};\n");
  await NodeFSP.writeFile(NodePath.join(root, ".ai/kontext.toml"), "[init]\nllm='none'\n");
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "Configured");
  const ids: string[] = [];
  for (const entry of [
    {
      kind: "learning",
      title: "Relay tests fake the speech server",
      body: "Relay tests start a fake speech server on a random port.",
      paths: ["src/relay/**"],
    },
    {
      kind: "decision",
      title: "The relay runs as one worker",
      body: "The relay is a single worker process; no pool.",
      paths: ["src/relay/**"],
      status: "accepted",
    },
  ]) {
    const staged = await kontextApi<{ entry: { id: string } }>(client, root, "drafts.stage", {
      operation_id: `seed:${entry.title}`,
      entry,
    });
    ids.push(staged.entry.id);
  }
  await git(root, "commit", "-qm", "A learning and a decision");
  return { root, ids: ids as [string, string], base: await git(root, "rev-parse", "HEAD") };
};

const candidateOf = (id: string, text: string): PeerKnowledgeCandidate => ({
  id,
  project: "app",
  text,
  kind: "learning",
  sources: [
    {
      finding: `f-${id}`,
      email: "ana@acme.test",
      session: "claude:ana",
      task: "krk-1",
      text,
      tagged: true,
      independent: true,
      at: "2026-10-29T10:00:00Z",
    },
  ],
  finders: 2,
  status: "proposed",
  firstAt: "2026-10-29T10:00:00Z",
  lastAt: "2026-10-29T10:00:00Z",
});

describe.skipIf(!process.env.KONTEXT_BIN)("keeping findings with the real kontext engine", () => {
  it.effect("adds into a learning, links a new entry, replaces one and reads what changed", () =>
    Effect.gen(function* () {
      const { root, ids, base } = yield* Effect.promise(repository);
      const status = yield* Effect.promise(() => engineStatus(client, root));
      // A kontext before 0.9.0 cannot add to an entry: the app keeps a new entry there.
      if (!extendsIn(status.capabilities) || !status.capabilities.includes("entries.changed"))
        return;
      const [learning, decision] = ids;
      const place = { workspace: "acme", project: "app" };
      const candidates = [
        candidateOf("c1", "Relay tests also fake the chat server behind the node"),
        candidateOf("c2", "The relay worker drains its queue before it stops"),
        candidateOf("c3", "Relay tests run against a recorded speech server"),
      ];
      const decided: Array<{ readonly id: string; readonly status: string }> = [];
      const store = {
        checkout: root,
        store: true,
        llm: false,
        guidance: null,
        extends: true,
        kontext: kontextIn(client, root),
      };
      const flows = keepingFlows({
        state: { pluginData: () => ({}) },
        client: {
          session: Effect.succeed({ hubUrl: "https://hub", session: "s" }),
          api: { readContext: () => Effect.succeed(null) },
        },
        agents: { hubChanged: Effect.void },
        work: { taskName: () => Effect.succeed("Relay") },
        status: { publish: Effect.void },
        hub: {
          candidates: () => Effect.succeed(candidates),
          decide: (_w: string, _p: string, id: string, status: string) =>
            Effect.sync(() => void decided.push({ id, status })),
        },
        statusOf: () => Effect.die("unused"),
        checkoutOf: () => Effect.die("unused"),
        storeOf: () => Effect.succeed(store),
      } as unknown as Parameters<typeof keepingFlows>[0]);

      // What a card compares with: kontext's candidates carry the revision adding re-checks.
      const related = yield* challengeFlows({
        hub: {
          list: () => Effect.succeed([]),
          open: () => Effect.die("unused"),
          decide: () => Effect.die("unused"),
        },
        cache: challengeCache(() => Effect.succeed([])),
        kontext: client,
        served: Effect.succeed(true),
        storeOf: () => Effect.succeed({ checkout: root, llm: false }),
        book: () => Effect.succeed([]),
        candidates: () => Effect.succeed(candidates),
        changed: Effect.void,
        log: () => Effect.void,
      }).related({ ...place, id: "c1" });
      const compared = related.relations.find((relation) => relation.entry === learning);
      expect(compared).toMatchObject({ kind: "learning" });
      const revision = compared !== undefined && "revision" in compared ? compared.revision : "";
      // kontext 0.10.0 gives the entry's blob id; 0.9 gave a 12-hex digest of its text.
      expect(revision).toMatch(/^(?:[0-9a-f]{12}|[0-9a-f]{40})$/);
      const into = { entry: learning, revision: revision ?? "" };

      // Add to the learning: the preview is the amended body, and Apply stages that body alone.
      const shown = yield* flows.preview({ ...place, id: "c1", operation: "add", entry: into });
      expect(shown.entry.id).toBe(learning);
      const before = yield* Effect.promise(() =>
        NodeFSP.readFile(NodePath.join(root, shown.entry.path!), "utf8"),
      );
      expect(shown.oldBody).toContain("random port");
      expect(shown.body).toContain("chat server behind the node");
      expect(shown.asWritten).not.toBeNull();
      const added = yield* flows.keep({ ...place, id: "c1", into });
      expect(added.way).toBe("amended");
      expect(added.keptAs.kind).toBe("learning");
      const file = NodePath.join(root, added.keptAs.path);
      const after = yield* Effect.promise(() => NodeFSP.readFile(file, "utf8"));
      expect(after).toContain("chat server behind the node");
      // Everything before the body stays byte for byte: the review diff is the body.
      const [frontMatter] = before.split(/\n(?=# )/);
      expect(after.startsWith(frontMatter!)).toBe(true);
      expect(added.keptAs.path).toBe(shown.entry.path);
      expect(yield* Effect.promise(() => git(root, "diff", "--cached", "--name-only"))).toBe(
        added.keptAs.path,
      );

      yield* Effect.promise(() => git(root, "commit", "-qm", "Add to the learning"));
      const amended = yield* Effect.promise(() => git(root, "rev-parse", "HEAD"));

      // An edit of the entry's file in the checkout is the person's own: adding says so.
      yield* Effect.promise(() => NodeFSP.appendFile(file, "\nA local note.\n"));
      const dirty = yield* flows
        .preview({
          ...place,
          id: "c3",
          operation: "add",
          entry: { entry: learning, revision: amended },
        })
        .pipe(Effect.flip);
      expect(dirty).toMatchObject({ code: "operation_conflict", detail: DIRTY_ENTRY });
      yield* Effect.promise(() => git(root, "checkout", "--", added.keptAs.path));

      // The revision it was compared at is gone: compare again.
      const stale = yield* flows
        .preview({ ...place, id: "c3", operation: "add", entry: into })
        .pipe(Effect.flip);
      expect(stale).toMatchObject({ code: "stale_entry", detail: STALE_ENTRY });
      // A decision is never amended.
      const refused = yield* flows
        .preview({
          ...place,
          id: "c2",
          operation: "add",
          entry: { entry: decision, revision: amended },
        })
        .pipe(Effect.flip);
      expect(refused.code).toBe("decision_not_amended");

      // A new entry that builds on the decision links to it and leaves it standing.
      const linkedPreview = yield* flows.preview({
        ...place,
        id: "c2",
        operation: "new",
        extends: [decision],
      });
      expect(linkedPreview.links).toEqual([
        { entry: decision, title: "The relay runs as one worker" },
      ]);
      const linked = yield* flows.keep({ ...place, id: "c2", extends: [decision] });
      expect(linked.way).toBe("new");
      const newEntry = yield* Effect.promise(() =>
        kontextApi<{ entry: { id: string; extends?: string[] } }>(client, root, "entries.get", {
          id: linked.keptAs.path,
        }),
      );
      expect(newEntry.entry.extends).toEqual([decision]);
      const standing = yield* Effect.promise(() =>
        kontextApi<{ entry: { status?: string } }>(client, root, "entries.get", { id: decision }),
      );
      expect(standing.entry.status).toBe("accepted");

      // Replacing the learning supersedes it.
      const replaced = yield* flows.keep({ ...place, id: "c3", supersedes: [learning] });
      expect(replaced.way).toBe("superseding");
      const superseded = yield* Effect.promise(() =>
        kontextApi<{ entry: { status?: string } }>(client, root, "entries.get", { id: learning }),
      );
      expect(superseded.entry.status).toBe("superseded");
      yield* Effect.promise(() => git(root, "commit", "-qm", "Link and replace"));
      const head = yield* Effect.promise(() => git(root, "rev-parse", "HEAD"));
      expect(decided.map((one) => one.id)).toEqual(["c1", "c2", "c3"]);

      // What changed on the default branch, as the notice reads it.
      const revised = yield* Effect.promise(() => changedEntries(client, root, base, amended));
      expect(revised).toEqual([
        expect.objectContaining({ id: learning, change: "revised", kind: "learning" }),
      ]);
      const moved = yield* Effect.promise(() => changedEntries(client, root, amended, head));
      const byId = new Map((moved ?? []).map((change) => [change.id, change]));
      expect(byId.get(learning)).toMatchObject({ change: "superseded", removed: false });
      expect(byId.get(learning)?.supersededBy).toHaveLength(1);
      expect(byId.get(newEntry.entry.id)).toMatchObject({ change: "added" });
      expect(byId.get(learning)?.revision).toMatch(/^(?:[0-9a-f]{12}|[0-9a-f]{40})$/);

      // A replacement drafted against a moved revision is refused in words Peer reads as stale.
      yield* Effect.promise(() =>
        kontextApi(client, root, "drafts.revise", {
          entry_id: learning,
          entry_revision: base,
          objections: ["Relay tests record the speech server now"],
        }).then(
          () => expect.unreachable("revised a moved entry"),
          (error: unknown) => {
            expect(error).toBeInstanceOf(KontextApiError);
            // kontext 0.10.0 says stale_entry everywhere, with operation_conflict among the aliases.
            expect((error as KontextApiError).is("operation_conflict")).toBe(true);
            expect((error as KontextApiError).message).toMatch(
              /changed since revision|moved|stale/,
            );
          },
        ),
      );
    }),
  );
});
