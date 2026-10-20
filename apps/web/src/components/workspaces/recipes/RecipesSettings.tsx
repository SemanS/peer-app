import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
import { SettingsRow } from "../../settings/settingsLayout";
import { Button } from "../../ui/button";
import type { PeerSlotProps } from "../slots.types";
export function RecipesSettings({ environmentId, status }: PeerSlotProps) {
  const query = useEnvironmentQuery(
    serverEnvironment.peerRecipes.list({
      environmentId,
      input: { revision: JSON.stringify(status.plugins) },
    }),
  );
  const { copyToClipboard } = useCopyToClipboard<void>({ target: "recipe command" });
  if (query.error || !query.data?.enabled || !query.data.recipes.length) return null;
  return (
    <SettingsRow
      title="Agent recipes"
      description="Claude Code and Codex use peer recipe <name>. Codex also gets the peer-recipes skill with Peer’s hooks. MCP clients have the same recipes as prompts."
    >
      <ul className="flex flex-col pt-1 pb-2">
        {query.data.recipes.map((r) => (
          <li key={r.name} className="flex items-center justify-between gap-3 py-1.5">
            <div className="min-w-0">
              <p className="text-sm">
                {r.title}
                {r.access === "read" ? (
                  <span className="text-muted-foreground"> · reads only</span>
                ) : null}
              </p>
              <p className="truncate text-xs text-muted-foreground">peer recipe {r.name}</p>
            </div>
            <Button
              variant="outline"
              size="xs"
              aria-label={`Copy the command for ${r.title}`}
              onClick={() => copyToClipboard(`peer recipe ${r.name}`, undefined)}
            >
              Copy command
            </Button>
          </li>
        ))}
      </ul>
    </SettingsRow>
  );
}
