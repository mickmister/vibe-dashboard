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
    focusGrid: 'mt-6 grid gap-3 md:grid-cols-3',
    voyageList: 'mt-4 grid gap-2',
    voyageMark: 'mt-1 h-2 w-2 rounded-full bg-current opacity-70',
    workList: 'mt-4 grid gap-3',
    filterList: 'mt-4 flex flex-wrap gap-2',
    workflowList: 'mt-4 grid gap-2',
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
        'rounded-lg border border-zinc-700/70 bg-zinc-950/36 p-4',
      focusValue:
        'mt-5 font-mono text-4xl font-semibold tracking-[-0.05em] text-white',
      workRow:
        'rounded-lg border border-zinc-700/60 bg-zinc-950/34 p-4',
      filterPill:
        'rounded-md border border-zinc-700 bg-zinc-950/44 px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-sky-400/60 hover:text-white active:translate-y-px',
      workflowRow:
        'flex items-center justify-between gap-4 rounded-lg border border-zinc-700/50 bg-zinc-950/30 px-3 py-3',
      voyageItem:
        'flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-3 text-left text-zinc-400 transition hover:border-zinc-700 hover:bg-zinc-950/30 active:translate-y-px',
      voyageItemActive:
        'flex w-full items-start gap-3 rounded-lg border border-sky-400/35 bg-sky-400/10 px-3 py-3 text-left text-sky-100 shadow-[inset_3px_0_0_rgb(56_189_248)]',
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
      focusTile: 'rounded-2xl border border-slate-200 bg-slate-50 p-4',
      focusValue:
        'mt-5 font-mono text-4xl font-semibold tracking-[-0.05em] text-slate-950',
      workRow: 'rounded-2xl border border-slate-200 bg-slate-50 p-4',
      filterPill:
        'rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-cyan-600 hover:text-slate-950 active:translate-y-px',
      workflowRow:
        'flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3',
      voyageItem:
        'flex w-full items-start gap-3 rounded-xl border border-transparent px-3 py-3 text-left text-slate-500 transition hover:border-slate-200 hover:bg-slate-50 active:translate-y-px',
      voyageItemActive:
        'flex w-full items-start gap-3 rounded-xl border border-cyan-500/30 bg-cyan-50 px-3 py-3 text-left text-cyan-950 shadow-[inset_3px_0_0_rgb(8_145_178)]',
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
        'rounded-[1rem] border border-white/10 bg-black/24 p-4 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.08)]',
      focusValue:
        'mt-5 font-mono text-4xl font-semibold tracking-[-0.05em] text-white',
      workRow:
        'rounded-[1rem] border border-white/10 bg-black/24 p-4 shadow-[inset_0_1px_0_rgb(255_255_255_/_0.07)]',
      filterPill:
        'rounded-full border border-white/10 bg-white/[0.05] px-3 py-2 text-xs font-medium text-zinc-300 transition hover:border-cyan-200/50 hover:text-white active:translate-y-px',
      workflowRow:
        'flex items-center justify-between gap-4 rounded-[1rem] border border-white/10 bg-black/22 px-3 py-3',
      voyageItem:
        'flex w-full items-start gap-3 rounded-[1rem] border border-transparent px-3 py-3 text-left text-zinc-400 transition hover:border-white/10 hover:bg-white/[0.045] active:translate-y-px',
      voyageItemActive:
        'flex w-full items-start gap-3 rounded-[1rem] border border-cyan-200/25 bg-cyan-200/10 px-3 py-3 text-left text-cyan-50 shadow-[inset_0_0_0_1px_rgb(103_232_249_/_0.12)]',
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
      focusTile: 'border border-slate-200 bg-slate-50 p-4',
      focusValue:
        'mt-5 font-mono text-4xl font-semibold tracking-[-0.05em] text-slate-950',
      workRow: 'border border-slate-200 bg-slate-50 p-4',
      filterPill:
        'rounded-sm border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-blue-700 hover:text-slate-950 active:translate-y-px',
      workflowRow:
        'flex items-center justify-between gap-4 border border-slate-200 bg-slate-50 px-3 py-3',
      voyageItem:
        'flex w-full items-start gap-3 border border-transparent px-3 py-3 text-left text-slate-500 transition hover:border-slate-200 hover:bg-slate-50 active:translate-y-px',
      voyageItemActive:
        'flex w-full items-start gap-3 border border-blue-700/20 bg-blue-50 px-3 py-3 text-left text-blue-950 shadow-[inset_3px_0_0_rgb(29_78_216)]',
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
