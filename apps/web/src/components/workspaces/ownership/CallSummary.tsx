import { PopoverTitle } from "../../ui/popover";
import type { CallDetails } from "./ownerCall.logic";

/**
 * What a pending owner's call says, in a popover: who asked whom for what, the paths with who
 * decides each, the agent's words and when it ends. The task's page and the Team page both show
 * it, so the call reads the same wherever a member meets it.
 */
export function CallSummary({ details }: { readonly details: CallDetails }) {
  return (
    <>
      <PopoverTitle>{details.title}</PopoverTitle>
      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
        {details.paths.map(({ path, rule }) => (
          <li key={path} className="break-words">
            <span className="font-mono text-xs text-foreground">{path}</span>
            {rule === undefined ? null : ` · ${rule}`}
          </li>
        ))}
      </ul>
      <p className="text-sm break-words text-muted-foreground">{details.reason}</p>
      <p className="text-xs text-muted-foreground">{details.meta}</p>
    </>
  );
}
