/**
 * What the agents wrote when they settled the overlap, quoted the way a teammate's words are: plain
 * text, wrapped, never markup. Their words are a person's to read; nothing renders them as HTML or
 * markdown.
 */
export function AgreementWords({ words }: { readonly words: string }) {
  return (
    <blockquote className="min-w-0 border-s-2 border-border ps-2.5 text-sm break-words whitespace-pre-wrap text-foreground">
      {words}
    </blockquote>
  );
}
