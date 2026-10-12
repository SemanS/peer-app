/**
 * The markdown of one line of text, as agents write a handoff line: code spans, emphasis, bold and
 * links read as such, and nothing starts a block (a heading, a list, a quote, a fence), so the line
 * stays one line of text in whatever row it sits in. `InlineMarkdown` renders it.
 */
import type { Options } from "react-markdown";
import type { Processor } from "unified";

/**
 * Parses text as inline content only: a leading `1.`, `>` or `[a]:` stays as written instead of
 * becoming a list, a quote or a definition that renders nothing.
 */
function remarkInlineOnly(this: Processor) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({
    disable: {
      null: [
        "blockQuote",
        "codeFenced",
        "codeIndented",
        "definition",
        "headingAtx",
        "list",
        "setextUnderline",
        "thematicBreak",
      ],
    },
  });
}

const LINKABLE = /^(?:https?:\/\/|mailto:)/i;

/** The address a link in a line may open: a web page or a mail address, never a path in this app. */
export const inlineLinkHref = (href: unknown): string | null =>
  typeof href === "string" && LINKABLE.test(href) ? href : null;

/**
 * What `ReactMarkdown` takes to render a line inline. Anything else it might produce (an image,
 * the text of raw HTML aside) is unwrapped to its text, and a link to nothing a browser opens is
 * its text alone.
 */
export const INLINE_MARKDOWN = {
  remarkPlugins: [remarkInlineOnly],
  allowedElements: ["a", "code", "em", "strong"],
  allowElement: (element) =>
    element.tagName !== "a" || inlineLinkHref(element.properties.href) !== null,
  unwrapDisallowed: true,
} satisfies Options;
