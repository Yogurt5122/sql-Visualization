import type { Issue } from '../types';
import type { RuleContext, RuleDefinition } from './types';
import { dm8RownumOrderRule } from './rules/dm8-rownum-order';
import { deepNestingRule } from './rules/deep-nesting';
import { distinctWithJoinRule } from './rules/distinct-with-join';
import { functionOnColumnRule } from './rules/function-on-column';
import { hardcodedDateRule } from './rules/hardcoded-date';
import { implicitCastRule } from './rules/implicit-cast';
import { joinAmplificationRule } from './rules/join-amplification';
import { limitWithoutOrderRule } from './rules/limit-without-order';
import { missingJoinConditionRule } from './rules/missing-join-condition';
import { notInNullRule } from './rules/not-in-null';
import { plusWrongSideRule } from './rules/plus-wrong-side';
import { repeatedComputationRule } from './rules/repeated-computation';
import { repeatedTableRule } from './rules/repeated-table';
import { selectStarRule } from './rules/select-star';
import { subqueryOrderWithoutLimitRule } from './rules/subquery-order-without-limit';
import { unionNotAllRule } from './rules/union-not-all';
import { correlatedSelectRule } from './rules/correlated-select';

export const RULES: RuleDefinition[] = [
  selectStarRule,
  missingJoinConditionRule,
  functionOnColumnRule,
  implicitCastRule,
  repeatedTableRule,
  subqueryOrderWithoutLimitRule,
  distinctWithJoinRule,
  unionNotAllRule,
  hardcodedDateRule,
  deepNestingRule,
  notInNullRule,
  correlatedSelectRule,
  limitWithoutOrderRule,
  joinAmplificationRule,
  repeatedComputationRule,
  dm8RownumOrderRule,
  plusWrongSideRule,
];

export function runRules(
  context: RuleContext,
  rules: RuleDefinition[] = RULES,
): Issue[] {
  const issues: Issue[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    for (const match of rule.detect(context)) {
      const key = [
        rule.id,
        match.clauseId ?? 'statement',
        match.span?.start ?? '',
        match.span?.end ?? '',
      ].join(':');
      if (seen.has(key)) continue;
      seen.add(key);

      const anchor = `${match.clauseId ?? 'statement'}-${match.span?.start ?? 'all'}`;
      issues.push({
        id: `${rule.id}-${context.statement.id}-${anchor}`,
        ruleId: rule.id,
        severity: rule.severity,
        category: rule.category,
        confidence: match.confidence ?? rule.confidence,
        title: match.title ?? rule.name,
        detail: match.detail ?? rule.detail,
        suggestion: match.suggestion ?? rule.suggestion,
        clauseId: match.clauseId,
        span: match.span,
      });
    }
  }

  return issues.sort(
    (a, b) =>
      (a.span?.start ?? Number.MAX_SAFE_INTEGER) -
      (b.span?.start ?? Number.MAX_SAFE_INTEGER),
  );
}
