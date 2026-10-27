import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { Issue } from '../core/types';
import { buildBeatLines, beatToughness } from '../core/beat';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

interface DamageNumber {
  id: number;
  x: number;
  y: number;
  value: number;
}

export interface BeatModeProps {
  sql: string;
  issues: Issue[];
  onClose: () => void;
}

const PARTICLE_COLORS = ['#fbbf24', '#fb923c', '#f87171', '#fde68a', '#fff7ed'];
const STRIKE_INTERVAL_MS = 110;

export function BeatMode({ sql, issues, onClose }: BeatModeProps) {
  const lines = useMemo(() => buildBeatLines(sql), [sql]);
  const toughness = useMemo(() => beatToughness(sql.split('\n').length), [sql]);
  const [hits, setHits] = useState(0);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(0);
  const [ko, setKo] = useState(false);
  const [showKo, setShowKo] = useState(false);
  const [damageNumbers, setDamageNumbers] = useState<DamageNumber[]>([]);

  const stageRef = useRef<HTMLDivElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pressedRef = useRef(false);
  const hitsRef = useRef(0);
  const koRef = useRef(false);
  const comboRef = useRef(0);
  const bestComboRef = useRef(0);
  const lastStrikeRef = useRef(0);
  const lastHitAtRef = useRef(0);
  const comboTimerRef = useRef<number | null>(null);
  const damageIdRef = useRef(0);
  const particlesRef = useRef<Particle[]>([]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
      if (comboTimerRef.current !== null) window.clearTimeout(comboTimerRef.current);
    };
  }, [onClose]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return undefined;
    const context = canvas.getContext('2d');
    if (!context) return undefined;
    let frame = 0;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);
    const observer =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
    observer?.observe(wrap);

    const loop = () => {
      const rect = wrap.getBoundingClientRect();
      context.clearRect(0, 0, rect.width, rect.height);
      const particles = particlesRef.current;
      for (let i = particles.length - 1; i >= 0; i -= 1) {
        const particle = particles[i]!;
        particle.life -= 1;
        if (particle.life <= 0) {
          particles.splice(i, 1);
          continue;
        }
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.vy += 0.35;
        particle.vx *= 0.985;
        const alpha = Math.max(0, particle.life / particle.maxLife);
        context.globalAlpha = alpha;
        context.fillStyle = particle.color;
        context.fillRect(particle.x, particle.y, particle.size, particle.size);
      }
      context.globalAlpha = 1;
      frame = window.requestAnimationFrame(loop);
    };
    frame = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      observer?.disconnect();
    };
  }, []);

  const spawnParticles = (x: number, y: number) => {
    const count = 10 + Math.floor(Math.random() * 7);
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.8 + Math.random() * 5.4;
      particlesRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 1.5,
        life: 24 + Math.floor(Math.random() * 22),
        maxLife: 46,
        size: 2 + Math.floor(Math.random() * 4),
        color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)]!,
      });
    }
    if (particlesRef.current.length > 180) {
      particlesRef.current.splice(0, particlesRef.current.length - 180);
    }
  };

  const addDamage = (x: number, y: number) => {
    damageIdRef.current += 1;
    const id = damageIdRef.current;
    const value = 1 + Math.floor(Math.random() * 4);
    setDamageNumbers((current) => [...current.slice(-8), { id, x, y, value }]);
    window.setTimeout(() => {
      setDamageNumbers((current) => current.filter((item) => item.id !== id));
    }, 620);
  };

  const strike = (clientX: number, clientY: number) => {
    if (koRef.current) return;
    const now = performance.now();
    if (now - lastStrikeRef.current < STRIKE_INTERVAL_MS) return;
    lastStrikeRef.current = now;

    const wrap = wrapRef.current;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const next = hitsRef.current + 1;
    hitsRef.current = next;
    setHits(next);
    spawnParticles(x, y);
    addDamage(x, y);

    if (now - lastHitAtRef.current < 900) comboRef.current += 1;
    else comboRef.current = 1;
    lastHitAtRef.current = now;
    setCombo(comboRef.current);
    if (comboRef.current > bestComboRef.current) {
      bestComboRef.current = comboRef.current;
      setBestCombo(comboRef.current);
    }
    if (comboTimerRef.current !== null) window.clearTimeout(comboTimerRef.current);
    comboTimerRef.current = window.setTimeout(() => {
      comboRef.current = 0;
      setCombo(0);
    }, 1200);

    const stage = stageRef.current;
    if (stage?.animate) {
      const power = 2 + Math.min(7, comboRef.current);
      stage.animate(
        [
          { transform: 'translate(0, 0)' },
          { transform: `translate(${power}px, ${-power / 2}px)` },
          { transform: `translate(${-power}px, ${power / 2}px)` },
          { transform: 'translate(0, 0)' },
        ],
        { duration: 95, easing: 'ease-out' },
      );
    }

    if (next >= toughness) {
      koRef.current = true;
      setKo(true);
      window.setTimeout(() => setShowKo(true), 700);
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || koRef.current) return;
    event.preventDefault();
    pressedRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    strike(event.clientX, event.clientY);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pressedRef.current || koRef.current) return;
    strike(event.clientX, event.clientY);
  };

  const stopPunching = (event: ReactPointerEvent<HTMLDivElement>) => {
    pressedRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const reset = () => {
    hitsRef.current = 0;
    koRef.current = false;
    comboRef.current = 0;
    bestComboRef.current = 0;
    lastStrikeRef.current = 0;
    lastHitAtRef.current = 0;
    setHits(0);
    setCombo(0);
    setBestCombo(0);
    setKo(false);
    setShowKo(false);
    setDamageNumbers([]);
    particlesRef.current = [];
  };

  const remaining = Math.max(0, toughness - hits);
  const progress = Math.min(100, (hits / toughness) * 100);

  return (
    <div className="beat-overlay" role="dialog" aria-modal="true" aria-label="暴打 SQL">
      <header className="beat-header">
        <div>
          <span className="beat-eyebrow">SQL ARCADE · READ ONLY</span>
          <h2>暴打 SQL</h2>
        </div>
        <div className="beat-header-stats">
          <div className="beat-meter">
            <span>欠打值</span>
            <div className="beat-meter-track">
              <i style={{ width: `${progress}%` }} />
            </div>
            <b>{remaining}</b>
          </div>
          <div className={`beat-combo${combo > 1 ? ' is-hot' : ''}`}>
            连击 <strong>x{combo}</strong>
            <span>最高 x{bestCombo}</span>
          </div>
          <button type="button" className="beat-close" onClick={onClose}>
            退出
          </button>
        </div>
      </header>

      <div className="beat-stage-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className="beat-particles" aria-hidden="true" />
        <div
          ref={stageRef}
          className={`beat-stage${ko ? ' is-ko' : ''}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={stopPunching}
          onPointerCancel={stopPunching}
          aria-label="点击或拖动暴打 SQL"
        >
          <div className="beat-paper">
            {lines.map((line) => (
              <div className="beat-line" key={line.line}>
                <span className="beat-line-no">{line.line}</span>
                <div className="beat-line-content">
                  {line.tokens.length === 0 ? (
                    <span className="beat-blank">&nbsp;</span>
                  ) : (
                    line.tokens.map((token) => {
                      const state =
                        ko || hits >= token.fallAt + 1
                          ? 'is-falling'
                          : hits >= token.fallAt
                            ? 'is-hanging'
                            : '';
                      const style = {
                        '--hang-angle': `${token.hangAngle}deg`,
                        '--fall-x': `${token.fallX}px`,
                        '--fall-rotate': `${token.fallRotate}deg`,
                      } as CSSProperties;
                      return (
                        <span
                          className={`beat-token beat-token-${token.kind} ${state}`}
                          style={style}
                          key={token.id}
                        >
                          {token.text}
                        </span>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {damageNumbers.map((item) => (
          <span
            className="beat-damage"
            key={item.id}
            style={{ left: item.x, top: item.y }}
          >
            -{item.value}
          </span>
        ))}
      </div>

      <footer className="beat-footer">
        <span>点击出拳 · 按住拖动连击 · SQL 不会被修改</span>
        <span>
          {hits} 拳 / {toughness}
        </span>
      </footer>

      {showKo ? (
        <div className="beat-ko">
          <div className="beat-ko-card">
            <span className="beat-ko-kicker">K.O.</span>
            <h3>SQL 已散架</h3>
            <p>
              {hits} 拳 · 最高连击 x{bestCombo}
            </p>
            <div className="beat-ko-reasons">
              <h4>它为什么欠打</h4>
              {issues.length > 0 ? (
                <ul>
                  {issues.slice(0, 5).map((issue) => (
                    <li key={issue.id}>
                      <code>{issue.ruleId}</code>
                      <span>{issue.title}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>这次没扫出高风险，只是单纯欠打。</p>
              )}
            </div>
            <div className="beat-ko-actions">
              <button type="button" onClick={reset}>
                再来一轮
              </button>
              <button type="button" onClick={onClose}>
                收工
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
