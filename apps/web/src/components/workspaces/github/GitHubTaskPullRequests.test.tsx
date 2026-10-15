import type { PeerHubStatus, PeerWorkThread } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../../localApi", () => ({
  ensureLocalApi: () => ({ shell: { openExternal: vi.fn() } }),
}));

import { GitHubTaskPullRequests } from "./GitHubTaskPullRequests";

const github = {
  state: "merged" as const,
  headBranch: "krk-1-a",
  baseBranch: "main",
  updatedAt: "2026-10-15T15:00:00Z",
  verifiedAt: "2026-10-15T15:00:01Z",
  mergedAt: "2026-10-15T15:00:00Z",
  mergeCommit: "d816e45",
};
const pull = (number: number) => ({
  url: `https://github.com/acme/shop/pull/${number}`,
  state: "open" as const,
  headBranch: `krk-1-${number}`,
});
const thread = (pullRequests: PeerWorkThread["pullRequests"]): PeerWorkThread => ({
  id: "thread",
  task: "krk-1",
  title: "Work",
  email: "bob@acme.test",
  status: "idle",
  source: "peer",
  environment: "a",
  seenAt: "2026-10-15T15:00:00Z",
  pullRequests,
});
const status = (threads: PeerWorkThread[], configured: boolean) =>
  ({
    github: { verification: [{ workspace: "acme", configured, lastVerifiedAt: null }] },
    workspaces: [
      {
        slug: "acme",
        projects: [
          {
            project: { id: "shop", members: [{ email: "bob@acme.test", name: "Bob" }] },
            work: { threads },
          },
        ],
      },
    ],
  }) as unknown as PeerHubStatus;

let renderer: ReactTestRenderer | null = null;
const words = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
const list = async (threads: PeerWorkThread[], configured = true) => {
  await act(async () => {
    renderer = create(
      <GitHubTaskPullRequests
        environmentId={"env" as never}
        status={status(threads, configured)}
        workspace="acme"
        project="shop"
        scope="task:krk-1"
        contextText={null}
      />,
    );
  });
  return words(renderer!.root);
};

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
  renderer = null;
});

describe("a task's pull request list", () => {
  it("names the source of every pull request: GitHub, or the owner's Peer", async () => {
    const text = await list([thread([{ ...pull(11), github }, pull(12)])]);
    expect(text).toContain("Merged · verified by GitHub");
    expect(text).toContain("· GitHub");
    // The one only the owner's Peer reported says so, with or without verification on.
    expect(text).toContain("Open · unverified");
    expect(text).toContain("Source: reported by Bob's Peer");
    expect(await list([thread([pull(12)])], false)).toContain("Source: reported by Bob's Peer");
  });
});
