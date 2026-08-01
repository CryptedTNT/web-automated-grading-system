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
  dark: { label: 'Dark', swatch: '#374151', sidebar: '#1F2937', sidebarHover: '#303A48', primary: '#374151', primaryHover: '#111827', success: '#2FAE73', heroBg: '#1F2937' },
}

export const DEFAULT_THEME = 'ocean'

export function applyTheme(key) {
  const palette = PALETTES[key] || PALETTES[DEFAULT_THEME]
  const root = document.documentElement
  root.style.setProperty('--sidebar-bg', palette.sidebar)
  root.style.setProperty('--sidebar-hover', palette.sidebarHover)
  root.style.setProperty('--primary', palette.primary)
  root.style.setProperty('--primary-hover', palette.primaryHover)
  root.style.setProperty('--success', palette.success)
  root.style.setProperty('--hero-bg', palette.heroBg)
  root.style.setProperty('--progress-fill', palette.primary)
  root.style.setProperty('--input-focus', palette.primary)
  root.style.setProperty('--tab-active-text', palette.primary)
  DB.setSetting('theme', key)
}

export function loadSavedTheme() {
  const saved = DB.getSettings().theme
  applyTheme(PALETTES[saved] ? saved : DEFAULT_THEME)
}
