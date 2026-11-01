import { Suspense } from "react";
import { render } from "../../../test/render";
import { describe, expect, it, vi } from "vite-plus/test";

import { MermaidDiagram } from "./MermaidDiagram";

async function renderDiagram(source: string, theme: "light" | "dark") {
  const container = document.createElement("div");
  container.classList.toggle("dark", theme === "dark");
  const screen = await render(
    <Suspense fallback={<p>Loading diagram</p>}>
      <MermaidDiagram source={source} onExpand={() => {}} />
    </Suspense>,
    { container },
  );
  await vi.waitFor(() => expect(container.textContent).not.toContain("Loading diagram"));
  return screen;
}

describe("Mermaid dependency compatibility", () => {
  it.each(["light", "dark"] as const)("renders flowcharts in %s mode", async (theme) => {
    await using screen = await renderDiagram('graph TD; A["Start"] --> B["Complete"]', theme);
    expect(screen.container.querySelector("svg")).not.toBeNull();
    expect(screen.container.textContent).toContain("Start");
    expect(screen.container.textContent).toContain("Complete");
    expect(screen.container.querySelector("script, a, img, image, [href], [src]")).toBeNull();
  });

  it.each(["light", "dark"] as const)(
    "renders sequence diagrams and math in %s mode",
    async (theme) => {
      await using screen = await renderDiagram("sequenceDiagram\nA->>B: $$x^2+1$$ Complete", theme);
      expect(screen.container.querySelector("svg")).not.toBeNull();
      expect(screen.container.textContent).toContain("Complete");
      expect(screen.container.querySelector(".katex")).not.toBeNull();
      expect(screen.container.querySelector("script, a, img, image, [href], [src]")).toBeNull();
    },
  );

  it("shows invalid source without leaving Mermaid's temporary error SVG", async () => {
    const source = "graph TD; A[unterminated";
    await using screen = await renderDiagram(source, "light");
    expect(screen.container.textContent).toContain("Unable to render diagram");
    expect(screen.container.querySelector("pre")?.textContent).toBe(source);
    expect(document.querySelector('svg[id^="mermaid-diagram-"]')).toBeNull();
  });
});
