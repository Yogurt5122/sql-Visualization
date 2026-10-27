import { describe, expect, it } from 'vitest';
import type { Relations } from '../src/core/types';
import {
  collectRelationFields,
  collectSourceFields,
  sourceColor,
  sourceTable,
  sourceTables,
} from '../src/ui/visual';

describe('可视化辅助', () => {
  it('解析来源表和字段', () => {
    expect(sourceTable('t_demo_order.amount')).toBe('t_demo_order');
    expect(sourceTables('t_demo_order.amount + t_demo_refund.amount')).toEqual([
      't_demo_order',
      't_demo_refund',
    ]);
    expect(sourceTable('按行计数')).toBe('计算值');
  });

  it('同一来源颜色稳定', () => {
    expect(sourceColor('t_demo_order')).toBe(sourceColor('t_demo_order'));
    expect(sourceColor('t_demo_order')).not.toBe(sourceColor('t_demo_user_dim'));
  });

  it('按表聚合字段并去重', () => {
    const relations = {
      sources: [],
      joins: [],
      lineage: [
        {
          id: '1',
          output: 'uid',
          source: 't_demo_order.user_id',
          transform: 'direct',
          line: 1,
          confidence: 'exact',
        },
        {
          id: '2',
          output: 'amount',
          source: 't_demo_order.amount',
          transform: 'direct',
          line: 2,
          confidence: 'exact',
        },
        {
          id: '3',
          output: 'uid2',
          source: 't_demo_order.user_id',
          transform: 'direct',
          line: 3,
          confidence: 'exact',
        },
      ],
    } satisfies Relations;

    expect(collectSourceFields(relations).get('t_demo_order')).toEqual([
      'amount',
      'user_id',
    ]);
  });

  it('把 JOIN 条件里的关联字段也归到对应表', () => {
    const relations = {
      sources: [
        { id: 's1', name: 't_demo_order', alias: 'o', kind: 'table', line: 1 },
        { id: 's2', name: 't_demo_user_dim', alias: 'u', kind: 'table', line: 2 },
      ],
      joins: [
        {
          id: 'j1',
          from: 's1',
          to: 's2',
          type: 'left',
          condition: 'o.user_id = u.id',
          line: 2,
        },
      ],
      lineage: [],
    } satisfies Relations;

    expect(collectRelationFields(relations).get('t_demo_order')).toEqual(['user_id']);
    expect(collectRelationFields(relations).get('t_demo_user_dim')).toEqual(['id']);
  });
});
