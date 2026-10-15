import type { ReactNode } from "react";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type ReviewOptions = {
  readonly onSaved?: (() => void) | undefined;
  readonly onNothingToSave?: (() => void) | undefined;
};
const mocks = vi.hoisted(() => ({
  putSecret: vi.fn(),
  opened: vi.fn(),
  /** What the review's own buttons do: Done on a review with nothing to save, or after a save. */
  review: null as null | {
    readonly nothingToSave: () => Promise<void>;
    readonly saved: () => Promise<void>;
  },
}));
vi.mock("../../../state/query", () => ({
  useEnvironmentQuery: () => ({ data: { secrets: [] }, refresh: vi.fn() }),
}));
vi.mock("../../../state/server", () => ({
  serverEnvironment: { peerSettings: { secrets: () => null, putSecret: null } },
}));
vi.mock("../../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.putSecret }));
vi.mock("../../../hooks/useCopyToClipboard", () => ({
  useCopyToClipboard: () => ({ copyToClipboard: vi.fn(), isCopied: false }),
}));
vi.mock("../WorkspaceAccess", () => ({ failureMessage: () => null }));
vi.mock("../signals", () => ({ ProjectMark: () => null }));
vi.mock("./PeerSettingsContext", () => ({
  usePeerSettings: () => ({ status: { email: "ana@acme.test" } }),
}));
vi.mock("./useSettingsView", () => ({
  useSettingsView: () => ({
    document: { projects: { shop: { name: "Shop" } } },
    revision: 3,
    hubHasSettings: true,
  }),
}));
vi.mock("./useReviewChanges", async () => {
  const { useState } = await import("react");
  return {
    // The review dialog's own end: Done on a review with nothing to save calls `onNothingToSave` and
    // then closes; a saved change calls `onSaved` and closes the same way.
    useReviewChanges: (options: ReviewOptions) => {
      const [reviewing, setReviewing] = useState(false);
      mocks.review = {
        nothingToSave: async () => {
          await act(async () => {
            options.onNothingToSave?.();
            setReviewing(false);
          });
        },
        saved: async () => {
          await act(async () => {
            options.onSaved?.();
            setReviewing(false);
          });
        },
      };
      return {
        open: (operation: unknown) => {
          mocks.opened(operation);
          setReviewing(true);
        },
        dialog: reviewing ? <div data-review /> : null,
      };
    },
  };
});
vi.mock("../../ui/dialog", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
      open ? <div>{children}</div> : null,
    DialogPopup: Part,
    DialogHeader: Part,
    DialogTitle: Part,
  };
});
vi.mock("../PeerDialog", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    PeerDialogBody: Part,
    PeerDialogFooter: Part,
    PeerDialogMessage: Part,
    PeerStackedField: Part,
  };
});
vi.mock("../../ui/button", () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));
vi.mock("../../ui/checkbox", () => ({ Checkbox: () => null }));
vi.mock("../../ui/input", () => ({
  Input: (props: { placeholder?: string; onChange?: unknown }) => (
    <input placeholder={props.placeholder} onChange={props.onChange as never} />
  ),
}));
vi.mock("../../ui/switch", () => ({ Switch: () => null }));
vi.mock("../../ui/toggle", () => ({ Toggle: () => null }));
vi.mock("../../ui/toggle-group", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Toggle: Part, ToggleGroup: Part };
});
vi.mock("../../ui/tooltip", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Tooltip: Part, TooltipPopup: Part, TooltipTrigger: Part };
});

import type { PeerWorkspaceState } from "@t3tools/contracts";

import { WebhookDialog } from "./WebhookDialog";

let renderer: ReactTestRenderer | null = null;

const workspace = {
  slug: "acme",
  name: "Acme",
  memberName: "Ana",
  projects: [{ project: { id: "shop", name: "Shop" } }],
} as unknown as PeerWorkspaceState;

async function openNewWebhook(handlers: { onChanged: () => void; onClose: () => void }) {
  await act(async () => {
    renderer = create(
      <WebhookDialog
        environmentId={"env" as never}
        workspace={workspace}
        editing={null}
        takenIds={new Set()}
        {...handlers}
      />,
    );
  });
}

const type = async (placeholder: string, value: string) => {
  const field = renderer!.root
    .findAllByType("input")
    .find((candidate) => String(candidate.props.placeholder).startsWith(placeholder));
  await act(async () => field!.props.onChange({ target: { value } }));
};

/** Name and address typed, Save pressed: the secret is stored and the change goes to its review. */
async function save() {
  await type("Team Slack", "Ops");
  await type("https://hooks.slack.com", "https://hooks.slack.com/services/T0000/B0000/XXXXXXXX");
  await act(async () => {
    await renderer!.root.findByType("form").props.onSubmit({ preventDefault() {} });
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.putSecret.mockReset();
  mocks.putSecret.mockResolvedValue({ _tag: "Success", value: {} });
  mocks.opened.mockReset();
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = null;
});

describe("the webhook dialog after its review", () => {
  it("stores the address as a secret before the change is reviewed", async () => {
    await openNewWebhook({ onChanged: vi.fn(), onClose: vi.fn() });
    await save();
    expect(mocks.putSecret).toHaveBeenCalledWith({
      environmentId: "env",
      input: {
        workspace: "acme",
        name: "OPS_WEBHOOK_URL",
        value: "https://hooks.slack.com/services/T0000/B0000/XXXXXXXX",
      },
    });
    expect(mocks.opened).toHaveBeenCalledTimes(1);
  });

  it("is done once a saved change is closed, and the lists are read again", async () => {
    const handlers = { onChanged: vi.fn(), onClose: vi.fn() };
    await openNewWebhook(handlers);
    await save();
    await mocks.review!.saved();
    expect(handlers.onChanged).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });

  it("is done too when only a secret changed, so the review found nothing to save", async () => {
    // Replacing an address or a key stores a secret and leaves the settings as they were; the
    // webhook's status has changed all the same, and the form must not stay open behind the review.
    const handlers = { onChanged: vi.fn(), onClose: vi.fn() };
    await openNewWebhook(handlers);
    await save();
    await mocks.review!.nothingToSave();
    expect(handlers.onChanged).toHaveBeenCalledTimes(1);
    expect(handlers.onClose).toHaveBeenCalledTimes(1);
  });
});
