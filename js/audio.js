/* Web Audio 기반 피아노 신시사이저 (외부 음원 파일 없이 동작) */
(function (global) {
  'use strict';

  let ctx = null;
  let bus = null;
  const voices = [];
  const MAX_VOICES = 56;

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

  function note(midi, when, vel, length) {
    if (!ensure()) return null;
    const t = Math.max(when, ctx.currentTime);
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    // 낮은 음일수록 길게 울리도록
    const tau = Math.min(3.2, 0.9 * Math.sqrt(523 / f));
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(bus);

    // 악보상 길이가 끝나면 댐퍼 (페달 느낌으로 약간 늦게, 천천히)
    const damp = length !== undefined ? t + Math.max(0.12, length) + 0.12 : Infinity;
    const stopAt = Math.min(t + tau * 5 + 0.2, damp + 1.2);
    if (damp < stopAt) {
      out.gain.setValueAtTime(1, damp);
      out.gain.setTargetAtTime(0, damp, 0.18);
    }

    const oscs = [];
    const partials = f > 1200 ? 3 : 5;
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
      osc.stop(stopAt);
      oscs.push(osc);
    }
    const v = { out, oscs, start: t, stopped: false };
    oscs[0].onended = () => { const i = voices.indexOf(v); if (i >= 0) voices.splice(i, 1); };
    voices.push(v);
    while (voices.length > MAX_VOICES) stopVoice(voices.shift(), ctx.currentTime);
    return v;
  }

  /**
   * 타일 하나를 연주한다.
   * events: [{ o, d, m, v }] — o, d 는 타일 길이 대비 비율. span: 타일이 지나가는 데 걸리는 실제 시간(초)
   * 반환값: 아직 울리지 않은 음을 취소할 때 쓰는 voice 목록
   */
  function playEvents(events, span) {
    const c = ensure();
    if (!c) return [];
    const now = c.currentTime + 0.005;
    const handles = [];
    for (const e of events) {
      const v = note(e.m, now + e.o * span, 0.25 + e.v * 0.75, e.d * span);
      if (v) handles.push(v);
    }
    return handles;
  }

  /** 아직 시작하지 않은 음만 취소한다 (다음 타일을 먼저 쳤을 때) */
  function cancelPending(handles) {
    if (!ctx || !handles) return;
    const now = ctx.currentTime;
    for (const v of handles) {
      if (v.stopped || v.start <= now + 0.01) continue;
      v.stopped = true;
      v.out.gain.cancelScheduledValues(0);
      v.out.gain.setValueAtTime(0, now);
      v.oscs.forEach((o) => { try { o.stop(); } catch (e) { /* 이미 정지됨 */ } });
    }
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

  global.Piano = { ensure, playEvents, cancelPending, release, failSound };
})(window);
