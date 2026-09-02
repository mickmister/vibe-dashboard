import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  CreateFirstVoyageScene,
  DuplicateCraftPromptDialog,
  ExpandedCraftStrip,
  MobileCraftMenu,
  MobileCraftStrip,
  NewVoyagePromptDialog,
  PendingOpenCraftContent,
  PendingOpenCraftVoyageTab,
  VoyageActionsMenu,
  VoyageBarView,
  VoyageNotFoundScene,
  VoyageSwitcherDialog,
  type ExpandedCraftItem,
  type WorkspaceShellVoyageItem,
} from './WorkspaceShellScenes';
import {
  storybookSavedSessions,
  storybookSpaces,
  storybookTabGroups,
  storybookVoyageEntries,
} from '../stories/fixtures';
import type { SavedWorkspaceSession } from '../types';

const noop = () => undefined;
const asyncEvent = (name: string) => () => console.info(name);

const agentVoyageEntry = storybookVoyageEntries[0]!;
const docsVoyageEntry = storybookVoyageEntries[1]!;
const currentSavedSession = storybookSavedSessions[0]!;
const designSavedSession = storybookSavedSessions[1]!;

const voyageItems: WorkspaceShellVoyageItem[] = [
  {
    entry: agentVoyageEntry,
    space: storybookSpaces.product,
    tabGroup: storybookTabGroups.agent,
  },
  {
    entry: docsVoyageEntry,
    space: storybookSpaces.product,
    tabGroup: storybookTabGroups.docs,
  },
  {
    entry: {
      id: 'voyage_entry_design',
      tabGroupId: storybookTabGroups.design.id,
      viewIds: ['tab_figma'],
    },
    space: storybookSpaces.design,
    tabGroup: storybookTabGroups.design,
  },
];

const expandedItems: ExpandedCraftItem[] = [
  { kind: 'tab', id: 'tab_agent', label: 'Agent', isActive: true },
  { kind: 'tab', id: 'tab_code', label: 'Code', isActive: false },
  { kind: 'tab', id: 'tab_preview', label: 'Preview', isActive: false },
  { kind: 'pair', id: 'pair_agent_code', label: 'Agent + Code', isActive: false },
];

const savedSessions: SavedWorkspaceSession[] = [currentSavedSession, designSavedSession];

const meta: Meta = {
  title: 'Scenes/WorkspaceShell',
  decorators: [
    (Story) => (
      <div className="min-h-[720px] bg-neutral-950 p-6 text-neutral-100">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

export const DesktopVoyageBar: Story = {
  render: () => (
    <div className="h-20 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      <VoyageBarView
        items={voyageItems}
        activeVoyageEntryId="voyage_entry_agent"
        isPendingOpenCraftActive={false}
        voyagePlusMenuOpen={false}
        onOpenSidebar={asyncEvent('open sidebar')}
        onToggleVoyageActions={asyncEvent('toggle voyage actions')}
        onHide={asyncEvent('hide voyage bar')}
        onSelectItem={(item) => console.info('select voyage item', item)}
        onContextMenuItem={(event, item) => {
          event.preventDefault();
          console.info('context menu item', item);
        }}
        onDragStartItem={noop}
        onDragOver={(event) => event.preventDefault()}
        onDropItem={noop}
        onRetryPendingOpenCraft={asyncEvent('retry pending craft')}
        onClosePendingOpenCraft={asyncEvent('close pending craft')}
        getEmoji={(tabGroup) => tabGroup.mobileEmoji || '🚀'}
      />
    </div>
  ),
};

export const DesktopVoyageBarWithPendingCraft: Story = {
  render: () => (
    <div className="h-20 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      <VoyageBarView
        items={voyageItems}
        activeVoyageEntryId="voyage_entry_agent"
        isPendingOpenCraftActive
        voyagePlusMenuOpen
        pendingOpenCraftTab={{ label: 'Kanban polish', status: 'pending' }}
        onOpenSidebar={noop}
        onToggleVoyageActions={noop}
        onHide={noop}
        onSelectItem={noop}
        onContextMenuItem={(event) => event.preventDefault()}
        onDragStartItem={noop}
        onDragOver={(event) => event.preventDefault()}
        onDropItem={noop}
        onRetryPendingOpenCraft={noop}
        onClosePendingOpenCraft={noop}
        getEmoji={(tabGroup) => tabGroup.mobileEmoji || '🚀'}
      />
    </div>
  ),
};

export const VoyageActionsMenuOpen: Story = {
  render: () => (
    <VoyageActionsMenu
      position={{ left: 48, top: 48 }}
      onNewCraft={asyncEvent('new craft')}
      onOpenCraft={asyncEvent('open craft')}
      onSwitchVoyage={asyncEvent('switch voyage')}
    />
  ),
};

export const VoyageSwitcher: Story = {
  render: () => (
    <VoyageSwitcherDialog
      sessions={savedSessions}
      currentSessionId={currentSavedSession.id}
      renamingSessionId={null}
      renameDraft=""
      onRenameDraftChange={noop}
      onSelect={(sessionId) => console.info('select voyage', sessionId)}
      onGoHome={asyncEvent('go home')}
      onStartRename={(session) => console.info('rename voyage', session.id)}
      onCancelRename={noop}
      onSubmitRename={(sessionId) => console.info('submit rename', sessionId)}
      onNewVoyage={asyncEvent('new voyage')}
      onCancel={noop}
      onBackdropClick={(event) => event.stopPropagation()}
      getVoyageDisplayName={(session) => session.name || 'Untitled voyage'}
      isRenameInvalid={(draft) => !draft.trim() || draft.trim().toLowerCase() === 'home'}
    />
  ),
};

export const VoyageSwitcherRenaming: Story = {
  render: () => (
    <VoyageSwitcherDialog
      sessions={savedSessions}
      currentSessionId={currentSavedSession.id}
      renamingSessionId={designSavedSession.id}
      renameDraft="Design review"
      onRenameDraftChange={noop}
      onSelect={noop}
      onGoHome={noop}
      onStartRename={noop}
      onCancelRename={noop}
      onSubmitRename={noop}
      onNewVoyage={noop}
      onCancel={noop}
      onBackdropClick={(event) => event.stopPropagation()}
      getVoyageDisplayName={(session) => session.name || 'Untitled voyage'}
      isRenameInvalid={(draft) => !draft.trim() || draft.trim().toLowerCase() === 'home'}
    />
  ),
};

export const VoyageSwitcherEmpty: Story = {
  render: () => (
    <VoyageSwitcherDialog
      sessions={[]}
      currentSessionId="missing"
      renamingSessionId={null}
      renameDraft=""
      onRenameDraftChange={noop}
      onSelect={noop}
      onGoHome={noop}
      onStartRename={noop}
      onCancelRename={noop}
      onSubmitRename={noop}
      onNewVoyage={noop}
      onCancel={noop}
      onBackdropClick={(event) => event.stopPropagation()}
      getVoyageDisplayName={(session) => session.name || 'Untitled voyage'}
      isRenameInvalid={(draft) => !draft.trim() || draft.trim().toLowerCase() === 'home'}
    />
  ),
};

export const NewVoyagePrompt: Story = {
  render: () => (
    <NewVoyagePromptDialog
      name="Launch polish"
      isNameInvalid={false}
      onNameChange={(value) => console.info('voyage name', value)}
      onCancel={noop}
      onCreateNewCraft={noop}
      onOpenExistingCraft={noop}
      onBackdropClick={(event) => event.stopPropagation()}
    />
  ),
};

export const NewVoyagePromptInvalid: Story = {
  render: () => (
    <NewVoyagePromptDialog
      name="Home"
      isNameInvalid
      onNameChange={noop}
      onCancel={noop}
      onCreateNewCraft={noop}
      onOpenExistingCraft={noop}
      onBackdropClick={(event) => event.stopPropagation()}
    />
  ),
};

export const DuplicateCraftPrompt: Story = {
  render: () => (
    <DuplicateCraftPromptDialog
      craftLabel="Auth bug fix"
      currentEntries={[agentVoyageEntry]}
      activeVoyageEntryId={agentVoyageEntry.id}
      otherVoyages={[{ session: designSavedSession, entryId: 'voyage_entry_design' }]}
      onSwitchCurrent={(entryId) => console.info('switch current', entryId)}
      onSwitchOtherVoyage={(sessionId, entryId) =>
        console.info('switch other', { sessionId, entryId })
      }
      onOpenInNewVoyage={noop}
      onCancel={noop}
    />
  ),
};

export const PendingOpenCraftMainContent: Story = {
  render: () => (
    <div className="h-[420px] overflow-hidden rounded-lg border border-neutral-800">
      <PendingOpenCraftContent
        tab={{ label: 'Kanban polish', status: 'pending' }}
        onRetry={noop}
        onClose={noop}
      />
    </div>
  ),
};

export const PendingOpenCraftErrorContent: Story = {
  render: () => (
    <div className="h-[420px] overflow-hidden rounded-lg border border-neutral-800">
      <PendingOpenCraftContent
        tab={{
          label: 'Kanban polish',
          status: 'error',
          errorMessage: 'Could not allocate this craft. Please retry.',
        }}
        onRetry={noop}
        onClose={noop}
      />
    </div>
  ),
};

export const PendingOpenCraftTabs: Story = {
  render: () => (
    <div className="flex h-10 items-stretch overflow-hidden rounded-lg border border-neutral-800 bg-neutral-900">
      <PendingOpenCraftVoyageTab
        tab={{ label: 'Kanban polish', status: 'pending' }}
        compact={false}
        active
        onRetry={noop}
        onClose={noop}
      />
      <PendingOpenCraftVoyageTab
        tab={{ label: 'Docs refresh', status: 'error', errorMessage: 'Open failed' }}
        compact={false}
        onRetry={noop}
        onClose={noop}
      />
    </div>
  ),
};

export const ExpandedDesktopCraftStrip: Story = {
  render: () => (
    <div className="h-20 overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      <ExpandedCraftStrip
        items={expandedItems}
        onSelect={(item) => console.info('select expanded item', item)}
      />
    </div>
  ),
};

export const ExpandedMobileCraftStrip: Story = {
  render: () => (
    <div className="relative h-[420px] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      <ExpandedCraftStrip
        items={expandedItems.filter((item) => item.kind === 'tab')}
        mobile
        onSelect={(item) => console.info('select expanded item', item)}
      />
    </div>
  ),
};

export const MobileCraftStripManyCrafts: Story = {
  render: () => (
    <div className="relative h-[420px] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      <MobileCraftStrip
        items={voyageItems}
        activeVoyageEntryId="voyage_entry_agent"
        activeTabGroupLabel="Auth bug fix"
        isPendingOpenCraftActive={false}
        voyagePlusMenuOpen={false}
        onOpenSidebar={noop}
        onToggleVoyageActions={noop}
        onSelectItem={(item) => console.info('select mobile item', item)}
        onOpenItemMenu={(item) => console.info('open mobile menu', item)}
        onPointerDownItem={noop}
        onPointerMove={noop}
        onClearLongPress={noop}
        onRetryPendingOpenCraft={noop}
        onClosePendingOpenCraft={noop}
        getLabel={(tabGroup) => tabGroup.mobileLabel || tabGroup.label}
        getEmoji={(tabGroup) => tabGroup.mobileEmoji || '🚀'}
      />
    </div>
  ),
};

export const MobileCraftStripEmptyPending: Story = {
  render: () => (
    <div className="relative h-[420px] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      <MobileCraftStrip
        items={[]}
        activeTabGroupLabel="No craft"
        isPendingOpenCraftActive
        voyagePlusMenuOpen
        pendingOpenCraftTab={{ label: 'Kanban polish', status: 'pending' }}
        onOpenSidebar={noop}
        onToggleVoyageActions={noop}
        onSelectItem={noop}
        onOpenItemMenu={noop}
        onPointerDownItem={noop}
        onPointerMove={noop}
        onClearLongPress={noop}
        onRetryPendingOpenCraft={noop}
        onClosePendingOpenCraft={noop}
        getLabel={(tabGroup) => tabGroup.mobileLabel || tabGroup.label}
        getEmoji={(tabGroup) => tabGroup.mobileEmoji || '🚀'}
      />
    </div>
  ),
};

export const MobileCraftMenuOpen: Story = {
  render: () => (
    <div className="relative h-[520px] overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950">
      <MobileCraftMenu
        tabGroup={storybookTabGroups.agent}
        draftLabel="Auth"
        draftEmoji="🛠️"
        emojiChoices={['🚀', '🧠', '💻', '🛠️', '📚', '🎯']}
        canMoveToAnotherVoyage
        closeWarning="Close this craft everywhere?"
        onDraftLabelChange={noop}
        onDraftEmojiChange={noop}
        onChooseEmoji={noop}
        onCancel={noop}
        onSave={noop}
        onMoveToVoyage={noop}
        onRemoveFromVoyage={noop}
        onCloseCraft={noop}
        onCloseOverlay={noop}
      />
    </div>
  ),
};

export const CreateFirstVoyage: Story = {
  render: () => (
    <CreateFirstVoyageScene
      onCreateNewCraft={noop}
      onOpenExistingCraft={noop}
    />
  ),
};

export const VoyageNotFound: Story = {
  render: () => (
    <VoyageNotFoundScene
      voyageName="missing-launch"
      onGoHome={noop}
      onSwitchVoyage={noop}
    />
  ),
};
