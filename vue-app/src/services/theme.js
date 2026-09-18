/* ============================================================
   services/theme.js — palette definitions and CSS variable swapping

   Lifted out of settings.js so both the app bootstrap and the
   Settings page can use it without one importing the other.
   ============================================================ */

import { DB } from './database.js'

export const PALETTES = {
  ocean: { label: 'Ocean Blue', swatch: '#1F6FB2', sidebar: '#0B3558', sidebarHover: '#174D78', primary: '#1F6FB2', primaryHover: '#185C96', success: '#2FAE73', heroBg: '#0B3558' },
  deep: { label: 'Deep Blue', swatch: '#0B4F7A', sidebar: '#062A46', sidebarHover: '#0A4268', primary: '#0B4F7A', primaryHover: '#083D5E', success: '#1B8A5A', heroBg: '#062A46' },
  green: { label: 'Forest Green', swatch: '#2FAE73', sidebar: '#12402B', sidebarHover: '#1F7A4F', primary: '#2FAE73', primaryHover: '#238B5D', success: '#2FAE73', heroBg: '#12402B' },
  purple: { label: 'Purple Haze', swatch: '#8E5EA2', sidebar: '#3B245C', sidebarHover: '#6B3F82', primary: '#8E5EA2', primaryHover: '#744A87', success: '#2FAE73', heroBg: '#3B245C' },
  dark: { label: 'Dark', swatch: '#2F2F2F', sidebar: '#171717', sidebarHover: '#2F2F2F', primary: '#ECECEC', primaryHover: '#FFFFFF', success: '#10A37F', heroBg: '#171717' },
}

export const DEFAULT_THEME = 'ocean'

/* These properties cover the neutral UI layer rather than the palette's
   accent colour. A real dark theme needs both: changing only the sidebar
   leaves light surfaces, text, form controls, and tables behind. */
const DARK_SURFACE_TOKENS = {
  '--page-bg': '#212121',
  '--card-bg': '#2F2F2F',
  '--card-border': '#454545',
  '--text-primary': '#ECECEC',
  '--text-heading': '#FFFFFF',
  '--text-muted': '#B4B4B4',
  '--secondary-bg': '#3A3A3A',
  '--secondary-text': '#F5F5F5',
  '--secondary-border': '#575757',
  '--input-border': '#5E5E5E',
  '--table-alt': '#333333',
  '--table-header-bg': '#3A3A3A',
  '--table-header-text': '#E0E0E0',
  '--table-grid': '#484848',
  '--table-selection': '#414141',
  '--progress-bg': '#4A4A4A',
  '--tab-bg': '#3A3A3A',
  '--tab-active-bg': '#2F2F2F',
}

const SURFACE_TOKEN_NAMES = Object.keys(DARK_SURFACE_TOKENS)

export function applyTheme(key) {
  const palette = PALETTES[key] || PALETTES[DEFAULT_THEME]
  const root = document.documentElement
  const resolvedKey = PALETTES[key] ? key : DEFAULT_THEME

  root.dataset.theme = resolvedKey
  root.style.setProperty('--sidebar-bg', palette.sidebar)
  root.style.setProperty('--sidebar-hover', palette.sidebarHover)
  root.style.setProperty('--primary', palette.primary)
  root.style.setProperty('--primary-hover', palette.primaryHover)
  root.style.setProperty('--success', palette.success)
  root.style.setProperty('--hero-bg', palette.heroBg)
  root.style.setProperty('--progress-fill', palette.primary)
  root.style.setProperty('--input-focus', palette.primary)
  root.style.setProperty('--tab-active-text', palette.primary)

  if (resolvedKey === 'dark') {
    Object.entries(DARK_SURFACE_TOKENS).forEach(([name, value]) => root.style.setProperty(name, value))
  } else {
    // Return to the design system's light-surface defaults after dark mode.
    SURFACE_TOKEN_NAMES.forEach((name) => root.style.removeProperty(name))
  }

  DB.setSetting('theme', key)
}

export function loadSavedTheme() {
  const saved = DB.getSettings().theme
  applyTheme(PALETTES[saved] ? saved : DEFAULT_THEME)
}
