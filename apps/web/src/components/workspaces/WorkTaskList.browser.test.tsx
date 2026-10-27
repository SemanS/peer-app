import "../../index.css";

import { ALL_PROJECTS, taskCards } from "@t3tools/client-runtime/peer/work";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import { ANA, workProject } from "./ownership/ownership.testkit";
import { WorkTaskList } from "./WorkTaskList";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

const nextFrame = () =>
  act(() => new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0))));

it("keeps long task names readable in a narrow pane and never scrolls sideways", async () => {
  const cards = taskCards([workProject(ANA)], {
    scope: ALL_PROJECTS,
    mine: false,
    query: "",
    needs: [],
    me: ANA,
  });
  const card = cards.find((candidate) => candidate.kind === "task");
  if (card?.kind !== "task") throw new Error("Expected a task fixture");
  const title = "Review workspace navigation and preserve keyboard access in every narrow panel";
  container.style.width = "280px";
  await act(async () => {
    root.render(
      <WorkTaskList
        cards={[{ ...card, task: { ...card.task, title } }]}
        scope={ALL_PROJECTS}
        tab="active"
        onTab={() => {}}
        onOpen={() => {}}
        onShowNeeds={() => {}}
      />,
    );
  });
  await nextFrame();

  const titleButton = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === title,
  )!;
  expect(titleButton.checkVisibility()).toBe(true);
  expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
  expect(titleButton.scrollHeight).toBeLessThanOrEqual(titleButton.clientHeight);

  container.style.width = "1100px";
  await nextFrame();
  expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
  // One compact line for the title on a wide pane.
  expect(titleButton.clientHeight).toBeLessThan(30);
});
