import type { PeerWebPlugin } from "../slots.types";
import { AskMyAgent } from "./AskMyAgent";
import { RecipesSettings } from "./RecipesSettings";
export const recipesWebPlugin: PeerWebPlugin = {
  id: "recipes",
  taskContext: AskMyAgent,
  settings: RecipesSettings,
};
