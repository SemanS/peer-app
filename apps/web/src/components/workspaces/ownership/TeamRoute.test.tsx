import type { PeerPluginState } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  status: null as unknown,
  owner: true,
  change: vi.fn(),
  team: vi.fn(),
}));
vi.mock("../../../state/environments", () => ({
  usePrimaryEnvironment: () => ({
    environmentId: "env-here",
    connection: { phase: "connected" },
  }),
}));
vi.mock("../WorkspaceAccess", () => ({ usePeerHubStatus: () => mocks.status }));
vi.mock("../usePeerPluginControl", () => ({
  usePeerPluginControl: () => ({ owner: mocks.owner, change: mocks.change }),
}));
vi.mock("../PeerPageHeader", () => ({
  PeerPageHeader: ({ page }: { page: ReactNode }) => <header>{page}</header>,
}));
vi.mock("../../ui/sidebar", () => ({
  SidebarInset: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock("./TeamPage", () => ({
  TeamPage: (props: Record<string, unknown>) => {
    mocks.team(props);
    return <div data-team-page />;
  },
}));

import { TeamRoute } from "./TeamRoute";

let renderer: ReactTestRenderer | null = null;

function words(node: ReactTestInstance | ReactTestRenderer["root"]): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

const listed = (state: Partial<PeerPluginState>): PeerPluginState => ({
  id: "ownership",
  title: "Ownership",
  enabled: true,
  active: true,
  ...state,
});

async function show(plugin: PeerPluginState, search = {}) {
  mocks.status = { plugins: [plugin], hub: undefined, signedIn: true };
  await act(async () => {
    renderer = create(<TeamRoute workspace="acme" project="ordering" search={search} />);
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.team.mockReset();
  mocks.change.mockReset().mockResolvedValue(null);
  mocks.owner = true;
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
});

describe("a link to the Team page", () => {
  it("opens the page for the project, or its owner map, while Ownership is active", async () => {
    await show(listed({}));
    expect(mocks.team).toHaveBeenLastCalledWith({
      workspace: "acme",
      project: "ordering",
      view: "team",
    });
    await act(async () => renderer!.unmount());
    await show(listed({}), { view: "owner-map" });
    expect(mocks.team).toHaveBeenLastCalledWith({
      workspace: "acme",
      project: "ordering",
      view: "owner-map",
    });
  });

  it("lands on the plugin's own off page while it is off, which its owner may turn on", async () => {
    await show(listed({ enabled: false, active: false, reason: "off" }));
    expect(renderer!.root.findAllByProps({ "data-team-page": true })).toEqual([]);
    expect(words(renderer!.root.findByProps({ role: "status" }))).toBe(
      "Ownership is turned off on this environment.",
    );
    const turnOn = renderer!.root
      .findAllByType("button")
      .find((b) => words(b) === "Turn on Ownership");
    expect(turnOn).toBeDefined();
    await act(async () => turnOn!.props.onClick());
    expect(mocks.change).toHaveBeenCalledWith("ownership", true);
  });

  it("tells someone who may not turn it on to ask the environment's owner", async () => {
    mocks.owner = false;
    await show(listed({ enabled: false, active: false, reason: "off" }));
    expect(words(renderer!.root)).toContain("Ask the owner of this environment to turn it on.");
    expect(renderer!.root.findAllByType("button")).toEqual([]);
  });

  it("says when the Hub is too old to serve it, and shows no page", async () => {
    await show(listed({ active: false, reason: "hub" }));
    expect(words(renderer!.root.findByProps({ role: "status" }))).toBe(
      "Ownership needs a newer Peer Hub.",
    );
    expect(mocks.team).not.toHaveBeenCalled();
  });
});
