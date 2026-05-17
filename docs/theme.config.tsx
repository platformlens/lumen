import React from 'react'
import { DocsThemeConfig } from 'nextra-theme-docs'

const config: DocsThemeConfig = {
  logo: <span style={{ fontWeight: 700 }}>Lumen</span>,
  project: {
    link: 'https://github.com/your-org/lumen',
  },
  docsRepositoryBase: 'https://github.com/your-org/lumen/tree/main/docs',
  footer: {
    text: 'Lumen Documentation',
  },
  primaryHue: 210,
  sidebar: {
    defaultMenuCollapseLevel: 1,
    toggleButton: true,
  },
  toc: {
    backToTop: true,
  },
  useNextSeoProps() {
    return {
      titleTemplate: '%s – Lumen Docs',
    }
  },
}

export default config
