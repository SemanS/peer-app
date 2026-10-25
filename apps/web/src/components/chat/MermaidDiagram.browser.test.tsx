import { Suspense, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { MermaidDiagram } from "./MermaidDiagram";

const roots: Root[] = [];

beforeEach(() => vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true));
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

async function render(source: string, theme: "light" | "dark") {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  await act(async () => {
    root.render(
      <Suspense fallback={<p>Loading diagram</p>}>
        <MermaidDiagram source={source} theme={theme} onExpand={() => {}} />
      </Suspense>,
    );
  });
  await vi.waitFor(() => expect(container.textContent).not.toContain("Loading diagram"));
  return container;
}

describe("Mermaid dependency compatibility", () => {
  it.each(["light", "dark"] as const)("renders flowcharts in %s mode", async (theme) => {
    const container = await render('graph TD; A["Start"] --> B["Complete"]', theme);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.textContent).toContain("Start");
    expect(container.textContent).toContain("Complete");
    expect(container.querySelector("script, a, img, image, [href], [src]")).toBeNull();
  });

  it.each(["light", "dark"] as const)(
    "renders sequence diagrams and math in %s mode",
    async (theme) => {
      const container = await render("sequenceDiagram\nA->>B: $$x^2+1$$ Complete", theme);
      expect(container.querySelector("svg")).not.toBeNull();
      expect(container.textContent).toContain("Complete");
      expect(container.querySelector(".katex")).not.toBeNull();
      expect(container.querySelector("script, a, img, image, [href], [src]")).toBeNull();
    },
  );

  it("shows invalid source without leaving Mermaid's temporary error SVG", async () => {
    const source = "graph TD; A[unterminated";
    const container = await render(source, "light");
    expect(container.textContent).toContain("Unable to render diagram");
    expect(container.querySelector("pre")?.textContent).toBe(source);
    expect(document.querySelector('svg[id^="mermaid-diagram-"]')).toBeNull();
  });
});
