import { VERIFICATION_POLL_MS } from "@t3tools/client-runtime/peer/github";
import type { PeerGitHubStatus, PeerHubStatus, PeerWorkspaceState } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../../state/server", () => ({ serverEnvironment: { peerGitHubStatus: {} } }));
vi.mock("../../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.read }));
vi.mock("../WorkspaceAccess", () => ({ failureMessage: () => "The Hub did not answer." }));
vi.mock("../../settings/settingsLayout", () => ({
  SettingsRow: ({
    title,
    description,
    control,
    children,
  }: {
    title: ReactNode;
    description: ReactNode;
    control?: ReactNode;
    children?: ReactNode;
  }) => (
    <section>
      <h3>{title}</h3>
      <p>{description}</p>
      {control}
      {children}
    </section>
  ),
}));

import { GitHubVerificationSettings } from "./GitHubVerificationSettings";

const answer = (over: Partial<PeerGitHubStatus> = {}): PeerGitHubStatus => ({
  configured: false,
  webhookPath: "/v1/workspaces/acme/github/webhook",
  lastPingAt: null,
  lastVerifiedAt: null,
  repositories: [],
  ...over,
});
/** The status a Peer sends: the workspace's configuration revision and what it knows of verification. */
const hub = (
  revision: string,
  verification: { configured: boolean; lastVerifiedAt: string | null },
) =>
  ({
    github: {
      cli: false,
      account: null,
      signIn: null,
      error: null,
      verification: [{ workspace: "acme", ...verification }],
    },
    workspaces: [{ slug: "acme", revision }],
  }) as unknown as PeerHubStatus;
const workspace = (revision: string) =>
  ({
    slug: "acme",
    name: "Acme",
    role: "admin",
    revision,
    projects: [],
  }) as unknown as PeerWorkspaceState;

let renderer: ReactTestRenderer | null = null;
const words = (node: ReactTestInstance): string =>
  node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
const section = (
  revision: string,
  verification: { configured: boolean; lastVerifiedAt: string | null },
) => (
  <GitHubVerificationSettings
    environmentId={"env" as never}
    status={hub(revision, verification)}
    workspace={workspace(revision)}
  />
);
const reads = async (settled: PeerGitHubStatus) => {
  mocks.read.mockResolvedValue({ _tag: "Success", value: settled });
};
const show = async () => {
  await act(async () => renderer!.root.findAllByType("button")[0]!.props.onClick());
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { hidden: false });
  mocks.read.mockReset();
});
afterEach(async () => {
  vi.useRealTimers();
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
  renderer = null;
});

describe("the GitHub verification section of a workspace's settings", () => {
  it("shows that verification came on once the github block is applied, without a reload", async () => {
    await reads(answer());
    await act(async () => {
      renderer = create(section("r1", { configured: false, lastVerifiedAt: null }));
    });
    await show();
    expect(words(renderer!.root)).toContain("Verification is off.");
    expect(mocks.read).toHaveBeenCalledTimes(1);

    // The apply moves the workspace's revision and the Peer's cached verification.
    await reads(answer({ configured: true }));
    await act(async () => {
      renderer!.update(section("r2", { configured: true, lastVerifiedAt: null }));
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(words(renderer!.root)).toContain("Waiting for GitHub's ping.");
    expect(words(renderer!.root)).not.toContain("Verification is off.");
  });

  it("does not read again for a status that changed nothing it shows", async () => {
    await reads(answer({ configured: true, lastVerifiedAt: "2026-10-10T12:00:00Z" }));
    const verified = { configured: true, lastVerifiedAt: "2026-10-10T12:00:00Z" };
    await act(async () => {
      renderer = create(section("r1", verified));
    });
    await show();
    await act(async () => {
      renderer!.update(section("r1", verified));
    });
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });

  it("asks the Hub now and then while it waits to hear from GitHub, and stops once a delivery is verified", async () => {
    vi.useFakeTimers();
    await reads(answer({ configured: true }));
    await act(async () => {
      renderer = create(section("r1", { configured: true, lastVerifiedAt: null }));
    });
    await show();
    expect(mocks.read).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(VERIFICATION_POLL_MS);
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);

    await reads(answer({ configured: true, lastPingAt: "2026-10-10T12:00:00Z" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VERIFICATION_POLL_MS);
    });
    expect(words(renderer!.root)).toContain("Receiving GitHub's ping since 2026-10-10T12:00:00Z.");

    await reads(answer({ configured: true, lastVerifiedAt: "2026-10-10T12:05:00Z" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VERIFICATION_POLL_MS);
    });
    expect(words(renderer!.root)).toContain("Receiving deliveries. Last verified");
    const done = mocks.read.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VERIFICATION_POLL_MS * 3);
    });
    expect(mocks.read).toHaveBeenCalledTimes(done);
  });
});
