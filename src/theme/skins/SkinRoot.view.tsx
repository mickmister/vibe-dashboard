import type { ReactNode } from "react";
import type { VDSkinRuntimeState } from "./runtime";

export interface SkinRootViewProps {
  children?: ReactNode;
  className?: string;
  runtime: VDSkinRuntimeState;
}

export function SkinRootView({ children, className, runtime }: SkinRootViewProps) {
  return (
    <div
      className={className}
      data-vd-density={runtime.densityScale}
      data-vd-skin-id={runtime.skin.id}
      data-vd-skin-root
      data-vd-skin-source={runtime.source}
      style={runtime.style}
    >
      {children}
    </div>
  );
}
