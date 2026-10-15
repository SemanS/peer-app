import {
  forecastAge,
  forecastSections,
  forecastSide,
  forecastPairKey,
} from "@t3tools/client-runtime/peer-forecast";
import { useRelativeTimeTick } from "../../settings/settingsLayout";
import type { PeerSlotProps } from "../slots.types";
import { useForecast } from "./useForecast";
/** When the pair was last merged, kept current while the section is on screen. */
function CheckedAge({ at }: { readonly at: string }) {
  const now = useRelativeTimeTick(30_000);
  return <>Checked {forecastAge(at, now)}.</>;
}
export function PredictedConflicts({ environmentId, status }: PeerSlotProps) {
  const { value } = useForecast(environmentId, status),
    sections = forecastSections(value);
  if (sections.length === 0) return null;
  return (
    <section aria-label="Predicted merge conflicts" className="space-y-2">
      <h3 className="text-sm font-medium">Predicted merge conflicts</h3>
      <p className="text-xs text-muted-foreground">Advice from committed tips.</p>
      {sections.map((section) => (
        <div key={section.project ?? "pairs"} className="space-y-2">
          {section.project ? <h4>{section.project}</h4> : null}
          {section.pairs.map((pair) => (
            <div key={forecastPairKey(pair)} className="text-xs">
              <p>
                {forecastSide(pair.a, status.email)} ↔ {forecastSide(pair.b, status.email)}
              </p>
              <p>
                {pair.files.join(", ")}
                {pair.more ? ` and ${pair.more} more files` : ""}
              </p>
              <p className="text-muted-foreground">
                <CheckedAge at={pair.checkedAt} />
              </p>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
