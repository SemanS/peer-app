import { PEER_LOCAL_WORKSPACE } from "@t3tools/contracts";
import type { CheckoutPlace, PeerBrokerHost } from "../broker/host.ts";
import type { LocalAuthority } from "./LocalAuthority.ts";

/** A Hub-bound checkout always keeps its authority, including when the Hub cannot answer. */
export function withLocalCoordination(
  host: PeerBrokerHost,
  local: LocalAuthority,
  placeOf: (cwd: string) => Promise<CheckoutPlace | null>,
): PeerBrokerHost {
  const isLocal = (workspace: string) => workspace === PEER_LOCAL_WORKSPACE;
  const teamOnly = async (): Promise<never> => {
    throw new Error(
      "Shared team tasks need a Hub workspace. Local chats and coordination remain available.",
    );
  };
  return {
    ...host,
    placeOf: async (cwd) => (await host.placeOf(cwd)) ?? placeOf(cwd),
    nameOf: (workspace, email) =>
      isLocal(workspace) ? "Your person" : host.nameOf(workspace, email),
    workspaces: () => [...new Set([...host.workspaces(), PEER_LOCAL_WORKSPACE])],
    report: (w, sessions) => (isLocal(w) ? local.report(sessions) : host.report(w, sessions)),
    view: (w) => (isLocal(w) ? local.view() : host.view(w)),
    intent: (w, project, request, timeout) =>
      isLocal(w)
        ? local.intent(project, request)
        : (host.intent?.(w, project, request, timeout) ??
          Promise.reject(new Error("This Hub takes no intents."))),
    coordEvents: (w, ...args) =>
      isLocal(w)
        ? local.coordEvents(...args)
        : (host.coordEvents?.(w, ...args) ?? Promise.resolve([])),
    createChat: (w, ...args) =>
      isLocal(w) || host.createChat === undefined ? teamOnly() : host.createChat(w, ...args),
    createTask: (w, ...args) =>
      isLocal(w) || host.createTask === undefined ? teamOnly() : host.createTask(w, ...args),
    updateTask: (w, ...args) =>
      isLocal(w) || host.updateTask === undefined ? teamOnly() : host.updateTask(w, ...args),
    deleteTask: (w, ...args) =>
      isLocal(w) || host.deleteTask === undefined ? teamOnly() : host.deleteTask(w, ...args),
  };
}
