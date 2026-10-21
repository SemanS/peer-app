import LiquidGlass from "liquid-glass-react";

const restingPointer = { x: 0, y: 0 };

/** The optical layer moves below the controls; their text and hit targets stay still. */
export function LiquidGlassMaterial() {
  return (
    <span
      data-slot="liquid-glass-material"
      className="peer-liquid-material absolute inset-0 rounded-[inherit]"
    >
      <span className="peer-liquid-optics absolute inset-0 rounded-[inherit]">
        <LiquidGlass
          displacementScale={24}
          blurAmount={0.025}
          saturation={115}
          aberrationIntensity={0.8}
          elasticity={0}
          cornerRadius={999}
          padding="0px"
          globalMousePos={restingPointer}
          mouseOffset={restingPointer}
        >
          <span />
        </LiquidGlass>
      </span>
    </span>
  );
}
