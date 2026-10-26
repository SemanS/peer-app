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
    nameOf: (workspace, email) => (isLocal(workspace) ? "You" : host.nameOf(workspace, email)),
    workspaces: () => [...new Set([...host.workspaces(), PEER_LOCAL_WORKSPACE])],
    report: (w, sessions) => (isLocal(w) ? local.report(sessions) : host.report(w, sessions)),
    view: (w) => (isLocal(w) ? local.view() : host.view(w)),
    note: (w, ...args) => (isLocal(w) ? local.note(...args) : host.note(w, ...args)),
    resolve: (w, ...args) => (isLocal(w) ? local.resolve(...args) : host.resolve(w, ...args)),
    intent: (w, project, request, timeout) =>
      isLocal(w)
        ? local.intent(project, request)
        : (host.intent?.(w, project, request, timeout) ?? Promise.resolve({ unsupported: true })),
    ack: (w, ...args) =>
      isLocal(w)
        ? local.ack(...args)
        : (host.ack?.(w, ...args) ?? Promise.resolve({ unsupported: true })),
    readContext: (w, ...args) =>
      isLocal(w) ? local.readContext(...args) : host.readContext(w, ...args),
    keepContext: (w, ...args) =>
      isLocal(w) ? local.keepContext(...args) : host.keepContext(w, ...args),
    writeContext: (w, ...args) =>
      isLocal(w) ? local.writeContext(...args) : host.writeContext(w, ...args),
    contextVersions: (w, ...args) =>
      isLocal(w) ? local.contextVersions(...args) : host.contextVersions(w, ...args),
    readContextVersion: (w, ...args) =>
      isLocal(w) ? local.readContextVersion(...args) : host.readContextVersion(w, ...args),
    contextRead: (w, ...args) =>
      isLocal(w)
        ? local.contextRead(...args)
        : host.contextRead !== undefined
          ? host.contextRead(w, ...args)
          : Promise.reject(new Error("Context read tracking is unavailable on this Hub.")),
    staleReads: (w, ...args) =>
      isLocal(w)
        ? local.staleReads(...args)
        : host.staleReads !== undefined
          ? host.staleReads(w, ...args)
          : Promise.reject(new Error("Context read tracking is unavailable on this Hub.")),
    contextAuthority: (workspace) =>
      isLocal(workspace) ? `local:${local.environment}` : host.contextAuthority?.(workspace),
    pendingFindings: (w, ...args) =>
      isLocal(w)
        ? local.pendingFindings(...args)
        : host.pendingFindings !== undefined
          ? host.pendingFindings(w, ...args)
          : Promise.reject(new Error("Pending findings are unavailable on this Hub.")),
    recoverInputs: (w, ...args) =>
      isLocal(w)
        ? local.recoverInputs(...args)
        : host.recoverInputs !== undefined
          ? host.recoverInputs(w, ...args)
          : Promise.reject(new Error("Input recovery is unavailable on this Hub.")),
    coordEvents: (w, ...args) =>
      isLocal(w)
        ? local.coordEvents(...args)
        : (host.coordEvents?.(w, ...args) ?? Promise.resolve([])),
    createTask: (w, ...args) =>
      isLocal(w) || host.createTask === undefined ? teamOnly() : host.createTask(w, ...args),
    updateTask: (w, ...args) =>
      isLocal(w) || host.updateTask === undefined ? teamOnly() : host.updateTask(w, ...args),
    deleteTask: (w, ...args) =>
      isLocal(w) || host.deleteTask === undefined ? teamOnly() : host.deleteTask(w, ...args),
    finishTask: (w, ...args) =>
      isLocal(w) || host.finishTask === undefined ? teamOnly() : host.finishTask(w, ...args),
  };
}
