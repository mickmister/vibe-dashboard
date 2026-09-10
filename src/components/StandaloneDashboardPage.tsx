import React from 'react';

export function StandaloneDashboardPage({
  children,
  className = '',
  contentClassName = 'mx-auto max-w-6xl space-y-5',
  'aria-label': ariaLabel,
}: {
  children?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  'aria-label'?: string;
}): React.ReactElement {
  return (
    <main
      aria-label={ariaLabel}
      data-testid="standalone-dashboard-page"
      className={`dark h-screen overflow-y-auto bg-zinc-950 p-6 text-zinc-100 ${className}`.trim()}
    >
      <div className={contentClassName}>{children}</div>
    </main>
  );
}
