import { describe, expect, it } from 'vitest';
import { beatToughness, buildBeatLines } from '../src/core/beat';

describe('暴打模式', () => {
  it('耐久度按行数计算并限制上下界', () => {
    expect(beatToughness(2)).toBe(9);
    expect(beatToughness(8)).toBe(12);
    expect(beatToughness(100)).toBe(60);
  });

  it('第一拳不会散架，第三拳开始悬挂', () => {
    const lines = buildBeatLines('SELECT id\nFROM t_demo_order');
    const first = lines[0]!.tokens[0]!;

    expect(first.fallAt).toBe(3);
    expect(lines.flatMap((line) => line.tokens)).toHaveLength(4);
  });

  it('空行保留行号但不产生词块', () => {
    const lines = buildBeatLines('SELECT 1\n\nFROM t_demo_order');

    expect(lines).toHaveLength(3);
    expect(lines[1]!.tokens).toHaveLength(0);
    expect(lines[2]!.tokens[0]!.line).toBe(3);
  });
});
