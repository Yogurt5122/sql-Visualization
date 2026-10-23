import { useEffect, useRef, useState } from 'react';
import type { Analysis, Dialect, MybatisVariant } from '../core/types';
import type { AnalyzeRequest, AnalyzeResponse } from '../workers/protocol';

export type AnalysisStatus = 'done' | 'analyzing';
export type AnalysisRuntime = 'main' | 'worker';

export interface AnalysisState {
  analysis: Analysis;
  status: AnalysisStatus;
  runtime: AnalysisRuntime;
  phase: string | null;
  cancel: () => void;
  retry: () => void;
}

function pendingAnalysis(dialect: Dialect, variant: MybatisVariant): Analysis {
  const resolved = dialect === 'auto' ? 'mysql' : dialect;
  return {
    dialect: resolved,
    confidence: 0,
    statements: [],
    explanations: [],
    issues: [],
    relations: [],
    metrics: { tables: 0, joins: 0, outputs: 0, depth: 0, complexity: 0 },
    metricsByStatement: [],
    semantic: [],
    summaries: [],
    summary: '正在分析 SQL…',
    warnings: [],
    mode: 'structural',
    preprocess: {
      detected: false,
      tags: [],
      dynamicConditions: 0,
      variant,
      warnings: [],
    },
  };
}

export function useAnalysis(
  sql: string,
  dialect: Dialect,
  variant: MybatisVariant,
): AnalysisState {
  const [analysis, setAnalysis] = useState<Analysis>(() =>
    pendingAnalysis(dialect, variant),
  );
  const [status, setStatus] = useState<AnalysisStatus>('analyzing');
  const [runtime, setRuntime] = useState<AnalysisRuntime>('main');
  const [phase, setPhase] = useState<string | null>('准备分析');
  const [revision, setRevision] = useState(0);

  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const timerRef = useRef<number | null>(null);
  const latest = useRef({ sql, dialect, variant });

  const fallback = async (id: number) => {
    const input = { ...latest.current };
    try {
      const { analyzeSql } = await import('../core/explain');
      const result = analyzeSql(input.sql, input.dialect, {
        mybatisVariant: input.variant,
      });
      if (id === requestId.current) setAnalysis(result);
    } catch {
      // 保留加载态占位，至少不白屏
    }
    if (id === requestId.current) {
      setStatus('done');
      setPhase(null);
      setRuntime('main');
    }
  };

  const ensureWorker = (): Worker | null => {
    if (
      import.meta.env.VITE_SINGLE_FILE === '1' ||
      (typeof window !== 'undefined' && window.location.protocol === 'file:')
    ) {
      return null;
    }
    if (workerRef.current) return workerRef.current;

    try {
      const worker = new Worker(
        new URL('../workers/analyze.worker.ts', import.meta.url),
        { type: 'module' },
      );

      worker.onmessage = (event: MessageEvent<AnalyzeResponse>) => {
        const message = event.data;
        if (message.id !== requestId.current) return;

        if (message.type === 'progress') {
          setPhase(message.phase);
          return;
        }
        if (message.type === 'result') {
          setAnalysis(message.analysis);
          setStatus('done');
          setPhase(null);
          setRuntime('worker');
          return;
        }

        void fallback(message.id);
      };

      worker.onerror = () => {
        worker.terminate();
        workerRef.current = null;
        void fallback(requestId.current);
      };

      workerRef.current = worker;
      return worker;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    ensureWorker();

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
    // Worker 只创建一次，消息处理通过 ref 读取最新输入
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    latest.current = { sql, dialect, variant };
    setStatus('analyzing');
    setPhase('准备分析');
    requestId.current += 1;
    const id = requestId.current;

    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const worker = ensureWorker();
      if (!worker) {
        void fallback(id);
        return;
      }
      const request: AnalyzeRequest = {
        id,
        sql,
        dialect,
        mybatisVariant: variant,
      };
      worker.postMessage(request);
    }, 260);

    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sql, dialect, variant, revision]);

  const cancel = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    workerRef.current?.terminate();
    workerRef.current = null;
    setStatus('done');
    setPhase(null);
    setRuntime('main');
  };

  const retry = () => {
    setRevision((value) => value + 1);
  };

  return { analysis, status, runtime, phase, cancel, retry };
}
