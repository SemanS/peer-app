import { verificationReadKey } from "@t3tools/client-runtime/peer/github";
import type { PeerGitHubStatus, PeerHubStatus, PeerWorkspaceState } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("../../../state/server", () => ({ serverEnvironment: { peerGitHubStatus: {} } }));
vi.mock("../../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.read }));
vi.mock("../WorkspaceAccess", () => ({ failureMessage: () => "The Hub did not answer." }));
vi.mock("./GitHubWizard", () => ({ GitHubWizard: () => null }));
vi.mock("./useReviewChanges", () => ({
  useReviewChanges: () => ({ open: vi.fn(), dialog: null }),
}));
vi.mock("../PeerPageHeader", () => ({ PeerCard: () => null }));
vi.mock("../../settings/ConnectionStatus", () => ({
  ConnectionBadge: () => null,
  ConnectionStatus: () => null,
}));
vi.mock("../../settings/settingsLayout", () => ({ useRelativeTimeTick: () => undefined }));
vi.mock("../../ui/button", () => ({ Button: () => null, InlineButton: () => null }));

import { useGitHubChecksStatus } from "./IntegrationsGitHub";

const answer = (over: Partial<PeerGitHubStatus> = {}): PeerGitHubStatus => ({
  configured: false,
  webhookPath: "/v1/workspaces/acme/github/webhook",
  lastPingAt: null,
  lastVerifiedAt: null,
  repositories: [],
  ...over,
});
/** The status a Peer sends: what it knows of the workspace's verification. */
const hub = (verification: { configured: boolean; lastVerifiedAt: string | null }) =>
  ({
    github: {
      cli: false,
      account: null,
      signIn: null,
      error: null,
      verification: [{ workspace: "acme", ...verification }],
    },
  }) as unknown as PeerHubStatus;
const workspace = (revision: string) =>
  ({
    slug: "acme",
    name: "Acme",
    role: "admin",
    revision,
    projects: [],
  }) as unknown as PeerWorkspaceState;

/** What a page tells of the checks: nothing read yet, verification off, or on. */
function Probe({ moved }: { readonly moved: string }) {
  const { status } = useGitHubChecksStatus({
    environmentId: "env" as never,
    workspace: "acme",
    moved,
  });
  return status === null ? "reading" : status.configured ? "on" : "off";
}
let renderer: ReactTestRenderer | null = null;
const card = (
  revision: string,
  verification: { configured: boolean; lastVerifiedAt: string | null },
) => <Probe moved={verificationReadKey(hub(verification), workspace(revision))} />;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.read.mockReset();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  vi.unstubAllGlobals();
  renderer = null;
});

describe("GitHub's status on the Integrations and Hub pages", () => {
  it("is read again when the status says verification moved, so a page left open follows the github block", async () => {
    mocks.read.mockResolvedValue({ _tag: "Success", value: answer() });
    await act(async () => {
      renderer = create(card("r1", { configured: false, lastVerifiedAt: null }));
    });
    expect(renderer!.toJSON()).toBe("off");
    expect(mocks.read).toHaveBeenCalledTimes(1);

    // Applying the block moves the workspace's revision and the Peer's cached verification.
    mocks.read.mockResolvedValue({ _tag: "Success", value: answer({ configured: true }) });
    await act(async () => {
      renderer!.update(card("r2", { configured: true, lastVerifiedAt: null }));
    });
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(renderer!.toJSON()).toBe("on");

    // Removing it moves them back.
    mocks.read.mockResolvedValue({ _tag: "Success", value: answer() });
    await act(async () => {
      renderer!.update(card("r3", { configured: false, lastVerifiedAt: null }));
    });
    expect(mocks.read).toHaveBeenCalledTimes(3);
    expect(renderer!.toJSON()).toBe("off");
  });

  it("does not read again for a status that changed nothing it shows", async () => {
    mocks.read.mockResolvedValue({ _tag: "Success", value: answer({ configured: true }) });
    const on = { configured: true, lastVerifiedAt: null };
    await act(async () => {
      renderer = create(card("r1", on));
    });
    await act(async () => {
      renderer!.update(card("r1", on));
    });
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
});
