import { useEffect, useLayoutEffect, useState } from 'react';

export type ThemeMode = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'sql-xray-theme';

function readStoredMode(): ThemeMode {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'auto') return value;
  } catch {
    // 隐私模式 / 禁用 localStorage 时退回跟随系统
  }
  return 'auto';
}

function systemPrefersDark(): boolean {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function resolveTheme(mode: ThemeMode, systemDark: boolean): ResolvedTheme {
  if (mode === 'auto') return systemDark ? 'dark' : 'light';
  return mode;
}

export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readStoredMode);
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const resolved: ResolvedTheme = resolveTheme(mode, systemDark);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', resolved === 'dark' ? '#0b1220' : '#ffffff');
    try {
      window.localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // 只保存 UI 偏好；写入失败不影响使用
    }
  }, [mode, resolved]);

  return { mode, setMode, resolved };
}
