import {
  forecastSections,
  forecastSide,
  forecastPairKey,
} from "@t3tools/client-runtime/peer-forecast";
import type { PeerSlotProps } from "../slots.types";
import { useForecast } from "./useForecast";
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
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
