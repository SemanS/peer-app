/**
 * A run across a workspace's projects edits in checkouts of other projects. There its edits go
 * through a companion session of the other project, on that project's task: its own place, claims,
 * overlaps, run and handoff, so nothing in coordination needs a second path. Hooks reach it from
 * the session that edits; `peer` reaches it when run from that folder.
 *
 * @module peerHub/core/broker/companions
 */
import type { CoordinationBroker } from "./Broker.ts";
import type { LocalSession } from "./sessions.ts";

const nativeId = (session: Pick<LocalSession, "id" | "agent">) =>
  session.id.slice(session.agent.length + 1);

/** The session of the other project holding `path`, made on first need; null when none does. */
export async function companionAt(
  this: CoordinationBroker,
  session: LocalSession,
  path: string,
): Promise<LocalSession | null> {
  if (session.run === undefined) return null;
  const root = await this.host.runRootAt?.(session.run, path);
  if (root === undefined) return null;
  const made = await this.createSession(
    session.agent,
    {
      session_id: `${nativeId(session)}@${root.project}`,
      cwd: root.root,
      ...(session.transcript === undefined ? {} : { transcript_path: session.transcript }),
    },
    session.pane,
    "hooks",
    undefined,
    false,
    undefined,
    root.task,
  );
  if (made === null) return null;
  made.credential = session.credential;
  (session.companions ??= new Set()).add(made.id);
  return made;
}

/** What a hook's body says of a companion: its session, in its folder. */
export const companionBody = (body: Record<string, unknown>, companion: LocalSession) => ({
  ...body,
  session_id: nativeId(companion),
  cwd: companion.root,
});
