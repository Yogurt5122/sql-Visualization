import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { sql } from '@codemirror/lang-sql';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { scan } from '../core/scanner';
import { splitStatements } from '../core/splitter';

export interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  onCursorLine: (line: number) => void;
  scrollTarget: { line: number; nonce: number } | null;
}

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const text = view.state.doc.toString();
  if (!text.trim()) return builder.finish();

  const { tokens } = scan(text);
  const statements = splitStatements(text, tokens);
  const seen = new Set<number>();

  for (const statement of statements) {
    for (const clause of statement.clauses) {
      for (let line = clause.span.startLine; line <= clause.span.endLine; line++) {
        if (line < 1 || line > view.state.doc.lines || seen.has(line)) continue;
        seen.add(line);
        const info = view.state.doc.line(line);
        builder.add(
          info.from,
          info.from,
          Decoration.line({ class: `cm-clause cm-clause-${clause.kind}` }),
        );
      }
    }
  }

  return builder.finish();
}

const clauseBars = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
  },
);

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13px',
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
    lineHeight: '1.7',
  },
  '.cm-content': {
    padding: '14px 0',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    border: 'none',
    color: '#94a3b8',
    paddingRight: '4px',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(37, 99, 235, 0.055)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: '#1d4ed8',
  },
  '&.cm-focused': {
    outline: 'none',
  },
});

export function Editor({ value, onChange, onCursorLine, scrollTarget }: EditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onCursorRef = useRef(onCursorLine);

  onChangeRef.current = onChange;
  onCursorRef.current = onCursorLine;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        sql(),
        editorTheme,
        clauseBars,
        EditorView.lineWrapping,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString());
          }
          if (update.selectionSet || update.docChanged) {
            const line = update.state.doc.lineAt(update.state.selection.main.head).number;
            onCursorRef.current(line);
          }
        }),
        EditorView.domEventHandlers({
          mousedown(event, view) {
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos === null) return false;
            const line = view.state.doc.lineAt(pos).number;
            onCursorRef.current(line);
            return false;
          },
        }),
      ],
    });

    const view = new EditorView({ parent: host, state });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 只在挂载时创建一次；value 的后续变化由下面的 effect 同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current === value) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
    });
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !scrollTarget) return;
    const line = Math.min(Math.max(1, scrollTarget.line), view.state.doc.lines);
    const info = view.state.doc.line(line);
    view.dispatch({
      selection: { anchor: info.from },
      effects: EditorView.scrollIntoView(info.from, { y: 'center' }),
    });
  }, [scrollTarget]);

  return <div className="editor-host" ref={hostRef} />;
}
