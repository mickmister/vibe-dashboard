import type { Meta, StoryObj } from '@storybook/react-vite';
import { HorizontalTabGroupsV2, type HorizontalTabGroupsV2State } from './HorizontalTabGroupsV2';

const meta = {
  title: 'HorizontalTabGroupsV2',
  component: HorizontalTabGroupsV2,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof HorizontalTabGroupsV2>;

export default meta;
type Story = StoryObj<typeof meta>;

const sampleState: HorizontalTabGroupsV2State = {
  groups: [
    {
      id: 'work',
      label: 'Work',
      color: '#4285f4',
      collapsed: false,
    },
    {
      id: 'dev',
      label: 'Development',
      color: '#ea4335',
      collapsed: false,
    },
    {
      id: 'personal',
      label: 'Personal',
      color: '#34a853',
      collapsed: true,
    },
  ],
  tabs: [
    { id: 'w1', title: 'Gmail', groupId: 'work', active: true, loaded: true },
    { id: 'w2', title: 'Google Drive', groupId: 'work', active: false, loaded: false },
    { id: 'w3', title: 'Calendar', groupId: 'work', active: false, loaded: false },
    { id: 'd1', title: 'GitHub', groupId: 'dev', active: false, loaded: true },
    { id: 'd2', title: 'Stack Overflow', groupId: 'dev', active: false, loaded: false },
    { id: 'd3', title: 'localhost:3000', groupId: 'dev', active: false, loaded: false },
    { id: 'p1', title: 'YouTube', groupId: 'personal', active: false, loaded: false },
    { id: 'p2', title: 'Reddit', groupId: 'personal', active: false, loaded: false },
    { id: 'p3', title: 'Twitter', groupId: 'personal', active: false, loaded: false },
  ],
};

export const BasicUsage: Story = {
  render: () => <HorizontalTabGroupsV2 initialState={sampleState} />,
};

export const AllExpanded: Story = {
  render: () => {
    const allExpandedState: HorizontalTabGroupsV2State = {
      ...sampleState,
      groups: sampleState.groups.map((g) => ({ ...g, collapsed: false })),
    };
    return <HorizontalTabGroupsV2 initialState={allExpandedState} />;
  },
};

export const MostlyCollapsed: Story = {
  render: () => {
    const collapsedState: HorizontalTabGroupsV2State = {
      ...sampleState,
      groups: sampleState.groups.map((g, i) => ({ ...g, collapsed: i !== 0 })),
    };
    return <HorizontalTabGroupsV2 initialState={collapsedState} />;
  },
};

export const DarkMode: Story = {
  render: () => <HorizontalTabGroupsV2 initialState={sampleState} darkMode={true} />,
  parameters: {
    backgrounds: { default: 'dark' },
  },
};

export const ManyGroups: Story = {
  render: () => {
    const manyGroupsState: HorizontalTabGroupsV2State = {
      groups: [
        { id: 'g1', label: 'Work', color: '#4285f4', collapsed: false },
        { id: 'g2', label: 'Dev', color: '#ea4335', collapsed: true },
        { id: 'g3', label: 'Research', color: '#34a853', collapsed: true },
        { id: 'g4', label: 'Design', color: '#fbbc04', collapsed: true },
        { id: 'g5', label: 'Social', color: '#9334e6', collapsed: true },
      ],
      tabs: [
        { id: 'g1t1', title: 'Email', groupId: 'g1', active: true },
        { id: 'g1t2', title: 'Docs', groupId: 'g1', active: false },
        { id: 'g2t1', title: 'GitHub', groupId: 'g2', active: false },
        { id: 'g2t2', title: 'Terminal', groupId: 'g2', active: false },
        { id: 'g3t1', title: 'Article 1', groupId: 'g3', active: false },
        { id: 'g3t2', title: 'Article 2', groupId: 'g3', active: false },
        { id: 'g4t1', title: 'Figma', groupId: 'g4', active: false },
        { id: 'g4t2', title: 'Sketch', groupId: 'g4', active: false },
        { id: 'g5t1', title: 'Twitter', groupId: 'g5', active: false },
        { id: 'g5t2', title: 'LinkedIn', groupId: 'g5', active: false },
      ],
    };
    return <HorizontalTabGroupsV2 initialState={manyGroupsState} />;
  },
};

export const InteractiveDemo: Story = {
  render: () => {
    return (
      <div>
        <HorizontalTabGroupsV2 initialState={sampleState} />
        <div style={{ padding: '20px', fontFamily: 'monospace', fontSize: '12px' }}>
          <h3>Interactive Features</h3>
          <ul>
            <li><strong>Click group label</strong> to collapse/expand horizontally</li>
            <li><strong>Click tab</strong> to activate it (marks as loaded on first activation)</li>
            <li><strong>Right-click tab</strong> to open context menu:
              <ul>
                <li>Duplicate Tab - creates a copy after current tab</li>
                <li>New Tab in Group - adds new tab to same group</li>
                <li>Close Tab - shows confirm dialog only if tab is loaded in memory</li>
              </ul>
            </li>
            <li><strong>Hover over tab</strong> to see close button (visual only - use right-click to close)</li>
            <li><strong>Drag tabs</strong> to reorder (chrome-tabs handles this)</li>
          </ul>
          <h3>Architecture</h3>
          <ul>
            <li>Single ChromeTabs instance manages all rendering</li>
            <li>Group labels are special "tabs" in the tab list</li>
            <li>Collapsed groups simply hide their tabs from visual list</li>
            <li>All chrome-tabs features work (drag, size, scroll, etc.)</li>
          </ul>
          <h3>Lazy Loading Strategy</h3>
          <ul>
            <li>Tabs NOT loaded until first activation (saves memory)</li>
            <li>Once loaded, iframes stay in memory with display:none</li>
            <li>Close dialog only shown for loaded tabs (has iframe)</li>
            <li>Use React Portals to render iframes off-screen</li>
            <li>Loading indicator shown until iframe onLoad fires</li>
          </ul>
        </div>
      </div>
    );
  },
};
