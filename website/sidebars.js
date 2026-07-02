// @ts-check

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      items: ['getting-started/introduction', 'getting-started/prerequisites'],
    },
    {
      type: 'category',
      label: 'Features',
      items: [
        'features/ask-and-draft',
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
