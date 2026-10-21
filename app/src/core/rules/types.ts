import type {
  AnalysisMetrics,
  IssueCategory,
  IssueConfidence,
  IssueSeverity,
  Relations,
  ResolvedDialect,
  SemanticQuery,
  Span,
  Statement,
} from '../types';

export interface RuleContext {
  statement: Statement;
  dialect: ResolvedDialect;
  semantic: SemanticQuery | null;
  relations: Relations;
  metrics: AnalysisMetrics;
}

export interface RuleMatch {
  clauseId?: string;
  span?: Span;
  confidence?: IssueConfidence;
  title?: string;
  detail?: string;
  suggestion?: string;
}

export interface RuleDefinition {
  id: string;
  name: string;
  severity: IssueSeverity;
  category: IssueCategory;
  confidence: IssueConfidence;
  detail: string;
  suggestion?: string;
  detect: (context: RuleContext) => RuleMatch[];
}
