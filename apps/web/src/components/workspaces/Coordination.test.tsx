import { EnvironmentId, PeerHubError, type PeerHubStatus } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act, type ButtonHTMLAttributes, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { expect, it, vi } from "vite-plus/test";

const commands = vi.hoisted(() => ({ set: vi.fn(), toast: vi.fn() }));
vi.mock("../../state/server", () => ({ serverEnvironment: { peerHubSetCoordination: null } }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => commands.set }));
vi.mock("../ui/toast", async () => ({
  toastManager: { add: commands.toast },
  stackedThreadToast: (await import("../ui/toastHelpers")).stackedThreadToast,
}));
vi.mock("../ui/switch", () => ({
  Switch: ({
    checked,
    onCheckedChange,
    ...props
  }: {
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
  } & ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
      {...props}
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
    />
  ),
}));
vi.mock("../ui/toggle-group", () => ({
  Toggle: ({ children }: { children: ReactNode }) => children,
  ToggleGroup: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../ui/button", () => ({
  Button: ({ children, ...props }: ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

import { CoordinationControls } from "./Coordination";
import { shouldRenderThreadScopedToast } from "../ui/toast.logic";

it.each([
  { command: "Add to Claude Code", present: false },
  { command: "Remove from Claude Code", present: true },
])("reports a failed $command and lets the person retry", async ({ command, present }) => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const detail = "Claude Code's settings could not be written. Check this home and retry.";
  commands.set.mockResolvedValue(AsyncResult.failure(Cause.fail(new PeerHubError({ detail }))));
  commands.toast.mockClear();
  const status = {
    coordination: {
      enabled: true,
      policy: "coordinate",
      claudeHooks: false,
      claudeHooksPresent: present,
    },
  } as unknown as PeerHubStatus;
  let renderer: ReactTestRenderer | undefined;
  const toggle = () =>
    renderer!.root.findAllByType("button").find((button) => button.children.join("") === command)!;
  try {
    await act(async () => {
      renderer = create(
        <CoordinationControls environmentId={EnvironmentId.make("local")} status={status} />,
      );
    });
    await act(async () => {
      toggle().props.onClick();
    });
    const toast = commands.toast.mock.calls[0]?.[0];
    expect(toast).toMatchObject({
      type: "error",
      title: "Could not change agent coordination",
      description: detail,
    });
    expect(shouldRenderThreadScopedToast(toast.data, null)).toBe(true);
    expect(toggle().props.disabled).toBe(false);
  } finally {
    await act(async () => renderer?.unmount());
    vi.unstubAllGlobals();
  }
});
