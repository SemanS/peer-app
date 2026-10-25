import type { ListItem, Paragraph, Root, RootContent } from "mdast";

function checklistItems(nodes: ReadonlyArray<RootContent>): ListItem[] {
  return nodes.flatMap((node) => {
    if (node.type === "list") {
      return node.children.flatMap((item) =>
        typeof item.checked === "boolean" ? [item] : checklistItems(item.children),
      );
    }
    return node.type === "blockquote" ? checklistItems(node.children) : [];
  });
}

function referenceDefinitions(nodes: ReadonlyArray<RootContent>): RootContent[] {
  return nodes.flatMap((node): RootContent[] => {
    if (node.type === "definition" || node.type === "footnoteDefinition") return [node];
    if (node.type === "list") {
      return node.children.flatMap((item) => referenceDefinitions(item.children));
    }
    return node.type === "blockquote" ? referenceDefinitions(node.children) : [];
  });
}

function separateVerification(paragraph: Paragraph): Paragraph[] {
  for (const [index, child] of paragraph.children.entries()) {
    if (child.type !== "text") continue;
    const boundary = /;\s+(?=verify\b)/i.exec(child.value);
    if (boundary === null) continue;
    const after = boundary.index + boundary[0].length;
    return [
      {
        type: "paragraph",
        children: [
          ...paragraph.children.slice(0, index),
          { ...child, value: child.value.slice(0, boundary.index + 1) },
        ],
      },
      {
        type: "paragraph",
        children: [
          {
            type: "strong",
            children: [{ type: "text", value: child.value.slice(after, after + 6) }],
          },
          { ...child, value: child.value.slice(after + 6) },
          ...paragraph.children.slice(index + 1),
        ],
      },
    ];
  }
  return [paragraph];
}

/** The preview keeps task text intact; the complete document remains available separately. */
export function remarkChecklistPreview() {
  return (tree: Root) => {
    const items = checklistItems(tree.children);
    if (items.length === 0) return;
    tree.children = [
      ...referenceDefinitions(tree.children),
      {
        type: "list",
        ordered: false,
        spread: true,
        children: items.map((item) => ({
          ...item,
          spread: true,
          children: item.children.flatMap<ListItem["children"][number]>((child) =>
            child.type === "paragraph" ? separateVerification(child) : [child],
          ),
        })),
      },
    ];
  };
}
