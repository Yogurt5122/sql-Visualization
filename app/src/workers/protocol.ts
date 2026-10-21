import type { Analysis, Dialect, MybatisVariant } from '../core/types';

export interface AnalyzeRequest {
  id: number;
  sql: string;
  dialect: Dialect;
  mybatisVariant: MybatisVariant;
}

export type AnalyzeResponse =
  | { id: number; type: 'progress'; phase: string }
  | { id: number; type: 'result'; analysis: Analysis }
  | { id: number; type: 'error'; message: string };
