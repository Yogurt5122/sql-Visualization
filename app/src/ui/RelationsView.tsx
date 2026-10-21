import { useState } from 'react';
import type {
  JoinType,
  LineageTransform,
  Relations,
  RelationSource,
} from '../core/types';

export interface RelationsViewProps {
  relations: Relations[];
  statementIndex: number;
  onSelectLine: (line: number) => void;
}

const JOIN_LABEL: Record<JoinType, string> = {
  inner: '内连接',
  left: '左连接',
  right: '右连接',
  full: '全连接',
  cross: '笛卡尔积',
  unknown: '隐式连接',
};

const TRANSFORM_LABEL: Record<LineageTransform, string> = {
  direct: '直接引用',
  aggregate: '聚合',
  window: '窗口',
  case: '条件分支',
  cast: '类型转换',
  function: '函数',
  literal: '常量',
  unknown: '未知',
};

function shorten(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function sourceKindLabel(source: RelationSource): string {
  if (source.kind === 'cte') return 'CTE';
  if (source.kind === 'subquery') return '子查询';
  return '表';
}

function RelationGraph({
  relations,
  onSelectLine,
}: {
  relations: Relations;
  onSelectLine: (line: number) => void;
}) {
  const { sources, joins } = relations;
  if (sources.length === 0) {
    return <div className="relations-empty">没有识别到表或数据源。</div>;
  }

  const main = sources[0]!;
  const others = sources.slice(1);
  const nodeWidth = 156;
  const nodeHeight = 46;
  const width = 620;
  const height = Math.max(130, 40 + others.length * 76);
  const positions = new Map<string, { x: number; y: number }>();

  positions.set(main.id, { x: 14, y: height / 2 - nodeHeight / 2 });
  others.forEach((source, index) => {
    positions.set(source.id, {
      x: width - nodeWidth - 14,
      y: 18 + index * 76,
    });
  });

  return (
    <div className="relation-graph-wrap">
      <svg
        className="relation-graph"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`表关系图：${sources.length} 个数据源，${joins.length} 条连接`}
      >
        {joins.map((join) => {
          const from = positions.get(join.from);
          const to = positions.get(join.to);
          if (!from || !to) return null;
          const x1 = from.x + nodeWidth;
          const y1 = from.y + nodeHeight / 2;
          const x2 = to.x;
          const y2 = to.y + nodeHeight / 2;
          const midX = (x1 + x2) / 2;
          const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;

          return (
            <g
              key={join.id}
              className={`rel-edge rel-edge-${join.type}`}
              onClick={() => onSelectLine(join.line)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSelectLine(join.line);
              }}
            >
              <path className="rel-edge-hit" d={path} />
              <path className="rel-edge-line" d={path} />
              <text className="rel-edge-label" x={midX} y={(y1 + y2) / 2 - 5} textAnchor="middle">
                {JOIN_LABEL[join.type]}
              </text>
            </g>
          );
        })}

        {sources.map((source) => {
          const position = positions.get(source.id)!;
          return (
            <g
              key={source.id}
              className={`rel-node rel-node-${source.kind}`}
              transform={`translate(${position.x}, ${position.y})`}
              onClick={() => onSelectLine(source.line)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSelectLine(source.line);
              }}
            >
              <rect width={nodeWidth} height={nodeHeight} rx={8} />
              <text className="rel-node-name" x={10} y={19}>
                {shorten(source.name, 19)}
              </text>
              <text className="rel-node-meta" x={10} y={34}>
                {sourceKindLabel(source)}
                {source.alias ? ` · ${source.alias}` : ''} · L{source.line}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="relation-legend">
        <span className="legend-inner">内连接</span>
        <span className="legend-left">左/右连接</span>
        <span className="legend-cross">笛卡尔积 / 隐式</span>
      </div>
    </div>
  );
}

function LineageTable({
  relations,
  onSelectLine,
}: {
  relations: Relations;
  onSelectLine: (line: number) => void;
}) {
  if (relations.lineage.length === 0) {
    return <div className="relations-empty">没有识别到输出列。</div>;
  }

  return (
    <div className="lineage-wrap">
      <table className="lineage-table">
        <thead>
          <tr>
            <th>输出列</th>
            <th>来源</th>
            <th>变换</th>
            <th>经过</th>
            <th>行</th>
          </tr>
        </thead>
        <tbody>
          {relations.lineage.map((row) => (
            <tr
              key={row.id}
              className={`lineage-row lineage-${row.confidence}`}
              onClick={() => onSelectLine(row.line)}
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSelectLine(row.line);
              }}
            >
              <td className="lineage-output">{row.output}</td>
              <td className="lineage-source">{row.source}</td>
              <td>{TRANSFORM_LABEL[row.transform]}</td>
              <td className="lineage-via">
                {row.via && row.via.length > 0 ? row.via.join(' → ') : '—'}
              </td>
              <td className="lineage-line">L{row.line}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RelationsView({
  relations,
  statementIndex,
  onSelectLine,
}: RelationsViewProps) {
  const [tab, setTab] = useState<'graph' | 'lineage'>('graph');

  if (relations.length === 0) return null;
  const current = relations[statementIndex] ?? relations[0]!;

  return (
    <section className="relations-section" aria-label="数据关系">
      <div className="relations-head">
        <h2>数据关系</h2>
        <span className="muted">
          {relations.length > 1 ? `第 ${statementIndex + 1} 条 · ` : ''}
          {current.sources.length} 个数据源 · {current.joins.length} 个连接 ·{' '}
          {current.lineage.length} 个输出列
        </span>
      </div>

      <div className="relations-tabs" role="tablist" aria-label="数据关系视图">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'graph'}
          className={tab === 'graph' ? 'is-active' : ''}
          onClick={() => setTab('graph')}
        >
          表关系 <span>{current.sources.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'lineage'}
          className={tab === 'lineage' ? 'is-active' : ''}
          onClick={() => setTab('lineage')}
        >
          字段血缘 <span>{current.lineage.length}</span>
        </button>
      </div>

      {tab === 'graph' ? (
        <RelationGraph relations={current} onSelectLine={onSelectLine} />
      ) : (
        <LineageTable relations={current} onSelectLine={onSelectLine} />
      )}
    </section>
  );
}
