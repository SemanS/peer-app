import { EnvironmentId, type PeerInvitation, type PeerWorkspaceState } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  command: vi.fn(),
  invitations: null as ReadonlyArray<unknown> | null,
}));
vi.mock("../../../../state/server", () => ({
  serverEnvironment: {
    peerHubResendInvite: null,
    peerHubWithdrawInvite: null,
    peerHubInvitations: () => null,
    peerSettings: { save: null },
  },
}));
vi.mock("../../../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.command }));
vi.mock("../../../../state/query", () => ({
  useEnvironmentQuery: () => ({
    data: mocks.invitations === null ? null : { invitations: mocks.invitations },
    refresh: () => undefined,
  }),
}));
vi.mock("../../../settings/settingsLayout", () => ({
  useRelativeTimeTick: () => Date.parse("2026-10-28T12:00:00Z"),
  SettingsSection: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  SettingsRow: ({ children, description }: { children?: ReactNode; description?: ReactNode }) => (
    <div>
      <p>{description}</p>
      {children}
    </div>
  ),
}));
vi.mock("../../../ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("../../WorkspaceMembers", () => ({ WorkspaceMembers: () => <p>Members</p> }));
vi.mock("../InviteRow", () => ({ InviteRow: () => <p>Invite</p> }));
vi.mock("../PeerSettingsPage", () => ({
  PeerSettingsPage: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}));
vi.mock("../PluginSlots", () => ({ HostedWorkspaceSettings: () => null }));
vi.mock("../useSettingsView", () => ({ useSettingsView: () => ({}) }));
vi.mock("../WorkspacePeopleParts", () => ({ RemoveMemberDialog: () => null }));

import { WorkspacePeople } from "./WorkspacePeople";

const ENV = EnvironmentId.make("env-here");
let renderer: ReactTestRenderer | null = null;

function words(node: ReactTestInstance | ReactTestRenderer["root"]): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Acme as Ana sees it: a member who leads Webshop, or one who leads nothing. */
const acme = (leads: boolean) =>
  ({
    slug: "acme",
    name: "Acme",
    role: "member",
    projects: [
      {
        project: { id: "webshop", name: "Webshop", role: leads ? "lead" : "member" },
        work: { tasks: [{ id: "vl8", key: "VL8", title: "Refunds", status: "open" }] },
      },
    ],
  }) as unknown as PeerWorkspaceState;

/** Cyril's invitation from Ana, accepted after somebody else took VL8. */
const accepted: PeerInvitation = {
  email: "cyril@freelance.example",
  role: "member",
  invitedBy: "ana@acme.test",
  invitedAt: "2026-10-27T12:00:00Z",
  expiresAt: "2026-11-10T12:00:00Z",
  status: "accepted",
  projects: ["webshop"],
  task: "vl8",
  taskOutcome: "taken-meanwhile",
};
const pending: PeerInvitation = {
  ...accepted,
  email: "dana@freelance.example",
  status: "pending",
  task: null,
  taskOutcome: null,
};

async function open(leads: boolean) {
  await act(async () => {
    renderer = create(
      <WorkspacePeople
        environmentId={ENV}
        status={{ email: "ana@acme.test" } as never}
        workspace={acme(leads)}
      />,
    );
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.command.mockReset();
  mocks.command.mockResolvedValue({ _tag: "Success", value: {} });
  mocks.invitations = [accepted, pending];
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

describe("a lead's People page", () => {
  it("lists the invitations they sent, with what became of the task", async () => {
    await open(true);
    const page = words(renderer!.root);
    expect(page).toContain("The invitations you sent.");
    const rows = renderer!.root.findAllByType("li").map((row) => words(row));
    expect(rows.find((row) => row.includes("cyril@"))).toContain(
      "On Webshop only · VL8 had been taken meanwhile",
    );
  });

  it("resends one of them, which the Hub scopes to the lead's own", async () => {
    await open(true);
    const row = renderer!.root.findAllByType("li").find((item) => words(item).includes("dana@"))!;
    const resend = row.findAll(
      (node) => typeof node.props.onClick === "function" && words(node) === "Resend",
    )[0]!;
    await act(async () => resend.props.onClick());
    expect(mocks.command).toHaveBeenCalledWith({
      environmentId: ENV,
      input: { workspace: "acme", email: "dana@freelance.example" },
    });
  });

  it("shows no invitations to a member who leads nothing", async () => {
    await open(false);
    expect(renderer!.root.findAllByType("li")).toEqual([]);
    expect(words(renderer!.root)).toContain("Ask one of them.");
  });
});
