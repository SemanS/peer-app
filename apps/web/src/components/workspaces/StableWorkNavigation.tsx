import { useAtomValue } from "@effect/atom-react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { ListIcon, SearchIcon } from "lucide-react";

import { openCommandPalette } from "../../commandPaletteBus";
import { shortcutLabelForCommand } from "../../keybindings";
import { primaryServerKeybindingsAtom } from "../../state/server";
import { Button } from "../ui/button";
import { useSidebar } from "../ui/sidebar";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** Search and the Feed: what holds for every project, beside the project they start from. */
export function SidebarTools({ scope }: { readonly scope: string }) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const onFeed = useLocation({ select: (location) => location.pathname === "/work" });
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const shortcut = shortcutLabelForCommand(keybindings, "commandPalette.toggle");
  return (
    <div className="flex shrink-0 items-center" role="navigation" aria-label="Peer navigation">
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Search"
              onClick={() => openCommandPalette()}
            />
          }
        >
          <SearchIcon aria-hidden />
        </TooltipTrigger>
        <TooltipPopup side="bottom">
          {shortcut === null ? "Search" : `Search ${shortcut}`}
        </TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              size="icon-xs"
              variant="ghost-muted"
              aria-label="Feed"
              aria-current={onFeed ? "page" : undefined}
              onClick={() => {
                if (isMobile) setOpenMobile(false);
                void navigate({ to: "/work", search: { scope } });
              }}
            />
          }
        >
          <ListIcon aria-hidden />
        </TooltipTrigger>
        <TooltipPopup side="bottom">Feed</TooltipPopup>
      </Tooltip>
    </div>
  );
}
