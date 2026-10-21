import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const location = vi.hoisted(() => ({
  hash: "",
  navigate: vi.fn(),
  listeners: new Set<() => void>(),
}));
vi.mock(import("@tanstack/react-router"), async (original) => {
  const { useSyncExternalStore } = await import("react");
  return {
    ...(await original()),
    useLocation: ((options: { select: (value: unknown) => unknown }) => {
      const hash = useSyncExternalStore(
        (listener) => {
          location.listeners.add(listener);
          return () => location.listeners.delete(listener);
        },
        () => location.hash,
      );
      return options.select({ hash, state: {} });
    }) as never,
    useNavigate: () => location.navigate,
  };
});
vi.mock(import("./SettingsScopeSentence"), () => ({ SettingsScopeSentence: () => null }) as never);

import { FoldedSettingsSection } from "./FoldedSettingsSection";
import { SettingsPageContainer, SettingsSearchTarget } from "./settingsLayout";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  location.hash = "";
  location.navigate.mockReset();
  vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
  vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Page() {
  return (
    <SettingsPageContainer>
      <FoldedSettingsSection id="advanced" title="Advanced" targetIds={["submodules", "lifecycle"]}>
        <SettingsSearchTarget id="submodules">Submodules</SettingsSearchTarget>
        <SettingsSearchTarget id="lifecycle">Chat lifecycle</SettingsSearchTarget>
      </FoldedSettingsSection>
    </SettingsPageContainer>
  );
}

const render = () => act(() => root.render(<Page />));

const trigger = () =>
  container.querySelector<HTMLButtonElement>("[data-slot=collapsible-trigger]")!;

describe("settings disclosure search destinations", () => {
  it("keeps advanced settings concealed until requested", async () => {
    await render();
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    expect(document.getElementById("submodules")).toBeNull();
    await act(() => trigger().click());
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById("submodules")).not.toBeNull();
  });

  it("opens a concealed descendant and focuses the actual setting on a deep link", async () => {
    location.hash = "submodules";
    await render();
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.id).toBe("submodules");
    expect(location.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ hash: "", replace: true }),
    );
  });

  it("reveals a later search destination after the user closes the section", async () => {
    location.hash = "submodules";
    await render();
    await act(() => {
      location.hash = "";
      location.listeners.forEach((listener) => listener());
    });
    await act(() => trigger().click());
    expect(trigger().getAttribute("aria-expanded")).toBe("false");
    await act(() => {
      location.hash = "lifecycle";
      location.listeners.forEach((listener) => listener());
    });
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement?.id).toBe("lifecycle");
  });
});
