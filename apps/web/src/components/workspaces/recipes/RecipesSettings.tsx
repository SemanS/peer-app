import { useEnvironmentQuery } from "../../../state/query";
import { serverEnvironment } from "../../../state/server";
import { useCopyToClipboard } from "../../../hooks/useCopyToClipboard";
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
    <section className="space-y-2">
      <h3 className="text-sm font-medium">Agent recipes · On</h3>
      <p className="text-xs text-muted-foreground">
        Claude Code with the Peer Mod uses /peer &lt;name&gt;. Codex gets the peer-recipes skill
        with Peer's hooks. MCP clients have the same recipes as prompts.
      </p>
      {query.data.recipes.map((r) => (
        <div key={r.name} className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm">
              {r.title}
              {r.access === "read" ? " · reads only" : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              peer recipe {r.name} · /peer {r.name}
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => copyToClipboard(`peer recipe ${r.name}`, undefined)}
          >
            Copy command
          </Button>
        </div>
      ))}
    </section>
  );
}
