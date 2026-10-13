/**
 * What an agent session that runs the lab puts into its shell: its Peer session and credential, the
 * Claude Mod of the operator's own Peer, Claude Code's session markers and effort. The lab's
 * computers and agents inherit the environment, so with these left in, a lab agent would present the
 * operator's session to the lab's Peer, load the operator's Mod (which talks to the real Peer) and
 * run at the operator's effort. Auth settings such as `CLAUDE_CODE_OAUTH_TOKEN` stay.
 */
export const OPERATOR_SESSION_KEYS = [
  "PEER_SESSION",
  "PEER_SESSION_TOKEN",
  "PEER_MOD_SESSION",
  "PEER_MOD_SESSION_TOKEN",
  "CODEX_THREAD_ID",
  "CLAUDECODE",
  "CLAUDE_CODE_SESSION_ID",
  "CLAUDE_CODE_CHILD_SESSION",
  "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_EXECPATH",
  "CLAUDE_CODE_MESSAGING_SOCKET",
  "CLAUDE_CODE_MESSAGING_TOKEN",
  "CLAUDE_CODE_PLUGIN_DIRS",
  "CLAUDE_AGENT_SDK_VERSION",
  "CLAUDE_PID",
  "CLAUDE_EFFORT",
  "AI_AGENT",
] as const;

/** Removes the operator's agent session from `env` in place; returns the names it removed. */
export function dropOperatorSession(env: NodeJS.ProcessEnv): string[] {
  const removed = OPERATOR_SESSION_KEYS.filter((key) => env[key] !== undefined);
  for (const key of removed) delete env[key];
  return removed;
}

/** A directory that holds a Peer's own `peer` command: `<Peer home>/userdata/coord/bin`. */
const PEER_BIN_DIR = /[/\\]userdata[/\\]coord[/\\]bin[/\\]?$/;

/**
 * Takes the directories of other Peers' `peer` commands off PATH in place, the operator's real Peer
 * among them, and returns them: a lab agent that runs a bare `peer` must reach its own computer's
 * Peer, never the operator's (it answers for the operator's real workspaces).
 */
export function dropOperatorPeerPath(env: NodeJS.ProcessEnv): string[] {
  const entries = (env.PATH ?? "").split(":");
  const removed = entries.filter((entry) => PEER_BIN_DIR.test(entry));
  if (removed.length > 0) env.PATH = entries.filter((entry) => !PEER_BIN_DIR.test(entry)).join(":");
  return removed;
}
