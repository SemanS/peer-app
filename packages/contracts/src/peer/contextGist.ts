/** One summary rule for authority snapshots and their derived views. */
export function contextGist(text: string, explicit?: string | null): string | undefined {
  const clean = text.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) =>
    comment.replace(/[^\r\n]/g, ""),
  );
  const lines = clean.split(/\r?\n/).map((line) => line.trim());
  const inline = lines.find((line) => /^gist:\s*\S/i.test(line))?.replace(/^gist:\s*/i, "");
  const heading = lines.findIndex((line) => /^#{1,6}\s+gist\s*$/i.test(line));
  const afterHeading = heading < 0 ? [] : lines.slice(heading + 1);
  const nextHeading = afterHeading.findIndex((line) => line.startsWith("#"));
  const section = (nextHeading < 0 ? afterHeading : afterHeading.slice(0, nextHeading)).find(
    (line) => line !== "",
  );
  const fallback = lines.find((line) => line !== "" && !line.startsWith("#"));
  const gist = (explicit?.trim() || inline || section || fallback)?.replace(/^[-*+> ]+/, "").trim();
  return gist ? Array.from(gist).slice(0, 160).join("") : undefined;
}
