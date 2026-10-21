import type { RuleDefinition } from '../types';
import { findClause } from '../helpers';

export const limitWithoutOrderRule: RuleDefinition = {
  id: 'RSK-13',
  name: 'LIMIT 没有 ORDER BY，取到哪几行不确定',
  severity: 'medium',
  category: 'performance',
  confidence: 'high',
  detail: '没有排序时，数据库返回的顺序不保证稳定；分页或抽样场景可能每次结果不同。',
  suggestion: '补一个能唯一确定顺序的 ORDER BY，再做 LIMIT。',
  detect({ statement }) {
    const limit = findClause(statement, 'limit');
    const order = findClause(statement, 'orderBy');
    if (!limit || order) return [];
    return [{ clauseId: limit.id, span: limit.span }];
  },
};
