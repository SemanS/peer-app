import {
  type ProviderApprovalDecision,
  type ProviderApprovalOption,
  type RuntimeRequestId,
} from "@t3tools/contracts";
import { memo, useState } from "react";
import { EllipsisIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { DenyWithNoteDialog } from "../workspaces/approval/DenyWithNoteDialog";
import { composerFloatingLayerProps } from "./composerEventScope";

interface ComposerPendingApprovalActionsProps {
  requestId: RuntimeRequestId;
  isResponding: boolean;
  canRespond: boolean;
  disabled?: boolean;
  options?: ReadonlyArray<ProviderApprovalOption> | undefined;
  onRespondToApproval: (
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
  /** Declines and sends the person's note as their next message (Peer workspace projects). */
  onDenyWithNote?: ((requestId: RuntimeRequestId, note: string) => Promise<void>) | undefined;
}

const DEFAULT_APPROVAL_OPTIONS = [
  { decision: "cancel", label: "Cancel" },
  { decision: "decline", label: "Decline" },
  { decision: "acceptForSession", label: "Always allow this session" },
  { decision: "accept", label: "Approve" },
] satisfies ReadonlyArray<ProviderApprovalOption>;

export const ComposerPendingApprovalActions = memo(function ComposerPendingApprovalActions({
  requestId,
  isResponding,
  canRespond,
  disabled = false,
  options = DEFAULT_APPROVAL_OPTIONS,
  onRespondToApproval,
  onDenyWithNote,
}: ComposerPendingApprovalActionsProps) {
  const [denying, setDenying] = useState(false);
  const canDecline = options.some((option) => option.decision === "decline");
  const primaryOptions = options.filter(
    (option) => option.decision === "decline" || option.decision === "accept",
  );
  const moreOptions = options.filter(
    (option) => option.decision !== "decline" && option.decision !== "accept",
  );

  return (
    <>
      {primaryOptions.map((option) => {
        const button = (
          <Button
            key={option.decision}
            size="xs"
            variant={option.decision === "accept" ? "default" : "outline"}
            disabled={disabled || isResponding || !canRespond}
            aria-description={option.warning}
            onClick={() => {
              if (!disabled && !isResponding) {
                void onRespondToApproval(requestId, option.decision);
              }
            }}
          >
            {option.warning ? <TriangleAlertIcon className="size-3 shrink-0" /> : null}
            <span className="max-w-40 truncate">{option.label}</span>
          </Button>
        );
        return option.warning ? (
          <Tooltip key={option.decision}>
            <TooltipTrigger render={button} />
            <TooltipPopup side="top">{option.warning}</TooltipPopup>
          </Tooltip>
        ) : (
          button
        );
      })}
      {moreOptions.length > 0 || (onDenyWithNote !== undefined && canDecline) ? (
        <Menu>
          <MenuTrigger
            disabled={disabled || isResponding}
            render={<Button size="icon-xs" variant="outline" aria-label="More approval options" />}
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup {...composerFloatingLayerProps} side="top" align="end">
            {moreOptions.map((option) => {
              const item = (
                <MenuItem
                  key={option.decision}
                  disabled={disabled || isResponding}
                  aria-description={option.warning}
                  onClick={() => {
                    if (!disabled && !isResponding)
                      void onRespondToApproval(requestId, option.decision);
                  }}
                  variant="ghost"
                  className="mb-1 last:mb-0"
                >
                  {option.warning ? <TriangleAlertIcon className="size-3 text-warning" /> : null}
                  <span className="min-w-0 whitespace-normal wrap-break-word">{option.label}</span>
                </MenuItem>
              );
              return option.warning ? (
                <Tooltip key={option.decision}>
                  <TooltipTrigger render={item} />
                  <TooltipPopup side="top">{option.warning}</TooltipPopup>
                </Tooltip>
              ) : (
                item
              );
            })}
            {onDenyWithNote !== undefined && canDecline ? (
              <MenuItem
                disabled={isResponding || !canRespond}
                onClick={() => setDenying(true)}
                variant="ghost"
                className="mb-1 last:mb-0"
              >
                <span className="min-w-0 whitespace-normal wrap-break-word">Deny with a note…</span>
              </MenuItem>
            ) : null}
          </MenuPopup>
        </Menu>
      ) : null}
      {onDenyWithNote === undefined ? null : (
        <DenyWithNoteDialog
          open={denying}
          onOpenChange={setDenying}
          onDeny={(note) => onDenyWithNote(requestId, note)}
        />
      )}
    </>
  );
});
