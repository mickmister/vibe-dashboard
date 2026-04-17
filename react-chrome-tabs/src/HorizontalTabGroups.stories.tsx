import type { Meta, StoryObj } from '@storybook/react-vite';
import { HorizontalTabGroups, type HorizontalTabGroupsState } from './HorizontalTabGroups';

const meta = {
  title: 'HorizontalTabGroups',
  component: HorizontalTabGroups,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof HorizontalTabGroups>;

export default meta;
type Story = StoryObj<typeof meta>;

const sampleState: HorizontalTabGroupsState = {
  groups: [
    {
      id: 'work',
      label: 'Work',
      color: '#4285f4',
      collapsed: false,
      tabs: [
        { id: 'w1', title: 'Gmail', favicon: 'https://www.google.com/favicon.ico', active: true },
        { id: 'w2', title: 'Google Drive', favicon: 'https://www.google.com/favicon.ico', active: false },
        { id: 'w3', title: 'Calendar', active: false },
      ],
    },
    {
      id: 'dev',
      label: 'Development',
      color: '#ea4335',
      collapsed: false,
      tabs: [
        { id: 'd1', title: 'GitHub', favicon: 'https://github.com/favicon.ico', active: false },
        { id: 'd2', title: 'Stack Overflow', favicon: 'https://stackoverflow.com/favicon.ico', active: false },
        { id: 'd3', title: 'localhost:3000', active: false },
      ],
    },
    {
      id: 'personal',
      label: 'Personal',
      color: '#34a853',
      collapsed: true,
      tabs: [
        { id: 'p1', title: 'YouTube', active: false },
        { id: 'p2', title: 'Reddit', active: false },
        { id: 'p3', title: 'Twitter', active: false },
      ],
    },
  ],
  activeTabReferences: [],
};

const stateWithActiveTabs: HorizontalTabGroupsState = {
  groups: [
    {
      id: 'work',
      label: 'Work',
      color: '#4285f4',
      collapsed: false,
      tabs: [
        { id: 'w1', title: 'Gmail', favicon: 'https://www.google.com/favicon.ico', active: false },
        { id: 'w2', title: 'Google Drive', favicon: 'https://www.google.com/favicon.ico', active: true },
        { id: 'w3', title: 'Calendar', active: false },
      ],
    },
    {
      id: 'dev',
      label: 'Development',
      color: '#ea4335',
      collapsed: true,
      tabs: [
        { id: 'd1', title: 'GitHub', favicon: 'https://github.com/favicon.ico', active: false },
        { id: 'd2', title: 'Stack Overflow', favicon: 'https://stackoverflow.com/favicon.ico', active: false },
        { id: 'd3', title: 'localhost:3000', active: false },
        { id: 'd4', title: 'Storybook', active: false },
      ],
    },
    {
      id: 'design',
      label: 'Design',
      color: '#fbbc04',
      collapsed: true,
      tabs: [
        { id: 'ds1', title: 'Figma', active: false },
        { id: 'ds2', title: 'Design System', active: false },
      ],
    },
  ],
  activeTabReferences: [
    {
      id: 'ref1',
      originalTabId: 'w2',
      originalGroupId: 'work',
      customName: 'Q1 Planning Doc',
    },
    {
      id: 'ref2',
      originalTabId: 'd3',
      originalGroupId: 'dev',
    },
    {
      id: 'ref3',
      originalTabId: 'ds1',
      originalGroupId: 'design',
      customName: 'Landing Page Design',
    },
  ],
};

export const BasicUsage: Story = {
  render: () => <HorizontalTabGroups initialState={sampleState} />,
};

export const WithActiveTabs: Story = {
  render: () => <HorizontalTabGroups initialState={stateWithActiveTabs} />,
};

export const DarkMode: Story = {
  render: () => <HorizontalTabGroups initialState={stateWithActiveTabs} darkMode={true} />,
  parameters: {
    backgrounds: { default: 'dark' },
  },
};

export const ManyGroups: Story = {
  render: () => {
    const manyGroupsState: HorizontalTabGroupsState = {
      groups: [
        {
          id: 'g1',
          label: 'Work',
          color: '#4285f4',
          collapsed: false,
          tabs: [
            { id: 'g1t1', title: 'Email', active: true },
            { id: 'g1t2', title: 'Docs', active: false },
          ],
        },
        {
          id: 'g2',
          label: 'Development',
          color: '#ea4335',
          collapsed: true,
          tabs: [
            { id: 'g2t1', title: 'GitHub', active: false },
            { id: 'g2t2', title: 'Terminal', active: false },
            { id: 'g2t3', title: 'Database', active: false },
          ],
        },
        {
          id: 'g3',
          label: 'Research',
          color: '#34a853',
          collapsed: true,
          tabs: [
            { id: 'g3t1', title: 'Article 1', active: false },
            { id: 'g3t2', title: 'Article 2', active: false },
            { id: 'g3t3', title: 'Article 3', active: false },
            { id: 'g3t4', title: 'Article 4', active: false },
          ],
        },
        {
          id: 'g4',
          label: 'Design',
          color: '#fbbc04',
          collapsed: true,
          tabs: [
            { id: 'g4t1', title: 'Figma', active: false },
            { id: 'g4t2', title: 'Sketch', active: false },
          ],
        },
        {
          id: 'g5',
          label: 'Social',
          color: '#9334e6',
          collapsed: true,
          tabs: [
            { id: 'g5t1', title: 'Twitter', active: false },
            { id: 'g5t2', title: 'LinkedIn', active: false },
          ],
        },
      ],
      activeTabReferences: [
        { id: 'ref1', originalTabId: 'g1t1', originalGroupId: 'g1' },
        { id: 'ref2', originalTabId: 'g2t1', originalGroupId: 'g2', customName: 'PR Review' },
      ],
    };
    return <HorizontalTabGroups initialState={manyGroupsState} />;
  },
};

export const InteractiveDemo: Story = {
  render: () => {
    return (
      <div>
        <HorizontalTabGroups initialState={sampleState} />
        <div style={{ padding: '20px', fontFamily: 'monospace', fontSize: '12px' }}>
          <h3>Interactive Features</h3>
          <ul>
            <li>Click group label to collapse/expand horizontally</li>
            <li>Click tabs to activate them</li>
            <li>Right-click any tab → "Add to Active Tabs"</li>
            <li>Right-click active tab → "Reveal in Main Tabs" (expands parent group)</li>
            <li>Right-click active tab → "Rename" (custom name persists)</li>
            <li>Close button on active tab → Choose "Remove from Active Tabs" or "Close Completely"</li>
          </ul>
          <h3>Visual Indicators</h3>
          <ul>
            <li>Active tabs have blue border and glow effect</li>
            <li>Active tabs show custom names if renamed</li>
            <li>Collapsed groups show tab count</li>
            <li>Groups separated by color-coded dots</li>
          </ul>
        </div>
      </div>
    );
  },
};
