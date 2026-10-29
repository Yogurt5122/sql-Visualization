import { useEffect } from 'react';
import type {
  JoinType,
  RelationJoin,
  Relations,
  RelationSource,
  Statement,
} from '../core/types';
import { collectRelationFields } from './visual';

export type RelationDetail =
  | { kind: 'source'; source: RelationSource }
  | { kind: 'edge'; edge: RelationJoin; dependency: boolean };

const JOIN_LABEL: Record<JoinType, string> = {
  inner: '内连接',
  left: '左连接',
  right: '右连接',
  full: '全连接',
  cross: '笛卡尔积',
  unknown: '隐式连接',
};

function kindLabel(source: RelationSource): string {
  if (source.role === 'target') return '目标表';
  if (source.kind === 'cte') return 'CTE';
  if (source.kind === 'subquery') return '子查询';
  return '表';
}

export interface RelationDetailDialogProps {
  detail: RelationDetail;
  relations: Relations;
  statement?: Statement;
  onClose: () => void;
  onLocate: (line: number) => void;
}

export function RelationDetailDialog({
  detail,
  relations,
  statement,
  onClose,
  onLocate,
}: RelationDetailDialogProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const allEdges = [...relations.joins, ...(relations.dependencies ?? [])];
  const sourceName = (id: string) =>
    relations.sources.find((source) => source.id === id)?.name ?? id;

  const isSource = detail.kind === 'source';
  const relationFields = collectRelationFields(relations);
  const title = isSource
    ? detail.source.name
    : `${sourceName(detail.edge.from)} → ${sourceName(detail.edge.to)}`;
  const line = isSource ? detail.source.line : detail.edge.line;
  const relatedEdges = isSource
    ? allEdges.filter((edge) => edge.from === detail.source.id || edge.to === detail.source.id)
    : [];
  const fields = isSource
    ? relationFields.get(detail.source.name) ??
      (detail.source.alias ? relationFields.get(detail.source.alias) : undefined) ??
      []
    : [];
  const filters = isSource
    ? (relations.filters ?? []).filter(
        (filter) =>
          filter.text.includes(detail.source.name) ||
          (detail.source.alias ? filter.text.includes(detail.source.alias) : false),
      )
    : [];

  return (
    <div
      className="relation-detail-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="relation-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="relation-detail-title"
      >
        <header className="relation-detail-head">
          <div>
            <span className="relation-detail-kicker">
              {isSource ? `${kindLabel(detail.source)} · 数据源` : '关联关系'}
            </span>
            <h2 id="relation-detail-title">{title}</h2>
            <p>
              第 {line} 行
              {isSource && detail.source.alias ? ` · 别名 ${detail.source.alias}` : ''}
            </p>
          </div>
          <button
            type="button"
            className="relation-detail-close"
            onClick={onClose}
            aria-label="关闭"
          >
            ×
          </button>
        </header>

        <div className="relation-detail-body">
          {isSource ? (
            <>
              <div className="relation-detail-block">
                <h3>从这张表读取的字段</h3>
                {fields.length > 0 ? (
                  <div className="relation-detail-chips">
                    {fields.map((field) => (
                      <code key={field}>{field}</code>
                    ))}
                  </div>
                ) : (
                  <p className="relation-detail-muted">
                    只参与连接或过滤，没有直接进入最终输出。
                  </p>
                )}
              </div>

              <div className="relation-detail-block">
                <h3>参与的关联</h3>
                {relatedEdges.length > 0 ? (
                  <ul className="relation-detail-list">
                    {relatedEdges.map((edge) => (
                      <li key={edge.id}>
                        <span>
                          {sourceName(edge.from)} → {sourceName(edge.to)}
                        </span>
                        <code>{edge.condition ?? '无显式条件'}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="relation-detail-muted">没有识别到关联。</p>
                )}
              </div>

              {filters.length > 0 ? (
                <div className="relation-detail-block">
                  <h3>相关过滤条件</h3>
                  <ul className="relation-detail-list">
                    {filters.map((filter) => (
                      <li key={filter.id}>
                        <span>第 {filter.line} 行</span>
                        <code>{filter.text}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className="relation-detail-block">
                <h3>关系</h3>
                <div className="relation-detail-meta">
                  <span>{detail.dependency ? '依赖' : JOIN_LABEL[detail.edge.type]}</span>
                  <span>{sourceName(detail.edge.from)}</span>
                  <span>→</span>
                  <span>{sourceName(detail.edge.to)}</span>
                </div>
              </div>
              <div className="relation-detail-block">
                <h3>关联条件</h3>
                <pre className="relation-detail-code">
                  {detail.edge.condition ?? '无显式条件'}
                </pre>
              </div>
            </>
          )}

          <div className="relation-detail-block">
            <h3>SQL 语句</h3>
            <pre className="relation-detail-sql">
              {statement?.text ?? '当前没有可展示的语句文本。'}
            </pre>
          </div>
        </div>

        <footer className="relation-detail-foot">
          <button type="button" onClick={() => onLocate(line)}>
            定位原文
          </button>
          <button type="button" onClick={onClose}>
            关闭
          </button>
        </footer>
      </section>
    </div>
  );
}
