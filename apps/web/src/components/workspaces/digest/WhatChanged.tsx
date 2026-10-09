import { windowLabel, type DigestWindow } from "@t3tools/client-runtime/peer-digest";
import { Button } from "../../ui/button";
export function WhatChanged({
  away,
  onChoose,
}: {
  away: boolean;
  onChoose: (choice: DigestWindow) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {([...(away ? ["away"] : []), "8h", "24h", "7d"] as DigestWindow[]).map((choice) => (
        <Button key={choice} size="xs" variant="ghost" onClick={() => onChoose(choice)}>
          {windowLabel(choice)}
        </Button>
      ))}
    </div>
  );
}
