import { EnvironmentId, type PeerInvitation, type PeerWorkspaceState } from "@t3tools/contracts";
import { act, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("../../../state/server", () => ({
  serverEnvironment: {
    peerHubInvite: null,
    peerHubResendInvite: null,
    peerHubWithdrawInvite: null,
    peerHubInvitations: () => null,
  },
}));
vi.mock("../../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.command }));
vi.mock("../../../state/query", () => ({ useEnvironmentQuery: () => ({ data: null }) }));
vi.mock("./useInvitePreviews", () => ({ useInvitePreviews: () => [] }));
vi.mock("../../ui/toast", () => ({ toastManager: { add: vi.fn() } }));
vi.mock("../../settings/settingsLayout", () => ({
  useRelativeTimeTick: () => Date.parse("2026-10-28T12:00:00Z"),
  SettingsRow: ({ children, description }: { children?: ReactNode; description?: ReactNode }) => (
    <section>
      <p>{description}</p>
      {children}
    </section>
  ),
}));
vi.mock("../../ui/dialog", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Part,
    DialogPopup: Part,
    DialogHeader: Part,
    DialogTitle: ({ children }: { children?: ReactNode }) => <h2>{children}</h2>,
    DialogPanel: Part,
    DialogFooter: Part,
    DialogDescription: Part,
  };
});
vi.mock("../../ui/input", () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}));
vi.mock("../../ui/checkbox", () => ({
  Checkbox: (props: { checked: boolean; onCheckedChange: (on: boolean) => void }) => (
    <input type="checkbox" data-checkbox onChange={() => undefined} {...props} />
  ),
}));
vi.mock("../../ui/select", () => ({
  Select: ({
    children,
    onValueChange,
    value,
  }: {
    children?: ReactNode;
    onValueChange: (value: string | null) => void;
    value: string;
  }) => (
    <div data-select data-value={value} data-change={onValueChange}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectValue: () => null,
  SelectPopup: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  SelectItem: ({ children, value }: { children?: ReactNode; value: string }) => (
    <span data-option={value}>{children}</span>
  ),
}));

import { WorkspaceInvitations } from "./WorkspaceInvitations";
import { InviteDialog } from "./WorkspacePeopleParts";

const ENV = EnvironmentId.make("env-here");
let renderer: ReactTestRenderer | null = null;

function words(node: ReactTestInstance | ReactTestRenderer["root"]): string {
  return node.children
    .map((child) => (typeof child === "string" ? child : words(child)))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

const task = (id: string, status: "open" | "review" | "done", title: string) => ({
  id,
  key: id.toUpperCase(),
  title,
  status,
});

/** Acme as Ana sees it: she leads Webshop and is a member of Billing; `role` is her workspace role. */
const acme = (role: "member" | "admin") =>
  ({
    slug: "acme",
    name: "Acme",
    role,
    projects: [
      {
        project: { id: "webshop", name: "Webshop", role: "lead" },
        work: {
          tasks: [task("vl7", "open", "Split payments"), task("vl9", "done", "Old receipts")],
        },
      },
      {
        project: { id: "billing", name: "Billing", role: "member" },
        work: { tasks: [task("bl1", "open", "Invoices")] },
      },
    ],
  }) as unknown as PeerWorkspaceState;

const checkboxes = () =>
  renderer!.root
    .findAll(
      (node) => node.type === "label" && node.findAllByProps({ "data-checkbox": true }).length > 0,
    )
    .map((label) => words(label));
const tick = async (name: string) => {
  const label = renderer!.root.findAll((node) => node.type === "label" && words(node) === name)[0]!;
  const box = label.findByProps({ "data-checkbox": true });
  await act(async () => box.props.onCheckedChange(true));
};
const taskSelect = () => renderer!.root.findAllByProps({ "data-select": true })[0];
const options = () =>
  taskSelect()!
    .findAll((node) => node.props["data-option"] !== undefined)
    .map((node) => words(node));

async function openDialog(role: "member" | "admin") {
  await act(async () => {
    renderer = create(
      <InviteDialog environmentId={ENV} workspace={acme(role)} onClose={() => {}} />,
    );
  });
}

async function type(text: string) {
  const field = renderer!.root.find((node) => node.type === "input" && node.props.type === "text");
  await act(async () => field.props.onChange({ target: { value: text } }));
}

async function submit() {
  const form = renderer!.root.findByType("form");
  await act(async () => form.props.onSubmit({ preventDefault: () => undefined }));
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.command.mockReset();
  mocks.command.mockResolvedValue({ _tag: "Success", value: {} });
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

describe("the invitation form", () => {
  it("lists only the projects a lead leads, with no role to choose, and sends the task picked", async () => {
    await openDialog("member");
    expect(checkboxes()).toEqual(["Webshop"]);
    expect(words(renderer!.root)).not.toContain("Role");
    // Her one project is ticked already, so its open tasks are offered; a done one is not.
    expect(options()).toEqual(["No task", "VL7 Split payments"]);
    await act(async () => taskSelect()!.props["data-change"]("vl7"));
    await type("cyril@freelance.example");
    await submit();
    expect(mocks.command).toHaveBeenCalledWith({
      environmentId: ENV,
      input: {
        workspace: "acme",
        email: "cyril@freelance.example",
        role: "member",
        projects: ["webshop"],
        task: "vl7",
      },
    });
  });

  it("lets an admin name any project, or none for the whole workspace", async () => {
    await openDialog("admin");
    expect(checkboxes()).toEqual(["Webshop", "Billing"]);
    expect(taskSelect()).toBeUndefined();
    await type("dan@acme.test");
    await submit();
    expect(mocks.command).toHaveBeenLastCalledWith({
      environmentId: ENV,
      input: { workspace: "acme", email: "dan@acme.test", role: "member" },
    });

    await openDialog("admin");
    await tick("Billing");
    expect(options()).toEqual(["No task", "BL1 Invoices"]);
    await tick("Webshop");
    expect(options()).toEqual([
      "No task",
      "Webshop · VL7 Split payments",
      "Billing · BL1 Invoices",
    ]);
  });

  it("hands a task to one person only", async () => {
    await openDialog("member");
    await act(async () => taskSelect()!.props["data-change"]("vl7"));
    await type("cyril@freelance.example, dana@freelance.example");
    expect(words(renderer!.root)).toContain("A task goes to one person.");
    await submit();
    expect(mocks.command).not.toHaveBeenCalled();
  });
});

describe("an invitation's row", () => {
  const invitation = (extra: Partial<PeerInvitation>): PeerInvitation => ({
    email: "cyril@freelance.example",
    role: "member",
    invitedBy: "ana@acme.test",
    invitedAt: "2026-10-27T12:00:00Z",
    expiresAt: "2026-11-10T12:00:00Z",
    status: "pending",
    ...extra,
  });

  it("says which projects it limits them to and the task that waits", async () => {
    await act(async () => {
      renderer = create(
        <WorkspaceInvitations
          environmentId={ENV}
          workspace={acme("admin")}
          invitations={[
            invitation({ projects: ["webshop"], task: "vl7" }),
            invitation({ email: "dan@acme.test" }),
          ]}
          onChanged={() => {}}
        />,
      );
    });
    const rows = renderer!.root.findAllByType("li").map((row) => words(row));
    expect(rows.find((row) => row.includes("cyril"))).toContain(
      "On Webshop only · VL7 waits for them",
    );
    expect(rows.find((row) => row.includes("dan@"))).not.toContain("only");
  });
});
