import { WS_METHODS, type PeerHubStatus, type PeerResourcesState } from "@t3tools/contracts";
import type { Atom } from "effect/unstable/reactivity";
import type { EnvironmentRegistry } from "../connection/registry.ts";
import { createEnvironmentRpcCommand } from "../state/runtime.ts";
export type HeldResource = PeerResourcesState["held"][number];
export const resourceLabel = (hold: HeldResource) =>
  `${hold.kind === "resource" ? "Resource" : "Pattern"} ${hold.name}`;
export const releaseInput = (hold: HeldResource) => ({
  workspace: hold.workspace,
  project: hold.project,
  target: hold.kind === "resource" ? `resource:${hold.name}` : hold.name,
});
export function heldResources(status: PeerHubStatus): ReadonlyArray<HeldResource> {
  return [...(status.resources?.held ?? [])]
    .filter((h) =>
      status.workspaces.some(
        (w) => w.slug === h.workspace && w.projects.some((p) => p.project.id === h.project),
      ),
    )
    .sort(
      (a, b) =>
        a.workspace.localeCompare(b.workspace) ||
        a.project.localeCompare(b.project) ||
        a.kind.localeCompare(b.kind) ||
        a.name.localeCompare(b.name),
    );
}
export function mayRelease(status: PeerHubStatus, hold: HeldResource) {
  const workspace = status.workspaces.find((w) => w.slug === hold.workspace);
  const project = workspace?.projects.find((p) => p.project.id === hold.project);
  return (
    project !== undefined &&
    (hold.holder.email === status.email ||
      project.project.role === "lead" ||
      workspace?.role === "admin" ||
      workspace?.role === "owner")
  );
}
export const needsReleaseConfirmation = (status: PeerHubStatus, hold: HeldResource) =>
  hold.holder.email !== status.email;
/** Keep an expired row until the environment has re-asked the Hub; expiry may have been renewed. */
export function resourceTimeLeft(hold: HeldResource, observedAt: number, now: number) {
  const hubNow = Date.parse(hold.at) + Math.max(0, now - observedAt);
  const minutes = Math.ceil((Date.parse(hold.expiresAt) - hubNow) / 60_000);
  return minutes > 0 ? `${minutes} min left` : "Checking expiry…";
}
export function createResourcesEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    release: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:peer.resources.release",
      tag: WS_METHODS.peerResourcesRelease,
    }),
  };
}
