import type { ProviderInteractionMode, RuntimeMode } from "@t3tools/contracts";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { CompactComposerControlsMenu } from "./CompactComposerControlsMenu";
import { runtimeModeConfig, runtimeModeOptions } from "./runtimeModeConfig";

let root: Root;
let container: HTMLDivElement;
const accessOptions = runtimeModeOptions.map((mode) => ({ mode, ...runtimeModeConfig[mode] }));

function ComposerMenu({ planEnabled }: { planEnabled: boolean }) {
  const [interactionMode, setInteractionMode] = useState<ProviderInteractionMode>("default");
  const [runtimeMode, setRuntimeMode] = useState<RuntimeMode>("approval-required");
  return (
    <CompactComposerControlsMenu
      interactionMode={interactionMode}
      runtimeMode={runtimeMode}
      runtimeModeOptions={accessOptions}
      showInteractionModeToggle={planEnabled}
      onToggleInteractionMode={() =>
        setInteractionMode((mode) => (mode === "plan" ? "default" : "plan"))
      }
      onRuntimeModeChange={setRuntimeMode}
    />
  );
}

async function openMenu() {
  await act(async () => {
    container.querySelector<HTMLButtonElement>("button")!.focus();
    await userEvent.keyboard("{ArrowDown}");
  });
  await expect.element(page.getByRole("menu")).toBeVisible();
}

async function press(keys: string) {
  await act(async () => userEvent.keyboard(keys));
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await page.viewport(390, 844);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("compact composer controls", () => {
  it("offers Build and Plan consistently and keeps keyboard selection in sync", async () => {
    await act(async () => root.render(<ComposerMenu planEnabled />));
    await openMenu();
    await expect
      .element(page.getByRole("menuitemradio", { name: "Build", exact: true }))
      .toHaveAttribute("aria-checked", "true");
    await press("{Home}{ArrowDown}{Enter}");
    await expect
      .element(page.getByRole("button", { name: "More composer controls" }))
      .toHaveAttribute("aria-expanded", "false");
    await openMenu();
    await expect
      .element(page.getByRole("menuitemradio", { name: "Plan", exact: true }))
      .toHaveAttribute("aria-checked", "true");
    await press("{Home}{Enter}");
    await openMenu();
    await expect
      .element(page.getByRole("menuitemradio", { name: "Build", exact: true }))
      .toHaveAttribute("aria-checked", "true");
  });

  it("keeps approval explanations readable at phone width and selects the same access modes", async () => {
    await act(async () => root.render(<ComposerMenu planEnabled={false} />));
    await openMenu();
    for (const option of accessOptions) {
      await expect.element(page.getByText(option.description, { exact: true })).toBeVisible();
    }
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const bounds = menu.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(window.innerWidth);
    expect(menu.scrollWidth).toBeLessThanOrEqual(menu.clientWidth);
    const explanation = [...menu.querySelectorAll("span")].find(
      (element) => element.textContent === runtimeModeConfig.auto.description,
    )!;
    expect(explanation.getBoundingClientRect().height).toBeGreaterThan(
      Number.parseFloat(getComputedStyle(explanation).lineHeight),
    );
    await press("{Home}{ArrowDown}{Enter}");
    await openMenu();
    await expect
      .element(page.getByRole("menuitemradio", { name: /^Auto-accept edits/ }))
      .toHaveAttribute("aria-checked", "true");
    await press("{Escape}");
    await expect
      .element(page.getByRole("button", { name: "More composer controls" }))
      .toHaveFocus();
  });
});
