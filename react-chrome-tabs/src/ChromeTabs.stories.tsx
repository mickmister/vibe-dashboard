import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { ChromeTabs, type TabProperties } from './ChromeTabs';

const meta = {
  title: 'ChromeTabs',
  component: ChromeTabs,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ChromeTabs>;

export default meta;
type Story = StoryObj<typeof meta>;

// Default tabs for most stories
const defaultTabs: TabProperties[] = [
  { id: '1', title: 'New Tab', active: false },
  { id: '2', title: 'Google', favicon: 'https://www.google.com/favicon.ico', active: true },
  { id: '3', title: 'GitHub', favicon: 'https://github.com/favicon.ico', active: false },
  { id: '4', title: 'Stack Overflow', favicon: 'https://stackoverflow.com/favicon.ico', active: false },
];

export const Default: Story = {
  args: {
    tabs: defaultTabs,
    darkMode: false,
    draggable: true,
  },
};

export const DarkMode: Story = {
  args: {
    tabs: defaultTabs,
    darkMode: true,
    draggable: true,
  },
  parameters: {
    backgrounds: { default: 'dark' },
  },
};

export const ManyTabs: Story = {
  args: {
    tabs: Array.from({ length: 15 }, (_, i) => ({
      id: `tab-${i + 1}`,
      title: `Tab ${i + 1}`,
      favicon: i % 2 === 0 ? 'https://www.google.com/favicon.ico' : false,
      active: i === 3,
    })),
    darkMode: false,
    draggable: true,
  },
};

export const WithToolbar: Story = {
  args: {
    tabs: defaultTabs,
    darkMode: false,
    draggable: true,
    pinnedRight: (
      <button
        style={{
          background: 'transparent',
          border: 'none',
          fontSize: '18px',
          padding: '0 8px',
          cursor: 'pointer',
        }}
      >
        +
      </button>
    ),
  },
};

export const Empty: Story = {
  args: {
    tabs: [],
    darkMode: false,
    draggable: true,
  },
};

export const SingleTab: Story = {
  args: {
    tabs: [{ id: '1', title: 'Only Tab', active: true }],
    darkMode: false,
    draggable: true,
  },
};

export const WithoutCloseButton: Story = {
  args: {
    tabs: [
      { id: '1', title: 'Pinned Tab', active: false, isCloseIconVisible: false },
      { id: '2', title: 'Normal Tab', active: true },
      { id: '3', title: 'Another Pinned', active: false, isCloseIconVisible: false },
    ],
    darkMode: false,
    draggable: true,
  },
};

export const Interactive: Story = {
  render: () => {
    const [tabs, setTabs] = useState<TabProperties[]>(defaultTabs);
    const [nextId, setNextId] = useState(5);

    const handleTabActive = (tabId: string) => {
      setTabs((prev) =>
        prev.map((tab) => ({
          ...tab,
          active: tab.id === tabId,
        }))
      );
    };

    const handleTabClose = (tabId: string) => {
      setTabs((prev) => {
        const filtered = prev.filter((tab) => tab.id !== tabId);
        // If we closed the active tab, activate the first remaining tab
        if (filtered.length > 0 && !filtered.some((tab) => tab.active)) {
          const [firstTab] = filtered;
          if (firstTab) {
            firstTab.active = true;
          }
        }
        return filtered;
      });
    };

    const handleTabReorder = (tabId: string, fromIndex: number, toIndex: number) => {
      setTabs((prev) => {
        const newTabs = [...prev];
        const [movedTab] = newTabs.splice(fromIndex, 1);
        if (!movedTab) return prev;
        newTabs.splice(toIndex, 0, movedTab);
        return newTabs;
      });
    };

    const handleAddTab = () => {
      setTabs((prev) => [
        ...prev.map((tab) => ({ ...tab, active: false })),
        {
          id: String(nextId),
          title: `New Tab ${nextId}`,
          active: true,
        },
      ]);
      setNextId((id) => id + 1);
    };

    return (
      <div>
        <ChromeTabs
          tabs={tabs}
          onTabActive={handleTabActive}
          onTabClose={handleTabClose}
          onTabReorder={handleTabReorder}
          pinnedRight={
            <button
              onClick={handleAddTab}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: '18px',
                padding: '0 8px',
                cursor: 'pointer',
              }}
            >
              +
            </button>
          }
        />
        <div style={{ padding: '20px', fontFamily: 'monospace' }}>
          <h3>Actions</h3>
          <p>• Click tabs to activate</p>
          <p>• Click × to close tabs</p>
          <p>• Drag tabs to reorder</p>
          <p>• Click + to add new tab</p>
          <h3>State</h3>
          <pre>{JSON.stringify(tabs, null, 2)}</pre>
        </div>
      </div>
    );
  },
};
