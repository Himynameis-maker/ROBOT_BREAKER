(function (root) {
  "use strict";

  // 無音1フレームWAV（navigator.audioSession 非対応の古いiOS向けフォールバック用）
  const SILENT_WAV_DATA_URI =
    "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

  // 1985年ファミコン（2A03 APU）準拠 Web Audio ＋ jsfxr JSON対応 サウンドエンジン
  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.muted = false;
      this.unlocked = false;
      this.legacySilentPlayed = false;
      this.masterVolume = 0.45;
      this.walkStyle = "mario83"; // "mario83" | "mario83_low" | "retro_step" | "off"
      this.walkAlt = 0;
      this.ladderAlt = 0;

      this.pulseWaves = {};
      this.triWave = null;
      this.noiseLongBuf = null;
      this.noiseShortBuf = null;
      this.sfxrBuffers = Object.create(null);
      this.sfxrDefs = {
        // ご提供いただいた explosion.json の音色を維持し、リピート無しで最初の1回分(約0.19s)に調整した壁破壊音
        wallBreak: {
          oldParams: true,
          wave_type: 3,
          p_env_attack: 0,
          p_env_sustain: 0.18,
          p_env_punch: 0.61717314320954,
          p_env_decay: 0.23,
          p_base_freq: 0.19715295055935217,
          p_freq_limit: 0,
          p_freq_ramp: -0.39834637421169894,
          p_freq_dramp: 0,
          p_vib_strength: 0.23523885913846332,
          p_vib_speed: 0.25296493161772643,
          p_arp_mod: 0,
          p_arp_speed: 0,
          p_duty: 0,
          p_duty_ramp: 0,
          p_repeat_speed: 0,
          p_pha_offset: 0,
          p_pha_ramp: 0,
          p_lpf_freq: 1,
          p_lpf_ramp: 0,
          p_lpf_resonance: 0,
          p_hpf_freq: 0,
          p_hpf_ramp: 0,
          sound_vol: 0.25,
          sample_rate: 44100,
          sample_size: 8
        }
      };

      this.lastPlayTime = Object.create(null);
      this.resumePromise = null;
      this.interruptedSince = 0;
      this.resumeFailCount = 0;
      this.pendingQueue = [];
      this.lastKickAt = 0;
      this.onStateChangeCallback = null;

      this.ensurePlaybackSession();
    }

    nowMs() {
      return (root.performance && typeof root.performance.now === "function")
        ? root.performance.now()
        : Date.now();
    }

    // AudioContext生成「前」に audioSession.type を playback に設定（iOS マナーモード貫通・安定化）
    ensurePlaybackSession() {
      const nav = root.navigator;
      if (nav && nav.audioSession && "type" in nav.audioSession) {
        try {
          if (nav.audioSession.type !== "playback") {
            nav.audioSession.type = "playback";
          }
        } catch (_) {}
      }
    }

    getSessionType() {
      const nav = root.navigator;
      if (nav && nav.audioSession && nav.audioSession.type) {
        return nav.audioSession.type;
      }
      return "none";
    }

    getDebugState() {
      const ctxState = this.ctx ? this.ctx.state : "uninit";
      return "SND:" + ctxState + " ses:" + this.getSessionType() + (this.muted ? " [MUTE]" : " [ON]");
    }

    notifyStateChange() {
      if (typeof this.onStateChangeCallback === "function") {
        try {
          this.onStateChangeCallback();
        } catch (_) {}
      }
    }

    ensureContext() {
      this.ensurePlaybackSession();
      if (this.ctx && this.ctx.state !== "closed") {
        return this.ctx;
      }

      const AC = root.AudioContext || root.webkitAudioContext;
      if (!AC) return null;

      try {
        this.ctx = new AC();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = this.muted ? 0 : this.masterVolume;
        this.masterGain.connect(this.ctx.destination);
        this.initWaveTables();

        const handleStateChange = () => {
          if (!this.ctx) return;
          if (this.ctx.state === "running") {
            this.interruptedSince = 0;
            this.resumeFailCount = 0;
            this.unlocked = true;
            this.applyMasterGain();
            this.flushPendingQueue();
          } else {
            if (!this.interruptedSince) {
              this.interruptedSince = this.nowMs();
            }
          }
          this.notifyStateChange();
        };

        if (typeof this.ctx.addEventListener === "function") {
          this.ctx.addEventListener("statechange", handleStateChange);
        } else {
          this.ctx.onstatechange = handleStateChange;
        }

        if (this.ctx.state !== "running") {
          this.interruptedSince = this.nowMs();
        }
      } catch (_) {
        this.ctx = null;
        this.masterGain = null;
      }
      return this.ctx;
    }

    recoverContext() {
      if (this.ctx) {
        try {
          if (this.ctx.state !== "closed" && typeof this.ctx.close === "function") {
            this.ctx.close();
          }
        } catch (_) {}
      }
      this.ctx = null;
      this.masterGain = null;
      this.pulseWaves = {};
      this.triWave = null;
      this.noiseLongBuf = null;
      this.noiseShortBuf = null;
      this.sfxrBuffers = Object.create(null);
      this.unlocked = false;
      this.resumePromise = null;
      this.interruptedSince = 0;
      this.resumeFailCount = 0;
      return this.ensureContext();
    }

    applyMasterGain() {
      if (!this.masterGain || !this.ctx) return;
      const g = this.masterGain.gain;
      const target = this.muted ? 0 : this.masterVolume;
      try {
        if (typeof g.cancelScheduledValues === "function") {
          g.cancelScheduledValues(0);
        }
        g.value = target;
        g.setValueAtTime(target, this.ctx.currentTime);
      } catch (_) {
        try {
          g.value = target;
        } catch (_) {}
      }
    }

    kickSilentBuffer(ctx) {
      if (!ctx || !this.masterGain || ctx.state === "closed") return;
      const now = this.nowMs();
      if (this.unlocked && now - this.lastKickAt < 180) return;
      this.lastKickAt = now;
      try {
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.masterGain);
        src.start(0);
      } catch (_) {}
    }

    playLegacySilentFallback() {
      if (this.legacySilentPlayed) return;
      if (this.getSessionType() !== "none") return;
      if (typeof root.Audio !== "function") return;
      this.legacySilentPlayed = true;
      try {
        const a = new root.Audio(SILENT_WAV_DATA_URI);
        a.setAttribute("playsinline", "");
        a.volume = 0.01;
        const p = a.play();
        if (p && typeof p.catch === "function") {
          p.catch(() => {});
        }
      } catch (_) {}
    }

    tryResume() {
      const ctx = this.ensureContext();
      if (!ctx) return null;
      if (ctx.state === "running") {
        this.interruptedSince = 0;
        this.resumeFailCount = 0;
        this.unlocked = true;
        this.applyMasterGain();
        this.flushPendingQueue();
        return Promise.resolve();
      }
      if (this.resumePromise) {
        return this.resumePromise;
      }
      if (typeof ctx.resume !== "function") {
        return null;
      }

      try {
        const p = ctx.resume();
        if (p && typeof p.then === "function") {
          this.resumePromise = p.then(() => {
            this.resumePromise = null;
            if (this.ctx && this.ctx.state === "running") {
              this.interruptedSince = 0;
              this.resumeFailCount = 0;
              this.unlocked = true;
              this.applyMasterGain();
              this.flushPendingQueue();
            } else {
              this.resumeFailCount += 1;
            }
            this.notifyStateChange();
          }).catch(() => {
            this.resumePromise = null;
            this.resumeFailCount += 1;
            this.notifyStateChange();
          });
          return this.resumePromise;
        }
      } catch (_) {
        this.resumePromise = null;
        this.resumeFailCount += 1;
      }
      return null;
    }

    // iPhone Safari / モバイルブラウザ用のユーザー操作時サウンド解禁＆割り込み復帰
    unlock() {
      this.ensurePlaybackSession();
      this.playLegacySilentFallback();

      let ctx = this.ensureContext();
      if (!ctx) return false;

      if (ctx.state !== "running") {
        const stalledMs = this.interruptedSince ? (this.nowMs() - this.interruptedSince) : 0;
        if (this.resumeFailCount >= 2 && stalledMs > 600) {
          ctx = this.recoverContext();
          if (!ctx) return false;
        }
        this.kickSilentBuffer(ctx);
        this.tryResume();
      } else {
        if (!this.unlocked) {
          this.kickSilentBuffer(ctx);
          this.unlocked = true;
        }
        this.applyMasterGain();
        this.flushPendingQueue();
      }

      this.notifyStateChange();
      return true;
    }

    // ページ復帰・フォアグラウンド戻り時に自動再接続
    handleAppReturn() {
      this.ensurePlaybackSession();
      if (!this.ctx) return;
      if (this.ctx.state !== "running") {
        this.tryResume();
      }
      this.applyMasterGain();
      this.notifyStateChange();
    }

    setMuted(muted) {
      this.muted = !!muted;
      if (this.muted) {
        this.pendingQueue.length = 0;
      }
      this.applyMasterGain();
      if (!this.muted) {
        this.unlock();
      } else {
        this.notifyStateChange();
      }
    }

    isMuted() {
      return this.muted;
    }

    setWalkStyle(style) {
      const valid = style === "mario83" || style === "mario83_low" || style === "retro_step" || style === "off";
      this.walkStyle = valid ? style : "mario83";
    }

    registerJsfxr(name, jsonParams) {
      if (!name || !jsonParams) return;
      this.sfxrDefs[name] = jsonParams;
      if (this.ctx && this.ctx.state !== "closed") {
        this.sfxrBuffers[name] = this.renderJsfxrBuffer(jsonParams);
      }
    }

    initWaveTables() {
      if (!this.ctx) return;
      this.pulseWaves[0.125] = this.createPulseWave(0.125);
      this.pulseWaves[0.25] = this.createPulseWave(0.25);
      this.pulseWaves[0.5] = this.createPulseWave(0.5);
      this.triWave = this.createNesTriangleWave();
      this.noiseLongBuf = this.createLfsrNoiseBuffer(false, 32768);
      this.noiseShortBuf = this.createLfsrNoiseBuffer(true, 16384);

      const keys = Object.keys(this.sfxrDefs);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        this.sfxrBuffers[k] = this.renderJsfxrBuffer(this.sfxrDefs[k]);
      }
    }

    // jsfxr (sfxr.me) の JSON パラメータをそのまま AudioBuffer へ合成
    renderJsfxrBuffer(raw) {
      if (!this.ctx || !raw) return null;
      const ps = {
        wave_type: raw.wave_type != null ? raw.wave_type : 0,
        p_env_attack: raw.p_env_attack || 0,
        p_env_sustain: raw.p_env_sustain != null ? raw.p_env_sustain : 0.3,
        p_env_punch: raw.p_env_punch || 0,
        p_env_decay: raw.p_env_decay != null ? raw.p_env_decay : 0.4,
        p_base_freq: raw.p_base_freq != null ? raw.p_base_freq : 0.3,
        p_freq_limit: raw.p_freq_limit || 0,
        p_freq_ramp: raw.p_freq_ramp || 0,
        p_freq_dramp: raw.p_freq_dramp || 0,
        p_vib_strength: raw.p_vib_strength || 0,
        p_vib_speed: raw.p_vib_speed || 0,
        p_arp_mod: raw.p_arp_mod || 0,
        p_arp_speed: raw.p_arp_speed || 0,
        p_duty: raw.p_duty || 0,
        p_duty_ramp: raw.p_duty_ramp || 0,
        p_repeat_speed: raw.p_repeat_speed || 0,
        p_pha_offset: raw.p_pha_offset || 0,
        p_pha_ramp: raw.p_pha_ramp || 0,
        p_lpf_freq: raw.p_lpf_freq != null ? raw.p_lpf_freq : 1,
        p_lpf_ramp: raw.p_lpf_ramp || 0,
        p_lpf_resonance: raw.p_lpf_resonance || 0,
        p_hpf_freq: raw.p_hpf_freq || 0,
        p_hpf_ramp: raw.p_hpf_ramp || 0,
        sound_vol: raw.sound_vol != null ? raw.sound_vol : 0.25,
        sample_size: raw.sample_size || 8
      };

      const envLength = [
        Math.floor(ps.p_env_attack * ps.p_env_attack * 100000),
        Math.floor(ps.p_env_sustain * ps.p_env_sustain * 100000),
        Math.floor(ps.p_env_decay * ps.p_env_decay * 100000)
      ];
      let totalEst = envLength[0] + envLength[1] + envLength[2];
      if (totalEst <= 0) totalEst = 4410;
      const maxLen = Math.min(44100 * 4, totalEst + 64);
      const out = new Float32Array(maxLen);

      let fperiod = 0;
      let fmaxperiod = 0;
      let fslide = 0;
      let fdslide = 0;
      let period = 8;
      let squareDuty = 0.5;
      let squareSlide = 0;
      let fmult = 1;
      let arpTime = 0;
      let arpLimit = 0;

      const resetParams = () => {
        fperiod = 100.0 / (ps.p_base_freq * ps.p_base_freq + 0.001);
        fmaxperiod = 100.0 / (ps.p_freq_limit * ps.p_freq_limit + 0.001);
        fslide = 1.0 - Math.pow(ps.p_freq_ramp, 3) * 0.01;
        fdslide = -Math.pow(ps.p_freq_dramp, 3) * 0.000001;
        squareDuty = 0.5 - ps.p_duty * 0.5;
        squareSlide = -ps.p_duty_ramp * 0.00005;
        fmult = ps.p_arp_mod >= 0
          ? 1.0 - Math.pow(ps.p_arp_mod, 2) * 0.9
          : 1.0 + Math.pow(ps.p_arp_mod, 2) * 10.0;
        arpTime = 0;
        arpLimit = ps.p_arp_speed === 1.0
          ? 0
          : Math.floor(Math.pow(1.0 - ps.p_arp_speed, 2) * 20000 + 32);
      };

      resetParams();

      let fltp = 0;
      let fltdp = 0;
      let fltw = Math.pow(ps.p_lpf_freq, 3) * 0.1;
      const fltwD = 1.0 + ps.p_lpf_ramp * 0.0001;
      let fltdmp = 5.0 / (1.0 + Math.pow(ps.p_lpf_resonance, 2) * 20.0) * (0.01 + fltw);
      if (fltdmp > 0.8) fltdmp = 0.8;

      let fltphp = 0;
      let flthp = Math.pow(ps.p_hpf_freq, 2) * 0.1;
      const flthpD = 1.0 + ps.p_hpf_ramp * 0.0003;

      let vibPhase = 0;
      const vibSpeed = Math.pow(ps.p_vib_speed, 2) * 0.01;
      const vibAmp = ps.p_vib_strength * 0.5;

      let envStage = 0;
      while (envStage < 3 && envLength[envStage] <= 0) {
        envStage++;
      }
      let envTime = 0;
      let envVol = 0;

      let fphase = Math.pow(ps.p_pha_offset, 2) * 1020.0;
      if (ps.p_pha_offset < 0) fphase = -fphase;
      let fdphase = Math.pow(ps.p_pha_ramp, 2) * 1.0;
      if (ps.p_pha_ramp < 0) fdphase = -fdphase;
      let iphase = Math.abs(Math.floor(fphase));
      let ipp = 0;
      const phaserBuffer = new Float32Array(1024);

      const noiseBuffer = new Float32Array(32);
      for (let i = 0; i < 32; i++) {
        noiseBuffer[i] = Math.random() * 2.0 - 1.0;
      }

      let repTime = 0;
      const repLimit = ps.p_repeat_speed === 0
        ? 0
        : Math.floor(Math.pow(1.0 - ps.p_repeat_speed, 2) * 20000 + 32);

      let phase = 0;
      let written = 0;
      const gainScale = 2.0 * ps.sound_vol;

      for (let idx = 0; idx < maxLen; idx++) {
        if (envStage >= 3) break;

        repTime++;
        if (repLimit !== 0 && repTime >= repLimit) {
          repTime = 0;
          resetParams();
        }

        arpTime++;
        if (arpLimit !== 0 && arpTime >= arpLimit) {
          arpLimit = 0;
          fperiod *= fmult;
        }

        fslide += fdslide;
        fperiod *= fslide;
        if (fperiod > fmaxperiod) {
          fperiod = fmaxperiod;
          if (ps.p_freq_limit > 0) break;
        }

        let rfperiod = fperiod;
        if (vibAmp > 0) {
          vibPhase += vibSpeed;
          rfperiod = fperiod * (1.0 + Math.sin(vibPhase) * vibAmp);
        }

        period = Math.floor(rfperiod);
        if (period < 8) period = 8;

        squareDuty += squareSlide;
        if (squareDuty < 0) squareDuty = 0;
        if (squareDuty > 0.5) squareDuty = 0.5;

        envTime++;
        if (envTime > envLength[envStage]) {
          envTime = 0;
          envStage++;
          while (envStage < 3 && envLength[envStage] <= 0) {
            envStage++;
          }
          if (envStage >= 3) break;
        }

        if (envStage === 0) {
          envVol = envTime / envLength[0];
        } else if (envStage === 1) {
          envVol = 1.0 + (1.0 - envTime / envLength[1]) * 2.0 * ps.p_env_punch;
        } else {
          envVol = 1.0 - envTime / envLength[2];
        }

        fphase += fdphase;
        iphase = Math.abs(Math.floor(fphase));
        if (iphase > 1023) iphase = 1023;

        if (flthpD !== 0) {
          flthp *= flthpD;
          if (flthp < 0.00001) flthp = 0.00001;
          if (flthp > 0.1) flthp = 0.1;
        }

        let ssample = 0;
        for (let si = 0; si < 8; si++) {
          phase++;
          if (phase >= period) {
            phase %= period;
            if (ps.wave_type === 3) {
              for (let i = 0; i < 32; i++) {
                noiseBuffer[i] = Math.random() * 2.0 - 1.0;
              }
            }
          }

          const fp = phase / period;
          let sample = 0;
          if (ps.wave_type === 0) {
            sample = fp < squareDuty ? 0.5 : -0.5;
          } else if (ps.wave_type === 1) {
            sample = 1.0 - fp * 2.0;
          } else if (ps.wave_type === 2) {
            sample = Math.sin(fp * 2.0 * Math.PI);
          } else {
            sample = noiseBuffer[Math.floor((phase * 32) / period) & 31];
          }

          const pp = fltp;
          fltw *= fltwD;
          if (fltw < 0) fltw = 0;
          if (fltw > 0.1) fltw = 0.1;

          if (ps.p_lpf_freq !== 1.0) {
            fltdp += (sample - fltp) * fltw;
            fltdp -= fltdp * fltdmp;
          } else {
            fltp = sample;
            fltdp = 0;
          }
          fltp += fltdp;

          fltphp += fltp - pp;
          fltphp -= fltphp * flthp;
          sample = fltphp;

          phaserBuffer[ipp & 1023] = sample;
          sample += phaserBuffer[(ipp - iphase + 1024) & 1023];
          ipp = (ipp + 1) & 1023;

          ssample += sample * envVol;
        }

        let val = (ssample / 8.0) * gainScale;
        if (val > 1.0) val = 1.0;
        if (val < -1.0) val = -1.0;
        if (ps.sample_size === 8) {
          val = Math.round(val * 127) / 127;
        }
        out[idx] = val;
        written = idx + 1;
      }

      if (written <= 0) written = 1;
      const fadeSamples = Math.min(32, written);
      for (let i = 0; i < fadeSamples; i++) {
        out[written - 1 - i] *= i / fadeSamples;
      }

      const buf = this.ctx.createBuffer(1, written, 44100);
      buf.getChannelData(0).set(out.subarray(0, written));
      return buf;
    }

    playSfxr(name, volScale = 1.0) {
      const ctx = this.ctx;
      if (!ctx || this.muted || ctx.state !== "running") return false;
      let buf = this.sfxrBuffers[name];
      if (!buf && this.sfxrDefs[name]) {
        buf = this.renderJsfxrBuffer(this.sfxrDefs[name]);
        this.sfxrBuffers[name] = buf;
      }
      if (!buf) return false;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      gain.gain.value = volScale;
      src.connect(gain);
      gain.connect(this.masterGain);
      src.start(ctx.currentTime);
      return true;
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
      const now = this.nowMs();
      const prev = this.lastPlayTime[key] || 0;
      if (now - prev < minGapMs) return false;
      this.lastPlayTime[key] = now;
      return true;
    }

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
        const stepDur = dur / opts.steps.length;
        for (let i = 0; i < opts.steps.length; i++) {
          osc.frequency.setValueAtTime(Math.max(30, opts.steps[i]), start + stepDur * i);
        }
      } else if (opts.freqEnd != null) {
        if (opts.stepSweep) {
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

    queuePendingSound(name, opt) {
      if (name === "walk" || name === "ladder" || name === "shoeJet" || name === "bombWave") {
        return;
      }
      const now = this.nowMs();
      if (this.pendingQueue.length >= 4) {
        this.pendingQueue.shift();
      }
      this.pendingQueue.push({ name, opt, at: now });
    }

    flushPendingQueue() {
      if (this.muted || !this.ctx || this.ctx.state !== "running") return;
      if (this.pendingQueue.length === 0) return;
      const items = this.pendingQueue.splice(0, this.pendingQueue.length);
      const now = this.nowMs();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (now - item.at <= 220) {
          this.playNow(item.name, item.opt || {});
        }
      }
    }

    play(name, opt = {}) {
      if (this.muted) return;
      const ctx = this.ensureContext();
      if (!ctx) return;

      if (ctx.state !== "running") {
        this.queuePendingSound(name, opt);
        this.tryResume();
        return;
      }

      this.playNow(name, opt);
    }

    playNow(name, opt = {}) {
      const ctx = this.ctx;
      if (this.muted || !ctx || ctx.state !== "running") return;

      const t = ctx.currentTime;

      switch (name) {
        case "walk": {
          if (this.walkStyle === "off") return;
          if (!this.canTrigger("walk", 65)) return;
          const alt = (this.walkAlt++) & 1;
          if (this.walkStyle === "mario83") {
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
          this.playSfxr("wallBreak", 0.75);
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
