import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * An address under `/settings/peer` that names no page (a section left off, say) opens the area's
 * front door. A splat also matches what is left when nothing is, so `/settings/peer` itself lands
 * here too and must stay: the layout answers it.
 */
export const Route = createFileRoute("/settings/peer/$")({
  beforeLoad: ({ params }) => {
    if (params._splat !== undefined && params._splat !== "") {
      throw redirect({ to: "/settings/peer", replace: true });
    }
  },
});
