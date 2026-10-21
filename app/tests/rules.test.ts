import { describe, expect, it } from 'vitest';
import { analyzeSql } from '../src/core/explain';
import { RULES, runRules } from '../src/core/rules';
import type { RuleContext, RuleDefinition } from '../src/core/rules/types';
import type { Span } from '../src/core/types';

const span: Span = {
  start: 0,
  end: 1,
  startLine: 1,
  endLine: 1,
  startCol: 1,
  endCol: 2,
};

function contextOf(sql: string, dialect: 'mysql' | 'dm8' = 'mysql'): RuleContext {
  const analysis = analyzeSql(sql, dialect);
  return {
    statement: analysis.statements[0]!,
    dialect,
    semantic: analysis.semantic[0] ?? null,
    relations: analysis.relations[0]!,
    metrics: analysis.metrics,
  };
}

describe('rule engine', () => {
  it('注册表 ID 唯一且元数据完整', () => {
    expect(new Set(RULES.map((rule) => rule.id)).size).toBe(RULES.length);
    expect(RULES.map((rule) => rule.id)).toEqual([
      'RSK-01',
      'RSK-02',
      'RSK-03',
      'RSK-05',
      'RSK-06',
      'RSK-07',
      'RSK-08',
      'RSK-09',
      'RSK-10',
      'RSK-11',
      'RSK-12',
      'RSK-13',
      'RSK-14',
      'RSK-15',
      'RSK-16',
    ]);
    for (const rule of RULES) {
      expect(rule.name.length).toBeGreaterThan(0);
      expect(rule.detail.length).toBeGreaterThan(0);
      expect(rule.suggestion?.length ?? 0).toBeGreaterThan(0);
    }
  });

  const cases: Array<{
    id: string;
    positive: string;
    negative: string;
    dialect?: 'mysql' | 'dm8';
  }> = [
    {
      id: 'RSK-01',
      positive: 'SELECT * FROM dwd_order',
      negative: 'SELECT order_id FROM dwd_order',
    },
    {
      id: 'RSK-02',
      positive: 'SELECT a.id FROM a JOIN b',
      negative: 'SELECT a.id FROM a JOIN b ON b.id = a.id',
    },
    {
      id: 'RSK-03',
      positive: "SELECT id FROM t WHERE DATE(created_at) = '2024-01-01'",
      negative: 'SELECT id FROM t WHERE created_at >= NOW() - INTERVAL 7 DAY',
    },
    {
      id: 'RSK-05',
      positive: 'SELECT a.id FROM t a JOIN t b ON a.id = b.id',
      negative: 'SELECT a.id FROM t a',
    },
    {
      id: 'RSK-06',
      positive: 'SELECT * FROM (SELECT id FROM t ORDER BY id) x',
      negative: 'SELECT * FROM (SELECT id FROM t ORDER BY id LIMIT 5) x',
    },
    {
      id: 'RSK-07',
      positive: 'SELECT DISTINCT o.id FROM o JOIN u ON u.id = o.user_id',
      negative: 'SELECT DISTINCT id FROM o',
    },
    {
      id: 'RSK-08',
      positive: 'SELECT id FROM a UNION SELECT id FROM b',
      negative: 'SELECT id FROM a UNION ALL SELECT id FROM b',
    },
    {
      id: 'RSK-09',
      positive: "SELECT id FROM t WHERE dt BETWEEN '2024-12-01' AND '2024-12-31'",
      negative: 'SELECT id FROM t WHERE dt >= ?',
    },
    {
      id: 'RSK-10',
      positive:
        'SELECT * FROM (SELECT * FROM (SELECT * FROM (SELECT id FROM t) a) b) c',
      negative: 'SELECT * FROM (SELECT * FROM (SELECT id FROM t) a) b',
    },
    {
      id: 'RSK-11',
      positive: 'SELECT id FROM t WHERE id NOT IN (SELECT id FROM u)',
      negative: 'SELECT id FROM t WHERE id IN (SELECT id FROM u)',
    },
    {
      id: 'RSK-12',
      positive:
        'SELECT o.id, (SELECT MAX(u.id) FROM dim_user u WHERE u.id = o.user_id) AS m FROM dwd_order o',
      negative:
        'SELECT o.id, (SELECT MAX(u.id) FROM dim_user u) AS m FROM dwd_order o',
    },
    {
      id: 'RSK-13',
      positive: 'SELECT id FROM t LIMIT 10',
      negative: 'SELECT id FROM t ORDER BY id LIMIT 10',
    },
    {
      id: 'RSK-14',
      positive:
        'SELECT a.status, SUM(b.amount) AS total FROM a JOIN b ON a.status = b.status GROUP BY a.status',
      negative:
        'SELECT a.id, SUM(b.amount) AS total FROM a JOIN b ON a.id = b.id GROUP BY a.id',
    },
    {
      id: 'RSK-15',
      positive:
        "SELECT DATE_FORMAT(created_at, '%Y-%m') AS m, COUNT(*) FROM t GROUP BY DATE_FORMAT(created_at, '%Y-%m')",
      negative: 'SELECT created_at FROM t GROUP BY created_at',
    },
    {
      id: 'RSK-16',
      positive: 'SELECT * FROM t WHERE ROWNUM <= 10 ORDER BY id',
      negative: 'SELECT * FROM t WHERE ROWNUM <= 10',
      dialect: 'dm8',
    },
  ];

  for (const entry of cases) {
    it(`${entry.id} positive / negative`, () => {
      const positive = analyzeSql(entry.positive, entry.dialect ?? 'mysql');
      const positiveIssue = positive.issues.find((issue) => issue.ruleId === entry.id);
      const rule = RULES.find((item) => item.id === entry.id)!;
      expect(positiveIssue).toBeDefined();
      expect(positiveIssue!.category).toBe(rule.category);
      expect(positiveIssue!.confidence).toBe(rule.confidence);
      expect(positiveIssue!.detail.length).toBeGreaterThan(0);
      expect(positiveIssue!.suggestion?.length ?? 0).toBeGreaterThan(0);

      const negative = analyzeSql(entry.negative, entry.dialect ?? 'mysql');
      expect(negative.issues.some((issue) => issue.ruleId === entry.id)).toBe(false);
    });
  }

  it('COUNT(*) 不会被当成 SELECT *', () => {
    const analysis = analyzeSql('SELECT COUNT(*) AS cnt FROM dwd_order', 'mysql');
    expect(analysis.issues.some((issue) => issue.ruleId === 'RSK-01')).toBe(false);
  });

  it('RSK-02 不把 WHERE 里的连接条件误报成笛卡尔积', () => {
    const analysis = analyzeSql(
      'SELECT o.id FROM dwd_order o JOIN dim_user u WHERE o.user_id = u.id',
      'mysql',
    );
    expect(analysis.issues.some((issue) => issue.ruleId === 'RSK-02')).toBe(false);
  });

  it('RSK-07 不把 COUNT(DISTINCT) 当成 SELECT DISTINCT', () => {
    const analysis = analyzeSql(
      'SELECT COUNT(DISTINCT o.user_id) AS cnt FROM dwd_order o JOIN dim_user u ON u.id = o.user_id',
      'mysql',
    );
    expect(analysis.issues.some((issue) => issue.ruleId === 'RSK-07')).toBe(false);
  });

  it('RSK-15 不把 PostgreSQL FILTER 当成重复函数', () => {
    const analysis = analyzeSql(
      `SELECT channel_id,
        COUNT(*) FILTER (WHERE status = 'PAID') AS cnt,
        SUM(pay_amount) FILTER (WHERE status = 'PAID') AS gmv
       FROM dwd_order
       GROUP BY channel_id`,
      'postgres',
    );
    expect(analysis.issues.some((issue) => issue.ruleId === 'RSK-15')).toBe(false);
  });

  it('RSK-03 不把 LATERAL 当成函数', () => {
    const analysis = analyzeSql(
      `SELECT u.id
       FROM dim_user u
       LEFT JOIN LATERAL (
         SELECT id FROM dwd_order o WHERE o.user_id = u.id LIMIT 3
       ) x ON true`,
      'postgres',
    );
    expect(analysis.issues.some((issue) => issue.ruleId === 'RSK-03')).toBe(false);
  });

  it('RSK-06 不把最外层 ORDER BY 当成子查询', () => {
    const analysis = analyzeSql('SELECT id FROM t ORDER BY id LIMIT 10', 'mysql');
    expect(analysis.issues.some((issue) => issue.ruleId === 'RSK-06')).toBe(false);
  });

  it('同一规则同一位置只报一次，且保留低置信度', () => {
    const mock: RuleDefinition = {
      id: 'TEST-01',
      name: 'mock',
      severity: 'low',
      category: 'structure',
      confidence: 'low',
      detail: 'mock detail',
      detect: () => [
        { clauseId: 'same', span },
        { clauseId: 'same', span },
      ],
    };

    const issues = runRules(contextOf('SELECT id FROM t'), [mock]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.confidence).toBe('low');
    expect(issues[0]?.id).toContain('TEST-01');
  });
});
