let _audioCtx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
  return _audioCtx;
}

function tone(freq: number, type: OscillatorType, startOffset: number, duration: number, vol: number) {
  try {
    const ctx  = getCtx();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + startOffset);
    gain.gain.setValueAtTime(vol, ctx.currentTime + startOffset);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startOffset + duration);
    osc.start(ctx.currentTime + startOffset);
    osc.stop(ctx.currentTime + startOffset + duration);
  } catch (_) {}
}

export function playSound(type: 'newOrder' | 'slaWarn' | 'riderHere', enabled: boolean) {
  if (!enabled) return;
  if (type === 'newOrder') {
    tone(880,  'sine',   0,    0.22, 0.35);
    tone(1100, 'sine',   0.22, 0.28, 0.3);
  } else if (type === 'slaWarn') {
    tone(440, 'square', 0,    0.14, 0.25);
    tone(440, 'square', 0.22, 0.14, 0.25);
    tone(520, 'square', 0.44, 0.18, 0.3);
  } else if (type === 'riderHere') {
    tone(660, 'sine',   0,    0.35, 0.3);
    tone(880, 'sine',   0.3,  0.3,  0.25);
  }
}
