import type { ReactNode } from "react";
import { SkinRootView } from "./SkinRoot.view";
import { getSkinRuntimeState, type VDSkinRuntimeOptions } from "./runtime";

export interface SkinRootProps extends VDSkinRuntimeOptions {
  children?: ReactNode;
  className?: string;
}

export function SkinRoot({ children, className, ...options }: SkinRootProps) {
  const runtime = getSkinRuntimeState(options);
  return (
    <SkinRootView className={className} runtime={runtime}>
      {children}
    </SkinRootView>
  );
}
