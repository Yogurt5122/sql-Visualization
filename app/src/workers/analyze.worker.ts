import { analyzeSql } from '../core/explain';
import type { AnalyzeRequest, AnalyzeResponse } from './protocol';

interface WorkerScope {
  onmessage: ((event: MessageEvent<AnalyzeRequest>) => void) | null;
  postMessage: (message: AnalyzeResponse) => void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  const { id, sql, dialect, mybatisVariant } = event.data;

  try {
    scope.postMessage({ id, type: 'progress', phase: '解析 SQL' });
    const analysis = analyzeSql(sql, dialect, { mybatisVariant });
    scope.postMessage({ id, type: 'result', analysis });
  } catch (error) {
    scope.postMessage({
      id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
