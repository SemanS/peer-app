# Jujutsu

## Detection stops at the nearest marker

[`findVcsMarkerRoot`](../../apps/server/src/vcs/JjRepo.ts) walks up and stops at the first `.jj` or
`.git`, nearest wins. A `.jj` a few levels up must not hijack a nearer Git checkout.

## `git.abandon-unreachable-commits=false` on every command we run

A colocated repository imports Git refs during jj commands. The default unreachable-commit abandonment can rewrite local history after an external Git ref moves. [`JjProcess.ts`](../../apps/server/src/vcs/JjProcess.ts) passes `git.abandon-unreachable-commits=false` on T3 Code's jj commands so a later status read does not abandon that history. This does not change the user's jj configuration. One exception: the `jujutsu` plugin's follow fetch (`jj git fetch` of a teammate's bookmark at an agent's tool step) runs with jj's default `true`. There the teammate's replaced version is meant to go; with `false` it stays visible and the agent's change ends with two versions (seen on 0.46.0).

## Checkpoints are raw refs

A checkpoint captures the commit id of `@` and pins it under `refs/t3/` with `git update-ref --create-reflog`. It moves neither the working-copy change nor a bookmark. Bookmarks and tags would appear in ref pickers, `jj commit` would advance `@` every turn, and operation ids stop resolving after operation-log pruning. The ref format stays shared through [`checkpointRefForThreadTurn`](../../apps/server/src/checkpointing/Utils.ts).

What it doesn't give you is jj addressability. After an op log prune the object is still pinned in
Git but jj has forgotten it, so `jj restore --from <id>` fails with `Revision ... doesn't exist`.
Restore recovers by writing a temp `refs/heads/t3-restore-<uuid>`, running `jj git import`, retrying,
then deleting both. See [`JjCheckpoints.ts`](../../apps/server/src/vcs/JjCheckpoints.ts).

Capture snapshots `@` and pins its object. Checkpoint restore uses `jj restore`, not `git reset`, `git clean` or `git restore`, so the change id, description, bookmarks and other workspaces survive. The user can undo the restore with `jj undo`. Checkpoint code must not abandon changes or prune the user's operation log.

## Turn attribution is separate from restore

The upstream checkpoint pipeline can filter turn diffs to authored paths without narrowing the saved checkpoint. jj implements `listAuthoredPaths` in [`JjCheckpoints.ts`](../../apps/server/src/vcs/JjCheckpoints.ts): it combines working-copy edits at both ends with paths from relevant parent history, using the starting checkpoint's reflog timestamp rather than the jj commit timestamp as capture time. That keeps imported history from becoming the turn's own work.

Ambiguous ancestry, unchanged parents or older refs without capture-time metadata return `null` instead of guessing an authored-path set. Diff filtering is optional; restore always uses the full captured workspace.

## `@-` is the committed base, and root is never a revision

The jj equivalent of the checkpoint pipeline's fallback-to-HEAD is the parent tree, not `@` itself. Missing-ref restore uses the current working copy's merged parents. A historical checkpoint diff instead uses the captured endpoint's merged parents and captured tree, so later edits or parent changes in `@` cannot alter the result. None of these bases resolve through the shared Git `HEAD`. `jj restore` from `@`'s own id prints `Nothing changed.` and exits 0, which would report a revert that did nothing.

jj's synthetic root has an all-zeros id, not a usable Git object. [`JjVcsDriver.ts`](../../apps/server/src/vcs/JjVcsDriver.ts) drops root parents and returns `null` when `changeAt` resolves root. A first change therefore has `parentCommitIds: []`. Restore has no committed fallback there; diffs use Git's empty tree when they need an empty base. Default-bookmark, review-diff base and remote-tracking resolution must treat root as absent, never pass its zero id to Git.

## jj owns the working copy, Git owns the object store

In a colocated repo every jj commit, `@` included, is a real Git object in
`<mainWorkspaceRoot>/.git` pinned by `refs/jj/keep/<sha>`. So the split is fixed:

- Snapshot and restore are jj only. Git's `HEAD` is not the working-copy change `@`; `git restore` or `git clean` bypasses jj's working-copy state even in a colocated secondary workspace.
- Diff patches and numstat use Git plumbing against the resolved object store for changes with a single parent. For merge changes, checkpoint and review diffs use `jj diff --git` so the patch reflects jj’s merged-parent semantics.
- Hosting operations and per-thread merge-base config use the main workspace root and its `.git/config`. Local bookmarks are exported as Git branch refs in the colocated store. Explicit fetch, push and bookmark movement belong to jj, not Git checkout commands. Background status fetches use Git with noninteractive authentication and write only `refs/t3/remotes/<encoded-remote>/*`, a namespace jj does not import. Fetch disables Git's configured remote-tracking ref mappings as well. Ahead counts use jj's nonempty changes above the Git merge bases; behind counts read the fetched Git objects. A background remote update therefore cannot move a tracked local bookmark or detach the workspace from it.

Hence the scope limit: a jj repo with no reachable `.git` is detected as jj and reported unusable,
never quietly treated as Git. [`JjRepo.resolveJjRepoPaths`](../../apps/server/src/vcs/JjRepo.ts)
follows a secondary workspace's `.jj/repo` pointer back to the main root so every Git call still has
a `--git-dir`.

Private behind counts are bounded by time, output size and commit count. Timeouts and output limits retain jj's known remote-bookmark count. Reaching the commit cap reports a lower bound of 1000 rather than a potentially stale zero, so Pull remains available. Remote discovery failures still surface as errors.

## Unusable is not Git

Missing `jj`, older than 0.46.0 ([`JJ_MINIMUM_VERSION`](../../apps/server/src/vcs/JjAvailability.ts)), or not
colocated: detection still says jj. Falling back to Git would write a Git worktree into a jj repo.
Every op instead fails with a named reason that reaches clients as
`VcsStatusLocalResult.vcs.unsupportedReason` and disables the action menu with that text.

Checkpoints are the exception. `checkpointsUsable` answers `false` there so
[`CheckpointStore.supportsCheckpoints`](../../apps/server/src/checkpointing/CheckpointStore.ts) skips
capture silently, same as a directory with no repo, instead of writing a failed-capture activity into
every turn.

## Agent workspaces carry Peer's own jj settings

The `jujutsu` plugin writes per-workspace settings with `jj config set --workspace` in every agent
workspace it configures, never in the repository's default workspace, which belongs to the person:
`operation.username` (`<person>·<agent>`, so the operation log names the agent), `user.*` only where
jj has none, `snapshot.auto-update-stale`, and the revset aliases `peer_mine()`, `peer_others()` and
`immutable_heads()` that make other sessions' changes immutable there. Turning the plugin off removes
those keys. jj 0.46 keeps repository and workspace settings under the user's config dir
(`~/.config/jj/repos/<id>/`, `~/.config/jj/workspaces/<id>/`), not in `.jj/`, so a test that runs jj
in a temporary repository must give jj a `HOME` and `XDG_CONFIG_HOME` of its own, or every run leaves
a directory in the developer's config.

## The snapshot runs after every tool step, and the fetch only there

When a change is rewritten in one workspace, jj rebases its descendants in every other workspace. If
one of those workspaces has edits jj has not snapshotted yet, that change ends with two versions and
the older file is written back to disk (seen on 0.46.0; `jj converge` recovers it). So `postTool`
snapshots the agent's workspace, converges what ended divergent, and only then fetches what the
session follows: that fetch moves the session's own working-copy change, so it never runs in the
background, only while the agent waits for the hook. Plugins that read after it (`forecast`,
`changes`) pass `--ignore-working-copy` and never snapshot.

A step that fails is a tool step too, and protection makes one common: jj refuses `jj squash --into`
a teammate's change with an error. Claude Code reports such a step as `PostToolUseFailure`, never
`PostToolUse`, so both Claude adapters register it beside `PostToolUse`, and `postTool` gets
`failed` and the files git sees changed. Codex has no failure event: its `PostToolUse` follows a
command that exits non-zero, and no hook follows a patch it could not apply, so the next step's
snapshot takes what such a patch wrote.

When `jj converge --no-interactive` cannot choose an author (jj gives the late snapshot a new author time, so the versions' author times fall in different seconds), the plugin gives every version the oldest's author time, and the author of the oldest version that has one, with `jj metaedit`, and converges once more; only then does the change keep two versions. The follow fetch gets what the step has left minus 600 ms and is skipped below 1.2 s: a Claude Code hook has 3.3 s in all, so a fixed 3 s fetch never ran there. A skipped or timed-out fetch does not count for the 10-second rule. At the end of a turn (the plugin's Stop handler, while the agent still waits for the hook and edits nothing) the same snapshot, converge and follow fetch run once more whatever that rule says, so a turn never ends on a stale version; the moved notice waits for the next step, except a move that left a conflict in the session's own change, which is told as a waking notice (a `wakes: true` notice the Stop wait gives an idle agent) and marked told. An undo from the app runs `jj op revert` and the converge after it under the person's name, not the agent's or the computer user's.

## Knowledge trailers come from the landing step, not from a hook

kontext's `prepare-commit-msg` git hook writes `Decision: <id>` and the other kinds' trailers into
a commit that ships a knowledge file; `kontext log` and `git log --format='%(trailers:key=Decision)'`
read an entry's lineage from them. jj runs no git hook, so a `jj commit`, `jj describe` or
`jj squash` loses them unless the author adds them by hand (kontext's docs say so, and point at
`kontext prepare-commit`, which lists them). The knowledge plugin puts them back in two halves
([`client/trailers.ts`](../../apps/server/src/peerHub/plugins/knowledge/client/trailers.ts)):
before the command, kontext's `prepare-commit` report of the working copy names the trailers, so
kontext decides and Peer parses nothing of `.ai`; after it, when the change the command described
(`@-` after a commit or squash, `@` after a describe) touches the store, the trailers its description
lacks are appended with `jj describe`, once. A describe or squash that names another revision or picks
hunks is left alone, as is an undescribed change, a change jj refuses to rewrite (a teammate's,
immutable) and a step too short for the reads. The jj calls pass `--ignore-working-copy`, since the
jujutsu plugin owns the snapshot and a describe between its steps must not take one.

## `refs/peer/*` is Peer's, and jj never imports it

- `refs/peer/forecast/*`: teammates' branches the forecast fetched, and `refs/peer/forecast/wip/*`
  their shared work in progress.
- `refs/peer/wip/*` on origin: this computer's agents' work in progress, while the person shares it.
- `refs/peer/reviewed/<id>`: the commit a person marked reviewed, so it stays readable after the
  change is rewritten and the commit is hidden.

jj imports only `refs/heads`, `refs/remotes` and `refs/tags`, so none of these becomes a bookmark.
A forecast check that needs a teammate's commit jj has never seen gives it a short-lived tag
`refs/tags/peer-check/<commit>` for the length of one `jj git import`, and removes it afterwards.

## Workspace cleanup

An existing Git worktree (`.git` file, no `.jj`) keeps resolving as Git even when its project becomes colocated. Workspace removal dispatches from the target path first, with the project kind as a fallback when that path is missing or unclassifiable. Pruning routes by project kind. Idle jj workspaces are automatically cleaned up under the shared storage cleanup rules, with stronger safety blockers: working-copy changes, untracked files, conflicts, and commits not reachable from a bookmark or remote bookmark prevent cleanup. Removal uses `jj workspace remove` so jj owns both workspace and colocated Git registration cleanup. The final idle-state inspection runs under the workspace lease. Native removal does not reject a workspace that becomes dirty afterward, so external processes racing removal are not serialized. A late native snapshot can save ordinary files as an unbookmarked commit, but ignored or oversized files may still be deleted; the lease does not eliminate external-process races. Pruning also forgets missing T3-created jj workspaces and runs `git worktree prune` for old Git worktree registrations.
