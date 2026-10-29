import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type {
  JoinType,
  LineageTransform,
  Relations,
  RelationJoin,
  RelationSource,
  SemanticQuery,
  Statement,
} from '../core/types';
import { collectRelationFields, sourceColor } from './visual';
import { RelationDetailDialog, type RelationDetail } from './RelationDetail';

export interface RelationsViewProps {
  relations: Relations[];
  statementIndex: number;
  semantic: SemanticQuery | null;
  statement?: Statement;
  onSelectLine: (line: number) => void;
  highlightTable?: string;
  highlightField?: string;
  onHighlightTable?: (table: string | null) => void;
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
  if (source.role === 'target') return '目标表';
  if (source.kind === 'cte') return 'CTE';
  if (source.kind === 'subquery') return '子查询';
  return '表';
}

function RelationGraph({
  relations,
  onSelectSource,
  onSelectEdge,
  highlightTable,
  highlightField,
  onHighlightTable,
}: {
  relations: Relations;
  onSelectSource: (source: RelationSource) => void;
  onSelectEdge: (edge: RelationJoin, dependency: boolean) => void;
  highlightTable?: string;
  highlightField?: string;
  onHighlightTable?: (table: string | null) => void;
}) {
  const [overrides, setOverrides] = useState<Record<string, { x: number; y: number }>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const dragRef = useRef<{
    id: string;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);
  const suppressClick = useRef<string | null>(null);

  useEffect(() => {
    setOverrides({});
    setDragging(null);
    dragRef.current = null;
    suppressClick.current = null;
  }, [relations]);

  const { sources, joins, dependencies = [] } = relations;
  if (sources.length === 0) {
    return <div className="relations-empty">没有识别到表或数据源。</div>;
  }
  const edges = [
    ...joins.map((join) => ({ edge: join, dependency: false })),
    ...dependencies.map((dependency) => ({ edge: dependency, dependency: true })),
  ];
  const fieldsBySource = collectRelationFields(relations);
  const sourceName = (id: string) => sources.find((source) => source.id === id)?.name ?? id;

  const main = sources[0]!;
  const others = sources.slice(1);
  const nodeWidth = 178;
  const nodeHeight = 92;
  const width = 680;
  const height = Math.max(150, 30 + others.length * 110);
  const positions = new Map<string, { x: number; y: number }>();

  positions.set(main.id, { x: 14, y: height / 2 - nodeHeight / 2 });
  others.forEach((source, index) => {
    positions.set(source.id, {
      x: width - nodeWidth - 14,
      y: 16 + index * 110,
    });
  });
  for (const [id, point] of Object.entries(overrides)) {
    if (positions.has(id)) positions.set(id, point);
  }

  const pointerToSvg = (event: ReactPointerEvent<SVGGElement>) => {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: ((event.clientX - rect.left) / rect.width) * width,
      y: ((event.clientY - rect.top) / rect.height) * height,
    };
  };

  const startDrag = (event: ReactPointerEvent<SVGGElement>, source: RelationSource) => {
    if (event.button !== 0) return;
    const point = pointerToSvg(event);
    const origin = positions.get(source.id);
    if (!point || !origin) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: source.id,
      offsetX: point.x - origin.x,
      offsetY: point.y - origin.y,
      startX: point.x,
      startY: point.y,
      moved: false,
    };
    setDragging(source.id);
  };

  const moveDrag = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointerToSvg(event);
    if (!point) return;
    if (Math.abs(point.x - drag.startX) + Math.abs(point.y - drag.startY) > 3) {
      drag.moved = true;
    }
    const x = Math.min(Math.max(0, point.x - drag.offsetX), width - nodeWidth);
    const y = Math.min(Math.max(0, point.y - drag.offsetY), height - nodeHeight);
    setOverrides((current) => ({ ...current, [drag.id]: { x, y } }));
  };

  const endDrag = (event: ReactPointerEvent<SVGGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.moved) suppressClick.current = drag.id;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(null);
  };

  return (
    <div className="relation-graph-wrap">
      <svg
        className="relation-graph"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`表关系图：${sources.length} 个数据源，${edges.length} 条连线`}
      >
        {edges.map(({ edge: join, dependency }) => {
          const from = positions.get(join.from);
          const to = positions.get(join.to);
          if (!from || !to) return null;
          const x1 = from.x + nodeWidth;
          const y1 = from.y + nodeHeight / 2;
          const x2 = to.x;
          const y2 = to.y + nodeHeight / 2;
          const midX = (x1 + x2) / 2;
          const path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
          const label = dependency
            ? join.condition?.startsWith('UNION')
              ? 'UNION'
              : join.condition?.startsWith('INSERT')
                ? 'INSERT'
                : join.condition?.includes('来源')
                  ? 'INSERT'
                  : join.condition?.startsWith('UPDATE')
                  ? 'UPDATE'
                  : join.condition?.startsWith('DELETE')
                    ? 'DELETE'
                    : 'CTE'
            : JOIN_LABEL[join.type];
          const related =
            !highlightTable ||
            sourceName(join.from) === highlightTable ||
            sourceName(join.to) === highlightTable;
          const dimmed = Boolean(highlightTable && !related);
          const condition = join.condition?.trim()
            ? shorten(join.condition.replace(/\s+/g, ' '), 30)
            : '';

          return (
            <g
              key={join.id}
              className={`rel-edge rel-edge-${join.type}${
                dependency ? ' rel-edge-dependency' : ''
              }${highlightTable && related ? ' is-highlighted' : ''}${dimmed ? ' is-dimmed' : ''}`}
              onClick={() => onSelectEdge(join, dependency)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSelectEdge(join, dependency);
              }}
            >
              <path className="rel-edge-hit" d={path} />
              <path className="rel-edge-line" d={path} />
              <text
                className="rel-edge-label"
                x={midX}
                y={(y1 + y2) / 2 - (condition ? 11 : 4)}
                textAnchor="middle"
              >
                <tspan>{label}</tspan>
                {condition ? (
                  <tspan x={midX} dy={11} className="rel-edge-condition">
                    {condition}
                  </tspan>
                ) : null}
              </text>
            </g>
          );
        })}

        {sources.map((source) => {
          const position = positions.get(source.id)!;
          const fields =
            fieldsBySource.get(source.name) ??
            (source.alias ? fieldsBySource.get(source.alias) : undefined) ??
            [];
          const isHighlighted =
            Boolean(highlightTable) &&
            (source.name === highlightTable || source.alias === highlightTable);
          const dimmed = Boolean(highlightTable && !isHighlighted);
          const visibleFields = fields.slice(0, 3);
          const rest = fields.length - visibleFields.length;

          return (
            <g
              key={source.id}
              className={`rel-node rel-node-${source.kind}${
                source.role === 'target' ? ' rel-node-target' : ''
              }${
                isHighlighted ? ' is-highlighted' : ''
              }${dimmed ? ' is-dimmed' : ''}${dragging === source.id ? ' is-dragging' : ''}`}
              style={{ '--node-color': sourceColor(source.name) } as CSSProperties}
              transform={`translate(${position.x}, ${position.y})`}
              onPointerDown={(event) => startDrag(event, source)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onClick={() => {
                if (suppressClick.current === source.id) {
                  suppressClick.current = null;
                  return;
                }
                onHighlightTable?.(source.name);
                onSelectSource(source);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onSelectSource(source);
              }}
            >
              <rect width={nodeWidth} height={nodeHeight} rx={8} />
              <rect className="rel-node-accent" width={4} height={nodeHeight} rx={2} />
              <text className="rel-node-name" x={12} y={19}>
                {shorten(source.name, 21)}
              </text>
              <text className="rel-node-meta" x={12} y={34}>
                {sourceKindLabel(source)}
                {source.alias ? ` · ${source.alias}` : ''} · L{source.line}
              </text>
              {visibleFields.length > 0 ? (
                visibleFields.map((field, index) => {
                  const fieldHit =
                    Boolean(highlightField) &&
                    (highlightField?.includes(`${source.name}.${field}`) ||
                      highlightField?.includes(`${source.alias ?? ''}.${field}`));
                  return (
                    <text
                      key={field}
                      className={`rel-node-field${fieldHit ? ' is-highlighted' : ''}`}
                      x={12}
                      y={52 + index * 13}
                    >
                      <tspan className="rel-node-field-dot">•</tspan> {shorten(field, 20)}
                    </text>
                  );
                })
              ) : (
                <text className="rel-node-field rel-node-field-empty" x={12} y={54}>
                  本次未直接取字段
                </text>
              )}
              {rest > 0 ? (
                <text className="rel-node-field-more" x={12} y={86}>
                  +{rest} 个字段
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <div className="relation-legend">
        <span className="legend-inner">内连接</span>
        <span className="legend-left">左/右连接</span>
        <span className="legend-cross">笛卡尔积 / 隐式</span>
        <span className="legend-cte">CTE / UNION 依赖</span>
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

const ORIGIN_LABEL: Record<NonNullable<SemanticQuery['origin']>, string> = {
  from: 'FROM 子查询',
  where: 'WHERE 子查询',
  having: 'HAVING 子查询',
  select: 'SELECT 子查询',
  union: 'UNION 分支',
};

interface QueryBlockRow {
  query: SemanticQuery;
  depth: number;
  label: string;
  parentId?: string;
  tableCount?: number;
}

function collectBlockTables(
  query: SemanticQuery,
  cteMap: Map<string, SemanticQuery>,
  visited: Set<string>,
  result: Set<string> = new Set(),
): Set<string> {
  for (const table of query.tables) result.add(table);
  for (const source of query.sources) {
    if (source.kind !== 'cte') continue;
    const key = source.name.toLowerCase();
    if (visited.has(key)) continue;
    const cte = cteMap.get(key);
    if (!cte) continue;
    visited.add(key);
    collectBlockTables(cte, cteMap, visited, result);
  }
  for (const subquery of query.subqueries) {
    collectBlockTables(subquery, cteMap, visited, result);
  }
  for (const branch of query.branches) {
    collectBlockTables(branch, cteMap, visited, result);
  }
  return result;
}

function flattenQueryBlocks(
  query: SemanticQuery,
  depth = 0,
  rows: QueryBlockRow[] = [],
  labelOverride?: string,
): QueryBlockRow[] {
  const label =
    labelOverride ??
    (query.kind === 'main'
      ? '主查询'
      : query.kind === 'cte'
        ? `CTE ${query.name ?? ''}`.trim()
        : ORIGIN_LABEL[query.origin ?? 'from']);
  rows.push({ query, depth, label, parentId: query.parentId });
  for (const cte of query.ctes) flattenQueryBlocks(cte.query, depth + 1, rows);
  for (const subquery of query.subqueries) {
    flattenQueryBlocks(subquery, depth + 1, rows);
  }
  query.branches.forEach((branch, index) => {
    flattenQueryBlocks(branch, depth + 1, rows, `UNION 分支 ${index + 1}`);
  });
  return rows;
}

function QueryBlockGraph({
  rows,
  onSelectLine,
}: {
  rows: QueryBlockRow[];
  onSelectLine: (line: number) => void;
}) {
  const width = 620;
  const rowHeight = 50;
  const nodeHeight = 38;
  const height = Math.max(90, rows.length * rowHeight + 16);
  const positions = new Map<string, { x: number; y: number; width: number }>();

  for (const [index, row] of rows.entries()) {
    const x = 12 + row.depth * 26;
    positions.set(row.query.id, {
      x,
      y: 8 + index * rowHeight,
      width: width - x - 12,
    });
  }

  return (
    <svg
      className="query-block-graph"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`查询块图：${rows.length} 个查询块`}
    >
      {rows.map((row) => {
        const child = positions.get(row.query.id);
        const parent = row.parentId ? positions.get(row.parentId) : undefined;
        if (!child || !parent) return null;
        const startX = parent.x + 16;
        const startY = parent.y + nodeHeight;
        const targetY = child.y + nodeHeight / 2;
        return (
          <path
            key={`edge-${row.query.id}`}
            className="query-block-edge"
            d={`M ${startX} ${startY} V ${targetY} H ${child.x}`}
          />
        );
      })}
      {rows.map((row) => {
        const position = positions.get(row.query.id);
        if (!position) return null;
        return (
          <g
            key={row.query.id}
            className={`query-block-node query-block-node-${row.query.kind}`}
            transform={`translate(${position.x}, ${position.y})`}
            onClick={() => onSelectLine(row.query.startLine)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSelectLine(row.query.startLine);
            }}
          >
            <rect width={position.width} height={nodeHeight} rx={7} />
            <text className="query-block-graph-label" x={8} y={16}>
              {shorten(row.label, 26)}
            </text>
            <text className="query-block-graph-meta" x={8} y={30}>
              L{row.query.startLine}–{row.query.endLine} ·{' '}
              {row.tableCount ?? row.query.tables.length} 表 · {row.query.joins} 连接
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function QueryBlockList({
  semantic,
  onSelectLine,
}: {
  semantic: SemanticQuery;
  onSelectLine: (line: number) => void;
}) {
  const rows = flattenQueryBlocks(semantic);
  const cteMap = new Map(
    rows
      .filter(
        (row): row is QueryBlockRow & { query: SemanticQuery & { name: string } } =>
          row.query.kind === 'cte' && Boolean(row.query.name),
      )
      .map((row) => [row.query.name.toLowerCase(), row.query]),
  );
  const enriched = rows.map((row) => ({
    ...row,
    tableCount: collectBlockTables(row.query, cteMap, new Set()).size,
  }));

  return (
    <div className="query-blocks">
      <QueryBlockGraph rows={enriched} onSelectLine={onSelectLine} />
      <div className="query-block-list">
        {enriched.map(({ query, depth, label, tableCount }) => (
          <button
            key={query.id}
            type="button"
            className="query-block"
            style={{ paddingLeft: `${10 + depth * 16}px` }}
            onClick={() => onSelectLine(query.startLine)}
          >
            <span className={`query-block-kind query-block-kind-${query.kind}`}>
              {query.kind === 'main' ? '主查询' : query.kind === 'cte' ? 'CTE' : '子查询'}
            </span>
            <span className="query-block-label">{label}</span>
            <span className="query-block-meta">
              L{query.startLine}–{query.endLine} · {tableCount} 表 · {query.joins} 连接
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function RelationsView({
  relations,
  statementIndex,
  semantic,
  statement,
  onSelectLine,
  highlightTable,
  highlightField,
  onHighlightTable,
}: RelationsViewProps) {
  const [tab, setTab] = useState<'graph' | 'lineage' | 'blocks'>('graph');
  const [detail, setDetail] = useState<RelationDetail | null>(null);

  useEffect(() => {
    setDetail(null);
  }, [relations, statementIndex]);

  if (relations.length === 0) return null;
  const current = relations[statementIndex] ?? relations[0]!;
  const blocks = semantic ? flattenQueryBlocks(semantic) : [];

  return (
    <section className="relations-section" aria-label="数据关系">
      <div className="relations-head">
        <h2>数据关系</h2>
        <span className="muted">
          {relations.length > 1 ? `第 ${statementIndex + 1} 条 · ` : ''}
          {current.sources.length} 个数据源 · {current.joins.length} 个连接 ·{' '}
          {current.lineage.length} 个输出列
          {blocks.length > 1 ? ` · ${blocks.length} 个查询块` : ''}
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
        {semantic ? (
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'blocks'}
            className={tab === 'blocks' ? 'is-active' : ''}
            onClick={() => setTab('blocks')}
          >
            查询块 <span>{blocks.length}</span>
          </button>
        ) : null}
      </div>

      {tab === 'graph' ? (
        <RelationGraph
          relations={current}
          onSelectSource={(source) => setDetail({ kind: 'source', source })}
          onSelectEdge={(edge, dependency) => setDetail({ kind: 'edge', edge, dependency })}
          highlightTable={highlightTable}
          highlightField={highlightField}
          onHighlightTable={onHighlightTable}
        />
      ) : tab === 'lineage' ? (
        <LineageTable relations={current} onSelectLine={onSelectLine} />
      ) : semantic ? (
        <QueryBlockList semantic={semantic} onSelectLine={onSelectLine} />
      ) : null}

      {detail ? (
        <RelationDetailDialog
          detail={detail}
          relations={current}
          statement={statement}
          onClose={() => setDetail(null)}
          onLocate={(line) => {
            setDetail(null);
            onSelectLine(line);
          }}
        />
      ) : null}
    </section>
  );
}
