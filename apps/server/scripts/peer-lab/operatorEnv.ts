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
