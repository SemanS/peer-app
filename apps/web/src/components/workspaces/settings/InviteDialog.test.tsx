import { EnvironmentId, type PeerWorkspaceState } from "@t3tools/contracts";
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
          areas: [],
          tasks: [task("vl7", "open", "Split payments"), task("vl9", "done", "Old receipts")],
        },
      },
      {
        project: { id: "billing", name: "Billing", role: "member" },
        work: { areas: [], tasks: [task("bl1", "open", "Invoices")] },
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
  it("lists only the projects a lead leads, with no role to choose and no every-project choice", async () => {
    await openDialog("member");
    expect(checkboxes()).toEqual(["Webshop"]);
    expect(words(renderer!.root)).not.toContain("Role");
    expect(words(renderer!.root)).not.toContain("All projects");
    await type("cyril@freelance.example");
    await submit();
    expect(mocks.command).toHaveBeenCalledWith({
      environmentId: ENV,
      input: {
        workspace: "acme",
        email: "cyril@freelance.example",
        role: "member",
        projects: ["webshop"],
      },
    });
  });

  it("waits for a project while access is selected", async () => {
    await openDialog("admin");
    await type("cyril@freelance.example");
    await submit();
    expect(mocks.command).not.toHaveBeenCalled();
    await tick("Billing");
    await submit();
    expect(mocks.command.mock.calls[0]![0].input.projects).toEqual(["billing"]);
  });
});
