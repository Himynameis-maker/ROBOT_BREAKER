(function (root) {
  "use strict";

  // 無音1フレームWAV（navigator.audioSession 非対応の古いiOS向けフォールバック用）
  const SILENT_WAV_DATA_URI =
    "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

  // FC-SFX 1985 準拠 定数
  const FC_NOISE_PERIODS = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
  const FC_TRI_TABLE = [
    15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15
  ];
  const FC_DUTIES = [0.125, 0.25, 0.5];

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  // FC-SFX 1985 準拠（60Hzステップ / 4bit量子化 / 2A03三角波＆ノイズ）＋ wallBreak(jsfxr) 残置対応エンジン
  class SoundEngine {
    constructor() {
      this.ctx = null;
      this.masterGain = null;
      this.muted = false;
      this.unlocked = false;
      this.legacySilentPlayed = false;
      this.masterVolume = 0.45;
      this.walkStyle = "on";
      this.walkAlt = 0;

      this.fcSfxBuffers = Object.create(null);
      this.fcSfxOptions = {
        walkLow: { minGapMs: 65, volScale: 0.6 },
        walkHigh: { minGapMs: 65, volScale: 0.6 }
      };

      // FC-SFX 1985 で作成した JSON レシピをここに追加していく
      this.fcSfxDefs = {
        // 「カーソル / 選択 #722」ベース：三角波で柔らかめにし、低い音・高い音の2音を作成
        walkLow: {
          id: "sfx_walk_from_722_low",
          category: "blip",
          label: "足音・低（#722 柔らかめ）",
          duration: 0.08170532557294849,
          loopable: false,
          masterGain: 1,
          pitchSemi: -10,
          speedScale: 0.9,
          toneShift: 0,
          gainScale: 0.7,
          channels: [
            {
              type: "triangle",
              duty: 0.5,
              gain: 0.9,
              baseFreq: 1054.5900780774218,
              endFreq: 1429.3560019829115,
              slideCurve: 1,
              vibratoDepth: 0,
              vibratoSpeed: 0,
              steps: null,
              stepFrames: 2,
              stepLoop: false,
              stepSlidePerLoop: 1,
              attackFrames: 0,
              sustainFrames: 2,
              decayFrames: 2,
              quantize4bit: false,
              delayFrames: 0
            }
          ]
        },
        walkHigh: {
          id: "sfx_walk_from_722_high",
          category: "blip",
          label: "足音・高（#722 柔らかめ）",
          duration: 0.08170532557294849,
          loopable: false,
          masterGain: 1,
          pitchSemi: -6,
          speedScale: 0.9,
          toneShift: 0,
          gainScale: 0.7,
          channels: [
            {
              type: "triangle",
              duty: 0.5,
              gain: 0.9,
              baseFreq: 1054.5900780774218,
              endFreq: 1429.3560019829115,
              slideCurve: 1,
              vibratoDepth: 0,
              vibratoSpeed: 0,
              steps: null,
              stepFrames: 2,
              stepLoop: false,
              stepSlidePerLoop: 1,
              attackFrames: 0,
              sustainFrames: 2,
              decayFrames: 2,
              quantize4bit: false,
              delayFrames: 0
            }
          ]
        }
      };

      // 従来の explosion.json（wallBreak のみ残置）
      this.sfxrBuffers = Object.create(null);
      this.sfxrDefs = {
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
        this.rebuildBuffers();

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
      this.fcSfxBuffers = Object.create(null);
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
      this.walkStyle = style === "off" ? "off" : "on";
    }

    // FC-SFX 1985 の JSON レシピを登録（任意SEの差し替え・追加用）
    registerFcSfx(name, recipeJson, opts = null) {
      if (!name || !recipeJson) return;
      this.fcSfxDefs[name] = recipeJson;
      if (opts && typeof opts === "object") {
        this.fcSfxOptions[name] = opts;
      }
      if (this.ctx && this.ctx.state !== "closed") {
        this.fcSfxBuffers[name] = this.renderFcSfxBuffer(recipeJson);
      }
    }

    registerJsfxr(name, jsonParams) {
      if (!name || !jsonParams) return;
      this.sfxrDefs[name] = jsonParams;
      if (this.ctx && this.ctx.state !== "closed") {
        this.sfxrBuffers[name] = this.renderJsfxrBuffer(jsonParams);
      }
    }

    rebuildBuffers() {
      if (!this.ctx) return;

      const fcKeys = Object.keys(this.fcSfxDefs);
      for (let i = 0; i < fcKeys.length; i++) {
        const k = fcKeys[i];
        this.fcSfxBuffers[k] = this.renderFcSfxBuffer(this.fcSfxDefs[k]);
      }

      const sfxrKeys = Object.keys(this.sfxrDefs);
      for (let i = 0; i < sfxrKeys.length; i++) {
        const k = sfxrKeys[i];
        this.sfxrBuffers[k] = this.renderJsfxrBuffer(this.sfxrDefs[k]);
      }
    }

    // FC-SFX 1985 の synthesizePCM と完全同等の合成アルゴリズム
    synthesizeFcSfxPCM(recipe, sampleRate, authenticMode = true, forceDurationSec = null) {
      if (!recipe || !Array.isArray(recipe.channels) || recipe.channels.length === 0) {
        return null;
      }

      const pitchMul = Math.pow(2, (recipe.pitchSemi || 0) / 12);
      const speedMul = recipe.speedScale || 1.0;
      const toneShift = recipe.toneShift || 0;
      const gainMul = (recipe.gainScale || 1.0) * (recipe.masterGain || 1.0);

      const dur = clamp((forceDurationSec || recipe.duration) * speedMul, 0.04, 3.2);
      const totalSamples = Math.max(1, Math.floor(dur * sampleRate));
      const out = new Float32Array(totalSamples);

      const OS = 2;
      const osRate = sampleRate * OS;
      const frameSamples = authenticMode ? (osRate / 60) : (osRate / 240);
      const frameScale = speedMul;

      for (let c = 0; c < recipe.channels.length; c++) {
        const ch = recipe.channels[c];
        let duty = ch.duty || 0.25;
        if (ch.type === "pulse" && toneShift !== 0) {
          let idx = FC_DUTIES.indexOf(duty);
          if (idx === -1) idx = 1;
          idx = clamp(idx + Math.sign(toneShift), 0, FC_DUTIES.length - 1);
          duty = FC_DUTIES[idx];
        }
        const noiseShort = ch.type === "noise" && toneShift <= -2 ? true :
                           ch.type === "noise" && toneShift >= 2 ? false :
                           (ch.noiseMode === "short");

        const delaySamples = Math.round((ch.delayFrames || 0) * frameScale * (osRate / 60));
        const atkF = Math.max(0, (ch.attackFrames || 0) * frameScale);
        const susF = Math.max(0, (ch.sustainFrames || 0) * frameScale);
        const decF = Math.max(1, (ch.decayFrames || 1) * frameScale);
        const stepF = Math.max(1, Math.round((ch.stepFrames || 1) * frameScale));

        let phase = 0;
        let lfsr = 1;
        let noiseAcc = 0;
        let noiseOut = 1;
        let prevFrameIdx = -1;

        let curFreq = ch.baseFreq;
        let curEnv = 1.0;

        const chBuf = new Float32Array(totalSamples);

        for (let i = 0; i < totalSamples; i++) {
          let accSample = 0;

          for (let o = 0; o < OS; o++) {
            const osIdx = i * OS + o;
            if (osIdx < delaySamples) continue;

            const activeOsIdx = osIdx - delaySamples;
            const activeSec = activeOsIdx / osRate;
            const exactFrame = activeOsIdx / (osRate / 60);
            const frameIdx = authenticMode ? Math.floor(exactFrame) : Math.floor(activeOsIdx / frameSamples);

            if (frameIdx !== prevFrameIdx || ch.smoothSlide || !authenticMode) {
              prevFrameIdx = frameIdx;
              const totalEnvFrames = Math.max(1, atkF + susF + decF);
              const fPos = authenticMode ? frameIdx : exactFrame;

              let env = 0;
              if (fPos < atkF) {
                env = atkF > 0 ? fPos / atkF : 1;
              } else if (fPos < atkF + susF) {
                env = 1.0;
              } else {
                const dPos = fPos - (atkF + susF);
                env = Math.max(0, 1.0 - dPos / decF);
              }
              if (authenticMode && ch.quantize4bit) {
                env = Math.round(env * 15) / 15;
              }
              curEnv = env;

              const progress = clamp(fPos / totalEnvFrames, 0, 1);
              const curved = Math.pow(progress, ch.slideCurve || 1);

              if (ch.type === "noise") {
                let nIdx = ch.baseFreq + (ch.endFreq - ch.baseFreq) * curved;
                if (toneShift !== 0) nIdx += toneShift * 1.5;
                if (ch.vibratoDepth > 0) {
                  nIdx += Math.sin(activeSec * ch.vibratoSpeed * Math.PI * 2) * (ch.vibratoDepth * 10);
                }
                curFreq = clamp(Math.round(nIdx), 0, 15);
              } else {
                let freq = ch.baseFreq + (ch.endFreq - ch.baseFreq) * curved;
                if (ch.steps && ch.steps.length > 0) {
                  const rawStep = Math.floor(fPos / stepF);
                  const loopCount = Math.floor(rawStep / ch.steps.length);
                  const sIdx = ch.stepLoop
                    ? rawStep % ch.steps.length
                    : Math.min(rawStep, ch.steps.length - 1);
                  freq = ch.baseFreq * ch.steps[sIdx];
                  if (ch.stepLoop && ch.stepSlidePerLoop && ch.stepSlidePerLoop !== 1) {
                    freq *= Math.pow(ch.stepSlidePerLoop, loopCount);
                  }
                }
                if (ch.vibratoDepth > 0) {
                  freq *= 1 + Math.sin(activeSec * ch.vibratoSpeed * Math.PI * 2) * ch.vibratoDepth;
                }
                curFreq = clamp(freq * pitchMul, 25, 11000);
              }
            }

            if (curEnv <= 0.001) continue;

            let sample = 0;
            if (ch.type === "pulse") {
              sample = phase < duty ? 1.0 : -1.0;
              phase += curFreq / osRate;
              if (phase >= 1.0) phase -= Math.floor(phase);
            } else if (ch.type === "triangle") {
              const triIdx = Math.floor(phase * 32) & 31;
              sample = (FC_TRI_TABLE[triIdx] / 7.5) - 1.0;
              phase += curFreq / osRate;
              if (phase >= 1.0) phase -= Math.floor(phase);
            } else if (ch.type === "noise") {
              const period = FC_NOISE_PERIODS[curFreq | 0];
              noiseAcc += 1789773 / osRate;
              while (noiseAcc >= period) {
                noiseAcc -= period;
                const tap = noiseShort ? 6 : 1;
                const fb = (lfsr & 1) ^ ((lfsr >> tap) & 1);
                lfsr = (lfsr >> 1) | (fb << 14);
                if (lfsr === 0) lfsr = 1;
                noiseOut = (lfsr & 1) ? 1.0 : -1.0;
              }
              sample = noiseOut;
            }

            accSample += sample * curEnv * (ch.gain || 1.0);
          }

          chBuf[i] = accSample / OS;
        }

        for (let i = 0; i < totalSamples; i++) {
          out[i] += chBuf[i];
        }
      }

      let prevX = 0;
      let prevY = 0;
      const fadeLen = Math.min(Math.floor(sampleRate * 0.008), Math.floor(totalSamples * 0.15));

      for (let i = 0; i < totalSamples; i++) {
        const x = out[i] * 0.45 * gainMul;
        const y = x - prevX + 0.996 * prevY;
        prevX = x;
        prevY = y;

        let s = Math.tanh(y * 1.15);
        if (fadeLen > 0 && i > totalSamples - fadeLen) {
          s *= (totalSamples - i) / fadeLen;
        }
        out[i] = clamp(s, -0.98, 0.98);
      }

      return out;
    }

    renderFcSfxBuffer(recipe) {
      if (!this.ctx || !recipe) return null;
      const sampleRate = this.ctx.sampleRate || 44100;
      const authenticMode = recipe.authentic !== false;
      const pcm = this.synthesizeFcSfxPCM(recipe, sampleRate, authenticMode);
      if (!pcm) return null;
      const buf = this.ctx.createBuffer(1, pcm.length, sampleRate);
      buf.getChannelData(0).set(pcm);
      return buf;
    }

    playFcSfx(name, volScale = 1.0) {
      const ctx = this.ctx;
      if (!ctx || this.muted || ctx.state !== "running") return false;
      let buf = this.fcSfxBuffers[name];
      if (!buf && this.fcSfxDefs[name]) {
        buf = this.renderFcSfxBuffer(this.fcSfxDefs[name]);
        this.fcSfxBuffers[name] = buf;
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

    // wallBreak (explosion.json) 用の jsfxr デコーダ
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

    canTrigger(key, minGapMs) {
      const now = this.nowMs();
      const prev = this.lastPlayTime[key] || 0;
      if (now - prev < minGapMs) return false;
      this.lastPlayTime[key] = now;
      return true;
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

      if (name === "walk") {
        if (this.walkStyle === "off") return;
        if (!this.canTrigger("walk", 65)) return;
        const key = ((this.walkAlt++) & 1) === 0 ? "walkLow" : "walkHigh";
        const meta = this.fcSfxOptions[key] || {};
        const vol = opt.volScale != null ? opt.volScale : (meta.volScale != null ? meta.volScale : 0.6);
        this.playFcSfx(key, vol);
        return;
      }

      if (this.fcSfxDefs[name]) {
        const meta = this.fcSfxOptions[name] || {};
        const gap = meta.minGapMs != null ? meta.minGapMs : 40;
        const vol = opt.volScale != null ? opt.volScale : (meta.volScale != null ? meta.volScale : 0.85);
        if (!this.canTrigger(name, gap)) return;
        this.playFcSfx(name, vol);
        return;
      }

      if (this.sfxrDefs[name]) {
        const gap = name === "wallBreak" ? 35 : 40;
        const vol = opt.volScale != null ? opt.volScale : 0.75;
        if (!this.canTrigger(name, gap)) return;
        this.playSfxr(name, vol);
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
