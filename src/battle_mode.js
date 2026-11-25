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
      this.aStarLockTarget = null;
      this.wantHammerCell = null;
      this.useNormalChase = false;
      this.pendingBombEscape = null;
      this.bombEscapeTarget = null;
      this.bombEscapeTicks = 0;
      this.lastClimbY = null;
      this.climbStuckFrames = 0;
      this.pathCache = null;
      this.backFrontCache = null;
      this.backFrontCheckTick = -99;
    }

    reset() {
      this.lockedTarget = null;
      this.aStarLockTarget = null;
      this.wantHammerCell = null;
      this.useNormalChase = false;
      this.pendingBombEscape = null;
      this.bombEscapeTarget = null;
      this.bombEscapeTicks = 0;
      this.lastClimbY = null;
      this.climbStuckFrames = 0;
      this.pathCache = null;
      this.backFrontCache = null;
      this.backFrontCheckTick = -99;
    }

    notifyBombHit(row, col) {
      this.pendingBombEscape = { row, col };
      this.lockedTarget = null;
      this.aStarLockTarget = null;
      this.pathCache = null;
    }

    // ドア以外の何かを自力で殴った瞬間に呼ばれ、A*継続ロックを解除する
    notifyNonDoorHit() {
      this.aStarLockTarget = null;
      this.pathCache = null;
    }

    getDist(colA, colB) {
      return Math.abs(colA - colB);
    }

    isContinuousLadder(world, r, c) {
      if (r < 0 || r >= world.rows - 1) return false;
      const t = world.getTile(r, c);
      const b = world.getTile(r + 1, c);
      return (t === TILE.LADDER && b === TILE.LADDER) ||
        (t === TILE.BREAK_LADDER && b === TILE.BREAK_LADDER) ||
        (t === TILE.SAND_LADDER && b === TILE.SAND_LADDER);
    }

    // 96マスのA*経路探索（下り連続ハシゴは一番下の段まで降りる実機準拠エッジ）
    findAStarStep(world, startRow, startCol, goalMatchFn, heuristicGoal = null, allowHoleDrop = false) {
      const rows = world.rows;
      const cols = world.cols;
      const keyOf = (r, c) => r * cols + c;
      const startKey = keyOf(startRow, startCol);

      if (goalMatchFn(startRow, startCol)) {
        return { found: true, row: startRow, col: startCol, cost: 0, firstBits: 0 };
      }

      const hVal = (r, c) => {
        if (!heuristicGoal) return 0;
        return Math.abs(c - heuristicGoal.col) + Math.abs(r - heuristicGoal.row) * 2;
      };

      const gScore = new Float64Array(rows * cols);
      gScore.fill(1e9);
      gScore[startKey] = 0;

      const closed = new Uint8Array(rows * cols);
      const open = [{
        r: startRow,
        c: startCol,
        g: 0,
        f: hVal(startRow, startCol),
        firstBits: 0
      }];

      const isStandableFloor = (r, c) => {
        const t = world.getTile(r, c);
        if (isSolidDrum(t) || t === TILE.DRUM_FALLING) return false;
        if (r < rows - 1 && isFallHoleTile(t)) return false;
        return true;
      };

      while (open.length > 0) {
        let bestIdx = 0;
        for (let i = 1; i < open.length; i++) {
          if (open[i].f < open[bestIdx].f) bestIdx = i;
        }
        const cur = open.splice(bestIdx, 1)[0];
        const curKey = keyOf(cur.r, cur.c);
        if (closed[curKey]) continue;
        closed[curKey] = 1;

        if (curKey !== startKey && goalMatchFn(cur.r, cur.c)) {
          return {
            found: true,
            row: cur.r,
            col: cur.c,
            cost: cur.g,
            firstBits: cur.firstBits
          };
        }

        const r = cur.r;
        const c = cur.c;

        // 1. 横移動
        const horizDirs = [
          { dc: -1, bit: LEFT },
          { dc: 1, bit: RIGHT }
        ];
        const canLeaveContHoriz = r === rows - 1 || !this.isContinuousLadder(world, r, c);
        if (canLeaveContHoriz || curKey === startKey) {
          for (let i = 0; i < horizDirs.length; i++) {
            const rawNc = c + horizDirs[i].dc;
            const wrapped = rawNc < 0 || rawNc >= cols;
            const nc = world.wrapCol(rawNc);
            const nextT = world.getTile(r, nc);
            if (isSolidDrum(nextT) || nextT === TILE.DRUM_FALLING) continue;

            if (r < rows - 1 && isFallHoleTile(nextT)) {
              if (!allowHoleDrop) continue;
              let landR = r + 1;
              while (landR < rows - 1 && isFallHoleTile(world.getTile(landR, nc))) {
                landR += 1;
              }
              if (isSolidDrum(world.getTile(landR, nc))) continue;
              const dropCost = cur.g + 6 + (landR - r) * 2;
              const lk = keyOf(landR, nc);
              if (dropCost < gScore[lk]) {
                gScore[lk] = dropCost;
                open.push({
                  r: landR,
                  c: nc,
                  g: dropCost,
                  f: dropCost + hVal(landR, nc),
                  firstBits: cur.firstBits || horizDirs[i].bit
                });
              }
              continue;
            }

            const stepCost = wrapped ? 1.2 : 1.0;
            const ng = cur.g + stepCost;
            const nk = keyOf(r, nc);
            if (ng < gScore[nk]) {
              gScore[nk] = ng;
              open.push({
                r,
                c: nc,
                g: ng,
                f: ng + hVal(r, nc),
                firstBits: cur.firstBits || horizDirs[i].bit
              });
            }
          }
        }

        // 2. 上へハシゴ移動
        if (r > 0 && isLadderTile(world.getTile(r, c))) {
          const upT = world.getTile(r - 1, c);
          if (!isSolidDrum(upT) && upT !== TILE.DRUM_FALLING && !isFallHoleTile(upT)) {
            const ng = cur.g + 2.0;
            const uk = keyOf(r - 1, c);
            if (ng < gScore[uk]) {
              gScore[uk] = ng;
              open.push({
                r: r - 1,
                c,
                g: ng,
                f: ng + hVal(r - 1, c),
                firstBits: cur.firstBits || UP
              });
            }
          }
        }

        // 3. 下へハシゴ移動（連続ハシゴは一番下まで）
        if (r < rows - 1 && isLadderTile(world.getTile(r + 1, c)) && isStandableFloor(r, c)) {
          let endR = r + 1;
          let blocked = false;
          while (endR < rows - 1 && this.isContinuousLadder(world, endR, c)) {
            const belowT = world.getTile(endR + 1, c);
            if (isSolidDrum(belowT) || belowT === TILE.DRUM_FALLING) {
              blocked = true;
              break;
            }
            endR += 1;
          }
          if (!blocked) {
            const endT = world.getTile(endR, c);
            if (!isSolidDrum(endT) && endT !== TILE.DRUM_FALLING && !(endR < rows - 1 && isFallHoleTile(endT))) {
              const ng = cur.g + 2.0 * (endR - r);
              const dk = keyOf(endR, c);
              if (ng < gScore[dk]) {
                gScore[dk] = ng;
                open.push({
                  r: endR,
                  c,
                  g: ng,
                  f: ng + hVal(endR, c),
                  firstBits: cur.firstBits || DOWN
                });
              }
            }
          }
        }
      }

      return { found: false, firstBits: 0 };
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

    // 優先1: 左右どちらかに破壊可能オブジェがある爆弾
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
        const dist = this.getDist(hu.col, c);
        if (dist < bestDist || (dist === bestDist && best && c < best.col)) {
          bestDist = dist;
          best = { row, col: c };
        }
      }
      return best;
    }

    // 優先2: 同じ段の裏敵の進行方向1マス先に「破壊可能オブジェ」がある時だけトリガー（負荷配慮で2Fごと更新）
    findBestBackEnemyBreakableFront(world, hu) {
      if (!world.enemies || world.enemies.length === 0) return null;
      if ((world.f - this.backFrontCheckTick) < 2 && this.backFrontCheckTick >= 0) {
        if (this.backFrontCache &&
            this.backFrontCache.row === hu.row &&
            isBattleAnyActionTargetTile(world.getTile(this.backFrontCache.row, this.backFrontCache.col))) {
          return this.backFrontCache;
        }
        return null;
      }

      this.backFrontCheckTick = world.f;
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
        if (!isBattleAnyActionTargetTile(frontTile)) {
          continue;
        }
        const dist = this.getDist(hu.col, frontCol);
        if (dist < bestDist || (dist === bestDist && best && frontCol < best.col)) {
          bestDist = dist;
          best = { row, col: frontCol, tile: frontTile };
        }
      }

      this.backFrontCache = best;
      return best;
    }

    findNearestRowDestroyTarget(world, row, fromCol) {
      let best = null;
      let bestDist = 999;
      for (let c = 0; c < world.cols; c++) {
        if (!isBattleDestroyTargetTile(world.getTile(row, c))) continue;
        const dist = this.getDist(fromCol, c);
        if (dist < bestDist || (dist === bestDist && best && c < best.col)) {
          bestDist = dist;
          best = { row, col: c };
        }
      }
      return best;
    }

    getClosestHeightRows(world, fromRow) {
      const list = [];
      for (let r = 0; r < world.rows; r++) {
        if (this.hasAnyDestroyTargetOnRow(world, r)) {
          list.push(r);
        }
      }
      list.sort((a, b) => {
        const da = Math.abs(a - fromRow);
        const db = Math.abs(b - fromRow);
        if (da !== db) return da - db;
        return a - b;
      });
      return list;
    }

    startBombEscapeIfNeeded(world, hu) {
      if (!this.pendingBombEscape) return false;
      const r = hu.row;
      const c = hu.col;
      this.pendingBombEscape = null;

      const canStep = (nc) => {
        const t = world.getTile(r, nc);
        if (isSolidDrum(t) || t === TILE.DRUM_FALLING) return false;
        if (r < world.rows - 1 && isFallHoleTile(t)) return false;
        return true;
      };

      const leftCol = world.wrapCol(c - 1);
      const rightCol = world.wrapCol(c + 1);
      const okLeft = canStep(leftCol);
      const okRight = canStep(rightCol);
      if (!okLeft && !okRight) return false;

      let chosenDir = LEFT;
      let chosenCol = leftCol;
      if (okLeft && okRight) {
        if (Math.random() < 0.5) {
          chosenDir = LEFT;
          chosenCol = leftCol;
        } else {
          chosenDir = RIGHT;
          chosenCol = rightCol;
        }
      } else if (okRight) {
        chosenDir = RIGHT;
        chosenCol = rightCol;
      }

      this.bombEscapeTarget = { row: r, col: chosenCol, dir: chosenDir };
      this.bombEscapeTicks = 0;
      return true;
    }

    stepToBits(hu, bits) {
      if ((bits & (UP | DOWN)) !== 0) {
        const xMod = hu.x & 0x0f;
        if (xMod === 6 || xMod === 7) {
          hu.bits = LEFT;
          return;
        }
        if (xMod === 8 || xMod === 9) {
          hu.bits = RIGHT;
          return;
        }
        hu.bits = bits;
        return;
      }
      hu.bits = bits;
    }

    // 同じマスに留まっている間や10F以内は経路キャッシュを再利用して負荷を抑える
    moveTowardGoalCached(world, hu, goalRow, goalCol) {
      const gKey = goalRow + "," + goalCol;
      const cache = this.pathCache;
      if (cache &&
          cache.row === hu.row &&
          cache.col === hu.col &&
          cache.goalKey === gKey &&
          (world.f - cache.tick) < 10) {
        if (!cache.found) return false;
        this.stepToBits(hu, cache.bits);
        return true;
      }

      const res = this.findAStarStep(
        world,
        hu.row,
        hu.col,
        (r, c) => r === goalRow && c === goalCol,
        { row: goalRow, col: goalCol },
        false
      );
      this.pathCache = {
        row: hu.row,
        col: hu.col,
        goalKey: gKey,
        tick: world.f,
        found: res.found,
        bits: res.firstBits
      };
      if (!res.found) return false;
      this.stepToBits(hu, res.firstBits);
      return true;
    }

    // A* で最短（実移動コスト最小）のドア除く破壊可能オブジェを探し、ロック開始する
    acquireAndFollowAStarTarget(world, hu) {
      // すでにロック中のターゲットがまだ存在するなら、そこへ向かい続ける
      if (this.aStarLockTarget) {
        const at = this.aStarLockTarget;
        if (isBattleDestroyTargetTile(world.getTile(at.row, at.col))) {
          if (hu.row === at.row && hu.col === at.col) {
            this.wantHammerCell = { row: at.row, col: at.col, isLock: true };
            return true;
          }
          if (this.moveTowardGoalCached(world, hu, at.row, at.col)) {
            return true;
          }
        }
        // 目標が先に壊されたか到達不能になったら次の最短目標を探し直す（ドア以外を殴るまで継続）
        this.aStarLockTarget = null;
        this.pathCache = null;
      }

      let res = this.findAStarStep(
        world,
        hu.row,
        hu.col,
        (r, c) => isBattleDestroyTargetTile(world.getTile(r, c)),
        null,
        false
      );
      if (!res.found) {
        res = this.findAStarStep(
          world,
          hu.row,
          hu.col,
          (r, c) => isBattleDestroyTargetTile(world.getTile(r, c)),
          null,
          true
        );
      }
      if (!res.found) return false;

      this.aStarLockTarget = { row: res.row, col: res.col };
      if (hu.row === res.row && hu.col === res.col) {
        this.wantHammerCell = { row: res.row, col: res.col, isLock: true };
      } else {
        this.stepToBits(hu, res.firstBits);
      }
      return true;
    }

    handleLadderAndTransitionStates(world, hu) {
      if (hu.state === 4) {
        hu.bits = 0;
        this.lastClimbY = null;
        this.climbStuckFrames = 0;
        return true;
      }
      if (hu.state === 8 || hu.state === 9) {
        hu.bits = hu.dir & (LEFT | RIGHT);
        this.lastClimbY = null;
        this.climbStuckFrames = 0;
        return true;
      }
      if (hu.state === 3) {
        hu.bits = hu.dir & (UP | DOWN);
        this.lastClimbY = null;
        this.climbStuckFrames = 0;
        return true;
      }

      // State 2 (はしご昇降中): 1段を登り切る・降り切るまで縦方向を維持して震えを根絶
      if (hu.state === 2) {
        let vDir = hu.dir & (UP | DOWN);
        if (vDir === 0) vDir = UP;

        if (this.lastClimbY === hu.y) {
          this.climbStuckFrames += 1;
          if (this.climbStuckFrames >= 8) {
            vDir = (vDir === UP) ? DOWN : UP;
            this.climbStuckFrames = 0;
          }
        } else {
          this.lastClimbY = hu.y;
          this.climbStuckFrames = 0;
        }
        hu.bits = vDir;
        return true;
      }

      // State 6 (連続ハシゴの段切り替わり): 実際の床高さで途中下車判断
      if (hu.state === 6) {
        this.lastClimbY = null;
        this.climbStuckFrames = 0;
        const floorRow = Math.max(0, Math.min(world.rows - 1, Math.round((hu.y - 32) / 32)));
        const canExitSide = hu.prom < 10;

        if (canExitSide) {
          if (this.aStarLockTarget && this.aStarLockTarget.row === floorRow) {
            hu.bits = this.aStarLockTarget.col < hu.col ? LEFT : RIGHT;
            return true;
          }
          if (!this.aStarLockTarget && this.hasAnyDestroyTargetOnRow(world, floorRow)) {
            const target = this.findNearestRowDestroyTarget(world, floorRow, hu.col);
            hu.bits = (target && target.col < hu.col) ? LEFT : RIGHT;
            return true;
          }
        }

        hu.bits = (hu.dir & (UP | DOWN)) || UP;
        return true;
      }

      this.lastClimbY = null;
      this.climbStuckFrames = 0;
      return false;
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
        this.pendingBombEscape = null;
        this.bombEscapeTarget = null;
        this.lastClimbY = null;
        this.climbStuckFrames = 0;
        this.pathCache = null;
        return;
      }

      if (this.handleLadderAndTransitionStates(world, hu)) {
        return;
      }

      // 最優先0-A: 爆弾を殴った後の50/50左右避難移動
      this.startBombEscapeIfNeeded(world, hu);
      if (this.bombEscapeTarget) {
        this.bombEscapeTicks += 1;
        const esc = this.bombEscapeTarget;
        const xMod = hu.x & 0x0f;
        const arrived = hu.row === esc.row && hu.col === esc.col && (xMod <= 1 || xMod >= 15);
        if (arrived || hu.row !== esc.row || this.bombEscapeTicks > 36) {
          this.bombEscapeTarget = null;
        } else {
          hu.bits = esc.dir;
          return;
        }
      }

      // 最優先0-B: 破壊し始めたら壊し切るまで止まらない
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

      // 全て破壊された場合は普段の追尾ロボ判断に戻る
      if (!this.hasAnyDestroyTargetInMap(world)) {
        this.aStarLockTarget = null;
        this.useNormalChase = true;
        if ((world.f & 1) === 1) {
          world.hunterAI.update(world);
        }
        return;
      }

      // 最優先0-C: 一度A*が発動したら、ドア以外の何かを自力で殴るまでA*モードを継続
      if (this.aStarLockTarget) {
        if (this.acquireAndFollowAStarTarget(world, hu)) {
          return;
        }
      }

      // === 水平（同じ段）にドアを除く破壊可能オブジェがない時 ===
      if (!this.hasAnyDestroyTargetOnRow(world, hu.row)) {
        const heightRows = this.getClosestHeightRows(world, hu.row);
        let moved = false;
        for (let i = 0; i < heightRows.length; i++) {
          const targetRow = heightRows[i];
          const target = this.findNearestRowDestroyTarget(world, targetRow, hu.col);
          if (target && this.moveTowardGoalCached(world, hu, target.row, target.col)) {
            moved = true;
            break;
          }
        }
        // 進みたい高さへ進めない時は、最低優先としてA*を発動（ドア以外を殴るまで継続）
        if (!moved) {
          if (!this.acquireAndFollowAStarTarget(world, hu)) {
            this.useNormalChase = true;
            if ((world.f & 1) === 1) {
              world.hunterAI.update(world);
            }
          }
        }
        return;
      }

      // === 水平（同じ段）に破壊可能オブジェがある時 ===

      // 優先1: 左右どちらかに破壊可能オブジェがある爆弾
      const bombTarget = this.findBestBombTarget(world, hu);
      if (bombTarget) {
        if (hu.row === bombTarget.row && hu.col === bombTarget.col) {
          this.wantHammerCell = { row: bombTarget.row, col: bombTarget.col, isLock: true };
        } else if (!this.moveTowardGoalCached(world, hu, bombTarget.row, bombTarget.col)) {
          this.acquireAndFollowAStarTarget(world, hu);
        }
        return;
      }

      // 優先2: 同じ段の裏の敵の進行方向1マス先に破壊可能オブジェがある時だけトリガー
      const backBreakTarget = this.findBestBackEnemyBreakableFront(world, hu);
      if (backBreakTarget) {
        if (hu.row === backBreakTarget.row && hu.col === backBreakTarget.col) {
          this.wantHammerCell = {
            row: backBreakTarget.row,
            col: backBreakTarget.col,
            isLock: isBattleDestroyTargetTile(backBreakTarget.tile)
          };
        } else if (!this.moveTowardGoalCached(world, hu, backBreakTarget.row, backBreakTarget.col)) {
          this.acquireAndFollowAStarTarget(world, hu);
        }
        return;
      }

      // 優先3: プレイヤーが水平2マス以内に入った時、通常の判断に変える
      if (pl && pl.row === hu.row && Math.abs(pl.col - hu.col) <= 2) {
        this.useNormalChase = true;
        if ((world.f & 1) === 1) {
          world.hunterAI.update(world);
        }
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
        if (!this.moveTowardGoalCached(world, hu, horizTarget.row, horizTarget.col)) {
          this.acquireAndFollowAStarTarget(world, hu);
        }
        return;
      }

      this.acquireAndFollowAStarTarget(world, hu);
    }

    updateHammer(world) {
      const hu = world.hunter;
      if (!hu) return;
      const pl = world.player;

      hu.bits &= ~HAMMER;
      if (hu.state === 2 || hu.state === 3 || hu.state === 4 ||
          hu.state === 6 || hu.state === 8 || hu.state === 9 ||
          hu.state === 10 || hu.state === 11 || hu.state === 15 || hu.state === 16) {
        return;
      }

      if (this.bombEscapeTarget || this.pendingBombEscape) {
        return;
      }

      const curTile = world.getTile(hu.row, hu.col);
      const xMod = hu.x & 0x0f;
      const nearCenter = xMod <= 1 || xMod >= 15;

      // 1. 破壊目標セルに到達していれば中心（または待機状態）で殴る
      if (this.wantHammerCell &&
          hu.row === this.wantHammerCell.row &&
          hu.col === this.wantHammerCell.col &&
          isBattleAnyActionTargetTile(curTile)) {
        if (nearCenter || hu.state === 0) {
          hu.bits |= HAMMER;
          if (this.wantHammerCell.isLock && isBattleDestroyTargetTile(curTile)) {
            this.lockedTarget = { row: hu.row, col: hu.col };
          }
          return;
        }
        hu.bits = (hu.bits & ~(LEFT | RIGHT)) | (xMod >= 8 ? RIGHT : LEFT);
        return;
      }

      // 2. ロック中のセルに留まっている間は壊し切るまで殴る
      if (this.lockedTarget &&
          hu.row === this.lockedTarget.row &&
          hu.col === this.lockedTarget.col &&
          isBattleDestroyTargetTile(curTile)) {
        hu.bits |= HAMMER;
        return;
      }

      // 3. 通る場所に閉じたドアがあれば殴って開ける（A*継続中でもドアを開けるだけでA*は止まらない）
      if (curTile === TILE.DOOR && (nearCenter || hu.state === 0)) {
        hu.bits |= HAMMER;
        return;
      }

      // 4. 通常追尾判断（プレイヤー水平2マス以内）中なら、同じマスの破壊対象・ドアも殴る
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
      this.endReason = ""; // "TIME UP!" | "ALL CLEAR!"
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
      this.endReason = reason || "TIME UP!";
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
