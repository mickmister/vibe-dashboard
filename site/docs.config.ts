export default {
  name: 'Vibe Dashboard',
  shortDescription: 'Agent workspace dashboard',
  description: 'Run and coordinate coding agents, embedded developer tools, beads tasks, and GitHub workflows from one local dashboard.',
  url: process.env.DOCS_SITE_URL || 'https://vibedashboard.dev',
  github: process.env.DOCS_GITHUB_REPO || 'mickmister/vibe-dashboard',
  themeColor: 'violet',
  redirects: {
    '/blog': '/guide'
  },
  llms: {
    domain: process.env.DOCS_SITE_URL || 'https://vibedashboard.dev',
    title: 'Vibe Dashboard',
    description: 'End-user documentation for running and using Vibe Dashboard.',
    full: {
      title: 'Vibe Dashboard documentation',
      description: 'Guides for installing Vibe Dashboard, working with voyages and crafts, coordinating beads-centric agent work, and connecting GitHub workflows.'
    }
  },
  landing: {
    heroTitle: 'Vibe Dashboard',
    heroSubtitle: 'Agent workspace dashboard',
    heroDescription: 'Run a local, Docker-powered command center for coding agents, embedded apps, beads tasks, and GitHub feedback loops.',
    heroLinks: {
      primary: {
        label: 'Get started',
        icon: 'i-heroicons-rocket-launch',
        to: '/guide'
      }
    },
    features: [
      {
        title: 'Start with one command',
        description: 'Install Docker, run `npx vibe-dashboard`, and open the dashboard locally.',
        icon: 'i-heroicons-command-line'
      },
      {
        title: 'Coordinate agent voyages',
        description: 'Group agent sessions, code-server, diffs, docs, and other app views into shareable voyages and crafts.',
        icon: 'i-heroicons-window'
      },
      {
        title: 'Work from beads',
        description: 'Use beads as the task backbone for agent work, workspace context, and progress tracking.',
        icon: 'i-heroicons-circle-stack'
      },
      {
        title: 'Close the GitHub loop',
        description: 'Open GitHub work in the right workspace and route CI or PR feedback back to the matching agent session.',
        icon: 'i-simple-icons-github'
      },
      {
        title: 'Embed your tools',
        description: 'Keep agent UIs, code-server, plugin apps, and internal dev servers together in one browser workspace.',
        icon: 'i-heroicons-puzzle-piece'
      },
      {
        title: 'Self-host locally',
        description: 'Run the full stack in Docker with persistent credentials and optional integrations such as Tailscale.',
        icon: 'i-heroicons-server-stack'
      }
    ]
  }
};
