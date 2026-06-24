export default {
  name: 'Vibe Dashboard',
  shortDescription: 'Documentation',
  description: 'Docs for running and developing Vibe Dashboard.',
  url: process.env.DOCS_SITE_URL || 'https://vibedashboard.dev',
  github: process.env.DOCS_GITHUB_REPO || 'mickmister/vibe-dashboard',
  themeColor: 'violet',
  landing: {
    heroTitle: 'Vibe Dashboard',
    heroSubtitle: 'Documentation',
    heroDescription: 'Guides for setup, development, and operations.',
    heroLinks: {
      primary: {
        label: 'Get started',
        icon: 'i-heroicons-rocket-launch',
        to: '/guide'
      }
    },
    features: [
      {
        title: 'Develop locally',
        description: 'Install dependencies, run the app, and verify changes.'
      },
      {
        title: 'Operate confidently',
        description: 'Document deployment, workflows, and production checks as they evolve.'
      }
    ]
  }
};
