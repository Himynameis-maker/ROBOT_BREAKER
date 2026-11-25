(function (root) {
  "use strict";

  const G = (typeof module !== "undefined" && module.exports && !root.BreakerGame)
    ? Object.assign(
        {},
        require("./constants.js"),
        require("./actor_stepper.js"),
        require("./hunter_ai.js"),
        require("./enemy_ai.js")
      )
    : (root.BreakerGame || {});

  const {
    RIGHT,
    LEFT,
    DOWN,
    UP,
    HAMMER,
    COLLAPSE_STAGE_FRAMES,
    COLLAPSE_TOTAL_FRAMES,
    COLLAPSE_HIT_FRAMES,
    TILE,
    isBreakableTile,
    isClearTargetTile,
    isLadderTile,
    isCrumblingLadderTile,
    isDoorOpeningTile,
    isDoorRelatedTile,
    isHoleTile,
    isSameLadderType,
    isEdgeSafeCol,
    getPillarFallPayload,
    Actor,
    ActorStepper,
    HunterAI,
    EnemyActor,
    EnemyAI
  } = G;

  function normalizeTimedBombSec(sec) {
    const n = Number(sec);
    if (n === 15 || n === 30 || n === 45 || n === 60) {
      return n;
    }
    return 30;
  }

  function isBattleCountedTile(t) {
    return t === TILE.WALL_1 ||
      t === TILE.WALL_2 || t === 0x91 ||
      t === TILE.WALL_3 || t === 0xa2 || t === 0xa1 ||
      t === TILE.BOMB ||
      t === TILE.PILLAR ||
      t === TILE.BREAK_LADDER;
  }

  class GameWorld {
    constructor(config = {}) {
      this.cols = config.cols || 16;
      this.rows = config.rows || 8;
      this.worldWidth = this.cols * 16;
      this.f = 0;
      this.tiles = new Uint8Array(this.cols * this.rows);
      this.waves = [];
      this.explosions = [];
      this.breakEffects = [];
      this.pickupEffects = [];
      this.crumblingLadders = new Map();
      this.pillarBreaks = new Map();
      this.fallingPillars = [];
      this.doors = [];
      this.doorMap = new Map();
      this.timedBombs = [];
      this.nextTimedBombId = 1;
      this.defaultTimedBombSec = normalizeTimedBombSec(config.timedBombSec);
      this.timedBombOverrideSec = (config.timedBombOverrideSec === 15 ||
        config.timedBombOverrideSec === 30 ||
        config.timedBombOverrideSec === 45 ||
        config.timedBombOverrideSec === 60)
        ? config.timedBombOverrideSec
        : null;
      this.hunterAggressive = !!config.hunterAggressive;
      this.playerHitEnemy = false;
      this.playerHitOrb = false;
      this.playerDead = false;
      this.deathPhase = 0; // 0:生存, 1:コチラ向き静止, 2:跳ね＆足上げ落下, 3:画面外余韻
      this.deathTimer = 0;
      this.deathVy = 0;
      this.deathBottomY = 0;
      this.deathFinished = false;
      this.stageCleared = false;
      this.clearPhase = 0; // 0:通常, 1:壊しきり後0.6s動作中(無敵), 2:全員停止＆3.0s待機
      this.clearTimer = 0;
      this.clearFinished = false;
      this.nextTrapOrder = 1;
      this.tryAgainActive = false;
      this.tryAgainPhase = 0; // 0:通常, 1:曲遅くなり待機(3.0s), 2:文字＆黒幕降下(2.0s), 3:真っ黒余韻(2.0s)
      this.tryAgainTimer = 0;
      this.tryAgainFinished = false;
      this.musicTempoRate = 1.0;
      this.onMusicSlowDown = typeof config.onMusicSlowDown === "function" ? config.onMusicSlowDown : null;
      this.allBackStop = false;
      this.allBackTimer = 0;
      this.allBackDone = false;
      this.orbEnabled = config.orb !== false;
      this.orbFast = !!config.orbFast;
      this.stageNumber = (Number.isFinite(Number(config.stageNumber)) && Number(config.stageNumber) > 0)
        ? Math.floor(Number(config.stageNumber))
        : 1;
      this.introTotalFrames = 288;
      this.introActive = !config.skipIntro;
      this.introFrame = 0;
      this.startBannerTimer = 0;
      this.snapCameraRequested = false;

      this.isBattleMode = !!config.isBattleMode;
      const BattleMgrClass = G.BattleManager || (root.BreakerGame && root.BreakerGame.BattleManager);
      this.battleManager = (this.isBattleMode && typeof BattleMgrClass === "function")
        ? new BattleMgrClass(config.battleOptions || {})
        : null;

      this.totalKeys = 0;
      this.collectedKeys = 0;
      this.shoePodState = "none"; // "none" | "closed" | "opening" | "open" | "collected"
      this.shoePodOpenTimer = 0;

      const stepper = new ActorStepper();
      this.stepper = stepper;
      this.player = new Actor(true);
      this.player.walkFrames = 0;
      const hasHunter = config.hunter !== null && config.hunter !== false;
      this.hunter = hasHunter ? new Actor(false) : null;
      if (this.hunter) {
        this.hunter.walkFrames = 0;
      }
      this.hunterAI = new HunterAI();
      this.enemies = [];
      this.enemyAI = typeof EnemyAI === "function" ? new EnemyAI() : null;

      if (config.tiles) {
        this.loadTiles(config.tiles);
      }
      if (Array.isArray(config.timedBombs)) {
        for (let i = 0; i < config.timedBombs.length; i++) {
          const tbCfg = config.timedBombs[i];
          if (!tbCfg || tbCfg.row == null || tbCfg.col == null) continue;
          const r = tbCfg.row;
          const c = this.wrapCol(tbCfg.col);
          if (r < 0 || r >= this.rows || isEdgeSafeCol(c, this.cols)) continue;
          const sec = normalizeTimedBombSec(tbCfg.sec != null ? tbCfg.sec : this.defaultTimedBombSec);
          this.setTile(r, c, TILE.TIMED_BOMB);
          const slot = this.ensureTimedBombSlot(r, c, sec);
          this.applyTimedBombSec(slot, this.timedBombOverrideSec != null ? this.timedBombOverrideSec : sec);
        }
      }
      if (this.timedBombOverrideSec != null && this.timedBombs.length > 0) {
        for (let i = 0; i < this.timedBombs.length; i++) {
          this.applyTimedBombSec(this.timedBombs[i], this.timedBombOverrideSec);
        }
      }
      if (config.player) {
        Object.assign(this.player, config.player);
        if ((this.player.dir & (LEFT | RIGHT)) !== 0) {
          this.player.facing = this.player.dir & (LEFT | RIGHT);
        }
      }
      if (this.hunter && config.hunter) {
        Object.assign(this.hunter, config.hunter);
        if ((this.hunter.dir & (LEFT | RIGHT)) !== 0) {
          this.hunter.facing = this.hunter.dir & (LEFT | RIGHT);
        }
      }
      if (config.hunterAI) {
        Object.assign(this.hunterAI, config.hunterAI);
      }

      this.stepper.updateCR(this.player, this);
      if (this.hunter) {
        this.stepper.updateCR(this.hunter, this);
      }
      if (Array.isArray(config.enemies) && typeof EnemyActor === "function") {
        for (let i = 0; i < config.enemies.length; i++) {
          const e = new EnemyActor(config.enemies[i]);
          if (this.enemyAI) this.enemyAI.updateCR(e, this);
          this.enemies.push(e);
        }
      }

      this.initKeyAndShoePodState();
      this.orb = this.createInitialOrb();
    }

    createInitialOrb() {
      if (!this.orbEnabled) {
        return null;
      }
      return {
        state: 3, // 0:出現準備, 1:発生アニメ(64F), 2:飛行中, 3:消滅アニメ＆出現待機
        x: 8,
        y: 64,
        baseY: 64,
        dir: RIGHT,
        spawnTimer: 0,
        waitTimer: this.orbFast ? 0x40 : 0xff, // 初回出現待ち（通常 約34秒 / 高速 約8.5秒）
        disappearDone: true,
        animStage: -1, // -1:非表示, 0:極小, 1:小, 2:大A, 3:大B
        animCount: 0,
        waveTick: 0
      };
    }

    countRemainingKeys() {
      let count = 0;
      for (let i = 0; i < this.tiles.length; i++) {
        if (this.tiles[i] === TILE.KEY) {
          count += 1;
        }
      }
      for (let i = 0; i < this.fallingPillars.length; i++) {
        if (this.fallingPillars[i].payloadTile === TILE.KEY) {
          count += 1;
        }
      }
      return count;
    }

    hasShoePodTile() {
      for (let i = 0; i < this.tiles.length; i++) {
        if (this.tiles[i] === TILE.SHOE_POD) {
          return true;
        }
      }
      for (let i = 0; i < this.fallingPillars.length; i++) {
        if (this.fallingPillars[i].payloadTile === TILE.SHOE_POD) {
          return true;
        }
      }
      return false;
    }

    initKeyAndShoePodState() {
      const keys = this.countRemainingKeys();
      const hasPod = this.hasShoePodTile();
      this.totalKeys = keys;
      this.collectedKeys = 0;
      this.shoePodOpenTimer = 0;
      if (!hasPod) {
        this.shoePodState = "none";
      } else if (keys === 0) {
        this.shoePodState = "open";
      } else {
        this.shoePodState = "closed";
      }
    }

    updateKeyAndShoePickups() {
      if (this.shoePodState === "opening") {
        this.shoePodOpenTimer -= 1;
        if (this.shoePodOpenTimer <= 0) {
          this.shoePodOpenTimer = 0;
          this.shoePodState = "open";
        }
      }

      const p = this.player;
      if (!p) return;
      if (p.state === 10 || p.state === 15 || p.state === 16) return;

      const px = this.wrapX(p.x + 8);
      const py = p.y;
      const halfW = this.worldWidth / 2;

      for (let row = 0; row < this.rows; row++) {
        const yTop = row * 32;
        if (py < yTop + 12 || py > yTop + 48) continue;

        for (let col = 0; col < this.cols; col++) {
          const t = this.getTile(row, col);
          if (t !== TILE.KEY && t !== TILE.SHOE_POD) continue;

          const cx = col * 16 + 8;
          let dx = px - cx;
          if (dx >= halfW) dx -= this.worldWidth;
          if (dx < -halfW) dx += this.worldWidth;
          if (Math.abs(dx) >= 10) continue;

          if (t === TILE.KEY) {
            this.setTile(row, col, TILE.EMPTY);
            this.collectedKeys += 1;
            this.pickupEffects.push({ row, col, kind: "key", timer: 18, maxTimer: 18 });
            if (this.countRemainingKeys() === 0 && this.shoePodState === "closed") {
              this.shoePodState = "opening";
              this.shoePodOpenTimer = 60;
            }
          } else if (t === TILE.SHOE_POD && this.shoePodState === "open") {
            this.setTile(row, col, TILE.EMPTY);
            this.shoePodState = "collected";
            p.hasFlyingShoes = true;
            this.pickupEffects.push({ row, col, kind: "shoe", timer: 24, maxTimer: 24 });
          }
        }
      }
    }

    wrapX(x) {
      const w = this.worldWidth;
      return ((x % w) + w) % w;
    }

    wrapCol(col) {
      const c = this.cols;
      return ((col % c) + c) % c;
    }

    cellKey(row, col) {
      return row + "," + this.wrapCol(col);
    }

    getCrumblingInfo(row, col) {
      return this.crumblingLadders.get(this.cellKey(row, col)) || null;
    }

    hasCrumblingBelowSame(row, col) {
      const info = this.getCrumblingInfo(row, col);
      return info ? info.hasBelowSame : false;
    }

    getPillarBreakInfo(row, col) {
      return this.pillarBreaks.get(this.cellKey(row, col)) || null;
    }

    applyTimedBombSec(tb, sec) {
      if (!tb) return;
      const validSec = normalizeTimedBombSec(sec);
      tb.initialSec = validSec;
      tb.totalFrames = validSec * 60;
      tb.remainFrames = validSec * 60;
    }

    getTimedBombAt(row, col) {
      const wc = this.wrapCol(col);
      for (let i = 0; i < this.timedBombs.length; i++) {
        const tb = this.timedBombs[i];
        if (!tb.falling && tb.row === row && tb.col === wc) {
          return tb;
        }
      }
      return null;
    }

    ensureTimedBombSlot(row, col, sec = this.defaultTimedBombSec) {
      const wc = this.wrapCol(col);
      let tb = this.getTimedBombAt(row, wc);
      if (!tb) {
        const validSec = normalizeTimedBombSec(sec);
        tb = {
          id: this.nextTimedBombId++,
          row,
          col: wc,
          initialSec: validSec,
          totalFrames: validSec * 60,
          remainFrames: validSec * 60,
          falling: false
        };
        this.timedBombs.push(tb);
      }
      return tb;
    }

    removeTimedBombSlot(row, col) {
      const wc = this.wrapCol(col);
      for (let i = this.timedBombs.length - 1; i >= 0; i--) {
        const tb = this.timedBombs[i];
        if (!tb.falling && tb.row === row && tb.col === wc) {
          this.timedBombs.splice(i, 1);
        }
      }
    }

    ensureDoorSlot(row, col) {
      const wc = this.wrapCol(col);
      const key = this.cellKey(row, wc);
      let door = this.doorMap.get(key);
      if (!door) {
        door = {
          row,
          col: wc,
          state: 1,
          stepTimer: 0,
          openTimer: 0,
          byPlayer: true
        };
        this.doors.push(door);
        this.doorMap.set(key, door);
      }
      return door;
    }

    removeDoorSlot(row, col) {
      const wc = this.wrapCol(col);
      const key = this.cellKey(row, wc);
      const door = this.doorMap.get(key);
      if (!door) return;
      this.doorMap.delete(key);
      const idx = this.doors.indexOf(door);
      if (idx >= 0) {
        this.doors.splice(idx, 1);
      }
    }

    loadTiles(src) {
      if (Array.isArray(src)) {
        for (const item of src) {
          this.setTile(item[0], item[1], item[2]);
        }
      } else {
        for (const [k, v] of Object.entries(src)) {
          if (k.includes(",")) {
            const [r, c] = k.split(",").map(Number);
            this.setTile(r, c, v);
          } else {
            const addr = Number(k);
            const pos = addr >= 0x500 ? addr - 0x500 : addr;
            const r = (pos >> 4) & 0x0f;
            const c = pos & 0x0f;
            this.setTile(r, c, v);
          }
        }
      }
    }

    setTile(row, col, val) {
      if (row < 0 || row >= this.rows) return;
      const wc = this.wrapCol(col);
      const safeVal = isEdgeSafeCol(wc, this.cols) ? TILE.EMPTY : val;
      this.tiles[row * this.cols + wc] = safeVal;
      if (safeVal === TILE.DOOR) {
        this.ensureDoorSlot(row, wc);
      } else if (!isDoorRelatedTile(safeVal)) {
        this.removeDoorSlot(row, wc);
      }
      if (safeVal === TILE.TIMED_BOMB) {
        const initSec = this.timedBombOverrideSec != null ? this.timedBombOverrideSec : this.defaultTimedBombSec;
        this.ensureTimedBombSlot(row, wc, initSec);
      } else {
        this.removeTimedBombSlot(row, wc);
      }
    }

    getTile(row, col) {
      if (row < 0 || row >= this.rows) return TILE.EMPTY;
      const wc = this.wrapCol(col);
      return this.tiles[row * this.cols + wc];
    }

    getDrumTrappedActor(row, col) {
      const wc = this.wrapCol(col);
      let best = null;
      let bestOrder = -1;
      const checkSlot = (slot) => {
        if (!slot || slot.state !== 16) return;
        if (slot.row !== row || slot.col !== wc) return;
        const ord = slot.trapOrder || 0;
        if (ord >= bestOrder) {
          bestOrder = ord;
          best = slot;
        }
      };
      checkSlot(this.player);
      checkSlot(this.hunter);
      if (this.enemies) {
        for (let i = 0; i < this.enemies.length; i++) {
          checkSlot(this.enemies[i]);
        }
      }
      return best;
    }

    countBreakables() {
      let count = 0;
      const checkFn = this.isBattleMode ? isBattleCountedTile : isClearTargetTile;
      for (let i = 0; i < this.tiles.length; i++) {
        if (checkFn(this.tiles[i])) {
          count += 1;
        }
      }
      for (let i = 0; i < this.fallingPillars.length; i++) {
        if (checkFn(this.fallingPillars[i].payloadTile)) {
          count += 1;
        }
      }
      return count;
    }

    isBattleClearConditionMet() {
      return this.countBreakables() === 0 &&
        this.crumblingLadders.size === 0 &&
        this.pillarBreaks.size === 0 &&
        this.waves.length === 0;
    }

    openDoor(row, col, byPlayer = true, openDuration = 0x50) {
      if (row < 0 || row >= this.rows) return false;
      const c = this.wrapCol(col);
      const door = this.ensureDoorSlot(row, c);
      door.state = 2;
      door.stepTimer = 4;
      door.openTimer = openDuration;
      door.byPlayer = !!byPlayer;
      this.setTile(row, c, byPlayer ? TILE.DOOR_OPENING_1 : (TILE.DOOR_OPENING_1 | 0x08));
      return true;
    }

    openAllDoors(byPlayer = true, openDuration = 0x20) {
      for (let i = 0; i < this.doors.length; i++) {
        const door = this.doors[i];
        if (door.state === 0) continue;
        door.state = 2;
        door.stepTimer = 4;
        door.openTimer = openDuration;
        door.byPlayer = !!byPlayer;
        this.setTile(door.row, door.col, byPlayer ? TILE.DOOR_OPENING_1 : (TILE.DOOR_OPENING_1 | 0x08));
      }
    }

    holdDoorsOpen() {
      for (let i = 0; i < this.doors.length; i++) {
        if (this.doors[i].state !== 0) {
          this.doors[i].openTimer = 0x40;
        }
      }
    }

    updateDoors() {
      if (this.doors.length === 0) return;
      for (let i = 0; i < this.doors.length; i++) {
        const door = this.doors[i];
        if (door.state <= 1) continue;
        if (door.stepTimer > 0) {
          door.stepTimer -= 1;
          continue;
        }
        door.stepTimer = 4;
        if (door.state === 2) {
          const bit3 = this.getTile(door.row, door.col) & 0x08;
          this.setTile(door.row, door.col, TILE.DOOR_OPENING_2 | bit3);
          door.state = 3;
        } else if (door.state === 3) {
          this.setTile(door.row, door.col, TILE.DOOR_OPEN);
          door.state = 4;
        } else if (door.state === 4) {
          door.openTimer -= 1;
          if (door.openTimer <= 0) {
            this.setTile(door.row, door.col, TILE.DOOR_CLOSING_1);
            door.state = 5;
          }
        } else if (door.state === 5) {
          this.setTile(door.row, door.col, TILE.DOOR_CLOSING_2);
          door.state = 6;
        } else if (door.state === 6) {
          this.setTile(door.row, door.col, TILE.DOOR);
          door.state = 1;
          door.stepTimer = 0;
        }
      }
    }

    startCrumblingLadder(row, col, byPlayer, spreadUp = true, spreadDown = true) {
      if (row < 0 || row >= this.rows) return false;
      const c = this.wrapCol(col);
      if (this.getTile(row, c) !== TILE.BREAK_LADDER) return false;

      const belowTile = row < this.rows - 1 ? this.getTile(row + 1, c) : TILE.EMPTY;
      const hasBelowSame = row < this.rows - 1 &&
        (belowTile === TILE.BREAK_LADDER || isCrumblingLadderTile(belowTile));

      this.setTile(row, c, TILE.CRUMBLING_4);
      this.crumblingLadders.set(this.cellKey(row, c), {
        row,
        col: c,
        stage: 4,
        timer: COLLAPSE_STAGE_FRAMES,
        spreadTimer: COLLAPSE_STAGE_FRAMES,
        spreadUp,
        spreadDown,
        hasBelowSame,
        byPlayer: !!byPlayer
      });
      return true;
    }

    updateCrumblingLadders() {
      if (this.crumblingLadders.size === 0) return;
      const entries = Array.from(this.crumblingLadders.values());
      const toSpread = [];

      for (const e of entries) {
        if (e.spreadUp || e.spreadDown) {
          e.spreadTimer -= 1;
          if (e.spreadTimer <= 0) {
            if (e.spreadUp && e.row > 0 && this.getTile(e.row - 1, e.col) === TILE.BREAK_LADDER) {
              toSpread.push({ row: e.row - 1, col: e.col, byPlayer: e.byPlayer, up: true, down: false });
            }
            if (e.spreadDown && e.row < this.rows - 1 && this.getTile(e.row + 1, e.col) === TILE.BREAK_LADDER) {
              toSpread.push({ row: e.row + 1, col: e.col, byPlayer: e.byPlayer, up: false, down: true });
            }
            e.spreadUp = false;
            e.spreadDown = false;
          }
        }

        e.timer -= 1;
        if (e.timer <= 0) {
          e.stage -= 1;
          e.timer = COLLAPSE_STAGE_FRAMES;
          if (e.stage <= 0) {
            this.crumblingLadders.delete(this.cellKey(e.row, e.col));
            this.setTile(e.row, e.col, e.hasBelowSame ? TILE.HOLE_CRUMBLED : TILE.EMPTY);
            this.breakEffects.push({ row: e.row, col: e.col, tile: TILE.BREAK_LADDER, timer: 16, maxTimer: 16 });
            if (this.battleManager) {
              this.battleManager.onEvent({
                type: "ladderDestroyed",
                row: e.row,
                col: e.col,
                byPlayer: !!e.byPlayer
              });
            }
          } else {
            this.setTile(e.row, e.col, 0x50 + e.stage);
          }
        }
      }

      for (const s of toSpread) {
        this.startCrumblingLadder(s.row, s.col, s.byPlayer, s.up, s.down);
      }
    }

    triggerPillar(row, col, byPlayer) {
      if (row < 0 || row >= this.rows) return false;
      const c = this.wrapCol(col);

      // 支柱自身の崩壊開始 (0x75 -> 0x74 -> 0x73 -> 0x72 -> 0x71 -> 0x00, 1+8*4=33F)
      this.setTile(row, c, 0x75);
      this.pillarBreaks.set(this.cellKey(row, c), {
        row,
        col: c,
        stage: 5,
        timer: 1,
        byPlayer: !!byPlayer
      });

      if (row >= 1 && this.fallingPillars.length < 12) {
        const aboveRow = row - 1;
        const aboveTile = this.getTile(aboveRow, c);
        const payload = getPillarFallPayload(aboveTile);
        if (payload !== null) {
          this.crumblingLadders.delete(this.cellKey(aboveRow, c));
          let fallingTimedBomb = null;
          if (aboveTile === TILE.TIMED_BOMB) {
            fallingTimedBomb = this.getTimedBombAt(aboveRow, c);
            if (fallingTimedBomb) {
              fallingTimedBomb.falling = true;
            }
          }
          const isContLadder = isLadderTile(aboveTile) &&
            aboveRow >= 1 &&
            isSameLadderType(aboveTile, this.getTile(aboveRow - 1, c));

          // 0F目から1行上は即座に穴落下判定になり、オブジェクトは 30F 滞空する
          this.setTile(aboveRow, c, TILE.HOLE_FALLING);
          this.fallingPillars.push({
            row: aboveRow,
            targetRow: row,
            col: c,
            payloadTile: payload,
            origAboveTile: aboveTile,
            isDrum: aboveTile === TILE.DRUM,
            isFloorOnly: payload === TILE.EMPTY,
            aboveDoneHole: isContLadder ? TILE.HOLE_PILLAR_LAD : TILE.HOLE,
            timedBomb: fallingTimedBomb,
            stage: 1,
            timer: 30
          });
        }
      }
      return true;
    }

    updatePillarBreakTiles() {
      if (this.pillarBreaks.size === 0) return;
      const entries = Array.from(this.pillarBreaks.values());
      for (const e of entries) {
        e.timer -= 1;
        if (e.timer <= 0) {
          e.stage -= 1;
          if (e.stage <= 0) {
            this.pillarBreaks.delete(this.cellKey(e.row, e.col));
            this.setTile(e.row, e.col, TILE.EMPTY);
            this.breakEffects.push({ row: e.row, col: e.col, tile: TILE.PILLAR, timer: 14, maxTimer: 14 });
            if (this.battleManager) {
              this.battleManager.onEvent({
                type: "pillarDestroyed",
                row: e.row,
                col: e.col,
                byPlayer: !!e.byPlayer
              });
            }
          } else {
            e.timer = COLLAPSE_STAGE_FRAMES;
            this.setTile(e.row, e.col, 0x70 + e.stage);
          }
        }
      }
    }

    updateFallingPillars() {
      if (this.fallingPillars.length === 0) return;
      for (let i = this.fallingPillars.length - 1; i >= 0; i--) {
        const fp = this.fallingPillars[i];
        fp.timer -= 1;
        if (fp.timer > 0) continue;

        fp.timer = 4;
        if (fp.stage === 1 && fp.isDrum) {
          // 30F目: ドラム缶落下中は下の鉄柱マスを捕獲状態へ
          this.pillarBreaks.delete(this.cellKey(fp.targetRow, fp.col));
          this.setTile(fp.targetRow, fp.col, TILE.DRUM_FALLING);
        }

        fp.stage += 1;
        if (fp.stage >= 5) {
          // 42F目 (30 + 4*3): 着地完了
          this.fallingPillars.splice(i, 1);
          this.pillarBreaks.delete(this.cellKey(fp.targetRow, fp.col));
          if (fp.timedBomb) {
            fp.timedBomb.row = fp.targetRow;
            fp.timedBomb.col = fp.col;
            fp.timedBomb.falling = false;
          }
          this.setTile(fp.targetRow, fp.col, fp.payloadTile);
          this.setTile(fp.row, fp.col, fp.aboveDoneHole);
        }
      }
    }

    hitCell(row, col, byPlayer) {
      const c = this.wrapCol(col);
      if (row < 0 || row >= this.rows) return false;
      const tile = this.getTile(row, c);
      if (!isBreakableTile(tile)) return false;

      if (tile === TILE.BOMB) {
        this.triggerBomb(row, c, byPlayer);
        if (this.battleManager) {
          if (!byPlayer) {
            // バトルモードでハンターが爆弾を叩いた時は、無差別爆風の前に避けられるよう振り終わり硬直を短縮
            if (this.hunter && this.hunter.state === 4 && this.hunter.hammerTimer < 22) {
              this.hunter.hammerTimer = 22;
            }
            if (this.battleManager.hunterAI && typeof this.battleManager.hunterAI.notifyBombHit === "function") {
              this.battleManager.hunterAI.notifyBombHit(row, c);
            }
          }
          this.battleManager.onEvent({
            type: "bombExploded",
            row,
            col: c,
            byPlayer: !!byPlayer
          });
        }
        return true;
      }

      if (tile === TILE.BREAK_LADDER) {
        const started = this.startCrumblingLadder(row, c, byPlayer, true, true);
        if (started && this.battleManager && !byPlayer && this.battleManager.hunterAI &&
            typeof this.battleManager.hunterAI.notifyNonDoorHit === "function") {
          this.battleManager.hunterAI.notifyNonDoorHit();
        }
        return started;
      }

      if (tile === TILE.DOOR) {
        const opened = this.openDoor(row, c, byPlayer, 0x50);
        if (opened && this.battleManager) {
          this.battleManager.onEvent({
            type: "doorOpened",
            row,
            col: c,
            byPlayer: !!byPlayer
          });
        }
        return opened;
      }

      if (tile === TILE.PILLAR) {
        const triggered = this.triggerPillar(row, c, byPlayer);
        if (triggered && this.battleManager && !byPlayer && this.battleManager.hunterAI &&
            typeof this.battleManager.hunterAI.notifyNonDoorHit === "function") {
          this.battleManager.hunterAI.notifyNonDoorHit();
        }
        return triggered;
      }

      if (this.battleManager && !byPlayer && this.battleManager.hunterAI &&
          typeof this.battleManager.hunterAI.notifyNonDoorHit === "function") {
        this.battleManager.hunterAI.notifyNonDoorHit();
      }

      const hp = tile & 0x07;
      if (hp > 1) {
        this.setTile(row, c, tile - 1);
      } else {
        this.setTile(row, c, TILE.EMPTY);
        this.breakEffects.push({ row, col: c, tile, timer: 16, maxTimer: 16 });
        this.explosions.push({
          row,
          col: c,
          timer: COLLAPSE_TOTAL_FRAMES,
          maxTimer: COLLAPSE_TOTAL_FRAMES,
          age: 0,
          kind: "wall",
          byPlayer: !!byPlayer
        });
        if (this.battleManager) {
          this.battleManager.onEvent({
            type: "wallDestroyed",
            tile,
            row,
            col: c,
            byPlayer: !!byPlayer
          });
        }
      }
      return true;
    }

    triggerBomb(row, col, byPlayer = true) {
      const c = this.wrapCol(col);
      this.setTile(row, c, TILE.EMPTY);
      this.openAllDoors(byPlayer, 0x20);
      this.explosions.push({
        row,
        col: c,
        timer: 26,
        maxTimer: 26,
        age: 0,
        kind: "bomb",
        byPlayer: !!byPlayer
      });
      this.waves.push({ row, col: this.wrapCol(c - 1), dir: -1, timer: 10, stepsLeft: this.cols - 1, byPlayer: !!byPlayer });
      this.waves.push({ row, col: this.wrapCol(c + 1), dir: 1, timer: 10, stepsLeft: this.cols - 1, byPlayer: !!byPlayer });
    }

    triggerTimedBomb(row, col, keepTile = false) {
      const c = this.wrapCol(col);
      if (!keepTile) {
        this.setTile(row, c, TILE.EMPTY);
      }
      this.openAllDoors(true, 0x20);
      this.explosions.push({
        row,
        col: c,
        timer: 26,
        maxTimer: 26,
        age: 0,
        kind: "bomb",
        byPlayer: true,
        indiscriminate: true
      });
      this.waves.push({ row, col: this.wrapCol(c - 1), dir: -1, timer: 10, stepsLeft: this.cols - 1, byPlayer: true });
      this.waves.push({ row, col: this.wrapCol(c + 1), dir: 1, timer: 10, stepsLeft: this.cols - 1, byPlayer: true });
    }

    updateTimedBombs() {
      if (this.timedBombs.length === 0) return;
      for (let i = this.timedBombs.length - 1; i >= 0; i--) {
        const tb = this.timedBombs[i];
        tb.remainFrames -= 1;
        if (tb.remainFrames > 0) continue;

        this.timedBombs.splice(i, 1);
        if (tb.falling) {
          let expRow = tb.row;
          for (let j = 0; j < this.fallingPillars.length; j++) {
            const fp = this.fallingPillars[j];
            if (fp.timedBomb === tb) {
              expRow = fp.stage >= 2 ? fp.targetRow : fp.row;
              fp.payloadTile = TILE.EMPTY;
              fp.origAboveTile = TILE.EMPTY;
              fp.isFloorOnly = true;
              fp.timedBomb = null;
              break;
            }
          }
          this.triggerTimedBomb(expRow, tb.col, true);
        } else {
          this.triggerTimedBomb(tb.row, tb.col, false);
        }
      }
    }

    updateEffectsAndWaves() {
      this.updateDoors();
      this.updateCrumblingLadders();
      this.updatePillarBreakTiles();
      this.updateFallingPillars();

      for (let i = this.explosions.length - 1; i >= 0; i--) {
        const ex = this.explosions[i];
        ex.age = (ex.age || 0) + 1;
        ex.timer -= 1;
        if (ex.timer <= 0) {
          this.explosions.splice(i, 1);
        }
      }
      for (let i = this.breakEffects.length - 1; i >= 0; i--) {
        this.breakEffects[i].timer -= 1;
        if (this.breakEffects[i].timer <= 0) {
          this.breakEffects.splice(i, 1);
        }
      }
      for (let i = this.pickupEffects.length - 1; i >= 0; i--) {
        this.pickupEffects[i].timer -= 1;
        if (this.pickupEffects[i].timer <= 0) {
          this.pickupEffects.splice(i, 1);
        }
      }

      if (this.waves.length === 0) return;
      const prevWaves = this.waves;
      this.waves = [];
      const nextWaves = [];

      for (const w of prevWaves) {
        w.timer -= 1;
        if (w.timer > 0) {
          nextWaves.push(w);
          continue;
        }

        const waveByPlayer = this.isBattleMode ? (w.byPlayer !== false) : true;
        const t = this.getTile(w.row, w.col);
        if (isDoorRelatedTile(t) || t === TILE.TIMED_BOMB) {
          if (w.stepsLeft > 1) {
            nextWaves.push({
              row: w.row,
              col: this.wrapCol(w.col + w.dir),
              dir: w.dir,
              timer: 10,
              stepsLeft: w.stepsLeft - 1,
              byPlayer: waveByPlayer
            });
          }
          continue;
        }
        if (!isBreakableTile(t)) continue;

        this.hitCell(w.row, w.col, waveByPlayer);

        if (t !== TILE.BOMB) {
          const afterTile = this.getTile(w.row, w.col);
          if (t === TILE.BREAK_LADDER || afterTile !== TILE.EMPTY) {
            this.explosions.push({ row: w.row, col: w.col, timer: 10, maxTimer: 10, age: 0, kind: "spark", byPlayer: waveByPlayer });
          }
        }
        if (w.stepsLeft > 1) {
          nextWaves.push({
            row: w.row,
            col: this.wrapCol(w.col + w.dir),
            dir: w.dir,
            timer: 10,
            stepsLeft: w.stepsLeft - 1,
            byPlayer: waveByPlayer
          });
        }
      }
      this.waves = nextWaves.concat(this.waves);
    }

    resolveKnockdownAttacker(slot, prev) {
      let checkRow = slot.row;
      if (prev.state === 2) {
        const curT = this.getTile(slot.row, slot.col);
        if (curT === TILE.HOLE_PILLAR_LAD || ((slot.y & 0x0f) !== 0 && (slot.y & 0x10) !== 0)) {
          checkRow = Math.min(this.rows - 1, slot.row + 1);
        }
      } else if (prev.state === 5) {
        checkRow = Math.max(0, Math.min(this.rows - 1, Math.floor((slot.y - 16) / 32)));
      }

      const targetSide = slot.isPlayer ? 0 : (!slot.isEnemy ? 1 : (slot.isBack ? 1 : 0));

      if (this.explosions && this.explosions.length > 0) {
        for (let i = 0; i < this.explosions.length; i++) {
          const ex = this.explosions[i];
          if (ex.col !== slot.col || ex.row !== checkRow) continue;
          if (ex.kind === "bomb") {
            const attackerSide = ex.byPlayer ? 0 : 1;
            if (ex.indiscriminate || ex.age >= 21 || targetSide !== attackerSide) {
              return !!ex.byPlayer;
            }
          } else if (ex.kind === "wall") {
            const attackerSide = ex.byPlayer ? 0 : 1;
            if (ex.age < COLLAPSE_HIT_FRAMES && targetSide !== attackerSide) {
              return !!ex.byPlayer;
            }
          }
        }
      }

      const tile = this.getTile(checkRow, slot.col);

      if (!(slot.flag & 2)) {
        if (isDoorOpeningTile(tile)) {
          const attackerSide = (tile & 0x08) !== 0 ? 1 : 0;
          if (targetSide !== attackerSide) {
            return (tile & 0x08) === 0;
          }
        }
        if (this.pillarBreaks && this.pillarBreaks.size > 0) {
          const pInfo = this.getPillarBreakInfo(checkRow, slot.col);
          if (pInfo && pInfo.stage >= 2) {
            const attackerSide = pInfo.byPlayer ? 0 : 1;
            if (targetSide !== attackerSide) {
              return !!pInfo.byPlayer;
            }
          }
        }
      }

      if (prev.state !== 5) {
        const isDangerLadderInfo = (r, c) => {
          const lt = this.getTile(r, c);
          if (!isCrumblingLadderTile(lt)) return null;
          const info = this.getCrumblingInfo(r, c);
          const stage = info ? info.stage : (lt & 0x07);
          return stage <= 2 ? info : null;
        };

        const curDanger = isDangerLadderInfo(checkRow, slot.col);
        if (curDanger && checkRow < this.rows - 1) {
          const belowDanger = isDangerLadderInfo(checkRow + 1, slot.col);
          if (belowDanger) {
            return curDanger ? !!curDanger.byPlayer : true;
          }
        }

        if (isHoleTile(tile) && checkRow < this.rows - 1) {
          const belowDanger = isDangerLadderInfo(checkRow + 1, slot.col);
          if (belowDanger) {
            return !!belowDanger.byPlayer;
          }
        }

        if (!(slot.flag & 2) && isCrumblingLadderTile(tile)) {
          const info = this.getCrumblingInfo(checkRow, slot.col);
          const stage = info ? info.stage : (tile & 0x07);
          const byPl = info ? !!info.byPlayer : true;
          if (stage >= 2 && targetSide !== (byPl ? 0 : 1)) {
            return byPl;
          }
        }
      }

      return null;
    }

    updateHunterHammer() {
      const hu = this.hunter;
      if (!hu) return;
      const pl = this.player;
      hu.bits &= ~HAMMER;
      if (hu.state === 4 || hu.state === 10 || hu.state === 11 || hu.state === 15 || hu.state === 16) {
        return;
      }

      const tile = this.getTile(hu.row, hu.col);
      if (tile === TILE.BOMB || tile === TILE.TIMED_BOMB || !isBreakableTile(tile)) return;

      const sameCell = hu.row === pl.row && hu.col === pl.col;
      if (tile === TILE.DOOR || sameCell || this.hunterAggressive) {
        hu.bits |= HAMMER;
      }
    }

    // プレイヤーの段（はしご途中は近い方の段）を電磁球の出現高さにする
    getOrbStartY() {
      const py = this.player.y;
      const snapped = ((py & 0x0f) !== 0 && (py & 0x10) !== 0)
        ? ((py & ~0x1f) + 32)
        : (py & ~0x1f);
      return Math.max(32, Math.min(this.rows * 32, snapped));
    }

    // 電磁球ギミック更新（ややウェーブ軌道付き水平飛行）
    updateOrb() {
      const ob = this.orb;
      if (!ob) return;

      if (ob.state === 0) {
        // State 0: 出現準備（プレイヤーの高さ＆左右の遠い方に出現）
        const startY = this.getOrbStartY();
        ob.baseY = startY;
        ob.y = startY;
        const halfCols = Math.floor(this.cols / 2);
        if (this.player.col < halfCols) {
          ob.dir = LEFT;
          ob.x = Math.max(8, this.worldWidth - 24);
        } else {
          ob.dir = RIGHT;
          ob.x = 8;
        }
        ob.state = 1;
        ob.spawnTimer = 64; // 64F発生アニメ待機
        ob.animStage = 0;   // 極小のコアから開始
        ob.animCount = 0;
        ob.waveTick = 0;
        ob.disappearDone = false;
        return;
      }

      if (ob.state === 1) {
        // State 1: 発生アニメーション（だんだん組み上がってから飛び始める）
        ob.spawnTimer -= 1;
        ob.animCount += 1;
        if (ob.animStage < 2) {
          if ((this.f & 0x07) === 0) {
            ob.animStage += 1;
          }
        } else {
          ob.animStage = ((ob.animCount >> 1) & 1) ? 3 : 2;
        }
        if (ob.spawnTimer <= 0) {
          ob.state = 2;
        }
        return;
      }

      if (ob.state === 2) {
        // State 2: 水平飛行（1.0px/F）＋ ややウェーブ（障害物をすべて素通りし反対側の端で消滅）
        ob.x += (ob.dir === LEFT) ? -1 : 1;
        const reachedEnd = (ob.dir === LEFT)
          ? (ob.x <= 8)
          : (ob.x >= Math.max(8, this.worldWidth - 16));
        if (reachedEnd) {
          ob.state = 3;
          ob.disappearDone = false;
          ob.animStage = 3;
          ob.waitTimer = this.orbFast ? 0x20 : 0x60; // 再出現待ち（通常 約12.8秒 / 高速 約4.3秒）
          return;
        }
        ob.waveTick += 1;
        ob.y = ob.baseY + Math.round(Math.sin(ob.waveTick * (Math.PI * 2 / 36)) * 2.5);
        ob.animCount += 1;
        ob.animStage = ((ob.animCount >> 1) & 1) ? 3 : 2;
        return;
      }

      if (ob.state === 3) {
        // State 3: 消滅アニメーション → 完了後は非表示のまま8Fごとに待ちタイマー減算
        if (!ob.disappearDone) {
          if ((this.f & 0x07) === 0) {
            ob.animStage -= 1;
            if (ob.animStage < 0) {
              ob.animStage = -1;
              ob.disappearDone = true;
            }
          }
          return;
        }
        if ((this.f & 0x07) === 0) {
          ob.waitTimer -= 1;
          if (ob.waitTimer <= 0) {
            ob.waitTimer = 0;
            ob.state = 0;
          }
        }
      }
    }

    // プレイヤーと有効な表側ザコ敵の接触判定
    isPlayerEnemyHit(player, enemy) {
      if (this.allBackStop) return false;
      if (player.flag & 0x08) return false;
      if (player.state === 7 || player.state === 10 || player.state === 11 ||
          player.state === 15 || player.state === 16) {
        return false;
      }
      if (enemy.isBack) return false;
      if (enemy.state === 4 || enemy.state === 10 || enemy.state === 13 ||
          enemy.state === 15 || enemy.state === 16) {
        return false;
      }

      let dx = player.x - enemy.x;
      const halfW = this.worldWidth / 2;
      if (dx >= halfW) dx -= this.worldWidth;
      if (dx < -halfW) dx += this.worldWidth;
      const absDx = dx >= 0 ? dx : (-dx - 1);
      if (absDx >= 6) return false;

      const dy = player.y - enemy.y;
      const absDy = dy >= 0 ? dy : (-dy - 1);
      if (absDy >= 8) return false;

      return true;
    }

    // プレイヤーと飛行中の電磁球の接触判定（State 2のみ有効）
    isPlayerOrbHit(player, ob) {
      if (this.allBackStop) return false;
      if (!ob || ob.state !== 2) return false;
      if (player.flag & 0x08) return false;
      if (player.state === 7 || player.state === 10 || player.state === 11 ||
          player.state === 15 || player.state === 16) {
        return false;
      }

      let dx = player.x - ob.x;
      const halfW = this.worldWidth / 2;
      if (dx >= halfW) dx -= this.worldWidth;
      if (dx < -halfW) dx += this.worldWidth;
      const absDx = dx >= 0 ? dx : (-dx - 1);
      if (absDx >= 6) return false;

      const dy = player.y - ob.y;
      const absDy = dy >= 0 ? dy : (-dy - 1);
      if (absDy >= 8) return false;

      return true;
    }

    updatePlayerEnemyHit() {
      this.playerHitEnemy = false;
      this.playerHitOrb = false;
      if (this.enemies && this.enemies.length > 0) {
        for (let i = 0; i < this.enemies.length; i++) {
          if (this.isPlayerEnemyHit(this.player, this.enemies[i])) {
            this.playerHitEnemy = true;
            break;
          }
        }
      }
      if (this.isPlayerOrbHit(this.player, this.orb)) {
        this.playerHitOrb = true;
        this.playerHitEnemy = true;
      }
    }

    startPlayerDeath() {
      if (this.playerDead || this.stageCleared || this.tryAgainActive) return;
      this.playerDead = true;
      this.deathPhase = 1;
      this.deathTimer = 0;
      this.deathVy = 0;
      this.deathFinished = false;
      this.startBannerTimer = 0;

      const viewH = 240;
      const minCamY = -24;
      const maxCamY = Math.max(minCamY, this.rows * 32 + 24 - viewH);
      const approxCamY = Math.max(minCamY, Math.min(maxCamY, Math.round(this.player.y - viewH * 0.58)));
      this.deathBottomY = approxCamY + viewH + 42;
    }

    updatePlayerDeath() {
      if (!this.playerDead || this.deathFinished) return;

      if (this.deathPhase === 1) {
        this.deathTimer += 1;
        if (this.deathTimer >= 32) {
          this.deathPhase = 2;
          this.deathTimer = 0;
          this.deathVy = -3.4;
        }
        return;
      }

      if (this.deathPhase === 2) {
        this.deathTimer += 1;
        this.player.y += this.deathVy;
        this.deathVy = Math.min(7.0, this.deathVy + 0.38);
        if (this.player.y >= this.deathBottomY || this.deathTimer >= 120) {
          this.deathPhase = 3;
          this.deathTimer = 0;
        }
        return;
      }

      if (this.deathPhase === 3) {
        this.deathTimer += 1;
        if (this.deathTimer >= 36) {
          this.deathFinished = true;
        }
      }
    }

    isStageClearConditionMet() {
      return this.countBreakables() === 0 && this.crumblingLadders.size === 0;
    }

    startStageClear() {
      if (this.stageCleared || this.playerDead || this.tryAgainActive) return;
      this.stageCleared = true;
      this.clearPhase = 1;
      this.clearTimer = 0;
      this.clearFinished = false;
      this.playerHitEnemy = false;
      this.playerHitOrb = false;
      if (this.player.state === 15 || this.player.state === 16) {
        this.player.flag |= 2;
        this.player.y = this.player.row * 32 + 0x0b;
        this.player.topY = this.player.y;
        this.player.state = 0;
        this.player.prom = 0;
        this.stepper.updateCR(this.player, this);
      }
    }

    startTryAgain() {
      if (this.tryAgainActive || this.playerDead || this.stageCleared) return;
      this.tryAgainActive = true;
      this.tryAgainPhase = 1;
      this.tryAgainTimer = 0;
      this.tryAgainFinished = false;
      this.startBannerTimer = 0;
      this.musicTempoRate = 0.6;
      if (this.onMusicSlowDown) {
        this.onMusicSlowDown(this.musicTempoRate);
      }
    }

    updateTryAgain() {
      if (!this.tryAgainActive || this.tryAgainFinished) return;

      if (this.tryAgainPhase === 1) {
        this.tryAgainTimer += 1;
        if (this.tryAgainTimer >= 180) {
          this.tryAgainPhase = 2;
          this.tryAgainTimer = 0;
        }
        return;
      }

      if (this.tryAgainPhase === 2) {
        this.tryAgainTimer += 1;
        if (this.tryAgainTimer >= 120) {
          this.tryAgainPhase = 3;
          this.tryAgainTimer = 0;
        }
        return;
      }

      if (this.tryAgainPhase === 3) {
        this.tryAgainTimer += 1;
        if (this.tryAgainTimer >= 120) {
          this.tryAgainFinished = true;
        }
      }
    }

    // 同陣営ザコ敵同士（表同士・裏同士）の接触判定
    updateEnemyCollisions() {
      if (!this.enemies || this.enemies.length < 2) return;
      const halfW = this.worldWidth / 2;
      for (let i = 0; i < this.enemies.length; i++) {
        const a = this.enemies[i];
        if (a.state === 2 || a.state === 4 || a.state === 10 ||
            a.state === 13 || a.state === 15 || a.state === 16) {
          continue;
        }
        for (let j = i + 1; j < this.enemies.length; j++) {
          const b = this.enemies[j];
          if (!!a.isBack !== !!b.isBack) continue;
          if (b.state === 2 || b.state === 4 || b.state === 10 ||
              b.state === 13 || b.state === 15 || b.state === 16) {
            continue;
          }

          let dx = a.x - b.x;
          if (dx >= halfW) dx -= this.worldWidth;
          if (dx < -halfW) dx += this.worldWidth;
          const absDx = dx >= 0 ? dx : (-dx - 1);
          if (absDx >= 8) continue;

          const dy = a.y - b.y;
          const absDy = dy >= 0 ? dy : (-dy - 1);
          if (absDy >= 8) continue;

          a.bumpTrigger = true;
          b.bumpTrigger = true;
        }
      }
    }

    // 敵全員が裏側かつドア出入り中でない時、一定時間停止演出
    updateAllBackStop() {
      if (this.allBackStop) {
        this.holdDoorsOpen();
        if ((this.f & 0x03) === 0) {
          this.allBackTimer -= 1;
          if (this.allBackTimer <= 0) {
            this.allBackStop = false;
            this.allBackTimer = 0;
            this.allBackDone = true;
          }
        }
        return;
      }

      if (!this.enemies || this.enemies.length < 2) {
        this.allBackStop = false;
        this.allBackTimer = 0;
        this.allBackDone = false;
        return;
      }

      let allInBackAndNotDoor = true;
      for (let i = 0; i < this.enemies.length; i++) {
        const e = this.enemies[i];
        if (!e.isBack || e.state === 3) {
          allInBackAndNotDoor = false;
          break;
        }
      }

      if (!allInBackAndNotDoor) {
        this.allBackStop = false;
        this.allBackTimer = 0;
        this.allBackDone = false;
        return;
      }

      if (this.allBackDone) {
        return;
      }

      this.allBackStop = true;
      this.allBackTimer = 0x80;
      this.openAllDoors(true, 0x20);
    }

    step(inputBits = 0) {
      let b = inputBits;
      if ((b & (LEFT | RIGHT)) === (LEFT | RIGHT)) {
        b &= ~(LEFT | RIGHT);
      }
      if ((b & (UP | DOWN)) === (UP | DOWN)) {
        b &= ~(UP | DOWN);
      }

      const hammerNow = (b & HAMMER) !== 0;
      const hammerEdge = hammerNow && !this.player.prevHammer;
      this.player.prevHammer = hammerNow;

      if (this.introActive) {
        if (hammerEdge) {
          this.introActive = false;
          this.introFrame = this.introTotalFrames;
          this.startBannerTimer = 72;
          this.snapCameraRequested = true;
        } else {
          this.introFrame += 1;
          if (this.introFrame >= this.introTotalFrames) {
            this.introActive = false;
            this.startBannerTimer = 72;
          }
        }
        return;
      }

      if (this.battleManager && this.battleManager.ended) {
        this.battleManager.stepResult();
        return;
      }

      if (this.playerDead) {
        this.updatePlayerDeath();
        return;
      }

      if (this.clearPhase === 2) {
        this.clearTimer += 1;
        if (this.clearTimer >= 180) {
          this.clearFinished = true;
        }
        return;
      }

      if (this.tryAgainActive) {
        this.updateTryAgain();
      }

      if (this.startBannerTimer > 0) {
        this.startBannerTimer -= 1;
      }

      this.player.bits = (b & ~HAMMER) | (hammerEdge ? HAMMER : 0);

      if (!this.isBattleMode) {
        this.updateAllBackStop();
      }
      if (!this.allBackStop) {
        this.updateTimedBombs();
      }

      const prevPlayerState = this.player.state;
      this.stepper.step(this.player, this);
      if (this.battleManager && prevPlayerState !== 10 && this.player.state === 10) {
        const attackerIsPlayer = this.resolveKnockdownAttacker(this.player, { state: prevPlayerState });
        if (attackerIsPlayer === false) {
          this.battleManager.onEvent({
            type: "opponentKnockedDown",
            row: this.player.row,
            col: this.player.col,
            byPlayer: false
          });
        }
      }

      if (!this.tryAgainActive && !this.isBattleMode) {
        this.updateKeyAndShoePickups();
      }
      if (this.player.state === 1) {
        this.player.walkFrames = (this.player.walkFrames || 0) + 1;
      } else {
        this.player.walkFrames = 0;
      }
      if (!this.isBattleMode && !this.stageCleared && !this.tryAgainActive && this.isStageClearConditionMet()) {
        this.startStageClear();
      }

      if (!this.allBackStop) {
        this.updateEnemyCollisions();
        if (this.hunter) {
          if (this.battleManager) {
            this.battleManager.hunterAI.update(this);
            this.battleManager.hunterAI.updateHammer(this);
          } else {
            if (this.f % 2 === 1) {
              this.hunterAI.update(this);
            }
            this.updateHunterHammer();
          }
          const prevHunterState = this.hunter.state;
          this.stepper.step(this.hunter, this);
          if (this.battleManager && prevHunterState !== 10 && this.hunter.state === 10) {
            const attackerIsPlayer = this.resolveKnockdownAttacker(this.hunter, { state: prevHunterState });
            if (attackerIsPlayer === true) {
              this.battleManager.onEvent({
                type: "opponentKnockedDown",
                row: this.hunter.row,
                col: this.hunter.col,
                byPlayer: true
              });
            }
          }
          if (this.hunter.state === 1) {
            this.hunter.walkFrames = (this.hunter.walkFrames || 0) + 1;
          } else {
            this.hunter.walkFrames = 0;
          }
        }
        if (this.enemyAI && this.enemies.length > 0) {
          let enemySnap = null;
          if (this.battleManager) {
            enemySnap = this.enemies.map(e => ({
              isBack: !!e.isBack,
              state: e.state,
              row: e.row,
              col: e.col,
              y: e.y
            }));
          }
          this.enemyAI.updateAll(this);
          if (this.battleManager && enemySnap) {
            for (let i = 0; i < this.enemies.length; i++) {
              const e = this.enemies[i];
              const prev = enemySnap[i];
              // プレイヤーは敵を表→裏に入れたら400点、ハンターは敵を裏→表に出したら400点
              if (!prev.isBack && e.isBack) {
                const door = this.doorMap.get(this.cellKey(e.row, e.col));
                if (door && door.byPlayer) {
                  this.battleManager.onEvent({
                    type: "enemyBackEntered",
                    row: e.row,
                    col: e.col,
                    byPlayer: true
                  });
                }
              } else if (prev.isBack && !e.isBack) {
                const door = this.doorMap.get(this.cellKey(e.row, e.col));
                if (door && !door.byPlayer) {
                  this.battleManager.onEvent({
                    type: "enemyBackEntered",
                    row: e.row,
                    col: e.col,
                    byPlayer: false
                  });
                }
              }
              if (prev.state !== 10 && e.state === 10) {
                const attackerIsPlayer = this.resolveKnockdownAttacker(e, prev);
                this.battleManager.onEvent({
                  type: "enemyKnockedDown",
                  row: e.row,
                  col: e.col,
                  byPlayer: attackerIsPlayer === null ? true : attackerIsPlayer
                });
              }
            }
          }
        }
        this.updateOrb();
      }

      this.updateEffectsAndWaves();

      if (this.battleManager) {
        this.battleManager.updatePopups();
        if (this.isBattleClearConditionMet()) {
          this.battleManager.finish("ALL CLEAR!");
          return;
        }
        this.battleManager.remainFrames -= 1;
        if (this.battleManager.remainFrames <= 0) {
          this.battleManager.remainFrames = 0;
          this.battleManager.finish("TIME UP!");
          return;
        }
        this.f += 1;
        return;
      }

      if (!this.stageCleared && !this.tryAgainActive && this.isStageClearConditionMet()) {
        this.startStageClear();
      }

      if (this.stageCleared) {
        this.playerHitEnemy = false;
        this.playerHitOrb = false;
        if (this.clearPhase === 1) {
          this.clearTimer += 1;
          if (this.clearTimer >= 36) {
            this.clearPhase = 2;
            this.clearTimer = 0;
            this.startBannerTimer = 0;
            // 将来ここでクリアファンファーレを再生
            return;
          }
        }
        this.f += 1;
        return;
      }

      if (!this.tryAgainActive && this.player.state === 16) {
        this.startTryAgain();
      }

      if (!this.tryAgainActive) {
        this.updatePlayerEnemyHit();
        if (this.playerHitEnemy) {
          this.startPlayerDeath();
          return;
        }
      }
      this.f += 1;
    }
  }

  const api = {
    GameWorld
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.BreakerGame = Object.assign(root.BreakerGame || {}, api);
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
