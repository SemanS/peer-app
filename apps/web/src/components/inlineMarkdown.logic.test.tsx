import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vite-plus/test";

import { INLINE_MARKDOWN, inlineLinkHref } from "./inlineMarkdown.logic";

function render(markdown: string): string {
  return renderToStaticMarkup(<ReactMarkdown {...INLINE_MARKDOWN}>{markdown}</ReactMarkdown>);
}

describe("inline markdown", () => {
  it("shows a code span without its backticks, and bold, emphasis and links in the line", () => {
    expect(
      render(
        "`src/print/receipt.ts` prints the **header** above *the notes*, see [docs](https://example.com)",
      ),
    ).toBe(
      '<code>src/print/receipt.ts</code> prints the <strong>header</strong> above <em>the notes</em>, see <a href="https://example.com">docs</a>',
    );
  });

  it("starts no block, so a line stays as the agent wrote it", () => {
    expect(render("1. first")).toBe("1. first");
    expect(render("# Not a heading")).toBe("# Not a heading");
    expect(render("> quoted")).toBe("&gt; quoted");
    expect(render("[project]: not a definition")).toBe("[project]: not a definition");
    expect(render("---")).toBe("---");
    expect(render("```ts```")).toBe("<code>ts</code>");
    expect(render("    indented")).toBe("indented");
  });

  it("shows raw HTML as text", () => {
    expect(render("<script>alert(1)</script> ok")).toBe("&lt;script&gt;alert(1)&lt;/script&gt; ok");
  });

  it("links only to web pages and mail addresses", () => {
    expect(render("[ok](https://example.com/a?b=c#d) and <https://example.com>")).toBe(
      '<a href="https://example.com/a?b=c#d">ok</a> and <a href="https://example.com">https://example.com</a>',
    );
    expect(render("[go](/work) or [here](#top) or [x](javascript:alert(1))")).toBe(
      "go or here or x",
    );
    expect(inlineLinkHref("mailto:ana@example.com")).toBe("mailto:ana@example.com");
    expect(inlineLinkHref("/work")).toBeNull();
    expect(inlineLinkHref(undefined)).toBeNull();
  });

  it("drops an image rather than draw one in a line", () => {
    expect(render("see ![diagram](https://example.com/a.png) here")).toBe("see  here");
  });
});
