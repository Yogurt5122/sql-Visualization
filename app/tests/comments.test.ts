import { describe, expect, it } from 'vitest';
import { collectSqlComments, commentsForRange } from '../src/core/comments';

describe('SQL 注释归属', () => {
  it('收集行注释和块注释并保留行号', () => {
    const sql = `-- 先看订单
SELECT id
FROM t_demo_order
/* 只看已支付 */
WHERE status = 'PAID';`;
    const comments = collectSqlComments(sql);

    expect(comments.map((comment) => comment.text)).toEqual([
      '先看订单',
      '只看已支付',
    ]);
    expect(comments.map((comment) => comment.line)).toEqual([1, 4]);
    expect(comments[0]?.raw).toContain('--');
    expect(comments[1]?.raw).toContain('/*');
  });

  it('字符串里的注释标记不算注释', () => {
    const comments = collectSqlComments(
      "SELECT '-- not comment', '/* not comment */' FROM t_demo_order",
    );

    expect(comments).toHaveLength(0);
  });

  it('节点范围内的注释会带上紧邻前面的连续注释', () => {
    const comments = collectSqlComments(`-- 第一行
-- 第二行
SELECT id
FROM t_demo_order`);
    const attached = commentsForRange(comments, 3, 3);

    expect(attached.map((comment) => comment.line)).toEqual([1, 2]);
  });
});
