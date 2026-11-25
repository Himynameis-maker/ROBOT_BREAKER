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
    COLLAPSE_HIT_FRAMES,
    TILE,
    isLadderTile,
    isFallHoleTile,
    isSolidDrum
  } = G;

  const BATTLE_DURATION_FRAMES = 25 * 60; // 25.00秒
  const BATTLE_RESULT_INTRO_FRAMES = 48; // 終了後0.8sの静止余韻
  const HORIZ_SEARCH_RANGE = 6;          // 水平方向6マス以内のみ同段探索
  const WALL_HIT_WAIT_FRAMES = COLLAPSE_HIT_FRAMES || 25;

  function isBattleDestroyTargetTile(t) {
    return t === TILE.WALL_1 ||
      t === TILE.WALL_2 || t === 0x91 ||
      t === TILE.WALL_3 || t === 0xa2 || t === 0xa1 ||
      t === TILE.BOMB ||
      t === TILE.PILLAR ||
      t === TILE.BREAK_LADDER;
  }

  // 連続した壊せるハシゴの上段はシステム上ハンマーを振れないため、直接叩ける対象か判定する
  function isBattleHittableDestroyTile(world, r, c) {
    const t = world.getTile(r, c);
    if (!isBattleDestroyTargetTile(t)) return false;
    if (t === TILE.BREAK_LADDER && r < world.rows - 1) {
      if (world.getTile(r + 1, c) === TILE.BREAK_LADDER) {
        return false;
      }
    }
    return true;
  }

  function isBattleAnyActionTargetTile(t) {
    return isBattleDestroyTargetTile(t) || t === TILE.DOOR;
  }

  function isBattleHittableAnyActionTile(world, r, c) {
    const t = world.getTile(r, c);
    if (t === TILE.DOOR) return true;
    return isBattleHittableDestroyTile(world, r, c);
  }

  // 1発のハンマーで煙・爆風・開き判定などの攻撃が発生するオブジェか（敵落とし狙い用）
  function isSingleHitHazardTile(world, r, c) {
    const t = world.getTile(r, c);
    if (t === TILE.WALL_1 || t === 0x91 || t === 0xa1 ||
        t === TILE.BOMB || t === TILE.PILLAR || t === TILE.DOOR) {
      return true;
    }
    if (t === TILE.BREAK_LADDER) {
      if (r < world.rows - 1 && world.getTile(r + 1, c) === TILE.BREAK_LADDER) {
        return false;
      }
      return true;
    }
    return false;
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
      this.routeTarget = null;
      this.wantHammerCell = null;
      this.pendingBombEscape = null;
      this.bombEscapeTarget = null;
      this.bombEscapeTicks = 0;
      this.hp2SwingInfo = null;
      this.wallDodgeTarget = null;
      this.wallDodgeWaitFrames = 0;
      this.lastClimbY = null;
      this.climbStuckFrames = 0;
      this.pathCache = null;
      this.frontEnemyCache = null;
      this.frontEnemyCheckTick = -99;
    }

    reset() {
      this.lockedTarget = null;
      this.aStarLockTarget = null;
      this.routeTarget = null;
      this.wantHammerCell = null;
      this.pendingBombEscape = null;
      this.bombEscapeTarget = null;
      this.bombEscapeTicks = 0;
      this.hp2SwingInfo = null;
      this.wallDodgeTarget = null;
      this.wallDodgeWaitFrames = 0;
      this.lastClimbY = null;
      this.climbStuckFrames = 0;
      this.pathCache = null;
      this.frontEnemyCache = null;
      this.frontEnemyCheckTick = -99;
    }

    notifyBombHit(row, col) {
      this.pendingBombEscape = { row, col };
      this.lockedTarget = null;
      this.aStarLockTarget = null;
      this.routeTarget = null;
      this.hp2SwingInfo = null;
      this.wallDodgeTarget = null;
      this.wallDodgeWaitFrames = 0;
      this.pathCache = null;
    }

    // ドア以外の何かを自力で殴った瞬間に呼ばれ、A*継続ロックと経路ロックを解除する
    notifyNonDoorHit() {
      this.aStarLockTarget = null;
      this.routeTarget = null;
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

    // 同じ段で、途中に穴やドラム缶を挟まず歩いて到達できるか確認
    canWalkDirectlyOnRow(world, row, fromCol, toCol) {
      if (fromCol === toCol) return true;
      const step = toCol > fromCol ? 1 : -1;
      let c = fromCol;
      while (c !== toCol) {
        c += step;
        const t = world.getTile(row, c);
        if (isSolidDrum(t) || t === TILE.DRUM_FALLING) return false;
        if (row < world.rows - 1 && isFallHoleTile(t)) return false;
      }
      return true;
    }

    // 96マスの厳密最短経路探索（誤差ゼロ・実時間コスト準拠・連続ハシゴ上り下り両方で途中段横抜け対応）
    findShortestPath(world, startRow, startCol, goalMatchFn, allowHoleDrop = false, allowWrap = true) {
      const rows = world.rows;
      const cols = world.cols;
      const keyOf = (r, c) => r * cols + c;
      const startKey = keyOf(startRow, startCol);

      if (goalMatchFn(startRow, startCol)) {
        return { found: true, row: startRow, col: startCol, cost: 0, firstBits: 0 };
      }

      const dist = new Float64Array(rows * cols);
      dist.fill(1e9);
      dist[startKey] = 0;

      const visited = new Uint8Array(rows * cols);
      const open = [{
        r: startRow,
        c: startCol,
        g: 0,
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
          if (open[i].g < open[bestIdx].g) bestIdx = i;
        }
        const cur = open.splice(bestIdx, 1)[0];
        const curKey = keyOf(cur.r, cur.c);
        if (visited[curKey]) continue;
        visited[curKey] = 1;

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

        // 1. 横移動 (実時間ベース: 通常1マス = 1.0, 端ループ跨ぎ = 3.0)
        // 実機(State 6/State 2 prom=31/State 9)準拠で、連続ハシゴの上り到着・下り到着・横通過からも左右へ抜けられる
        const horizDirs = [
          { dc: -1, bit: LEFT },
          { dc: 1, bit: RIGHT }
        ];
        for (let i = 0; i < horizDirs.length; i++) {
          const rawNc = c + horizDirs[i].dc;
          const wrapped = rawNc < 0 || rawNc >= cols;
          if (wrapped && !allowWrap) continue;
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
            const dropCost = cur.g + 8.0 + (landR - r) * 2.5;
            const lk = keyOf(landR, nc);
            if (dropCost < dist[lk]) {
              dist[lk] = dropCost;
              open.push({
                r: landR,
                c: nc,
                g: dropCost,
                firstBits: cur.firstBits || horizDirs[i].bit
              });
            }
            continue;
          }

          const stepCost = wrapped ? 3.0 : 1.0;
          const ng = cur.g + stepCost;
          const nk = keyOf(r, nc);
          if (ng < dist[nk]) {
            dist[nk] = ng;
            open.push({
              r,
              c: nc,
              g: ng,
              firstBits: cur.firstBits || horizDirs[i].bit
            });
          }
        }

        // 2. 上へハシゴ移動 (1段 = 約2.5マス分の時間コスト、通常もピンクも同じ)
        if (r > 0 && isLadderTile(world.getTile(r, c))) {
          const upT = world.getTile(r - 1, c);
          if (!isSolidDrum(upT) && upT !== TILE.DRUM_FALLING && !isFallHoleTile(upT)) {
            const ng = cur.g + 2.5;
            const uk = keyOf(r - 1, c);
            if (ng < dist[uk]) {
              dist[uk] = ng;
              open.push({
                r: r - 1,
                c,
                g: ng,
                firstBits: cur.firstBits || UP
              });
            }
          }
        }

        // 3. 下へハシゴ移動（1段ずつ降りられ、連続ハシゴの中間段でも State 6 -> State 2 prom=31 で横抜け可能）
        if (r < rows - 1 && isLadderTile(world.getTile(r + 1, c)) && isStandableFloor(r, c)) {
          const downR = r + 1;
          const downT = world.getTile(downR, c);
          if (!isSolidDrum(downT) && downT !== TILE.DRUM_FALLING && !(downR < rows - 1 && isFallHoleTile(downT))) {
            const ng = cur.g + 2.5;
            const dk = keyOf(downR, c);
            if (ng < dist[dk]) {
              dist[dk] = ng;
              open.push({
                r: downR,
                c,
                g: ng,
                firstBits: cur.firstBits || DOWN
              });
            }
          }
        }
      }

      return { found: false, firstBits: 0 };
    }

    hasAnyDestroyTargetOnRow(world, row) {
      for (let c = 0; c < world.cols; c++) {
        if (isBattleHittableDestroyTile(world, row, c)) {
          return true;
        }
      }
      return false;
    }

    // 同じ段の指定範囲(maxRangeマス以内)で、穴やドラム缶に遮られず歩いて行ける破壊可能オブジェがあるか
    hasAnyDirectDestroyTargetWithinRange(world, row, fromCol, maxRange = HORIZ_SEARCH_RANGE) {
      for (let c = 0; c < world.cols; c++) {
        if (this.getDist(fromCol, c) > maxRange) continue;
        if (!isBattleHittableDestroyTile(world, row, c)) continue;
        if (this.canWalkDirectlyOnRow(world, row, fromCol, c)) {
          return true;
        }
      }
      return false;
    }

    countDestroyTargetsOnRow(world, row) {
      let count = 0;
      for (let c = 0; c < world.cols; c++) {
        if (isBattleDestroyTargetTile(world.getTile(row, c))) {
          count += 1;
        }
      }
      return count;
    }

    hasAnyDestroyTargetInMap(world) {
      for (let r = 0; r < world.rows; r++) {
        if (this.hasAnyDestroyTargetOnRow(world, r)) return true;
      }
      return false;
    }

    // 優先1: 同じ段の6マス以内で直接行ける「左右どちらかに破壊可能オブジェがある爆弾」
    findBestBombTarget(world, hu, maxRange = HORIZ_SEARCH_RANGE) {
      const row = hu.row;
      let best = null;
      let bestDist = 999;
      for (let c = 0; c < world.cols; c++) {
        const dist = this.getDist(hu.col, c);
        if (dist > maxRange) continue;
        if (world.getTile(row, c) !== TILE.BOMB) continue;
        if (!this.canWalkDirectlyOnRow(world, row, hu.col, c)) continue;
        const leftT = c > 0 ? world.getTile(row, c - 1) : TILE.EMPTY;
        const rightT = c < world.cols - 1 ? world.getTile(row, c + 1) : TILE.EMPTY;
        if (!isBattleDestroyTargetTile(leftT) && !isBattleDestroyTargetTile(rightT)) {
          continue;
        }
        if (dist < bestDist || (dist === bestDist && best && c < best.col)) {
          bestDist = dist;
          best = { row, col: c };
        }
      }
      return best;
    }

    // 優先2: 同じ段かつ2マス以内に「表の敵」がいて、進行方向1マス先に1撃で判定の出るオブジェがあり辿り着ける時
    findBestFrontEnemyTarget(world, hu) {
      if (!world.enemies || world.enemies.length === 0) return null;
      if ((world.f - this.frontEnemyCheckTick) < 2 && this.frontEnemyCheckTick >= 0) {
        const cached = this.frontEnemyCache;
        if (cached &&
            cached.row === hu.row &&
            isSingleHitHazardTile(world, cached.row, cached.col) &&
            this.canWalkDirectlyOnRow(world, hu.row, hu.col, cached.col)) {
          return cached;
        }
        return null;
      }

      this.frontEnemyCheckTick = world.f;
      const row = hu.row;
      let best = null;
      let bestDist = 999;

      for (let i = 0; i < world.enemies.length; i++) {
        const e = world.enemies[i];
        // ハンターの攻撃（裏→表）が当たるのは表側にいる敵のみ
        if (e.isBack) continue;
        if (e.row !== row) continue;
        if (e.state === 3 || e.state === 4 || e.state === 10 || e.state === 15 || e.state === 16) {
          continue;
        }
        if (this.getDist(hu.col, e.col) > 2) continue;

        const step = (e.facing & RIGHT) ? 1 : -1;
        const rawFrontCol = e.col + step;
        if (rawFrontCol < 0 || rawFrontCol >= world.cols) continue;
        if (!isSingleHitHazardTile(world, row, rawFrontCol)) {
          continue;
        }
        if (!this.canWalkDirectlyOnRow(world, row, hu.col, rawFrontCol)) {
          continue;
        }
        const dist = this.getDist(hu.col, rawFrontCol);
        if (dist < bestDist || (dist === bestDist && best && rawFrontCol < best.col)) {
          bestDist = dist;
          best = { row, col: rawFrontCol, tile: world.getTile(row, rawFrontCol) };
        }
      }

      this.frontEnemyCache = best;
      return best;
    }

    // 同じ段の指定範囲以内で穴やドラム缶に遮られず歩いて行ける最も近い破壊可能オブジェ（同距離は左優先）
    findNearestDirectRowDestroyTarget(world, row, fromCol, maxRange = HORIZ_SEARCH_RANGE) {
      let bestDirect = null;
      let bestDirectDist = 999;

      for (let c = 0; c < world.cols; c++) {
        const dist = this.getDist(fromCol, c);
        if (dist > maxRange) continue;
        if (!isBattleHittableDestroyTile(world, row, c)) continue;
        if (!this.canWalkDirectlyOnRow(world, row, fromCol, c)) continue;
        if (dist < bestDirectDist || (dist === bestDirectDist && bestDirect && c < bestDirect.col)) {
          bestDirectDist = dist;
          bestDirect = { row, col: c };
        }
      }
      return bestDirect;
    }

    // 最も近い高さの段を列挙（同距離時はドア以外の破壊可能オブジェクトが多い段を優先、同数なら上優先）
    getClosestHeightRows(world, fromRow, excludeFromRow = true) {
      const list = [];
      for (let r = 0; r < world.rows; r++) {
        if (excludeFromRow && r === fromRow) continue;
        if (this.hasAnyDestroyTargetOnRow(world, r)) {
          list.push({
            row: r,
            diff: Math.abs(r - fromRow),
            count: this.countDestroyTargetsOnRow(world, r)
          });
        }
      }
      list.sort((a, b) => {
        if (a.diff !== b.diff) return a.diff - b.diff;
        if (a.count !== b.count) return b.count - a.count;
        return a.row - b.row;
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

    // HP2の壁殴り中にプレイヤーと同マス時：1マス横の「穴か床」（ドラム缶以外）へランダムで動く
    startWallDodge(world, hu) {
      const r = hu.row;
      const c = hu.col;
      const canStep = (nc) => {
        const t = world.getTile(r, nc);
        return !isSolidDrum(t) && t !== TILE.DRUM_FALLING;
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

      this.lockedTarget = null;
      this.routeTarget = null;
      this.wallDodgeTarget = { row: r, col: chosenCol, dir: chosenDir, ticks: 0 };
      this.wallDodgeWaitFrames = 0;
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

    moveTowardGoalCached(world, hu, goalRow, goalCol, allowHoleDrop = false) {
      const gKey = goalRow + "," + goalCol + "," + (allowHoleDrop ? 1 : 0);
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

      let res = this.findShortestPath(
        world,
        hu.row,
        hu.col,
        (r, c) => r === goalRow && c === goalCol,
        allowHoleDrop,
        false
      );
      if (!res.found) {
        res = this.findShortestPath(
          world,
          hu.row,
          hu.col,
          (r, c) => r === goalRow && c === goalCol,
          allowHoleDrop,
          true
        );
      }

      this.pathCache = {
        row: hu.row,
        col: hu.col,
        goalKey: gKey,
        tick: world.f,
        found: res.found,
        bits: res.firstBits,
        cost: res.cost || 0
      };
      if (!res.found) return false;
      this.stepToBits(hu, res.firstBits);
      return true;
    }

    // 進みたい段へ「逆方向に回り込んだりせず」素直に近づけるか確認
    canMoveCleanlyToHeightRow(world, hu, targetRow) {
      const res = this.findShortestPath(
        world,
        hu.row,
        hu.col,
        (r, c) => r === targetRow && isBattleHittableDestroyTile(world, r, c),
        false,
        false
      );
      if (!res.found) return null;
      const wantDir = targetRow < hu.row ? UP : DOWN;
      const oppDir = targetRow < hu.row ? DOWN : UP;
      if ((res.firstBits & oppDir) !== 0) return null;
      const maxReasonable = Math.abs(targetRow - hu.row) * 2.5 + 14;
      if (res.cost > maxReasonable && (res.firstBits & wantDir) === 0) {
        return null;
      }
      return { row: res.row, col: res.col, firstBits: res.firstBits, cost: res.cost };
    }

    // A* で最短（実移動コスト最小）のドア除く破壊可能オブジェを探し、自力で殴るまでロック継続
    acquireAndFollowAStarTarget(world, hu) {
      if (isBattleHittableDestroyTile(world, hu.row, hu.col)) {
        this.wantHammerCell = { row: hu.row, col: hu.col, isLock: true };
        return true;
      }

      if (this.aStarLockTarget) {
        const at = this.aStarLockTarget;
        if (isBattleHittableDestroyTile(world, at.row, at.col)) {
          if (this.moveTowardGoalCached(world, hu, at.row, at.col, !!at.allowHoleDrop)) {
            return true;
          }
        }
        this.aStarLockTarget = null;
        this.pathCache = null;
      }

      let usedHoleDrop = false;
      let res = this.findShortestPath(
        world,
        hu.row,
        hu.col,
        (r, c) => isBattleHittableDestroyTile(world, r, c),
        false,
        false
      );
      if (!res.found) {
        res = this.findShortestPath(
          world,
          hu.row,
          hu.col,
          (r, c) => isBattleHittableDestroyTile(world, r, c),
          false,
          true
        );
      }
      if (!res.found) {
        usedHoleDrop = true;
        res = this.findShortestPath(
          world,
          hu.row,
          hu.col,
          (r, c) => isBattleHittableDestroyTile(world, r, c),
          true,
          true
        );
      }
      if (!res.found) return false;

      this.aStarLockTarget = { row: res.row, col: res.col, allowHoleDrop: usedHoleDrop };
      this.stepToBits(hu, res.firstBits);
      return true;
    }

    // State 6(上り途中段) や State 2 prom>=31(下り途中段床到達直後) で横へ抜けるべき方向があるか調べる
    findLadderSideExitBits(world, hu, checkRow) {
      const checkGoal = this.aStarLockTarget || this.routeTarget;
      let exitBits = 0;
      let allowDrop = false;

      if (checkGoal) {
        allowDrop = !!checkGoal.allowHoleDrop;
        if (!(checkGoal.row === checkRow && checkGoal.col === hu.col)) {
          let res = this.findShortestPath(
            world,
            checkRow,
            hu.col,
            (r, c) => r === checkGoal.row && c === checkGoal.col,
            allowDrop,
            false
          );
          if (!res.found) {
            res = this.findShortestPath(
              world,
              checkRow,
              hu.col,
              (r, c) => r === checkGoal.row && c === checkGoal.col,
              allowDrop,
              true
            );
          }
          if (res.found && (res.firstBits & (LEFT | RIGHT)) !== 0) {
            exitBits = res.firstBits;
          }
        }
      } else if (this.hasAnyDirectDestroyTargetWithinRange(world, checkRow, hu.col, HORIZ_SEARCH_RANGE)) {
        const target = this.findNearestDirectRowDestroyTarget(world, checkRow, hu.col, HORIZ_SEARCH_RANGE);
        if (target) {
          if (target.col < hu.col) exitBits = LEFT;
          else if (target.col > hu.col) exitBits = RIGHT;
        }
      } else {
        let res = this.findShortestPath(
          world,
          checkRow,
          hu.col,
          (r, c) => isBattleHittableDestroyTile(world, r, c),
          false,
          false
        );
        if (!res.found) {
          res = this.findShortestPath(
            world,
            checkRow,
            hu.col,
            (r, c) => isBattleHittableDestroyTile(world, r, c),
            false,
            true
          );
        }
        if (res.found && (res.firstBits & (LEFT | RIGHT)) !== 0) {
          exitBits = res.firstBits;
        }
      }

      if (exitBits === 0) return 0;
      const nextCol = world.wrapCol(hu.col + ((exitBits & RIGHT) ? 1 : -1));
      const nextT = world.getTile(checkRow, nextCol);
      const holeOk = allowDrop || !(checkRow < world.rows - 1 && isFallHoleTile(nextT));
      if (!isSolidDrum(nextT) && nextT !== TILE.DRUM_FALLING && holeOk) {
        return exitBits;
      }
      return 0;
    }

    handleLadderAndTransitionStates(world, hu, pl) {
      if (hu.state === 4) {
        hu.bits = 0;
        this.lastClimbY = null;
        this.climbStuckFrames = 0;

        // HP2の壁(2回壁 0x92 または 残HP2の3回壁 0xa2)を殴っている最中かを追跡
        if (!this.hp2SwingInfo && hu.hammerTimer <= 2) {
          const t = world.getTile(hu.row, hu.col);
          if (t === TILE.WALL_2 || t === 0xa2) {
            this.hp2SwingInfo = {
              row: hu.row,
              col: hu.col,
              sawPlayer: !!(pl && pl.row === hu.row && pl.col === hu.col &&
                pl.state !== 10 && pl.state !== 11 && pl.state !== 15 && pl.state !== 16)
            };
          }
        } else if (this.hp2SwingInfo &&
                   this.hp2SwingInfo.row === hu.row &&
                   this.hp2SwingInfo.col === hu.col) {
          if (pl && pl.row === hu.row && pl.col === hu.col &&
              pl.state !== 10 && pl.state !== 11 && pl.state !== 15 && pl.state !== 16) {
            this.hp2SwingInfo.sawPlayer = true;
          }
        }
        return true;
      }

      // 穴に落ちてState 5(落下状態)になった場合は即座に回避完了（着地後すぐ動く）
      if (hu.state === 5) {
        hu.bits = 0;
        this.wallDodgeTarget = null;
        this.wallDodgeWaitFrames = 0;
        this.hp2SwingInfo = null;
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

      if (hu.state === 2) {
        // 連続ハシゴを下ってきて途中段の床高さに着いた瞬間（State 6 完了直後の prom >= 31）に横抜け判定
        const canExitDownMid = hu.prom >= 31 &&
          (hu.y & 0x1f) === 0 &&
          world.stepper &&
          world.stepper.isContinuousLadderSegment(hu.row, hu.col, world);
        if (canExitDownMid) {
          const exitBits = this.findLadderSideExitBits(world, hu, hu.row);
          if (exitBits !== 0) {
            this.lastClimbY = null;
            this.climbStuckFrames = 0;
            hu.bits = exitBits;
            return true;
          }
        }

        let vDir = hu.dir & (UP | DOWN);
        if (vDir === 0) vDir = UP;

        if (this.lastClimbY === hu.y) {
          this.climbStuckFrames += 1;
          if (this.climbStuckFrames >= 24) {
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

      if (hu.state === 6) {
        this.lastClimbY = null;
        this.climbStuckFrames = 0;
        const floorRow = Math.max(0, Math.min(world.rows - 1, Math.round((hu.y - 32) / 32)));
        const canExitSide = hu.prom < 10;

        if (canExitSide) {
          const exitBits = this.findLadderSideExitBits(world, hu, floorRow);
          if (exitBits !== 0) {
            hu.bits = exitBits;
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

    findAdjacentPlayerAttackTarget(world, hu, pl) {
      if (!pl || pl.row !== hu.row) return null;
      if (pl.state === 10 || pl.state === 11 || pl.state === 15 || pl.state === 16) {
        return null;
      }
      if (Math.abs(pl.col - hu.col) > 1) return null;

      if (isBattleHittableAnyActionTile(world, hu.row, hu.col)) {
        return { row: hu.row, col: hu.col, tile: world.getTile(hu.row, hu.col) };
      }
      if (pl.col !== hu.col && isBattleHittableAnyActionTile(world, pl.row, pl.col)) {
        if (this.canWalkDirectlyOnRow(world, hu.row, hu.col, pl.col)) {
          return { row: pl.row, col: pl.col, tile: world.getTile(pl.row, pl.col) };
        }
      }
      return null;
    }

    update(world) {
      const hu = world.hunter;
      if (!hu) return;
      const pl = world.player;

      this.wantHammerCell = null;

      if (hu.state === 10 || hu.state === 11 || hu.state === 15 || hu.state === 16) {
        hu.bits = 0;
        this.lockedTarget = null;
        this.routeTarget = null;
        this.pendingBombEscape = null;
        this.bombEscapeTarget = null;
        this.hp2SwingInfo = null;
        this.wallDodgeTarget = null;
        this.wallDodgeWaitFrames = 0;
        this.lastClimbY = null;
        this.climbStuckFrames = 0;
        this.pathCache = null;
        return;
      }

      if (this.handleLadderAndTransitionStates(world, hu, pl)) {
        return;
      }

      // HP2の壁を殴った直後にプレイヤーが同マスにいた場合、最優先で1マス横へ移動開始
      if (this.hp2SwingInfo) {
        const info = this.hp2SwingInfo;
        this.hp2SwingInfo = null;
        if (hu.row === info.row && hu.col === info.col) {
          const sameNow = !!(pl && pl.row === hu.row && pl.col === hu.col &&
            pl.state !== 10 && pl.state !== 11 && pl.state !== 15 && pl.state !== 16);
          if (info.sawPlayer || sameNow) {
            if (this.startWallDodge(world, hu)) {
              const wd = this.wallDodgeTarget;
              hu.bits = wd.dir;
              return;
            }
          }
        }
      }

      // 最優先0-A: HP2壁殴り後の1マス回避移動中
      if (this.wallDodgeTarget) {
        this.wallDodgeTarget.ticks += 1;
        const wd = this.wallDodgeTarget;
        const xMod = hu.x & 0x0f;
        const arrived = hu.row === wd.row && hu.col === wd.col && (xMod <= 1 || xMod >= 15);
        if (arrived || hu.row !== wd.row || wd.ticks > 28) {
          this.wallDodgeTarget = null;
          // 移動先に壊せるオブジェがあるなら25F静止を待たずに即殴る（3->A: 何でも含める）
          if (isBattleHittableAnyActionTile(world, hu.row, hu.col)) {
            this.wantHammerCell = {
              row: hu.row,
              col: hu.col,
              isLock: isBattleDestroyTargetTile(world.getTile(hu.row, hu.col)),
              instantSwing: true
            };
            return;
          }
          // 何もない床なら壁の攻撃判定分(25F)その場で静止
          this.wallDodgeWaitFrames = WALL_HIT_WAIT_FRAMES;
          hu.bits = 0;
          return;
        }
        hu.bits = wd.dir;
        return;
      }

      // 最優先0-B: 回避先の床で壁の攻撃判定分(25F)静止中
      if (this.wallDodgeWaitFrames > 0) {
        this.wallDodgeWaitFrames -= 1;
        hu.bits = 0;
        return;
      }

      // 最優先0-C: 爆弾を殴った直後の50/50左右避難移動
      this.startBombEscapeIfNeeded(world, hu);
      if (this.bombEscapeTarget) {
        this.bombEscapeTicks += 1;
        const esc = this.bombEscapeTarget;
        const xMod = hu.x & 0x0f;
        const arrived = hu.row === esc.row && hu.col === esc.col && (xMod <= 1 || xMod >= 15);
        if (arrived || hu.row !== esc.row || this.bombEscapeTicks > 32) {
          this.bombEscapeTarget = null;
        } else {
          hu.bits = esc.dir;
          return;
        }
      }

      // 最優先0-D: 破壊し始めたら壊し切るまで止まらない
      if (this.lockedTarget) {
        const lt = this.lockedTarget;
        if (hu.row === lt.row && hu.col === lt.col && isBattleHittableDestroyTile(world, lt.row, lt.col)) {
          hu.bits = 0;
          this.wantHammerCell = { row: lt.row, col: lt.col, isLock: true };
          return;
        }
        this.lockedTarget = null;
      }

      // 最優先1: プレイヤーと隣または同じマスにいて、破壊可能オブジェがあるなら最優先で即振りして殴る
      const adjPlayerTarget = this.findAdjacentPlayerAttackTarget(world, hu, pl);
      if (adjPlayerTarget) {
        if (hu.row === adjPlayerTarget.row && hu.col === adjPlayerTarget.col) {
          this.wantHammerCell = {
            row: adjPlayerTarget.row,
            col: adjPlayerTarget.col,
            isLock: isBattleDestroyTargetTile(adjPlayerTarget.tile),
            instantSwing: true
          };
        } else {
          hu.bits = adjPlayerTarget.col < hu.col ? LEFT : RIGHT;
        }
        return;
      }

      // 全て破壊された場合は普段の追尾ロボ判断に戻る
      if (!this.hasAnyDestroyTargetInMap(world)) {
        this.aStarLockTarget = null;
        this.routeTarget = null;
        if ((world.f & 1) === 1) {
          world.hunterAI.update(world);
        }
        return;
      }

      // A*継続モード: ドア以外の何かを自力で殴るまでA*止まらない
      if (this.aStarLockTarget) {
        if (this.acquireAndFollowAStarTarget(world, hu)) {
          return;
        }
      }

      // 段移動中の目標ロック
      if (this.routeTarget) {
        const rt = this.routeTarget;
        if (hu.row !== rt.row && isBattleHittableDestroyTile(world, rt.row, rt.col)) {
          if (this.moveTowardGoalCached(world, hu, rt.row, rt.col, false)) {
            return;
          }
        }
        this.routeTarget = null;
      }

      // === 水平（同じ段の6マス以内）に歩いて行ける破壊可能オブジェがある場合 ===
      if (this.hasAnyDirectDestroyTargetWithinRange(world, hu.row, hu.col, HORIZ_SEARCH_RANGE)) {
        // 優先1: 左右どちらかに破壊可能オブジェがある爆弾
        const bombTarget = this.findBestBombTarget(world, hu, HORIZ_SEARCH_RANGE);
        if (bombTarget) {
          if (hu.row === bombTarget.row && hu.col === bombTarget.col) {
            this.wantHammerCell = { row: bombTarget.row, col: bombTarget.col, isLock: true };
          } else {
            hu.bits = bombTarget.col < hu.col ? LEFT : RIGHT;
          }
          return;
        }

        // 優先2: 水平かつ2マス以内に表の敵がいて、進行方向1マス先に1撃判定の破壊対象があり歩いて行ける時
        const frontEnemyTarget = this.findBestFrontEnemyTarget(world, hu);
        if (frontEnemyTarget) {
          if (hu.row === frontEnemyTarget.row && hu.col === frontEnemyTarget.col) {
            this.wantHammerCell = {
              row: frontEnemyTarget.row,
              col: frontEnemyTarget.col,
              isLock: isBattleDestroyTargetTile(frontEnemyTarget.tile),
              instantSwing: true
            };
          } else {
            hu.bits = frontEnemyTarget.col < hu.col ? LEFT : RIGHT;
          }
          return;
        }

        // 優先3: 自身のマス（ドア除く破壊可能オブジェ）
        if (isBattleHittableDestroyTile(world, hu.row, hu.col)) {
          this.wantHammerCell = { row: hu.row, col: hu.col, isLock: true };
          return;
        }

        // 優先4 & 5: 同じ段の6マス以内で直接行ける最も近い左側のオブジェ > 右（同距離なら左優先）
        const horizTarget = this.findNearestDirectRowDestroyTarget(world, hu.row, hu.col, HORIZ_SEARCH_RANGE);
        if (horizTarget) {
          hu.bits = horizTarget.col < hu.col ? LEFT : RIGHT;
          return;
        }
      }

      // 6マス以内に破壊オブジェがなくても、同じ段2マス以内の表敵の1マス先がドア等で行けるなら狙う
      const frontEnemyOnly = this.findBestFrontEnemyTarget(world, hu);
      if (frontEnemyOnly) {
        if (hu.row === frontEnemyOnly.row && hu.col === frontEnemyOnly.col) {
          this.wantHammerCell = {
            row: frontEnemyOnly.row,
            col: frontEnemyOnly.col,
            isLock: isBattleDestroyTargetTile(frontEnemyOnly.tile),
            instantSwing: true
          };
        } else {
          hu.bits = frontEnemyOnly.col < hu.col ? LEFT : RIGHT;
        }
        return;
      }

      // === 水平6マス以内に破壊可能オブジェがない、または穴・ドラム缶で行けない時 ===
      // 上下の「近い高さ＆破壊対象が多い段（同高さで明らかに行きやすい近いハシゴがあればそちら優先）」を検索
      const heightEntries = this.getClosestHeightRows(world, hu.row, true);
      if (heightEntries.length > 0) {
        const primaryRow = heightEntries[0].row;
        const clean0 = this.canMoveCleanlyToHeightRow(world, hu, primaryRow);
        let chosen = clean0;

        if (heightEntries.length > 1 && heightEntries[1].diff === heightEntries[0].diff) {
          const clean1 = this.canMoveCleanlyToHeightRow(world, hu, heightEntries[1].row);
          if (!chosen) {
            chosen = clean1;
          } else if (clean1 && (clean0.cost - clean1.cost) >= 2.0) {
            chosen = clean1;
          }
        }

        if (chosen) {
          this.routeTarget = { row: chosen.row, col: chosen.col };
          this.stepToBits(hu, chosen.firstBits);
          return;
        }
      }

      // 進みたい高さ（上下の段）にも進めない時は最低優先でA*発動（ドア以外を自力で殴るまで継続）
      if (!this.acquireAndFollowAStarTarget(world, hu)) {
        if ((world.f & 1) === 1) {
          world.hunterAI.update(world);
        }
      }
    }

    updateHammer(world) {
      const hu = world.hunter;
      if (!hu) return;

      hu.bits &= ~HAMMER;
      if (hu.state === 2 || hu.state === 3 || hu.state === 4 || hu.state === 5 ||
          hu.state === 6 || hu.state === 8 || hu.state === 9 ||
          hu.state === 10 || hu.state === 11 || hu.state === 15 || hu.state === 16) {
        return;
      }

      if (this.bombEscapeTarget || this.pendingBombEscape ||
          this.wallDodgeTarget || this.wallDodgeWaitFrames > 0) {
        return;
      }

      const curTile = world.getTile(hu.row, hu.col);
      const xMod = hu.x & 0x0f;
      const nearCenter = xMod <= 1 || xMod >= 15;

      // 1. 破壊目標セルに到達していれば殴る（敵・プレイヤー狙い・回避先即殴りの時はマスに入った瞬間即振り）
      if (this.wantHammerCell &&
          hu.row === this.wantHammerCell.row &&
          hu.col === this.wantHammerCell.col &&
          isBattleHittableAnyActionTile(world, hu.row, hu.col)) {
        if (this.wantHammerCell.instantSwing || nearCenter || hu.state === 0) {
          hu.bits |= HAMMER;
          if (this.wantHammerCell.isLock && isBattleHittableDestroyTile(world, hu.row, hu.col)) {
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
          isBattleHittableDestroyTile(world, hu.row, hu.col)) {
        hu.bits |= HAMMER;
        return;
      }

      // 3. 通る場所に閉じたドアがあれば殴って開ける（A*継続中でもドアを開けるだけでA*は止まらない）
      if (curTile === TILE.DOOR && (nearCenter || hu.state === 0)) {
        hu.bits |= HAMMER;
      }
    }
  }

  class BattleManager {
    constructor(options = {}) {
      this.durationFrames = options.durationFrames || BATTLE_DURATION_FRAMES;
      this.remainFrames = this.durationFrames;
      this.scores = {
        player: { total: 0, c200: 0, c400: 0, c600: 0, cAction: 0 },
        hunter: { total: 0, c200: 0, c400: 0, c600: 0, cAction: 0 }
      };
      this.popups = [];
      this.ended = false;
      this.endReason = ""; // "TIME UP!" | "ALL CLEAR!"
      this.resultPhase = 0; // 0:対戦中, 1:終了文字静止(48F), 2:暗転リザルト
      this.resultTimer = 0;
      this.resultFinished = false;
      this.hunterAI = new BattleHunterAI();
    }

    addScore(byPlayer, points, row, col, isAction = false) {
      if (this.ended || !points) return;
      const bag = byPlayer ? this.scores.player : this.scores.hunter;
      bag.total += points;
      if (isAction) {
        bag.cAction += 1;
      } else if (points === 200) {
        bag.c200 += 1;
      } else if (points === 400) {
        bag.c400 += 1;
      } else if (points === 600) {
        bag.c600 += 1;
      }

      this.popups.push({
        x: col * 16 + 8,
        y: Math.max(20, row * 32 + 4),
        points,
        byPlayer: !!byPlayer,
        isAction: !!isAction,
        timer: 44,
        maxTimer: 44
      });
    }

    onEvent(evt) {
      if (!evt || this.ended) return;
      if (evt.type === "wallDestroyed") {
        const pts = getWallDestroyPoints(evt.tile);
        if (pts > 0) this.addScore(evt.byPlayer, pts, evt.row, evt.col, false);
      } else if (evt.type === "bombExploded" ||
                 evt.type === "doorOpened" ||
                 evt.type === "ladderDestroyed" ||
                 evt.type === "pillarDestroyed") {
        this.addScore(evt.byPlayer, 200, evt.row, evt.col, false);
      } else if (evt.type === "opponentKnockedDown" ||
                 evt.type === "enemyBackEntered" ||
                 evt.type === "enemyKnockedDown") {
        this.addScore(evt.byPlayer, 400, evt.row, evt.col, true);
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
