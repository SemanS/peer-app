import type { SVGProps } from "react";

import { PEER_MARK_PATHS } from "../../../../assets/peer/geometry";
import { cn } from "../lib/utils";

export function PeerMark({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      aria-hidden="true"
      {...props}
      className={cn("size-6 shrink-0", className)}
      viewBox="0 0 32 32"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      {PEER_MARK_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
