import type { Meta, StoryObj } from '@storybook/react-vite';

type Tone = 'blue' | 'emerald' | 'amber' | 'rose' | 'violet' | 'zinc';

type WorkItem = {
  title: string;
  meta: string;
  status: string;
  tone: Tone;
};

type FocusCard = {
  label: string;
  value: string;
  caption: string;
  tone: Tone;
};

type DesignDirection =
  | 'vscode'
  | 'light'
  | 'premium'
  | 'enterprise';

type ColorScheme = 'direction' | DesignDirection;
type FontStyle = 'interfaceSans' | 'terminalMono' | 'compactSans' | 'largeDisplay';

type DashboardConceptArgs = {
  direction: DesignDirection;
  colorScheme: ColorScheme;
  fontStyle: FontStyle;
  eyebrow: string;
  title: string;
  subtitle: string;
};

type DashboardConceptTheme = Record<string, string>;

const focusCards: FocusCard[] = [
  {
    label: 'Needs attention',
    value: '3',
    caption: 'approval, CI, unread agent turn',
    tone: 'amber',
  },
  {
    label: 'Running',
    value: '2',
    caption: 'dev servers ready to open',
    tone: 'emerald',
  },
  {
    label: 'Saved filters',
    value: '5',
    caption: 'kanban views for this week',
    tone: 'blue',
  },
];

const workItems: WorkItem[] = [
  {
    title: 'Auth bug fix',
    meta: 'Vibe Dashboard · vk/story-auth-bug',
    status: 'Waiting for approval',
    tone: 'amber',
  },
  {
    title: 'Kanban polish',
    meta: 'Vibe Kanban · saved filter: Mine in review',
    status: 'Open craft',
    tone: 'blue',
  },
  {
    title: 'Docs refresh',
    meta: 'Vibe Dashboard · workflow: review loop',
    status: 'Ready to resume',
    tone: 'emerald',
  },
];

const workflowRows = [
  ['Design review', 'Review requested', '12 min ago'],
  ['CI wait workflow', 'Running', '24 min ago'],
  ['Human approval workflow', 'Blocked on form', '1h ago'],
];

const savedFilters = [
  'Mine with approvals',
  'Open PRs',
  'Running dev servers',
  'Workflow blocked',
  'Kanban review lane',
];

const meta: Meta<typeof DashboardConcept> = {
  title: 'Design Directions/Spaces Overview',
  component: DashboardConcept,
  args: {
    colorScheme: 'direction',
    fontStyle: 'interfaceSans',
  },
  argTypes: {
    colorScheme: {
      control: 'select',
      options: ['direction', 'vscode', 'light', 'premium', 'enterprise'],
      description:
        'Preview a different skin/color scheme while keeping the selected concept copy.',
    },
    fontStyle: {
      control: 'select',
      options: ['interfaceSans', 'terminalMono', 'compactSans', 'largeDisplay'],
      description: 'Preview the dashboard concept with alternate typography styles.',
    },
    direction: {
      control: 'select',
      options: ['vscode', 'light', 'premium', 'enterprise'],
      table: {
        disable: true,
      },
    },
    eyebrow: {
      control: 'text',
    },
    title: {
      control: 'text',
    },
    subtitle: {
      control: 'text',
    },
  },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Storybook-only static dashboard concepts for VD Redesign 2. These intentionally preview visual directions without changing runtime behavior.',
      },
    },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const VSCodeAdjacentDark: Story = {
  args: {
    direction: 'vscode',
    eyebrow: 'VS Code adjacent',
    title: 'Start with the work that matters',
    subtitle:
      'A calmer home for resuming voyages, triaging active work, and opening the next craft.',
  },
};

export const LightAutoReady: Story = {
  args: {
    direction: 'light',
    eyebrow: 'Light and auto mode ready',
    title: 'Good morning, pick up the thread',
    subtitle:
      'The same information architecture expressed with tokenized surfaces that can move between light, dark, and user skins.',
  },
};

export const PremiumCommandCenter: Story = {
  args: {
    direction: 'premium',
    eyebrow: 'Command center',
    title: 'One desk for voyages, filters, and workflows',
    subtitle:
      'A denser cockpit for engineers who want the whole day in view without turning the home page into a feed.',
  },
};

export const EnterpriseProductivity: Story = {
  args: {
    direction: 'enterprise',
    eyebrow: 'Enterprise productivity',
    title: 'Clear queues for team-managed work',
    subtitle:
      'A restrained dashboard direction for organizations that need readable status, predictable controls, and saved operating views.',
  },
};

export const FocusStack: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <FocusStackConcept />,
};

export const KanbanDesk: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <KanbanDeskConcept />,
};

export const VoyageMap: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <VoyageMapConcept />,
};

export const MobileActionFeed: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <MobileActionFeedConcept />,
};

export const MobileVoyageTabs: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <MobileVoyageTabsConcept />,
};

export const MobileQueueSheet: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <MobileQueueSheetConcept />,
};

export const MobileThumbDock: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <MobileThumbDockConcept />,
};

export const MobileDrilldownSheet: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <MobileDrilldownSheetConcept />,
};

export const MobileSavedViews: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <MobileSavedViewsConcept />,
};

export const ModernDarkDesk: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <ModernDarkDeskConcept />,
};

export const ModernDarkBento: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <ModernDarkBentoConcept />,
};

export const EnterpriseLightOps: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <EnterpriseLightOpsConcept />,
};

export const EnterpriseLightCommand: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <EnterpriseLightCommandConcept />,
};

export const MobileModernDarkDesk: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <MobileModernDarkDeskConcept />,
};

export const MobileModernDarkConstellation: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <MobileModernDarkConstellationConcept />,
};

export const MobileEnterpriseLightOps: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <MobileEnterpriseLightOpsConcept />,
};

export const MobileEnterpriseLightLaunchpad: Story = {
  parameters: {
    controls: {
      disable: true,
    },
  },
  render: () => <MobileEnterpriseLightLaunchpadConcept />,
};

function DashboardConcept({
  direction,
  colorScheme = 'direction',
  fontStyle = 'interfaceSans',
  eyebrow,
  title,
  subtitle,
}: DashboardConceptArgs) {
  const resolvedScheme = colorScheme === 'direction' ? direction : colorScheme;
  const theme = applyFontStyle(getTheme(resolvedScheme), fontStyle);

  return (
    <main className={theme.page}>
      <div className={theme.backdrop} />
      <section className={theme.shell}>
        <header className={theme.header}>
          <div>
            <p className={theme.eyebrow}>{eyebrow}</p>
            <h1 className={theme.title}>{title}</h1>
            <p className={theme.subtitle}>{subtitle}</p>
          </div>
          <div className={theme.headerActions}>
            <button className={theme.secondaryButton}>Go Home</button>
            <button className={theme.primaryButton}>New Voyage</button>
          </div>
        </header>

        <div className={theme.workspaceGrid}>
          <aside className={theme.leftRail} aria-label="Voyage selector concept">
            <div className={theme.panelHeader}>
              <span>Voyages</span>
              <span className={theme.mutedText}>scope reset</span>
            </div>
            <VoyageList theme={theme} />
          </aside>

          <section className={theme.heroPanel} aria-label="Today overview concept">
            <div className={theme.heroTopline}>
              <span>Today</span>
              <span>Vibe Dashboard · current voyage</span>
            </div>
            <div className={theme.heroCopyGrid}>
              <div>
                <h2 className={theme.heroTitle}>Resume with confidence</h2>
                <p className={theme.heroCopy}>
                  Your active voyage, urgent approvals, running servers, saved
                  filters, and workflow queues are grouped by next action.
                </p>
              </div>
              <div className={theme.heroActionStack}>
                <button className={theme.primaryButton}>Open active craft</button>
                <button className={theme.secondaryButton}>Carry over craft</button>
              </div>
            </div>
            <div className={theme.focusGrid}>
              {focusCards.map((card) => (
                <FocusTile key={card.label} card={card} theme={theme} />
              ))}
            </div>
          </section>

          <section className={theme.workPanel} aria-label="Priority work concept">
            <div className={theme.panelHeader}>
              <span>Priority work</span>
              <span className={theme.mutedText}>sorted by next action</span>
            </div>
            <div className={theme.workList}>
              {workItems.map((item) => (
                <WorkRow key={item.title} item={item} theme={theme} />
              ))}
            </div>
          </section>

          <section className={theme.filterPanel} aria-label="Saved filters concept">
            <div className={theme.panelHeader}>
              <span>Saved filters</span>
              <span className={theme.mutedText}>future kanban entry</span>
            </div>
            <div className={theme.filterList}>
              {savedFilters.map((filter) => (
                <button key={filter} className={theme.filterPill}>
                  {filter}
                </button>
              ))}
            </div>
          </section>

          <section className={theme.workflowPanel} aria-label="Workflow queue concept">
            <div className={theme.panelHeader}>
              <span>Workflow queue</span>
              <span className={theme.mutedText}>future workflows entry</span>
            </div>
            <div className={theme.workflowList}>
              {workflowRows.map(([name, status, time]) => (
                <div key={name} className={theme.workflowRow}>
                  <div>
                    <p className={theme.rowTitle}>{name}</p>
                    <p className={theme.rowMeta}>{status}</p>
                  </div>
                  <span className={theme.timeText}>{time}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function FocusStackConcept() {
  return (
    <main className="h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#101214] p-5 text-zinc-100 md:p-8">
      <section className="mx-auto grid max-w-[1380px] gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid min-h-[calc(100dvh-4rem)] gap-5">
          <header className="flex items-center justify-between gap-4 border-b border-zinc-800 pb-4">
            <div>
              <p className="text-xs font-medium text-emerald-300">Home</p>
              <h1 className="mt-2 text-5xl font-semibold tracking-[-0.055em] text-white md:text-7xl">
                Focus stack
              </h1>
            </div>
            <div className="flex gap-2">
              <button className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-200">
                Go Home
              </button>
              <button className="rounded-lg bg-emerald-300 px-4 py-2 text-sm font-semibold text-zinc-950">
                New Voyage
              </button>
            </div>
          </header>

          <div className="grid gap-4 md:grid-cols-[1.35fr_0.65fr]">
            <section className="rounded-3xl border border-emerald-300/20 bg-emerald-300/[0.055] p-6 shadow-[0_28px_90px_rgb(16_185_129_/_0.10)]">
              <p className="text-sm text-emerald-200">Now</p>
              <h2 className="mt-6 max-w-2xl text-4xl font-semibold tracking-[-0.045em]">
                Auth bug fix
              </h2>
              <div className="mt-8 grid gap-5 md:grid-cols-3">
                {[
                  ['Approval', 'waiting'],
                  ['Server', 'running'],
                  ['PR', 'open'],
                ].map(([label, value]) => (
                  <article key={label} className="border-t border-white/10 pt-4">
                    <p className="text-xs text-zinc-500">{label}</p>
                    <p className="mt-3 text-lg font-semibold">{value}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-zinc-800 bg-zinc-950/40 p-5">
              <p className="text-sm text-zinc-400">Next</p>
              <div className="mt-5 divide-y divide-zinc-800">
                {['Review diff', 'Open craft', 'Stop stale server'].map((item) => (
                  <button
                    key={item}
                    className="block w-full px-1 py-4 text-left text-sm text-zinc-100 transition hover:text-emerald-200 active:translate-y-px"
                  >
                    {item}
                  </button>
                ))}
              </div>
            </section>
          </div>

          <section className="grid gap-4 md:grid-cols-3">
            {[
              ['Mine with approvals', '3'],
              ['Workflow blocked', '1'],
              ['Running servers', '2'],
            ].map(([label, value]) => (
              <article key={label} className="border-t border-zinc-800 pt-4">
                <p className="font-mono text-4xl tracking-[-0.04em] text-white">
                  {value}
                </p>
                <p className="mt-2 text-sm text-zinc-500">{label}</p>
              </article>
            ))}
          </section>
        </div>

        <aside className="grid content-start rounded-3xl border border-zinc-800 bg-zinc-950/50 p-4">
          {['Current launch', 'Design review', 'Clean browser session'].map(
            (voyage, index) => (
              <button
                key={voyage}
                className={`border-b border-zinc-800/70 px-2 py-4 text-left text-sm last:border-b-0 ${
                  index === 0
                    ? 'text-emerald-200'
                    : 'text-zinc-400'
                }`}
              >
                {voyage}
              </button>
            ),
          )}
        </aside>
      </section>
    </main>
  );
}

function KanbanDeskConcept() {
  const columns: Array<{ column: string; cards: string[] }> = [
    { column: 'Now', cards: ['Auth bug fix', 'Kanban polish'] },
    { column: 'Next', cards: ['Docs refresh', 'Workflow form'] },
    { column: 'Later', cards: ['Skin tokens', 'Saved filters'] },
  ];

  return (
    <main className="h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#f4f6f8] p-4 text-slate-950 md:p-7">
      <section className="mx-auto max-w-[1480px]">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-4 rounded-2xl bg-white p-5 shadow-[0_18px_60px_rgb(15_23_42_/_0.08)]">
          <div>
            <p className="text-xs font-semibold text-slate-500">Today</p>
            <h1 className="mt-2 text-4xl font-semibold tracking-[-0.045em] md:text-6xl">
              Kanban desk
            </h1>
          </div>
          <div className="flex gap-2">
            {['Go Home', 'New Voyage'].map((action, index) => (
              <button
                key={action}
                className={`rounded-xl px-4 py-2 text-sm font-semibold ${
                  index === 0
                    ? 'border border-slate-300 bg-white text-slate-800'
                    : 'bg-slate-950 text-white'
                }`}
              >
                {action}
              </button>
            ))}
          </div>
        </header>

        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <section className="grid gap-4 md:grid-cols-3">
            {columns.map(({ column, cards }) => (
              <article key={column} className="rounded-2xl bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold">{column}</h2>
                  <span className="font-mono text-xs text-slate-400">
                    {cards.length}
                  </span>
                </div>
                <div className="divide-y divide-slate-200">
                  {cards.map((card, index) => (
                    <div
                      key={card}
                      className={`py-4 ${
                        index === 0
                          ? 'border-l-2 border-blue-600 pl-3'
                          : 'border-l-2 border-transparent pl-3'
                      }`}
                    >
                      <p className="text-sm font-medium">{card}</p>
                      <p className="mt-3 text-xs text-slate-500">
                        {index === 0 ? 'active' : 'queued'}
                      </p>
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </section>

          <aside className="grid content-start gap-4">
            <section className="rounded-2xl bg-slate-950 p-5 text-white">
              <p className="text-sm text-blue-200">Filters</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {['Mine', 'PR open', 'Blocked', 'Server on'].map((filter) => (
                  <button
                    key={filter}
                    className="rounded-md border border-white/15 px-3 py-2 text-xs text-white transition hover:border-blue-200"
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </section>
            <section className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold">Workflow queue</p>
              <div className="mt-4 grid gap-3 text-sm">
                {['Review requested', 'CI running', 'Form waiting'].map((row) => (
                  <div key={row} className="flex justify-between gap-4">
                    <span>{row}</span>
                    <span className="text-slate-400">open</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}

function VoyageMapConcept() {
  return (
    <main className="h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#0b0d12] p-5 text-zinc-100 md:p-8">
      <section className="mx-auto max-w-[1460px]">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-4xl font-semibold tracking-[-0.05em] md:text-6xl">
            Voyage map
          </h1>
          <div className="flex gap-2">
            <button className="rounded-full border border-white/15 px-4 py-2 text-sm">
              Go Home
            </button>
            <button className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-zinc-950">
              New Voyage
            </button>
          </div>
        </header>

        <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="grid content-start rounded-3xl border border-white/10 bg-white/[0.035] p-3">
            {[
              ['Current launch', '3 craft'],
              ['Design review', '1 craft'],
              ['Clean session', 'empty'],
            ].map(([name, count], index) => (
              <button
                key={name}
                className={`border-b border-white/10 p-4 text-left last:border-b-0 ${
                  index === 0
                    ? 'text-violet-100'
                    : 'text-zinc-400'
                }`}
              >
                <span className="block text-sm font-medium">{name}</span>
                <span className="mt-2 block text-xs text-zinc-500">{count}</span>
              </button>
            ))}
          </aside>

          <section className="relative min-h-[680px] overflow-hidden rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_50%_45%,rgb(167_139_250_/_0.18),transparent_30%),linear-gradient(135deg,rgb(255_255_255_/_0.09),rgb(255_255_255_/_0.025))] p-6">
            <div className="absolute left-[8%] top-[14%] h-36 w-36 rounded-full border border-violet-200/30 bg-violet-200/10 p-5">
              <p className="text-sm font-medium">Auth bug fix</p>
              <p className="mt-2 text-xs text-zinc-400">approval</p>
            </div>
            <div className="absolute right-[12%] top-[20%] h-44 w-44 rounded-full border border-cyan-200/25 bg-cyan-200/10 p-6">
              <p className="text-sm font-medium">Kanban polish</p>
              <p className="mt-2 text-xs text-zinc-400">review</p>
            </div>
            <div className="absolute bottom-[18%] left-[30%] h-48 w-48 rounded-full border border-emerald-200/25 bg-emerald-200/10 p-6">
              <p className="text-sm font-medium">Docs refresh</p>
              <p className="mt-2 text-xs text-zinc-400">resume</p>
            </div>
            <div className="absolute bottom-[14%] right-[16%] h-28 w-28 rounded-full border border-white/15 bg-white/5 p-5">
              <p className="text-sm font-medium">Skin tokens</p>
              <p className="mt-2 text-xs text-zinc-400">next</p>
            </div>
            <div className="absolute left-1/2 top-1/2 h-px w-[72%] -translate-x-1/2 rotate-[-18deg] bg-white/10" />
            <div className="absolute left-1/2 top-1/2 h-px w-[62%] -translate-x-1/2 rotate-[24deg] bg-white/10" />
          </section>
        </div>
      </section>
    </main>
  );
}

function MobileActionFeedConcept() {
  return (
    <main className="h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#0d1117] text-zinc-100">
      <section className="mx-auto flex min-h-[100dvh] max-w-[430px] flex-col px-4 pb-[calc(5.75rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))]">
        <header className="border-b border-sky-400/15 pb-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold text-sky-300">Home</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-[-0.045em]">
                Today
              </h1>
            </div>
            <button className="min-h-11 rounded-lg border border-zinc-700 px-4 text-sm text-zinc-100">
              Go Home
            </button>
          </div>
        </header>

        <section className="mt-5 rounded-3xl border border-sky-400/20 bg-[#111827] p-5">
          <p className="text-sm text-sky-200">Current launch</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
            Auth bug fix
          </h2>
          <div className="mt-5 flex gap-2">
            <button className="min-h-12 flex-1 rounded-xl bg-sky-400 px-4 text-sm font-semibold text-slate-950">
              Open craft
            </button>
            <button className="min-h-12 rounded-xl border border-zinc-700 px-4 text-sm text-zinc-100">
              Carry over
            </button>
          </div>
        </section>

        <section className="mt-5">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Next actions</span>
            <span>3 open</span>
          </div>
          <div className="mt-3 divide-y divide-zinc-800 border-y border-zinc-800">
            {[
              ['Approval', 'Waiting for approval'],
              ['CI', 'Running'],
              ['Agent', 'Unread turn'],
            ].map(([label, status]) => (
              <button
                key={label}
                className="flex min-h-16 w-full items-center justify-between gap-4 py-3 text-left"
              >
                <span>
                  <span className="block text-base font-medium">{label}</span>
                  <span className="mt-1 block text-sm text-zinc-500">{status}</span>
                </span>
                <span className="text-sm text-sky-300">Open</span>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-5">
          <div className="flex flex-wrap gap-2">
            {['Mine', 'PR open', 'Blocked', 'Server on'].map((filter) => (
              <button
                key={filter}
                className="min-h-11 rounded-lg border border-zinc-700 px-3 text-sm text-zinc-200"
              >
                {filter}
              </button>
            ))}
          </div>
        </section>

        <nav className="fixed inset-x-0 bottom-0 border-t border-zinc-800 bg-[#0d1117]/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto flex max-w-[430px] gap-2">
            <button className="min-h-12 flex-1 rounded-xl border border-zinc-700 text-sm text-zinc-100">
              Voyages
            </button>
            <button className="min-h-12 flex-1 rounded-xl bg-sky-400 text-sm font-semibold text-slate-950">
              New Voyage
            </button>
          </div>
        </nav>
      </section>
    </main>
  );
}

function MobileVoyageTabsConcept() {
  return (
    <main className="h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#f4f7fb] text-slate-950">
      <section className="mx-auto min-h-[100dvh] max-w-[430px] px-4 pb-8 pt-[calc(1rem+env(safe-area-inset-top))]">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-cyan-700">Voyages</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.045em]">
              Pick scope
            </h1>
          </div>
          <button className="min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">
            New Voyage
          </button>
        </header>

        <nav className="mt-5 flex gap-2 overflow-x-auto pb-1">
          {['Current', 'Design', 'Clean'].map((voyage, index) => (
            <button
              key={voyage}
              className={`min-h-11 shrink-0 rounded-xl px-4 text-sm font-medium ${
                index === 0
                  ? 'bg-slate-950 text-white'
                  : 'border border-slate-300 bg-white text-slate-700'
              }`}
            >
              {voyage}
            </button>
          ))}
        </nav>

        <section className="mt-5 rounded-3xl border border-white bg-white p-5 shadow-[0_18px_60px_rgb(15_23_42_/_0.08)]">
          <p className="text-sm text-slate-500">Current launch</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
            Resume work
          </h2>
          <div className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-200 pt-4">
            {[
              ['3', 'Needs'],
              ['2', 'Running'],
              ['5', 'Filters'],
            ].map(([value, label]) => (
              <div key={label}>
                <p className="font-mono text-2xl font-semibold">{value}</p>
                <p className="mt-1 text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-5">
          <div className="flex items-center justify-between text-xs font-medium text-slate-500">
            <span>Queue</span>
            <span>sorted</span>
          </div>
          <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
            {workItems.map((item) => (
              <button
                key={item.title}
                className="flex min-h-16 w-full items-center justify-between gap-4 py-3 text-left"
              >
                <span>
                  <span className="block text-base font-medium">{item.title}</span>
                  <span className="mt-1 block text-sm text-slate-500">
                    {item.status}
                  </span>
                </span>
                <span className="text-sm text-cyan-700">Open</span>
              </button>
            ))}
          </div>
        </section>

        <button className="mt-5 min-h-12 w-full rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-800">
          Go Home
        </button>
      </section>
    </main>
  );
}

function MobileQueueSheetConcept() {
  return (
    <main className="h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#090b10] text-zinc-100">
      <section className="mx-auto flex min-h-[100dvh] max-w-[430px] flex-col px-4 pb-5 pt-[calc(1rem+env(safe-area-inset-top))]">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-emerald-300">Workflows</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.045em]">
              Queue sheet
            </h1>
          </div>
          <button className="min-h-11 rounded-xl border border-white/15 px-4 text-sm text-zinc-100">
            Go Home
          </button>
        </header>

        <section className="mt-5 rounded-[1.75rem] border border-emerald-300/20 bg-emerald-300/[0.06] p-5">
          <p className="text-sm text-emerald-200">Next</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
            Review diff
          </h2>
          <button className="mt-5 min-h-12 w-full rounded-xl bg-emerald-300 text-sm font-semibold text-zinc-950">
            Open active craft
          </button>
        </section>

        <section className="mt-5 flex-1 rounded-[1.75rem] border border-white/10 bg-white/[0.035] p-5">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Workflow queue</span>
            <span>3 rows</span>
          </div>
          <div className="mt-4 divide-y divide-white/10">
            {workflowRows.map(([name, status, time]) => (
              <button
                key={name}
                className="flex min-h-16 w-full items-center justify-between gap-4 py-3 text-left"
              >
                <span>
                  <span className="block text-base font-medium">{name}</span>
                  <span className="mt-1 block text-sm text-zinc-500">{status}</span>
                </span>
                <span className="shrink-0 font-mono text-xs text-zinc-500">
                  {time}
                </span>
              </button>
            ))}
          </div>
        </section>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button className="min-h-12 rounded-xl border border-white/15 text-sm text-zinc-100">
            Filters
          </button>
          <button className="min-h-12 rounded-xl bg-white text-sm font-semibold text-zinc-950">
            New Voyage
          </button>
        </div>
      </section>
    </main>
  );
}

function MobileThumbDockConcept() {
  return (
    <main className="h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#0b1020] text-zinc-100">
      <section className="mx-auto min-h-[100dvh] max-w-[430px] px-4 pb-[calc(5.75rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))]">
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-cyan-300">Dock</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.045em]">
              Start point
            </h1>
          </div>
          <button className="min-h-11 rounded-xl border border-white/15 px-4 text-sm text-zinc-100">
            Go Home
          </button>
        </header>

        <section className="mt-5 border-y border-white/10 py-5">
          <p className="text-sm text-zinc-500">Current launch</p>
          <h2 className="mt-3 text-4xl font-semibold tracking-[-0.05em]">
            Open craft
          </h2>
          <div className="mt-5 flex items-center justify-between gap-4">
            <span className="text-sm text-zinc-500">Auth bug fix</span>
            <span className="rounded-full bg-amber-300 px-3 py-1 text-xs font-semibold text-zinc-950">
              approval
            </span>
          </div>
        </section>

        <section className="mt-5">
          <div className="grid grid-cols-3 gap-4">
            {[
              ['3', 'Needs'],
              ['2', 'Servers'],
              ['1', 'Blocked'],
            ].map(([value, label]) => (
              <div key={label} className="border-t border-white/10 pt-3">
                <p className="font-mono text-3xl font-semibold">{value}</p>
                <p className="mt-1 text-xs text-zinc-500">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Thumb actions</span>
            <span>ready</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {['Review diff', 'Open craft', 'Carry over', 'Stop server'].map(
              (action) => (
                <button
                  key={action}
                  className="min-h-14 rounded-xl border border-white/10 bg-white/[0.035] px-3 text-sm text-zinc-100"
                >
                  {action}
                </button>
              ),
            )}
          </div>
        </section>

        <nav className="fixed inset-x-0 bottom-0 border-t border-white/10 bg-[#0b1020]/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto grid max-w-[430px] grid-cols-4 gap-2">
            {['Home', 'Views', 'Queue', 'New'].map((item, index) => (
              <button
                key={item}
                className={`min-h-12 rounded-xl text-xs font-semibold ${
                  index === 0
                    ? 'bg-cyan-300 text-slate-950'
                    : 'border border-white/10 text-zinc-300'
                }`}
              >
                {item}
              </button>
            ))}
          </div>
        </nav>
      </section>
    </main>
  );
}

function MobileDrilldownSheetConcept() {
  return (
    <main className="h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#f7f3ec] text-stone-950">
      <section className="mx-auto flex min-h-[100dvh] max-w-[430px] flex-col px-4 pb-5 pt-[calc(1rem+env(safe-area-inset-top))]">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-stone-500">Review</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.045em]">
              Drilldown
            </h1>
          </div>
          <button className="min-h-11 rounded-xl bg-stone-950 px-4 text-sm font-semibold text-white">
            New Voyage
          </button>
        </header>

        <section className="mt-5 flex-1 rounded-[1.75rem] bg-white p-5 shadow-[0_18px_60px_rgb(68_64_60_/_0.10)]">
          <div className="flex items-center justify-between border-b border-stone-200 pb-4">
            <div>
              <p className="text-sm text-stone-500">Selected</p>
              <h2 className="mt-1 text-3xl font-semibold tracking-[-0.04em]">
                Kanban polish
              </h2>
            </div>
            <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-800">
              review
            </span>
          </div>

          <div className="divide-y divide-stone-200">
            {[
              ['Branch', 'vk/story-auth-bug'],
              ['Filter', 'Mine in review'],
              ['Workflow', 'Design review'],
            ].map(([label, value]) => (
              <button
                key={label}
                className="flex min-h-16 w-full items-center justify-between gap-4 py-3 text-left"
              >
                <span className="text-sm text-stone-500">{label}</span>
                <span className="text-right text-base font-medium">{value}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-4 rounded-[1.5rem] border border-stone-300 bg-stone-950 p-4 text-white">
          <div className="flex items-center justify-between text-xs text-stone-400">
            <span>Next step</span>
            <span>1 min</span>
          </div>
          <button className="mt-3 min-h-12 w-full rounded-xl bg-white text-sm font-semibold text-stone-950">
            Open selected craft
          </button>
        </section>

        <button className="mt-3 min-h-12 w-full rounded-xl border border-stone-300 bg-white text-sm font-semibold text-stone-800">
          Go Home
        </button>
      </section>
    </main>
  );
}

function MobileSavedViewsConcept() {
  return (
    <main className="h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#111315] text-zinc-100">
      <section className="mx-auto min-h-[100dvh] max-w-[430px] px-4 pb-7 pt-[calc(1rem+env(safe-area-inset-top))]">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-lime-300">Views</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-0.045em]">
              Saved stack
            </h1>
          </div>
          <button className="min-h-11 rounded-xl border border-zinc-700 px-4 text-sm text-zinc-100">
            Go Home
          </button>
        </header>

        <nav className="mt-5 flex gap-2 overflow-x-auto pb-1">
          {savedFilters.map((filter, index) => (
            <button
              key={filter}
              className={`min-h-11 shrink-0 rounded-xl px-4 text-sm ${
                index === 0
                  ? 'bg-lime-300 font-semibold text-zinc-950'
                  : 'border border-zinc-700 text-zinc-300'
              }`}
            >
              {filter}
            </button>
          ))}
        </nav>

        <section className="mt-5 rounded-[1.75rem] border border-lime-300/20 bg-lime-300/[0.06] p-5">
          <p className="text-sm text-lime-200">Mine with approvals</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em]">
            3 waiting
          </h2>
          <button className="mt-5 min-h-12 w-full rounded-xl bg-lime-300 text-sm font-semibold text-zinc-950">
            Open filter
          </button>
        </section>

        <section className="mt-5">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>Matching work</span>
            <span>latest first</span>
          </div>
          <div className="mt-3 divide-y divide-zinc-800 border-y border-zinc-800">
            {[
              ['Auth bug fix', 'approval'],
              ['Docs refresh', 'resume'],
              ['Human approval workflow', 'blocked'],
            ].map(([title, state]) => (
              <button
                key={title}
                className="flex min-h-16 w-full items-center justify-between gap-4 py-3 text-left"
              >
                <span className="text-base font-medium">{title}</span>
                <span className="text-sm text-lime-300">{state}</span>
              </button>
            ))}
          </div>
        </section>

        <button className="mt-5 min-h-12 w-full rounded-xl bg-white text-sm font-semibold text-zinc-950">
          New Voyage
        </button>
      </section>
    </main>
  );
}

function ModernDarkDeskConcept() {
  return (
    <main className="relative h-[100dvh] overflow-y-auto overflow-x-hidden bg-[radial-gradient(ellipse_at_top,#101025_0%,#050506_48%,#020203_100%)] p-4 text-[#EDEDEF] md:p-8">
      <div className="pointer-events-none absolute left-1/2 top-[-34rem] h-[62rem] w-[76rem] -translate-x-1/2 rounded-full bg-[#5E6AD2]/20 blur-[140px]" />
      <div className="pointer-events-none absolute right-[-14rem] top-56 h-[34rem] w-[34rem] rounded-full bg-cyan-400/10 blur-[110px]" />
      <section className="relative mx-auto max-w-[1480px]">
        <header className="flex flex-wrap items-end justify-between gap-4 border-b border-white/[0.06] pb-5">
          <div>
            <p className="font-mono text-xs font-semibold tracking-[0.18em] text-[#8A8F98]">
              MODERN DARK
            </p>
            <h1 className="mt-3 max-w-4xl bg-gradient-to-b from-white via-white/95 to-white/65 bg-clip-text text-5xl font-semibold tracking-[-0.055em] text-transparent md:text-7xl">
              Developer desk
            </h1>
          </div>
          <div className="flex gap-2">
            <button className="min-h-11 rounded-lg bg-white/[0.05] px-4 text-sm font-medium text-[#EDEDEF] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]">
              Go Home
            </button>
            <button className="min-h-11 rounded-lg bg-[#5E6AD2] px-4 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(94,106,210,0.5),0_4px_18px_rgba(94,106,210,0.3),inset_0_1px_0_0_rgba(255,255,255,0.2)]">
              New Voyage
            </button>
          </div>
        </header>

        <div className="mt-6 grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)_360px]">
          <aside className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_20px_70px_rgba(0,0,0,0.34)]">
            <p className="text-sm font-medium text-[#EDEDEF]">Voyages</p>
            <div className="mt-5 divide-y divide-white/[0.06]">
              {['Current launch', 'Design review', 'Clean session'].map(
                (voyage, index) => (
                  <button
                    key={voyage}
                    className={`flex min-h-14 w-full items-center justify-between py-3 text-left text-sm ${
                      index === 0 ? 'text-white' : 'text-[#8A8F98]'
                    }`}
                  >
                    <span>{voyage}</span>
                    <span className="h-2 w-2 rounded-full bg-[#5E6AD2]" />
                  </button>
                ),
              )}
            </div>
          </aside>

          <section className="rounded-2xl border border-[#5E6AD2]/30 bg-gradient-to-b from-white/[0.08] to-white/[0.02] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_24px_90px_rgba(0,0,0,0.42),0_0_90px_rgba(94,106,210,0.12)]">
            <p className="font-mono text-xs tracking-[0.16em] text-[#8A8F98]">
              ACTIVE CRAFT
            </p>
            <div className="mt-8 grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
              <div>
                <h2 className="text-4xl font-semibold tracking-[-0.045em] md:text-6xl">
                  Auth bug fix
                </h2>
                <p className="mt-4 max-w-2xl text-base leading-7 text-[#8A8F98]">
                  Approval, CI, saved views, and workflow handoffs stay attached
                  to the active voyage.
                </p>
              </div>
              <button className="min-h-12 rounded-lg bg-[#5E6AD2] px-5 text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(94,106,210,0.5),0_4px_18px_rgba(94,106,210,0.3)]">
                Open active craft
              </button>
            </div>

            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {[
                ['Needs attention', '3', 'approval, CI, unread turn'],
                ['Running', '2', 'servers ready'],
                ['Saved filters', '5', 'weekly work views'],
              ].map(([label, value, detail]) => (
                <article key={label} className="border-t border-white/[0.08] pt-4">
                  <p className="text-sm text-[#8A8F98]">{label}</p>
                  <p className="mt-3 font-mono text-4xl font-semibold">{value}</p>
                  <p className="mt-2 text-xs text-[#8A8F98]">{detail}</p>
                </article>
              ))}
            </div>
          </section>

          <aside className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_20px_70px_rgba(0,0,0,0.34)]">
            <p className="text-sm font-medium">Workflow queue</p>
            <div className="mt-5 divide-y divide-white/[0.06]">
              {workflowRows.map(([name, status, time]) => (
                <button
                  key={name}
                  className="flex min-h-16 w-full items-center justify-between gap-4 py-3 text-left"
                >
                  <span>
                    <span className="block text-sm font-medium">{name}</span>
                    <span className="mt-1 block text-xs text-[#8A8F98]">
                      {status}
                    </span>
                  </span>
                  <span className="font-mono text-xs text-[#8A8F98]">{time}</span>
                </button>
              ))}
            </div>
          </aside>
        </div>
      </section>
    </main>
  );
}

function ModernDarkBentoConcept() {
  return (
    <main className="relative h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#050506] p-4 text-[#EDEDEF] md:p-8">
      <div className="pointer-events-none absolute left-[-18rem] top-[-10rem] h-[48rem] w-[48rem] rounded-full bg-[#5E6AD2]/20 blur-[130px]" />
      <div className="pointer-events-none absolute bottom-[-18rem] right-[-10rem] h-[44rem] w-[44rem] rounded-full bg-blue-500/10 blur-[120px]" />
      <section className="relative mx-auto max-w-[1480px]">
        <header className="mb-5 grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <p className="font-mono text-xs tracking-[0.18em] text-[#8A8F98]">
              BENTO
            </p>
            <h1 className="mt-3 max-w-4xl text-5xl font-semibold tracking-[-0.055em] md:text-7xl">
              Work constellation
            </h1>
          </div>
          <div className="flex gap-2">
            <button className="min-h-11 rounded-lg bg-white/[0.05] px-4 text-sm text-[#EDEDEF]">
              Go Home
            </button>
            <button className="min-h-11 rounded-lg bg-[#5E6AD2] px-4 text-sm font-semibold text-white shadow-[0_0_40px_rgba(94,106,210,0.22)]">
              New Voyage
            </button>
          </div>
        </header>

        <div className="grid auto-rows-[160px] gap-4 md:grid-cols-6">
          <section className="rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.08] to-white/[0.02] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.05),0_20px_80px_rgba(0,0,0,0.38)] md:col-span-4 md:row-span-2">
            <p className="text-sm text-[#8A8F98]">Current launch</p>
            <h2 className="mt-8 text-5xl font-semibold tracking-[-0.055em]">
              Resume without widening scope
            </h2>
            <div className="mt-8 flex flex-wrap gap-2">
              {['Auth bug fix', 'Approval', 'CI running', 'Unread turn'].map(
                (item) => (
                  <span
                    key={item}
                    className="rounded-full border border-[#5E6AD2]/30 px-3 py-2 text-xs text-[#EDEDEF]"
                  >
                    {item}
                  </span>
                ),
              )}
            </div>
          </section>

          {[
            ['Needs', '3', 'approval queue'],
            ['Servers', '2', 'ready to open'],
            ['Views', '5', 'saved filters'],
            ['Workflows', '3', 'runs and forms'],
          ].map(([label, value, detail]) => (
            <article
              key={label}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_18px_70px_rgba(0,0,0,0.32)] md:col-span-2"
            >
              <p className="text-sm text-[#8A8F98]">{label}</p>
              <p className="mt-4 font-mono text-4xl font-semibold">{value}</p>
              <p className="mt-2 text-xs text-[#8A8F98]">{detail}</p>
            </article>
          ))}

          <section className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-5 md:col-span-3 md:row-span-2">
            <p className="text-sm font-medium">Priority work</p>
            <div className="mt-4 divide-y divide-white/[0.06]">
              {workItems.map((item) => (
                <button
                  key={item.title}
                  className="flex min-h-16 w-full items-center justify-between gap-4 py-3 text-left"
                >
                  <span>
                    <span className="block text-sm font-medium">{item.title}</span>
                    <span className="mt-1 block text-xs text-[#8A8F98]">
                      {item.status}
                    </span>
                  </span>
                  <span className="text-sm text-[#5E6AD2]">Open</span>
                </button>
              ))}
            </div>
          </section>

          <section className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-5 md:col-span-3 md:row-span-2">
            <p className="text-sm font-medium">Saved filters</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {savedFilters.map((filter) => (
                <button
                  key={filter}
                  className="min-h-10 rounded-lg bg-white/[0.05] px-3 text-xs text-[#EDEDEF]"
                >
                  {filter}
                </button>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function EnterpriseLightOpsConcept() {
  return (
    <main className="relative h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#F8FAFC] p-4 text-slate-950 md:p-8">
      <div className="pointer-events-none absolute right-[-10rem] top-[-12rem] h-[34rem] w-[34rem] rounded-full bg-indigo-200/50 blur-3xl" />
      <div className="pointer-events-none absolute bottom-[-16rem] left-[-10rem] h-[32rem] w-[32rem] rounded-full bg-violet-200/40 blur-3xl" />
      <section className="relative mx-auto max-w-[1440px]">
        <header className="rounded-3xl border border-slate-100 bg-white p-6 shadow-[0_4px_20px_-2px_rgba(79,70,229,0.10)]">
          <div className="grid gap-5 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">
                Enterprise light
              </p>
              <h1 className="mt-3 max-w-4xl text-5xl font-extrabold tracking-[-0.045em] md:text-7xl">
                Morning operations
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-7 text-slate-500">
                A warm, structured command page for teams that need readable
                ownership, queue status, and low-risk handoff controls.
              </p>
            </div>
            <div className="flex gap-2">
              <button className="min-h-11 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700">
                Go Home
              </button>
              <button className="min-h-11 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-4 text-sm font-semibold text-white shadow-[0_4px_14px_0_rgba(79,70,229,0.30)]">
                New Voyage
              </button>
            </div>
          </div>
        </header>

        <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
          <section className="rounded-3xl border border-slate-100 bg-white p-6 shadow-[0_4px_20px_-2px_rgba(79,70,229,0.10)]">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
              <div>
                <p className="text-sm font-semibold text-slate-500">
                  Current voyage
                </p>
                <h2 className="mt-2 text-4xl font-bold tracking-[-0.04em]">
                  Current launch
                </h2>
              </div>
              <button className="min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white">
                Open active craft
              </button>
            </div>
            <div className="divide-y divide-slate-200">
              {workItems.map((item) => (
                <button
                  key={item.title}
                  className="flex min-h-20 w-full items-center justify-between gap-4 py-4 text-left"
                >
                  <span>
                    <span className="block text-base font-semibold">
                      {item.title}
                    </span>
                    <span className="mt-1 block text-sm text-slate-500">
                      {item.meta}
                    </span>
                  </span>
                  <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                    {item.status}
                  </span>
                </button>
              ))}
            </div>
          </section>

          <aside className="grid content-start gap-5">
            <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-[0_4px_20px_-2px_rgba(79,70,229,0.10)]">
              <p className="text-sm font-semibold text-slate-500">Saved views</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {savedFilters.map((filter, index) => (
                  <button
                    key={filter}
                    className={`min-h-10 rounded-full px-3 text-xs font-semibold ${
                      index === 0
                        ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white'
                        : 'border border-slate-200 bg-white text-slate-700'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-[0_4px_20px_-2px_rgba(79,70,229,0.10)]">
              <p className="text-sm font-semibold text-slate-500">Workflow queue</p>
              <div className="mt-4 divide-y divide-slate-200">
                {workflowRows.map(([name, status]) => (
                  <div key={name} className="flex justify-between gap-4 py-3">
                    <span className="text-sm font-medium">{name}</span>
                    <span className="text-sm text-slate-500">{status}</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}

function EnterpriseLightCommandConcept() {
  return (
    <main className="relative h-[100dvh] overflow-y-auto overflow-x-hidden bg-gradient-to-br from-slate-50 via-white to-indigo-50 p-4 text-slate-950 md:p-8">
      <section className="relative mx-auto max-w-[1440px]">
        <header className="grid gap-5 md:grid-cols-[minmax(0,0.9fr)_minmax(420px,0.6fr)] md:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">
              Command review
            </p>
            <h1 className="mt-3 max-w-4xl text-5xl font-extrabold tracking-[-0.045em] md:text-7xl">
              Workday launchpad
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-slate-500">
              A brighter operating page for people who trust saved views more
              than sidebars.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button className="min-h-11 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 px-5 text-sm font-semibold text-white shadow-[0_4px_14px_0_rgba(79,70,229,0.30)]">
                Open active craft
              </button>
              <button className="min-h-11 rounded-full border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700">
                Go Home
              </button>
            </div>
          </div>

          <aside
            className="rounded-3xl border border-slate-100 bg-white p-6 shadow-[0_18px_50px_-16px_rgba(79,70,229,0.30)]"
            style={{ transform: 'perspective(1800px) rotateY(-5deg)' }}
          >
            <p className="text-sm font-semibold text-slate-500">Active voyage</p>
            <h2 className="mt-3 text-4xl font-bold tracking-[-0.04em]">
              Current launch
            </h2>
            <div className="mt-6 grid grid-cols-3 gap-4 border-t border-slate-200 pt-5">
              {[
                ['3', 'Needs'],
                ['2', 'Servers'],
                ['5', 'Views'],
              ].map(([value, label]) => (
                <div key={label}>
                  <p className="font-mono text-3xl font-semibold text-indigo-700">
                    {value}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{label}</p>
                </div>
              ))}
            </div>
          </aside>
        </header>

        <div className="mt-8 grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="rounded-3xl border border-slate-100 bg-white p-5 shadow-[0_4px_20px_-2px_rgba(79,70,229,0.10)]">
            <p className="text-sm font-semibold text-slate-500">Voyages</p>
            <div className="mt-4 divide-y divide-slate-200">
              {['Current launch', 'Design review', 'Clean browser session'].map(
                (voyage, index) => (
                  <button
                    key={voyage}
                    className={`flex min-h-14 w-full items-center justify-between py-3 text-left text-sm ${
                      index === 0 ? 'font-semibold text-indigo-700' : 'text-slate-600'
                    }`}
                  >
                    {voyage}
                    <span>{index === 0 ? 'active' : 'open'}</span>
                  </button>
                ),
              )}
            </div>
          </aside>

          <section className="rounded-3xl border border-slate-100 bg-white p-5 shadow-[0_4px_20px_-2px_rgba(79,70,229,0.10)]">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-500">Kanban lane</p>
              <button className="min-h-10 rounded-full border border-slate-200 px-3 text-xs font-semibold text-slate-700">
                New Voyage
              </button>
            </div>
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              {[
                ['Now', 'Auth bug fix', 'Waiting for approval'],
                ['Next', 'Kanban polish', 'Open craft'],
                ['Later', 'Skin tokens', 'Saved filter'],
              ].map(([column, title, detail]) => (
                <article key={column} className="border-t border-slate-200 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-indigo-600">
                    {column}
                  </p>
                  <h3 className="mt-4 text-xl font-bold">{title}</h3>
                  <p className="mt-2 text-sm text-slate-500">{detail}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

function MobileModernDarkDeskConcept() {
  return (
    <main className="relative h-[100dvh] overflow-y-auto overflow-x-hidden bg-[radial-gradient(ellipse_at_top,#101025_0%,#050506_52%,#020203_100%)] text-[#EDEDEF]">
      <div className="pointer-events-none absolute left-[-12rem] top-[-18rem] h-[36rem] w-[36rem] rounded-full bg-[#5E6AD2]/24 blur-[110px]" />
      <section className="relative mx-auto min-h-[100dvh] max-w-[430px] px-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))]">
        <header className="flex items-start justify-between gap-3 border-b border-white/[0.06] pb-4">
          <div>
            <p className="font-mono text-xs font-semibold tracking-[0.18em] text-[#8A8F98]">
              DARK
            </p>
            <h1 className="mt-2 bg-gradient-to-b from-white via-white/95 to-white/65 bg-clip-text text-4xl font-semibold tracking-[-0.055em] text-transparent">
              Developer desk
            </h1>
          </div>
          <button className="min-h-11 rounded-lg bg-white/[0.05] px-4 text-sm text-[#EDEDEF] shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)]">
            Go Home
          </button>
        </header>

        <section className="mt-5 rounded-2xl border border-[#5E6AD2]/30 bg-gradient-to-b from-white/[0.08] to-white/[0.02] p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_20px_70px_rgba(0,0,0,0.42),0_0_70px_rgba(94,106,210,0.12)]">
          <p className="font-mono text-xs tracking-[0.16em] text-[#8A8F98]">
            ACTIVE CRAFT
          </p>
          <h2 className="mt-5 text-4xl font-semibold tracking-[-0.05em]">
            Auth bug fix
          </h2>
          <p className="mt-3 text-sm leading-6 text-[#8A8F98]">
            Approval, CI, and unread agent turn stay in one scope.
          </p>
          <button className="mt-5 min-h-12 w-full rounded-lg bg-[#5E6AD2] text-sm font-semibold text-white shadow-[0_0_0_1px_rgba(94,106,210,0.5),0_4px_18px_rgba(94,106,210,0.3)]">
            Open active craft
          </button>
        </section>

        <section className="mt-5 grid grid-cols-3 gap-4">
          {[
            ['3', 'Needs'],
            ['2', 'Servers'],
            ['5', 'Views'],
          ].map(([value, label]) => (
            <div key={label} className="border-t border-white/[0.08] pt-3">
              <p className="font-mono text-3xl font-semibold">{value}</p>
              <p className="mt-1 text-xs text-[#8A8F98]">{label}</p>
            </div>
          ))}
        </section>

        <section className="mt-6">
          <div className="flex items-center justify-between text-xs text-[#8A8F98]">
            <span>Workflow queue</span>
            <span>3 rows</span>
          </div>
          <div className="mt-3 divide-y divide-white/[0.06] border-y border-white/[0.06]">
            {workflowRows.map(([name, status]) => (
              <button
                key={name}
                className="flex min-h-16 w-full items-center justify-between gap-4 py-3 text-left"
              >
                <span>
                  <span className="block text-base font-medium">{name}</span>
                  <span className="mt-1 block text-sm text-[#8A8F98]">
                    {status}
                  </span>
                </span>
                <span className="text-sm text-[#6872D9]">Open</span>
              </button>
            ))}
          </div>
        </section>

        <nav className="fixed inset-x-0 bottom-0 border-t border-white/[0.06] bg-[#050506]/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl">
          <div className="mx-auto grid max-w-[430px] grid-cols-2 gap-2">
            <button className="min-h-12 rounded-lg bg-white/[0.05] text-sm text-[#EDEDEF]">
              Voyages
            </button>
            <button className="min-h-12 rounded-lg bg-[#5E6AD2] text-sm font-semibold text-white">
              New Voyage
            </button>
          </div>
        </nav>
      </section>
    </main>
  );
}

function MobileModernDarkConstellationConcept() {
  return (
    <main className="relative h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#050506] text-[#EDEDEF]">
      <div className="pointer-events-none absolute right-[-15rem] top-[-12rem] h-[34rem] w-[34rem] rounded-full bg-blue-500/14 blur-[110px]" />
      <section className="relative mx-auto min-h-[100dvh] max-w-[430px] px-4 pb-7 pt-[calc(1rem+env(safe-area-inset-top))]">
        <header className="flex items-center justify-between gap-3">
          <div>
            <p className="font-mono text-xs tracking-[0.18em] text-[#8A8F98]">
              BENTO
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-[-0.055em]">
              Work map
            </h1>
          </div>
          <button className="min-h-11 rounded-lg bg-white/[0.05] px-4 text-sm text-[#EDEDEF]">
            Go Home
          </button>
        </header>

        <section className="mt-5 rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.08] to-white/[0.02] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.38)]">
          <p className="text-sm text-[#8A8F98]">Current launch</p>
          <h2 className="mt-4 text-3xl font-semibold tracking-[-0.05em]">
            Resume without widening scope
          </h2>
          <div className="mt-5 flex flex-wrap gap-2">
            {['Auth bug fix', 'Approval', 'CI running'].map((item) => (
              <span
                key={item}
                className="rounded-full border border-[#5E6AD2]/30 px-3 py-2 text-xs"
              >
                {item}
              </span>
            ))}
          </div>
        </section>

        <section className="mt-4 grid grid-cols-2 gap-3">
          {[
            ['Needs', '3', 'approval queue'],
            ['Servers', '2', 'ready to open'],
            ['Views', '5', 'saved filters'],
            ['Workflows', '3', 'runs and forms'],
          ].map(([label, value, detail]) => (
            <article
              key={label}
              className="rounded-2xl border border-white/[0.06] bg-white/[0.035] p-4"
            >
              <p className="text-xs text-[#8A8F98]">{label}</p>
              <p className="mt-3 font-mono text-3xl font-semibold">{value}</p>
              <p className="mt-1 text-xs text-[#8A8F98]">{detail}</p>
            </article>
          ))}
        </section>

        <section className="mt-5">
          <div className="flex items-center justify-between text-xs text-[#8A8F98]">
            <span>Priority work</span>
            <span>sorted</span>
          </div>
          <div className="mt-3 divide-y divide-white/[0.06] border-y border-white/[0.06]">
            {workItems.map((item) => (
              <button
                key={item.title}
                className="flex min-h-16 w-full items-center justify-between gap-4 py-3 text-left"
              >
                <span>
                  <span className="block text-base font-medium">{item.title}</span>
                  <span className="mt-1 block text-sm text-[#8A8F98]">
                    {item.status}
                  </span>
                </span>
                <span className="text-sm text-[#6872D9]">Open</span>
              </button>
            ))}
          </div>
        </section>

        <button className="mt-5 min-h-12 w-full rounded-lg bg-[#5E6AD2] text-sm font-semibold text-white">
          New Voyage
        </button>
      </section>
    </main>
  );
}

function MobileEnterpriseLightOpsConcept() {
  return (
    <main className="relative h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#F8FAFC] text-slate-950">
      <div className="pointer-events-none absolute right-[-12rem] top-[-12rem] h-[28rem] w-[28rem] rounded-full bg-indigo-200/60 blur-3xl" />
      <section className="relative mx-auto min-h-[100dvh] max-w-[430px] px-4 pb-7 pt-[calc(1rem+env(safe-area-inset-top))]">
        <header className="rounded-3xl border border-slate-100 bg-white p-5 shadow-[0_4px_20px_-2px_rgba(79,70,229,0.10)]">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">
            Enterprise light
          </p>
          <div className="mt-3 flex items-start justify-between gap-3">
            <h1 className="text-4xl font-extrabold tracking-[-0.045em]">
              Morning ops
            </h1>
            <button className="min-h-11 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700">
              Go Home
            </button>
          </div>
        </header>

        <section className="mt-5 rounded-3xl border border-slate-100 bg-white p-5 shadow-[0_4px_20px_-2px_rgba(79,70,229,0.10)]">
          <p className="text-sm font-semibold text-slate-500">Current voyage</p>
          <h2 className="mt-3 text-3xl font-bold tracking-[-0.04em]">
            Current launch
          </h2>
          <button className="mt-5 min-h-12 w-full rounded-xl bg-slate-950 text-sm font-semibold text-white">
            Open active craft
          </button>
        </section>

        <section className="mt-5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Priority work</span>
            <span>team view</span>
          </div>
          <div className="mt-3 divide-y divide-slate-200 border-y border-slate-200">
            {workItems.map((item) => (
              <button
                key={item.title}
                className="flex min-h-16 w-full items-center justify-between gap-3 py-3 text-left"
              >
                <span>
                  <span className="block text-base font-semibold">{item.title}</span>
                  <span className="mt-1 block text-sm text-slate-500">
                    {item.status}
                  </span>
                </span>
                <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-semibold text-indigo-700">
                  Open
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="mt-5">
          <p className="text-xs font-semibold text-slate-500">Saved views</p>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {savedFilters.map((filter, index) => (
              <button
                key={filter}
                className={`min-h-11 shrink-0 rounded-full px-4 text-sm font-semibold ${
                  index === 0
                    ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-700'
                }`}
              >
                {filter}
              </button>
            ))}
          </div>
        </section>

        <button className="mt-5 min-h-12 w-full rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 text-sm font-semibold text-white shadow-[0_4px_14px_0_rgba(79,70,229,0.30)]">
          New Voyage
        </button>
      </section>
    </main>
  );
}

function MobileEnterpriseLightLaunchpadConcept() {
  return (
    <main className="relative h-[100dvh] overflow-y-auto overflow-x-hidden bg-gradient-to-br from-slate-50 via-white to-indigo-50 text-slate-950">
      <section className="mx-auto min-h-[100dvh] max-w-[430px] px-4 pb-7 pt-[calc(1rem+env(safe-area-inset-top))]">
        <header>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-indigo-600">
            Command review
          </p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-[-0.045em]">
            Workday launchpad
          </h1>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button className="min-h-12 rounded-full bg-gradient-to-r from-indigo-600 to-violet-600 text-sm font-semibold text-white shadow-[0_4px_14px_0_rgba(79,70,229,0.30)]">
              Open craft
            </button>
            <button className="min-h-12 rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700">
              Go Home
            </button>
          </div>
        </header>

        <section className="mt-5 rounded-3xl border border-slate-100 bg-white p-5 shadow-[0_18px_50px_-16px_rgba(79,70,229,0.30)]">
          <p className="text-sm font-semibold text-slate-500">Active voyage</p>
          <h2 className="mt-3 text-3xl font-bold tracking-[-0.04em]">
            Current launch
          </h2>
          <div className="mt-5 grid grid-cols-3 gap-4 border-t border-slate-200 pt-4">
            {[
              ['3', 'Needs'],
              ['2', 'Servers'],
              ['5', 'Views'],
            ].map(([value, label]) => (
              <div key={label}>
                <p className="font-mono text-3xl font-semibold text-indigo-700">
                  {value}
                </p>
                <p className="mt-1 text-xs text-slate-500">{label}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-5 rounded-3xl border border-slate-100 bg-white p-5 shadow-[0_4px_20px_-2px_rgba(79,70,229,0.10)]">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-500">Kanban lane</p>
            <button className="min-h-10 rounded-full border border-slate-200 px-3 text-xs font-semibold text-slate-700">
              New Voyage
            </button>
          </div>
          <div className="mt-4 divide-y divide-slate-200">
            {[
              ['Now', 'Auth bug fix', 'Waiting for approval'],
              ['Next', 'Kanban polish', 'Open craft'],
              ['Later', 'Skin tokens', 'Saved filter'],
            ].map(([column, title, detail]) => (
              <button
                key={column}
                className="grid min-h-16 w-full grid-cols-[56px_minmax(0,1fr)] items-center gap-3 py-3 text-left"
              >
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-indigo-600">
                  {column}
                </span>
                <span>
                  <span className="block text-base font-semibold">{title}</span>
                  <span className="mt-1 block text-sm text-slate-500">
                    {detail}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function VoyageList({ theme }: { theme: DashboardConceptTheme }) {
  const voyages: Array<{ name: string; detail: string; active: boolean }> = [
    { name: 'Current launch', detail: 'Product · Auth bug fix', active: true },
    { name: 'Design review', detail: 'Design · Launch polish', active: false },
    { name: 'Clean browser session', detail: 'No craft selected', active: false },
  ];

  return (
    <div className={theme.voyageList}>
      {voyages.map(({ name, detail, active }) => (
        <button
          key={name}
          className={active ? theme.voyageItemActive : theme.voyageItem}
        >
          <span className={theme.voyageMark} />
          <span>
            <span className={theme.rowTitle}>{name}</span>
            <span className={theme.rowMeta}>{detail}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function FocusTile({
  card,
  theme,
}: {
  card: FocusCard;
  theme: DashboardConceptTheme;
}) {
  return (
    <article className={theme.focusTile}>
      <div className={theme.panelHeader}>
        <span>{card.label}</span>
        <ToneDot tone={card.tone} />
      </div>
      <p className={theme.focusValue}>{card.value}</p>
      <p className={theme.rowMeta}>{card.caption}</p>
    </article>
  );
}

function WorkRow({
  item,
  theme,
}: {
  item: WorkItem;
  theme: DashboardConceptTheme;
}) {
  return (
    <article className={theme.workRow}>
      <div className={theme.workRowTop}>
        <div>
          <p className={theme.rowTitle}>{item.title}</p>
          <p className={theme.rowMeta}>{item.meta}</p>
        </div>
        <ToneDot tone={item.tone} />
      </div>
      <div className={theme.workRowBottom}>
        <span>{item.status}</span>
        <button className={theme.inlineButton}>Open</button>
      </div>
    </article>
  );
}

function ToneDot({ tone }: { tone: Tone }) {
  const toneClass = {
    blue: 'bg-sky-400 shadow-[0_0_18px_rgb(56_189_248_/_0.34)]',
    emerald: 'bg-emerald-400 shadow-[0_0_18px_rgb(52_211_153_/_0.34)]',
    amber: 'bg-amber-300 shadow-[0_0_18px_rgb(252_211_77_/_0.34)]',
    rose: 'bg-rose-400 shadow-[0_0_18px_rgb(251_113_133_/_0.34)]',
    violet: 'bg-violet-400 shadow-[0_0_18px_rgb(167_139_250_/_0.34)]',
    zinc: 'bg-zinc-400 shadow-[0_0_18px_rgb(161_161_170_/_0.24)]',
  }[tone];

  return <span className={`h-2.5 w-2.5 rounded-full ${toneClass}`} />;
}

function applyFontStyle(
  theme: DashboardConceptTheme,
  fontStyle: FontStyle,
): DashboardConceptTheme {
  const titleClass = theme.title ?? '';
  const heroTitleClass = theme.heroTitle ?? '';

  const fontStyles: Record<FontStyle, Record<string, string>> = {
    interfaceSans: {
      page: `${theme.page} font-sans`,
    },
    terminalMono: {
      page: `${theme.page} font-mono`,
      eyebrow: `${theme.eyebrow} font-mono tracking-[0.08em]`,
      title: `${theme.title} font-mono tracking-[-0.06em]`,
      heroTitle: `${theme.heroTitle} font-mono`,
      rowTitle: `${theme.rowTitle} font-mono text-[13px]`,
      primaryButton: `${theme.primaryButton} font-mono`,
      secondaryButton: `${theme.secondaryButton} font-mono`,
      filterPill: `${theme.filterPill} font-mono`,
    },
    compactSans: {
      page: `${theme.page} font-sans`,
      title: titleClass
        .replace('md:text-7xl', 'md:text-6xl')
        .replace('md:text-6xl', 'md:text-5xl'),
      subtitle: `${theme.subtitle} max-w-xl`,
      heroTitle: heroTitleClass.replace('md:text-4xl', 'md:text-3xl'),
      rowTitle: `${theme.rowTitle} text-[13px]`,
      rowMeta: `${theme.rowMeta} text-[11px] leading-4`,
    },
    largeDisplay: {
      page: `${theme.page} font-sans`,
      title: `${theme.title} md:text-7xl`,
      heroTitle: `${theme.heroTitle} md:text-5xl`,
      eyebrow: `${theme.eyebrow} tracking-[0.02em]`,
    },
  };

  return {
    ...theme,
    ...fontStyles[fontStyle],
  };
}

function getTheme(direction: DesignDirection): DashboardConceptTheme {
  const shared = {
    panelHeader:
      'flex items-center justify-between gap-3 text-xs font-medium tracking-wide',
    mutedText: 'text-[11px] font-normal opacity-60',
    heroCopy:
      'mt-3 max-w-[58ch] text-sm leading-6 opacity-72 md:text-[15px]',
    heroActionStack: 'flex flex-wrap items-center gap-2 md:justify-end',
    focusGrid: 'mt-6 grid gap-5 md:grid-cols-3',
    voyageList: 'mt-4 grid gap-2',
    voyageMark: 'mt-1 h-2 w-2 rounded-full bg-current opacity-70',
    workList: 'mt-4 divide-y divide-current/10',
    filterList: 'mt-4 flex flex-wrap gap-2',
    workflowList: 'mt-4 divide-y divide-current/10',
    workRowTop: 'flex items-start justify-between gap-3',
    workRowBottom:
      'mt-4 flex items-center justify-between gap-3 text-xs opacity-78',
    inlineButton:
      'rounded-md border border-current/20 px-2.5 py-1 text-xs font-medium transition hover:border-current/40 active:translate-y-px',
  };

  const variants: Record<DesignDirection, Record<string, string>> = {
    vscode: {
      page: 'relative h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#0d1117] p-4 text-zinc-100 md:p-8',
      backdrop:
        'pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_18%_8%,rgb(14_165_233_/_0.16),transparent_34%),linear-gradient(180deg,rgb(255_255_255_/_0.035),transparent_32%)]',
      shell: 'relative mx-auto max-w-[1440px]',
      header:
        'mb-5 grid gap-4 border-b border-sky-400/15 pb-5 md:grid-cols-[1fr_auto] md:items-end',
      headerActions: 'flex flex-wrap items-center gap-2 md:justify-end',
      eyebrow: 'text-xs font-semibold text-sky-300',
      title:
        'mt-2 max-w-4xl text-4xl font-semibold tracking-[-0.04em] text-white md:text-6xl',
      subtitle: 'mt-3 max-w-2xl text-sm leading-6 text-zinc-400',
      workspaceGrid:
        'grid gap-4 lg:grid-cols-[260px_minmax(0,1.25fr)_minmax(320px,0.75fr)]',
      leftRail:
        'rounded-xl border border-zinc-700/60 bg-[#161b22]/92 p-4 shadow-[0_24px_70px_rgb(0_0_0_/_0.28)]',
      heroPanel:
        'rounded-xl border border-sky-400/20 bg-[#111827]/95 p-5 shadow-[0_24px_80px_rgb(8_47_73_/_0.28)] lg:col-span-2',
      workPanel:
        'rounded-xl border border-zinc-700/60 bg-[#161b22]/92 p-4',
      filterPanel:
        'rounded-xl border border-zinc-700/60 bg-[#161b22]/92 p-4',
      workflowPanel:
        'rounded-xl border border-zinc-700/60 bg-[#161b22]/92 p-4 lg:col-span-2',
      heroTopline:
        'flex flex-wrap items-center justify-between gap-3 text-xs text-sky-200/80',
      heroCopyGrid:
        'mt-6 grid gap-5 md:grid-cols-[1fr_auto] md:items-end',
      heroTitle: 'text-2xl font-semibold tracking-[-0.03em] text-white md:text-4xl',
      primaryButton:
        'rounded-md bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400 active:translate-y-px',
      secondaryButton:
        'rounded-md border border-zinc-600 bg-zinc-900/80 px-4 py-2 text-sm font-medium text-zinc-100 transition hover:border-sky-400/60 active:translate-y-px',
      focusTile:
        'border-t border-zinc-700/70 pt-4',
      focusValue:
        'mt-5 font-mono text-4xl font-semibold tracking-[-0.05em] text-white',
      workRow:
        'py-4 first:pt-0 last:pb-0',
      filterPill:
        'rounded-md border border-zinc-700 bg-zinc-950/44 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-sky-400/60 hover:text-white active:translate-y-px',
      workflowRow:
        'flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0',
      voyageItem:
        'flex w-full items-start gap-3 border-l-2 border-transparent px-3 py-3 text-left text-zinc-400 transition hover:border-zinc-700 hover:text-zinc-100 active:translate-y-px',
      voyageItemActive:
        'flex w-full items-start gap-3 border-l-2 border-sky-400 px-3 py-3 text-left text-sky-100',
      rowTitle: 'block text-sm font-medium text-current',
      rowMeta: 'mt-1 block text-xs leading-5 opacity-58',
      timeText: 'shrink-0 font-mono text-xs opacity-50',
    },
    light: {
      page: 'relative h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#eef3f7] p-4 text-slate-950 md:p-8',
      backdrop:
        'pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_72%_0%,rgb(14_116_144_/_0.12),transparent_30%),linear-gradient(135deg,rgb(255_255_255_/_0.9),transparent_52%)]',
      shell: 'relative mx-auto max-w-[1440px]',
      header:
        'mb-6 grid gap-4 rounded-[1.35rem] border border-white/80 bg-white/68 p-5 shadow-[0_28px_80px_rgb(15_23_42_/_0.10)] backdrop-blur md:grid-cols-[1fr_auto] md:items-end',
      headerActions: 'flex flex-wrap items-center gap-2 md:justify-end',
      eyebrow: 'text-xs font-semibold text-cyan-700',
      title:
        'mt-2 max-w-4xl text-4xl font-semibold tracking-[-0.045em] text-slate-950 md:text-6xl',
      subtitle: 'mt-3 max-w-2xl text-sm leading-6 text-slate-600',
      workspaceGrid:
        'grid gap-4 lg:grid-cols-[280px_minmax(0,1.1fr)_minmax(320px,0.9fr)]',
      leftRail:
        'rounded-[1.25rem] border border-white/80 bg-white/74 p-4 shadow-[0_24px_70px_rgb(15_23_42_/_0.10)] backdrop-blur',
      heroPanel:
        'rounded-[1.4rem] border border-white/80 bg-white/82 p-5 shadow-[0_24px_80px_rgb(15_23_42_/_0.12)] lg:col-span-2',
      workPanel:
        'rounded-[1.25rem] border border-white/80 bg-white/74 p-4 shadow-[0_18px_55px_rgb(15_23_42_/_0.08)]',
      filterPanel:
        'rounded-[1.25rem] border border-white/80 bg-white/74 p-4 shadow-[0_18px_55px_rgb(15_23_42_/_0.08)]',
      workflowPanel:
        'rounded-[1.25rem] border border-white/80 bg-white/74 p-4 shadow-[0_18px_55px_rgb(15_23_42_/_0.08)] lg:col-span-2',
      heroTopline:
        'flex flex-wrap items-center justify-between gap-3 text-xs text-cyan-800',
      heroCopyGrid:
        'mt-6 grid gap-5 md:grid-cols-[1fr_auto] md:items-end',
      heroTitle:
        'text-2xl font-semibold tracking-[-0.035em] text-slate-950 md:text-4xl',
      primaryButton:
        'rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 active:translate-y-px',
      secondaryButton:
        'rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:border-cyan-600 active:translate-y-px',
      focusTile: 'border-t border-slate-200 pt-4',
      focusValue:
        'mt-5 font-mono text-4xl font-semibold tracking-[-0.05em] text-slate-950',
      workRow: 'py-4 first:pt-0 last:pb-0',
      filterPill:
        'rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-cyan-600 hover:text-slate-950 active:translate-y-px',
      workflowRow:
        'flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0',
      voyageItem:
        'flex w-full items-start gap-3 border-l-2 border-transparent px-3 py-3 text-left text-slate-500 transition hover:border-slate-300 hover:text-slate-900 active:translate-y-px',
      voyageItemActive:
        'flex w-full items-start gap-3 border-l-2 border-cyan-600 px-3 py-3 text-left text-cyan-950',
      rowTitle: 'block text-sm font-medium text-current',
      rowMeta: 'mt-1 block text-xs leading-5 opacity-62',
      timeText: 'shrink-0 font-mono text-xs opacity-52',
    },
    premium: {
      page: 'relative h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#090b10] p-4 text-zinc-100 md:p-8',
      backdrop:
        'pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-8%,rgb(34_211_238_/_0.16),transparent_32%),radial-gradient(circle_at_85%_30%,rgb(16_185_129_/_0.10),transparent_28%),linear-gradient(180deg,rgb(255_255_255_/_0.05),transparent_36%)]',
      shell:
        'relative mx-auto max-w-[1460px] rounded-[1.75rem] border border-white/10 bg-white/[0.035] p-4 shadow-[0_30px_120px_rgb(0_0_0_/_0.45)] backdrop-blur',
      header:
        'mb-4 grid gap-4 rounded-[1.35rem] border border-white/10 bg-black/22 p-5 md:grid-cols-[1fr_auto] md:items-end',
      headerActions: 'flex flex-wrap items-center gap-2 md:justify-end',
      eyebrow: 'text-xs font-semibold text-cyan-200',
      title:
        'mt-2 max-w-5xl text-4xl font-semibold tracking-[-0.055em] text-white md:text-7xl',
      subtitle: 'mt-3 max-w-2xl text-sm leading-6 text-zinc-400',
      workspaceGrid:
        'grid gap-4 lg:grid-cols-[290px_minmax(0,1.18fr)_minmax(340px,0.82fr)]',
      leftRail:
        'rounded-[1.25rem] border border-white/10 bg-black/26 p-4',
      heroPanel:
        'rounded-[1.35rem] border border-cyan-200/18 bg-gradient-to-br from-white/[0.11] to-white/[0.035] p-5 shadow-[0_28px_100px_rgb(8_145_178_/_0.14)] lg:col-span-2',
      workPanel:
        'rounded-[1.25rem] border border-white/10 bg-black/26 p-4',
      filterPanel:
        'rounded-[1.25rem] border border-white/10 bg-black/26 p-4',
      workflowPanel:
        'rounded-[1.25rem] border border-white/10 bg-black/26 p-4 lg:col-span-2',
      heroTopline:
        'flex flex-wrap items-center justify-between gap-3 text-xs text-cyan-100/80',
      heroCopyGrid:
        'mt-6 grid gap-5 md:grid-cols-[1fr_auto] md:items-end',
      heroTitle: 'text-2xl font-semibold tracking-[-0.04em] text-white md:text-4xl',
      primaryButton:
        'rounded-full bg-cyan-200 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-100 active:translate-y-px',
      secondaryButton:
        'rounded-full border border-white/14 bg-white/[0.06] px-4 py-2 text-sm font-medium text-zinc-100 transition hover:border-cyan-200/50 active:translate-y-px',
      focusTile:
        'border-t border-white/10 pt-4',
      focusValue:
        'mt-5 font-mono text-4xl font-semibold tracking-[-0.05em] text-white',
      workRow:
        'py-4 first:pt-0 last:pb-0',
      filterPill:
        'rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-cyan-200/50 hover:text-white active:translate-y-px',
      workflowRow:
        'flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0',
      voyageItem:
        'flex w-full items-start gap-3 border-l-2 border-transparent px-3 py-3 text-left text-zinc-400 transition hover:border-white/25 hover:text-white active:translate-y-px',
      voyageItemActive:
        'flex w-full items-start gap-3 border-l-2 border-cyan-200 px-3 py-3 text-left text-cyan-50',
      rowTitle: 'block text-sm font-medium text-current',
      rowMeta: 'mt-1 block text-xs leading-5 opacity-58',
      timeText: 'shrink-0 font-mono text-xs opacity-50',
    },
    enterprise: {
      page: 'relative h-[100dvh] overflow-y-auto overflow-x-hidden bg-[#f5f7fb] p-4 text-slate-950 md:p-8',
      backdrop:
        'pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgb(37_99_235_/_0.08),transparent_35%),linear-gradient(180deg,white,transparent_48%)]',
      shell: 'relative mx-auto max-w-[1440px]',
      header:
        'mb-5 grid gap-4 border-b border-slate-200 bg-white p-5 shadow-sm md:grid-cols-[1fr_auto] md:items-end',
      headerActions: 'flex flex-wrap items-center gap-2 md:justify-end',
      eyebrow: 'text-xs font-semibold text-blue-700',
      title:
        'mt-2 max-w-4xl text-4xl font-semibold tracking-[-0.04em] text-slate-950 md:text-6xl',
      subtitle: 'mt-3 max-w-2xl text-sm leading-6 text-slate-600',
      workspaceGrid:
        'grid gap-4 lg:grid-cols-[280px_minmax(0,1.1fr)_minmax(330px,0.9fr)]',
      leftRail: 'border border-slate-200 bg-white p-4 shadow-sm',
      heroPanel:
        'border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2',
      workPanel: 'border border-slate-200 bg-white p-4 shadow-sm',
      filterPanel: 'border border-slate-200 bg-white p-4 shadow-sm',
      workflowPanel:
        'border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2',
      heroTopline:
        'flex flex-wrap items-center justify-between gap-3 text-xs text-blue-700',
      heroCopyGrid:
        'mt-6 grid gap-5 md:grid-cols-[1fr_auto] md:items-end',
      heroTitle:
        'text-2xl font-semibold tracking-[-0.03em] text-slate-950 md:text-4xl',
      primaryButton:
        'rounded-sm bg-blue-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-800 active:translate-y-px',
      secondaryButton:
        'rounded-sm border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 transition hover:border-blue-700 active:translate-y-px',
      focusTile: 'border-t border-slate-200 pt-4',
      focusValue:
        'mt-5 font-mono text-4xl font-semibold tracking-[-0.05em] text-slate-950',
      workRow: 'py-4 first:pt-0 last:pb-0',
      filterPill:
        'rounded-sm border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-blue-700 hover:text-slate-950 active:translate-y-px',
      workflowRow:
        'flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0',
      voyageItem:
        'flex w-full items-start gap-3 border-l-2 border-transparent px-3 py-3 text-left text-slate-500 transition hover:border-slate-300 hover:text-slate-900 active:translate-y-px',
      voyageItemActive:
        'flex w-full items-start gap-3 border-l-2 border-blue-700 px-3 py-3 text-left text-blue-950',
      rowTitle: 'block text-sm font-medium text-current',
      rowMeta: 'mt-1 block text-xs leading-5 opacity-62',
      timeText: 'shrink-0 font-mono text-xs opacity-52',
    },
  };

  return {
    ...shared,
    ...variants[direction],
  };
}
