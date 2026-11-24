import { Pause, Play } from 'lucide-react';
import { useEffect, useState } from 'react';

import type { SceneHandle } from '../lib/scene';

const speeds = [0.25, 0.5, 1, 1.5, 2];

/** Plays the animations a model carries: pick a clip, play or pause, scrub, change the speed. */
export function AnimationBar({
  handle,
  animations,
}: {
  handle: SceneHandle;
  animations: { name: string; duration: number }[];
}) {
  // -1: rest pose (nothing plays).
  const [clip, setClip] = useState(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [time, setTime] = useState(0);
  const duration = animations[clip]?.duration ?? 0;

  // A new model starts on its first animation.
  useEffect(() => {
    setClip(0);
    setPaused(false);
    handle.setPaused(false);
    handle.play(0);
  }, [handle, animations]);

  // The time line follows the animation while it plays.
  useEffect(() => {
    if (paused || clip < 0) return;
    const timer = setInterval(() => setTime(handle.time() % Math.max(duration, 0.001)), 100);
    return () => clearInterval(timer);
  }, [handle, paused, clip, duration]);

  function choose(index: number) {
    setClip(index);
    setTime(0);
    handle.play(index < 0 ? null : index);
  }

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-t border-border bg-card px-3 text-xs text-muted-foreground">
      <select
        aria-label="Animation"
        value={clip}
        onChange={(event) => choose(Number(event.target.value))}
        className="h-6 max-w-64 rounded-sm border border-border bg-background px-1 text-foreground"
      >
        <option value={-1}>Rest pose</option>
        {animations.map((animation, index) => (
          <option key={`${index}:${animation.name}`} value={index}>
            {animation.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={clip < 0}
        aria-label={paused ? 'Play' : 'Pause'}
        onClick={() => {
          handle.setPaused(!paused);
          setPaused(!paused);
        }}
        className="grid size-6 place-items-center rounded-sm text-foreground hover:bg-muted disabled:opacity-35"
      >
        {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
      </button>
      <input
        type="range"
        aria-label="Time"
        min={0}
        max={duration}
        step={0.01}
        value={Math.min(time, duration)}
        disabled={clip < 0}
        onChange={(event) => {
          const seconds = Number(event.target.value);
          setTime(seconds);
          handle.seek(seconds);
        }}
        className="min-w-0 flex-1 accent-primary"
      />
      <span className="w-24 text-right font-mono tabular-nums">
        {time.toFixed(2)} / {duration.toFixed(2)} s
      </span>
      <select
        aria-label="Speed"
        value={speed}
        onChange={(event) => {
          const next = Number(event.target.value);
          setSpeed(next);
          handle.setSpeed(next);
        }}
        className="h-6 rounded-sm border border-border bg-background px-1 text-foreground"
      >
        {speeds.map((value) => (
          <option key={value} value={value}>
            ×{value}
          </option>
        ))}
      </select>
    </div>
  );
}
