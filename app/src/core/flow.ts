import type { Clause, Statement } from './types';
import { splitTopLevel, stripLeadingKeyword } from './sql-text';

export type FlowStageKind =
  | 'source'
  | 'where'
  | 'groupBy'
  | 'having'
  | 'window'
  | 'select'
  | 'distinct'
  | 'orderBy'
  | 'limit';

export type FlowEffect =
  | 'source'
  | 'filter'
  | 'aggregate'
  | 'compute'
  | 'distinct'
  | 'sort'
  | 'truncate';

export interface FlowStep {
  id: string;
  kind: FlowStageKind;
  /** SQL 关键字，例如 FROM / JOIN */
  label: string;
  /** 中文动作，例如 取数 */
  title: string;
  /** 一句话细节，例如 2 张表 · 1 个连接 */
  detail: string;
  effect: FlowEffect;
  startLine: number;
  endLine: number;
  clauseIds: string[];
}

function makeStep(
  statement: Statement,
  kind: FlowStageKind,
  label: string,
  title: string,
  detail: string,
  effect: FlowEffect,
  clauses: Clause[],
): FlowStep {
  const startLine = Math.min(...clauses.map((clause) => clause.span.startLine));
  const endLine = Math.max(...clauses.map((clause) => clause.span.endLine));
  return {
    id: `${statement.id}-${kind}`,
    kind,
    label,
    title,
    detail,
    effect,
    startLine,
    endLine,
    clauseIds: clauses.map((clause) => clause.id),
  };
}

function countItems(text: string): number {
  return splitTopLevel(text, ',').length;
}

/**
 * 以数据库的**逻辑求值顺序**生成执行流程，而不是 SQL 的书写顺序。
 *
 * FROM/JOIN → WHERE → GROUP BY → HAVING → 窗口 → SELECT → DISTINCT → ORDER BY → LIMIT
 */
export function buildFlow(statement: Statement): FlowStep[] {
  const steps: FlowStep[] = [];
  const find = (kind: Clause['kind']): Clause | undefined =>
    statement.clauses.find((clause) => clause.kind === kind);

  const from = find('from');
  const joins = statement.clauses.filter((clause) => clause.kind === 'join');
  const where = find('where');
  const groupBy = find('groupBy');
  const having = find('having');
  const select = find('select');
  const orderBy = find('orderBy');
  const limit = find('limit');

  if (from) {
    const sourceCount = countItems(stripLeadingKeyword(from.text, 'FROM')) + joins.length;
    const detail =
      joins.length > 0
        ? `${sourceCount} 张表 · ${joins.length} 个连接`
        : `${sourceCount} 张表`;
    steps.push(
      makeStep(statement, 'source', 'FROM / JOIN', '取数', detail, 'source', [from, ...joins]),
    );
  } else if (joins.length > 0) {
    steps.push(
      makeStep(statement, 'source', 'JOIN', '取数', `${joins.length} 个连接`, 'source', joins),
    );
  }

  if (where) {
    steps.push(
      makeStep(statement, 'where', 'WHERE', '过滤', '只保留满足条件的行', 'filter', [where]),
    );
  }

  if (groupBy) {
    const count = countItems(stripLeadingKeyword(groupBy.text, 'GROUP BY'));
    steps.push(
      makeStep(
        statement,
        'groupBy',
        'GROUP BY',
        '聚合',
        `按 ${count} 个字段分组`,
        'aggregate',
        [groupBy],
      ),
    );
  }

  if (having) {
    steps.push(
      makeStep(statement, 'having', 'HAVING', '过滤', '分组后再筛一遍', 'filter', [having]),
    );
  }

  if (select) {
    const body = stripLeadingKeyword(select.text, 'SELECT');
    const hasWindow = /\bOVER\s*\(/i.test(body);
    const hasDistinct = /^DISTINCT\b/i.test(body);
    const columnCount = countItems(body.replace(/^DISTINCT\s+/i, ''));

    if (hasWindow) {
      steps.push(
        makeStep(statement, 'window', 'WINDOW', '计算', '在结果集上算窗口函数', 'compute', [
          select,
        ]),
      );
    }

    steps.push(
      makeStep(statement, 'select', 'SELECT', '计算', `输出 ${columnCount} 列`, 'compute', [
        select,
      ]),
    );

    if (hasDistinct) {
      steps.push(
        makeStep(statement, 'distinct', 'DISTINCT', '去重', '对结果去重', 'distinct', [select]),
      );
    }
  }

  if (orderBy) {
    const count = countItems(stripLeadingKeyword(orderBy.text, 'ORDER BY'));
    steps.push(
      makeStep(statement, 'orderBy', 'ORDER BY', '排序', `按 ${count} 个字段排序`, 'sort', [
        orderBy,
      ]),
    );
  }

  if (limit) {
    const value = /\d+/.exec(limit.text)?.[0] ?? '若干';
    steps.push(
      makeStep(statement, 'limit', 'LIMIT', '截断', `只取前 ${value} 行`, 'truncate', [limit]),
    );
  }

  return steps;
}
