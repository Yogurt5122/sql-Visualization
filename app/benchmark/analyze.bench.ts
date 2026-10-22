import { cpus } from 'node:os';
import { describe, expect, it } from 'vitest';
import { analyzeSql } from '../src/core/explain';

function buildSingleQuery(targetLines: number): { sql: string; columns: number; joins: number; conditions: number } {
  const columns = Math.max(20, Math.round(targetLines * 0.15));
  const joins = Math.max(5, Math.round(targetLines * 0.1));
  const conditions = Math.max(20, targetLines - columns - joins - 12);

  const selectList = Array.from(
    { length: columns },
    (_, index) => `  t0.metric_${index + 1}`,
  ).join(',\n');
  const joinList = Array.from(
    { length: joins },
    (_, index) =>
      `LEFT JOIN dim_entity_${index + 1} t${index + 1} ON t${index + 1}.id = t0.entity_${index + 1}_id`,
  ).join('\n');
  const whereList = Array.from(
    { length: conditions },
    (_, index) => `  AND t0.flag_${index + 1} = ${index % 2}`,
  ).join('\n');

  const sql = `WITH base AS (
  SELECT *
  FROM fact_entity t0
  WHERE dt >= '2024-01-01'
)
SELECT
${selectList}
FROM base t0
${joinList}
WHERE t0.dt >= '2024-01-01'
${whereList}
ORDER BY t0.metric_1 DESC
LIMIT 1000`;

  return { sql, columns, joins, conditions };
}

function buildMultiStatement(targetLines: number): string {
  const statements = Math.max(2, Math.floor(targetLines / 8));
  return Array.from({ length: statements }, (_, index) => `SELECT
  id,
  name,
  amount
FROM fact_entity_${index % 20}
WHERE dt = '2024-12-01'
  AND status = 'PAID';`).join('\n');
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function measure(sql: string, runs = 5): { median: number; min: number; max: number } {
  analyzeSql(sql, 'mysql');
  const samples = Array.from({ length: runs }, () => {
    const start = performance.now();
    analyzeSql(sql, 'mysql');
    return performance.now() - start;
  });
  return {
    median: median(samples),
    min: Math.min(...samples),
    max: Math.max(...samples),
  };
}

describe('性能基准', () => {
  it('单条大查询与多语句脚本', () => {
    const cpu = cpus()[0]?.model?.trim() ?? 'unknown CPU';
    console.log(`\nNode ${process.version} · ${cpu}`);
    console.log('target lines | actual lines | statements | median ms | min ms | max ms');

    for (const target of [100, 500, 1000, 2000, 5000, 10000]) {
      const { sql, columns, joins, conditions } = buildSingleQuery(target);
      const lines = sql.split('\n').length;
      const timing = measure(sql);
      const analysis = analyzeSql(sql, 'mysql');
      console.log(
        `${String(target).padStart(12)} | ${String(lines).padStart(12)} | ${String(analysis.statements.length).padStart(10)} | ${timing.median.toFixed(1).padStart(9)} | ${timing.min.toFixed(1).padStart(6)} | ${timing.max.toFixed(1).padStart(6)}`,
      );
      console.log(
        `  columns=${columns} joins=${joins} conditions=${conditions} mode=${analysis.mode} tables=${analysis.metrics.tables}`,
      );
      expect(analysis.statements.length).toBe(1);
      expect(timing.median).toBeGreaterThan(0);
    }

    for (const target of [500, 2000]) {
      const sql = buildMultiStatement(target);
      const lines = sql.split('\n').length;
      const timing = measure(sql);
      const analysis = analyzeSql(sql, 'mysql');
      console.log(
        `${String(target).padStart(12)} | ${String(lines).padStart(12)} | ${String(analysis.statements.length).padStart(10)} | ${timing.median.toFixed(1).padStart(9)} | ${timing.min.toFixed(1).padStart(6)} | ${timing.max.toFixed(1).padStart(6)}`,
      );
      console.log(`  multi-statement mode=${analysis.mode} tables=${analysis.metrics.tables}`);
      expect(analysis.statements.length).toBeGreaterThan(1);
      expect(timing.median).toBeGreaterThan(0);
    }
  });
});
