import { plain } from "../../peerText.ts";
import { repositoryPath, symbolName } from "./client/codegraph.ts";
export type ProvidedEntry = { name: string; path?: string; contract: string };
const safe = (text: string, max: number) => plain(text, max).replaceAll("`", "'");
export function parseProvides(text: string): ProvidedEntry[] {
  const result: ProvidedEntry[] = [];
  let section = false;
  for (const line of text.slice(0, 64 * 1024).split("\n")) {
    if (/^##\s+/.test(line)) {
      section = /^##\s+Provides\s*$/i.test(line);
      continue;
    }
    if (!section) continue;
    const m = /^\s*-\s+`([^`]+)`(?:\s+\(([^)]+)\))?\s*:\s*(.+)$/.exec(line);
    if (!m || !symbolName(m[1]!) || (m[2] !== undefined && !repositoryPath(m[2]))) continue;
    if (result.length < 20)
      result.push({
        name: m[1]!,
        ...(m[2] === undefined ? {} : { path: m[2] }),
        contract: safe(m[3]!, 300),
      });
  }
  return result;
}
