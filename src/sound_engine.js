(function (root) {
  "use strict";

  // 1985年ファミコン（2A03 APU）準拠 Web Audio サウンドエンジン
  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.muted = false;
      this.unlocked = false;
      this.masterVolume = 0.45;
      this.walkStyle = "mario83"; // "mario83" | "mario83_low" | "retro_step" | "off"
      this.walkAlt = 0;
      this.ladderAlt = 0;

      this.pulseWaves = {};
      this.triWave = null;
      this.noiseLongBuf = null;
      this.noiseShortBuf = null;
      this.lastPlayTime = Object.create(null);
    }

    ensureContext() {
      if (this.ctx) return this.ctx;
      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;

      try {
        this.ctx = new AC();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
        this.masterGain.connect(this.ctx.destination);
        this.initWaveTables();
      } catch (_) {
        this.ctx = null;
        this.masterGain = null;
      }
      return this.ctx;
    }

    // iPhone Safari / モバイルブラウザ用のユーザー操作時サウンド解禁
    unlock() {
      const ctx = this.ensureContext();
      if (!ctx) return false;
      if (ctx.state === "suspended" && typeof ctx.resume === "function") {
        try {
          ctx.resume();
        } catch (_) {}
      }
      if (!this.unlocked) {
        try {
          const buf = ctx.createBuffer(1, 1, 22050);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(this.masterGain);
          src.start(0);
          this.unlocked = true;
        } catch (_) {}
      }
      return true;
    }

    setMuted(muted) {
      this.muted = !!muted;
      if (this.masterGain && this.ctx) {
        this.masterGain.gain.setValueAtTime(
          this.muted ? 0 : this.masterVolume,
          this.ctx.currentTime
        );
      }
    }

    isMuted() {
      return this.muted;
    }

    setWalkStyle(style) {
      const valid = style === "mario83" || style === "mario83_low" || style === "retro_step" || style === "off";
      this.walkStyle = valid ? style : "mario83";
    }

    initWaveTables() {
      if (!this.ctx) return;
      this.pulseWaves[0.125] = this.createPulseWave(0.125);
      this.pulseWaves[0.25] = this.createPulseWave(0.25);
      this.pulseWaves[0.5] = this.createPulseWave(0.5);
      this.triWave = this.createNesTriangleWave();
      this.noiseLongBuf = this.createLfsrNoiseBuffer(false, 32768);
      this.noiseShortBuf = this.createLfsrNoiseBuffer(true, 16384);
    }

    // デューティ比（12.5% / 25% / 50%）矩形波の生成
    createPulseWave(duty) {
      const harmonics = 32;
      const real = new Float32Array(harmonics + 1);
      const imag = new Float32Array(harmonics + 1);
      for (let n = 1; n <= harmonics; n++) {
        const k = 2 / (Math.PI * n);
        real[n] = k * Math.sin(2 * Math.PI * n * duty);
        imag[n] = k * (1 - Math.cos(2 * Math.PI * n * duty));
      }
      return this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    }

    // 2A03風 32段階量子化三角波の生成
    createNesTriangleWave() {
      const len = 32;
      const steps = new Float32Array(len);
      for (let i = 0; i < 16; i++) {
        steps[i] = (i / 15) * 2 - 1;
      }
      for (let i = 16; i < 32; i++) {
        steps[i] = ((31 - i) / 15) * 2 - 1;
      }
      const harmonics = 24;
      const real = new Float32Array(harmonics + 1);
      const imag = new Float32Array(harmonics + 1);
      for (let k = 1; k <= harmonics; k++) {
        let re = 0;
        let im = 0;
        for (let i = 0; i < len; i++) {
          const angle = (2 * Math.PI * k * i) / len;
          re += steps[i] * Math.cos(angle);
          im += steps[i] * Math.sin(angle);
        }
        real[k] = (2 / len) * re;
        imag[k] = (2 / len) * im;
      }
      return this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    }

    // 2A03風 15-bit LFSR 疑似ノイズバッファ生成
    createLfsrNoiseBuffer(shortMode, length) {
      const rate = 22050;
      const buf = this.ctx.createBuffer(1, length, rate);
      const data = buf.getChannelData(0);
      let reg = 1;
      const tapShift = shortMode ? 6 : 1;
      for (let i = 0; i < length; i++) {
        const bit = (reg & 1) ^ ((reg >> tapShift) & 1);
        reg = (reg >> 1) | (bit << 14);
        data[i] = (reg & 1) ? 0.9 : -0.9;
      }
      return buf;
    }

    canTrigger(key, minGapMs) {
      const now = (root.performance && typeof root.performance.now === "function")
        ? root.performance.now()
        : Date.now();
      const prev = this.lastPlayTime[key] || 0;
      if (now - prev < minGapMs) return false;
      this.lastPlayTime[key] = now;
      return true;
    }

    // 1チャンネル単音／周波数スイープ／段階ステップ再生
    playTone(opts) {
      const ctx = this.ctx;
      if (!ctx || this.muted || ctx.state !== "running") return;

      const start = opts.startTime != null ? opts.startTime : ctx.currentTime;
      const dur = Math.max(0.012, opts.dur || 0.06);
      const vol = opts.vol != null ? opts.vol : 0.18;
      const attack = opts.attack != null ? opts.attack : 0.002;
      const holdRatio = opts.holdRatio != null ? opts.holdRatio : 0.25;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      if (opts.wave === "tri" && this.triWave) {
        osc.setPeriodicWave(this.triWave);
      } else if (opts.duty && this.pulseWaves[opts.duty]) {
        osc.setPeriodicWave(this.pulseWaves[opts.duty]);
      } else {
        osc.type = opts.wave === "tri" ? "triangle" : "square";
      }

      const fStart = Math.max(30, opts.freq || 440);
      osc.frequency.setValueAtTime(fStart, start);

      if (Array.isArray(opts.steps) && opts.steps.length > 0) {
        // ステップごとの音程切替（アルペジオ・ファミコン風高速変化）
        const stepDur = dur / opts.steps.length;
        for (let i = 0; i < opts.steps.length; i++) {
          osc.frequency.setValueAtTime(Math.max(30, opts.steps[i]), start + stepDur * i);
        }
      } else if (opts.freqEnd != null) {
        if (opts.stepSweep) {
          // 60Hzフレーム刻み風スイープ
          const nSteps = Math.max(2, Math.round(dur * 60));
          for (let i = 1; i <= nSteps; i++) {
            const t = i / nSteps;
            const f = opts.expSweep
              ? fStart * Math.pow(opts.freqEnd / fStart, t)
              : fStart + (opts.freqEnd - fStart) * t;
            osc.frequency.setValueAtTime(Math.max(30, f), start + (dur * i) / nSteps);
          }
        } else {
          osc.frequency.linearRampToValueAtTime(Math.max(30, opts.freqEnd), start + dur);
        }
      }

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(vol, start + Math.min(attack, dur * 0.4));
      const holdTime = start + Math.max(attack, dur * holdRatio);
      gain.gain.setValueAtTime(vol, holdTime);
      if (opts.cutEnd) {
        gain.gain.setValueAtTime(vol * 0.85, start + Math.max(0.006, dur - 0.004));
        gain.gain.linearRampToValueAtTime(0.0001, start + dur);
      } else {
        gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      }

      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(start);
      osc.stop(start + dur + 0.015);
    }

    // 疑似ノイズ再生（打撃・破壊・爆発・ジェット炎）
    playNoise(opts) {
      const ctx = this.ctx;
      if (!ctx || this.muted || ctx.state !== "running") return;
      const buf = opts.short ? this.noiseShortBuf : this.noiseLongBuf;
      if (!buf) return;

      const start = opts.startTime != null ? opts.startTime : ctx.currentTime;
      const dur = Math.max(0.015, opts.dur || 0.12);
      const vol = opts.vol != null ? opts.vol : 0.22;
      const rateStart = Math.max(0.03, opts.rate || 0.5);

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.setValueAtTime(rateStart, start);

      if (opts.rateEnd != null) {
        src.playbackRate.linearRampToValueAtTime(Math.max(0.03, opts.rateEnd), start + dur);
      }

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.linearRampToValueAtTime(vol, start + 0.003);
      if (opts.holdRatio != null && opts.holdRatio > 0) {
        gain.gain.setValueAtTime(vol, start + dur * opts.holdRatio);
      }
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);

      src.connect(gain);
      gain.connect(this.masterGain);
      src.start(start, Math.random() * 0.2);
      src.stop(start + dur + 0.02);
    }

    // 音名（MIDIノート番号風の簡易指定または配列フレーズ）再生ヘルパ
    playSequence(notes, opt = {}) {
      const ctx = this.ctx;
      if (!ctx || this.muted || ctx.state !== "running") return;
      let t = opt.startTime != null ? opt.startTime : ctx.currentTime;
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        const d = n.dur || 0.1;
        if (n.freq && n.freq > 0) {
          this.playTone({
            startTime: t,
            dur: n.gate != null ? n.gate : d * 0.88,
            freq: n.freq,
            freqEnd: n.freqEnd,
            wave: n.wave || opt.wave || "pulse",
            duty: n.duty || opt.duty || 0.25,
            vol: n.vol != null ? n.vol : (opt.vol != null ? opt.vol : 0.18),
            holdRatio: n.holdRatio != null ? n.holdRatio : 0.45,
            stepSweep: !!n.stepSweep
          });
        }
        t += d;
      }
    }

    // 効果音ディスパッチ
    play(name, opt = {}) {
      if (this.muted) return;
      const ctx = this.ensureContext();
      if (!ctx || ctx.state !== "running") return;

      const t = ctx.currentTime;

      switch (name) {
        case "walk": {
          if (this.walkStyle === "off") return;
          if (!this.canTrigger("walk", 65)) return;
          const alt = (this.walkAlt++) & 1;
          if (this.walkStyle === "mario83") {
            // 初代マリオブラザーズ風：1歩ごとに短く上下する極小アルペジオ（25%矩形波＋低音補助）
            const seq = alt === 0 ? [220, 294, 247] : [247, 330, 262];
            this.playTone({
              startTime: t,
              dur: 0.058,
              steps: seq,
              duty: 0.25,
              vol: 0.075,
              holdRatio: 0.65,
              cutEnd: true
            });
            this.playTone({
              startTime: t,
              dur: 0.052,
              steps: [seq[0] * 0.5, seq[1] * 0.5],
              wave: "tri",
              vol: 0.07,
              holdRatio: 0.6,
              cutEnd: true
            });
          } else if (this.walkStyle === "mario83_low") {
            // 丸み重視：三角波のみの控えめ極小アルペジオ
            const seq = alt === 0 ? [175, 233, 196] : [196, 262, 220];
            this.playTone({
              startTime: t,
              dur: 0.06,
              steps: seq,
              wave: "tri",
              vol: 0.13,
              holdRatio: 0.7,
              cutEnd: true
            });
          } else {
            // シンプル短パルス
            this.playTone({
              startTime: t,
              dur: 0.028,
              freq: alt === 0 ? 160 : 190,
              freqEnd: 95,
              wave: "tri",
              vol: 0.11,
              stepSweep: true
            });
          }
          break;
        }

        case "ladder": {
          if (!this.canTrigger("ladder", 45)) return;
          const stepAlt = (this.ladderAlt++) & 1;
          const up = opt.up !== false;
          const base = up ? (stepAlt ? 340 : 290) : (stepAlt ? 250 : 215);
          this.playTone({
            startTime: t,
            dur: 0.036,
            freq: base,
            freqEnd: base * (up ? 1.18 : 0.84),
            wave: "tri",
            vol: 0.13,
            stepSweep: true,
            cutEnd: true
          });
          break;
        }

        case "hammerSwing": {
          if (!this.canTrigger("hammerSwing", 70)) return;
          const dur = opt.golden ? 0.055 : 0.085;
          this.playNoise({
            startTime: t,
            dur,
            rate: 0.55,
            rateEnd: 0.18,
            vol: 0.14
          });
          this.playTone({
            startTime: t,
            dur: dur * 0.85,
            freq: opt.golden ? 420 : 290,
            freqEnd: 110,
            wave: "tri",
            vol: 0.14,
            stepSweep: true
          });
          break;
        }

        case "hammerHitWall": {
          if (!this.canTrigger("hammerHitWall", 45)) return;
          // まだ壊れない壁を叩いた時の硬質な「カンッ！」
          this.playTone({
            startTime: t,
            dur: 0.075,
            steps: [680, 520, 410],
            duty: 0.125,
            vol: 0.17,
            holdRatio: 0.4
          });
          this.playNoise({
            startTime: t,
            dur: 0.04,
            short: true,
            rate: 0.72,
            vol: 0.12
          });
          break;
        }

        case "wallBreak": {
          if (!this.canTrigger("wallBreak", 35)) return;
          // ガシャッ！と崩れる破壊音
          this.playNoise({
            startTime: t,
            dur: 0.19,
            rate: 0.68,
            rateEnd: 0.14,
            vol: 0.25,
            holdRatio: 0.2
          });
          this.playTone({
            startTime: t,
            dur: 0.14,
            freq: 210,
            freqEnd: 65,
            wave: "tri",
            vol: 0.22,
            stepSweep: true
          });
          break;
        }

        case "doorOpen": {
          if (!this.canTrigger("doorOpen", 50)) return;
          this.playTone({
            startTime: t,
            dur: 0.14,
            freq: 260,
            freqEnd: 660,
            duty: 0.125,
            vol: 0.15,
            stepSweep: true
          });
          this.playNoise({
            startTime: t + 0.02,
            dur: 0.07,
            short: true,
            rate: 0.45,
            vol: 0.08
          });
          break;
        }

        case "doorClose": {
          if (!this.canTrigger("doorClose", 60)) return;
          this.playTone({
            startTime: t,
            dur: 0.06,
            freq: 360,
            freqEnd: 170,
            duty: 0.25,
            vol: 0.08,
            stepSweep: true
          });
          break;
        }

        case "bombExplode": {
          if (!this.canTrigger("bombExplode", 55)) return;
          this.playNoise({
            startTime: t,
            dur: 0.42,
            rate: 0.48,
            rateEnd: 0.06,
            vol: 0.34,
            holdRatio: 0.28
          });
          this.playTone({
            startTime: t,
            dur: 0.34,
            freq: 155,
            freqEnd: 38,
            wave: "tri",
            vol: 0.28,
            stepSweep: true
          });
          break;
        }

        case "bombWave": {
          if (!this.canTrigger("bombWave", 40)) return;
          this.playNoise({
            startTime: t,
            dur: 0.09,
            rate: 0.38,
            rateEnd: 0.15,
            vol: 0.14
          });
          break;
        }

        case "timedBeep": {
          if (!this.canTrigger("timedBeep", 120)) return;
          this.playTone({
            startTime: t,
            dur: 0.05,
            freq: opt.urgent ? 1175 : 880,
            duty: 0.125,
            vol: 0.12,
            holdRatio: 0.55,
            cutEnd: true
          });
          break;
        }

        case "pillarFall": {
          if (!this.canTrigger("pillarFall", 60)) return;
          this.playTone({
            startTime: t,
            dur: 0.16,
            freq: 190,
            freqEnd: 58,
            wave: "tri",
            vol: 0.24,
            stepSweep: true
          });
          this.playNoise({
            startTime: t,
            dur: 0.12,
            rate: 0.34,
            rateEnd: 0.12,
            vol: 0.18
          });
          break;
        }

        case "drumTrap": {
          if (!this.canTrigger("drumTrap", 120)) return;
          this.playTone({
            startTime: t,
            dur: 0.22,
            steps: [310, 220, 145, 95],
            duty: 0.5,
            vol: 0.22
          });
          this.playNoise({
            startTime: t + 0.03,
            dur: 0.14,
            short: true,
            rate: 0.26,
            vol: 0.18
          });
          break;
        }

        case "knockdown": {
          if (!this.canTrigger("knockdown", 80)) return;
          this.playTone({
            startTime: t,
            dur: 0.22,
            freq: 540,
            freqEnd: 150,
            duty: 0.25,
            vol: 0.17,
            stepSweep: true
          });
          break;
        }

        case "stun": {
          if (!this.canTrigger("stun", 90)) return;
          this.playTone({
            startTime: t,
            dur: 0.11,
            freq: 145,
            freqEnd: 68,
            wave: "tri",
            vol: 0.21,
            stepSweep: true
          });
          this.playNoise({
            startTime: t,
            dur: 0.065,
            rate: 0.3,
            rateEnd: 0.12,
            vol: 0.12
          });
          break;
        }

        case "shoeJet": {
          if (!this.canTrigger("shoeJet", 75)) return;
          this.playNoise({
            startTime: t,
            dur: 0.07,
            rate: 0.35,
            rateEnd: 0.24,
            vol: 0.11
          });
          this.playTone({
            startTime: t,
            dur: 0.055,
            freq: 135,
            freqEnd: 115,
            wave: "tri",
            vol: 0.08
          });
          break;
        }

        case "keyPickup": {
          if (!this.canTrigger("keyPickup", 50)) return;
          this.playSequence(
            [
              { freq: 659, dur: 0.055 },
              { freq: 831, dur: 0.055 },
              { freq: 988, dur: 0.055 },
              { freq: 1319, dur: 0.11 }
            ],
            { startTime: t, duty: 0.125, vol: 0.17 }
          );
          break;
        }

        case "shoePodOpening": {
          if (!this.canTrigger("shoePodOpening", 200)) return;
          this.playSequence(
            [
              { freq: 392, dur: 0.07 },
              { freq: 494, dur: 0.07 },
              { freq: 587, dur: 0.07 },
              { freq: 784, dur: 0.07 },
              { freq: 988, dur: 0.09 },
              { freq: 1175, dur: 0.18 }
            ],
            { startTime: t, duty: 0.25, vol: 0.17 }
          );
          break;
        }

        case "shoePickup": {
          if (!this.canTrigger("shoePickup", 150)) return;
          this.playSequence(
            [
              { freq: 523, dur: 0.065 },
              { freq: 659, dur: 0.065 },
              { freq: 784, dur: 0.065 },
              { freq: 1047, dur: 0.07 },
              { freq: 784, dur: 0.065 },
              { freq: 1047, dur: 0.2 }
            ],
            { startTime: t, duty: 0.25, vol: 0.2 }
          );
          break;
        }

        case "enemyStun": {
          if (!this.canTrigger("enemyStun", 70)) return;
          this.playTone({
            startTime: t,
            dur: 0.12,
            steps: [620, 440, 560, 350],
            duty: 0.125,
            vol: 0.14
          });
          break;
        }

        case "orbSpawn": {
          if (!this.canTrigger("orbSpawn", 200)) return;
          this.playNoise({
            startTime: t,
            dur: 0.26,
            short: true,
            rate: 0.22,
            rateEnd: 0.52,
            vol: 0.1
          });
          this.playTone({
            startTime: t,
            dur: 0.26,
            freq: 180,
            freqEnd: 360,
            duty: 0.125,
            vol: 0.11,
            stepSweep: true
          });
          break;
        }

        case "start": {
          if (!this.canTrigger("start", 200)) return;
          this.playSequence(
            [
              { freq: 440, dur: 0.08 },
              { freq: 554, dur: 0.08 },
              { freq: 659, dur: 0.08 },
              { freq: 880, dur: 0.18 }
            ],
            { startTime: t, duty: 0.25, vol: 0.19 }
          );
          break;
        }

        case "clear": {
          if (!this.canTrigger("clear", 500)) return;
          // 1985年風クリアジングル（主旋律＋ベース）
          this.playSequence(
            [
              { freq: 523, dur: 0.11 },
              { freq: 659, dur: 0.11 },
              { freq: 784, dur: 0.11 },
              { freq: 1047, dur: 0.18 },
              { freq: 784, dur: 0.11 },
              { freq: 880, dur: 0.11 },
              { freq: 988, dur: 0.11 },
              { freq: 1047, dur: 0.42 }
            ],
            { startTime: t, duty: 0.25, vol: 0.2 }
          );
          this.playSequence(
            [
              { freq: 262, dur: 0.22 },
              { freq: 196, dur: 0.22 },
              { freq: 220, dur: 0.22 },
              { freq: 262, dur: 0.48 }
            ],
            { startTime: t, wave: "tri", vol: 0.22 }
          );
          break;
        }

        case "playerHitStop": {
          if (!this.canTrigger("playerHitStop", 200)) return;
          this.playTone({
            startTime: t,
            dur: 0.14,
            steps: [660, 494, 440],
            duty: 0.5,
            vol: 0.2
          });
          break;
        }

        case "playerDeathFall": {
          if (!this.canTrigger("playerDeathFall", 300)) return;
          this.playSequence(
            [
              { freq: 587, dur: 0.09 },
              { freq: 523, dur: 0.09 },
              { freq: 494, dur: 0.09 },
              { freq: 440, dur: 0.09 },
              { freq: 392, dur: 0.1 },
              { freq: 330, dur: 0.11 },
              { freq: 262, dur: 0.22, freqEnd: 131, stepSweep: true }
            ],
            { startTime: t, duty: 0.5, vol: 0.19 }
          );
          break;
        }

        case "tryAgain": {
          if (!this.canTrigger("tryAgain", 400)) return;
          // テンポ低下に合わせたコミカルで不穏な下降フレーズ
          this.playSequence(
            [
              { freq: 330, dur: 0.24 },
              { freq: 311, dur: 0.24 },
              { freq: 294, dur: 0.24 },
              { freq: 262, dur: 0.36 },
              { freq: 196, dur: 0.48, freqEnd: 147, stepSweep: true }
            ],
            { startTime: t, duty: 0.25, vol: 0.19 }
          );
          this.playSequence(
            [
              { freq: 165, dur: 0.48 },
              { freq: 147, dur: 0.48 },
              { freq: 131, dur: 0.6 }
            ],
            { startTime: t, wave: "tri", vol: 0.2 }
          );
          break;
        }

        case "battleScore": {
          if (!this.canTrigger("battleScore", 50)) return;
          this.playSequence(
            [
              { freq: 784, dur: 0.05 },
              { freq: 1047, dur: 0.09 }
            ],
            { startTime: t, duty: 0.125, vol: 0.14 }
          );
          break;
        }

        case "battleEnd": {
          if (!this.canTrigger("battleEnd", 300)) return;
          this.playSequence(
            [
              { freq: 880, dur: 0.12 },
              { freq: 659, dur: 0.12 },
              { freq: 880, dur: 0.24 }
            ],
            { startTime: t, duty: 0.5, vol: 0.2 }
          );
          break;
        }
      }
    }
  }

  const api = {
    SoundEngine
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.BreakerSound = Object.assign(root.BreakerSound || {}, api);
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
