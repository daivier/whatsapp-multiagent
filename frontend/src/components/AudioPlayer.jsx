import { useState, useRef } from 'react';

const SPEEDS = [1, 1.5, 2, 0.5];

export default function AudioPlayer({ src }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [speedIdx, setSpeedIdx] = useState(0);

  const speed = SPEEDS[speedIdx];

  function togglePlay() {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); } else { a.play(); }
  }

  function cycleSpeed() {
    const next = (speedIdx + 1) % SPEEDS.length;
    setSpeedIdx(next);
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next];
  }

  function seek(e) {
    const t = parseFloat(e.target.value);
    setCurrentTime(t);
    if (audioRef.current) audioRef.current.currentTime = t;
  }

  function fmt(s) {
    if (s == null || isNaN(s) || !isFinite(s)) return '--:--';
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', borderRadius: '20px', padding: '0.4rem 0.6rem', minWidth: '200px', maxWidth: '280px', background: 'rgba(0,0,0,0.06)' }}>
      <audio
        ref={audioRef}
        src={src}
        style={{ display: 'none' }}
        onTimeUpdate={e => setCurrentTime(e.target.currentTime)}
        onLoadedMetadata={e => { setDuration(e.target.duration); e.target.playbackRate = SPEEDS[speedIdx]; }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0); if (audioRef.current) audioRef.current.currentTime = 0; }}
      />
      {/* Play/Pause */}
      <button
        onClick={togglePlay}
        style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.9rem', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
      >
        {playing ? '⏸' : '▶'}
      </button>

      {/* Progress + time */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <input
          type="range" min="0" max={duration || 1} step="0.1" value={currentTime}
          onChange={seek}
          style={{ width: '100%', accentColor: 'var(--accent)', cursor: 'pointer', height: 3, display: 'block' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--muted)', marginTop: '1px' }}>
          <span>{fmt(currentTime)}</span>
          <span>{duration && isFinite(duration) ? fmt(duration) : '--:--'}</span>
        </div>
      </div>

      {/* Speed button */}
      <button
        onClick={cycleSpeed}
        title="Velocidade de reprodução"
        style={{ background: speed !== 1 ? 'var(--accent-l)' : 'none', border: '1px solid var(--border-m)', borderRadius: '10px', padding: '0.1rem 0.4rem', fontSize: '0.7rem', fontWeight: 700, cursor: 'pointer', color: speed !== 1 ? 'var(--accent)' : 'var(--muted)', flexShrink: 0, minWidth: 32, textAlign: 'center' }}
      >
        {speed}x
      </button>
    </div>
  );
}
