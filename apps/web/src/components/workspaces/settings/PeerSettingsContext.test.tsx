// @vitest-environment jsdom
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { useLastPeerWorkspace } from "./PeerSettingsContext";
import { useActiveOrganization } from "../organizationChoice";
import { organizationStatus } from "../activeOrganization.logic";
import { ALL_PROJECTS } from "../workBoard.logic";
import { newChatProject, peerProjectIndex, resolveProjectScope } from "../projectScope.logic";
import { EnvironmentId, type PeerHubStatus, ProjectId } from "@t3tools/contracts";

let root: Root;
let settings: ReturnType<typeof useLastPeerWorkspace>;
let organization: ReturnType<typeof useActiveOrganization>;
function Probe() {
  const last = useLastPeerWorkspace();
  const active = useActiveOrganization();
  useEffect(() => {
    settings = last;
    organization = active;
  });
  return null;
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  localStorage.setItem("peer:settings-workspace", JSON.stringify("a"));
  localStorage.setItem("peer:work-scope", JSON.stringify("a/app"));
  root = createRoot(document.createElement("div"));
  await act(() => root.render(createElement(Probe)));
});
afterEach(async () => {
  await act(() => root.unmount());
  localStorage.clear();
  vi.unstubAllGlobals();
});
it.each(["settings", "picker"])(
  "reconciles Work, sidebar and New Chat when %s switches organizations",
  async (entry) => {
    await act(() => (entry === "settings" ? settings[1]("b") : organization.choose("b")));
    expect(organization.chosen).toBe("b");
    expect(organization.scope).toBe(ALL_PROJECTS);
    const status = {
      signedIn: true,
      environmentId: "env",
      workspaces: ["a", "b"].map((slug) => ({
        slug,
        projects: [
          {
            project: { id: "app", name: `${slug} app` },
            repositories: [{ projectId: ProjectId.make(`${slug}-local`) }],
          },
        ],
      })),
    } as unknown as PeerHubStatus;
    const sidebar = resolveProjectScope(organization.scope, {
      peer: peerProjectIndex(status),
      groups: [],
    });
    const work = resolveProjectScope(organization.scope, {
      peer: peerProjectIndex(organizationStatus(status, organization.chosen)),
      groups: [],
    });
    expect(sidebar.scope).toBe(ALL_PROJECTS);
    expect(work.scope).toBe(ALL_PROJECTS);
    expect(newChatProject(sidebar, EnvironmentId.make("env"))?.projectId).not.toBe("a-local");
    expect(
      organizationStatus(status, organization.chosen).workspaces.map(({ slug }) => slug),
    ).toEqual(["b"]);
  },
);
it.each([ALL_PROJECTS, "local:my-project"])(
  "preserves the intended %s scope on a settings switch",
  async (scope) => {
    localStorage.setItem("peer:work-scope", JSON.stringify(scope));
    window.dispatchEvent(new StorageEvent("storage", { key: "peer:work-scope" }));
    await act(() => root.render(createElement(Probe)));
    await act(() => settings[1]("b"));
    expect(organization.scope).toBe(scope);
  },
);
