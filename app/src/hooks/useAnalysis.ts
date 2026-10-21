import { useEffect, useRef, useState } from 'react';
import { analyzeSql } from '../core/explain';
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

export function useAnalysis(
  sql: string,
  dialect: Dialect,
  variant: MybatisVariant,
): AnalysisState {
  const [analysis, setAnalysis] = useState<Analysis>(() =>
    analyzeSql(sql, dialect, { mybatisVariant: variant }),
  );
  const [status, setStatus] = useState<AnalysisStatus>('done');
  const [runtime, setRuntime] = useState<AnalysisRuntime>('main');
  const [phase, setPhase] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const workerRef = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const timerRef = useRef<number | null>(null);
  const latest = useRef({ sql, dialect, variant });
  const lastKey = useRef(JSON.stringify([sql, dialect, variant, 0]));

  const fallback = () => {
    try {
      const { sql, dialect, variant } = latest.current;
      setAnalysis(analyzeSql(sql, dialect, { mybatisVariant: variant }));
    } catch {
      // 保留上一次结果，至少不白屏
    }
    setStatus('done');
    setPhase(null);
    setRuntime('main');
  };

  const ensureWorker = (): Worker | null => {
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

        fallback();
      };

      worker.onerror = () => {
        worker.terminate();
        workerRef.current = null;
        fallback();
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
    const key = JSON.stringify([sql, dialect, variant, revision]);
    if (key === lastKey.current) return;
    lastKey.current = key;

    setStatus('analyzing');
    setPhase('准备分析');
    requestId.current += 1;

    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const id = requestId.current;
      const worker = ensureWorker();
      if (!worker) {
        fallback();
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
    lastKey.current = '';
    setRevision((value) => value + 1);
  };

  return { analysis, status, runtime, phase, cancel, retry };
}
