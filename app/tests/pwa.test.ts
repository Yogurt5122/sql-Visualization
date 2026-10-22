import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifestUrl = new URL('../public/manifest.webmanifest', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8')) as {
  name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  icons: Array<{ src: string; sizes: string; purpose: string }>;
};

describe('PWA manifest', () => {
  it('声明可安装、相对路径启动', () => {
    expect(manifest.name).toContain('SQL');
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#2563eb');
  });

  it('图标文件存在，包含 maskable', () => {
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons) {
      expect(existsSync(new URL(icon.src, manifestUrl))).toBe(true);
    }
  });
});
