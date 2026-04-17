import type { Meta, StoryObj } from '@storybook/react-vite';
import {
  HorizontalTabGroupsV2WithIframes,
  type HorizontalTabGroupsV2State,
} from './HorizontalTabGroupsV2WithIframes';

const meta = {
  title: 'HorizontalTabGroupsV2WithIframes',
  component: HorizontalTabGroupsV2WithIframes,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
} satisfies Meta<typeof HorizontalTabGroupsV2WithIframes>;

export default meta;
type Story = StoryObj<typeof meta>;

const sampleStateWithUrls: HorizontalTabGroupsV2State = {
  groups: [
    {
      id: 'docs',
      label: 'Docs',
      color: '#4285f4',
      collapsed: false,
    },
    {
      id: 'dev',
      label: 'Dev Tools',
      color: '#ea4335',
      collapsed: false,
    },
    {
      id: 'media',
      label: 'Media',
      color: '#34a853',
      collapsed: true,
    },
  ],
  tabs: [
    {
      id: 'd1',
      title: 'React Docs',
      groupId: 'docs',
      active: true,
      loaded: true,
      url: 'https://react.dev',
    },
    {
      id: 'd2',
      title: 'MDN',
      groupId: 'docs',
      active: false,
      loaded: false,
      url: 'https://developer.mozilla.org',
    },
    {
      id: 'd3',
      title: 'TypeScript',
      groupId: 'docs',
      active: false,
      loaded: false,
      url: 'https://www.typescriptlang.org/docs/',
    },
    {
      id: 'dv1',
      title: 'GitHub',
      groupId: 'dev',
      active: false,
      loaded: false,
      url: 'https://github.com',
    },
    {
      id: 'dv2',
      title: 'Stack Overflow',
      groupId: 'dev',
      active: false,
      loaded: false,
      url: 'https://stackoverflow.com',
    },
    {
      id: 'm1',
      title: 'YouTube',
      groupId: 'media',
      active: false,
      loaded: false,
      url: 'https://www.youtube.com',
    },
    {
      id: 'm2',
      title: 'Vimeo',
      groupId: 'media',
      active: false,
      loaded: false,
      url: 'https://vimeo.com',
    },
  ],
};

export const BasicWithIframes: Story = {
  render: () => (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <HorizontalTabGroupsV2WithIframes initialState={sampleStateWithUrls} />
    </div>
  ),
};

export const DarkModeWithIframes: Story = {
  render: () => (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <HorizontalTabGroupsV2WithIframes
        initialState={sampleStateWithUrls}
        darkMode={true}
      />
    </div>
  ),
  parameters: {
    backgrounds: { default: 'dark' },
  },
};

export const TabBarOnly: Story = {
  render: () => (
    <div>
      <HorizontalTabGroupsV2WithIframes
        initialState={sampleStateWithUrls}
        showIframeContent={false}
      />
      <div style={{ padding: '20px', fontFamily: 'monospace', fontSize: '12px' }}>
        <h3>Tab Bar Only Mode</h3>
        <p>
          This shows just the tab bar without the iframe content area.
          The iframes are still created in memory using react-reverse-portal,
          but they're not displayed.
        </p>
        <h3>Key Features</h3>
        <ul>
          <li><strong>Persistent Iframes:</strong> Iframes created once and never destroyed</li>
          <li><strong>display:none Strategy:</strong> Hidden tabs use CSS to hide, not unmount</li>
          <li><strong>No Reloads:</strong> Switching tabs instantly shows iframe state</li>
          <li><strong>react-reverse-portal:</strong> InPortal creates, OutPortal displays</li>
        </ul>
        <h3>How It Works</h3>
        <ol>
          <li>Each tab with a URL gets a persistent portal node</li>
          <li>InPortal renders iframe content once (in memory)</li>
          <li>OutPortal "moves" iframe to visible or hidden container</li>
          <li>Hidden iframes use display:none to keep running</li>
          <li>Active iframe is shown with display:block</li>
        </ol>
      </div>
    </div>
  ),
};

const localDevState: HorizontalTabGroupsV2State = {
  groups: [
    {
      id: 'local',
      label: 'Local',
      color: '#4285f4',
      collapsed: false,
    },
  ],
  tabs: [
    {
      id: 'l1',
      title: 'Storybook',
      groupId: 'local',
      active: true,
      loaded: true,
      url: 'http://localhost:6006',
    },
    {
      id: 'l2',
      title: 'Dev Server',
      groupId: 'local',
      active: false,
      loaded: false,
      url: 'http://localhost:5173',
    },
    {
      id: 'l3',
      title: 'API Docs',
      groupId: 'local',
      active: false,
      loaded: false,
      url: 'http://localhost:3000',
    },
  ],
};

export const LocalDevelopment: Story = {
  render: () => (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <HorizontalTabGroupsV2WithIframes initialState={localDevState} />
    </div>
  ),
};

export const InteractiveDemo: Story = {
  render: () => {
    return (
      <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
        <HorizontalTabGroupsV2WithIframes initialState={sampleStateWithUrls} />
        <div
          style={{
            padding: '20px',
            fontFamily: 'monospace',
            fontSize: '12px',
            maxHeight: '200px',
            overflow: 'auto',
            borderTop: '2px solid #ccc',
          }}
        >
          <h3>Interactive Demo</h3>
          <ul>
            <li><strong>Click tabs</strong> to switch between iframes (no reload!)</li>
            <li><strong>Click group labels</strong> to collapse/expand groups</li>
            <li><strong>Click X</strong> to close tabs</li>
            <li><strong>Observe:</strong> Switching back to a tab shows its previous state</li>
          </ul>
          <h3>Architecture Benefits</h3>
          <ul>
            <li>Instant tab switching - no loading delays</li>
            <li>Iframe state preserved - forms, scroll position, etc.</li>
            <li>Efficient memory - iframes only created once</li>
            <li>Clean separation - portal logic isolated from tab UI</li>
          </ul>
        </div>
      </div>
    );
  },
};
