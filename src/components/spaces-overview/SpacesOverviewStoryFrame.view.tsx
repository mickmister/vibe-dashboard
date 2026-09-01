import type { ReactNode } from "react";

export function SpacesOverviewStoryFrame({ children }: { children: ReactNode }) {
  return (
    <div className="h-[760px] w-full overflow-hidden bg-zinc-900">
      {children}
    </div>
  );
}
