import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { TabGroup, type TabGroupData } from './TabGroup';

const meta = {
  title: 'TabGroup',
  component: TabGroup,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof TabGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

// Sample tab groups with Chrome-style color coding
const sampleGroups: TabGroupData[] = [
  {
    id: 'work',
    label: 'Work',
    color: '#4285f4', // Blue
    collapsed: false,
    tabs: [
      { id: 'w1', title: 'Gmail', favicon: 'https://www.google.com/favicon.ico', active: true },
      { id: 'w2', title: 'Google Drive', favicon: 'https://www.google.com/favicon.ico', active: false },
      { id: 'w3', title: 'Calendar', favicon: 'https://www.google.com/favicon.ico', active: false },
    ],
  },
  {
    id: 'dev',
    label: 'Development',
    color: '#ea4335', // Red
    collapsed: false,
    tabs: [
      { id: 'd1', title: 'GitHub', favicon: 'https://github.com/favicon.ico', active: false },
      { id: 'd2', title: 'Stack Overflow', favicon: 'https://stackoverflow.com/favicon.ico', active: false },
      { id: 'd3', title: 'localhost:3000', active: false },
      { id: 'd4', title: 'MDN Web Docs', active: false },
    ],
  },
  {
    id: 'personal',
    label: 'Personal',
    color: '#34a853', // Green
    collapsed: true,
    tabs: [
      { id: 'p1', title: 'YouTube', active: false },
      { id: 'p2', title: 'Reddit', active: false },
      { id: 'p3', title: 'Twitter', active: false },
    ],
  },
  {
    id: 'research',
    label: 'Q1 Research',
    color: '#fbbc04', // Yellow
    collapsed: true,
    tabs: [
      { id: 'r1', title: 'Article 1', active: false },
      { id: 'r2', title: 'Article 2', active: false },
      { id: 'r3', title: 'Article 3', active: false },
      { id: 'r4', title: 'Article 4', active: false },
      { id: 'r5', title: 'Article 5', active: false },
    ],
  },
];

export const SingleGroupExpanded: Story = {
  args: {
    group: sampleGroups[0],
    darkMode: false,
  },
};

export const SingleGroupCollapsed: Story = {
  args: {
    group: sampleGroups[2],
    darkMode: false,
  },
};

export const DarkModeExpanded: Story = {
  args: {
    group: sampleGroups[1],
    darkMode: true,
  },
  parameters: {
    backgrounds: { default: 'dark' },
  },
};

export const DarkModeCollapsed: Story = {
  args: {
    group: sampleGroups[3],
    darkMode: true,
  },
  parameters: {
    backgrounds: { default: 'dark' },
  },
};

export const MultipleGroups: Story = {
  render: () => {
    const [groups, setGroups] = useState<TabGroupData[]>(sampleGroups);

    const handleToggleCollapse = (groupId: string) => {
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
        )
      );
    };

    const handleTabActive = (groupId: string, tabId: string) => {
      setGroups((prev) =>
        prev.map((g) => ({
          ...g,
          tabs: g.tabs.map((tab) => ({
            ...tab,
            active: g.id === groupId && tab.id === tabId,
          })),
        }))
      );
    };

    const handleTabClose = (groupId: string, tabId: string) => {
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? { ...g, tabs: g.tabs.filter((tab) => tab.id !== tabId) }
            : g
        )
      );
    };

    const handleTabReorder = (
      groupId: string,
      tabId: string,
      fromIndex: number,
      toIndex: number
    ) => {
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id !== groupId) return g;
          const newTabs = [...g.tabs];
          const [movedTab] = newTabs.splice(fromIndex, 1);
          if (!movedTab) return g;
          newTabs.splice(toIndex, 0, movedTab);
          return { ...g, tabs: newTabs };
        })
      );
    };

    return (
      <div>
        {groups.map((group) => (
          <TabGroup
            key={group.id}
            group={group}
            onToggleCollapse={handleToggleCollapse}
            onTabActive={handleTabActive}
            onTabClose={handleTabClose}
            onTabReorder={handleTabReorder}
          />
        ))}
        <div style={{ padding: '20px', fontFamily: 'monospace', fontSize: '12px' }}>
          <h3>Actions</h3>
          <p>• Click group label to collapse/expand</p>
          <p>• Click tabs to activate</p>
          <p>• Click × to close tabs</p>
          <p>• Drag tabs to reorder within group</p>
          <h3>State</h3>
          <pre>{JSON.stringify(groups, null, 2)}</pre>
        </div>
      </div>
    );
  },
};

export const MultipleGroupsDarkMode: Story = {
  render: () => {
    const [groups, setGroups] = useState<TabGroupData[]>(sampleGroups);

    const handleToggleCollapse = (groupId: string) => {
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
        )
      );
    };

    const handleTabActive = (groupId: string, tabId: string) => {
      setGroups((prev) =>
        prev.map((g) => ({
          ...g,
          tabs: g.tabs.map((tab) => ({
            ...tab,
            active: g.id === groupId && tab.id === tabId,
          })),
        }))
      );
    };

    const handleTabClose = (groupId: string, tabId: string) => {
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? { ...g, tabs: g.tabs.filter((tab) => tab.id !== tabId) }
            : g
        )
      );
    };

    const handleTabReorder = (
      groupId: string,
      tabId: string,
      fromIndex: number,
      toIndex: number
    ) => {
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id !== groupId) return g;
          const newTabs = [...g.tabs];
          const [movedTab] = newTabs.splice(fromIndex, 1);
          if (!movedTab) return g;
          newTabs.splice(toIndex, 0, movedTab);
          return { ...g, tabs: newTabs };
        })
      );
    };

    return (
      <div style={{ backgroundColor: '#0a0a0a', minHeight: '100vh', padding: '20px' }}>
        {groups.map((group) => (
          <TabGroup
            key={group.id}
            group={group}
            darkMode={true}
            onToggleCollapse={handleToggleCollapse}
            onTabActive={handleTabActive}
            onTabClose={handleTabClose}
            onTabReorder={handleTabReorder}
          />
        ))}
        <div style={{ padding: '20px', fontFamily: 'monospace', fontSize: '12px', color: '#e5e5e5' }}>
          <h3>Color-Coded Organization</h3>
          <p>🔵 Blue - Work tasks and productivity</p>
          <p>🔴 Red - Development and coding</p>
          <p>🟢 Green - Personal browsing</p>
          <p>🟡 Yellow - Research and reference</p>
        </div>
      </div>
    );
  },
  parameters: {
    backgrounds: { default: 'dark' },
  },
};

export const WorkflowExample: Story = {
  render: () => {
    const [groups, setGroups] = useState<TabGroupData[]>([
      {
        id: 'current',
        label: 'Now',
        color: '#ea4335', // Red for urgent
        collapsed: false,
        tabs: [
          { id: 'c1', title: 'Project Dashboard', active: true },
          { id: 'c2', title: 'Slack', active: false },
        ],
      },
      {
        id: 'review',
        label: 'To Review',
        color: '#fbbc04', // Yellow for pending
        collapsed: true,
        tabs: [
          { id: 'rv1', title: 'PR #123', active: false },
          { id: 'rv2', title: 'PR #124', active: false },
          { id: 'rv3', title: 'PR #125', active: false },
        ],
      },
      {
        id: 'reference',
        label: 'Reference',
        color: '#5f6368', // Grey for background
        collapsed: true,
        tabs: [
          { id: 'rf1', title: 'API Docs', active: false },
          { id: 'rf2', title: 'Design System', active: false },
          { id: 'rf3', title: 'Style Guide', active: false },
          { id: 'rf4', title: 'Best Practices', active: false },
        ],
      },
    ]);

    const handleToggleCollapse = (groupId: string) => {
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId ? { ...g, collapsed: !g.collapsed } : g
        )
      );
    };

    const handleTabActive = (groupId: string, tabId: string) => {
      setGroups((prev) =>
        prev.map((g) => ({
          ...g,
          tabs: g.tabs.map((tab) => ({
            ...tab,
            active: g.id === groupId && tab.id === tabId,
          })),
        }))
      );
    };

    const handleTabClose = (groupId: string, tabId: string) => {
      setGroups((prev) =>
        prev.map((g) =>
          g.id === groupId
            ? { ...g, tabs: g.tabs.filter((tab) => tab.id !== tabId) }
            : g
        )
      );
    };

    const handleTabReorder = (
      groupId: string,
      tabId: string,
      fromIndex: number,
      toIndex: number
    ) => {
      setGroups((prev) =>
        prev.map((g) => {
          if (g.id !== groupId) return g;
          const newTabs = [...g.tabs];
          const [movedTab] = newTabs.splice(fromIndex, 1);
          if (!movedTab) return g;
          newTabs.splice(toIndex, 0, movedTab);
          return { ...g, tabs: newTabs };
        })
      );
    };

    return (
      <div>
        {groups.map((group) => (
          <TabGroup
            key={group.id}
            group={group}
            onToggleCollapse={handleToggleCollapse}
            onTabActive={handleTabActive}
            onTabClose={handleTabClose}
            onTabReorder={handleTabReorder}
          />
        ))}
        <div style={{ padding: '20px', fontFamily: 'monospace', fontSize: '12px' }}>
          <h3>Workflow-Based Organization</h3>
          <p>This example demonstrates organizing tabs by priority/status:</p>
          <ul>
            <li><strong>Now</strong> (Red): Current active work - always expanded</li>
            <li><strong>To Review</strong> (Yellow): Pending items - collapsed to reduce clutter</li>
            <li><strong>Reference</strong> (Grey): Background docs - collapsed until needed</li>
          </ul>
          <p>Click collapsed groups to access tabs without losing your current context.</p>
        </div>
      </div>
    );
  },
};
