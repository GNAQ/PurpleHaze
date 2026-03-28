import { useMemo } from 'react'
import { useThemeStore } from '../store/themeStore'
import { themeTokens, type ThemeTokens } from './tokens'
import type { ThemeMode } from '../store/themeStore'

/** Returns resolved semantic theme tokens + mode + toggle. */
export function useTheme(): { t: ThemeTokens; mode: ThemeMode; isDark: boolean; toggle: () => void } {
  const mode = useThemeStore((s) => s.mode)
  const toggle = useThemeStore((s) => s.toggle)
  const t = useMemo(() => themeTokens(mode), [mode])
  return { t, mode, isDark: mode === 'dark', toggle }
}
