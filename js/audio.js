/*
 * 피아노 소리
 * - Salamander Grand Piano V3(Yamaha C5, Alexander Holm, CC BY 3.0) 샘플을 8단계 세기·스테레오로 재생,
 *   건반을 놓을 때의 댐퍼 소리까지
 * - 샘플을 아직 못 불러왔거나 불러올 수 없으면(예: file:// 로 열었을 때) 합성음으로 대신 연주
 */
(function (global) {
  'use strict';

  let ctx = null;
  let bus = null;
  const voices = [];
  const MAX_VOICES = 96;
  const lastByKey = new Map(); // 같은 건반을 다시 치면 앞 소리를 멈춘다 (실제 피아노처럼)

  const sampler = { layers: null, buffers: new Map(), release: new Map(), loaded: 0, total: 0, state: 'idle' };

  function makeImpulse(seconds) {
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    return buf;
  }

  function ensure() {
    if (!ctx) {
      const AC = global.AudioContext || global.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 3;
      comp.connect(ctx.destination);
      bus = ctx.createGain();
      bus.gain.value = 0.8;
      bus.connect(comp);
      // 작은 홀 정도의 잔향
      const verb = ctx.createConvolver();
      verb.buffer = makeImpulse(2.2);
      const wet = ctx.createGain();
      wet.gain.value = 0.16;
      bus.connect(verb);
      verb.connect(wet);
      wet.connect(comp);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // ---------- 샘플 불러오기 ----------
  function loadSamples(base, onProgress) {
    if (sampler.state !== 'idle') return;
    sampler.state = 'loading';
    if (!ensure()) { sampler.state = 'failed'; return; }
    const report = () => onProgress && onProgress(sampler);
    fetch(base + 'manifest.json')
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((man) => {
        sampler.layers = man.layers;
        // manifest 의 층 순서 = 불러오는 순서 (곡에서 많이 쓰는 세기부터). 건반 놓는 소리는 맨 나중에.
        const jobs = [];
        man.layers.forEach((layer) => layer.regions.forEach((reg) => jobs.push({ layer, reg })));
        (man.release || []).forEach((rel) => jobs.push({ rel }));
        sampler.total = jobs.length;
        report();
        let i = 0;
        const worker = () => {
          if (i >= jobs.length) return Promise.resolve();
          const { layer, reg, rel } = jobs[i++];
          return fetch(base + (rel ? rel.file : reg.file))
            .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
            .then((ab) => new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej)))
            .then((buf) => {
              if (rel) sampler.release.set(rel.key, buf);
              else sampler.buffers.set(layer.name + ':' + reg.key, buf);
            })
            .catch(() => { /* 한 개 실패해도 나머지는 계속 */ })
            .then(() => { sampler.loaded++; report(); return worker(); });
        };
        return Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
      })
      .then(() => { sampler.state = sampler.buffers.size ? 'ready' : 'failed'; report(); })
      .catch(() => { sampler.state = 'failed'; report(); });
  }

  // 세기(0~127)와 음높이에 맞는 샘플 찾기. 그 세기 층이 아직 없으면 가까운 층으로.
  function findSample(midi, vel127) {
    if (!sampler.layers) return null;
    const layers = sampler.layers.slice().sort((a, b) => {
      const da = vel127 < a.lovel ? a.lovel - vel127 : vel127 > a.hivel ? vel127 - a.hivel : 0;
      const db = vel127 < b.lovel ? b.lovel - vel127 : vel127 > b.hivel ? vel127 - b.hivel : 0;
      return da - db;
    });
    for (const layer of layers) {
      const reg = layer.regions.find((r) => midi >= r.lo && midi <= r.hi);
      if (!reg) continue;
      const buf = sampler.buffers.get(layer.name + ':' + reg.key);
      if (buf) return { buf, key: reg.key, layer };
    }
    return null;
  }

  function trackVoice(v, midi, t) {
    const prev = lastByKey.get(midi);
    if (prev && !prev.stopped) stopVoice(prev, t);
    lastByKey.set(midi, v);
    voices.push(v);
    while (voices.length > MAX_VOICES) stopVoice(voices.shift(), ctx.currentTime);
  }

  function stopVoice(v, at) {
    if (v.stopped) return;
    v.stopped = true;
    const t = Math.max(at, ctx.currentTime);
    v.out.gain.cancelScheduledValues(t);
    v.out.gain.setValueAtTime(v.out.gain.value, t);
    v.out.gain.setTargetAtTime(0, t, 0.05);
    v.srcs.forEach((o) => { try { o.stop(t + 0.4); } catch (e) { /* 이미 정지됨 */ } });
  }

  function forget(v) {
    const i = voices.indexOf(v);
    if (i >= 0) voices.splice(i, 1);
  }

  // ---------- 샘플 재생 ----------
  function sampleNote(s, midi, t, vel127, length) {
    const src = ctx.createBufferSource();
    src.buffer = s.buf;
    src.playbackRate.value = Math.pow(2, (midi - s.key) / 12);
    const out = ctx.createGain();
    const span = Math.max(1, s.layer.hivel - s.layer.lovel);
    const within = Math.min(1, Math.max(0, (vel127 - s.layer.lovel) / span));
    // 층이 촘촘해(8단계) 층 안에서는 조금만 바꾼다
    out.gain.value = 0.72 + 0.28 * within;
    let node = out;
    // 스테레오 샘플은 녹음된 공간감(AB 마이크)을 그대로 쓰고, 모노일 때만 음높이로 좌우를 나눈다
    if (s.buf.numberOfChannels < 2 && ctx.createStereoPanner) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.max(-0.5, Math.min(0.5, (midi - 64) / 70)); // 낮은 음은 왼쪽, 높은 음은 오른쪽
      out.connect(pan);
      node = pan;
    }
    node.connect(bus);
    src.connect(out);

    const natural = s.buf.duration / src.playbackRate.value;
    // 악보상 길이가 끝나면 댐퍼가 내려온다 (약간의 페달 여운). 높은 음은 원래 댐퍼가 없다.
    let stopAt = t + natural;
    if (length !== undefined && midi < 89) {
      const damp = t + Math.max(0.15, length) + 0.2;
      if (damp < stopAt) {
        out.gain.setValueAtTime(out.gain.value, damp);
        out.gain.setTargetAtTime(0, damp, midi < 48 ? 0.22 : 0.15);
        stopAt = Math.min(stopAt, damp + 1.2);
        releaseNoise(midi, damp, vel127);
      }
    }
    src.start(t);
    src.stop(stopAt);
    const v = { out, srcs: [src], start: t, stopped: false };
    src.onended = () => forget(v);
    trackVoice(v, midi, t);
    return v;
  }

  // 댐퍼가 현에 닿을 때 나는 작은 소리 (건반마다 녹음된 소리)
  function releaseNoise(midi, t, vel127) {
    const buf = sampler.release.get(midi);
    if (!buf) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 0.05 * (0.4 + 0.6 * (vel127 / 127));
    src.connect(g);
    g.connect(bus);
    src.start(t);
  }

  // ---------- 합성음 (샘플이 없을 때) ----------
  function synthNote(midi, t, vel, length) {
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const tau = Math.min(3.2, 0.9 * Math.sqrt(523 / f));
    const out = ctx.createGain();
    out.gain.value = 1;
    out.connect(bus);
    const damp = length !== undefined ? t + Math.max(0.12, length) + 0.12 : Infinity;
    const stopAt = Math.min(t + tau * 5 + 0.2, damp + 1.2);
    if (damp < stopAt) {
      out.gain.setValueAtTime(1, damp);
      out.gain.setTargetAtTime(0, damp, 0.18);
    }
    const srcs = [];
    const partials = f > 1200 ? 3 : 5;
    for (let k = 1; k <= partials; k++) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = f * k * (1 + 0.0004 * k * k);
      const g = ctx.createGain();
      const amp = (vel * 0.16 * Math.pow(vel, (k - 1) * 0.35)) / Math.pow(k, 1.15);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.004);
      g.gain.setTargetAtTime(amp * 0.35, t + 0.004, 0.08 / k);
      g.gain.setTargetAtTime(0, t + 0.12, tau / (1 + 0.6 * (k - 1)));
      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(stopAt);
      srcs.push(osc);
    }
    const v = { out, srcs, start: t, stopped: false };
    srcs[0].onended = () => forget(v);
    trackVoice(v, midi, t);
    return v;
  }

  /** delay 초 뒤에 음 하나를 울린다. vel: 0~1 (MIDI 세기/127), length: 악보상 길이(초) */
  function schedule(midi, delay, vel, length) {
    const c = ensure();
    if (!c) return null;
    const t = c.currentTime + 0.01 + Math.max(0, delay);
    const vel127 = Math.round(vel * 127);
    const s = findSample(midi, vel127);
    return s ? sampleNote(s, midi, t, vel127, length) : synthNote(midi, t, 0.25 + vel * 0.75, length);
  }

  /** 울리고 있거나 예약된 모든 음을 멈춘다 */
  function stopAll() {
    if (!ctx) return;
    voices.slice().forEach((v) => {
      if (v.start > ctx.currentTime + 0.01) {
        v.stopped = true;
        v.out.gain.cancelScheduledValues(0);
        v.out.gain.setValueAtTime(0, ctx.currentTime);
        v.srcs.forEach((o) => { try { o.stop(); } catch (e) { /* 이미 정지됨 */ } });
      } else {
        stopVoice(v, ctx.currentTime);
      }
    });
  }

  function release(handles) {
    if (!ctx || !handles) return;
    handles.forEach((v) => stopVoice(v, ctx.currentTime + 0.05));
  }

  // 건반을 잘못 내리친 소리
  // gameover: 저음역 불협화 클러스터를 손바닥으로 쾅 친 소리 + 둔탁한 타건 충격음
  // slip: 연습 모드용, 반음 어긋난 두 음을 가볍게
  function failSound(kind) {
    const c = ensure();
    if (!c) return;
    if (kind === 'slip') {
      schedule(73, 0, 0.42, 0.25);
      schedule(74, 0.012, 0.38, 0.25);
      return;
    }
    // 손바닥이 닿는 순서대로 몇 ms씩 어긋나게
    const cluster = [[40, 0], [41, 0.006], [46, 0.011], [47, 0.004], [52, 0.016], [53, 0.009]];
    cluster.forEach(([m, d]) => schedule(m, d, 1, 1.4));
    schedule(64, 0.03, 0.55, 0.6); // 위에서 덜컥 걸린 음 하나
    // 둔탁한 충격음: 짧은 잡음을 낮게 걸러서
    const len = Math.floor(c.sampleRate * 0.18);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4);
    const src = c.createBufferSource();
    src.buffer = buf;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    const g = c.createGain();
    g.gain.value = 0.9;
    src.connect(lp);
    lp.connect(g);
    g.connect(bus);
    src.start(c.currentTime + 0.01);
  }

  // 일시정지: 오디오 시계를 멈추면 예약된 음도 그 자리에서 멈춘다
  function suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); }
  function resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); }

  global.Piano = { ensure, schedule, stopAll, release, failSound, loadSamples, sampler, suspend, resume };
})(window);
