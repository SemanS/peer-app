import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

import { PEER_MARK_PATHS } from "../../../../assets/peer/geometry";

const ThemedPath = withUniwind(Path);

export function PeerMark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  return (
    <Svg accessibilityLabel="Peer" height={props.height} width={props.height} viewBox="0 0 32 32">
      {PEER_MARK_PATHS.map((d) => (
        <ThemedPath
          key={d}
          d={d}
          color={props.color}
          colorClassName={props.colorClassName}
          fill="currentColor"
        />
      ))}
    </Svg>
  );
}
