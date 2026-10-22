import { format, type SqlLanguage } from 'sql-formatter';
import type { ResolvedDialect } from './types';

const LANGUAGE: Record<ResolvedDialect, SqlLanguage> = {
  mysql: 'mysql',
  postgres: 'postgresql',
  tsql: 'transactsql',
  dm8: 'plsql',
};

export interface SqlFormatResult {
  sql: string;
  ok: boolean;
}

export function formatSqlResult(
  sql: string,
  dialect: ResolvedDialect,
): SqlFormatResult {
  if (!sql.trim()) return { sql, ok: true };

  try {
    return {
      sql: format(sql, {
        language: LANGUAGE[dialect],
        tabWidth: 2,
        useTabs: false,
        keywordCase: 'upper',
        identifierCase: 'preserve',
        dataTypeCase: 'preserve',
        functionCase: 'preserve',
        indentStyle: 'standard',
        logicalOperatorNewline: 'before',
        expressionWidth: 80,
        linesBetweenQueries: 1,
        denseOperators: false,
        newlineBeforeSemicolon: false,
      }).trimEnd(),
      ok: true,
    };
  } catch {
    return { sql, ok: false };
  }
}

export function formatSql(sql: string, dialect: ResolvedDialect): string {
  return formatSqlResult(sql, dialect).sql;
}
