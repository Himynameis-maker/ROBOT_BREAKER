(function (root) {
  "use strict";

  const STORAGE_KEY = "breaker_touch_controller_v1";

  const DEFAULT_CONFIG = {
    stickSize: 136,
    stickDead: 8,
    stickRange: 30,
    hammerSize: 96,
    stickX: 0,
    stickY: 0,
    hammerX: 0,
    hammerY: 0
  };

  // 18x18 斜め45度ドット絵ハンマー（対角軸 x+y=17 に対して完全対称・柄ズレ防止設計）
  const HAMMER_ICON_ROWS = [
    "..................",
    "........OOO.......",
    ".......OWWWO......",
    "......OWWWWWOO....",
    "......OWWWWWWWO...",
    ".......OWWWWWWO...",
    "........OWWGGWWO..",
    "........OBBGGGWWO.",
    ".......OBBCGGGGWO.",
    "......OBBCOOGGGGO.",
    ".....OBBCO..OGGO..",
    "....OBBCO....OO...",
    "...OBBCO..........",
    "..OBBCO...........",
    ".OBBCO............",
    ".OBCO.............",
    "..OO..............",
    ".................."
  ];

  const HAMMER_ICON_PALETTE = {
    O: "#111215",
    W: "#ffffff",
    G: "#bfc7d4",
    B: "#fff1c4",
    C: "#e3b55a"
  };

  function getDirConstants() {
    const g = root.BreakerGame || {};
    return {
      RIGHT: g.RIGHT != null ? g.RIGHT : 1,
      LEFT: g.LEFT != null ? g.LEFT : 2,
      DOWN: g.DOWN != null ? g.DOWN : 4,
      UP: g.UP != null ? g.UP : 8,
      HAMMER: g.HAMMER != null ? g.HAMMER : 16
    };
  }

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
  }

  function sanitizeConfig(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const stickSize = clamp(Math.round(Number(src.stickSize) || DEFAULT_CONFIG.stickSize), 96, 184);
    const stickRange = clamp(Math.round(Number(src.stickRange) || DEFAULT_CONFIG.stickRange), 16, 56);
    const stickDead = clamp(
      Math.round(src.stickDead != null ? Number(src.stickDead) : DEFAULT_CONFIG.stickDead),
      2,
      Math.max(4, stickRange - 4)
    );
    const hammerSize = clamp(Math.round(Number(src.hammerSize) || DEFAULT_CONFIG.hammerSize), 68, 144);
    const stickX = Number.isFinite(Number(src.stickX)) ? Math.round(Number(src.stickX)) : 0;
    const stickY = Number.isFinite(Number(src.stickY)) ? Math.round(Number(src.stickY)) : 0;
    const hammerX = Number.isFinite(Number(src.hammerX)) ? Math.round(Number(src.hammerX)) : 0;
    const hammerY = Number.isFinite(Number(src.hammerY)) ? Math.round(Number(src.hammerY)) : 0;
    return {
      stickSize,
      stickDead,
      stickRange,
      hammerSize,
      stickX,
      stickY,
      hammerX,
      hammerY
    };
  }

  function loadConfig() {
    try {
      const text = root.localStorage.getItem(STORAGE_KEY);
      if (!text) return Object.assign({}, DEFAULT_CONFIG);
      return sanitizeConfig(JSON.parse(text));
    } catch (_) {
      return Object.assign({}, DEFAULT_CONFIG);
    }
  }

  function saveConfig(cfg) {
    try {
      root.localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeConfig(cfg)));
    } catch (_) {}
  }

  function createHammerSvgElement() {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 18 18");
    svg.setAttribute("shape-rendering", "crispEdges");
    svg.setAttribute("class", "nes-hammer-svg");
    svg.setAttribute("aria-hidden", "true");

    for (let y = 0; y < HAMMER_ICON_ROWS.length; y++) {
      const row = HAMMER_ICON_ROWS[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        const fill = HAMMER_ICON_PALETTE[ch];
        if (!fill) continue;
        const rect = document.createElementNS(ns, "rect");
        rect.setAttribute("x", String(x));
        rect.setAttribute("y", String(y));
        rect.setAttribute("width", "1");
        rect.setAttribute("height", "1");
        rect.setAttribute("fill", fill);
        svg.appendChild(rect);
      }
    }
    return svg;
  }

  function injectStyles() {
    if (document.getElementById("breaker-touch-controller-style")) return;
    const style = document.createElement("style");
    style.id = "breaker-touch-controller-style";
    style.textContent = `
      .controls-area.nes-controls-area {
        width: 100%;
        max-width: 580px;
        min-height: 176px;
        margin: 0 auto;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        padding: 14px 12px 24px;
        pointer-events: none;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        position: relative;
        z-index: 30;
      }
      .nes-unit {
        position: relative;
        pointer-events: auto;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
        -webkit-touch-callout: none;
        -webkit-tap-highlight-color: transparent;
        flex-shrink: 0;
        will-change: transform;
      }
      .nes-stick-unit {
        padding: 7px;
        border-radius: 14px;
        background: #c8ccd2;
        border: 3px solid #111215;
        box-shadow:
          inset 2px 2px 0 #eaedf2,
          inset -2px -2px 0 #848890,
          0 5px 0 #111215,
          0 8px 16px rgba(0, 0, 0, 0.45);
      }
      .nes-stick-unit .stick-base {
        position: relative;
        width: 136px;
        height: 136px;
        border-radius: 50%;
        background: radial-gradient(circle at 50% 45%, #373a42 0%, #24262c 74%, #181a1f 100%);
        border: 3px solid #111215;
        box-shadow:
          inset 0 4px 10px rgba(0, 0, 0, 0.72),
          0 1px 0 #eaedf2;
        touch-action: none;
        user-select: none;
        -webkit-user-select: none;
      }
      .nes-stick-unit .stick-cross-h,
      .nes-stick-unit .stick-cross-v {
        position: absolute;
        background: rgba(255, 255, 255, 0.08);
        pointer-events: none;
      }
      .nes-stick-unit .stick-cross-h {
        left: 16%;
        right: 16%;
        top: 50%;
        height: 4px;
        margin-top: -2px;
        border-radius: 2px;
      }
      .nes-stick-unit .stick-cross-v {
        top: 16%;
        bottom: 16%;
        left: 50%;
        width: 4px;
        margin-left: -2px;
        border-radius: 2px;
      }
      .nes-dir-mark {
        position: absolute;
        width: 0;
        height: 0;
        pointer-events: none;
        opacity: 0.42;
        transition: opacity 0.04s linear;
      }
      .nes-dir-u {
        top: 6px;
        left: 50%;
        margin-left: -6px;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-bottom: 8px solid #cfd3d9;
      }
      .nes-dir-d {
        bottom: 6px;
        left: 50%;
        margin-left: -6px;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-top: 8px solid #cfd3d9;
      }
      .nes-dir-l {
        left: 6px;
        top: 50%;
        margin-top: -6px;
        border-top: 6px solid transparent;
        border-bottom: 6px solid transparent;
        border-right: 8px solid #cfd3d9;
      }
      .nes-dir-r {
        right: 6px;
        top: 50%;
        margin-top: -6px;
        border-top: 6px solid transparent;
        border-bottom: 6px solid transparent;
        border-left: 8px solid #cfd3d9;
      }
      .nes-stick-unit.dir-u .nes-dir-u { opacity: 1; border-bottom-color: #ff4b42; }
      .nes-stick-unit.dir-d .nes-dir-d { opacity: 1; border-top-color: #ff4b42; }
      .nes-stick-unit.dir-l .nes-dir-l { opacity: 1; border-right-color: #ff4b42; }
      .nes-stick-unit.dir-r .nes-dir-r { opacity: 1; border-left-color: #ff4b42; }

      .nes-guide-ring {
        position: absolute;
        left: 50%;
        top: 50%;
        border-radius: 50%;
        pointer-events: none;
        display: none;
        transform: translate(-50%, -50%);
      }
      .nes-guide-dead {
        border: 2px dashed rgba(255, 224, 92, 0.85);
        background: rgba(255, 224, 92, 0.08);
      }
      .nes-guide-range {
        border: 2px dashed rgba(94, 214, 255, 0.78);
      }
      .nes-stick-unit.show-guides .nes-guide-ring {
        display: block;
      }

      .nes-stick-unit .stick-knob {
        position: absolute;
        left: 50%;
        top: 50%;
        width: 56px;
        height: 56px;
        margin-left: -28px;
        margin-top: -28px;
        border-radius: 50%;
        background: radial-gradient(circle at 38% 34%, #4c505a 0%, #23252b 58%, #121317 100%);
        border: 3px solid #0d0e12;
        box-shadow:
          inset 0 2px 3px rgba(255, 255, 255, 0.22),
          inset 0 -3px 6px rgba(0, 0, 0, 0.7),
          0 4px 8px rgba(0, 0, 0, 0.65);
        pointer-events: none;
      }
      .nes-stick-unit .stick-knob::after {
        content: "";
        position: absolute;
        left: 22%;
        top: 22%;
        right: 22%;
        bottom: 22%;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.12);
        background: radial-gradient(circle at 60% 65%, #2d3038 0%, #15171c 80%);
      }

      .nes-hammer-unit {
        padding: 9px;
        border-radius: 14px;
        background: #c8ccd2;
        border: 3px solid #111215;
        box-shadow:
          inset 2px 2px 0 #eaedf2,
          inset -2px -2px 0 #848890,
          0 5px 0 #111215,
          0 8px 16px rgba(0, 0, 0, 0.45);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
      }
      .nes-hammer-unit .action-btn.nes-hammer-btn {
        width: 96px;
        height: 96px;
        border-radius: 50%;
        background: radial-gradient(circle at 36% 30%, #ff5c52 0%, #de241b 55%, #9d130d 100%);
        border: 3px solid #111215;
        box-shadow:
          inset 0 3px 0 rgba(255, 255, 255, 0.34),
          0 4px 0 #5b0905;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        margin: 0;
        pointer-events: none;
        transform: translateY(-1px);
        transition: transform 0.04s linear, box-shadow 0.04s linear;
      }
      .nes-hammer-unit .action-btn.nes-hammer-btn.pressed {
        transform: translateY(3px);
        background: radial-gradient(circle at 42% 40%, #ff736a 0%, #c91e16 60%, #860e09 100%);
        box-shadow:
          inset 0 2px 4px rgba(0, 0, 0, 0.35),
          0 1px 0 #5b0905;
      }
      .nes-hammer-svg {
        width: 66%;
        height: 66%;
        display: block;
        pointer-events: none;
        filter: drop-shadow(0 2px 0 rgba(70, 8, 5, 0.65));
      }

      .nes-unit.edit-move {
        outline: 3px dashed #ffd84d;
        outline-offset: 4px;
        cursor: grab;
      }
      .nes-unit.edit-move.dragging {
        cursor: grabbing;
        outline-color: #5ee6ff;
        z-index: 60;
      }
      .nes-drag-tag {
        display: none;
        position: absolute;
        top: -12px;
        left: 50%;
        transform: translateX(-50%);
        background: #ffd84d;
        color: #111215;
        font-size: 10px;
        font-weight: 800;
        letter-spacing: 0.04em;
        padding: 1px 6px;
        border-radius: 4px;
        border: 2px solid #111215;
        white-space: nowrap;
        pointer-events: none;
        z-index: 5;
      }
      .nes-unit.edit-move .nes-drag-tag {
        display: block;
      }

      .nes-pad-panel {
        position: fixed;
        top: 8px;
        left: 50%;
        transform: translateX(-50%);
        width: calc(100% - 16px);
        max-width: 540px;
        background: rgba(28, 30, 36, 0.94);
        border: 3px solid #c8ccd2;
        box-shadow: 0 0 0 2px #111215, 0 12px 30px rgba(0, 0, 0, 0.72);
        border-radius: 10px;
        padding: 10px 12px;
        color: #eef1f6;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        gap: 8px;
        touch-action: manipulation;
        user-select: none;
        -webkit-user-select: none;
        transition: opacity 0.12s ease;
      }
      .nes-pad-panel.hidden {
        display: none !important;
      }
      .nes-pad-panel.is-ghost {
        opacity: 0.2;
        pointer-events: none;
      }
      .nes-pad-head {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 6px;
        border-bottom: 1px solid #484d58;
        padding-bottom: 6px;
      }
      .nes-pad-title {
        font-size: 0.85rem;
        font-weight: bold;
        color: #ffd84d;
      }
      .nes-pad-tabs {
        display: flex;
        gap: 5px;
        align-items: center;
      }
      .nes-pad-btn {
        background: #363a44;
        color: #eef1f6;
        border: 2px solid #111215;
        border-radius: 6px;
        padding: 4px 8px;
        font-size: 0.76rem;
        font-weight: bold;
        cursor: pointer;
        touch-action: manipulation;
        user-select: none;
        -webkit-user-select: none;
      }
      .nes-pad-btn.active {
        background: #d9231a;
        color: #fff;
        border-color: #111215;
      }
      .nes-pad-btn.done {
        background: #2f6fed;
        color: #fff;
      }
      .nes-pad-tip {
        font-size: 0.74rem;
        color: #c8d2e4;
        line-height: 1.35;
      }
      .nes-pad-sliders {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px 12px;
      }
      @media (max-width: 390px) {
        .nes-pad-sliders {
          grid-template-columns: 1fr;
          gap: 6px;
        }
      }
      .nes-pad-field {
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .nes-pad-field-top {
        display: flex;
        justify-content: space-between;
        font-size: 0.74rem;
        color: #dce3f0;
      }
      .nes-pad-field-val {
        color: #7ee3ff;
        font-weight: bold;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
      .nes-pad-range {
        width: 100%;
        margin: 0;
        accent-color: #e0241b;
        touch-action: pan-x;
      }
      .nes-pad-foot {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        align-items: center;
        gap: 6px;
        border-top: 1px solid #484d58;
        padding-top: 6px;
      }
      .nes-pad-pos-info {
        font-size: 0.7rem;
        color: #9ba7be;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      }
    `;
    document.head.appendChild(style);
  }

  class TouchController {
    constructor(options) {
      injectStyles();
      const opts = options || {};
      this.stickBase = opts.stickBase;
      this.stickKnob = opts.stickKnob;
      this.hammerBtn = opts.hammerBtn;
      this.controlsArea = opts.controlsArea || (this.stickBase ? this.stickBase.closest(".controls-area") : null);
      this.toggleBtn = opts.toggleBtn || null;
      this.onUnlockAudio = typeof opts.onUnlockAudio === "function" ? opts.onUnlockAudio : function () {};
      this.isInputActive = typeof opts.isInputActive === "function" ? opts.isInputActive : function () { return true; };

      this.config = loadConfig();
      this.appliedStickX = 0;
      this.appliedStickY = 0;
      this.appliedHammerX = 0;
      this.appliedHammerY = 0;

      this.stickBits = 0;
      this.hammerDown = false;

      this.stickPointerId = null;
      this.hammerPointerId = null;
      this.dragStickPointerId = null;
      this.dragHammerPointerId = null;
      this.dragStart = null;

      this.configOpen = false;
      this.editSubMode = "move"; // "move" | "test"

      this.buildDom();
      this.buildConfigPanel();
      this.bindEvents();
      this.applyLayout();
      this.updateToggleButtonState();
    }

    buildDom() {
      if (this.controlsArea) {
        this.controlsArea.classList.add("nes-controls-area");
      }

      // スティック側：孤立ユニットで包む
      this.stickUnit = document.createElement("div");
      this.stickUnit.className = "nes-unit nes-stick-unit";
      this.stickBase.parentNode.insertBefore(this.stickUnit, this.stickBase);
      this.stickUnit.appendChild(this.stickBase);

      const stickTag = document.createElement("div");
      stickTag.className = "nes-drag-tag";
      stickTag.textContent = "DRAG";
      this.stickUnit.appendChild(stickTag);

      // 方向ランプと感度ガイド円を stickBase 内へ追加
      ["u", "d", "l", "r"].forEach(d => {
        const arrow = document.createElement("div");
        arrow.className = "nes-dir-mark nes-dir-" + d;
        this.stickBase.insertBefore(arrow, this.stickKnob);
      });

      this.rangeGuide = document.createElement("div");
      this.rangeGuide.className = "nes-guide-ring nes-guide-range";
      this.stickBase.insertBefore(this.rangeGuide, this.stickKnob);

      this.deadGuide = document.createElement("div");
      this.deadGuide.className = "nes-guide-ring nes-guide-dead";
      this.stickBase.insertBefore(this.deadGuide, this.stickKnob);

      // ハンマー側：文字を消し、角丸NESグレー台座＋赤丸＋斜めドットハンマーSVGへ構築
      this.hammerUnit = document.createElement("div");
      this.hammerUnit.className = "nes-unit nes-hammer-unit";
      this.hammerBtn.parentNode.insertBefore(this.hammerUnit, this.hammerBtn);
      this.hammerUnit.appendChild(this.hammerBtn);

      this.hammerBtn.classList.add("nes-hammer-btn");
      this.hammerBtn.textContent = "";
      this.hammerBtn.appendChild(createHammerSvgElement());

      const hammerTag = document.createElement("div");
      hammerTag.className = "nes-drag-tag";
      hammerTag.textContent = "DRAG";
      this.hammerUnit.appendChild(hammerTag);
    }

    buildConfigPanel() {
      this.panel = document.createElement("div");
      this.panel.className = "nes-pad-panel hidden";
      this.panel.innerHTML = `
        <div class="nes-pad-head">
          <div class="nes-pad-title">操作カスタム（NES）</div>
          <div class="nes-pad-tabs">
            <button type="button" class="nes-pad-btn active" data-submode="move">位置を動かす</button>
            <button type="button" class="nes-pad-btn" data-submode="test">試運転テスト</button>
            <button type="button" class="nes-pad-btn done" data-action="close">完了</button>
          </div>
        </div>
        <div class="nes-pad-tip" data-role="tip">
          下のスティックやハンマーボタンを直接指でドラッグして位置を調整できます。
        </div>
        <div class="nes-pad-sliders">
          <label class="nes-pad-field">
            <div class="nes-pad-field-top">
              <span>スティック大きさ</span>
              <span class="nes-pad-field-val" data-val="stickSize">136px</span>
            </div>
            <input class="nes-pad-range" type="range" min="96" max="184" step="2" data-key="stickSize">
          </label>
          <label class="nes-pad-field">
            <div class="nes-pad-field-top">
              <span>ハンマー大きさ</span>
              <span class="nes-pad-field-val" data-val="hammerSize">96px</span>
            </div>
            <input class="nes-pad-range" type="range" min="68" max="144" step="2" data-key="hammerSize">
          </label>
          <label class="nes-pad-field">
            <div class="nes-pad-field-top">
              <span>反応の早さ(遊び)</span>
              <span class="nes-pad-field-val" data-val="stickDead">8px</span>
            </div>
            <input class="nes-pad-range" type="range" min="2" max="24" step="1" data-key="stickDead">
          </label>
          <label class="nes-pad-field">
            <div class="nes-pad-field-top">
              <span>倒す距離(可動域)</span>
              <span class="nes-pad-field-val" data-val="stickRange">30px</span>
            </div>
            <input class="nes-pad-range" type="range" min="16" max="56" step="1" data-key="stickRange">
          </label>
        </div>
        <div class="nes-pad-foot">
          <span class="nes-pad-pos-info" data-role="posInfo">S(0,0) H(0,0)</span>
          <div style="display:flex;gap:6px;">
            <button type="button" class="nes-pad-btn" data-action="resetPos">位置リセット</button>
            <button type="button" class="nes-pad-btn" data-action="resetAll">すべて初期値</button>
          </div>
        </div>
      `;
      document.body.appendChild(this.panel);

      this.tipEl = this.panel.querySelector('[data-role="tip"]');
      this.posInfoEl = this.panel.querySelector('[data-role="posInfo"]');
      this.subModeBtns = Array.from(this.panel.querySelectorAll("[data-submode]"));
      this.rangeInputs = {};
      this.valEls = {};

      Array.from(this.panel.querySelectorAll("input[data-key]")).forEach(inp => {
        const key = inp.getAttribute("data-key");
        this.rangeInputs[key] = inp;
        this.valEls[key] = this.panel.querySelector('[data-val="' + key + '"]');
        inp.addEventListener("input", () => {
          this.onUnlockAudio();
          this.config[key] = Number(inp.value);
          if (key === "stickRange" && this.config.stickDead > this.config.stickRange - 4) {
            this.config.stickDead = Math.max(2, this.config.stickRange - 4);
          }
          if (key === "stickDead" && this.config.stickDead > this.config.stickRange - 4) {
            this.config.stickRange = clamp(this.config.stickDead + 4, 16, 56);
          }
          this.config = sanitizeConfig(this.config);
          saveConfig(this.config);
          this.applyLayout();
          this.syncPanelControls();
        });
      });

      this.panel.addEventListener("click", e => {
        const subBtn = e.target.closest("[data-submode]");
        if (subBtn) {
          this.setEditSubMode(subBtn.getAttribute("data-submode"));
          return;
        }
        const actBtn = e.target.closest("[data-action]");
        if (!actBtn) return;
        const act = actBtn.getAttribute("data-action");
        if (act === "close") {
          this.closeConfig();
        } else if (act === "resetPos") {
          this.config.stickX = 0;
          this.config.stickY = 0;
          this.config.hammerX = 0;
          this.config.hammerY = 0;
          saveConfig(this.config);
          this.applyLayout();
          this.syncPanelControls();
        } else if (act === "resetAll") {
          this.config = Object.assign({}, DEFAULT_CONFIG);
          saveConfig(this.config);
          this.applyLayout();
          this.syncPanelControls();
        }
      });

      this.syncPanelControls();
    }

    syncPanelControls() {
      const c = this.config;
      Object.keys(this.rangeInputs).forEach(k => {
        this.rangeInputs[k].value = String(c[k]);
        if (this.valEls[k]) {
          this.valEls[k].textContent = c[k] + "px";
        }
      });
      this.posInfoEl.textContent =
        "位置 S(" + c.stickX + "," + c.stickY + ") H(" + c.hammerX + "," + c.hammerY + ")";
    }

    setEditSubMode(subMode) {
      this.editSubMode = subMode === "test" ? "test" : "move";
      this.resetInputs();
      this.subModeBtns.forEach(b => {
        b.classList.toggle("active", b.getAttribute("data-submode") === this.editSubMode);
      });
      if (this.editSubMode === "move") {
        this.tipEl.textContent = "下のスティックやハンマーボタンを直接指でドラッグして位置を調整できます。";
      } else {
        this.tipEl.textContent = "試運転中：黄色＝遊び範囲、水色＝最大可動域。実際に触って感度を確かめられます。";
      }
      this.updateEditVisualStates();
    }

    updateEditVisualStates() {
      const isMove = this.configOpen && this.editSubMode === "move";
      this.stickUnit.classList.toggle("edit-move", isMove);
      this.hammerUnit.classList.toggle("edit-move", isMove);
      this.stickUnit.classList.toggle("show-guides", this.configOpen);
    }

    updateToggleButtonState() {
      if (this.toggleBtn) {
        this.toggleBtn.classList.toggle("active", this.configOpen);
      }
    }

    openConfig() {
      this.config = loadConfig();
      this.configOpen = true;
      this.resetInputs();
      this.panel.classList.remove("hidden");
      this.setEditSubMode("move");
      this.applyLayout();
      this.syncPanelControls();
      this.updateToggleButtonState();
    }

    closeConfig() {
      this.configOpen = false;
      this.dragStickPointerId = null;
      this.dragHammerPointerId = null;
      this.dragStart = null;
      this.panel.classList.add("hidden");
      this.panel.classList.remove("is-ghost");
      this.stickUnit.classList.remove("dragging");
      this.hammerUnit.classList.remove("dragging");
      this.resetInputs();
      this.updateEditVisualStates();
      this.updateToggleButtonState();
    }

    toggleConfig() {
      if (this.configOpen) this.closeConfig();
      else this.openConfig();
    }

    computeClampedOffset(unitEl, targetX, targetY, currentAppliedX, currentAppliedY) {
      const rect = unitEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        return { x: targetX, y: targetY, valid: false };
      }
      const baseLeft = rect.left - currentAppliedX;
      const baseTop = rect.top - currentAppliedY;
      const vw = root.innerWidth || document.documentElement.clientWidth || 375;
      const vh = root.innerHeight || document.documentElement.clientHeight || 667;
      const pad = 6;
      const minX = pad - baseLeft;
      const maxX = (vw - pad - rect.width) - baseLeft;
      const minY = 44 - baseTop;
      const maxY = (vh - pad - rect.height) - baseTop;
      return {
        x: Math.round(clamp(targetX, Math.min(minX, maxX), Math.max(minX, maxX))),
        y: Math.round(clamp(targetY, Math.min(minY, maxY), Math.max(minY, maxY))),
        valid: true
      };
    }

    applyLayout() {
      const c = this.config;
      const knobSize = Math.max(36, Math.round(c.stickSize * 0.41));

      this.stickBase.style.width = c.stickSize + "px";
      this.stickBase.style.height = c.stickSize + "px";
      this.stickKnob.style.width = knobSize + "px";
      this.stickKnob.style.height = knobSize + "px";
      this.stickKnob.style.marginLeft = -Math.round(knobSize / 2) + "px";
      this.stickKnob.style.marginTop = -Math.round(knobSize / 2) + "px";

      const effRange = c.stickRange;
      const effDead = Math.min(c.stickDead, Math.max(2, effRange - 4));
      this.rangeGuide.style.width = (effRange * 2) + "px";
      this.rangeGuide.style.height = (effRange * 2) + "px";
      this.deadGuide.style.width = (effDead * 2) + "px";
      this.deadGuide.style.height = (effDead * 2) + "px";

      this.hammerBtn.style.width = c.hammerSize + "px";
      this.hammerBtn.style.height = c.hammerSize + "px";

      if (this.controlsArea) {
        const minH = Math.max(172, Math.max(c.stickSize, c.hammerSize) + 46);
        this.controlsArea.style.minHeight = minH + "px";
      }

      const sClamped = this.computeClampedOffset(
        this.stickUnit, c.stickX, c.stickY, this.appliedStickX, this.appliedStickY
      );
      const hClamped = this.computeClampedOffset(
        this.hammerUnit, c.hammerX, c.hammerY, this.appliedHammerX, this.appliedHammerY
      );

      if (sClamped.valid) {
        this.appliedStickX = sClamped.x;
        this.appliedStickY = sClamped.y;
        this.stickUnit.style.transform = "translate3d(" + sClamped.x + "px, " + sClamped.y + "px, 0)";
      }
      if (hClamped.valid) {
        this.appliedHammerX = hClamped.x;
        this.appliedHammerY = hClamped.y;
        this.hammerUnit.style.transform = "translate3d(" + hClamped.x + "px, " + hClamped.y + "px, 0)";
      }
    }

    refreshLayout() {
      this.config = loadConfig();
      this.applyLayout();
      if (this.configOpen) {
        this.syncPanelControls();
      }
    }

    updateGhostOverlay(unitEl) {
      if (!this.configOpen || this.panel.classList.contains("hidden")) return;
      const pRect = this.panel.getBoundingClientRect();
      const uRect = unitEl.getBoundingClientRect();
      const overlap = !(uRect.right < pRect.left || uRect.left > pRect.right || uRect.bottom < pRect.top || uRect.top > pRect.bottom);
      this.panel.classList.toggle("is-ghost", overlap);
    }

    updateStickFromPoint(clientX, clientY) {
      const { RIGHT, LEFT, DOWN, UP } = getDirConstants();
      const rect = this.stickBase.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;
      const dist = Math.hypot(dx, dy);

      const maxR = this.config.stickRange;
      const deadR = Math.min(this.config.stickDead, Math.max(2, maxR - 4));

      if (dist > maxR && dist > 0) {
        dx = (dx / dist) * maxR;
        dy = (dy / dist) * maxR;
      }
      this.stickKnob.style.transform = "translate3d(" + dx.toFixed(1) + "px, " + dy.toFixed(1) + "px, 0)";

      if (dist < deadR) {
        this.stickBits = 0;
      } else if (Math.abs(dx) >= Math.abs(dy)) {
        this.stickBits = dx > 0 ? RIGHT : LEFT;
      } else {
        this.stickBits = dy > 0 ? DOWN : UP;
      }
      this.updateStickDirectionLights();
    }

    updateStickDirectionLights() {
      const { RIGHT, LEFT, DOWN, UP } = getDirConstants();
      this.stickUnit.classList.toggle("dir-u", (this.stickBits & UP) !== 0);
      this.stickUnit.classList.toggle("dir-d", (this.stickBits & DOWN) !== 0);
      this.stickUnit.classList.toggle("dir-l", (this.stickBits & LEFT) !== 0);
      this.stickUnit.classList.toggle("dir-r", (this.stickBits & RIGHT) !== 0);
    }

    resetStick() {
      this.stickPointerId = null;
      this.stickBits = 0;
      this.stickKnob.style.transform = "translate3d(0px, 0px, 0)";
      this.updateStickDirectionLights();
    }

    setHammerPressed(on) {
      this.hammerDown = !!on;
      this.hammerBtn.classList.toggle("pressed", this.hammerDown);
    }

    resetInputs() {
      this.resetStick();
      this.hammerPointerId = null;
      this.setHammerPressed(false);
    }

    getBits() {
      if (!this.isInputActive()) return 0;
      if (this.configOpen && this.editSubMode === "move") return 0;
      const { HAMMER } = getDirConstants();
      return this.stickBits | (this.hammerDown ? HAMMER : 0);
    }

    bindEvents() {
      if (this.toggleBtn) {
        this.toggleBtn.addEventListener("click", () => {
          this.onUnlockAudio();
          this.toggleConfig();
          this.toggleBtn.blur();
        });
      }

      // スティック側タッチ（通常操作 / 配置ドラッグで完全独立）
      this.stickUnit.addEventListener("pointerdown", e => {
        if (!this.isInputActive()) return;
        e.preventDefault();
        e.stopPropagation();
        this.onUnlockAudio();

        if (this.configOpen && this.editSubMode === "move") {
          this.dragStickPointerId = e.pointerId;
          this.stickUnit.classList.add("dragging");
          this.dragStickStart = {
            cx: e.clientX,
            cy: e.clientY,
            ox: this.appliedStickX,
            oy: this.appliedStickY
          };
          if (this.stickUnit.setPointerCapture) {
            try { this.stickUnit.setPointerCapture(e.pointerId); } catch (_) {}
          }
          this.updateGhostOverlay(this.stickUnit);
          return;
        }

        this.stickPointerId = e.pointerId;
        if (this.stickUnit.setPointerCapture) {
          try { this.stickUnit.setPointerCapture(e.pointerId); } catch (_) {}
        }
        this.updateStickFromPoint(e.clientX, e.clientY);
      });

      this.stickUnit.addEventListener("pointermove", e => {
        if (this.configOpen && this.editSubMode === "move" && e.pointerId === this.dragStickPointerId && this.dragStickStart) {
          e.preventDefault();
          const nx = this.dragStickStart.ox + (e.clientX - this.dragStickStart.cx);
          const ny = this.dragStickStart.oy + (e.clientY - this.dragStickStart.cy);
          const clamped = this.computeClampedOffset(
            this.stickUnit, nx, ny, this.appliedStickX, this.appliedStickY
          );
          if (clamped.valid) {
            this.config.stickX = clamped.x;
            this.config.stickY = clamped.y;
            this.applyLayout();
            this.syncPanelControls();
            this.updateGhostOverlay(this.stickUnit);
          }
          return;
        }
        if (e.pointerId !== this.stickPointerId) return;
        e.preventDefault();
        this.updateStickFromPoint(e.clientX, e.clientY);
      });

      const endStick = e => {
        if (e.pointerId === this.dragStickPointerId) {
          this.dragStickPointerId = null;
          this.dragStickStart = null;
          this.stickUnit.classList.remove("dragging");
          this.panel.classList.remove("is-ghost");
          saveConfig(this.config);
        }
        if (e.pointerId === this.stickPointerId) {
          this.resetStick();
        }
      };
      this.stickUnit.addEventListener("pointerup", endStick);
      this.stickUnit.addEventListener("pointercancel", endStick);

      // ハンマー側タッチ（通常操作 / 配置ドラッグで完全独立）
      this.hammerUnit.addEventListener("pointerdown", e => {
        if (!this.isInputActive()) return;
        e.preventDefault();
        e.stopPropagation();
        this.onUnlockAudio();

        if (this.configOpen && this.editSubMode === "move") {
          this.dragHammerPointerId = e.pointerId;
          this.hammerUnit.classList.add("dragging");
          this.dragHammerStart = {
            cx: e.clientX,
            cy: e.clientY,
            ox: this.appliedHammerX,
            oy: this.appliedHammerY
          };
          if (this.hammerUnit.setPointerCapture) {
            try { this.hammerUnit.setPointerCapture(e.pointerId); } catch (_) {}
          }
          this.updateGhostOverlay(this.hammerUnit);
          return;
        }

        this.hammerPointerId = e.pointerId;
        if (this.hammerUnit.setPointerCapture) {
          try { this.hammerUnit.setPointerCapture(e.pointerId); } catch (_) {}
        }
        this.setHammerPressed(true);
      });

      this.hammerUnit.addEventListener("pointermove", e => {
        if (this.configOpen && this.editSubMode === "move" && e.pointerId === this.dragHammerPointerId && this.dragHammerStart) {
          e.preventDefault();
          const nx = this.dragHammerStart.ox + (e.clientX - this.dragHammerStart.cx);
          const ny = this.dragHammerStart.oy + (e.clientY - this.dragHammerStart.cy);
          const clamped = this.computeClampedOffset(
            this.hammerUnit, nx, ny, this.appliedHammerX, this.appliedHammerY
          );
          if (clamped.valid) {
            this.config.hammerX = clamped.x;
            this.config.hammerY = clamped.y;
            this.applyLayout();
            this.syncPanelControls();
            this.updateGhostOverlay(this.hammerUnit);
          }
        }
      });

      const endHammer = e => {
        if (e.pointerId === this.dragHammerPointerId) {
          this.dragHammerPointerId = null;
          this.dragHammerStart = null;
          this.hammerUnit.classList.remove("dragging");
          this.panel.classList.remove("is-ghost");
          saveConfig(this.config);
        }
        if (e.pointerId === this.hammerPointerId) {
          this.hammerPointerId = null;
          this.setHammerPressed(false);
        }
      };
      this.hammerUnit.addEventListener("pointerup", endHammer);
      this.hammerUnit.addEventListener("pointercancel", endHammer);

      root.addEventListener("resize", () => {
        this.applyLayout();
      });
    }
  }

  root.BreakerTouchController = {
    STORAGE_KEY,
    DEFAULT_CONFIG,
    TouchController,
    create(options) {
      return new TouchController(options);
    }
  };
})(window);
