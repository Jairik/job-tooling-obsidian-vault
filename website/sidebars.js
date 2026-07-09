// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/introduction',
        'getting-started/installation',
        'getting-started/prerequisites',
      ],
    },
    {
      type: 'category',
      label: 'Interfaces',
      items: ['interfaces/web-app', 'interfaces/desktop-app', 'interfaces/tui'],
    },
    {
      type: 'category',
      label: 'Features',
      items: [
        'features/ask-mode',
        'features/draft-mode',
        'features/write-vault',
        'features/rag',
        'features/web-research',
        'features/settings',
        'features/skills',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: [
        'architecture/overview',
        'architecture/design-system',
        'architecture/development-workflow',
        'architecture/workflow',
      ],
    },
  ],
};

export default sidebars;
