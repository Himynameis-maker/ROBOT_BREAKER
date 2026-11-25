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
      this.moveGoal = null;
      this.ladderDir = 0;
      this.ladderStartRow = null;
      this.pendingClimbBits = 0;
    }

    reset() {
      this.lockedTarget = null;
      this.wantHammerCell = null;
      this.useNormalChase = false;
      this.moveGoal = null;
      this.ladderDir = 0;
      this.ladderStartRow = null;
      this.pendingClimbBits = 0;
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

    // 同じ段で、裏にいる敵の進行方向1マス先に破壊可能オブジェがあるマスをすべて検索し、最も近いマスを返す（同距離は左優先）
    findBestBackEnemyFrontTarget(world, hu, rowOverride) {
      if (!world.enemies || world.enemies.length === 0) return null;
      const row = rowOverride != null ? rowOverride : hu.row;
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
        // 敵の進行方向1マス先に破壊可能オブジェがあるときだけトリガー（穴・ドラム缶・空マスは無視）
        if (!isBattleDestroyTargetTile(frontTile)) {
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

    isCellTriggeredByBackEnemy(world, row, col) {
      if (!world.enemies || world.enemies.length === 0) return false;
      for (let i = 0; i < world.enemies.length; i++) {
        const e = world.enemies[i];
        if (!e.isBack || e.row !== row) continue;
        if (e.state === 3 || e.state === 4 || e.state === 10 || e.state === 15 || e.state === 16) {
          continue;
        }
        const step = (e.facing & RIGHT) ? 1 : -1;
        const frontCol = world.wrapCol(e.col + step);
        if (frontCol === col && isBattleDestroyTargetTile(world.getTile(row, frontCol))) {
          return true;
        }
      }
      return false;
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

    // ハシゴ昇降・遷移中の安全維持（毎フレーム呼ばれても安全）
    maintainLadderState(world, hu) {
      if (hu.state === 8 || hu.state === 9) {
        hu.bits = hu.dir & (LEFT | RIGHT);
        return true;
      }

      if (hu.state === 3) {
        if (hu.kind === "enter") {
          hu.bits = UP;
        } else if (hu.kind === "enter_top") {
          hu.bits = DOWN;
        } else {
          hu.bits = 0;
        }
        return true;
      }

      if (hu.state === 6) {
        if (hu.kind === "cont" && this.moveGoal && hu.row === this.moveGoal.row) {
          if (this.moveGoal.col !== hu.col) {
            hu.bits = this.moveGoal.col < hu.col ? LEFT : RIGHT;
            return true;
          }
        }
        const dirV = this.ladderDir || (hu.dir & (UP | DOWN));
        hu.bits = dirV || UP;
        return true;
      }

      if (hu.state === 2) {
        // 下り連続ハシゴの境目 (prom===31 でちょうど上の段の床高さにいる1フレーム) なら横へ降りられる
        if (hu.prom === 31 &&
            hu.y === (hu.row + 1) * 32 &&
            this.moveGoal &&
            hu.row === this.moveGoal.row &&
            this.ladderStartRow !== hu.row &&
            this.moveGoal.col !== hu.col) {
          hu.bits = this.moveGoal.col < hu.col ? LEFT : RIGHT;
          return true;
        }
        const dirV = this.ladderDir || (hu.dir & (UP | DOWN));
        hu.bits = dirV || UP;
        return true;
      }

      this.ladderDir = 0;
      this.ladderStartRow = null;
      return false;
    }

    moveTowardCell(world, hu, targetRow, targetCol) {
      this.moveGoal = { row: targetRow, col: targetCol };
      this.pendingClimbBits = 0;

      if (this.maintainLadderState(world, hu)) {
        return;
      }

      const bits = this.findNextMoveBits(world, hu.row, hu.col, targetRow, targetCol);
      if (bits !== 0) {
        if ((bits & (UP | DOWN)) !== 0) {
          this.pendingClimbBits = bits;
          this.ladderDir = bits;
          this.ladderStartRow = hu.row;
          const xMod = hu.x & 0x0f;
          // ハシゴ進入前にまず純粋な横移動だけでマス中央付近へ寄せる（競合・震え防止）
          if (xMod > 2 && xMod < 14) {
            hu.bits = xMod >= 8 ? RIGHT : LEFT;
            return;
          }
          hu.bits = bits;
          return;
        }
        hu.bits = bits;
        return;
      }

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
        this.moveGoal = null;
        this.ladderDir = 0;
        this.ladderStartRow = null;
        this.pendingClimbBits = 0;
        return;
      }

      // ハシゴ昇降・遷移中は途中で目標を切り替えて震えないよう完遂する
      if (hu.state === 2 || hu.state === 3 || hu.state === 6 || hu.state === 8 || hu.state === 9) {
        this.maintainLadderState(world, hu);
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
          hu.bits = 0;
        } else {
          this.moveTowardCell(world, hu, bombTarget.row, bombTarget.col);
        }
        return;
      }

      // 優先2: 同じ段に裏にいる敵がいて、その進行方向1マス先に破壊可能オブジェがある時だけトリガー
      const backFront = this.findBestBackEnemyFrontTarget(world, hu, hu.row);
      if (backFront) {
        if (hu.row === backFront.row && hu.col === backFront.col) {
          this.wantHammerCell = {
            row: backFront.row,
            col: backFront.col,
            isLock: true
          };
          hu.bits = 0;
        } else {
          this.moveTowardCell(world, hu, backFront.row, backFront.col);
        }
        return;
      }

      // 優先3: プレイヤーが水平2マス以内に入った時、通常の判断に変える
      if (pl && pl.row === hu.row && Math.abs(pl.col - hu.col) <= 2) {
        this.useNormalChase = true;
        this.moveGoal = null;
        this.pendingClimbBits = 0;
        world.hunterAI.update(world);
        return;
      }

      // 優先4: 自身のマス（ドア除く破壊可能オブジェ）
      if (isBattleDestroyTargetTile(world.getTile(hu.row, hu.col))) {
        this.wantHammerCell = { row: hu.row, col: hu.col, isLock: true };
        hu.bits = 0;
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

    // 毎フレーム呼ばれる（高頻度検索・ハシゴ同期・ドア/ターゲット叩き）
    updateHammer(world) {
      const hu = world.hunter;
      if (!hu) return;
      const pl = world.player;

      hu.bits &= ~HAMMER;
      if (hu.state === 4 || hu.state === 10 || hu.state === 11 || hu.state === 15 || hu.state === 16) {
        return;
      }

      // 毎フレームハシゴ状態を安全維持（1Fの取りこぼしによる離脱ミスを防止）
      if (hu.state === 2 || hu.state === 3 || hu.state === 6 || hu.state === 8 || hu.state === 9) {
        this.maintainLadderState(world, hu);
        return;
      }

      // ハシゴ進入直前の中央寄せが完了した瞬間に、1Fも遅れず上下入力へ切り替え
      if (this.pendingClimbBits !== 0) {
        const xModC = hu.x & 0x0f;
        if (xModC <= 2 || xModC >= 14) {
          hu.bits = this.pendingClimbBits;
          this.pendingClimbBits = 0;
        }
      }

      const curTile = world.getTile(hu.row, hu.col);
      const xMod = hu.x & 0x0f;
      const nearCenter = xMod <= 2 || xMod >= 14;

      // 1. ロック中のセルに留まっている間は即叩き切る
      if (this.lockedTarget &&
          hu.row === this.lockedTarget.row &&
          hu.col === this.lockedTarget.col &&
          isBattleDestroyTargetTile(curTile)) {
        hu.bits = HAMMER;
        return;
      }

      // 2. 高頻度検索：裏の敵の進行方向1マス先トリガーと今いるマスが一致していれば殴る
      if (this.isCellTriggeredByBackEnemy(world, hu.row, hu.col)) {
        if (nearCenter || hu.state === 0) {
          hu.bits = HAMMER;
          this.lockedTarget = { row: hu.row, col: hu.col };
          return;
        }
        hu.bits = xMod >= 8 ? RIGHT : LEFT;
        return;
      }

      // 3. 通る場所に閉じたドアがあるなら（別フロアへの移動中でも）殴って開ける（200点）
      if (curTile === TILE.DOOR) {
        hu.bits |= HAMMER;
        return;
      }

      // 4. 破壊目標セル（爆弾・自身のマス・左右オブジェ）に到達していれば中心寄りで叩く
      if (this.wantHammerCell &&
          hu.row === this.wantHammerCell.row &&
          hu.col === this.wantHammerCell.col &&
          isBattleDestroyTargetTile(curTile)) {
        if (nearCenter || hu.state === 0) {
          hu.bits = HAMMER;
          if (this.wantHammerCell.isLock) {
            this.lockedTarget = { row: hu.row, col: hu.col };
          }
          return;
        }
        hu.bits = xMod >= 8 ? RIGHT : LEFT;
        return;
      }

      // 5. 通常追尾判断（プレイヤー水平2マス以内）中なら、同じマスの破壊対象も叩く
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
