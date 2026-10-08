/* Web Audio 기반 피아노 신시사이저 (외부 음원 파일 없이 동작) */
(function (global) {
  'use strict';

  let ctx = null;
  let bus = null;
  const voices = [];
  const MAX_VOICES = 48;

  function makeImpulse(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  function ensure() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.connect(ctx.destination);
      bus = ctx.createGain();
      bus.gain.value = 0.55;
      bus.connect(comp);
      const verb = ctx.createConvolver();
      verb.buffer = makeImpulse(2.4);
      const wet = ctx.createGain();
      wet.gain.value = 0.22;
      bus.connect(verb);
      verb.connect(wet);
      wet.connect(comp);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function stopVoice(v, at) {
    if (v.stopped) return;
    v.stopped = true;
    const t = Math.max(at, ctx.currentTime);
    v.out.gain.cancelScheduledValues(t);
    v.out.gain.setValueAtTime(v.out.gain.value, t);
    v.out.gain.setTargetAtTime(0, t, 0.06);
    v.oscs.forEach((o) => { try { o.stop(t + 0.5); } catch (e) { /* 이미 정지됨 */ } });
  }

  function note(midi, when, vel) {
    if (!ensure()) return null;
    const t = Math.max(when, ctx.currentTime);
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    // 낮은 음일수록 길게 울리도록
    const tau = Math.min(3.2, 0.9 * Math.sqrt(523 / f));
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(bus);

    const oscs = [];
    const partials = f > 1500 ? 3 : 6;
    for (let k = 1; k <= partials; k++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * k * (1 + 0.0004 * k * k); // 약간의 비조화성
      const g = ctx.createGain();
      const amp = (vel * 0.22 * Math.pow(vel, (k - 1) * 0.35)) / Math.pow(k, 1.15);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.004);
      g.gain.setTargetAtTime(amp * 0.35, t + 0.004, 0.08 / k);
      g.gain.setTargetAtTime(0, t + 0.12, tau / (1 + 0.6 * (k - 1)));
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + tau * 5 + 0.2);
      oscs.push(osc);
    }
    const v = { out, oscs, stopped: false };
    oscs[0].onended = () => { const i = voices.indexOf(v); if (i >= 0) voices.splice(i, 1); };
    voices.push(v);
    while (voices.length > MAX_VOICES) stopVoice(voices.shift(), ctx.currentTime);
    return v;
  }

  /**
   * 타일 하나를 연주한다.
   * seq: [[midi...], ...] 순서대로 울릴 화음들, bass: 반주 음들, span: seq 전체에 쓸 시간(초)
   * 반환값: 롱 타일에서 손을 뗄 때 소리를 줄이기 위한 voice 목록
   */
  function playStep(seq, bass, span) {
    const c = ensure();
    if (!c) return [];
    const now = c.currentTime + 0.005;
    const handles = [];
    const gap = seq.length > 1 ? span / seq.length : 0;
    seq.forEach((chord, i) => {
      chord.forEach((m) => { const v = note(m, now + i * gap, 0.85); if (v) handles.push(v); });
    });
    bass.forEach((m) => { const v = note(m, now, 0.55); if (v) handles.push(v); });
    return handles;
  }

  function release(handles) {
    if (!ctx || !handles) return;
    handles.forEach((v) => stopVoice(v, ctx.currentTime + 0.05));
  }

  function failSound() {
    const c = ensure();
    if (!c) return;
    [36, 37, 42, 43].forEach((m) => note(m, c.currentTime, 0.9));
  }

  global.Piano = { ensure, playStep, release, failSound };
})(window);
