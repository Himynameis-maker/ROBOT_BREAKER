(function (global) {
  "use strict";

  var STEPS_PER_BAR = 16;
  var NOTE_REST = 0;
  var NOTE_HOLD = -1;

  var NOTE_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
  var DOREMI_NAMES = ["ド", "ド#", "レ", "ミb", "ミ", "ファ", "ファ#", "ソ", "ラb", "ラ", "シb", "シ"];

  var CHORD_QUALITIES = {
    "":     [0, 4, 7],
    "m":    [0, 3, 7],
    "7":    [0, 4, 7, 10],
    "m7":   [0, 3, 7, 10],
    "M7":   [0, 4, 7, 11],
    "sus4": [0, 5, 7],
    "dim":  [0, 3, 6],
    "m7b5": [0, 3, 6, 10],
    "aug":  [0, 4, 8]
  };

  var STYLES = [
    { id: "scifi",   label: "宇宙SF",       desc: "ピコピコ16分アルペジオ＋オクターブベース" },
    { id: "hero",    label: "王道レトロ",   desc: "元気な8ビート＋定番ファミコン伴奏" },
    { id: "battle",  label: "バトル疾走",   desc: "速い16分刻みベース＋手数多めドラム" },
    { id: "fanfare", label: "ファンファーレ", desc: "開幕・クリア向けの華やか和音＋スネア" },
    { id: "mystery", label: "潜入・緊迫",   desc: "隙間を活かした緊迫ベース＋高音パルス" }
  ];

  var SCALE_MAJOR = [1.4, -1.5, 1.0, -1.5, 1.1, 0.9, -1.5, 1.3, -1.2, 1.0, -0.8, 0.9];
  var SCALE_MINOR = [1.4, -1.5, 1.0, 1.1, -1.2, 1.0, -1.5, 1.3, 1.0, -1.0, 0.9, 0.7];

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  function midiToName(midi) {
    if (!midi || midi <= 0) return "---";
    var pc = ((midi % 12) + 12) % 12;
    var oct = Math.floor(midi / 12) - 1;
    return NOTE_NAMES[pc] + oct;
  }

  function midiToDoremi(midi) {
    if (!midi || midi <= 0) return "";
    return DOREMI_NAMES[((midi % 12) + 12) % 12];
  }

  function parseChordName(name) {
    if (!name || name === "AUTO") return null;
    var m = String(name).trim().match(/^([A-G])([#b]?)(.*)$/);
    if (!m) return null;
    var baseMap = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    var rootPc = baseMap[m[1]];
    if (m[2] === "#") rootPc = (rootPc + 1) % 12;
    else if (m[2] === "b") rootPc = (rootPc + 11) % 12;
    var q = m[3] || "";
    var intervals = CHORD_QUALITIES[q] || CHORD_QUALITIES[""];
    var pcs = intervals.map(function (iv) { return (rootPc + iv) % 12; });
    return {
      name: NOTE_NAMES[rootPc] + q,
      rootPc: rootPc,
      quality: q,
      intervals: intervals,
      pcs: pcs
    };
  }

  function makeChordName(rootPc, quality) {
    return NOTE_NAMES[((rootPc % 12) + 12) % 12] + (quality || "");
  }

  function expandMelodyNotes(melody, totalSteps) {
    var out = new Array(totalSteps);
    var cur = 0;
    for (var i = 0; i < totalSteps; i++) {
      var v = (melody && i < melody.length) ? melody[i] : 0;
      if (v > 0) {
        cur = v;
        out[i] = cur;
      } else if (v === NOTE_HOLD) {
        out[i] = cur > 0 ? cur : 0;
      } else {
        cur = 0;
        out[i] = 0;
      }
    }
    return out;
  }

  function detectKey(song) {
    var modePref = song && song.mode ? song.mode : "auto";
    var introExp = expandMelodyNotes(song.introMelody || [], (song.introBars || 0) * STEPS_PER_BAR);
    var loopExp = expandMelodyNotes(song.loopMelody || [], (song.loopBars || 0) * STEPS_PER_BAR);
    var all = introExp.concat(loopExp);

    var pcWeights = new Array(12).fill(0);
    var firstPc = -1;
    var lastPc = -1;
    var totalWeight = 0;

    for (var i = 0; i < all.length; i++) {
      var midi = all[i];
      if (midi > 0) {
        var pc = midi % 12;
        if (firstPc < 0) firstPc = pc;
        lastPc = pc;
        var stepInBar = i % STEPS_PER_BAR;
        var w = (stepInBar === 0) ? 2.0 : ((stepInBar % 4 === 0) ? 1.4 : 0.8);
        pcWeights[pc] += w;
        totalWeight += w;
      }
    }

    if (totalWeight === 0) {
      var defMinor = (modePref === "minor") || (modePref === "auto" && (song.style === "scifi" || song.style === "battle" || song.style === "mystery"));
      return {
        rootPc: defMinor ? 9 : 0,
        isMinor: defMinor,
        name: defMinor ? "Am" : "C"
      };
    }

    var best = { score: -999999, rootPc: 0, isMinor: false };
    var flags = modePref === "major" ? [false] : (modePref === "minor" ? [true] : [false, true]);

    for (var m = 0; m < flags.length; m++) {
      var isMinor = flags[m];
      var tmpl = isMinor ? SCALE_MINOR : SCALE_MAJOR;
      for (var r = 0; r < 12; r++) {
        var score = 0;
        for (var pcIdx = 0; pcIdx < 12; pcIdx++) {
          score += pcWeights[pcIdx] * tmpl[(pcIdx - r + 12) % 12];
        }
        if (firstPc === r) score += 2.2;
        if (lastPc === r) score += 2.4;
        if (firstPc === (r + (isMinor ? 3 : 4)) % 12 || firstPc === (r + 7) % 12) score += 0.9;
        if (modePref === "auto") {
          if (isMinor && (song.style === "scifi" || song.style === "mystery" || song.style === "battle")) score += 0.6;
          if (!isMinor && (song.style === "hero" || song.style === "fanfare")) score += 0.6;
        }
        if (r === 0 || r === 9 || r === 7 || r === 4 || r === 2) score += 0.15;

        if (score > best.score) best = { score: score, rootPc: r, isMinor: isMinor };
      }
    }

    return {
      rootPc: best.rootPc,
      isMinor: best.isMinor,
      name: NOTE_NAMES[best.rootPc] + (best.isMinor ? "m" : "")
    };
  }

  function buildKeyChordPool(keyInfo) {
    var r = keyInfo.rootPc;
    var defs = keyInfo.isMinor ? [
      { deg: 0,  q: "m",    role: "tonic",  bias: 1.5 },
      { deg: 3,  q: "",     role: "tonic",  bias: 0.7 },
      { deg: 5,  q: "m",    role: "subdom", bias: 1.1 },
      { deg: 5,  q: "",     role: "subdom", bias: 0.4 },
      { deg: 7,  q: "m",    role: "dom",    bias: 0.6 },
      { deg: 7,  q: "7",    role: "dom7",   bias: 1.0 },
      { deg: 7,  q: "",     role: "dom",    bias: 0.8 },
      { deg: 8,  q: "",     role: "subdom", bias: 1.2 },
      { deg: 10, q: "",     role: "subdom", bias: 1.1 },
      { deg: 2,  q: "m7b5", role: "subdom", bias: 0.3 },
      { deg: 2,  q: "m",    role: "subdom", bias: 0.4 }
    ] : [
      { deg: 0,  q: "",     role: "tonic",  bias: 1.5 },
      { deg: 2,  q: "m",    role: "subdom", bias: 0.9 },
      { deg: 4,  q: "m",    role: "tonic",  bias: 0.8 },
      { deg: 4,  q: "7",    role: "sec",    bias: 0.2 },
      { deg: 5,  q: "",     role: "subdom", bias: 1.3 },
      { deg: 5,  q: "m",    role: "subdom", bias: 0.3 },
      { deg: 7,  q: "",     role: "dom",    bias: 1.2 },
      { deg: 7,  q: "7",    role: "dom7",   bias: 1.0 },
      { deg: 9,  q: "m",    role: "tonic",  bias: 1.2 },
      { deg: 8,  q: "",     role: "subdom", bias: 0.4 },
      { deg: 10, q: "",     role: "subdom", bias: 0.6 }
    ];
    return defs.map(function (d) {
      var parsed = parseChordName(makeChordName(r + d.deg, d.q));
      parsed.role = d.role;
      parsed.deg = d.deg;
      parsed.bias = d.bias;
      return parsed;
    });
  }

  function scoreChordForBar(chord, barExp, prevChord, barIndex, totalBars, resolveToTonicAtEnd) {
    var score = chord.bias;
    var hasNotes = false;

    for (var s = 0; s < STEPS_PER_BAR; s++) {
      var midi = barExp[s];
      if (!midi || midi <= 0) continue;
      hasNotes = true;
      var pc = midi % 12;
      var bw = (s === 0) ? 2.8 : ((s === 8) ? 2.1 : ((s % 4 === 0) ? 1.5 : 0.65));

      if (chord.pcs.indexOf(pc) >= 0) {
        score += bw * 2.4;
        if (pc === chord.rootPc) score += bw * 0.7;
        else if (pc === chord.pcs[1]) score += bw * 0.5;
      } else {
        var rel = (pc - chord.rootPc + 12) % 12;
        var clash = false;
        for (var ci = 0; ci < chord.intervals.length; ci++) {
          if ((rel - chord.intervals[ci] + 12) % 12 === 1) {
            clash = true;
            break;
          }
        }
        score += clash ? (-bw * 2.1) : (-bw * 0.15);
      }
    }

    if (!hasNotes) {
      var pos = barIndex % 4;
      if (pos === 0 && chord.deg === 0) score += 4.0;
      else if (pos === 1 && chord.role === "subdom") score += 2.6;
      else if (pos === 2 && (chord.role === "subdom" || chord.role === "tonic")) score += 2.2;
      else if (pos === 3 && (chord.role === "dom" || chord.role === "dom7")) score += 3.5;
    }

    if (barIndex === 0) {
      if (chord.deg === 0) score += 3.4;
      else if (chord.role === "subdom") score += 0.6;
    }
    if (totalBars >= 2 && barIndex === totalBars - 1) {
      if (resolveToTonicAtEnd) {
        if (chord.deg === 0) score += 4.2;
      } else {
        if (chord.role === "dom7" || chord.role === "dom") score += 4.2;
        else if (chord.deg === 10) score += 2.4;
      }
    }

    if (prevChord) {
      if (prevChord.name === chord.name) {
        score -= 2.4;
      } else {
        if (prevChord.role === "subdom" && (chord.role === "dom" || chord.role === "dom7")) score += 1.5;
        if ((prevChord.role === "dom" || prevChord.role === "dom7") && chord.deg === 0) score += 1.8;
        if (prevChord.deg === 8 && chord.deg === 10) score += 1.8;
        if (prevChord.deg === 10 && chord.deg === 0) score += 1.5;
      }
    }
    return score;
  }

  function resolveSectionChords(expMelody, manualChords, bars, keyInfo, isIntro, hasLoop) {
    var pool = buildKeyChordPool(keyInfo);
    var resolved = [];
    var candidatesPerBar = [];
    var prevChord = null;
    var resolveEnd = isIntro && !hasLoop;

    for (var b = 0; b < bars; b++) {
      var barExp = expMelody.slice(b * STEPS_PER_BAR, (b + 1) * STEPS_PER_BAR);
      var manual = (manualChords && manualChords[b] && manualChords[b] !== "AUTO") ? parseChordName(manualChords[b]) : null;

      var scored = pool.map(function (ch) {
        return {
          chord: ch,
          score: scoreChordForBar(ch, barExp, prevChord, b, bars, resolveEnd)
        };
      });
      scored.sort(function (a, b2) { return b2.score - a.score; });

      var cands = [];
      for (var i = 0; i < Math.min(6, scored.length); i++) cands.push(scored[i].chord.name);
      candidatesPerBar.push(cands);

      var chosen = manual || scored[0].chord;
      resolved.push({
        name: chosen.name,
        isAuto: !manual,
        parsed: chosen,
        candidates: cands
      });
      prevChord = chosen;
    }

    return { resolved: resolved, candidatesPerBar: candidatesPerBar };
  }

  function pickBassMidi(rootPc) {
    var m = 36 + rootPc;
    if (m < 38) m += 12;
    return m;
  }

  function pickArpChordNotes(chord) {
    var base = 60 + chord.rootPc;
    if (base > 68) base -= 12;
    return chord.intervals.map(function (iv) { return base + iv; });
  }

  function generateBarArrangement(styleId, barIndex, totalBars, barExpMelody, chordInfo, nextChordInfo, isIntro) {
    var chord = chordInfo.parsed;
    var rootBass = pickBassMidi(chord.rootPc);
    var fifthBass = rootBass + 7;
    if (fifthBass > 54) fifthBass -= 12;
    var octBass = rootBass + 12;

    var arpNotes = pickArpChordNotes(chord);
    var bassEvents = [];
    var arpEvents = [];
    var drumEvents = [];

    var isLastBar = (barIndex === totalBars - 1);
    var isEvenFill = ((barIndex % 4 === 3) || isLastBar) && totalBars >= 2;
    var nextRootBass = nextChordInfo ? pickBassMidi(nextChordInfo.parsed.rootPc) : rootBass;

    if (styleId === "scifi") {
      for (var s = 0; s < 16; s += 2) {
        var note = rootBass;
        if (s === 2 || s === 6 || s === 10) note = octBass;
        else if (s === 12) note = fifthBass;
        else if (s === 14) note = (nextRootBass !== rootBass) ? (nextRootBass > rootBass ? nextRootBass - 1 : nextRootBass + 2) : octBass;
        bassEvents.push({ step: s, midi: note, durSteps: 2, vol: 0.22 });
      }
    } else if (styleId === "hero") {
      var heroPattern = [0, 0, 7, 0, 0, 7, 12, 7];
      for (var h = 0; h < 8; h++) {
        var bNote = rootBass + heroPattern[h];
        if (bNote > 57) bNote -= 12;
        if (h === 7 && isEvenFill) bNote = nextRootBass - 1;
        bassEvents.push({ step: h * 2, midi: bNote, durSteps: 2, vol: 0.23 });
      }
    } else if (styleId === "battle") {
      var bPattern = [1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1];
      for (var sb = 0; sb < 16; sb++) {
        if (!bPattern[sb]) continue;
        var mNote = (sb % 4 === 2) ? octBass : ((sb === 12) ? fifthBass : rootBass);
        bassEvents.push({ step: sb, midi: mNote, durSteps: 1, vol: 0.22 });
      }
    } else if (styleId === "fanfare") {
      bassEvents.push({ step: 0, midi: rootBass, durSteps: 6, vol: 0.25 });
      bassEvents.push({ step: 6, midi: fifthBass, durSteps: 2, vol: 0.21 });
      bassEvents.push({ step: 8, midi: octBass, durSteps: 4, vol: 0.24 });
      bassEvents.push({ step: 12, midi: fifthBass, durSteps: 4, vol: 0.22 });
    } else {
      var mysSteps = [
        { s: 0, m: rootBass, d: 3 },
        { s: 4, m: rootBass, d: 2 },
        { s: 6, m: octBass,  d: 2 },
        { s: 10, m: fifthBass, d: 2 },
        { s: 14, m: rootBass + chord.intervals[1], d: 2 }
      ];
      for (var mi = 0; mi < mysSteps.length; mi++) {
        bassEvents.push({ step: mysSteps[mi].s, midi: mysSteps[mi].m, durSteps: mysSteps[mi].d, vol: 0.22 });
      }
    }

    if (styleId === "scifi") {
      var seq = [0, 1, 2, 1];
      for (var sa = 0; sa < 16; sa++) {
        var idx = seq[sa % 4] % arpNotes.length;
        var aNote = arpNotes[idx];
        if (barExpMelody[sa] && Math.abs(barExpMelody[sa] - aNote) <= 1) {
          aNote = arpNotes[(idx + 1) % arpNotes.length];
        }
        arpEvents.push({ step: sa, midi: aNote, durSteps: 1, vol: 0.068, duty: "12" });
      }
    } else if (styleId === "hero") {
      for (var ha = 0; ha < 16; ha += 2) {
        arpEvents.push({
          step: ha,
          midi: arpNotes[(ha / 2) % arpNotes.length],
          durSteps: 1,
          vol: (ha % 4 === 2) ? 0.085 : 0.06,
          duty: "25"
        });
      }
    } else if (styleId === "battle") {
      var arpExt = arpNotes.concat([arpNotes[0] + 12]);
      for (var ba = 0; ba < 16; ba++) {
        arpEvents.push({ step: ba, midi: arpExt[ba % arpExt.length], durSteps: 1, vol: 0.075, duty: "12" });
      }
    } else if (styleId === "fanfare") {
      var fSteps = [0, 6, 8, 12, 13, 14, 15];
      var arpUp = arpNotes.concat([arpNotes[0] + 12]);
      for (var fa = 0; fa < fSteps.length; fa++) {
        var stF = fSteps[fa];
        arpEvents.push({ step: stF, midi: arpUp[fa % arpUp.length], durSteps: stF < 12 ? 2 : 1, vol: 0.09, duty: "25" });
      }
    } else {
      var mSeq = [0, 4, 6, 10, 12, 14];
      for (var ma = 0; ma < mSeq.length; ma++) {
        arpEvents.push({ step: mSeq[ma], midi: arpNotes[ma % arpNotes.length] + 12, durSteps: 1, vol: 0.055, duty: "12" });
      }
    }

    if (styleId === "scifi" || styleId === "hero") {
      for (var d = 0; d < 16; d++) {
        if (d === 0 || d === 8 || (d === 10 && styleId === "scifi")) drumEvents.push({ step: d, kind: "kick", vol: 0.26 });
        if (d === 4 || d === 12) drumEvents.push({ step: d, kind: "snare", vol: 0.18 });
        else if (d % 2 === 0) drumEvents.push({ step: d, kind: "hat", vol: 0.075 });
        if (isEvenFill && d >= 13) {
          drumEvents.push({ step: d, kind: d === 15 ? "openhat" : "snare", vol: d === 15 ? 0.15 : 0.14 });
        }
      }
    } else if (styleId === "battle") {
      for (var bd = 0; bd < 16; bd++) {
        if (bd === 0 || bd === 3 || bd === 8 || bd === 11) drumEvents.push({ step: bd, kind: "kick", vol: 0.28 });
        if (bd === 4 || bd === 12 || (isEvenFill && bd >= 13)) drumEvents.push({ step: bd, kind: "snare", vol: bd >= 13 ? 0.16 : 0.19 });
        else drumEvents.push({ step: bd, kind: "hat", vol: (bd % 2 === 0) ? 0.08 : 0.05 });
      }
    } else if (styleId === "fanfare") {
      drumEvents.push({ step: 0, kind: "kick", vol: 0.28 });
      drumEvents.push({ step: 0, kind: "openhat", vol: 0.16 });
      drumEvents.push({ step: 4, kind: "snare", vol: 0.17 });
      drumEvents.push({ step: 6, kind: "kick", vol: 0.24 });
      drumEvents.push({ step: 8, kind: "kick", vol: 0.28 });
      drumEvents.push({ step: 12, kind: "snare", vol: 0.18 });
      if (isEvenFill || isIntro) {
        drumEvents.push({ step: 13, kind: "snare", vol: 0.13 });
        drumEvents.push({ step: 14, kind: "snare", vol: 0.15 });
        drumEvents.push({ step: 15, kind: "snare", vol: 0.18 });
      }
    } else {
      for (var md = 0; md < 16; md += 2) {
        if (md === 0 || md === 6) drumEvents.push({ step: md, kind: "kick", vol: 0.22 });
        if (md === 10) drumEvents.push({ step: md, kind: "snare", vol: 0.14 });
        drumEvents.push({ step: md, kind: "hat", vol: 0.06 });
      }
    }

    return { arp: arpEvents, bass: bassEvents, drums: drumEvents };
  }

  function arrangeSection(rawMelody, manualChords, bars, styleId, keyInfo, isIntro, hasLoop) {
    if (!bars || bars <= 0) {
      return { bars: 0, totalSteps: 0, chords: [], candidatesPerBar: [], steps: [] };
    }
    var totalSteps = bars * STEPS_PER_BAR;
    var normRaw = new Array(totalSteps);
    for (var i = 0; i < totalSteps; i++) {
      normRaw[i] = (rawMelody && i < rawMelody.length) ? rawMelody[i] : 0;
    }
    var exp = expandMelodyNotes(normRaw, totalSteps);
    var chordRes = resolveSectionChords(exp, manualChords || [], bars, keyInfo, isIntro, hasLoop);

    var stepBuckets = new Array(totalSteps);
    for (var s = 0; s < totalSteps; s++) {
      stepBuckets[s] = { melody: [], arp: [], bass: [], drums: [] };
    }

    var g = 0;
    while (g < totalSteps) {
      var mv = normRaw[g];
      if (mv && mv > 0) {
        var dur = 1;
        while (g + dur < totalSteps && normRaw[g + dur] === NOTE_HOLD) dur++;
        stepBuckets[g].melody.push({
          step: g,
          midi: mv,
          durSteps: dur,
          vol: 0.19,
          duty: (styleId === "battle" || styleId === "fanfare") ? "50" : "25"
        });
        g += dur;
      } else {
        g++;
      }
    }

    for (var b = 0; b < bars; b++) {
      var barExp = exp.slice(b * STEPS_PER_BAR, (b + 1) * STEPS_PER_BAR);
      var cInfo = chordRes.resolved[b];
      var nextCInfo = (b + 1 < bars) ? chordRes.resolved[b + 1] : chordRes.resolved[0];
      var barArr = generateBarArrangement(styleId, b, bars, barExp, cInfo, nextCInfo, isIntro);
      var offset = b * STEPS_PER_BAR;
      for (var k = 0; k < barArr.arp.length; k++) stepBuckets[offset + barArr.arp[k].step].arp.push(barArr.arp[k]);
      for (var kb = 0; kb < barArr.bass.length; kb++) stepBuckets[offset + barArr.bass[kb].step].bass.push(barArr.bass[kb]);
      for (var kd = 0; kd < barArr.drums.length; kd++) stepBuckets[offset + barArr.drums[kd].step].drums.push(barArr.drums[kd]);
    }

    return {
      bars: bars,
      totalSteps: totalSteps,
      chords: chordRes.resolved,
      candidatesPerBar: chordRes.candidatesPerBar,
      steps: stepBuckets
    };
  }

  function arrangeSong(song) {
    var safe = song || {};
    var styleId = safe.style || "scifi";
    var keyInfo = detectKey(safe);
    var hasLoop = (safe.loopBars || 0) > 0;
    return {
      keyInfo: keyInfo,
      style: styleId,
      bpm: clamp(Number(safe.bpm) || 135, 60, 240),
      intro: arrangeSection(safe.introMelody || [], safe.introChords || [], safe.introBars || 0, styleId, keyInfo, true, hasLoop),
      loop: arrangeSection(safe.loopMelody || [], safe.loopChords || [], safe.loopBars || 0, styleId, keyInfo, false, hasLoop)
    };
  }

  // =========================================================
  // Web Audio API ファミコン風シンセ ＆ 先読みシーケンサー
  // =========================================================
  var ctx = null;
  var masterGain = null;
  var compressor = null;
  var bgmBus = null;
  var waves = {};
  var noiseBuffer = null;

  var state = {
    playing: false,
    muted: false,
    masterVol: 0.8,
    tempoRate: 1.0,
    boostMode: false,
    chMute: { melody: false, arp: false, bass: false, drums: false },
    song: null,
    arranged: null,
    sectionMode: "all",
    curSection: "intro",
    curStep: 0,
    nextStepTime: 0,
    timerId: null,
    onStep: null,
    onEnd: null,
    uiNotifyTimers: []
  };

  function createPulseWave(audioCtx, duty) {
    if (!audioCtx.createPeriodicWave) return null;
    var harmonics = 32;
    var real = new Float32Array(harmonics + 1);
    var imag = new Float32Array(harmonics + 1);
    for (var n = 1; n <= harmonics; n++) {
      real[n] = (2 / (n * Math.PI)) * Math.sin(2 * Math.PI * n * duty);
      imag[n] = (2 / (n * Math.PI)) * (1 - Math.cos(2 * Math.PI * n * duty));
    }
    return audioCtx.createPeriodicWave(real, imag);
  }

  function createNesTriWave(audioCtx) {
    if (!audioCtx.createPeriodicWave) return null;
    var real = new Float32Array(16);
    var imag = new Float32Array(16);
    real[1] = -0.8591; imag[1] = 0.0846;
    real[3] = -0.0906; imag[3] = 0.0275;
    real[5] = -0.0292; imag[5] = 0.0156;
    real[7] = -0.0124; imag[7] = 0.0102;
    return audioCtx.createPeriodicWave(real, imag);
  }

  function createNoiseBuf(audioCtx) {
    var len = audioCtx.sampleRate * 0.5;
    var buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
    var data = buf.getChannelData(0);
    var hold = 0;
    for (var i = 0; i < len; i++) {
      if (i % 2 === 0) hold = Math.random() * 2 - 1;
      data[i] = hold;
    }
    return buf;
  }

  function ensureContext() {
    if (typeof window === "undefined") return null;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = state.muted ? 0 : state.masterVol;

      if (ctx.createDynamicsCompressor) {
        compressor = ctx.createDynamicsCompressor();
        compressor.threshold.value = -12;
        compressor.knee.value = 10;
        compressor.ratio.value = 4;
        compressor.attack.value = 0.003;
        compressor.release.value = 0.12;
        compressor.connect(masterGain);
        masterGain.connect(ctx.destination);
      } else {
        masterGain.connect(ctx.destination);
      }

      bgmBus = ctx.createGain();
      bgmBus.gain.value = 1.0;
      bgmBus.connect(compressor || masterGain);

      try {
        waves["12"] = createPulseWave(ctx, 0.125);
        waves["25"] = createPulseWave(ctx, 0.25);
        waves["50"] = createPulseWave(ctx, 0.5);
        waves["tri"] = createNesTriWave(ctx);
      } catch (e) {
        waves = {};
      }
      noiseBuffer = createNoiseBuf(ctx);
    }
    return ctx;
  }

  function unlock() {
    var ac = ensureContext();
    if (!ac) return;
    if (ac.state === "suspended") {
      try { ac.resume(); } catch (e) {}
    }
    try {
      var b = ac.createBuffer(1, 1, 22050);
      var s = ac.createBufferSource();
      s.buffer = b;
      s.connect(ac.destination);
      s.start(0);
    } catch (e) {}
  }

  function triggerOscNote(time, midi, durationSec, vol, waveKey, fallbackType, destBus) {
    if (!ctx || !destBus) return;
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    if (waves[waveKey] && osc.setPeriodicWave) osc.setPeriodicWave(waves[waveKey]);
    else osc.type = fallbackType || "square";

    osc.frequency.setValueAtTime(midiToFreq(midi), time);
    var safeDur = Math.max(0.025, durationSec);
    var atk = 0.004;
    var rel = Math.min(0.015, safeDur * 0.25);

    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.linearRampToValueAtTime(vol, time + atk);
    if (safeDur > atk + rel) gain.gain.setValueAtTime(vol, time + safeDur - rel);
    gain.gain.linearRampToValueAtTime(0.0001, time + safeDur);

    osc.connect(gain);
    gain.connect(destBus);
    osc.start(time);
    osc.stop(time + safeDur + 0.01);
  }

  function triggerDrum(time, kind, vol, destBus) {
    if (!ctx || !destBus) return;
    if (kind === "kick") {
      var osc = ctx.createOscillator();
      var g = ctx.createGain();
      if (waves["tri"] && osc.setPeriodicWave) osc.setPeriodicWave(waves["tri"]);
      else osc.type = "triangle";
      osc.frequency.setValueAtTime(155, time);
      osc.frequency.exponentialRampToValueAtTime(42, time + 0.085);
      g.gain.setValueAtTime(vol, time);
      g.gain.exponentialRampToValueAtTime(0.001, time + 0.095);
      osc.connect(g);
      g.connect(destBus);
      osc.start(time);
      osc.stop(time + 0.11);
      return;
    }

    if (!noiseBuffer) return;
    var src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    var filter = ctx.createBiquadFilter();
    var ng = ctx.createGain();
    var dur = 0.032;

    if (kind === "snare") {
      filter.type = "bandpass";
      filter.frequency.setValueAtTime(1800, time);
      filter.Q.value = 0.7;
      dur = 0.095;
    } else if (kind === "openhat") {
      filter.type = "highpass";
      filter.frequency.setValueAtTime(5200, time);
      dur = 0.11;
    } else {
      filter.type = "highpass";
      filter.frequency.setValueAtTime(6500, time);
    }

    ng.gain.setValueAtTime(vol, time);
    ng.gain.exponentialRampToValueAtTime(0.001, time + dur);
    src.connect(filter);
    filter.connect(ng);
    ng.connect(destBus);
    src.start(time);
    src.stop(time + dur + 0.02);
  }

  function stepDurationSec() {
    var bpm = state.arranged ? state.arranged.bpm : 135;
    var rate = clamp(state.tempoRate, 0.25, 2.5);
    if (state.boostMode) rate *= 1.12;
    return 60 / (bpm * rate * 4);
  }

  function scheduleStep(sectionName, stepIdx, time) {
    if (!state.arranged || !bgmBus) return;
    var sec = state.arranged[sectionName];
    if (!sec || !sec.steps || stepIdx >= sec.steps.length) return;
    var bucket = sec.steps[stepIdx];
    var stepSec = stepDurationSec();

    if (!state.chMute.melody) {
      for (var i = 0; i < bucket.melody.length; i++) {
        var me = bucket.melody[i];
        triggerOscNote(time, me.midi, me.durSteps * stepSec * 0.96, me.vol, me.duty || "25", "square", bgmBus);
      }
    }
    if (!state.chMute.arp) {
      for (var a = 0; a < bucket.arp.length; a++) {
        var ae = bucket.arp[a];
        var arpMidi = ae.midi + (state.boostMode ? 12 : 0);
        triggerOscNote(time, arpMidi, ae.durSteps * stepSec * 0.78, ae.vol, ae.duty || "12", "square", bgmBus);
      }
    }
    if (!state.chMute.bass) {
      for (var b = 0; b < bucket.bass.length; b++) {
        var be = bucket.bass[b];
        triggerOscNote(time, be.midi, be.durSteps * stepSec * 0.88, be.vol, "tri", "triangle", bgmBus);
      }
    }
    if (!state.chMute.drums) {
      for (var d = 0; d < bucket.drums.length; d++) {
        triggerDrum(time, bucket.drums[d].kind, bucket.drums[d].vol, bgmBus);
      }
    }

    if (state.onStep && typeof window !== "undefined") {
      var delayMs = Math.max(0, (time - ctx.currentTime) * 1000);
      var tid = setTimeout(function () {
        if (!state.playing || !state.onStep) return;
        state.onStep({
          section: sectionName,
          step: stepIdx,
          bar: Math.floor(stepIdx / STEPS_PER_BAR),
          stepInBar: stepIdx % STEPS_PER_BAR
        });
      }, delayMs);
      state.uiNotifyTimers.push(tid);
      if (state.uiNotifyTimers.length > 48) state.uiNotifyTimers.shift();
    }
  }

  function advanceStep() {
    state.nextStepTime += stepDurationSec();
    state.curStep++;

    var secObj = state.arranged[state.curSection];
    var len = secObj ? secObj.totalSteps : 0;

    if (state.curStep >= len) {
      if (state.sectionMode === "intro") {
        stop(true);
        if (state.onEnd) state.onEnd();
        return false;
      } else if (state.sectionMode === "loop") {
        state.curStep = 0;
      } else {
        if (state.curSection === "intro") {
          if (state.arranged.loop.totalSteps > 0) {
            state.curSection = "loop";
            state.curStep = 0;
          } else {
            stop(true);
            if (state.onEnd) state.onEnd();
            return false;
          }
        } else {
          state.curStep = 0;
        }
      }
    }
    return true;
  }

  function schedulerTick() {
    if (!state.playing || !ctx) return;
    while (state.nextStepTime < ctx.currentTime + 0.12) {
      scheduleStep(state.curSection, state.curStep, state.nextStepTime);
      if (!advanceStep()) break;
    }
  }

  function resetBgmBus() {
    if (!ctx || !masterGain) return;
    if (bgmBus) {
      var oldBus = bgmBus;
      try {
        var now = ctx.currentTime;
        oldBus.gain.cancelScheduledValues(now);
        oldBus.gain.setValueAtTime(oldBus.gain.value, now);
        oldBus.gain.linearRampToValueAtTime(0.0001, now + 0.025);
        setTimeout(function () { try { oldBus.disconnect(); } catch (e) {} }, 60);
      } catch (e) {}
    }
    bgmBus = ctx.createGain();
    bgmBus.gain.value = 1.0;
    bgmBus.connect(compressor || masterGain);
  }

  function stop(silentEnd) {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
    for (var i = 0; i < state.uiNotifyTimers.length; i++) clearTimeout(state.uiNotifyTimers[i]);
    state.uiNotifyTimers = [];
    state.playing = false;
    if (!silentEnd) resetBgmBus();
  }

  function playSong(song, options) {
    options = options || {};
    unlock();
    var ac = ensureContext();
    if (!ac) return false;

    stop(false);
    state.song = song;
    state.arranged = arrangeSong(song);
    state.sectionMode = options.sectionMode || "all";
    state.onStep = options.onStep || null;
    state.onEnd = options.onEnd || null;

    var introLen = state.arranged.intro.totalSteps;
    var loopLen = state.arranged.loop.totalSteps;

    if (state.sectionMode === "intro") {
      if (introLen <= 0) return false;
      state.curSection = "intro";
    } else if (state.sectionMode === "loop") {
      if (loopLen <= 0) return false;
      state.curSection = "loop";
    } else {
      if (introLen > 0) state.curSection = "intro";
      else if (loopLen > 0) state.curSection = "loop";
      else return false;
    }

    state.curStep = 0;
    state.playing = true;
    state.nextStepTime = ac.currentTime + 0.05;
    schedulerTick();
    state.timerId = setInterval(schedulerTick, 25);
    return true;
  }

  function refreshArrangement(song) {
    state.song = song;
    state.arranged = arrangeSong(song);
    if (state.playing) {
      var curLen = state.arranged[state.curSection].totalSteps;
      if (curLen <= 0) stop(false);
      else if (state.curStep >= curLen) state.curStep = 0;
    }
    return state.arranged;
  }

  function previewNote(midi, durationSec) {
    if (!midi || midi <= 0) return;
    unlock();
    var ac = ensureContext();
    if (!ac || !masterGain) return;
    triggerOscNote(ac.currentTime + 0.005, midi, durationSec || 0.16, 0.20, "25", "square", compressor || masterGain);
  }

  function setTempoRate(rate) {
    state.tempoRate = clamp(Number(rate) || 1.0, 0.25, 2.5);
  }

  function setBoostMode(enabled) {
    state.boostMode = !!enabled;
  }

  function setMuted(muted) {
    state.muted = !!muted;
    if (ctx && masterGain) masterGain.gain.setValueAtTime(state.muted ? 0 : state.masterVol, ctx.currentTime);
  }

  function setMasterVolume(vol) {
    state.masterVol = clamp(Number(vol), 0, 1);
    if (ctx && masterGain && !state.muted) masterGain.gain.setValueAtTime(state.masterVol, ctx.currentTime);
  }

  function setChannelMute(ch, muted) {
    if (state.chMute.hasOwnProperty(ch)) state.chMute[ch] = !!muted;
  }

  function getState() {
    return {
      playing: state.playing,
      muted: state.muted,
      masterVol: state.masterVol,
      tempoRate: state.tempoRate,
      boostMode: state.boostMode,
      chMute: Object.assign({}, state.chMute),
      curSection: state.curSection,
      curStep: state.curStep
    };
  }

  function playSe(kind) {
    unlock();
    var ac = ensureContext();
    if (!ac || !masterGain) return;
    var dest = compressor || masterGain;
    var t = ac.currentTime + 0.005;
    if (kind === "cursor") {
      triggerOscNote(t, 84, 0.045, 0.14, "12", "square", dest);
    } else if (kind === "confirm") {
      triggerOscNote(t, 76, 0.06, 0.16, "25", "square", dest);
      triggerOscNote(t + 0.055, 88, 0.10, 0.16, "25", "square", dest);
    }
  }

  var api = {
    STEPS_PER_BAR: STEPS_PER_BAR,
    NOTE_REST: NOTE_REST,
    NOTE_HOLD: NOTE_HOLD,
    STYLES: STYLES,
    NOTE_NAMES: NOTE_NAMES,
    DOREMI_NAMES: DOREMI_NAMES,
    midiToFreq: midiToFreq,
    midiToName: midiToName,
    midiToDoremi: midiToDoremi,
    parseChordName: parseChordName,
    detectKey: detectKey,
    arrangeSong: arrangeSong,
    unlock: unlock,
    playSong: playSong,
    stop: stop,
    refreshArrangement: refreshArrangement,
    previewNote: previewNote,
    playSe: playSe,
    setTempoRate: setTempoRate,
    setBoostMode: setBoostMode,
    setMuted: setMuted,
    setMasterVolume: setMasterVolume,
    setChannelMute: setChannelMute,
    getState: getState
  };

  global.BreakerSound = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
