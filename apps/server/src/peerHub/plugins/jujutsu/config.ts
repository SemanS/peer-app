/**
 * The jj configuration Peer writes into an agent's workspace (design D2, D4), as pure values. jj
 * keeps workspace configuration outside the repository, so nothing shows in `jj status`. Whole
 * aliases are always rendered: a write never edits part of one.
 *
 * @module peerHub/plugins/jujutsu/config
 */

/** The most change ids a workspace remembers as its own; the oldest are dropped. */
export const MINE_MAX = 200;

const MINE = 'revset-aliases."peer_mine()"';
const OTHERS = 'revset-aliases."peer_others()"';
const IMMUTABLE = 'revset-aliases."immutable_heads()"';

/** The keys that exist only while protection is on. */
export const PROTECTION_KEYS: ReadonlyArray<string> = [MINE, OTHERS, IMMUTABLE];
/**
 * Every key Peer writes whatever jj had before. `user.name` and `user.email` are not here: they are
 * Peer's only where jj had none, which the workspace's record says.
 */
export const OWN_KEYS: ReadonlyArray<string> = [
  "operation.username",
  "snapshot.auto-update-stale",
  ...PROTECTION_KEYS,
];

/** `bob`: how the operation log names a person's own steps. */
export const personName = (email: string) => email.split("@")[0] ?? email;

/** `bob·codex`: how the operation log names an agent's steps. */
export const operationName = (email: string, agent: string) => `${personName(email)}·${agent}`;

/**
 * `change_id(a) | change_id(b)`, or `none()`. `change_id()` of an unknown prefix is no error in jj, so
 * an id that went away never breaks an alias.
 */
export const union = (ids: ReadonlyArray<string>) =>
  ids.length === 0 ? "none()" : ids.map((id) => `change_id(${id})`).join(" | ");

/** Appends `id` to a workspace's own changes, newest last, without repeats and within the bound. */
export const remember = (mine: ReadonlyArray<string>, id: string) =>
  mine.includes(id) ? mine : [...mine, id].slice(-MINE_MAX);

/**
 * The aliases of one workspace: what it made, what the other agent workspaces made, and jj's
 * immutable heads with the others' added. A change that sits on the workspace's own work stays
 * rewritable (`~ peer_mine()::`): the rebase its amend causes would otherwise be refused.
 */
export function protectionKeys(
  mine: ReadonlyArray<string>,
  others: ReadonlyArray<string>,
): ReadonlyArray<readonly [string, string]> {
  return [
    [MINE, union(mine)],
    [OTHERS, union(others)],
    [IMMUTABLE, "builtin_immutable_heads() | (peer_others() ~ peer_mine()::)"],
  ];
}
