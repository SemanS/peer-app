// @effect-diagnostics nodeBuiltinImport:off globalDateInEffect:off - drives a challenge's actions through the standalone engine in a scratch repository; a confirmation is checked on the wall-clock day.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "@effect/vitest";
import type { PeerKnowledgeCandidate, PeerKnowledgeChallenge } from "@t3tools/contracts";

import { engineStatus, kontextApi, runKontext } from "../../kontext.ts";
import * as Effect from "effect/Effect";

import { challengeFlows } from "./client/challengeFlows.ts";
import { challengeCache, challengeUpdates, type ChallengesHub } from "./client/challenges.ts";
import { confirmEntry, localGit } from "./client/drift.ts";
import { kontextIn } from "./client/kontext.ts";
import { challengeActions, codeIn, evidenceOf } from "./client/resolve.ts";

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

/** A repository whose knowledge has two committed decisions. */
const repository = async () => {
  const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "peer-challenge-"));
  directories.push(root);
  await git(root, "init", "-q", "-b", "main");
  await NodeFSP.mkdir(NodePath.join(root, ".ai"), { recursive: true });
  await NodeFSP.mkdir(NodePath.join(root, "src/pricing"), { recursive: true });
  await NodeFSP.writeFile(NodePath.join(root, "src/pricing/total.ts"), "export {};\n");
  await NodeFSP.writeFile(NodePath.join(root, ".ai/kontext.toml"), "[init]\nllm='none'\n");
  await git(root, "add", ".");
  await git(root, "commit", "-qm", "Configured");
  const ids: string[] = [];
  for (const [title, body] of [
    ["Totals round each line", "Round every line before the total."],
    ["Exports run on cron", "The nightly export is a cron job."],
  ] as const) {
    const staged = await kontextApi<{ entry: { id: string } }>(client, root, "drafts.stage", {
      operation_id: `seed:${title}`,
      entry: { kind: "decision", title, body, paths: ["src/pricing/**"], status: "accepted" },
    });
    ids.push(staged.entry.id);
  }
  await git(root, "commit", "-qm", "Two decisions");
  return { root, ids };
};

const challengeOf = (entry: string, revision?: string): PeerKnowledgeChallenge => ({
  id: `ch-${entry}`,
  project: "app",
  entry,
  reason: "no longer holds",
  sources: [
    {
      finding: "f1",
      email: "vir@acme.test",
      session: "claude:vir",
      task: "krk-9",
      text: "Totals round once now, since krk-9",
      tagged: false,
      independent: true,
      at: "2026-10-18T10:00:00Z",
    },
  ],
  finders: 1,
  people: [],
  status: "open",
  ...(revision === undefined ? {} : { entryRevision: revision }),
  firstAt: "2026-10-18T10:00:00Z",
  lastAt: "2026-10-18T10:00:00Z",
});

describe.skipIf(!process.env.KONTEXT_BIN)("challenges with the real kontext engine", () => {
  it.effect("retires and replaces entries once each, and resolves only what a commit shows", () =>
    Effect.gen(function* () {
      const { root, ids } = yield* Effect.promise(repository);
      const status = yield* Effect.promise(() => engineStatus(client, root));
      // The pinned kontext before 0.3.0 has none of these: the app hides the actions there.
      if (
        !["drafts.retire", "drafts.revise", "entries.related"].every((op) =>
          status.capabilities.includes(op),
        )
      )
        return;
      const actions = challengeActions(client, root);
      const [rounding, cron] = ids as [string, string];

      // What a person is offered here: Retire, and relations; a replacement waits for a model.
      const candidate: PeerKnowledgeCandidate = {
        id: "c1",
        project: "app",
        text: "Exports run on cron every night",
        sources: [],
        finders: 1,
        status: "proposed",
        firstAt: "2026-10-18T10:00:00Z",
        lastAt: "2026-10-18T10:00:00Z",
      };
      const flows = challengeFlows({
        hub: {
          list: () => Effect.succeed([challengeOf(cron)]),
          open: () => Effect.succeed(challengeOf(cron)),
          decide: () => Effect.succeed(challengeOf(cron)),
        },
        cache: challengeCache(() => Effect.succeed([])),
        kontext: client,
        served: Effect.succeed(true),
        storeOf: () => Effect.succeed({ checkout: root, llm: false }),
        book: () => Effect.succeed([]),
        candidates: () => Effect.succeed([candidate]),
        changed: Effect.void,
        log: () => Effect.void,
      });
      const offered = yield* flows.list({ workspace: "acme", project: "app" });
      const saved = yield* flows.entry({ workspace: "acme", project: "app", entry: cron });
      expect(saved?.title).toBe("Exports run on cron");
      expect(saved?.body).toBeTruthy();
      expect(saved?.file).toContain(".ai/");
      expect(saved?.revision).toMatch(/^md:/);
      expect(offered.retire).toEqual({ available: true, reason: null });
      expect(offered.replace.reason).toContain("llm adapter");
      expect(offered.rows[0]?.current?.title).toBe("Exports run on cron");
      const related = yield* flows.related({ workspace: "acme", project: "app", id: "c1" });
      expect(related.unavailable).toBeNull();
      expect(related.relations.map((relation) => relation.entry)).toContain(cron);

      // Retire: staged deprecated, a retry replays, and only the commit resolves the challenge.
      const before = yield* Effect.promise(() => actions.current(cron));
      expect(before?.entry.revision).toMatch(/^md:/);
      const retired = challengeOf(cron, before?.entry.revision);
      const first = yield* Effect.promise(() =>
        actions.retire({ challenge: retired, seenRevision: undefined }),
      );
      const again = yield* Effect.promise(() =>
        actions.retire({ challenge: retired, seenRevision: undefined }),
      );
      expect(again).toEqual(first);
      const staged = yield* Effect.promise(() => actions.current(cron));
      expect(staged?.entry.status).toBe("deprecated");
      expect(
        challengeUpdates([{ ...retired, status: "resolving" }], () => ({
          file: staged!.entry.file,
          title: staged!.entry.title,
          kind: staged!.entry.kind,
          status: staged!.entry.status,
          state: staged!.state,
          revision: staged!.entry.revision,
        })),
      ).toEqual([]);
      yield* Effect.promise(() => git(root, "commit", "-qm", "Retire the cron decision"));
      const committed = yield* Effect.promise(() => actions.current(cron));
      expect(committed?.state).toBe("committed");
      expect(
        challengeUpdates([{ ...retired, status: "resolving" }], () => ({
          file: committed!.entry.file,
          title: committed!.entry.title,
          kind: committed!.entry.kind,
          status: committed!.entry.status,
          state: committed!.state,
          revision: committed!.entry.revision,
        }))[0]?.bodies,
      ).toEqual([{ status: "resolved" }]);

      // Replace: the old entry is superseded in the working tree; the same draft again replays.
      const now = yield* Effect.promise(() => actions.current(rounding));
      const replaced = challengeOf(rounding, now?.entry.revision);
      const draft = {
        kind: "decision",
        title: "Totals round once",
        body: "Round the total once, not each line.",
        paths: ["src/pricing/**"],
        status: "proposed",
      };
      const input = { challenge: replaced, draft, seenRevision: undefined, source: "peer://test" };
      const kept = yield* Effect.promise(() => actions.replace(input));
      expect(yield* Effect.promise(() => actions.replace(input))).toEqual(kept);
      expect((yield* Effect.promise(() => actions.current(rounding)))?.entry.status).toBe(
        "superseded",
      );

      // Without a model kontext cannot draft, and says so.
      yield* Effect.promise(() =>
        actions.draft(challengeOf(cron), undefined).then(
          () => expect.unreachable("drafted without a model"),
          (error: { code?: string }) =>
            expect(["model_unavailable", "operation_conflict", "invalid_input"]).toContain(
              error.code,
            ),
        ),
      );

      // A kept candidate's evidence is accepted as Peer sends it.
      const code = yield* Effect.promise(() =>
        codeIn(root, ["Totals round in src/pricing/total.ts"]),
      );
      const evidence = evidenceOf({
        sources: [{ text: "Totals round in src/pricing/total.ts", task: "krk-1" }],
        finders: 2,
        ...(code === undefined ? {} : { code }),
      });
      expect(evidence?.external_refs).toContain("task:krk-1");
      expect(evidence?.external_refs.some((ref) => ref.startsWith("code:"))).toBe(true);
      const keep = yield* Effect.promise(() =>
        kontextIn(client, root).keep({
          project: "app",
          operationId: "keep-1",
          source: "peer://test/keep",
          candidate: {
            text: "Discounts apply before tax",
            finders: 2,
            sources: [{ text: "Discounts apply before tax", task: "krk-1", tagged: true }],
            kind: "learning",
          },
          where: (task) => task ?? "outside tasks",
          word: undefined,
          evidence,
        }),
      );
      const keptEntry = yield* Effect.promise(() =>
        kontextApi<{ entry: { extra?: Record<string, unknown> } }>(client, root, "entries.get", {
          id: keep.keptAs.path,
        }),
      );
      expect(keptEntry.entry.extra?.external_refs).toEqual(evidence?.external_refs);
    }),
  );

  it.effect(
    "files drift after the default branch moved, across a restart, and resolves a committed confirmation",
    () =>
      Effect.gen(function* () {
        const { root, ids } = yield* Effect.promise(repository);
        const status = yield* Effect.promise(() => engineStatus(client, root));
        if (!["entries.drift", "drafts.confirm"].every((op) => status.capabilities.includes(op)))
          return;
        const [rounding] = ids as [string, string];
        const advance = (subject: string, text: string) =>
          Effect.promise(async () => {
            await NodeFSP.writeFile(NodePath.join(root, "src/pricing/total.ts"), text);
            await git(root, "commit", "-qam", subject);
            const head = await git(root, "rev-parse", "HEAD");
            // What a fetch of the merged work does to the remote default branch here.
            await git(root, "update-ref", "refs/remotes/origin/main", head);
            return head;
          });
        const opened: Array<Parameters<ChallengesHub["open"]>[2]> = [];
        /** A Peer started fresh on this repository: nothing in memory but the repository's ref. */
        const peer = () =>
          challengeFlows({
            hub: {
              list: () => Effect.succeed([]),
              open: (_workspace, _project, body) =>
                Effect.sync(() => {
                  opened.push(body);
                  return challengeOf(body.entry);
                }),
              decide: () => Effect.succeed(challengeOf(rounding)),
            },
            cache: challengeCache(() => Effect.succeed([])),
            kontext: client,
            served: Effect.succeed(true),
            servesDrift: Effect.succeed(true),
            git: localGit,
            storeOf: () => Effect.succeed({ checkout: root, llm: false }),
            book: () => Effect.succeed([]),
            candidates: () => Effect.succeed([]),
            changed: Effect.void,
            log: () => Effect.void,
          });

        // First sight: where drift starts from, kept in the repository.
        yield* Effect.promise(() => git(root, "update-ref", "refs/remotes/origin/main", "HEAD"));
        yield* peer().verify("acme", "app", root);
        expect(opened).toEqual([]);

        // Work lands while Peer is not running; the next Peer files it.
        const head = yield* advance("Round the total once", "export const once = 1;\n");
        const restarted = peer();
        yield* restarted.verify("acme", "app", root);
        expect(opened.map((body) => body.entry).toSorted()).toEqual([...ids].toSorted());
        expect(opened[0]).toMatchObject({
          origin: "drift",
          drift: { head, commits: [head], paths: ["src/pricing/total.ts"] },
        });
        expect(opened[0]?.reason).toBe(
          "Code it governs changed in 1 commit since it was last checked: src/pricing/total.ts",
        );
        yield* restarted.verify("acme", "app", root);
        yield* peer().verify("acme", "app", root);
        expect(opened).toHaveLength(2);

        // Still holds: staged, then resolved once a commit shows the entry checked.
        yield* Effect.promise(() => confirmEntry(client, root, rounding));
        const actions = challengeActions(client, root);
        const resolving = {
          ...challengeOf(rounding),
          status: "resolving" as const,
          resolvedAs: { path: ".ai/x.md", title: "x", kind: "confirmed" },
          firstAt: new Date().toISOString(),
        };
        const nowOf = (current: Awaited<ReturnType<typeof actions.current>>) => () => ({
          file: current!.entry.file,
          title: current!.entry.title,
          kind: current!.entry.kind,
          status: current!.entry.status,
          state: current!.state,
          revision: current!.entry.revision,
          checked: current!.entry.checked,
        });
        const staged = yield* Effect.promise(() => actions.current(rounding));
        // Only staged: no resolution yet (the revision update a new challenge gets is not one).
        expect(
          challengeUpdates([resolving], nowOf(staged)).flatMap((update) =>
            update.bodies.map((body) => body.status),
          ),
        ).not.toContain("resolved");
        yield* Effect.promise(() => git(root, "commit", "-qm", "Rounding still holds"));
        const committed = yield* Effect.promise(() => actions.current(rounding));
        expect(committed?.state).toBe("committed");
        expect(challengeUpdates([resolving], nowOf(committed))[0]?.bodies).toEqual([
          { status: "resolved" },
        ]);
        // Confirming changed the entry with the code: the next move does not list it again.
        const later = yield* advance("Round in cents", "export const cents = 1;\n");
        yield* peer().verify("acme", "app", root);
        expect(
          opened.filter((body) => body.drift?.head === later).map((body) => body.entry),
        ).not.toContain(rounding);
      }),
  );
});
