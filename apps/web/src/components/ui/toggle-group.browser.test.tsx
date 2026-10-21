import "../../index.css";

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { Toggle, ToggleGroup } from "./toggle-group";

let root: Root;
let container: HTMLDivElement;
let motionPreference: MediaQueryList;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  motionPreference = Object.assign(new EventTarget(), { matches: false }) as MediaQueryList;
  const matchMedia = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query) =>
    query.includes("prefers-reduced-motion") ? motionPreference : matchMedia(query),
  );
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

const indicator = () => container.querySelector<HTMLElement>("[data-slot=liquid-indicator]")!;
const buttons = () => [...container.querySelectorAll<HTMLButtonElement>("[data-slot=toggle]")];
const nextFrame = () => act(() => new Promise(requestAnimationFrame));
const finishMotion = () =>
  Promise.all(
    indicator()
      .getAnimations({ subtree: true })
      .map((a) => a.finished),
  );

function expectAligned(button: HTMLElement) {
  const glass = indicator().getBoundingClientRect();
  const target = button.getBoundingClientRect();
  for (const dimension of ["left", "top", "width", "height"] as const) {
    expect(glass[dimension]).toBeCloseTo(target[dimension], 0);
  }
}

async function render(orientation: "horizontal" | "vertical" = "horizontal", dir = "ltr") {
  await act(() =>
    root.render(
      <ToggleGroup variant="liquid" defaultValue={["everyone"]} orientation={orientation} dir={dir}>
        <Toggle value="everyone">Everyone</Toggle>
        <Toggle value="mine">Mine</Toggle>
        <Toggle value="disabled" disabled>
          Unavailable
        </Toggle>
      </ToggleGroup>,
    ),
  );
  await nextFrame();
}

function ControlledSidebar() {
  const [view, setView] = useState("work");
  return (
    <>
      <ToggleGroup
        variant="liquid"
        aria-label="Sidebar view"
        value={[view]}
        onValueChange={(next) => {
          if (next[0]) setView(next[0]);
        }}
      >
        <Toggle value="work">Tasks</Toggle>
        <Toggle value="threads">Chats</Toggle>
      </ToggleGroup>
      {view === "work" ? (
        <section aria-label="Task content">
          <h2>Team tasks</h2>
          <p>Waiting for review</p>
        </section>
      ) : (
        <section aria-label="Chat content">
          <h2>Your chats</h2>
          <p>Recent conversations</p>
        </section>
      )}
    </>
  );
}

it("keeps the same moving glass when controlled selection replaces the parent content", async () => {
  await act(() => root.render(<ControlledSidebar />));
  await nextFrame();
  const glass = indicator();
  const [tasks, chats] = buttons();
  expectAligned(tasks!);
  const start = glass.getBoundingClientRect().left;

  await act(() => chats!.click());
  expect(container.querySelector('[aria-label="Chat content"]')?.textContent).toContain(
    "Your chats",
  );
  expect(container.querySelector('[aria-label="Task content"]')).toBeNull();
  expect(chats!.getAttribute("aria-pressed")).toBe("true");
  expect(indicator()).toBe(glass);
  const transit = glass.getAnimations()[0]!;
  transit.pause();
  transit.currentTime = 60;
  const middle = glass.getBoundingClientRect().left;
  expect(middle).toBeGreaterThan(start);
  expect(middle).toBeLessThan(chats!.getBoundingClientRect().left);
  transit.play();
  await finishMotion();
  expectAligned(chats!);

  await act(() => tasks!.click());
  expect(container.querySelector('[aria-label="Task content"]')?.textContent).toContain(
    "Team tasks",
  );
  expect(container.querySelector('[aria-label="Chat content"]')).toBeNull();
  expect(indicator()).toBe(glass);
  expect(glass.getAnimations().length).toBeGreaterThan(0);
  await finishMotion();
  expectAligned(tasks!);
});

it.each([
  { label: "implicit segmented", variant: undefined },
  { label: "default", variant: "default" },
  { label: "segmented", variant: "segmented" },
  { label: "navigation", variant: "navigation" },
] as const)("moves glass for the $label single-selection group", async ({ variant }) => {
  await act(() =>
    root.render(
      <ToggleGroup variant={variant} defaultValue={["all"]}>
        <Toggle value="all">Everyone</Toggle>
        <Toggle value="mine">Mine</Toggle>
      </ToggleGroup>,
    ),
  );
  await nextFrame();
  const glass = indicator();
  const [all, mine] = buttons();
  expectAligned(all!);
  const start = glass.getBoundingClientRect().left;
  await act(() => mine!.click());
  expect(indicator()).toBe(glass);
  const transit = glass.getAnimations()[0]!;
  transit.pause();
  transit.currentTime = 60;
  expect(glass.getBoundingClientRect().left).toBeGreaterThan(start);
  expect(glass.getBoundingClientRect().left).toBeLessThan(mine!.getBoundingClientRect().left);
  transit.play();
  await finishMotion();
  expectAligned(mine!);
});

it.each(["liquid", "default", "segmented", "navigation"] as const)(
  "keeps %s multiple selection independent of the moving glass",
  async (variant) => {
    await act(() =>
      root.render(
        <ToggleGroup variant={variant} multiple defaultValue={["first"]}>
          <Toggle value="first">First</Toggle>
          <Toggle value="second">Second</Toggle>
        </ToggleGroup>,
      ),
    );
    const [first, second] = buttons();
    await act(() => second!.click());
    expect(first!.getAttribute("aria-pressed")).toBe("true");
    expect(second!.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector("[data-slot=liquid-indicator]")).toBeNull();
  },
);

it("moves one glass selection between unequal options and smoothly retargets a rapid switch", async () => {
  await render();
  const [everyone, mine] = buttons();
  expectAligned(everyone!);
  expect(indicator().getAnimations({ subtree: true })).toHaveLength(0);
  expect(getComputedStyle(everyone!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  const start = indicator().getBoundingClientRect().left;

  await act(() => mine!.click());
  const animation = indicator().getAnimations()[0]!;
  animation.pause();
  animation.currentTime = 60;
  const middle = indicator().getBoundingClientRect().left;
  expect(middle).toBeGreaterThan(start);
  expect(middle).toBeLessThan(mine!.getBoundingClientRect().left);

  await act(() => everyone!.click());
  const returning = indicator().getAnimations()[0]!;
  returning.pause();
  returning.currentTime = 0;
  expect(indicator().getBoundingClientRect().left).toBeCloseTo(middle, 0);
  returning.play();
  await finishMotion();
  expectAligned(everyone!);
  expect(indicator().getAnimations({ subtree: true })).toHaveLength(0);
});

it.each(["horizontal", "vertical"] as const)(
  "tracks %s layout, RTL, resizing and clearing a selection",
  async (orientation) => {
    await render(orientation, "rtl");
    const [everyone, mine, disabled] = buttons();
    await act(() => mine!.click());
    await finishMotion();
    expectAligned(mine!);
    await act(() => disabled!.click());
    expectAligned(mine!);

    everyone!.style.width = "240px";
    await nextFrame();
    expectAligned(mine!);
    await act(() => mine!.click());
    expect(getComputedStyle(indicator()).visibility).toBe("hidden");
    await act(() => everyone!.click());
    expectAligned(everyone!);
    expect(indicator().getAnimations({ subtree: true })).toHaveLength(0);
  },
);

it("keeps keyboard focus on the controls and settles immediately when reduced motion is enabled", async () => {
  await render();
  const [everyone, mine] = buttons();
  everyone!.focus();
  await act(() => userEvent.keyboard("{ArrowRight}{Enter}"));
  expect(document.activeElement).toBe(mine);
  expect(mine!.getAttribute("aria-pressed")).toBe("true");
  expect(indicator().getAnimations().length).toBeGreaterThan(0);

  Object.defineProperty(motionPreference, "matches", { value: true, configurable: true });
  motionPreference.dispatchEvent(new Event("change"));
  expectAligned(mine!);
  expect(indicator().getAnimations({ subtree: true })).toHaveLength(0);
  await act(() => everyone!.click());
  expectAligned(everyone!);
  expect(indicator().getAnimations({ subtree: true })).toHaveLength(0);
});
