import { DEFAULT_CLIENT_SETTINGS, type ClientSettings } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";

const mocks = vi.hoisted(() => ({
  getClientSettings: vi.fn<() => Promise<ClientSettings | null>>(),
  setClientSettings: vi.fn<(settings: ClientSettings) => Promise<void>>(),
}));

vi.mock(import("~/localApi"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    ensureLocalApi: () => ({ ...actual.ensureLocalApi(), persistence: mocks as never }),
  };
});

import { __resetClientSettingsPersistenceForTests } from "~/hooks/useSettings";
import { AppAtomRegistryProvider } from "~/rpc/atomRegistry";
import { FirstRunGate } from "./FirstRunGate";

function holdSavedSettings() {
  __resetClientSettingsPersistenceForTests();
  let finish: (settings: ClientSettings) => void = () => undefined;
  mocks.getClientSettings.mockReset().mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  return {
    finishLoading: (settings: ClientSettings) => finish(settings),
    [Symbol.dispose]: __resetClientSettingsPersistenceForTests,
  };
}

describe("FirstRunGate", () => {
  // Saved fonts and contrast reach the page as settings load, so text rendered before then would
  // paint with the defaults and redraw. Nothing else in the app prevents that.
  it.each([
    { client: "a connected app", enabled: true, hostedStatic: false },
    { client: "the hosted app", enabled: false, hostedStatic: true },
  ])("shows $client nothing until saved settings load", async ({ enabled, hostedStatic }) => {
    using settings = holdSavedSettings();
    await using screen = await render(
      <AppAtomRegistryProvider>
        <FirstRunGate enabled={enabled} hostedStatic={hostedStatic}>
          <p>Your chats</p>
        </FirstRunGate>
      </AppAtomRegistryProvider>,
    );

    expect(screen.container.textContent).toBe("");

    await act(() =>
      settings.finishLoading({
        ...DEFAULT_CLIENT_SETTINGS,
        onboardingCompletedAt: "2026-01-01T00:00:00.000Z",
      }),
    );

    await expect.element(screen.getByText("Your chats")).toBeInTheDocument();
  });
});
