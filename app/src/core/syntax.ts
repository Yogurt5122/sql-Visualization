import { scan } from './scanner';

export interface SyntaxEntry {
  keyword: string;
  category: string;
  summary: string;
  syntax: string;
  example: string;
  dialects: string[];
  note?: string;
  related?: string[];
}

const ALL = ['MySQL', 'PostgreSQL', 'SQL Server', 'DM8'];

export const SYNTAX_ENTRIES: Record<string, SyntaxEntry> = {
  SELECT: {
    keyword: 'SELECT',
    category: '查询',
    summary: '筛选结果列。决定查询最终输出哪些字段或表达式。',
    syntax: 'SELECT [DISTINCT] 列1, 列2\nFROM 表;',
    example: 'SELECT o.user_id, o.amount\nFROM t_demo_order o;',
    dialects: ALL,
    related: ['FROM', 'WHERE', 'DISTINCT'],
  },
  FROM: {
    keyword: 'FROM',
    category: '查询',
    summary: '指定数据来源。可以是表、CTE 或派生表。',
    syntax: 'SELECT ...\nFROM 表 [别名];',
    example: 'SELECT *\nFROM t_demo_order o;',
    dialects: ALL,
    related: ['SELECT', 'JOIN', 'WITH'],
  },
  WHERE: {
    keyword: 'WHERE',
    category: '过滤',
    summary: '在分组前过滤行。只保留满足条件的行。',
    syntax: 'SELECT ...\nFROM 表\nWHERE 条件;',
    example: "SELECT *\nFROM t_demo_order\nWHERE status = 'PAID';",
    dialects: ALL,
    related: ['AND', 'OR', 'IN', 'EXISTS'],
  },
  JOIN: {
    keyword: 'JOIN',
    category: '连接',
    summary: '把另一张表按关联条件接进来，默认是内连接。',
    syntax: 'FROM a\nJOIN b ON a.id = b.id;',
    example: 'FROM t_demo_order o\nJOIN t_demo_user_dim u ON o.user_id = u.id;',
    dialects: ALL,
    related: ['LEFT JOIN', 'INNER JOIN', 'ON'],
  },
  'LEFT JOIN': {
    keyword: 'LEFT JOIN',
    category: '连接',
    summary: '保留左表全部行；右表匹配不到时补 NULL。',
    syntax: 'FROM a\nLEFT JOIN b ON a.id = b.id;',
    example: 'FROM t_demo_order o\nLEFT JOIN t_demo_refund r ON o.order_id = r.order_id;',
    dialects: ALL,
    related: ['JOIN', 'ON', 'RIGHT JOIN'],
  },
  'RIGHT JOIN': {
    keyword: 'RIGHT JOIN',
    category: '连接',
    summary: '保留右表全部行；左表匹配不到时补 NULL。',
    syntax: 'FROM a\nRIGHT JOIN b ON a.id = b.id;',
    example: 'FROM t_demo_order o\nRIGHT JOIN t_demo_user_dim u ON o.user_id = u.id;',
    dialects: ALL,
    related: ['JOIN', 'LEFT JOIN', 'ON'],
  },
  'INNER JOIN': {
    keyword: 'INNER JOIN',
    category: '连接',
    summary: '只保留两边都匹配上的行，和普通 JOIN 等价。',
    syntax: 'FROM a\nINNER JOIN b ON a.id = b.id;',
    example: 'FROM t_demo_order o\nINNER JOIN t_demo_user_dim u ON o.user_id = u.id;',
    dialects: ALL,
    related: ['JOIN', 'LEFT JOIN', 'ON'],
  },
  ON: {
    keyword: 'ON',
    category: '连接',
    summary: '指定 JOIN 的关联条件。',
    syntax: 'JOIN 表 ON 左键 = 右键;',
    example: 'JOIN t_demo_user_dim u ON o.user_id = u.id;',
    dialects: ALL,
    related: ['JOIN', 'LEFT JOIN', 'WHERE'],
  },
  'GROUP BY': {
    keyword: 'GROUP BY',
    category: '分组',
    summary: '把行按指定列分组，每组通常只输出一行。',
    syntax: 'GROUP BY 列1, 列2;',
    example: 'SELECT user_id, SUM(amount)\nFROM t_demo_order\nGROUP BY user_id;',
    dialects: ALL,
    related: ['HAVING', 'SELECT'],
  },
  HAVING: {
    keyword: 'HAVING',
    category: '分组',
    summary: '在 GROUP BY 之后过滤分组，条件里可以用聚合函数。',
    syntax: 'GROUP BY ...\nHAVING 聚合条件;',
    example: 'GROUP BY user_id\nHAVING SUM(amount) > 1000;',
    dialects: ALL,
    related: ['GROUP BY', 'WHERE'],
  },
  'ORDER BY': {
    keyword: 'ORDER BY',
    category: '排序',
    summary: '按一个或多个列排序，可指定 ASC / DESC。',
    syntax: 'ORDER BY 列1 [DESC], 列2 [ASC];',
    example: 'SELECT user_id, amount\nFROM t_demo_order\nORDER BY amount DESC;',
    dialects: ALL,
    related: ['LIMIT', 'SELECT'],
  },
  LIMIT: {
    keyword: 'LIMIT',
    category: '限制',
    summary: '只返回前 N 行，常和 ORDER BY 一起做 Top N。',
    syntax: 'LIMIT 行数;',
    example: 'SELECT *\nFROM t_demo_order\nORDER BY amount DESC\nLIMIT 100;',
    dialects: ['MySQL', 'PostgreSQL', 'DM8'],
    note: 'SQL Server 使用 TOP 或 OFFSET ... FETCH。',
    related: ['ORDER BY', 'TOP'],
  },
  TOP: {
    keyword: 'TOP',
    category: '限制',
    summary: '只返回前 N 行，SQL Server 专用。',
    syntax: 'SELECT TOP (N) ...;',
    example: 'SELECT TOP (100) *\nFROM t_demo_order\nORDER BY amount DESC;',
    dialects: ['SQL Server'],
    related: ['ORDER BY', 'LIMIT'],
  },
  DISTINCT: {
    keyword: 'DISTINCT',
    category: '查询',
    summary: '对结果行去重；作用于整行，不是只作用于紧跟的一列。',
    syntax: 'SELECT DISTINCT 列1, 列2;',
    example: 'SELECT DISTINCT user_id\nFROM t_demo_order;',
    dialects: ALL,
    related: ['SELECT', 'GROUP BY'],
  },
  WITH: {
    keyword: 'WITH',
    category: '结构',
    summary: '定义 CTE，把复杂查询拆成有名字的中间结果。',
    syntax: 'WITH cte AS (\n  SELECT ...\n)\nSELECT ... FROM cte;',
    example: 'WITH paid AS (\n  SELECT * FROM t_demo_order WHERE status = \'PAID\'\n)\nSELECT * FROM paid;',
    dialects: ALL,
    related: ['AS', 'SELECT', 'UNION'],
  },
  AS: {
    keyword: 'AS',
    category: '结构',
    summary: '给列、表或 CTE 起别名，让后续引用更清晰。',
    syntax: '表达式 AS 别名',
    example: 'SELECT SUM(amount) AS total\nFROM t_demo_order;',
    dialects: ALL,
    related: ['WITH', 'SELECT'],
  },
  UNION: {
    keyword: 'UNION',
    category: '集合',
    summary: '合并两个查询结果并去重，列数和类型要兼容。',
    syntax: 'SELECT ...\nUNION\nSELECT ...;',
    example: 'SELECT user_id FROM t_demo_order\nUNION\nSELECT user_id FROM t_demo_refund;',
    dialects: ALL,
    related: ['UNION ALL', 'SELECT'],
  },
  'UNION ALL': {
    keyword: 'UNION ALL',
    category: '集合',
    summary: '合并两个查询结果但不去重，通常比 UNION 更轻。',
    syntax: 'SELECT ...\nUNION ALL\nSELECT ...;',
    example: 'SELECT user_id FROM t_demo_order\nUNION ALL\nSELECT user_id FROM t_demo_refund;',
    dialects: ALL,
    related: ['UNION', 'SELECT'],
  },
  CASE: {
    keyword: 'CASE',
    category: '表达式',
    summary: '按条件逐条匹配，返回第一个命中的结果。',
    syntax: 'CASE\n  WHEN 条件 THEN 值\n  ELSE 默认值\nEND',
    example: "CASE WHEN amount >= 1000 THEN 'HIGH' ELSE 'NORMAL' END AS amount_level",
    dialects: ALL,
    related: ['WHEN', 'THEN', 'ELSE', 'END'],
  },
  WHEN: {
    keyword: 'WHEN',
    category: '表达式',
    summary: 'CASE 里的条件分支，按从上到下的顺序匹配。',
    syntax: 'CASE WHEN 条件 THEN 值 ... END',
    example: "CASE WHEN status = 'PAID' THEN 1 ELSE 0 END",
    dialects: ALL,
    related: ['CASE', 'THEN', 'END'],
  },
  THEN: {
    keyword: 'THEN',
    category: '表达式',
    summary: 'CASE 条件命中时返回的值或表达式。',
    syntax: 'CASE WHEN 条件 THEN 值 END',
    example: "CASE WHEN amount > 0 THEN 'YES' ELSE 'NO' END",
    dialects: ALL,
    related: ['CASE', 'WHEN', 'ELSE'],
  },
  ELSE: {
    keyword: 'ELSE',
    category: '表达式',
    summary: 'CASE 所有条件都不命中时的兜底结果。',
    syntax: 'CASE ... ELSE 默认值 END',
    example: "CASE WHEN status = 'PAID' THEN 1 ELSE 0 END",
    dialects: ALL,
    related: ['CASE', 'WHEN', 'END'],
  },
  END: {
    keyword: 'END',
    category: '表达式',
    summary: '结束 CASE 表达式；也可以结束存储过程块。',
    syntax: 'CASE ... END',
    example: "CASE WHEN amount > 0 THEN 'Y' ELSE 'N' END AS flag",
    dialects: ALL,
    related: ['CASE', 'WHEN'],
  },
  AND: {
    keyword: 'AND',
    category: '过滤',
    summary: '两个条件必须同时成立。',
    syntax: '条件1 AND 条件2',
    example: "WHERE status = 'PAID' AND amount > 0",
    dialects: ALL,
    related: ['OR', 'WHERE'],
  },
  OR: {
    keyword: 'OR',
    category: '过滤',
    summary: '两个条件任意一个成立即可。',
    syntax: '条件1 OR 条件2',
    example: "WHERE status = 'PAID' OR status = 'DONE'",
    dialects: ALL,
    related: ['AND', 'WHERE'],
  },
  IN: {
    keyword: 'IN',
    category: '过滤',
    summary: '判断值是否属于一个列表或子查询结果。',
    syntax: '列 IN (值1, 值2)',
    example: "WHERE status IN ('PAID', 'DONE')",
    dialects: ALL,
    related: ['EXISTS', 'WHERE'],
  },
  EXISTS: {
    keyword: 'EXISTS',
    category: '过滤',
    summary: '子查询只要能返回至少一行，条件就成立。',
    syntax: 'WHERE EXISTS (SELECT 1 FROM ...)',
    example: 'WHERE EXISTS (\n  SELECT 1 FROM t_demo_refund r WHERE r.order_id = o.order_id\n)',
    dialects: ALL,
    related: ['IN', 'WHERE'],
  },
  OVER: {
    keyword: 'OVER',
    category: '窗口',
    summary: '把聚合或排名函数变成窗口计算，不折叠原始行。',
    syntax: '函数() OVER (PARTITION BY ... ORDER BY ...)',
    example: 'ROW_NUMBER() OVER (PARTITION BY region ORDER BY amount DESC)',
    dialects: ALL,
    related: ['PARTITION BY', 'ORDER BY'],
  },
  'PARTITION BY': {
    keyword: 'PARTITION BY',
    category: '窗口',
    summary: '窗口函数内部先按列分组，再在每组内计算。',
    syntax: 'OVER (PARTITION BY 列 ...)',
    example: 'SUM(amount) OVER (PARTITION BY user_id)',
    dialects: ALL,
    related: ['OVER', 'GROUP BY'],
  },
  INSERT: {
    keyword: 'INSERT',
    category: '写入',
    summary: '向表中插入一行或多行数据。',
    syntax: 'INSERT INTO 表 (列...) VALUES (...);',
    example: "INSERT INTO t_demo_order (user_id, amount)\nVALUES (1, 100);",
    dialects: ALL,
    related: ['VALUES', 'UPDATE', 'DELETE'],
  },
  UPDATE: {
    keyword: 'UPDATE',
    category: '写入',
    summary: '修改表中已存在的行。',
    syntax: 'UPDATE 表 SET 列 = 值 WHERE 条件;',
    example: "UPDATE t_demo_order\nSET status = 'DONE'\nWHERE order_id = 1;",
    dialects: ALL,
    related: ['SET', 'WHERE', 'DELETE'],
  },
  DELETE: {
    keyword: 'DELETE',
    category: '写入',
    summary: '删除满足条件的行。',
    syntax: 'DELETE FROM 表 WHERE 条件;',
    example: 'DELETE FROM t_demo_order WHERE status = \'CANCELED\';',
    dialects: ALL,
    related: ['WHERE', 'UPDATE'],
  },
  VALUES: {
    keyword: 'VALUES',
    category: '写入',
    summary: '给 INSERT 提供要写入的值列表。',
    syntax: 'INSERT INTO 表 (...) VALUES (...), (...);',
    example: "INSERT INTO t_demo_order (user_id, amount)\nVALUES (1, 100), (2, 200);",
    dialects: ALL,
    related: ['INSERT'],
  },
  SET: {
    keyword: 'SET',
    category: '写入',
    summary: '指定 UPDATE 要修改的列和新值。',
    syntax: 'UPDATE 表 SET 列 = 值;',
    example: "UPDATE t_demo_order SET status = 'DONE' WHERE order_id = 1;",
    dialects: ALL,
    related: ['UPDATE', 'WHERE'],
  },
  LIKE: {
    keyword: 'LIKE',
    category: '过滤',
    summary: '按模式匹配字符串，常用 % 表示任意长度，_ 表示单个字符。',
    syntax: "列 LIKE '模式'",
    example: "WHERE user_name LIKE 'demo_%'",
    dialects: ALL,
    related: ['WHERE', 'NOT'],
  },
  BETWEEN: {
    keyword: 'BETWEEN',
    category: '过滤',
    summary: '判断值是否落在闭区间内，边界值也算命中。',
    syntax: '列 BETWEEN 下限 AND 上限',
    example: 'WHERE amount BETWEEN 100 AND 1000',
    dialects: ALL,
    related: ['AND', 'WHERE'],
  },
  NOT: {
    keyword: 'NOT',
    category: '过滤',
    summary: '对条件取反，常用于 NOT IN、NOT LIKE、NOT EXISTS。',
    syntax: 'NOT 条件',
    example: "WHERE status NOT IN ('CANCELED')",
    dialects: ALL,
    related: ['IN', 'EXISTS', 'LIKE'],
  },
  IS: {
    keyword: 'IS',
    category: '过滤',
    summary: '判断 NULL 或布尔状态，NULL 不能用等号比较。',
    syntax: '列 IS NULL / 列 IS NOT NULL',
    example: 'WHERE refund_amount IS NULL',
    dialects: ALL,
    related: ['NULL', 'NOT'],
  },
  NULL: {
    keyword: 'NULL',
    category: '过滤',
    summary: '表示未知或缺失值；判断时要使用 IS NULL / IS NOT NULL。',
    syntax: '列 IS NULL',
    example: 'WHERE user_id IS NULL',
    dialects: ALL,
    related: ['IS', 'NOT'],
  },
  OFFSET: {
    keyword: 'OFFSET',
    category: '限制',
    summary: '跳过前 N 行，常与 FETCH / LIMIT 配合做分页。',
    syntax: 'OFFSET N ROWS',
    example: 'ORDER BY amount DESC\nOFFSET 20 ROWS\nFETCH NEXT 10 ROWS ONLY;',
    dialects: ['PostgreSQL', 'SQL Server', 'DM8'],
    note: 'MySQL 使用 LIMIT offset, count。',
    related: ['FETCH', 'LIMIT', 'ORDER BY'],
  },
  FETCH: {
    keyword: 'FETCH',
    category: '限制',
    summary: '在 OFFSET 之后取固定行数，SQL Server / PostgreSQL 常用。',
    syntax: 'OFFSET N ROWS FETCH NEXT M ROWS ONLY',
    example: 'ORDER BY amount DESC\nOFFSET 0 ROWS\nFETCH NEXT 10 ROWS ONLY;',
    dialects: ['PostgreSQL', 'SQL Server', 'DM8'],
    related: ['OFFSET', 'ORDER BY', 'LIMIT'],
  },
  ROWNUM: {
    keyword: 'ROWNUM',
    category: '限制',
    summary: '按结果行号限制返回行数，常见于 DM8 / Oracle 风格 SQL。',
    syntax: 'WHERE ROWNUM <= N',
    example: 'SELECT *\nFROM t_demo_order\nWHERE ROWNUM <= 100;',
    dialects: ['DM8'],
    related: ['LIMIT', 'ORDER BY'],
  },
  'CREATE TABLE': {
    keyword: 'CREATE TABLE',
    category: 'DDL',
    summary: '创建表并定义列、类型和约束。',
    syntax: 'CREATE TABLE 表 (\n  列 类型 [约束],\n  ...\n);',
    example: 'CREATE TABLE t_demo_order (\n  order_id INT,\n  amount DECIMAL(12, 2)\n);',
    dialects: ALL,
    related: ['ALTER TABLE', 'DROP TABLE', 'PRIMARY KEY'],
  },
  'ALTER TABLE': {
    keyword: 'ALTER TABLE',
    category: 'DDL',
    summary: '修改表结构，例如增加列、修改类型或添加约束。',
    syntax: 'ALTER TABLE 表 ADD 列 类型;',
    example: 'ALTER TABLE t_demo_order\nADD status VARCHAR(20);',
    dialects: ALL,
    related: ['CREATE TABLE', 'DROP TABLE'],
  },
  'DROP TABLE': {
    keyword: 'DROP TABLE',
    category: 'DDL',
    summary: '删除整张表及表结构，属于高危操作。',
    syntax: 'DROP TABLE 表;',
    example: 'DROP TABLE t_demo_order;',
    dialects: ALL,
    note: '执行前确认备份和依赖对象；生产环境不要直接执行。',
    related: ['CREATE TABLE', 'ALTER TABLE'],
  },
  'PRIMARY KEY': {
    keyword: 'PRIMARY KEY',
    category: 'DDL',
    summary: '定义主键，保证列值唯一且非空。',
    syntax: '列 类型 PRIMARY KEY',
    example: 'CREATE TABLE t_demo_order (\n  order_id INT PRIMARY KEY,\n  amount DECIMAL(12, 2)\n);',
    dialects: ALL,
    related: ['FOREIGN KEY', 'CREATE TABLE'],
  },
  'FOREIGN KEY': {
    keyword: 'FOREIGN KEY',
    category: 'DDL',
    summary: '定义外键，约束本表列引用另一张表的主键或唯一键。',
    syntax: 'FOREIGN KEY (列) REFERENCES 表 (列)',
    example: 'FOREIGN KEY (user_id) REFERENCES t_demo_user_dim (id)',
    dialects: ALL,
    related: ['PRIMARY KEY', 'CREATE TABLE'],
  },
};

export interface KeywordHit {
  entry: SyntaxEntry;
  tokenStart: number;
  tokenEnd: number;
}

/** 找到光标/点击位置上的关键字，支持 GROUP BY、LEFT JOIN 这类复合词。 */
export function findKeywordAt(sql: string, position: number): KeywordHit | null {
  const { tokens } = scan(sql);
  const index = tokens.findIndex(
    (token) => position >= token.start && position <= token.end,
  );
  if (index < 0) return null;
  const token = tokens[index]!;
  if (token.kind !== 'keyword') return null;

  const previous = tokens[index - 1];
  const next = tokens[index + 1];
  const candidates: string[] = [];
  if (
    previous?.kind === 'keyword' &&
    next?.kind === 'keyword'
  ) {
    candidates.push(`${previous.text} ${token.text} ${next.text}`);
  }
  if (previous?.kind === 'keyword') {
    candidates.push(`${previous.text} ${token.text}`);
  }
  if (next?.kind === 'keyword') {
    candidates.push(`${token.text} ${next.text}`);
  }
  candidates.push(token.text);

  for (const candidate of candidates) {
    const entry = SYNTAX_ENTRIES[candidate.toUpperCase()];
    if (entry) {
      return { entry, tokenStart: token.start, tokenEnd: token.end };
    }
  }
  return null;
}
