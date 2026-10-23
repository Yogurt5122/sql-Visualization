export type Dialect = 'auto' | 'mysql' | 'tsql' | 'postgres' | 'dm8';
export type ResolvedDialect = Exclude<Dialect, 'auto'>;

export type TokenKind =
  | 'keyword'
  | 'ident'
  | 'quotedIdent'
  | 'string'
  | 'number'
  | 'operator'
  | 'punct'
  | 'comment'
  | 'param'
  | 'other';

export interface Token {
  kind: TokenKind;
  text: string;
  start: number;
  end: number;
  line: number;
  col: number;
  depth: number;
}

export interface Span {
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  startCol: number;
  endCol: number;
}

export type ClauseKind =
  | 'with'
  | 'select'
  | 'from'
  | 'join'
  | 'where'
  | 'groupBy'
  | 'having'
  | 'orderBy'
  | 'limit'
  | 'offset'
  | 'union'
  | 'insert'
  | 'update'
  | 'delete'
  | 'other';

export interface Clause {
  id: string;
  kind: ClauseKind;
  label: string;
  span: Span;
  text: string;
}

export type StatementKind = 'select' | 'insert' | 'update' | 'delete' | 'other';

export interface Statement {
  id: string;
  index: number;
  kind: StatementKind;
  span: Span;
  text: string;
  clauses: Clause[];
}

export interface Explanation {
  clauseId: string;
  plain: string;
  technical: string;
  refs: string[];
}

export type IssueSeverity = 'high' | 'medium' | 'low';
export type IssueConfidence = 'high' | 'medium' | 'low';
export type IssueCategory = 'structure' | 'performance' | 'semantic' | 'dm8';

export interface Issue {
  id: string;
  ruleId: string;
  severity: IssueSeverity;
  category: IssueCategory;
  confidence: IssueConfidence;
  title: string;
  detail: string;
  suggestion?: string;
  clauseId?: string;
  span?: Span;
}

export type RelationSourceKind = 'table' | 'cte' | 'subquery';

export interface RelationSource {
  id: string;
  name: string;
  alias?: string;
  kind: RelationSourceKind;
  line: number;
}

export type JoinType = 'inner' | 'left' | 'right' | 'full' | 'cross' | 'unknown';

export interface RelationJoin {
  id: string;
  from: string;
  to: string;
  type: JoinType;
  condition?: string;
  line: number;
}

export type LineageTransform =
  | 'direct'
  | 'aggregate'
  | 'window'
  | 'case'
  | 'cast'
  | 'function'
  | 'literal'
  | 'unknown';

export interface LineageRow {
  id: string;
  output: string;
  source: string;
  via?: string[];
  transform: LineageTransform;
  line: number;
  confidence: 'exact' | 'partial' | 'unknown';
}

export interface Relations {
  sources: RelationSource[];
  joins: RelationJoin[];
  dependencies?: RelationJoin[];
  lineage: LineageRow[];
}

export interface AnalysisMetrics {
  tables: number;
  joins: number;
  outputs: number;
  depth: number;
  complexity: number;
}

export type MybatisVariant = 'all' | 'none';

export interface PreprocessInfo {
  detected: boolean;
  tags: string[];
  dynamicConditions: number;
  variant: MybatisVariant;
  warnings: string[];
}

export interface SemanticClause {
  kind: Clause['kind'];
  label: string;
  startLine: number;
  endLine: number;
  text: string;
  hasTable: boolean;
}

export interface SemanticCte {
  name: string;
  tables: string[];
  query: SemanticQuery;
}

export interface SemanticJoinKey {
  left: string;
  right: string;
  operator: string;
  line: number;
}

export interface SemanticQuery {
  id: string;
  kind: 'main' | 'cte' | 'subquery';
  name?: string;
  origin?: 'from' | 'where' | 'having' | 'select' | 'union';
  parentId?: string;
  parentClauseKind?: ClauseKind;
  correlated?: boolean;
  branchOperator?: string;
  depth: number;
  startLine: number;
  endLine: number;
  sources: RelationSource[];
  joins: number;
  joinKeys: SemanticJoinKey[];
  hasAggregate: boolean;
  whereCount: number;
  hasHaving: boolean;
  groupBy: string[];
  orderBy: string[];
  limit?: string;
  outputCount: number;
  tables: string[];
  clauses: SemanticClause[];
  ctes: SemanticCte[];
  subqueries: SemanticQuery[];
  branches: SemanticQuery[];
}

export interface Analysis {
  dialect: ResolvedDialect;
  confidence: number;
  statements: Statement[];
  explanations: Explanation[];
  issues: Issue[];
  relations: Relations[];
  metrics: AnalysisMetrics;
  metricsByStatement: AnalysisMetrics[];
  semantic: Array<SemanticQuery | null>;
  summaries: string[];
  summary: string;
  warnings: string[];
  mode: 'semantic' | 'structural';
  preprocess: PreprocessInfo;
  parseError?: {
    message: string;
    line?: number;
    column?: number;
  };
}

export interface ScanError {
  message: string;
  offset: number;
  line: number;
  col: number;
}
