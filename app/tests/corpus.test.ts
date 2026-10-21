import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeSql } from '../src/core/explain';
import { CORPUS } from './corpus/manifest';

const corpusDir = join(dirname(fileURLToPath(import.meta.url)), 'corpus');

describe('真实 SQL 语料', () => {
  for (const entry of CORPUS) {
    it(`${entry.file} · ${entry.note}`, () => {
      const sql = readFileSync(join(corpusDir, entry.file), 'utf8');
      const lineCount = sql.split(/\r?\n/).length;
      const analysis = analyzeSql(sql, entry.dialect);

      expect(analysis.statements.length).toBeGreaterThanOrEqual(entry.minStatements);
      expect(analysis.relations).toHaveLength(analysis.statements.length);
      expect(analysis.summaries).toHaveLength(analysis.statements.length);
      expect(analysis.summary.length).toBeGreaterThan(0);
      expect(Number.isFinite(analysis.metrics.complexity)).toBe(true);
      expect(analysis.metrics.complexity).toBeGreaterThanOrEqual(0);

      if (entry.mode) expect(analysis.mode).toBe(entry.mode);
      if (entry.expectedTables !== undefined) {
        expect(analysis.metrics.tables).toBe(entry.expectedTables);
      }
      if (entry.expectPreprocess) expect(analysis.preprocess.detected).toBe(true);

      if (entry.expectParseError) {
        expect(analysis.parseError).toBeDefined();
        expect(analysis.parseError!.line).toBeGreaterThanOrEqual(1);
        expect(analysis.parseError!.line).toBeLessThanOrEqual(lineCount);
        expect(analysis.parseError!.column).toBeGreaterThanOrEqual(1);
      } else {
        expect(analysis.parseError).toBeUndefined();
      }

      if (analysis.mode === 'semantic') {
        expect(analysis.semantic.every(Boolean)).toBe(true);
        for (const model of analysis.semantic) {
          expect(model!.clauses.length).toBeGreaterThan(0);
        }
      }

      for (const statement of analysis.statements) {
        expect(statement.text.length).toBeGreaterThan(0);
        expect(statement.span.start).toBeGreaterThanOrEqual(0);
        expect(statement.span.end).toBeLessThanOrEqual(sql.length);
        expect(statement.span.start).toBeLessThanOrEqual(statement.span.end);
        expect(statement.span.startLine).toBeGreaterThanOrEqual(1);
        expect(statement.span.endLine).toBeGreaterThanOrEqual(statement.span.startLine);
        expect(statement.span.endLine).toBeLessThanOrEqual(lineCount);

        for (const clause of statement.clauses) {
          expect(clause.text.length).toBeGreaterThan(0);
          expect(clause.span.start).toBeGreaterThanOrEqual(statement.span.start);
          expect(clause.span.end).toBeLessThanOrEqual(statement.span.end);
          expect(clause.span.start).toBeLessThanOrEqual(clause.span.end);
          expect(clause.span.startLine).toBeGreaterThanOrEqual(statement.span.startLine);
          expect(clause.span.endLine).toBeLessThanOrEqual(statement.span.endLine);
        }
      }

      const clauseCount = analysis.statements.reduce(
        (total, statement) => total + statement.clauses.length,
        0,
      );
      expect(analysis.explanations).toHaveLength(clauseCount);
    });
  }
});
