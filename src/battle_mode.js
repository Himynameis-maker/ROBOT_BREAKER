(function (root) {
  "use strict";

  const G = (typeof module !== "undefined" && module.exports && !root.BreakerGame)
    ? require("./constants.js")
    : (root.BreakerGame || {});

  const {
    RIGHT,
    LEFT,
    DOWN,
    UP,
    HAMMER,
    EDGE_SAFE_COLS,
    TILE,
    isLadderTile,
    isFallHoleTile,
    isSolidDrum
  } = G;

  const BATTLE_DURATION_FRAMES = 25 * 60; // 25.00秒
  const BATTLE_RESULT_INTRO_FRAMES = 48; // 終了後0.8sの静止余韻

  function isBattleDestroyTargetTile(t) {
    return t === TILE.WALL_1 ||
      t === TILE.WALL_2 || t === 0x91 ||
      t === TILE.WALL_3 || t === 0xa2 || t === 0xa1 ||
      t === TILE.BOMB ||
      t === TILE.PILLAR ||
      t === TILE.BREAK_LADDER;
  }

  function isBattleAnyActionTargetTile(t) {
    return isBattleDestroyTargetTile(t) || t === TILE.DOOR;
  }

  function getWallDestroyPoints(tile) {
    if (tile === TILE.WALL_1) return 200;
    if (tile === TILE.WALL_2 || tile === 0x91) return 400;
    if (tile === TILE.WALL_3 || tile === 0xa2 || tile === 0xa1) return 600;
    return 0;
  }

  class BattleHunterAI {
    constructor() {
      this.lockedTarget = null;
      this.wantHammerCell = null;
      this.useNormalChase = false;
      this.climbGoalRow = null;
    }

    reset() {
      this.lockedTarget = null;
      this.wantHammerCell = null;
      this.useNormalChase = false;
      this.climbGoalRow = null;
    }

    getDist(world, colA, colB) {
      return Math.abs(colA - colB);
    }

    // (startRow, startCol) から (goalRow, goalCol) への最短移動の一歩目をBFSで求める
    findNextMoveBits(world, startRow, startCol, goalRow, goalCol) {
      const rows = world.rows;
      const cols = world.cols;
      const safeEdge = EDGE_SAFE_COLS || 2;
      const minCol = safeEdge;
      const maxCol = cols - safeEdge - 1;

      if (startRow === goalRow && startCol === goalCol) {
        return 0;
      }

      const isPassable = (r, c) => {
        if (r < 0 || r >= rows || c < 0 || c >= cols) return false;
        const t = world.getTile(r, c);
        if (isSolidDrum(t)) return false;
        if (r < rows - 1 && isFallHoleTile(t)) return false;
        return true;
      };

      const keyOf = (r, c) => r * cols + c;
      const goalKey = keyOf(goalRow, goalCol);
      const startKey = keyOf(startRow, startCol);
      const visited = new Set([startKey]);
      const queue = [{ r: startRow, c: startCol, firstBits: 0 }];

      while (queue.length > 0) {
        const cur = queue.shift();
        const r = cur.r;
        const c = cur.c;

        // 1. 左右の横移動（原則中央エリア優先、端を使う必要がある場合も安全判定）
        const dirs = [
          { dc: -1, bit: LEFT },
          { dc: 1, bit: RIGHT }
        ];
        for (let i = 0; i < dirs.length; i++) {
          const nc = c + dirs[i].dc;
          if (nc < minCol || nc > maxCol) continue;
          if (!isPassable(r, nc)) continue;
          const nk = keyOf(r, nc);
          if (visited.has(nk)) continue;
          visited.add(nk);
          const firstBits = cur.firstBits || dirs[i].bit;
          if (nk === goalKey) return firstBits;
          queue.push({ r, c: nc, firstBits });
        }

        // 2. 上へハシゴ移動
        if (r > 0 && isLadderTile(world.getTile(r, c))) {
          const upTile = world.getTile(r - 1, c);
          if (!isSolidDrum(upTile) && !isFallHoleTile(upTile)) {
            const uk = keyOf(r - 1, c);
            if (!visited.has(uk)) {
              visited.add(uk);
              const firstBits = cur.firstBits || UP;
              if (uk === goalKey) return firstBits;
              queue.push({ r: r - 1, c, firstBits });
            }
          }
        }

        // 3. 下へハシゴ移動
        if (r < rows - 1 && isLadderTile(world.getTile(r + 1, c))) {
          const downTile = world.getTile(r, c);
          if (!isSolidDrum(downTile) && !isFallHoleTile(downTile)) {
            const dk = keyOf(r + 1, c);
            if (!visited.has(dk)) {
              visited.add(dk);
              const firstBits = cur.firstBits || DOWN;
              if (dk === goalKey) return firstBits;
              queue.push({ r: r + 1, c, firstBits });
            }
          }
        }
      }

      // もし穴やドラム缶が特殊な位置にあってBFSで見つからない場合は単純左右/既存AIにフォールバック
      if (startRow === goalRow) {
        return goalCol < startCol ? LEFT : RIGHT;
      }
      return 0;
    }

    hasAnyDestroyTargetOnRow(world, row) {
      for (let c = 0; c < world.cols; c++) {
        if (isBattleDestroyTargetTile(world.getTile(row, c))) {
          return true;
        }
      }
      return false;
    }

    hasAnyDestroyTargetInMap(world) {
      for (let r = 0; r < world.rows; r++) {
        if (this.hasAnyDestroyTargetOnRow(world, r)) return true;
      }
      return false;
    }

    // 同じ段で、左右どちらかに破壊可能オブジェがある爆弾を探す（近い順、同距離は左優先）
    findBestBombTarget(world, hu) {
      const row = hu.row;
      let best = null;
      let bestDist = 999;
      for (let c = 0; c < world.cols; c++) {
        if (world.getTile(row, c) !== TILE.BOMB) continue;
        const leftT = c > 0 ? world.getTile(row, c - 1) : TILE.EMPTY;
        const rightT = c < world.cols - 1 ? world.getTile(row, c + 1) : TILE.EMPTY;
        if (!isBattleDestroyTargetTile(leftT) && !isBattleDestroyTargetTile(rightT)) {
          continue;
        }
        const dist = this.getDist(world, hu.col, c);
        if (dist < bestDist || (dist === bestDist && best && c < best.col)) {
          bestDist = dist;
          best = { row, col: c };
        }
      }
      return best;
    }

    // 同じ段で、裏にいる敵の進行方向1マス先を捉える（穴/ドラム缶なら対象外、近い順、同距離は左優先）
    findBestBackEnemyFrontTarget(world, hu) {
      if (!world.enemies || world.enemies.length === 0) return null;
      const row = hu.row;
      let best = null;
      let bestDist = 999;

      for (let i = 0; i < world.enemies.length; i++) {
        const e = world.enemies[i];
        if (!e.isBack) continue;
        if (e.row !== row) continue;
        if (e.state === 3 || e.state === 4 || e.state === 10 || e.state === 15 || e.state === 16) {
          continue;
        }
        const step = (e.facing & RIGHT) ? 1 : -1;
        const frontCol = world.wrapCol(e.col + step);
        const frontTile = world.getTile(row, frontCol);
        // 穴かドラム缶になったらこの優先をやめる
        if (isFallHoleTile(frontTile) || isSolidDrum(frontTile)) {
          continue;
        }
        const dist = this.getDist(world, hu.col, frontCol);
        if (dist < bestDist || (dist === bestDist && best && frontCol < best.col)) {
          bestDist = dist;
          best = { row, col: frontCol, tile: frontTile };
        }
      }
      return best;
    }

    // 同じ段で最も近いオブジェ（ドアを除く、同距離は左優先）
    findNearestRowDestroyTarget(world, row, fromCol) {
      let best = null;
      let bestDist = 999;
      for (let c = 0; c < world.cols; c++) {
        if (!isBattleDestroyTargetTile(world.getTile(row, c))) continue;
        const dist = this.getDist(world, fromCol, c);
        if (dist < bestDist || (dist === bestDist && best && c < best.col)) {
          bestDist = dist;
          best = { row, col: c };
        }
      }
      return best;
    }

    // 最も近い高さの段にあるオブジェを探す（ドアを除く、同距離は上優先）
    findClosestRowTarget(world, hu) {
      let bestRow = -1;
      let bestRowDiff = 999;
      for (let r = 0; r < world.rows; r++) {
        if (!this.hasAnyDestroyTargetOnRow(world, r)) continue;
        const diff = Math.abs(r - hu.row);
        if (diff < bestRowDiff || (diff === bestRowDiff && r < bestRow)) {
          bestRowDiff = diff;
          bestRow = r;
        }
      }
      if (bestRow < 0) return null;
      return this.findNearestRowDestroyTarget(world, bestRow, hu.col);
    }

    moveTowardCell(world, hu, targetRow, targetCol) {
      // ハシゴ昇降中(State 2)やハシゴ遷移中(State 3/6)の連続制御
      if (hu.state === 2 || hu.state === 3 || hu.state === 6) {
        if (hu.row === targetRow && (hu.state === 6 || (hu.state === 2 && hu.prom < 10))) {
          if (targetCol !== hu.col) {
            hu.bits = targetCol < hu.col ? LEFT : RIGHT;
            return;
          }
        }
        const curDir = hu.dir & (UP | DOWN);
        if (curDir !== 0) {
          hu.bits = curDir;
          return;
        }
      }

      const bits = this.findNextMoveBits(world, hu.row, hu.col, targetRow, targetCol);
      if (bits !== 0) {
        // 上下ハシゴに入る直前はX位置をマスの中心(xMod===0)に合わせる
        if ((bits & (UP | DOWN)) !== 0) {
          const xMod = hu.x & 0x0f;
          if (xMod >= 8) {
            hu.bits = RIGHT | bits;
            return;
          }
          if (xMod >= 1 && xMod <= 7) {
            hu.bits = LEFT | bits;
            return;
          }
        }
        hu.bits = bits;
        return;
      }

      // 万一BFSで見つからない場合の安全フォールバック
      const prevRow = hu.row;
      world.hunterAI.update(world);
      if (hu.row !== prevRow) hu.bits = 0;
    }

    update(world) {
      const hu = world.hunter;
      if (!hu) return;
      const pl = world.player;

      this.wantHammerCell = null;
      this.useNormalChase = false;

      if (hu.state === 10 || hu.state === 11 || hu.state === 15 || hu.state === 16) {
        hu.bits = 0;
        this.lockedTarget = null;
        return;
      }

      // 破壊し始めたら壊し切るまで止まらない（ロック中維持）
      if (this.lockedTarget) {
        const lt = this.lockedTarget;
        const t = world.getTile(lt.row, lt.col);
        if (hu.row === lt.row && hu.col === lt.col && isBattleDestroyTargetTile(t)) {
          hu.bits = 0;
          this.wantHammerCell = { row: lt.row, col: lt.col, isLock: true };
          return;
        }
        this.lockedTarget = null;
      }

      // 全て破壊された場合、普段の追尾ロボ判断に戻る
      if (!this.hasAnyDestroyTargetInMap(world)) {
        this.useNormalChase = true;
        world.hunterAI.update(world);
        return;
      }

      // 水平（同じ段）にドアを除く破壊可能オブジェがない時 -> 最も近い高さのオブジェに合わせる（上優先）
      if (!this.hasAnyDestroyTargetOnRow(world, hu.row)) {
        const verticalTarget = this.findClosestRowTarget(world, hu);
        if (verticalTarget) {
          this.moveTowardCell(world, hu, verticalTarget.row, verticalTarget.col);
        } else {
          this.useNormalChase = true;
          world.hunterAI.update(world);
        }
        return;
      }

      // === 水平（同じ段）に破壊可能オブジェがある時 ===

      // 優先1: 左右どちらかに破壊可能オブジェがある爆弾
      const bombTarget = this.findBestBombTarget(world, hu);
      if (bombTarget) {
        if (hu.row === bombTarget.row && hu.col === bombTarget.col) {
          this.wantHammerCell = { row: bombTarget.row, col: bombTarget.col, isLock: true };
        } else {
          this.moveTowardCell(world, hu, bombTarget.row, bombTarget.col);
        }
        return;
      }

      // 優先2: 裏にいる敵がいる時、その敵の進行方向1マス先を捉え続け、そのマスに入った時破壊可能オブジェマスなら壊す
      const backFront = this.findBestBackEnemyFrontTarget(world, hu);
      if (backFront) {
        if (hu.row === backFront.row && hu.col === backFront.col) {
          if (isBattleAnyActionTargetTile(backFront.tile)) {
            this.wantHammerCell = {
              row: backFront.row,
              col: backFront.col,
              isLock: isBattleDestroyTargetTile(backFront.tile)
            };
          } else {
            // 空きマス上なので中心付近で待機しつつ進行先を捉え続ける
            hu.bits = 0;
          }
        } else {
          this.moveTowardCell(world, hu, backFront.row, backFront.col);
        }
        return;
      }

      // 優先3: プレイヤーが水平2マス以内に入った時、通常の判断に変える
      if (pl && pl.row === hu.row && Math.abs(pl.col - hu.col) <= 2) {
        this.useNormalChase = true;
        world.hunterAI.update(world);
        return;
      }

      // 優先4: 自身のマス（ドア除く破壊可能オブジェ）
      if (isBattleDestroyTargetTile(world.getTile(hu.row, hu.col))) {
        this.wantHammerCell = { row: hu.row, col: hu.col, isLock: true };
        return;
      }

      // 優先5 & 6: 最も近い左側のオブジェ > 右（同距離なら左優先）
      const horizTarget = this.findNearestRowDestroyTarget(world, hu.row, hu.col);
      if (horizTarget) {
        this.moveTowardCell(world, hu, horizTarget.row, horizTarget.col);
        return;
      }

      this.useNormalChase = true;
      world.hunterAI.update(world);
    }

    updateHammer(world) {
      const hu = world.hunter;
      if (!hu) return;
      const pl = world.player;

      hu.bits &= ~HAMMER;
      if (hu.state === 4 || hu.state === 10 || hu.state === 11 || hu.state === 15 || hu.state === 16) {
        return;
      }

      const curTile = world.getTile(hu.row, hu.col);
      const xMod = hu.x & 0x0f;
      const nearCenter = xMod <= 2 || xMod >= 14;

      // 1. 破壊目標セルに到達していれば中心寄り（または待機状態）で叩く
      if (this.wantHammerCell &&
          hu.row === this.wantHammerCell.row &&
          hu.col === this.wantHammerCell.col) {
        if (isBattleAnyActionTargetTile(curTile)) {
          if (nearCenter || hu.state === 0) {
            hu.bits |= HAMMER;
            if (this.wantHammerCell.isLock && isBattleDestroyTargetTile(curTile)) {
              this.lockedTarget = { row: hu.row, col: hu.col };
            }
            return;
          }
          // まだ中心へ歩いている最中は中心方向へ微調整
          hu.bits = (hu.bits & ~(LEFT | RIGHT)) | (xMod >= 8 ? RIGHT : LEFT);
          return;
        }
      }

      // 2. ロック中のセルに留まっている間は即叩く
      if (this.lockedTarget &&
          hu.row === this.lockedTarget.row &&
          hu.col === this.lockedTarget.col &&
          isBattleDestroyTargetTile(curTile)) {
        hu.bits |= HAMMER;
        return;
      }

      // 3. 移動中に閉じたドアを通った時、中心付近なら叩いて開ける（200点）
      if (curTile === TILE.DOOR && (nearCenter || hu.state === 0)) {
        hu.bits |= HAMMER;
        return;
      }

      // 4. 通常追尾判断（プレイヤー水平2マス以内）中なら、同じマスの破壊対象（爆弾含む）も叩く
      if (this.useNormalChase && pl && hu.row === pl.row && hu.col === pl.col) {
        if (isBattleAnyActionTargetTile(curTile)) {
          hu.bits |= HAMMER;
          if (isBattleDestroyTargetTile(curTile)) {
            this.lockedTarget = { row: hu.row, col: hu.col };
          }
        }
      }
    }
  }

  class BattleManager {
    constructor(options = {}) {
      this.durationFrames = options.durationFrames || BATTLE_DURATION_FRAMES;
      this.remainFrames = this.durationFrames;
      this.scores = {
        player: { total: 0, c200: 0, c400: 0, c600: 0, c800: 0 },
        hunter: { total: 0, c200: 0, c400: 0, c600: 0, c800: 0 }
      };
      this.popups = [];
      this.ended = false;
      this.endReason = ""; // "TIME UP" | "ALL CLEAR"
      this.resultPhase = 0; // 0:対戦中, 1:終了文字静止(48F), 2:暗転リザルト
      this.resultTimer = 0;
      this.resultFinished = false;
      this.hunterAI = new BattleHunterAI();
    }

    addScore(byPlayer, points, row, col) {
      if (this.ended || !points) return;
      const bag = byPlayer ? this.scores.player : this.scores.hunter;
      bag.total += points;
      if (points === 200) bag.c200 += 1;
      else if (points === 400) bag.c400 += 1;
      else if (points === 600) bag.c600 += 1;
      else if (points === 800) bag.c800 += 1;

      this.popups.push({
        x: col * 16 + 8,
        y: Math.max(20, row * 32 + 4),
        points,
        byPlayer: !!byPlayer,
        timer: 44,
        maxTimer: 44
      });
    }

    onEvent(evt) {
      if (!evt || this.ended) return;
      if (evt.type === "wallDestroyed") {
        const pts = getWallDestroyPoints(evt.tile);
        if (pts > 0) this.addScore(evt.byPlayer, pts, evt.row, evt.col);
      } else if (evt.type === "bombExploded" ||
                 evt.type === "doorOpened" ||
                 evt.type === "ladderDestroyed" ||
                 evt.type === "pillarDestroyed") {
        this.addScore(evt.byPlayer, 200, evt.row, evt.col);
      } else if (evt.type === "enemyBackEntered" ||
                 evt.type === "enemyKnockedDown") {
        this.addScore(evt.byPlayer, 800, evt.row, evt.col);
      }
    }

    updatePopups() {
      for (let i = this.popups.length - 1; i >= 0; i--) {
        const p = this.popups[i];
        p.y -= 0.35;
        p.timer -= 1;
        if (p.timer <= 0) {
          this.popups.splice(i, 1);
        }
      }
    }

    finish(reason) {
      if (this.ended) return;
      this.ended = true;
      this.endReason = reason || "TIME UP";
      this.resultPhase = 1;
      this.resultTimer = 0;
      this.resultFinished = false;
    }

    stepResult() {
      this.updatePopups();
      if (this.resultPhase === 1) {
        this.resultTimer += 1;
        if (this.resultTimer >= BATTLE_RESULT_INTRO_FRAMES) {
          this.resultPhase = 2;
          this.resultTimer = 0;
        }
        return;
      }
      if (this.resultPhase === 2) {
        this.resultTimer += 1;
        if (this.resultTimer >= 165) {
          this.resultFinished = true;
        }
      }
    }
  }

  const api = {
    BATTLE_DURATION_FRAMES,
    isBattleDestroyTargetTile,
    isBattleAnyActionTargetTile,
    getWallDestroyPoints,
    BattleHunterAI,
    BattleManager
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.BreakerGame = Object.assign(root.BreakerGame || {}, api);
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
