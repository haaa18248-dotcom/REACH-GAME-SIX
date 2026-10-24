import { useEffect, useRef, useState } from 'react';
import { CarGame, Theme } from './game/engine';
import { cn } from './utils/cn';

type Screen = 'home' | 'game';

const ENVIRONMENTS: {
  id: Theme;
  name: string;
  emoji: string;
  img: string;
  desc: string;
  accent: string;
  ring: string;
}[] = [
  {
    id: 'city',
    name: 'City',
    emoji: '🏙️',
    img: '/previews/city.jpg',
    desc: 'Neon skyline night run',
    accent: 'from-indigo-500 to-fuchsia-500',
    ring: 'ring-fuchsia-400',
  },
  {
    id: 'desert',
    name: 'Desert',
    emoji: '🏜️',
    img: '/previews/desert.jpg',
    desc: 'Sunset dunes & cacti',
    accent: 'from-amber-500 to-orange-600',
    ring: 'ring-amber-400',
  },
  {
    id: 'forest',
    name: 'Forest',
    emoji: '🌲',
    img: '/previews/forest.jpg',
    desc: 'Misty pine highway',
    accent: 'from-emerald-500 to-green-600',
    ring: 'ring-emerald-400',
  },
];

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [theme, setTheme] = useState<Theme>('city');

  return screen === 'home' ? (
    <HomeScreen
      theme={theme}
      onSelect={setTheme}
      onStart={() => setScreen('game')}
    />
  ) : (
    <GameScreen theme={theme} onExit={() => setScreen('home')} />
  );
}

/* ================= HOME ================= */

function HomeScreen({
  theme,
  onSelect,
  onStart,
}: {
  theme: Theme;
  onSelect: (t: Theme) => void;
  onStart: () => void;
}) {
  const active = ENVIRONMENTS.find((e) => e.id === theme)!;
  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      {/* blurred backdrop of selected env */}
      <div
        key={theme}
        className="absolute inset-0 scale-110 bg-cover bg-center opacity-40 blur-sm transition-all duration-700"
        style={{ backgroundImage: `url(${active.img})` }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-slate-950/70 via-slate-950/40 to-slate-950/90" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-5xl flex-col items-center justify-center px-6 py-12">
        <div className="mb-2 text-6xl drop-shadow-[0_0_25px_rgba(255,80,80,0.5)]">🏎️</div>
        <h1 className="bg-gradient-to-r from-amber-300 via-red-400 to-fuchsia-400 bg-clip-text text-center text-5xl font-black tracking-tight text-transparent sm:text-6xl">
          SKY RACER 3D
        </h1>
        <p className="mt-3 text-center text-slate-300">
          Pick your highway, dodge the traffic — and when things get tight…{' '}
          <span className="font-semibold text-amber-300">make your car FLY!</span>
        </p>

        {/* environment cards */}
        <div className="mt-10 grid w-full grid-cols-1 gap-5 sm:grid-cols-3">
          {ENVIRONMENTS.map((env) => (
            <button
              key={env.id}
              onClick={() => onSelect(env.id)}
              className={cn(
                'group relative overflow-hidden rounded-2xl text-left shadow-xl transition-all duration-300',
                theme === env.id
                  ? `scale-[1.03] ring-4 ${env.ring} shadow-2xl`
                  : 'opacity-80 hover:scale-[1.02] hover:opacity-100 ring-1 ring-white/10',
              )}
            >
              <img
                src={env.img}
                alt={env.name}
                className="h-44 w-full object-cover transition-transform duration-500 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
              <div className="absolute bottom-0 left-0 right-0 p-4">
                <div className="flex items-center gap-2 text-xl font-bold">
                  <span>{env.emoji}</span> {env.name}
                </div>
                <div className="text-sm text-slate-300">{env.desc}</div>
              </div>
              {theme === env.id && (
                <div
                  className={cn(
                    'absolute right-3 top-3 rounded-full bg-gradient-to-r px-3 py-1 text-xs font-bold uppercase tracking-wide',
                    env.accent,
                  )}
                >
                  ✓ Selected
                </div>
              )}
            </button>
          ))}
        </div>

        {/* start */}
        <button
          onClick={onStart}
          className={cn(
            'mt-10 rounded-2xl bg-gradient-to-r px-14 py-4 text-2xl font-black uppercase tracking-widest shadow-2xl transition-transform hover:scale-105 active:scale-95',
            active.accent,
          )}
        >
          ▶ Start Game
        </button>

        {/* controls help */}
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 text-sm text-slate-300">
          <Key label="← →" desc="change lane" />
          <Key label="↑ / SPACE / CLICK" desc="hold to fly" />
          <Key label="🪙" desc="collect coins" />
          <Key label="🚧" desc="fly over obstacles" />
        </div>
      </div>
    </div>
  );
}

function Key({ label, desc }: { label: string; desc: string }) {
  return (
    <span className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 backdrop-blur">
      <kbd className="rounded bg-white/20 px-2 py-0.5 font-mono text-xs font-bold">{label}</kbd>
      {desc}
    </span>
  );
}

/* ================= GAME ================= */

function GameScreen({ theme, onExit }: { theme: Theme; onExit: () => void }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<CarGame | null>(null);
  const [score, setScore] = useState(0);
  const [coins, setCoins] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [over, setOver] = useState<{ score: number; coins: number } | null>(null);
  const [runId, setRunId] = useState(0);
  const env = ENVIRONMENTS.find((e) => e.id === theme)!;

  useEffect(() => {
    if (!mountRef.current) return;
    setScore(0);
    setCoins(0);
    setSpeed(0);
    setOver(null);
    const game = new CarGame(mountRef.current, theme, {
      onScore: setScore,
      onCoins: setCoins,
      onSpeed: setSpeed,
      onGameOver: (s, c) => setOver({ score: s, coins: c }),
    });
    gameRef.current = game;
    game.start();
    return () => {
      game.dispose();
      gameRef.current = null;
    };
  }, [theme, runId]);

  return (
    <div className="relative h-screen w-screen select-none overflow-hidden bg-black text-white">
      <div ref={mountRef} className="absolute inset-0 touch-none" />

      {/* HUD */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 flex items-start justify-between p-4">
        <div className="flex flex-col gap-2">
          <div className="rounded-xl bg-black/50 px-4 py-2 backdrop-blur">
            <div className="text-[10px] uppercase tracking-widest text-slate-400">Score</div>
            <div className="text-2xl font-black tabular-nums">{score}</div>
          </div>
          <div className="rounded-xl bg-black/50 px-4 py-1.5 backdrop-blur">
            <span className="text-lg">🪙</span>{' '}
            <span className="text-lg font-bold tabular-nums">{coins}</span>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <div className="rounded-xl bg-black/50 px-4 py-2 text-right backdrop-blur">
            <div className="text-[10px] uppercase tracking-widest text-slate-400">Speed</div>
            <div className="text-2xl font-black tabular-nums">
              {speed} <span className="text-sm font-medium text-slate-400">km/h</span>
            </div>
          </div>
          <div className="rounded-full bg-black/50 px-3 py-1 text-sm backdrop-blur">
            {env.emoji} {env.name}
          </div>
        </div>
      </div>

      {/* fly hint */}
      {!over && (
        <div className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 animate-pulse rounded-full bg-black/40 px-4 py-1.5 text-sm text-slate-200 backdrop-blur sm:bottom-6">
          Hold <b>↑ / SPACE</b> or <b>press the screen</b> to fly ✈️
        </div>
      )}

      {/* mobile controls */}
      {!over && (
        <div className="absolute bottom-4 left-0 right-0 flex items-center justify-between px-5 sm:hidden">
          <PadBtn label="◀" onPress={() => gameRef.current?.setLaneDelta(-1)} />
          <PadBtn
            label="⬆ FLY"
            wide
            onHold={(d) => gameRef.current?.setFly(d)}
          />
          <PadBtn label="▶" onPress={() => gameRef.current?.setLaneDelta(1)} />
        </div>
      )}

      {/* game over */}
      {over && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="mx-4 w-full max-w-sm rounded-3xl border border-white/10 bg-slate-900/90 p-8 text-center shadow-2xl">
            <div className="text-5xl">💥</div>
            <h2 className="mt-2 text-3xl font-black text-red-400">CRASHED!</h2>
            <div className="mt-6 grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-white/5 p-4">
                <div className="text-xs uppercase tracking-widest text-slate-400">Score</div>
                <div className="text-3xl font-black text-amber-300">{over.score}</div>
              </div>
              <div className="rounded-xl bg-white/5 p-4">
                <div className="text-xs uppercase tracking-widest text-slate-400">Coins</div>
                <div className="text-3xl font-black text-yellow-400">🪙 {over.coins}</div>
              </div>
            </div>
            <button
              onClick={() => setRunId((r) => r + 1)}
              className={cn(
                'mt-6 w-full rounded-xl bg-gradient-to-r py-3 text-lg font-bold uppercase tracking-wider transition-transform hover:scale-[1.02] active:scale-95',
                env.accent,
              )}
            >
              🔄 Race Again
            </button>
            <button
              onClick={onExit}
              className="mt-3 w-full rounded-xl bg-white/10 py-3 font-semibold text-slate-200 transition hover:bg-white/20"
            >
              🏠 Change Background
            </button>
          </div>
        </div>
      )}

      {/* exit */}
      {!over && (
        <button
          onClick={onExit}
          className="absolute left-1/2 top-4 z-10 -translate-x-1/2 rounded-full bg-black/50 px-4 py-1.5 text-sm text-slate-300 backdrop-blur transition hover:bg-black/70 hover:text-white"
        >
          ✕ Quit
        </button>
      )}
    </div>
  );
}

function PadBtn({
  label,
  wide,
  onPress,
  onHold,
}: {
  label: string;
  wide?: boolean;
  onPress?: () => void;
  onHold?: (down: boolean) => void;
}) {
  return (
    <button
      className={cn(
        'touch-none rounded-2xl bg-white/15 px-6 py-4 text-xl font-black backdrop-blur active:bg-white/30',
        wide && 'px-10',
      )}
      onPointerDown={(e) => {
        e.preventDefault();
        onPress?.();
        onHold?.(true);
      }}
      onPointerUp={() => onHold?.(false)}
      onPointerLeave={() => onHold?.(false)}
    >
      {label}
    </button>
  );
}
