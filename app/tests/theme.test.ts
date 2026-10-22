import { describe, expect, it } from 'vitest';
import { resolveTheme } from '../src/hooks/useTheme';

describe('resolveTheme', () => {
  it('跟随系统时按系统偏好决定', () => {
    expect(resolveTheme('auto', true)).toBe('dark');
    expect(resolveTheme('auto', false)).toBe('light');
  });

  it('手动亮色忽略系统偏好', () => {
    expect(resolveTheme('light', true)).toBe('light');
  });

  it('手动暗色忽略系统偏好', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});
