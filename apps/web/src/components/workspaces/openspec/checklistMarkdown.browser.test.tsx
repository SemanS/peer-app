import { act } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { expect, it } from "vite-plus/test";

import { remarkChecklistPreview } from "./checklistMarkdown";

async function preview(text: string, check: (container: HTMLDivElement) => void) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => {
      root.render(
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkChecklistPreview]}>{text}</ReactMarkdown>,
      );
    });
    check(container);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
}

it("keeps task states, inline code, links, nested tasks and supporting notes, excluding document repetition and fenced examples", async () => {
  await preview(
    "# Repeated title\n\nBaseline text.\n\n" +
      "- [x] Keep `literal; verify code`, [the source](https://example.test), [the guide][guide] and notes[^1].\n" +
      "  - [ ] Nested work\n\n  Supporting note.\n\n" +
      "```md\n- [ ] Example only\n```\n\n" +
      "- [ ] Add the option; verify the backend receives **no discovery** requests.\n\n" +
      "## Validation\n\nFull validation guidance.\n\n" +
      "[guide]: https://docs.example.test\n\n[^1]: A source footnote.\n",
    (container) => {
      const checkboxes = [
        ...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
      ];
      expect(checkboxes.map((checkbox) => checkbox.checked)).toEqual([true, false, false]);
      expect(container.querySelector("code")?.textContent).toBe("literal; verify code");
      expect(container.querySelector("a")?.href).toBe("https://example.test/");
      expect(container.querySelector('a[href="https://docs.example.test"]')?.textContent).toBe(
        "the guide",
      );
      expect(container.textContent).toContain("A source footnote.");
      expect(container.textContent).toContain("Supporting note.");
      expect(container.textContent).toContain("Nested work");
      expect(container.textContent).not.toContain("Repeated title");
      expect(container.textContent).not.toContain("Example only");
      expect(container.textContent).not.toContain("Baseline text");
      expect(container.querySelector("li:last-child > p:last-child")?.textContent).toBe(
        "verify the backend receives no discovery requests.",
      );
    },
  );
});

it("preserves the document when it contains no task list", async () => {
  await preview("## Remaining work\n\n- Add the option\n- Check the backend", (container) => {
    expect(container.textContent).toContain("Remaining work");
    expect(container.textContent).toContain("Add the option");
    expect(container.textContent).toContain("Check the backend");
  });
});
