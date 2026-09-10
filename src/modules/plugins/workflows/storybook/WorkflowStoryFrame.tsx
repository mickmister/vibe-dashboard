import React from 'react';

export function WorkflowStoryFrame({
  children,
  title,
  description,
  height = 'auto',
}: {
  children: React.ReactNode;
  title?: string;
  description?: string;
  height?: string;
}): React.ReactElement {
  return (
    <div
      className="h-screen overflow-y-auto overscroll-contain bg-slate-950 p-6 text-zinc-100"
      data-workflow-story-scroll-root
      style={{ minHeight: height }}
    >
      {title || description ? (
        <header className="mx-auto mb-5 max-w-7xl rounded-xl border border-slate-800 bg-slate-900/70 p-4">
          {title ? <h1 className="text-xl font-semibold text-zinc-50">{title}</h1> : null}
          {description ? <p className="mt-2 text-sm leading-6 text-zinc-300">{description}</p> : null}
        </header>
      ) : null}
      {children}
    </div>
  );
}

export function StorybookVisualQaNotes({
  items,
}: {
  items: Array<{ label: string; status: 'covered' | 'watch' | 'later'; note: string }>;
}): React.ReactElement {
  return (
    <section className="mx-auto max-w-7xl rounded-xl border border-slate-800 bg-slate-900/70 p-5">
      <h2 className="text-lg font-semibold">M112 visual QA notes</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {items.map((item) => (
          <article key={item.label} className="rounded-lg border border-slate-800 bg-slate-950 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-medium">{item.label}</h3>
              <span className={badgeClass(item.status)}>{item.status}</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-zinc-300">{item.note}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function badgeClass(status: 'covered' | 'watch' | 'later'): string {
  if (status === 'covered') return 'rounded-full border border-emerald-800 bg-emerald-950/40 px-2 py-0.5 text-xs text-emerald-200';
  if (status === 'watch') return 'rounded-full border border-amber-800 bg-amber-950/40 px-2 py-0.5 text-xs text-amber-200';
  return 'rounded-full border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-300';
}
