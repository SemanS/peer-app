import { memo } from "react";
import type { TaskForecast } from "@t3tools/client-runtime/peer-forecast";
import { Badge } from "../../ui/badge";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../../ui/tooltip";
import type { TaskSlotProps } from "../slots.types";
import { useForecast } from "./useForecast";
const Detail = memo(function Detail({ value }: { readonly value: TaskForecast | undefined }) {
  return value === undefined ? null : (
    <Tooltip>
      <TooltipTrigger
        aria-label={`${value.count} predicted merge conflicts`}
        render={<button type="button" onClick={(event) => event.stopPropagation()} />}
      >
        <Badge variant="coordination" size="sm">
          {value.count} predicted
        </Badge>
      </TooltipTrigger>
      <TooltipPopup>
        {value.lines.map((line) => (
          <p key={line}>{line}</p>
        ))}
      </TooltipPopup>
    </Tooltip>
  );
});
export function ForecastTaskBadge({
  environmentId,
  status,
  workspace,
  project,
  task,
}: TaskSlotProps) {
  const { tasks } = useForecast(environmentId, status);
  return (
    <Detail
      value={
        project === undefined
          ? undefined
          : tasks.get(`${workspace}/${project.project.id}/${task.id}`)
      }
    />
  );
}
