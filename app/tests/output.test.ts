import { describe, expect, it } from 'vitest';
import { formatFieldList } from '../src/ui/OutputPreview';
import type { LineageRow } from '../src/core/types';

function row(output: string): LineageRow {
  return {
    id: output,
    output,
    source: 't_demo_order.id',
    transform: 'direct',
    line: 1,
    confidence: 'exact',
  };
}

describe('预输出字段复制', () => {
  it('按行输出字段名', () => {
    expect(formatFieldList([row('order_id'), row('amount')])).toBe(
      'order_id\namount',
    );
  });
});
