import type { PeerHubStatus } from "@t3tools/contracts";
import { UsersIcon } from "lucide-react";
import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => mocks.navigate }));

import { SignalTiles } from "./ProjectSignals";
import type { PeerWebPlugin } from "./slots.types";
import type { WorkProjectNode } from "./workTree.logic";

const project = {
  workspace: "acme",
  projectId: "ordering",
  name: "Ordering demo",
} as WorkProjectNode;
const status = { coordination: { enabled: false } } as unknown as PeerHubStatus;
const plugin = (id: string, count: number | null): PeerWebPlugin => ({
  id: "ownership",
  projectSignals: () => [
    { id, label: id, icon: UsersIcon, count, detail: "", tone: "team", open: () => undefined },
  ],
});

let renderer: ReactTestRenderer | null = null;

function words(node: ReactTestInstance): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

async function show(
  activeThread: string | null,
  plugins = [plugin("team", null), plugin("memory", null)],
) {
  await act(async () => {
    renderer = create(
      <SignalTiles
        status={status}
        project={project}
        plugins={plugins}
        activeThread={activeThread}
      />,
    );
  });
}
const tiles = () => renderer!.root.findAllByType("button");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
});

describe("a project's signal tiles", () => {
  it("marks the tile of the page that is open, and no other", async () => {
    await show("team:acme:ordering");
    const current = tiles().filter((tile) => tile.props["aria-current"] === "page");
    expect(current.map((tile) => words(tile))).toEqual(["team"]);
  });

  it("marks none while another page is open, or in another project", async () => {
    for (const open of [
      null,
      "knowledge:acme:ordering",
      "team:acme:billing",
      "team:other:ordering",
    ]) {
      await show(open);
      expect(
        tiles().filter((tile) => tile.props["aria-current"] === "page"),
        String(open),
      ).toEqual([]);
      await act(async () => renderer!.unmount());
    }
  });

  it("keeps a tile that opens a page without a count, as Memory's does", async () => {
    await show(null);
    expect(tiles()).toHaveLength(2);
  });
});
