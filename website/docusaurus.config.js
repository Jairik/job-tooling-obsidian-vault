// @ts-check

import { themes as prismThemes } from 'prism-react-renderer';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Vault Assistant',
  tagline: 'A local-first AI research assistant for your Obsidian vault',
  favicon: 'img/logo.png',

  future: {
    v4: true,
  },

  // Production url of the site. GH Pages serves /docs on main, and this
  // build lands in docs/docs/, so the site is nested one level under that.
  url: 'https://jairik.github.io',
  baseUrl: '/vault-assistant/docs/',

  organizationName: 'Jairik',
  projectName: 'vault-assistant',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  markdown: {
    mermaid: true,
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  themes: ['@docusaurus/theme-mermaid'],

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          // Docs are the whole site, not a /docs/ sub-route.
          routeBasePath: '/',
          sidebarPath: './sidebars.js',
          editUrl: 'https://github.com/Jairik/vault-assistant/edit/main/website/docs/',
        },
        blog: false,
        pages: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  stylesheets: [
    { href: 'https://fonts.googleapis.com', rel: 'preconnect' },
    { href: 'https://fonts.gstatic.com', rel: 'preconnect', crossorigin: 'anonymous' },
    {
      href: 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap',
      rel: 'stylesheet',
    },
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/logo.png',
      colorMode: {
        defaultMode: 'dark',
        disableSwitch: false,
        respectPrefersColorScheme: false,
      },
      navbar: {
        title: 'Vault Assistant',
        logo: {
          alt: 'Vault Assistant',
          src: 'img/logo.png',
          // Absolute URL so this isn't prefixed by baseUrl - it links
          // back out to the landing page, not to a route inside this site.
          href: 'https://jairik.github.io/vault-assistant/',
        },
        items: [
          {
            href: 'https://github.com/Jairik/vault-assistant',
            position: 'right',
            className: 'navbar-github-link',
            'aria-label': 'GitHub repository',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Project',
            items: [
              { label: 'Source code', href: 'https://github.com/Jairik/vault-assistant' },
              { label: 'License', href: 'https://github.com/Jairik/vault-assistant/blob/main/LICENSE' },
            ],
          },
          {
            title: 'Site',
            items: [{ label: 'Landing page', href: 'https://jairik.github.io/vault-assistant/' }],
          },
        ],
        copyright: 'MIT licensed. Built with Bun.',
      },
      prism: {
        theme: prismThemes.oneLight,
        darkTheme: prismThemes.oneDark,
        additionalLanguages: ['bash'],
      },
    }),
};

export default config;
