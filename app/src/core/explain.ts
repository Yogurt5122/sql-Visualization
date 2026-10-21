import { resolveDialect } from './dialects';
import { scan } from './scanner';
import { splitStatements } from './splitter';
import { splitTopLevel, stripLeadingKeyword } from './sql-text';
import type {
  Analysis,
  Clause,
  Dialect,
  Explanation,
  Issue,
  Statement,
} from './types';

const IDENT = '[\\w$."`\\[\\]]+';

const OP_TEXT: Record<string, string> = {
  '=': '等于',
  '<>': '不等于',
  '!=': '不等于',
  '>': '大于',
  '<': '小于',
  '>=': '大于等于',
  '<=': '小于等于',
};

const AGG_TEXT: Record<string, string> = {
  COUNT: '计数',
  SUM: '合计',
  AVG: '平均值',
  MIN: '最小值',
  MAX: '最大值',
};

const JOIN_TEXT: Record<string, string> = {
  LEFT: '左连接（左表全保留，右表匹配不到补空）',
  RIGHT: '右连接（右表全保留，左表匹配不到补空）',
  FULL: '全连接（两边都保留）',
  CROSS: '交叉连接（两表逐行组合）',
  NATURAL: '自然连接（按同名字段自动关联）',
};

function truncate(text: string, max: number): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, max)}…` : compact;
}

function cleanValue(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"')))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * 按顶层 AND / OR 拆分谓词。BETWEEN x AND y 里的 AND 不拆。
 */
function splitConditions(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  let pendingBetween = 0;
  let i = 0;

  while (i < text.length) {
    const ch = text[i]!;
    if (quote) {
      if (ch === quote) {
        if (text[i + 1] === quote) i += 1;
        else quote = null;
      }
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '(') {
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ')') {
      depth = Math.max(0, depth - 1);
      i += 1;
      continue;
    }

    const atWordStart =
      depth === 0 &&
      /[A-Za-z_]/.test(ch) &&
      (i === 0 || !/[A-Za-z0-9_]/.test(text[i - 1]!));

    if (atWordStart) {
      const match = /^[A-Za-z_]+/.exec(text.slice(i));
      if (match) {
        const word = match[0].toUpperCase();
        if (word === 'BETWEEN') {
          pendingBetween += 1;
          i += match[0].length;
          continue;
        }
        if (word === 'AND' && pendingBetween > 0) {
          pendingBetween -= 1;
          i += match[0].length;
          continue;
        }
        if ((word === 'AND' || word === 'OR') && pendingBetween === 0) {
          parts.push(text.slice(start, i).trim());
          i += match[0].length;
          start = i;
          continue;
        }
        i += match[0].length;
        continue;
      }
    }

    i += 1;
  }

  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

function describeCondition(raw: string): string {
  const text = raw.trim();
  if (!text) return '';

  let match = new RegExp(`^(${IDENT})\\s*(=|<>|!=|>=|<=|>|<)\\s*(.+)$`).exec(text);
  if (match) {
    return `${match[1]} ${OP_TEXT[match[2]!] ?? '满足'} ${cleanValue(match[3]!)}`;
  }

  match = new RegExp(`^(${IDENT})\\s+IS\\s+(NOT\\s+)?NULL$`, 'i').exec(text);
  if (match) {
    return `${match[1]} ${match[2] ? '不为空' : '为空'}`;
  }

  match = new RegExp(`^(${IDENT})\\s+(NOT\\s+)?IN\\s*\\(`, 'i').exec(text);
  if (match) {
    const values = text.slice(text.indexOf('(') + 1, text.lastIndexOf(')'));
    const count = values.trim() ? splitTopLevel(values, ',').length : 0;
    return `${match[1]} ${match[2] ? '不属于' : '属于'} ${count} 个指定值`;
  }

  match = new RegExp(`^(${IDENT})\\s+(NOT\\s+)?LIKE\\s+(.+)$`, 'i').exec(text);
  if (match) {
    return `${match[1]} ${match[2] ? '不' : ''}匹配 ${cleanValue(match[3]!)}`;
  }

  match = new RegExp(`^(${IDENT})\\s+BETWEEN\\s+(.+?)\\s+AND\\s+(.+)$`, 'i').exec(text);
  if (match) {
    return `${match[1]} 在 ${cleanValue(match[2]!)} 到 ${cleanValue(match[3]!)} 之间`;
  }

  match = /^(NOT\s+)?EXISTS\s*\(/i.exec(text);
  if (match) {
    return `${match[1] ? '不' : ''}存在满足子查询条件的记录`;
  }

  return truncate(text, 40);
}

interface TablePart {
  table: string;
  alias?: string;
}

const RESERVED_ALIAS = new Set([
  'LEFT',
  'RIGHT',
  'FULL',
  'INNER',
  'CROSS',
  'NATURAL',
  'JOIN',
  'ON',
  'WHERE',
  'GROUP',
  'ORDER',
  'LIMIT',
]);

function parseFromPart(part: string): TablePart | null {
  const trimmed = part.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('(')) return { table: '子查询' };

  const match = /^([A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*)?)(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/.exec(
    trimmed,
  );
  if (!match) return null;

  const alias =
    match[2] && !RESERVED_ALIAS.has(match[2].toUpperCase()) ? match[2] : undefined;
  return { table: match[1]!, alias };
}

function parseFromClause(clause: Clause): TablePart[] {
  return splitTopLevel(stripLeadingKeyword(clause.text, 'FROM'), ',')
    .map(parseFromPart)
    .filter((part): part is TablePart => part !== null);
}

function tableLabel(part: TablePart): string {
  return part.alias ? `${part.table}（别名 ${part.alias}）` : part.table;
}

function afterKeyword(text: string, keyword: string): string | null {
  const match = new RegExp(`\\b${keyword}\\b`, 'i').exec(text);
  if (!match) return null;
  return text.slice(match.index + match[0].length).trim();
}

function describeJoin(clause: Clause): { plain: string; table?: string } {
  const match =
    /^\s*(?:(LEFT|RIGHT|FULL|INNER|CROSS|NATURAL)\s+(?:OUTER\s+)?)?JOIN\s+([A-Za-z_][\w$."`\[\]]*)(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?/i.exec(
      clause.text,
    );
  if (!match) {
    return { plain: '这里有一个连接，但没能识别出表名。' };
  }

  const type = match[1]?.toUpperCase();
  const table = match[2]!;
  const alias =
    match[3] && !RESERVED_ALIAS.has(match[3].toUpperCase()) ? match[3] : undefined;
  const typeText = type ? (JOIN_TEXT[type] ?? '连接') : '内连接（匹配不到的行会被丢弃）';
  const label = alias ? `${table}（别名 ${alias}）` : table;

  const on = afterKeyword(clause.text, 'ON');
  const using = afterKeyword(clause.text, 'USING');
  const condition = on ?? (using ? `USING (${using})` : null);

  if (!condition) {
    return {
      plain: `${typeText} ${label}，但这一行没有写连接条件——结果行数会是两表行数相乘（笛卡尔积）。`,
      table,
    };
  }

  return {
    plain: `${typeText} ${label}，连接条件：${truncate(condition, 60)}。`,
    table,
  };
}

function parseSelectItems(clause: Clause): string[] {
  const body = stripLeadingKeyword(clause.text, 'SELECT').replace(/^DISTINCT\s+/i, '');
  return splitTopLevel(body, ',');
}

function describeSelectItem(item: string): string {
  const trimmed = item.trim();
  if (trimmed === '*') return '全部字段';

  const countStar = /^COUNT\s*\(\s*\*\s*\)(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?$/i.exec(trimmed);
  if (countStar) {
    return countStar[1] ? `行数（${countStar[1]}）` : '行数';
  }

  const agg = /^(COUNT|SUM|AVG|MIN|MAX)\s*\(\s*(.+?)\s*\)(?:\s+(?:AS\s+)?([A-Za-z_]\w*))?$/i.exec(
    trimmed,
  );
  if (agg) {
    const text = AGG_TEXT[agg[1]!.toUpperCase()] ?? agg[1];
    const alias = agg[3] ? `（${agg[3]}）` : '';
    return `${truncate(agg[2]!, 24)} 的${text}${alias}`;
  }

  const alias = /^(.*?)\s+AS\s+([A-Za-z_]\w*)$/i.exec(trimmed);
  if (alias) {
    return `${truncate(alias[1]!, 24)}（命名为 ${alias[2]}）`;
  }

  return truncate(trimmed, 32);
}

function describeOrderItem(item: string): string {
  const direction = /\b(DESC|ASC)\b/i.exec(item);
  const expr = item.replace(/\b(ASC|DESC)\b/i, '').replace(/\s+/g, ' ').trim();
  return `${expr} ${direction ? (direction[1]!.toUpperCase() === 'DESC' ? '降序' : '升序') : '升序'}`;
}

function limitValue(text: string): string {
  const match = /\b(\d+)\b/.exec(text);
  return match ? match[1]! : '若干';
}

function explainClause(clause: Clause): { plain: string; refs: string[] } {
  const refs = new Set<string>();

  switch (clause.kind) {
    case 'select': {
      const items = parseSelectItems(clause);
      const distinct = /^\s*SELECT\s+DISTINCT\b/i.test(clause.text);
      const described = items.map(describeSelectItem).join('、');
      return {
        plain: `最终输出 ${items.length} 列：${described}${distinct ? '（结果去重）' : ''}。`,
        refs: [],
      };
    }
    case 'from': {
      const parts = parseFromClause(clause);
      parts.forEach((part) => refs.add(part.table));
      if (parts.length === 0) return { plain: '从某处取数，但没能识别出表名。', refs: [] };
      if (parts.length === 1) {
        return { plain: `主表是 ${tableLabel(parts[0]!)}。`, refs: [...refs] };
      }
      return {
        plain: `从 ${parts.map(tableLabel).join('、')} 取数；逗号连接属于隐式连接，注意漏写条件会变成笛卡尔积。`,
        refs: [...refs],
      };
    }
    case 'join': {
      const result = describeJoin(clause);
      if (result.table) refs.add(result.table);
      return { plain: result.plain, refs: [...refs] };
    }
    case 'where': {
      const conditions = splitConditions(stripLeadingKeyword(clause.text, 'WHERE'));
      if (conditions.length === 0) return { plain: '没有有效的过滤条件。', refs: [] };
      const described = conditions.slice(0, 3).map(describeCondition);
      const suffix = conditions.length > 3 ? `等 ${conditions.length} 个条件` : '';
      return {
        plain: `只看 ${described.join('、')}${suffix} 的数据。`,
        refs: [],
      };
    }
    case 'groupBy': {
      const items = splitTopLevel(stripLeadingKeyword(clause.text, 'GROUP BY'), ',');
      return { plain: `按 ${items.join('、')} 分组，每组一行。`, refs: [] };
    }
    case 'having': {
      const conditions = splitConditions(stripLeadingKeyword(clause.text, 'HAVING'));
      return {
        plain: `分组后再筛：${conditions.map(describeCondition).join('、')}。`,
        refs: [],
      };
    }
    case 'orderBy': {
      const items = splitTopLevel(stripLeadingKeyword(clause.text, 'ORDER BY'), ',');
      return { plain: `按 ${items.map(describeOrderItem).join('、')} 排序。`, refs: [] };
    }
    case 'limit': {
      return { plain: `结果只取前 ${limitValue(clause.text)} 行。`, refs: [] };
    }
    case 'offset': {
      return { plain: `跳过前 ${limitValue(clause.text)} 行。`, refs: [] };
    }
    case 'union': {
      const all = /\bUNION\s+ALL\b/i.test(clause.text);
      return {
        plain: all ? '把前后两段结果合并，保留重复行。' : '把前后两段结果合并并去重。',
        refs: [],
      };
    }
    case 'with': {
      const names = [...clause.text.matchAll(/([A-Za-z_]\w*)\s+AS\s*\(/gi)].map(
        (match) => match[1]!,
      );
      return {
        plain: names.length
          ? `先定义 ${names.length} 个公共表达式（CTE）：${names.join('、')}。`
          : '先用 WITH 定义公共表达式。',
        refs: [],
      };
    }
    case 'insert': {
      const match = /INSERT\s+INTO\s+([A-Za-z_][\w$."`\[\]]*)/i.exec(clause.text);
      if (match) refs.add(match[1]!);
      return { plain: `向 ${match?.[1] ?? '目标表'} 插入数据。`, refs: [...refs] };
    }
    case 'update': {
      const match = /UPDATE\s+([A-Za-z_][\w$."`\[\]]*)/i.exec(clause.text);
      if (match) refs.add(match[1]!);
      return { plain: `更新 ${match?.[1] ?? '目标表'} 的数据。`, refs: [...refs] };
    }
    case 'delete': {
      const match = /DELETE\s+FROM\s+([A-Za-z_][\w$."`\[\]]*)/i.exec(clause.text);
      if (match) refs.add(match[1]!);
      return { plain: `删除 ${match?.[1] ?? '目标表'} 的数据。`, refs: [...refs] };
    }
    case 'other':
    default:
      return { plain: '这段是语句的辅助片段。', refs: [] };
  }
}

function buildExplanations(statements: Statement[]): Explanation[] {
  const result: Explanation[] = [];
  for (const statement of statements) {
    for (const clause of statement.clauses) {
      const { plain, refs } = explainClause(clause);
      result.push({
        clauseId: clause.id,
        plain,
        technical: truncate(clause.text, 400),
        refs,
      });
    }
  }
  return result;
}

function findClause(statement: Statement, kind: Clause['kind']): Clause | undefined {
  return statement.clauses.find((clause) => clause.kind === kind);
}

function buildSummary(statements: Statement[]): string {
  if (statements.length === 0) return '还没有可分析的 SQL。';

  const first = statements[0]!;
  const parts: string[] = [];
  const from = findClause(first, 'from');
  const joins = first.clauses.filter((clause) => clause.kind === 'join');
  const where = findClause(first, 'where');
  const groupBy = findClause(first, 'groupBy');
  const having = findClause(first, 'having');
  const select = findClause(first, 'select');
  const orderBy = findClause(first, 'orderBy');
  const limit = findClause(first, 'limit');

  if (from) {
    const tables = parseFromClause(from);
    if (tables.length) parts.push(`从 ${tables.map(tableLabel).join('、')} 取数`);
  }
  if (joins.length) {
    const names = joins
      .map((clause) => /JOIN\s+([A-Za-z_][\w$."`\[\]]*)/i.exec(clause.text)?.[1])
      .filter((name): name is string => Boolean(name));
    if (names.length) parts.push(`关联 ${names.join('、')}`);
  }
  if (where) {
    const count = splitConditions(stripLeadingKeyword(where.text, 'WHERE')).length;
    if (count) parts.push(`只看 ${count} 个条件`);
  }
  if (groupBy) {
    const items = splitTopLevel(stripLeadingKeyword(groupBy.text, 'GROUP BY'), ',');
    if (items.length) parts.push(`按 ${items.join('、')} 分组`);
  }
  if (having) {
    parts.push('分组后再筛');
  }
  if (select) {
    const count = parseSelectItems(select).length;
    if (count) parts.push(`输出 ${count} 列`);
  }
  if (orderBy) {
    const items = splitTopLevel(stripLeadingKeyword(orderBy.text, 'ORDER BY'), ',');
    if (items.length) parts.push(`按 ${items.map(describeOrderItem).join('、')} 排序`);
  }
  if (limit) {
    parts.push(`取前 ${limitValue(limit.text)} 行`);
  }

  const body = parts.length ? `${parts.join('，')}。` : '没有识别出可解释的子句。';
  if (statements.length === 1) return body;
  return `共 ${statements.length} 条语句。第一条：${body}`;
}

function detectIssues(statement: Statement, dialect: Dialect): Issue[] {
  const issues: Issue[] = [];

  for (const clause of statement.clauses) {
    if (clause.kind === 'select') {
      const items = parseSelectItems(clause);
      const hasStar = items.some(
        (item) => item.trim() === '*' || /^[A-Za-z_]\w*\.\*$/.test(item.trim()),
      );
      if (hasStar) {
        issues.push({
          id: `RSK-01-${clause.id}`,
          ruleId: 'RSK-01',
          severity: 'medium',
          title: 'SELECT * 会带出全部字段',
          detail: '字段数量取决于表结构；如果下游依赖列顺序，表结构一变就可能出问题。',
          clauseId: clause.id,
          span: clause.span,
        });
      }
    }

    if (clause.kind === 'join' && !/\bON\b|\bUSING\b|\bCROSS\s+JOIN\b/i.test(clause.text)) {
      issues.push({
        id: `RSK-02-${clause.id}`,
        ruleId: 'RSK-02',
        severity: 'high',
        title: 'JOIN 缺少连接条件',
        detail: '两张表没有任何关联条件，结果行数等于两表行数相乘（笛卡尔积）。',
        clauseId: clause.id,
        span: clause.span,
      });
    }

    if (clause.kind === 'where' && /\bNOT\s+IN\s*\(/i.test(clause.text)) {
      issues.push({
        id: `RSK-11-${clause.id}`,
        ruleId: 'RSK-11',
        severity: 'high',
        title: 'NOT IN 可能因 NULL 返回空结果',
        detail: '如果子查询结果里包含 NULL，NOT IN 的整体判断会变成 UNKNOWN，导致查不到任何行。',
        clauseId: clause.id,
        span: clause.span,
      });
    }
  }

  const hasLimit = Boolean(findClause(statement, 'limit'));
  const hasOrder = Boolean(findClause(statement, 'orderBy'));
  if (hasLimit && !hasOrder) {
    const limit = findClause(statement, 'limit')!;
    issues.push({
      id: `RSK-13-${statement.id}`,
      ruleId: 'RSK-13',
      severity: 'medium',
      title: 'LIMIT 没有 ORDER BY，取到哪几行不确定',
      detail: '没有排序时，数据库返回的顺序不保证稳定；分页或抽样场景可能每次结果不同。',
      clauseId: limit.id,
      span: limit.span,
    });
  }

  if (dialect === 'dm8') {
    const text = statement.text;
    if (/\bROWNUM\b/i.test(text) && hasOrder && /\bROWNUM\s*(<=|<|=)/i.test(text)) {
      const rownumClause =
        statement.clauses.find((clause) => /\bROWNUM\b/i.test(clause.text)) ??
        findClause(statement, 'where');
      issues.push({
        id: `RSK-16-${statement.id}`,
        ruleId: 'RSK-16',
        severity: 'high',
        title: 'ROWNUM 与 ORDER BY 同层，取到的不是「前 N 名」',
        detail:
          'DM8 会先给行编号、再排序。想取排序后的前 N 行，需要先在子查询里排序，外层再限制 ROWNUM。',
        clauseId: rownumClause?.id,
        span: rownumClause?.span,
      });
    }
  }

  return issues;
}

export function analyzeSql(sql: string, selectedDialect: Dialect = 'auto'): Analysis {
  const guess = resolveDialect(selectedDialect, sql);
  const { tokens, errors } = scan(sql);
  const statements = splitStatements(sql, tokens);
  const explanations = buildExplanations(statements);
  const issues = statements.flatMap((statement) => detectIssues(statement, guess.dialect));
  const summary = buildSummary(statements);

  const warnings = errors.map(
    (error) => `第 ${error.line} 行第 ${error.col} 列：${error.message}`,
  );
  if (statements.length === 0 && sql.trim()) {
    warnings.push('没有识别到可分析的 SQL 语句。');
  }

  return {
    dialect: guess.dialect,
    confidence: guess.confidence,
    statements,
    explanations,
    issues,
    summary,
    warnings,
    mode: 'structural',
  };
}
