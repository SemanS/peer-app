import { VERIFICATION_POLL_MS, verificationReadKey } from "@t3tools/client-runtime/peer/github";
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

/** What a page tells of the checks: nothing read yet, verification off, waiting for GitHub's ping, or pinged. */
function Probe({
  moved,
  waitForPing = false,
}: {
  readonly moved: string;
  readonly waitForPing?: boolean;
}) {
  const { status } = useGitHubChecksStatus(
    { environmentId: "env" as never, workspace: "acme", moved },
    { waitForPing },
  );
  return status === null
    ? "reading"
    : !status.configured
      ? "off"
      : status.lastPingAt === null
        ? "waiting"
        : "pinged";
}
let renderer: ReactTestRenderer | null = null;
const card = (
  revision: string,
  verification: { configured: boolean; lastVerifiedAt: string | null },
) => <Probe moved={verificationReadKey(hub(verification), workspace(revision))} />;

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
    expect(renderer!.toJSON()).toBe("waiting");

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

  it("asks the Hub now and then until GitHub's ping has arrived, when the page waits for it", async () => {
    vi.useFakeTimers();
    mocks.read.mockResolvedValue({ _tag: "Success", value: answer({ configured: true }) });
    await act(async () => {
      renderer = create(<Probe moved="r1" waitForPing />);
    });
    expect(renderer!.toJSON()).toBe("waiting");
    expect(mocks.read).toHaveBeenCalledTimes(1);

    // GitHub's ping publishes nothing, so only asking shows it.
    mocks.read.mockResolvedValue({
      _tag: "Success",
      value: answer({ configured: true, lastPingAt: "2026-10-15T15:00:00Z" }),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VERIFICATION_POLL_MS);
    });
    expect(renderer!.toJSON()).toBe("pinged");
    const asked = mocks.read.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VERIFICATION_POLL_MS * 3);
    });
    expect(mocks.read).toHaveBeenCalledTimes(asked);
  });

  it("does not poll for a page that does not wait for the ping, nor while verification is off", async () => {
    vi.useFakeTimers();
    mocks.read.mockResolvedValue({ _tag: "Success", value: answer({ configured: true }) });
    await act(async () => {
      renderer = create(<Probe moved="r1" />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VERIFICATION_POLL_MS * 3);
    });
    expect(mocks.read).toHaveBeenCalledTimes(1);

    mocks.read.mockReset();
    mocks.read.mockResolvedValue({ _tag: "Success", value: answer() });
    await act(async () => {
      renderer!.update(<Probe moved="r2" waitForPing />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VERIFICATION_POLL_MS * 3);
    });
    expect(mocks.read).toHaveBeenCalledTimes(1);
  });
});
