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

it("keeps long task names readable in narrow panes and switches to columns when space permits", async () => {
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
        onShowBoard={() => {}}
      />,
    );
  });
  await nextFrame();

  const list = container.querySelector<HTMLUListElement>('ul[aria-label="Tasks"]')!;
  const table = container.querySelector<HTMLElement>('[role="table"]')!;
  const row = list.querySelector("button")!;
  expect(list.checkVisibility()).toBe(true);
  expect(table.checkVisibility()).toBe(false);
  expect(row.textContent).toContain(title);
  expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
  const titleElement = [...row.children].find((child) => child.textContent === title)!;
  expect(titleElement.scrollHeight).toBeLessThanOrEqual(titleElement.clientHeight);
  expect(titleElement.clientHeight).toBeGreaterThan(30);

  container.style.width = "1100px";
  await nextFrame();
  expect(list.checkVisibility()).toBe(false);
  expect(table.checkVisibility()).toBe(true);
  expect(container.scrollWidth).toBeLessThanOrEqual(container.clientWidth);
});
