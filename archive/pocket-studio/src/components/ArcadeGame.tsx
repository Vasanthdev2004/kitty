// ─── Arcade Collector Game – Real playable canvas game ─────────────────────
import { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, RefreshCw } from 'lucide-react';
import type { BrandColors } from '../types';

interface Props {
  gameTitle: string;
  clientName: string;
  colors: BrandColors;
  ctaText?: string;
  /** When true, renders in a slightly more compact QA-review size */
  embedded?: boolean;
}

type GameState = 'idle' | 'playing' | 'paused' | 'gameover';

// ── Game constants ───────────────────────────────────────────────────────────
const GAME_W = 480;
const GAME_H = 300;
const PLAYER_W = 40;
const PLAYER_H = 28;
const STAR_R = 12;
const OBSTACLE_W = 28;
const OBSTACLE_H = 28;
const GAME_DURATION = 30; // seconds
const PLAYER_SPEED = 5;
const GRAVITY = 0.4;
const STAR_SPEED_BASE = 2.2;
const OBS_SPEED_BASE = 2.8;

interface Entity { x: number; y: number; vy: number; active: boolean }

function randomX() { return 20 + Math.random() * (GAME_W - 40); }

export function ArcadeGame({ gameTitle, clientName, colors, ctaText, embedded: _embedded }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<GameState>('idle');
  const [gameState, setGameState] = useState<GameState>('idle');
  const [score, setScore] = useState(0);
  const [timeLeft, setTimeLeft] = useState(GAME_DURATION);
  const scoreRef = useRef(0);
  const timeRef = useRef(GAME_DURATION);
  const frameRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const keysRef = useRef<Set<string>>(new Set());

  // Game entities (mutable refs for canvas loop)
  const playerRef = useRef({ x: GAME_W / 2 - PLAYER_W / 2, y: GAME_H - 60 });
  const starsRef = useRef<Entity[]>([]);
  const obstaclesRef = useRef<Entity[]>([]);
  const particlesRef = useRef<{ x: number; y: number; vx: number; vy: number; life: number; color: string }[]>([]);
  const spawnTimerRef = useRef(0);
  const obsTimerRef = useRef(0);

  // Touch controls
  const touchLeftRef = useRef(false);
  const touchRightRef = useRef(false);

  function initGame() {
    playerRef.current = { x: GAME_W / 2 - PLAYER_W / 2, y: GAME_H - 60 };
    starsRef.current = [
      { x: randomX(), y: -STAR_R * 2, vy: STAR_SPEED_BASE, active: true },
      { x: randomX(), y: -STAR_R * 5, vy: STAR_SPEED_BASE * 0.8, active: true },
    ];
    obstaclesRef.current = [];
    particlesRef.current = [];
    spawnTimerRef.current = 0;
    obsTimerRef.current = 0;
    scoreRef.current = 0;
    timeRef.current = GAME_DURATION;
    setScore(0);
    setTimeLeft(GAME_DURATION);
  }

  const startGame = useCallback(() => {
    initGame();
    stateRef.current = 'playing';
    setGameState('playing');
    lastTimeRef.current = 0;
    frameRef.current = requestAnimationFrame(gameLoop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pauseGame = useCallback(() => {
    if (stateRef.current !== 'playing') return;
    stateRef.current = 'paused';
    setGameState('paused');
    cancelAnimationFrame(frameRef.current);
  }, []);

  const resumeGame = useCallback(() => {
    if (stateRef.current !== 'paused') return;
    stateRef.current = 'playing';
    setGameState('playing');
    lastTimeRef.current = 0;
    frameRef.current = requestAnimationFrame(gameLoop);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const restartGame = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    startGame();
  }, [startGame]);

  function gameLoop(ts: number) {
    if (stateRef.current !== 'playing') return;
    const dt = lastTimeRef.current ? Math.min((ts - lastTimeRef.current) / 16.67, 3) : 1;
    lastTimeRef.current = ts;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Update time
    timeRef.current -= (1 / 60) * dt;
    if (timeRef.current <= 0) {
      timeRef.current = 0;
      setTimeLeft(0);
      setScore(scoreRef.current);
      stateRef.current = 'gameover';
      setGameState('gameover');
      draw(ctx);
      return;
    }
    setTimeLeft(Math.ceil(timeRef.current));

    // Move player
    const p = playerRef.current;
    const spd = PLAYER_SPEED * dt;
    if (keysRef.current.has('ArrowLeft') || keysRef.current.has('a') || touchLeftRef.current) {
      p.x = Math.max(0, p.x - spd);
    }
    if (keysRef.current.has('ArrowRight') || keysRef.current.has('d') || touchRightRef.current) {
      p.x = Math.min(GAME_W - PLAYER_W, p.x + spd);
    }

    // Spawn stars
    spawnTimerRef.current += dt;
    if (spawnTimerRef.current > 45) {
      spawnTimerRef.current = 0;
      starsRef.current.push({ x: randomX(), y: -STAR_R, vy: STAR_SPEED_BASE + Math.random() * 1.5, active: true });
    }

    // Spawn obstacles
    obsTimerRef.current += dt;
    if (obsTimerRef.current > 80) {
      obsTimerRef.current = 0;
      obstaclesRef.current.push({ x: randomX(), y: -OBSTACLE_H, vy: OBS_SPEED_BASE + Math.random() * 1.2, active: true });
    }

    // Update stars
    for (const s of starsRef.current) {
      if (!s.active) continue;
      s.y += s.vy * dt;
      // Collect
      if (
        s.x + STAR_R > p.x && s.x - STAR_R < p.x + PLAYER_W &&
        s.y + STAR_R > p.y && s.y - STAR_R < p.y + PLAYER_H
      ) {
        s.active = false;
        scoreRef.current += 10;
        setScore(scoreRef.current);
        spawnParticles(s.x, s.y, colors.accent);
      }
      if (s.y > GAME_H + STAR_R) s.active = false;
    }
    starsRef.current = starsRef.current.filter(s => s.active);

    // Update obstacles
    for (const o of obstaclesRef.current) {
      if (!o.active) continue;
      o.y += o.vy * dt;
      // Collision
      if (
        o.x + OBSTACLE_W - 4 > p.x + 4 && o.x + 4 < p.x + PLAYER_W - 4 &&
        o.y + OBSTACLE_H - 4 > p.y + 4 && o.y + 4 < p.y + PLAYER_H - 4
      ) {
        o.active = false;
        scoreRef.current = Math.max(0, scoreRef.current - 5);
        setScore(scoreRef.current);
        spawnParticles(p.x + PLAYER_W / 2, p.y + PLAYER_H / 2, '#e8512a');
      }
      if (o.y > GAME_H + OBSTACLE_H) o.active = false;
    }
    obstaclesRef.current = obstaclesRef.current.filter(o => o.active);

    // Particles
    for (const pt of particlesRef.current) {
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += GRAVITY * dt;
      pt.life -= 0.04 * dt;
    }
    particlesRef.current = particlesRef.current.filter(pt => pt.life > 0);

    draw(ctx);
    frameRef.current = requestAnimationFrame(gameLoop);
  }

  function spawnParticles(x: number, y: number, color: string) {
    for (let i = 0; i < 8; i++) {
      particlesRef.current.push({
        x, y,
        vx: (Math.random() - 0.5) * 5,
        vy: (Math.random() - 0.5) * 5 - 2,
        life: 0.8 + Math.random() * 0.4,
        color,
      });
    }
  }

  function draw(ctx: CanvasRenderingContext2D) {
    // Background
    ctx.fillStyle = colors.primary;
    ctx.fillRect(0, 0, GAME_W, GAME_H);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let x = 0; x < GAME_W; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, GAME_H); ctx.stroke();
    }
    for (let y = 0; y < GAME_H; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(GAME_W, y); ctx.stroke();
    }

    // Stars (collectibles)
    for (const s of starsRef.current) {
      if (!s.active) continue;
      ctx.save();
      ctx.translate(s.x, s.y);
      drawStar(ctx, 0, 0, STAR_R, 5, colors.accent);
      ctx.restore();
    }

    // Obstacles
    for (const o of obstaclesRef.current) {
      if (!o.active) continue;
      ctx.fillStyle = '#e8512a';
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1.5;
      roundRect(ctx, o.x, o.y, OBSTACLE_W, OBSTACLE_H, 6);
      ctx.fill();
      ctx.stroke();
      // X mark
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(o.x + 8, o.y + 8); ctx.lineTo(o.x + OBSTACLE_W - 8, o.y + OBSTACLE_H - 8);
      ctx.moveTo(o.x + OBSTACLE_W - 8, o.y + 8); ctx.lineTo(o.x + 8, o.y + OBSTACLE_H - 8);
      ctx.stroke();
    }

    // Player (brand capsule)
    const p = playerRef.current;
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 2;
    roundRect(ctx, p.x, p.y, PLAYER_W, PLAYER_H, 8);
    ctx.fill();
    ctx.stroke();
    // Brand letter
    ctx.fillStyle = colors.primary;
    ctx.font = `bold 14px 'Space Grotesk', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(clientName.charAt(0).toUpperCase(), p.x + PLAYER_W / 2, p.y + PLAYER_H / 2);

    // Particles
    for (const pt of particlesRef.current) {
      ctx.globalAlpha = pt.life;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // HUD
    const hudH = 36;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(0, 0, GAME_W, hudH);
    // Score
    ctx.fillStyle = colors.accent;
    ctx.font = `bold 15px 'Space Grotesk', sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`★ ${scoreRef.current}`, 12, hudH / 2);
    // Timer
    const t = Math.ceil(Math.max(0, timeRef.current));
    ctx.fillStyle = t <= 5 ? '#e8512a' : 'rgba(255,255,255,0.85)';
    ctx.textAlign = 'right';
    ctx.fillText(`${t}s`, GAME_W - 12, hudH / 2);
    // Game title
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `500 11px 'DM Sans', sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(gameTitle, GAME_W / 2, hudH / 2);

    // Game over overlay
    if (stateRef.current === 'gameover') {
      ctx.fillStyle = 'rgba(0,0,0,0.62)';
      ctx.fillRect(0, 0, GAME_W, GAME_H);

      ctx.fillStyle = colors.accent;
      ctx.font = `bold 32px 'Space Grotesk', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Game Over', GAME_W / 2, GAME_H / 2 - 40);

      ctx.fillStyle = '#fff';
      ctx.font = `600 18px 'DM Sans', sans-serif`;
      ctx.fillText(`Score: ${scoreRef.current}`, GAME_W / 2, GAME_H / 2 - 5);

      // CTA
      const ctaLabel = ctaText ?? `Play ${gameTitle} — by ${clientName}`;
      ctx.fillStyle = colors.accent;
      ctx.font = `bold 13px 'DM Sans', sans-serif`;
      ctx.fillText(ctaLabel, GAME_W / 2, GAME_H / 2 + 36);
    }

    // Paused overlay
    if (stateRef.current === 'paused') {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = '#fff';
      ctx.font = `bold 28px 'Space Grotesk', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Paused', GAME_W / 2, GAME_H / 2);
    }

    // Idle overlay
    if (stateRef.current === 'idle') {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, GAME_W, GAME_H);
      ctx.fillStyle = colors.accent;
      ctx.font = `bold 26px 'Space Grotesk', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(gameTitle, GAME_W / 2, GAME_H / 2 - 20);
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.font = `500 14px 'DM Sans', sans-serif`;
      ctx.fillText('Press Play to start', GAME_W / 2, GAME_H / 2 + 16);
    }
  }

  // Keyboard
  useEffect(() => {
    const down = (e: KeyboardEvent) => { keysRef.current.add(e.key); };
    const up = (e: KeyboardEvent) => { keysRef.current.delete(e.key); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  // Initial draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Clear and draw idle
    ctx.fillStyle = colors.primary;
    ctx.fillRect(0, 0, GAME_W, GAME_H);
    draw(ctx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colors.primary, colors.accent]);

  // Cleanup on unmount
  useEffect(() => {
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  return (
    <div className="space-y-4">
      {/* Canvas */}
      <div className="relative rounded-2xl overflow-hidden" style={{ border: `2px solid ${colors.accent}`, boxShadow: `0 0 32px ${colors.primary}44` }}>
        <canvas
          ref={canvasRef}
          id="game-canvas"
          width={GAME_W}
          height={GAME_H}
          style={{ width: '100%', height: 'auto', display: 'block', background: colors.primary }}
        />
      </div>

      {/* HUD row */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-1 text-sm font-600 tabular-nums" style={{ color: 'var(--ink)' }}>
          <span style={{ color: colors.accent }}>★</span>
          <span>{score}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {gameState === 'idle' && (
            <button
              onClick={startGame}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-600 text-sm"
              style={{ background: colors.primary, color: '#fff' }}
            >
              <Play size={14} />Play
            </button>
          )}
          {gameState === 'playing' && (
            <button onClick={pauseGame} className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-600 text-sm" style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}>
              <Pause size={14} />Pause
            </button>
          )}
          {gameState === 'paused' && (
            <button onClick={resumeGame} className="flex items-center gap-1.5 px-4 py-2 rounded-xl font-600 text-sm" style={{ background: colors.primary, color: '#fff' }}>
              <Play size={14} />Resume
            </button>
          )}
          {(gameState === 'playing' || gameState === 'paused' || gameState === 'gameover') && (
            <button onClick={restartGame} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px solid var(--border)' }}>
              <RefreshCw size={13} />
            </button>
          )}
        </div>
        <div className="text-sm tabular-nums font-500" style={{ color: timeLeft <= 5 ? '#e8512a' : 'var(--muted)' }}>
          {timeLeft}s
        </div>
      </div>

      {/* Touch controls */}
      <div className="flex gap-3 justify-center mt-1" aria-label="Touch controls">
        <button
          className="flex-1 max-w-32 py-4 rounded-2xl font-700 text-xl select-none"
          style={{ background: colors.primary, color: '#fff', touchAction: 'none', minHeight: 56 }}
          onPointerDown={() => { touchLeftRef.current = true; }}
          onPointerUp={() => { touchLeftRef.current = false; }}
          onPointerLeave={() => { touchLeftRef.current = false; }}
          aria-label="Move left"
        >
          ←
        </button>
        <button
          className="flex-1 max-w-32 py-4 rounded-2xl font-700 text-xl select-none"
          style={{ background: colors.primary, color: '#fff', touchAction: 'none', minHeight: 56 }}
          onPointerDown={() => { touchRightRef.current = true; }}
          onPointerUp={() => { touchRightRef.current = false; }}
          onPointerLeave={() => { touchRightRef.current = false; }}
          aria-label="Move right"
        >
          →
        </button>
      </div>

      {/* Instructions */}
      <div className="rounded-xl p-3" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
        <p className="text-xs text-center" style={{ color: 'var(--muted)' }}>
          Move with <span className="mono">← →</span> or <span className="mono">A D</span> · Collect stars (+10) · Avoid obstacles (−5) · 30 seconds
        </p>
      </div>
    </div>
  );
}

// ── Canvas helpers ────────────────────────────────────────────────────────────

function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number, points: number, color: string) {
  const innerR = outerR * 0.42;
  const step = Math.PI / points;
  ctx.beginPath();
  for (let i = 0; i < 2 * points; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = i * step - Math.PI / 2;
    ctx.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
  }
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
