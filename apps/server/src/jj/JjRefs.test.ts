import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { currentRef } from "../peerHub/core/vcs.ts";
import * as JjVcsDriver from "../vcs/JjVcsDriver.ts";
import { describeJj, runJj, withJjRepo } from "../vcs/testing/JjTestSupport.ts";
import { makeJjRefs, type JjRefsOps } from "./JjRefs.ts";
import { makeJjRemotes } from "./JjRemotes.ts";
import { makeJjWorkspaces, workspaceNameForRef, type JjWorkspaceOps } from "./JjWorkspaces.ts";

interface RefsFixture {
  readonly driver: JjVcsDriver.JjVcsDriverShape;
  readonly fileSystem: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly refs: JjRefsOps;
  readonly workspaces: JjWorkspaceOps;
  readonly root: string;
}

const withRepo = <A, E>(
  input: { readonly withRemote?: boolean },
  use: (fixture: RefsFixture) => Effect.Effect<A, E, FileSystem.FileSystem | Path.Path>,
) =>
  withJjRepo({ prefix: "t3-jj-refs-", seed: true, ...input }, (repo) =>
    Effect.gen(function* () {
      const { base, driver, fileSystem, path, process, root } = repo;
      const remotes = makeJjRemotes({ driver, process });
      const refs = yield* makeJjRefs({ driver, process });
      const workspaces = makeJjWorkspaces({
        driver,
        process,
        fileSystem,
        path,
        worktreesDir: path.join(base, "worktrees"),
        bookmarkTo: remotes.bookmarkTo,
      });

      return yield* use({ driver, fileSystem, path, refs, workspaces, root });
    }),
  );

/** The bookmark `listRefs` marks current, which the status label names too. */
const currentRefName = (refs: JjRefsOps, cwd: string) =>
  refs
    .listRefs({ cwd, refresh: true })
    .pipe(Effect.map((listed) => listed.refs.find((ref) => ref.current)?.name));

describeJj("JjRefs.hasRefNamed", () => {
  it.effect("matches exact local and remote names without evaluating revisions", () =>
    withRepo({ withRemote: true }, ({ refs, root }) =>
      Effect.gen(function* () {
        assert.isTrue(yield* refs.hasRefNamed({ cwd: root, refName: "main" }));
        assert.isTrue(yield* refs.hasRefNamed({ cwd: root, refName: "origin/main" }));
        assert.isFalse(yield* refs.hasRefNamed({ cwd: root, refName: "mai" }));
        assert.isFalse(yield* refs.hasRefNamed({ cwd: root, refName: "main~1" }));
        assert.isFalse(yield* refs.hasRefNamed({ cwd: root, refName: "all()" }));
        assert.isFalse(yield* refs.hasRefNamed({ cwd: root, refName: "*" }));
      }),
    ),
  );
});

describeJj("JjRefs.resolveRefName", () => {
  it.effect("normalizes exact local and remote refs to host bookmark names", () =>
    withRepo({ withRemote: true }, ({ refs, root }) =>
      Effect.gen(function* () {
        assert.equal(yield* refs.resolveRefName(root, "main"), "main");
        assert.equal(yield* refs.resolveRefName(root, "origin/main"), "main");
        assert.equal(yield* refs.resolveRefName(root, "refs/heads/main"), "main");
        assert.equal(yield* refs.resolveRefName(root, "refs/remotes/origin/main"), "main");
        assert.isNull(yield* refs.resolveRefName(root, "main~1"));
        assert.isNull(yield* refs.resolveRefName(root, "all()"));
        assert.isNull(yield* refs.resolveRefName(root, "refs/heads/missing"));
        assert.isNull(yield* refs.resolveRefName(root, "refs/tags/main"));
      }),
    ),
  );
});

describeJj("JjRefs.listRefs", () => {
  it.effect("drops the colocated pseudo-remote and names remote rows like Git does", () =>
    withRepo({ withRemote: true }, ({ refs, root }) =>
      Effect.gen(function* () {
        const listed = yield* refs.listRefs({
          cwd: root,
          refresh: true,
          includeMatchingRemoteRefs: true,
        });

        assert.isFalse(listed.refs.some((ref) => ref.name.startsWith("git/")));
        const remoteRow = listed.refs.find((ref) => ref.isRemote === true);
        assert.equal(remoteRow?.name, "origin/main");
        assert.equal(remoteRow?.remoteName, "origin");
      }),
    ),
  );

  it.effect("reports the segment bookmark as current and the trunk bookmark as default", () =>
    withRepo({ withRemote: true }, ({ refs, root }) =>
      Effect.gen(function* () {
        yield* runJj(root, ["new", 'bookmarks(exact:"main")']);
        const listed = yield* refs.listRefs({ cwd: root, refresh: true });
        const main = listed.refs.find((ref) => ref.name === "main");

        assert.equal(main?.current, true);
        assert.equal(main?.isDefault, true);
      }),
    ),
  );

  it.effect("resolves a bookmark's workspace and never reports the main workspace root", () =>
    withRepo({}, ({ refs, root, workspaces }) =>
      Effect.gen(function* () {
        const created = yield* workspaces.createWorktree({
          cwd: root,
          refName: "main",
          newRefName: "feat/threaded",
          path: null,
        });
        const listed = yield* refs.listRefs({ cwd: root, refresh: true });

        assert.equal(
          listed.refs.find((ref) => ref.name === "feat/threaded")?.worktreePath,
          created.worktree.path,
        );
        assert.equal(listed.refs.find((ref) => ref.name === "main")?.worktreePath, null);
      }),
    ),
  );

  it.effect("filters, orders and pages the way the Git implementation does", () =>
    withRepo({}, ({ refs, root }) =>
      Effect.gen(function* () {
        yield* runJj(root, ["bookmark", "create", "feat/alpha", "-r", "@-"]);
        yield* runJj(root, ["bookmark", "create", "feat/beta", "-r", "@-"]);

        const filtered = yield* refs.listRefs({ cwd: root, query: "FEAT/", refresh: true });
        assert.deepStrictEqual(filtered.refs.map((ref) => ref.name).toSorted(), [
          "feat/alpha",
          "feat/beta",
        ]);

        const firstPage = yield* refs.listRefs({ cwd: root, limit: 1, refKind: "local" });
        assert.equal(firstPage.refs.length, 1);
        assert.equal(firstPage.totalCount, 3);
        assert.equal(firstPage.nextCursor, 1);
      }),
    ),
  );
});

describeJj("JjRefs.createRef", () => {
  it.effect("creates and renames punctuation-bearing bookmark names literally", () =>
    withRepo({}, ({ refs, root }) =>
      Effect.gen(function* () {
        yield* refs.createRef({ cwd: root, refName: "fix(ui)" });
        const renamed = yield* refs.renameBranch({
          cwd: root,
          oldBranch: "fix(ui)",
          newBranch: "fix(ui)+",
          exactName: true,
        });
        assert.equal(renamed.branch, "fix(ui)+");
        assert.include(yield* refs.listLocalBranchNames(root), "fix(ui)+");
      }),
    ),
  );

  it.effect("bookmarks `@` when it holds the work", () =>
    withRepo({}, ({ driver, fileSystem, path, refs, root }) =>
      Effect.gen(function* () {
        yield* fileSystem.writeFileString(path.join(root, "editing.txt"), "editing\n");

        yield* refs.createRef({ cwd: root, refName: "feat/editing" });

        const change = yield* driver.currentChange(root);
        assert.include(change.localBookmarks, "feat/editing");
      }),
    ),
  );

  it.effect("bookmarks `@-` when `@` is empty, so the agent's commits are captured", () =>
    withRepo({}, ({ driver, fileSystem, path, refs, root }) =>
      Effect.gen(function* () {
        yield* fileSystem.writeFileString(path.join(root, "agent.txt"), "agent\n");
        yield* runJj(root, ["commit", "-m", "agent work"]);

        yield* refs.createRef({ cwd: root, refName: "feat/captured" });

        const change = yield* driver.currentChange(root);
        assert.deepStrictEqual([...change.localBookmarks], []);
        const parent = yield* driver.changeAt(root, "@-");
        assert.include(parent?.localBookmarks ?? [], "feat/captured");
      }),
    ),
  );

  it.effect("keeps a new bookmark current when it shares `@-` with one that sorts first", () =>
    withRepo({}, ({ driver, refs, root }) =>
      Effect.gen(function* () {
        yield* runJj(root, ["new", 'bookmarks(exact:"main")']);

        yield* refs.createRef({ cwd: root, refName: "zz/fresh" });

        const parent = yield* driver.changeAt(root, "@-");
        assert.includeMembers([...(parent?.localBookmarks ?? [])], ["main", "zz/fresh"]);
        assert.equal(yield* currentRefName(refs, root), "zz/fresh");
      }),
    ),
  );

  it.effect("bookmarks `@` in a repository with no commits", () =>
    withJjRepo({ prefix: "t3-jj-refs-empty-" }, ({ driver, process, root }) =>
      Effect.gen(function* () {
        const refs = yield* makeJjRefs({ driver, process });

        yield* refs.createRef({ cwd: root, refName: "main" });

        const change = yield* driver.currentChange(root);
        assert.include(change.localBookmarks, "main");
      }),
    ),
  );
});

describeJj("JjRefs.switchRef", () => {
  it.effect("refuses to strand a commit the agent left on no bookmark", () =>
    withRepo({}, ({ fileSystem, path, refs, root }) =>
      Effect.gen(function* () {
        yield* runJj(root, ["new", 'bookmarks(exact:"main")']);
        yield* fileSystem.writeFileString(path.join(root, "agent.txt"), "agent\n");
        yield* runJj(root, ["commit", "-m", "agent work"]);

        const failure = yield* refs.switchRef({ cwd: root, refName: "main" }).pipe(Effect.flip);

        assert.include(failure.detail, "not on a bookmark yet");
        assert.include(failure.detail, "create a bookmark for it");
        assert.equal(failure.reason, "unbookmarked_work");
      }),
    ),
  );

  it.effect("carries unnamed working-copy changes onto the target when asked", () =>
    withRepo({}, ({ fileSystem, path, refs, root }) =>
      Effect.gen(function* () {
        yield* runJj(root, ["new", 'bookmarks(exact:"main")']);
        yield* fileSystem.writeFileString(path.join(root, "docs.txt"), "docs\n");
        yield* runJj(root, ["commit", "-m", "docs"]);
        yield* runJj(root, ["bookmark", "create", "docs/simplify", "-r", "@-"]);
        yield* fileSystem.writeFileString(path.join(root, "notes.txt"), "unsaved\n");

        const switched = yield* refs.switchRef({ cwd: root, refName: "main", carryWork: true });

        assert.equal(switched.refName, "main");
        const parent = yield* runJj(root, ["log", "-r", "@-", "--no-graph", "-T", "bookmarks"]);
        assert.include(parent, "main");
        assert.notInclude(parent, "docs/simplify");
        assert.equal(yield* fileSystem.readFileString(path.join(root, "notes.txt")), "unsaved\n");
        assert.isFalse(yield* fileSystem.exists(path.join(root, "docs.txt")));
      }),
    ),
  );

  it.effect("shows main after carrying work onto it from a branch merged into main", () =>
    withRepo({}, ({ fileSystem, path, refs, root }) =>
      Effect.gen(function* () {
        yield* runJj(root, ["new", 'bookmarks(exact:"main")']);
        yield* fileSystem.writeFileString(path.join(root, "docs.txt"), "docs\n");
        yield* runJj(root, ["commit", "-m", "docs"]);
        yield* runJj(root, ["bookmark", "create", "docs/archive", "-r", "@-"]);
        // A fast-forward merge leaves the branch's bookmark on main's commit.
        yield* runJj(root, ["bookmark", "set", "main", "-r", 'bookmarks(exact:"docs/archive")']);
        yield* fileSystem.writeFileString(path.join(root, "notes.txt"), "unsaved\n");
        assert.equal(yield* currentRefName(refs, root), "docs/archive");

        const refused = yield* refs.switchRef({ cwd: root, refName: "main" }).pipe(Effect.flip);
        assert.equal(refused.reason, "unbookmarked_work");
        yield* refs.switchRef({ cwd: root, refName: "main", carryWork: true });

        assert.equal(yield* currentRefName(refs, root), "main");
        assert.equal(yield* fileSystem.readFileString(path.join(root, "notes.txt")), "unsaved\n");
      }),
    ),
  );

  it.effect("follows each switch between bookmarks that share a commit", () =>
    withRepo({}, ({ refs, root }) =>
      Effect.gen(function* () {
        yield* runJj(root, ["bookmark", "create", "docs/archive", "-r", 'bookmarks(exact:"main")']);

        yield* refs.switchRef({ cwd: root, refName: "main" });
        assert.equal(yield* currentRefName(refs, root), "main");
        yield* refs.switchRef({ cwd: root, refName: "docs/archive" });
        assert.equal(yield* currentRefName(refs, root), "docs/archive");
        yield* refs.switchRef({ cwd: root, refName: "main" });
        assert.equal(yield* currentRefName(refs, root), "main");
      }),
    ),
  );

  it.effect("tracks a remote ref before switching and records the Git upstream", () =>
    withRepo({ withRemote: true }, ({ fileSystem, refs, root }) =>
      Effect.gen(function* () {
        yield* runJj(root, ["bookmark", "create", "feat/remote", "-r", "@-"]);
        yield* runJj(root, ["git", "push", "--bookmark", "feat/remote", "--remote", "origin"]);
        yield* runJj(root, ["bookmark", "forget", "feat/remote"]);
        yield* runJj(root, ["git", "fetch", "--remote", "origin"]);

        const switched = yield* refs.switchRef({ cwd: root, refName: "origin/feat/remote" });

        assert.equal(switched.refName, "feat/remote");
        const gitConfig = yield* fileSystem.readFileString(`${root}/.git/config`);
        assert.include(gitConfig, 'branch "feat/remote"');
        assert.include(gitConfig, "refs/heads/feat/remote");
      }),
    ),
  );
});

describeJj("JjRefs.renameBranch", () => {
  it.effect.each([true, false])(
    "preserves the selected bookmark when a tied bookmark is renamed (renamed bookmark selected=%s)",
    (selected) =>
      withRepo({}, ({ refs, root }) =>
        Effect.gen(function* () {
          yield* runJj(root, ["bookmark", "create", "z-old", "-r", "main"]);
          yield* refs.switchRef({ cwd: root, refName: selected ? "z-old" : "main" });
          yield* refs.renameBranch({
            cwd: root,
            oldBranch: "z-old",
            newBranch: "z-new",
            exactName: true,
          });
          const expected = selected ? "z-new" : "main";
          assert.equal(yield* currentRefName(refs, root), expected);
          assert.equal(yield* Effect.promise(() => currentRef(root)), expected);
        }),
      ),
  );

  it.effect(
    "renames another workspace's recorded choice without changing this workspace's choice",
    () =>
      withRepo({}, ({ refs, root, path }) =>
        Effect.gen(function* () {
          const scratch = path.resolve(root, "..", "scratch");
          yield* runJj(root, ["bookmark", "create", "z-old", "-r", "main"]);
          yield* runJj(root, [
            "workspace",
            "add",
            "--colocate",
            "--name",
            "scratch",
            "-r",
            "main",
            scratch,
          ]);
          yield* refs.switchRef({ cwd: scratch, refName: "z-old" });
          yield* refs.switchRef({ cwd: root, refName: "main" });
          yield* refs.renameBranch({
            cwd: root,
            oldBranch: "z-old",
            newBranch: "z-new",
            exactName: true,
          });
          assert.equal(yield* currentRefName(refs, root), "main");
          assert.equal(yield* currentRefName(refs, scratch), "z-new");
          assert.equal(yield* Effect.promise(() => currentRef(scratch)), "z-new");
        }),
      ),
  );

  it.effect("returns unchanged names without trying to rename the bookmark", () =>
    withRepo({}, ({ refs, root }) =>
      Effect.gen(function* () {
        assert.deepStrictEqual(
          yield* refs.renameBranch({ cwd: root, oldBranch: "main", newBranch: "main" }),
          { branch: "main" },
        );
      }),
    ),
  );

  it.effect("suffixes generated names instead of replacing existing bookmarks", () =>
    withRepo({}, ({ refs, root }) =>
      Effect.gen(function* () {
        yield* runJj(root, ["bookmark", "create", "feat/target", "feat/target-1", "-r", "@-"]);
        const renamed = yield* refs.renameBranch({
          cwd: root,
          oldBranch: "main",
          newBranch: "feat/target",
        });
        assert.equal(renamed.branch, "feat/target-2");
        assert.includeMembers(yield* refs.listLocalBranchNames(root), [
          "feat/target",
          "feat/target-1",
          "feat/target-2",
        ]);
      }),
    ),
  );

  it.effect("rejects collisions when the caller requires an exact name", () =>
    withRepo({}, ({ refs, root }) =>
      Effect.gen(function* () {
        yield* runJj(root, ["bookmark", "create", "feat/target", "-r", "@-"]);
        const failure = yield* refs
          .renameBranch({
            cwd: root,
            oldBranch: "main",
            newBranch: "feat/target",
            exactName: true,
          })
          .pipe(Effect.flip);
        assert.include(failure.detail, "Could not rename bookmark");
        assert.includeMembers(yield* refs.listLocalBranchNames(root), ["main", "feat/target"]);
      }),
    ),
  );

  it.effect("renames the bookmark and the workspace that carries it", () =>
    withRepo({}, ({ driver, refs, root, workspaces }) =>
      Effect.gen(function* () {
        const created = yield* workspaces.createWorktree({
          cwd: root,
          refName: "main",
          newRefName: "feat/old",
          path: null,
        });

        const renamed = yield* refs.renameBranch({
          cwd: created.worktree.path,
          oldBranch: "feat/old",
          newBranch: "feat/new",
        });

        assert.equal(renamed.branch, "feat/new");
        assert.include(yield* runJj(root, ["bookmark", "list"]), "feat/new");

        // The bookmark-to-workspace mapping `listRefs` reports is keyed on the new name.
        const workspaceNames = (yield* driver.listWorkspaces(root)).map(
          (workspace) => workspace.name,
        );
        assert.include(workspaceNames, workspaceNameForRef("feat/new"));
        assert.notInclude(workspaceNames, workspaceNameForRef("feat/old"));
      }),
    ),
  );

  it.effect("leaves every workspace alone when the rename runs from the project root", () =>
    withRepo({}, ({ driver, refs, root, workspaces }) =>
      Effect.gen(function* () {
        yield* workspaces.createWorktree({
          cwd: root,
          refName: "main",
          newRefName: "feat/elsewhere",
          path: null,
        });

        yield* refs.renameBranch({
          cwd: root,
          oldBranch: "feat/elsewhere",
          newBranch: "feat/renamed",
        });

        // `jj workspace rename` renames whichever workspace `cwd` belongs to, so running it here
        // would rename `default` and leave the thread's own workspace on the stale name.
        const workspaceNames = (yield* driver.listWorkspaces(root)).map(
          (workspace) => workspace.name,
        );
        assert.include(workspaceNames, "default");
        assert.include(workspaceNames, workspaceNameForRef("feat/elsewhere"));
        assert.notInclude(workspaceNames, workspaceNameForRef("feat/renamed"));
      }),
    ),
  );
});
