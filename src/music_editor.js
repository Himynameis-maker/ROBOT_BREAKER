(function (global) {
  "use strict";

  var S = global.BreakerSound;
  if (!S) return;

  var STORAGE_KEY = "breaker_music_editor_songs_v1";
  var NOTE_MIN = 57; // A3
  var NOTE_MAX = 88; // E6
  var STEPS_PER_BAR = S.STEPS_PER_BAR;

  var PRESET_SONGS = [
    {
      id: "preset_scifi",
      name: "サンプル1: 宇宙ステーション (SF)",
      bpm: 138,
      mode: "auto",
      style: "scifi",
      introBars: 2,
      loopBars: 4,
      introMelody: [
        69, -1, 0, 72, 76, -1, 79, -1, 81, -1, -1, 0, 79, -1, 76, -1,
        74, -1, 72, -1, 71, -1, 69, -1, 76, -1, -1, -1, -1, -1, 0, 0
      ],
      loopMelody: [
        69, -1, 0, 72, 76, -1, 72, 0, 69, -1, 72, -1, 76, -1, 0, 0,
        65, -1, 0, 69, 72, -1, 69, 0, 65, -1, 69, -1, 72, -1, 0, 0,
        67, -1, 0, 71, 74, -1, 71, 0, 67, -1, 71, -1, 74, -1, 0, 0,
        76, -1, -1, -1, 74, -1, 72, -1, 71, -1, -1, -1, 64, -1, 0, 0
      ],
      introChords: ["AUTO", "AUTO"],
      loopChords: ["AUTO", "AUTO", "AUTO", "AUTO"]
    },
    {
      id: "preset_battle",
      name: "サンプル2: バトル25秒! (疾走)",
      bpm: 162,
      mode: "minor",
      style: "battle",
      introBars: 1,
      loopBars: 4,
      introMelody: [
        64, 0, 64, 67, 71, 0, 72, 0, 74, -1, 72, 0, 71, -1, 0, 0
      ],
      loopMelody: [
        76, 0, 76, 0, 79, -1, 76, 0, 74, 0, 72, 0, 71, -1, 0, 0,
        72, 0, 72, 0, 76, -1, 72, 0, 71, 0, 69, 0, 67, -1, 0, 0,
        69, 0, 69, 0, 72, -1, 74, 0, 76, -1, 74, 0, 72, -1, 0, 0,
        71, -1, 74, -1, 79, -1, 76, -1, 75, -1, -1, -1, 71, -1, 0, 0
      ],
      introChords: ["AUTO"],
      loopChords: ["AUTO", "AUTO", "AUTO", "AUTO"]
    },
    {
      id: "preset_fanfare",
      name: "サンプル3: 開幕ファンファーレ (ループ無)",
      bpm: 146,
      mode: "major",
      style: "fanfare",
      introBars: 2,
      loopBars: 0,
      introMelody: [
        72, 0, 72, 72, 76, -1, 79, -1, 77, -1, 76, -1, 74, -1, 0, 0,
        74, 0, 74, 74, 79, -1, 83, -1, 84, -1, -1, -1, -1, -1, 0, 0
      ],
      loopMelody: [],
      introChords: ["AUTO", "AUTO"],
      loopChords: []
    },
    {
      id: "preset_blank",
      name: "新規曲 (からっぽ)",
      bpm: 136,
      mode: "auto",
      style: "hero",
      introBars: 1,
      loopBars: 4,
      introMelody: new Array(16).fill(0),
      loopMelody: new Array(64).fill(0),
      introChords: ["AUTO"],
      loopChords: ["AUTO", "AUTO", "AUTO", "AUTO"]
    }
  ];

  function cloneSong(song) {
    return JSON.parse(JSON.stringify(song));
  }

  function resizeArr(arr, len, fillVal) {
    var out = new Array(len);
    for (var i = 0; i < len; i++) out[i] = (arr && i < arr.length) ? arr[i] : fillVal;
    return out;
  }

  function normalizeSong(song) {
    var s = cloneSong(song || PRESET_SONGS[0]);
    s.name = s.name || "無題のBGM";
    s.bpm = Math.max(60, Math.min(240, Number(s.bpm) || 138));
    s.mode = (s.mode === "major" || s.mode === "minor") ? s.mode : "auto";
    s.style = s.style || "scifi";
    s.introBars = Math.max(0, Math.min(4, Number(s.introBars) || 0));
    s.loopBars = Math.max(0, Math.min(16, Number(s.loopBars) || 0));
    s.introMelody = resizeArr(s.introMelody, s.introBars * STEPS_PER_BAR, 0);
    s.loopMelody = resizeArr(s.loopMelody, s.loopBars * STEPS_PER_BAR, 0);
    s.introChords = resizeArr(s.introChords, s.introBars, "AUTO");
    s.loopChords = resizeArr(s.loopChords, s.loopBars, "AUTO");
    return s;
  }

  function isBlackKey(midi) {
    var pc = midi % 12;
    return pc === 1 || pc === 3 || pc === 6 || pc === 8 || pc === 10;
  }

  function initEditor() {
    var app = {
      song: normalizeSong(PRESET_SONGS[0]),
      arranged: null,
      activeSection: "loop",
      currentBar: 0,
      toolMode: "draw",
      playhead: null,
      followPlayhead: true,
      clipboardBar: null,
      undoStack: [],
      slots: [],
      activeSlotIdx: 0,
      chordPickerOpen: false,
      stepColEls: [],
      headStepEls: [],
      barPillEls: [],
      highlightedStep: -1
    };

    function $(id) { return document.getElementById(id); }

    var el = {
      songName: $("songName"),
      presetSelect: $("presetSelect"),
      slotSelect: $("slotSelect"),
      btnSaveSlot: $("btnSaveSlot"),
      btnPlayAll: $("btnPlayAll"),
      btnPlayIntro: $("btnPlayIntro"),
      btnPlayLoop: $("btnPlayLoop"),
      btnStop: $("btnStop"),
      tabIntro: $("tabIntro"),
      tabLoop: $("tabLoop"),
      introBarsMinus: $("introBarsMinus"),
      introBarsPlus: $("introBarsPlus"),
      introBarsVal: $("introBarsVal"),
      loopBarsMinus: $("loopBarsMinus"),
      loopBarsPlus: $("loopBarsPlus"),
      loopBarsVal: $("loopBarsVal"),
      styleSelect: $("styleSelect"),
      modeSelect: $("modeSelect"),
      bpmRange: $("bpmRange"),
      bpmVal: $("bpmVal"),
      keyBadge: $("keyBadge"),
      btnToolDraw: $("btnToolDraw"),
      btnToolHold: $("btnToolHold"),
      btnUndo: $("btnUndo"),
      btnOctUp: $("btnOctUp"),
      btnOctDown: $("btnOctDown"),
      btnCopyBar: $("btnCopyBar"),
      btnPasteBar: $("btnPasteBar"),
      btnClearBar: $("btnClearBar"),
      barTabs: $("barTabs"),
      barPrev: $("barPrev"),
      barNext: $("barNext"),
      barLabel: $("barLabel"),
      chordBtn: $("chordBtn"),
      chordPicker: $("chordPicker"),
      pianoScroll: $("pianoScroll"),
      pianoGrid: $("pianoGrid"),
      chkFollow: $("chkFollow"),
      chkZoom: $("chkZoom"),
      chkSlow: $("chkSlow"),
      chkBoost: $("chkBoost"),
      chToggles: document.querySelectorAll("[data-ch]"),
      exportBox: $("exportBox"),
      btnExport: $("btnExport"),
      btnCopyExport: $("btnCopyExport"),
      btnImport: $("btnImport"),
      statusMsg: $("statusMsg")
    };

    function setStatus(msg) {
      if (el.statusMsg) el.statusMsg.textContent = msg;
    }

    function pushUndo() {
      app.undoStack.push(cloneSong(app.song));
      if (app.undoStack.length > 30) app.undoStack.shift();
    }

    function loadSlots() {
      try {
        var raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          var parsed = JSON.parse(raw);
          if (Array.isArray(parsed) && parsed.length > 0) {
            app.slots = parsed.map(normalizeSong);
            return;
          }
        }
      } catch (e) {}
      app.slots = [];
      for (var i = 0; i < 8; i++) {
        var base = normalizeSong(i < 3 ? PRESET_SONGS[i] : PRESET_SONGS[3]);
        if (i >= 3) base.name = "マイ曲 " + (i + 1);
        app.slots.push(base);
      }
    }

    function saveSlotsToStorage() {
      try {
        app.slots[app.activeSlotIdx] = cloneSong(app.song);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(app.slots));
      } catch (e) {}
    }

    function getSecData(secName) {
      var isIntro = (secName === "intro");
      return {
        isIntro: isIntro,
        bars: isIntro ? app.song.introBars : app.song.loopBars,
        melody: isIntro ? app.song.introMelody : app.song.loopMelody,
        chords: isIntro ? app.song.introChords : app.song.loopChords
      };
    }

    function expandBarEffectivePitch(melody, barIdx) {
      var out = new Array(STEPS_PER_BAR).fill(0);
      var cur = 0;
      var limit = Math.min(melody.length, (barIdx + 1) * STEPS_PER_BAR);
      var start = barIdx * STEPS_PER_BAR;
      for (var i = 0; i < limit; i++) {
        var v = melody[i];
        if (v > 0) cur = v;
        else if (v === S.NOTE_HOLD) cur = cur > 0 ? cur : 0;
        else cur = 0;
        if (i >= start) out[i - start] = cur;
      }
      return out;
    }

    function cleanupTrailingHolds(melody, fromStep) {
      for (var i = fromStep; i < melody.length; i++) {
        if (melody[i] === S.NOTE_HOLD) melody[i] = 0;
        else break;
      }
    }

    function onTapCell(stepInBar, midi) {
      var sec = getSecData(app.activeSection);
      if (sec.bars <= 0) return;
      var gStep = app.currentBar * STEPS_PER_BAR + stepInBar;
      if (gStep < 0 || gStep >= sec.melody.length) return;

      pushUndo();
      var melody = sec.melody;
      var curVal = melody[gStep];
      var eff = expandBarEffectivePitch(melody, app.currentBar);
      var curEff = eff[stepInBar];

      if (app.toolMode === "hold") {
        if (curVal === S.NOTE_HOLD && curEff === midi) {
          melody[gStep] = 0;
          cleanupTrailingHolds(melody, gStep + 1);
        } else {
          var foundOrigin = -1;
          var minScan = Math.max(0, gStep - 16);
          for (var p = gStep - 1; p >= minScan; p--) {
            if (melody[p] > 0) {
              if (melody[p] === midi) foundOrigin = p;
              break;
            }
          }
          if (foundOrigin >= 0) {
            for (var k = foundOrigin + 1; k <= gStep; k++) melody[k] = S.NOTE_HOLD;
            cleanupTrailingHolds(melody, gStep + 1);
            S.previewNote(midi, 0.14);
          } else {
            melody[gStep] = midi;
            cleanupTrailingHolds(melody, gStep + 1);
            S.previewNote(midi, 0.16);
          }
        }
      } else {
        if (curVal === midi || (curVal === S.NOTE_HOLD && curEff === midi)) {
          melody[gStep] = 0;
          cleanupTrailingHolds(melody, gStep + 1);
        } else {
          melody[gStep] = midi;
          cleanupTrailingHolds(melody, gStep + 1);
          S.previewNote(midi, 0.16);
        }
      }
      onSongChanged();
    }

    function onSongChanged() {
      app.song = normalizeSong(app.song);
      app.arranged = S.refreshArrangement(app.song);
      saveSlotsToStorage();
      renderAll();
    }

    function populateStaticControls() {
      if (el.styleSelect) {
        el.styleSelect.innerHTML = "";
        S.STYLES.forEach(function (st) {
          var op = document.createElement("option");
          op.value = st.id;
          op.textContent = st.label + "（" + st.desc + "）";
          el.styleSelect.appendChild(op);
        });
      }
      if (el.presetSelect) {
        el.presetSelect.innerHTML = "<option value=''>サンプル曲を読み込む...</option>";
        PRESET_SONGS.forEach(function (p, i) {
          var op = document.createElement("option");
          op.value = String(i);
          op.textContent = p.name;
          el.presetSelect.appendChild(op);
        });
      }
      renderSlotSelect();
    }

    function renderSlotSelect() {
      if (!el.slotSelect) return;
      el.slotSelect.innerHTML = "";
      app.slots.forEach(function (sl, i) {
        var op = document.createElement("option");
        op.value = String(i);
        op.textContent = "[" + (i + 1) + "] " + sl.name;
        if (i === app.activeSlotIdx) op.selected = true;
        el.slotSelect.appendChild(op);
      });
    }

    function renderHeaderControls() {
      if (el.songName) el.songName.value = app.song.name;
      if (el.styleSelect) el.styleSelect.value = app.song.style;
      if (el.modeSelect) el.modeSelect.value = app.song.mode;
      if (el.bpmRange) el.bpmRange.value = String(app.song.bpm);
      if (el.bpmVal) el.bpmVal.textContent = app.song.bpm + " BPM";

      if (el.introBarsVal) el.introBarsVal.textContent = app.song.introBars + "小節";
      if (el.loopBarsVal) el.loopBarsVal.textContent = app.song.loopBars + "小節";

      if (el.tabIntro) {
        el.tabIntro.classList.toggle("active", app.activeSection === "intro");
        el.tabIntro.textContent = "イントロ (" + app.song.introBars + ")";
      }
      if (el.tabLoop) {
        el.tabLoop.classList.toggle("active", app.activeSection === "loop");
        el.tabLoop.textContent = "ループ (" + app.song.loopBars + ")";
      }

      if (el.btnToolDraw) el.btnToolDraw.classList.toggle("active", app.toolMode === "draw");
      if (el.btnToolHold) el.btnToolHold.classList.toggle("active", app.toolMode === "hold");
      if (el.btnUndo) el.btnUndo.disabled = app.undoStack.length === 0;
      if (el.btnPasteBar) el.btnPasteBar.disabled = !app.clipboardBar;

      if (el.keyBadge && app.arranged) {
        el.keyBadge.textContent = "判定キー: " + app.arranged.keyInfo.name;
      }

      if (el.btnPlayIntro) el.btnPlayIntro.disabled = app.song.introBars <= 0;
      if (el.btnPlayLoop) el.btnPlayLoop.disabled = app.song.loopBars <= 0;
      if (el.btnPlayAll) el.btnPlayAll.disabled = (app.song.introBars + app.song.loopBars) <= 0;
    }

    function updatePlayheadHighlight() {
      var targetStep = -1;
      if (app.playhead && app.playhead.section === app.activeSection && app.playhead.bar === app.currentBar) {
        targetStep = app.playhead.stepInBar;
      }

      if (app.highlightedStep >= 0 && app.highlightedStep !== targetStep) {
        var prevHead = app.headStepEls[app.highlightedStep];
        if (prevHead) prevHead.classList.remove("playing");
        var prevCols = app.stepColEls[app.highlightedStep] || [];
        for (var i = 0; i < prevCols.length; i++) prevCols[i].classList.remove("playing");
      }
      if (targetStep >= 0 && targetStep !== app.highlightedStep) {
        var newHead = app.headStepEls[targetStep];
        if (newHead) newHead.classList.add("playing");
        var newCols = app.stepColEls[targetStep] || [];
        for (var j = 0; j < newCols.length; j++) newCols[j].classList.add("playing");
      }
      app.highlightedStep = targetStep;

      for (var b = 0; b < app.barPillEls.length; b++) {
        var isPlayingBar = !!(app.playhead && app.playhead.section === app.activeSection && app.playhead.bar === b);
        app.barPillEls[b].classList.toggle("playing", isPlayingBar);
      }
    }

    function renderBarNavAndChord() {
      var sec = getSecData(app.activeSection);
      app.barPillEls = [];
      if (sec.bars <= 0) {
        if (el.barTabs) el.barTabs.innerHTML = "<span class='muted'>このセクションは0小節（無し）です</span>";
        if (el.barLabel) el.barLabel.textContent = "0 / 0";
        if (el.chordBtn) { el.chordBtn.textContent = "コード: ---"; el.chordBtn.disabled = true; }
        if (el.chordPicker) el.chordPicker.classList.add("hidden");
        return;
      }

      if (app.currentBar >= sec.bars) app.currentBar = sec.bars - 1;
      if (app.currentBar < 0) app.currentBar = 0;

      if (el.barLabel) el.barLabel.textContent = (app.currentBar + 1) + " / " + sec.bars + " 小節目";
      if (el.barPrev) el.barPrev.disabled = (app.currentBar <= 0);
      if (el.barNext) el.barNext.disabled = (app.currentBar >= sec.bars - 1);

      var arrSec = app.arranged ? app.arranged[app.activeSection] : null;
      if (el.barTabs) {
        el.barTabs.innerHTML = "";
        for (var b = 0; b < sec.bars; b++) {
          (function (barIdx) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "bar-pill" + (barIdx === app.currentBar ? " active" : "");
            var cName = (arrSec && arrSec.chords[barIdx]) ? arrSec.chords[barIdx].name : "";
            btn.textContent = (barIdx + 1) + (cName ? ":" + cName : "");
            btn.addEventListener("click", function () {
              app.currentBar = barIdx;
              app.chordPickerOpen = false;
              renderAll();
            });
            el.barTabs.appendChild(btn);
            app.barPillEls.push(btn);
          })(b);
        }
      }

      var cInfo = (arrSec && arrSec.chords[app.currentBar]) ? arrSec.chords[app.currentBar] : null;
      if (el.chordBtn) {
        el.chordBtn.disabled = false;
        el.chordBtn.textContent = cInfo ? ((cInfo.isAuto ? "自動コード: " : "固定コード: ") + cInfo.name + " ▼") : "コード: AUTO";
      }

      if (el.chordPicker) {
        if (!app.chordPickerOpen || !cInfo) {
          el.chordPicker.classList.add("hidden");
        } else {
          el.chordPicker.classList.remove("hidden");
          el.chordPicker.innerHTML = "";
          var autoBtn = document.createElement("button");
          autoBtn.type = "button";
          autoBtn.className = "chord-choice" + (cInfo.isAuto ? " selected" : "");
          autoBtn.textContent = "自動におまかせ";
          autoBtn.addEventListener("click", function () {
            pushUndo();
            sec.chords[app.currentBar] = "AUTO";
            app.chordPickerOpen = false;
            onSongChanged();
          });
          el.chordPicker.appendChild(autoBtn);

          var choices = cInfo.candidates.slice();
          ["C", "Cm", "D", "Dm", "E", "Em", "E7", "F", "Fm", "G", "G7", "Am", "A", "Bb"].forEach(function (ex) {
            if (choices.indexOf(ex) < 0) choices.push(ex);
          });
          choices.forEach(function (chName) {
            var cb = document.createElement("button");
            cb.type = "button";
            cb.className = "chord-choice" + (!cInfo.isAuto && cInfo.name === chName ? " selected" : "");
            cb.textContent = chName;
            cb.addEventListener("click", function () {
              pushUndo();
              sec.chords[app.currentBar] = chName;
              app.chordPickerOpen = false;
              onSongChanged();
            });
            el.chordPicker.appendChild(cb);
          });
        }
      }
    }

    function renderPianoRoll() {
      if (!el.pianoGrid) return;
      app.stepColEls = [];
      app.headStepEls = [];
      app.highlightedStep = -1;
      for (var k = 0; k < STEPS_PER_BAR; k++) app.stepColEls[k] = [];

      var sec = getSecData(app.activeSection);
      if (sec.bars <= 0) {
        el.pianoGrid.innerHTML = "<div class='empty-notice'>上の「＋」ボタンで小節数を増やすとメロディを打てます</div>";
        return;
      }

      var barStart = app.currentBar * STEPS_PER_BAR;
      var eff = expandBarEffectivePitch(sec.melody, app.currentBar);
      var frag = document.createDocumentFragment();

      var headRow = document.createElement("div");
      headRow.className = "pr-row pr-head";
      var corner = document.createElement("div");
      corner.className = "pr-key pr-corner";
      corner.textContent = "音階";
      headRow.appendChild(corner);

      for (var s = 0; s < STEPS_PER_BAR; s++) {
        var hCell = document.createElement("div");
        hCell.className = "pr-step-num" + (s % 4 === 0 ? " beat" : "");
        hCell.textContent = (s % 4 === 0) ? String((s / 4) + 1) : "・";
        headRow.appendChild(hCell);
        app.headStepEls[s] = hCell;
      }
      frag.appendChild(headRow);

      for (var midi = NOTE_MAX; midi >= NOTE_MIN; midi--) {
        var black = isBlackKey(midi);
        var isC = (midi % 12 === 0);
        var row = document.createElement("div");
        row.className = "pr-row" + (black ? " black-row" : "") + (isC ? " c-row" : "");

        var keyBtn = document.createElement("button");
        keyBtn.type = "button";
        keyBtn.className = "pr-key" + (black ? " black" : "") + (isC ? " c-key" : "");
        keyBtn.textContent = S.midiToName(midi) + (black ? "" : " " + S.midiToDoremi(midi));
        (function (mVal) {
          keyBtn.addEventListener("click", function () { S.previewNote(mVal, 0.22); });
        })(midi);
        row.appendChild(keyBtn);

        for (var st = 0; st < STEPS_PER_BAR; st++) {
          var gIdx = barStart + st;
          var rawVal = sec.melody[gIdx];
          var effPitch = eff[st];
          var cell = document.createElement("button");
          cell.type = "button";
          cell.className = "pr-cell" + (st % 4 === 0 ? " beat-start" : "");

          if (rawVal === midi) {
            cell.classList.add("note-start");
            cell.textContent = S.midiToDoremi(midi);
          } else if (rawVal === S.NOTE_HOLD && effPitch === midi) {
            cell.classList.add("note-hold");
            cell.textContent = "━";
          }

          (function (stepVal, mVal) {
            cell.addEventListener("click", function () { onTapCell(stepVal, mVal); });
          })(st, midi);

          row.appendChild(cell);
          app.stepColEls[st].push(cell);
        }
        frag.appendChild(row);
      }

      var prevScroll = el.pianoScroll ? el.pianoScroll.scrollTop : 0;
      el.pianoGrid.innerHTML = "";
      el.pianoGrid.appendChild(frag);
      if (el.pianoScroll && prevScroll > 0) el.pianoScroll.scrollTop = prevScroll;
      updatePlayheadHighlight();
    }

    function renderAll() {
      renderHeaderControls();
      renderBarNavAndChord();
      renderPianoRoll();
    }

    function adjustBars(secName, delta) {
      pushUndo();
      if (secName === "intro") app.song.introBars = Math.max(0, Math.min(4, app.song.introBars + delta));
      else app.song.loopBars = Math.max(0, Math.min(16, app.song.loopBars + delta));
      onSongChanged();
    }

    function shiftCurrentBarOctave(semitones) {
      var sec = getSecData(app.activeSection);
      if (sec.bars <= 0) return;
      pushUndo();
      var start = app.currentBar * STEPS_PER_BAR;
      for (var i = start; i < start + STEPS_PER_BAR; i++) {
        if (sec.melody[i] > 0) {
          var nv = sec.melody[i] + semitones;
          if (nv >= NOTE_MIN && nv <= NOTE_MAX) sec.melody[i] = nv;
        }
      }
      onSongChanged();
    }

    function startPlayback(mode) {
      S.playSong(app.song, {
        sectionMode: mode,
        onStep: function (info) {
          app.playhead = info;
          if (app.followPlayhead && (app.activeSection !== info.section || app.currentBar !== info.bar)) {
            app.activeSection = info.section;
            app.currentBar = info.bar;
            renderAll();
          } else {
            updatePlayheadHighlight();
          }
        },
        onEnd: function () {
          app.playhead = null;
          updatePlayheadHighlight();
          setStatus("再生終了");
        }
      });
      setStatus(mode === "all" ? "通し再生中 (イントロ→ループ)" : (mode === "intro" ? "イントロ再生中" : "ループ再生中"));
    }

    function bindEvents() {
      if (el.songName) el.songName.addEventListener("input", function () {
        app.song.name = el.songName.value;
        saveSlotsToStorage();
        renderSlotSelect();
      });
      if (el.presetSelect) el.presetSelect.addEventListener("change", function () {
        var idx = el.presetSelect.value;
        if (idx === "") return;
        pushUndo();
        S.stop();
        app.playhead = null;
        app.song = normalizeSong(PRESET_SONGS[Number(idx)]);
        app.activeSection = app.song.loopBars > 0 ? "loop" : "intro";
        app.currentBar = 0;
        el.presetSelect.value = "";
        onSongChanged();
        setStatus("サンプルを読み込みました");
      });
      if (el.slotSelect) el.slotSelect.addEventListener("change", function () {
        S.stop();
        app.playhead = null;
        app.activeSlotIdx = Number(el.slotSelect.value) || 0;
        app.song = normalizeSong(app.slots[app.activeSlotIdx]);
        app.activeSection = app.song.loopBars > 0 ? "loop" : "intro";
        app.currentBar = 0;
        app.undoStack = [];
        onSongChanged();
        setStatus("スロット " + (app.activeSlotIdx + 1) + " を開きました");
      });
      if (el.btnSaveSlot) el.btnSaveSlot.addEventListener("click", function () {
        saveSlotsToStorage();
        renderSlotSelect();
        setStatus("ブラウザへ保存しました");
      });

      if (el.btnPlayAll) el.btnPlayAll.addEventListener("click", function () { startPlayback("all"); });
      if (el.btnPlayIntro) el.btnPlayIntro.addEventListener("click", function () { startPlayback("intro"); });
      if (el.btnPlayLoop) el.btnPlayLoop.addEventListener("click", function () { startPlayback("loop"); });
      if (el.btnStop) el.btnStop.addEventListener("click", function () {
        S.stop();
        app.playhead = null;
        updatePlayheadHighlight();
        setStatus("停止しました");
      });

      if (el.tabIntro) el.tabIntro.addEventListener("click", function () {
        app.activeSection = "intro"; app.currentBar = 0; app.chordPickerOpen = false; renderAll();
      });
      if (el.tabLoop) el.tabLoop.addEventListener("click", function () {
        app.activeSection = "loop"; app.currentBar = 0; app.chordPickerOpen = false; renderAll();
      });

      if (el.introBarsMinus) el.introBarsMinus.addEventListener("click", function () { adjustBars("intro", -1); });
      if (el.introBarsPlus) el.introBarsPlus.addEventListener("click", function () { adjustBars("intro", 1); });
      if (el.loopBarsMinus) el.loopBarsMinus.addEventListener("click", function () { adjustBars("loop", -1); });
      if (el.loopBarsPlus) el.loopBarsPlus.addEventListener("click", function () { adjustBars("loop", 1); });

      if (el.styleSelect) el.styleSelect.addEventListener("change", function () {
        pushUndo(); app.song.style = el.styleSelect.value; onSongChanged();
      });
      if (el.modeSelect) el.modeSelect.addEventListener("change", function () {
        pushUndo(); app.song.mode = el.modeSelect.value; onSongChanged();
      });
      if (el.bpmRange) el.bpmRange.addEventListener("input", function () {
        app.song.bpm = Number(el.bpmRange.value) || 138;
        app.arranged = S.refreshArrangement(app.song);
        saveSlotsToStorage();
        renderHeaderControls();
      });

      if (el.btnToolDraw) el.btnToolDraw.addEventListener("click", function () { app.toolMode = "draw"; renderHeaderControls(); });
      if (el.btnToolHold) el.btnToolHold.addEventListener("click", function () { app.toolMode = "hold"; renderHeaderControls(); });
      if (el.btnUndo) el.btnUndo.addEventListener("click", function () {
        if (app.undoStack.length === 0) return;
        app.song = normalizeSong(app.undoStack.pop());
        onSongChanged();
        setStatus("1手もどしました");
      });
      if (el.btnOctUp) el.btnOctUp.addEventListener("click", function () { shiftCurrentBarOctave(12); });
      if (el.btnOctDown) el.btnOctDown.addEventListener("click", function () { shiftCurrentBarOctave(-12); });

      if (el.btnCopyBar) el.btnCopyBar.addEventListener("click", function () {
        var sec = getSecData(app.activeSection);
        if (sec.bars <= 0) return;
        var s = app.currentBar * STEPS_PER_BAR;
        app.clipboardBar = { melody: sec.melody.slice(s, s + STEPS_PER_BAR), chord: sec.chords[app.currentBar] || "AUTO" };
        renderHeaderControls();
        setStatus((app.currentBar + 1) + "小節目をコピーしました");
      });
      if (el.btnPasteBar) el.btnPasteBar.addEventListener("click", function () {
        var sec = getSecData(app.activeSection);
        if (sec.bars <= 0 || !app.clipboardBar) return;
        pushUndo();
        var s = app.currentBar * STEPS_PER_BAR;
        for (var i = 0; i < STEPS_PER_BAR; i++) sec.melody[s + i] = app.clipboardBar.melody[i];
        sec.chords[app.currentBar] = app.clipboardBar.chord;
        onSongChanged();
        setStatus((app.currentBar + 1) + "小節目に貼り付けました");
      });
      if (el.btnClearBar) el.btnClearBar.addEventListener("click", function () {
        var sec = getSecData(app.activeSection);
        if (sec.bars <= 0) return;
        pushUndo();
        var s = app.currentBar * STEPS_PER_BAR;
        for (var i = 0; i < STEPS_PER_BAR; i++) sec.melody[s + i] = 0;
        sec.chords[app.currentBar] = "AUTO";
        onSongChanged();
        setStatus((app.currentBar + 1) + "小節目を消去しました");
      });

      if (el.barPrev) el.barPrev.addEventListener("click", function () {
        if (app.currentBar > 0) { app.currentBar--; app.chordPickerOpen = false; renderAll(); }
      });
      if (el.barNext) el.barNext.addEventListener("click", function () {
        var sec = getSecData(app.activeSection);
        if (app.currentBar < sec.bars - 1) { app.currentBar++; app.chordPickerOpen = false; renderAll(); }
      });
      if (el.chordBtn) el.chordBtn.addEventListener("click", function () {
        app.chordPickerOpen = !app.chordPickerOpen; renderBarNavAndChord();
      });

      if (el.chkFollow) el.chkFollow.addEventListener("change", function () { app.followPlayhead = el.chkFollow.checked; });
      if (el.chkZoom) el.chkZoom.addEventListener("change", function () {
        if (el.pianoGrid) el.pianoGrid.classList.toggle("zoomed", el.chkZoom.checked);
      });
      if (el.chkSlow) el.chkSlow.addEventListener("change", function () { S.setTempoRate(el.chkSlow.checked ? 0.6 : 1.0); });
      if (el.chkBoost) el.chkBoost.addEventListener("change", function () { S.setBoostMode(el.chkBoost.checked); });

      el.chToggles.forEach(function (chk) {
        chk.addEventListener("change", function () { S.setChannelMute(chk.getAttribute("data-ch"), !chk.checked); });
      });

      if (el.btnExport) el.btnExport.addEventListener("click", function () {
        if (el.exportBox) el.exportBox.value = JSON.stringify(app.song);
        setStatus("1行データを作成しました");
      });
      if (el.btnCopyExport) el.btnCopyExport.addEventListener("click", function () {
        if (!el.exportBox) return;
        if (!el.exportBox.value) el.exportBox.value = JSON.stringify(app.song);
        el.exportBox.select();
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(el.exportBox.value);
          else document.execCommand("copy");
          setStatus("クリップボードにコピーしました");
        } catch (e) { setStatus("枠内を全選択してコピーしてください"); }
      });
      if (el.btnImport) el.btnImport.addEventListener("click", function () {
        if (!el.exportBox || !el.exportBox.value.trim()) return;
        try {
          var parsed = JSON.parse(el.exportBox.value.trim());
          pushUndo(); S.stop(); app.playhead = null;
          app.song = normalizeSong(parsed);
          app.activeSection = app.song.loopBars > 0 ? "loop" : "intro";
          app.currentBar = 0;
          onSongChanged();
          setStatus("データを読み込みました");
        } catch (e) { setStatus("読込失敗: 正しい1行JSONデータか確認してください"); }
      });
    }

    loadSlots();
    app.song = normalizeSong(app.slots[0]);
    app.activeSection = app.song.loopBars > 0 ? "loop" : "intro";
    app.arranged = S.arrangeSong(app.song);
    populateStaticControls();
    bindEvents();
    renderAll();

    if (el.pianoScroll) {
      setTimeout(function () {
        el.pianoScroll.scrollTop = Math.max(0, Math.floor((el.pianoScroll.scrollHeight - el.pianoScroll.clientHeight) * 0.42));
      }, 20);
    }
  }

  global.BreakerMusicEditor = { init: initEditor, PRESET_SONGS: PRESET_SONGS };
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initEditor);
    else initEditor();
  }
})(typeof window !== "undefined" ? window : globalThis);
