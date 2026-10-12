import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";

import { cn } from "../lib/utils";
import { INLINE_MARKDOWN } from "./inlineMarkdown.logic";

const COMPONENTS = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
} satisfies Components;

/**
 * One line of markdown inside a row, list item or sentence: code spans, bold, emphasis and web
 * links, in the chat's own look, and no block of any kind (`inlineMarkdown.logic.ts`). It takes
 * none of the chat renderer's file, pull request or editor handling, so a page of lines stays cheap.
 */
export const InlineMarkdown = memo(function InlineMarkdown({
  text,
  className,
}: {
  readonly text: string;
  readonly className?: string;
}) {
  return (
    <span className={cn("chat-markdown break-words", className)}>
      <ReactMarkdown {...INLINE_MARKDOWN} components={COMPONENTS}>
        {text}
      </ReactMarkdown>
    </span>
  );
});
