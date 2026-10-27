import { ListTodoIcon } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import { ITEM_ICON_CLASS } from "../CommandPalette.logic";
import { taskSearchItems } from "./taskSearch.logic";
import { useWorkData } from "./useWorkData";
import { useWorkScope } from "./workScope";

export function useTaskSearchItems() {
  const { tree, needs, status } = useWorkData();
  const [scope] = useWorkScope();
  const navigate = useNavigate();
  return taskSearchItems({
    tree,
    needs,
    me: status?.email ?? null,
    scope,
    icon: <ListTodoIcon className={ITEM_ICON_CLASS} />,
    open: async (params) => {
      await navigate({ to: "/task/$workspace/$project/$task", params });
    },
  });
}
