(function (root) {
  "use strict";

  const G = (typeof module !== "undefined" && module.exports && !root.BreakerGame)
    ? require("./constants.js")
    : (root.BreakerGame || {});

  const {
    RIGHT,
    LEFT,
    EDGE_SAFE_COLS,
    TILE,
    isBreakableTile,
    isDoorRelatedTile
  } = G;

  const BATTLE_COLS = 16;
  const BATTLE_ROWS = 6;
  const SAFE_EDGE = EDGE_SAFE_COLS || 2;
  const MIN_COL = SAFE_EDGE;
  const MAX_COL = BATTLE_COLS - SAFE_EDGE - 1;

  function createGrid(rows, cols) {
    const grid = [];
    for (let r = 0; r < rows; r++) {
      grid.push(new Uint8Array(cols));
    }
    return grid;
  }

  function shuffleArray(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }

  function randInt(min, max, rand) {
    return min + Math.floor(rand() * (max - min + 1));
  }

  // 既存 GameWorld の爆弾連鎖と同じ判定で「爆弾同士の連鎖」がないか検査する
  function hasBombChain(grid, rows, cols) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (grid[r][c] !== TILE.BOMB) continue;
        const dirs = [-1, 1];
        for (let di = 0; di < dirs.length; di++) {
          const dc = dirs[di];
          let cur = (c + dc + cols) % cols;
          let steps = cols - 1;
          while (steps > 0) {
            const t = grid[r][cur];
            if (isDoorRelatedTile(t) || t === TILE.TIMED_BOMB) {
              cur = (cur + dc + cols) % cols;
              steps -= 1;
              continue;
            }
            if (!isBreakableTile(t)) {
              break;
            }
            if (t === TILE.BOMB) {
              return true;
            }
            cur = (cur + dc + cols) % cols;
            steps -= 1;
          }
        }
      }
    }
    return false;
  }

  // ループを考慮せず、地面(row 5)から通常ハシゴ(LADDER)と安全な床だけで到達可能なマス集合を計算
  function computeReachable(grid, rows, cols, startRow, startCol) {
    const isWalkableCell = (r, c) => {
      if (c < MIN_COL || c > MAX_COL) return false;
      const t = grid[r][c];
      if (t === TILE.DRUM) return false;
      if (r === rows - 1) return true;
      if (t === TILE.HOLE) return false;
      return true;
    };

    const hasSolidFloorForHoriz = (r, c) => {
      if (!isWalkableCell(r, c)) return false;
      if (r === rows - 1) return true;
      const t = grid[r][c];
      const below = grid[r + 1][c];
      if (t === TILE.LADDER && below === TILE.LADDER) return false;
      if (t === TILE.BREAK_LADDER && below === TILE.BREAK_LADDER) return false;
      // 鉄柱の真上マスは崩れると穴になるため、通過橋としては使えない前提でチェック
      if (below === TILE.PILLAR) return false;
      return true;
    };

    const visited = new Set();
    if (!hasSolidFloorForHoriz(startRow, startCol)) {
      return visited;
    }

    const keyOf = (r, c) => r * cols + c;
    const queue = [[startRow, startCol]];
    visited.add(keyOf(startRow, startCol));

    while (queue.length > 0) {
      const [r, c] = queue.shift();
      const canStepHoriz = hasSolidFloorForHoriz(r, c) || grid[r][c] === TILE.LADDER;

      if (canStepHoriz) {
        const dcs = [-1, 1];
        for (let i = 0; i < dcs.length; i++) {
          const nc = c + dcs[i];
          if (nc >= MIN_COL && nc <= MAX_COL && isWalkableCell(r, nc)) {
            const isContLad = grid[r][nc] === TILE.LADDER &&
              r < rows - 1 &&
              grid[r + 1][nc] === TILE.LADDER;
            if (hasSolidFloorForHoriz(r, nc) || isContLad) {
              const nk = keyOf(r, nc);
              if (!visited.has(nk)) {
                visited.add(nk);
                queue.push([r, nc]);
              }
            }
          }
        }
      }

      if (r > 0 &&
          grid[r][c] === TILE.LADDER &&
          grid[r - 1][c] !== TILE.DRUM &&
          grid[r - 1][c] !== TILE.HOLE) {
        const uk = keyOf(r - 1, c);
        if (!visited.has(uk)) {
          visited.add(uk);
          queue.push([r - 1, c]);
        }
      }

      if (r < rows - 1 &&
          grid[r + 1][c] === TILE.LADDER &&
          grid[r][c] !== TILE.DRUM &&
          grid[r][c] !== TILE.HOLE) {
        const dk = keyOf(r + 1, c);
        if (!visited.has(dk)) {
          visited.add(dk);
          queue.push([r + 1, c]);
        }
      }
    }

    return visited;
  }

  function countVisitedRows(visited, cols) {
    const rowSet = new Set();
    for (const k of visited) {
      rowSet.add(Math.floor(k / cols));
    }
    return rowSet.size;
  }

  function isValidBattleMap(grid, rows, cols, playerCol) {
    if (hasBombChain(grid, rows, cols)) {
      return false;
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const t = grid[r][c];
        // 禁止アイテムの混入防止
        if (t === TILE.TIMED_BOMB || t === TILE.SAND_LADDER || t === TILE.KEY || t === TILE.SHOE_POD) {
          return false;
        }
        if ((c < MIN_COL || c > MAX_COL) && t !== TILE.EMPTY) {
          return false;
        }
        // 鉄柱の制約: 最上段禁止、真上にドラム缶・鉄柱・穴・ドア・通常ハシゴ禁止
        if (t === TILE.PILLAR) {
          if (r === 0) return false;
          const above = grid[r - 1][c];
          if (above === TILE.DRUM ||
              above === TILE.PILLAR ||
              above === TILE.HOLE ||
              above === TILE.DOOR ||
              above === TILE.LADDER) {
            return false;
          }
        }
        // ハシゴの真上がドラム缶・穴にならないこと
        if ((t === TILE.LADDER || t === TILE.BREAK_LADDER) && r > 0) {
          const above = grid[r - 1][c];
          if (above === TILE.DRUM || above === TILE.HOLE) {
            return false;
          }
        }
      }
    }

    // 最下段は穴禁止
    for (let c = 0; c < cols; c++) {
      if (grid[rows - 1][c] === TILE.HOLE) {
        return false;
      }
    }

    const reach = computeReachable(grid, rows, cols, rows - 1, playerCol);
    if (reach.size < 24) {
      return false;
    }

    const keyOf = (r, c) => r * cols + c;

    // すべての破壊可能オブジェとドアが地面から到達可能か検証
    for (let r = 0; r < rows; r++) {
      for (let c = MIN_COL; c <= MAX_COL; c++) {
        const t = grid[r][c];
        if (t === TILE.WALL_1 ||
            t === TILE.WALL_2 ||
            t === TILE.WALL_3 ||
            t === TILE.BOMB ||
            t === TILE.PILLAR ||
            t === TILE.DOOR) {
          if (r < rows - 1 && grid[r + 1][c] === TILE.PILLAR) {
            const okAdj = (c - 1 >= MIN_COL && reach.has(keyOf(r, c - 1))) ||
              (c + 1 <= MAX_COL && reach.has(keyOf(r, c + 1)));
            if (!okAdj) return false;
          } else if (!reach.has(keyOf(r, c))) {
            return false;
          }
        } else if (t === TILE.BREAK_LADDER) {
          let br = r;
          while (br < rows - 1 && grid[br + 1][c] === TILE.BREAK_LADDER) {
            br += 1;
          }
          if (!reach.has(keyOf(br, c))) {
            return false;
          }
        }
      }
    }

    // ハンター用の安全な空き床（オブジェクトと一切被らないマス）が1つ以上あるか確認
    let hasHunterSpot = false;
    for (let r = 0; r < rows && !hasHunterSpot; r++) {
      for (let c = MIN_COL; c <= MAX_COL; c++) {
        if (!reach.has(keyOf(r, c))) continue;
        if (r === rows - 1 && c === playerCol) continue;
        if (grid[r][c] !== TILE.EMPTY) continue;
        if (r < rows - 1 && grid[r + 1][c] === TILE.PILLAR) continue;
        hasHunterSpot = true;
        break;
      }
    }
    if (!hasHunterSpot) {
      return false;
    }

    return true;
  }

  function buildStageFromGrid(grid, rows, cols, playerCol, rand) {
    const reach = computeReachable(grid, rows, cols, rows - 1, playerCol);
    const keyOf = (r, c) => r * cols + c;

    // 1. タイル配列作成
    const tiles = [];
    for (let r = 0; r < rows; r++) {
      for (let c = MIN_COL; c <= MAX_COL; c++) {
        if (grid[r][c] !== TILE.EMPTY) {
          tiles.push([r, c, grid[r][c]]);
        }
      }
    }

    // 2. ハンター初期位置（上〜中段でプレイヤーから離れ、他のいかなるオブジェクトとも被らない空き床を優先）
    const hunterCandidates = [];
    for (let r = 0; r < rows; r++) {
      for (let c = MIN_COL; c <= MAX_COL; c++) {
        if (!reach.has(keyOf(r, c))) continue;
        if (r === rows - 1 && c === playerCol) continue;
        if (grid[r][c] !== TILE.EMPTY) continue;
        if (r < rows - 1 && grid[r + 1][c] === TILE.PILLAR) continue;
        hunterCandidates.push({ r, c });
      }
    }

    if (hunterCandidates.length === 0) {
      for (let r = 0; r < rows; r++) {
        for (let c = MIN_COL; c <= MAX_COL; c++) {
          if (r === rows - 1 && c === playerCol) continue;
          if (grid[r][c] === TILE.EMPTY) {
            hunterCandidates.push({ r, c });
          }
        }
      }
    }

    hunterCandidates.sort((a, b) => {
      // 上段側かつプレイヤーから遠い位置を優遇
      const scoreA = a.r * 3 - Math.abs(a.c - playerCol) + (rand() * 2);
      const scoreB = b.r * 3 - Math.abs(b.c - playerCol) + (rand() * 2);
      return scoreA - scoreB;
    });

    const hunterCell = hunterCandidates[0] || { r: 0, c: Math.max(MIN_COL, Math.min(MAX_COL, MAX_COL - (playerCol - MIN_COL))) };
    const hunterDir = hunterCell.c < Math.floor(cols / 2) ? RIGHT : LEFT;
    const playerDir = playerCol < Math.floor(cols / 2) ? RIGHT : LEFT;

    // 3. ザコ敵配置（表2体 + 最初から裏2体 程度、当たり判定なし・電磁球なし）
    const enemySpots = [];
    for (let r = 0; r < rows; r++) {
      for (let c = MIN_COL; c <= MAX_COL; c++) {
        if (r === rows - 1 && c === playerCol) continue;
        if (r === hunterCell.r && c === hunterCell.c) continue;
        const t = grid[r][c];
        if (t === TILE.DRUM || t === TILE.HOLE || t === TILE.BOMB || t === TILE.DOOR) continue;
        if (r < rows - 1 && grid[r + 1][c] === TILE.LADDER && t === TILE.LADDER) continue;
        if (r < rows - 1 && grid[r + 1][c] === TILE.PILLAR) continue;
        enemySpots.push({ r, c });
      }
    }
    shuffleArray(enemySpots, rand);

    const enemySpecs = [
      { enemyType: "drone", isBack: false },
      { enemyType: "crawler", isBack: false },
      { enemyType: rand() < 0.5 ? "droneFast" : "drone", isBack: true },
      { enemyType: "crawler", isBack: true }
    ];

    const enemies = [];
    const usedRows = new Set();
    for (let i = 0; i < enemySpecs.length && enemySpots.length > 0; i++) {
      const spec = enemySpecs[i];
      let pickedIdx = enemySpots.findIndex(s => !usedRows.has(s.r));
      if (pickedIdx < 0) pickedIdx = 0;
      const spot = enemySpots.splice(pickedIdx, 1)[0];
      usedRows.add(spot.r);
      enemies.push({
        enemyType: spec.enemyType,
        isBack: spec.isBack,
        x: spot.c * 16,
        y: (spot.r + 1) * 32,
        dir: rand() < 0.5 ? LEFT : RIGHT
      });
    }

    return {
      stageNumber: 1,
      cols,
      rows,
      tiles,
      player: {
        x: playerCol * 16,
        y: rows * 32,
        dir: playerDir
      },
      hunter: {
        x: hunterCell.c * 16,
        y: (hunterCell.r + 1) * 32,
        dir: hunterDir
      },
      enemies,
      orb: false,
      isBattleMode: true
    };
  }

  function createFallbackBattleStage() {
    const rows = BATTLE_ROWS;
    const cols = BATTLE_COLS;
    const grid = createGrid(rows, cols);
    const ladderSpots = [
      [5, 4], [5, 11],
      [4, 3], [4, 9],
      [3, 6], [3, 12],
      [2, 4], [2, 10],
      [1, 5], [1, 11]
    ];
    for (let i = 0; i < ladderSpots.length; i++) {
      grid[ladderSpots[i][0]][ladderSpots[i][1]] = TILE.LADDER;
    }
    const items = [
      [0, 3, TILE.WALL_2], [0, 7, TILE.BOMB], [0, 8, TILE.WALL_1], [0, 12, TILE.WALL_3],
      [1, 3, TILE.DRUM], [1, 7, TILE.WALL_1], [1, 9, TILE.DOOR],
      [2, 6, TILE.WALL_2], [2, 8, TILE.PILLAR], [2, 12, TILE.WALL_1],
      [3, 3, TILE.WALL_1], [3, 8, TILE.WALL_2], [3, 10, TILE.BOMB], [3, 11, TILE.WALL_1],
      [4, 5, TILE.DOOR], [4, 7, TILE.BREAK_LADDER], [4, 11, TILE.WALL_3],
      [5, 2, TILE.WALL_1], [5, 6, TILE.WALL_1], [5, 8, TILE.BOMB], [5, 9, TILE.WALL_2], [5, 13, TILE.WALL_1]
    ];
    for (let i = 0; i < items.length; i++) {
      grid[items[i][0]][items[i][1]] = items[i][2];
    }
    return buildStageFromGrid(grid, rows, cols, 3, Math.random);
  }

  function generateBattleStage(options = {}) {
    const rand = typeof options.random === "function" ? options.random : Math.random;
    const rows = BATTLE_ROWS;
    const cols = BATTLE_COLS;
    const keyOf = (r, c) => r * cols + c;

    for (let attempt = 0; attempt < 50; attempt++) {
      const grid = createGrid(rows, cols);

      // 1. 各段(r=1..5)に通常ハシゴを2〜3本ずつ配置し、地面から全段への骨格を確保
      for (let r = 1; r < rows; r++) {
        const count = rand() < 0.68 ? 2 : 3;
        const pool = [];
        for (let c = MIN_COL; c <= MAX_COL; c++) pool.push(c);
        shuffleArray(pool, rand);

        const placed = [];
        for (let i = 0; i < pool.length && placed.length < count; i++) {
          const c = pool[i];
          if (placed.some(pc => Math.abs(c - pc) <= 1)) continue;
          grid[r][c] = TILE.LADDER;
          placed.push(c);
        }
      }

      const bottomEmpty = [];
      for (let c = MIN_COL; c <= MAX_COL; c++) {
        if (grid[rows - 1][c] === TILE.EMPTY) {
          bottomEmpty.push(c);
        }
      }
      if (bottomEmpty.length === 0) continue;
      const playerCol = bottomEmpty[Math.floor(rand() * bottomEmpty.length)];

      const reach0 = computeReachable(grid, rows, cols, rows - 1, playerCol);
      if (countVisitedRows(reach0, cols) < rows) continue;

      const getFreeCells = (minR, maxR) => {
        const list = [];
        for (let r = minR; r <= maxR; r++) {
          for (let c = MIN_COL; c <= MAX_COL; c++) {
            if (grid[r][c] === TILE.EMPTY && !(r === rows - 1 && c === playerCol)) {
              list.push([r, c]);
            }
          }
        }
        return shuffleArray(list, rand);
      };

      // 2. ドラム缶 (2〜3個)
      let drumTarget = randInt(2, 3, rand);
      const drumCand = getFreeCells(0, rows - 1);
      for (let i = 0; i < drumCand.length && drumTarget > 0; i++) {
        const [r, c] = drumCand[i];
        if (r < rows - 1 && (grid[r + 1][c] === TILE.LADDER || grid[r + 1][c] === TILE.BREAK_LADDER)) {
          continue;
        }
        grid[r][c] = TILE.DRUM;
        const rc = computeReachable(grid, rows, cols, rows - 1, playerCol);
        if (countVisitedRows(rc, cols) < rows) {
          grid[r][c] = TILE.EMPTY;
        } else {
          drumTarget -= 1;
        }
      }

      // 3. 穴 (1〜3個, 最下段除く)
      let holeTarget = randInt(1, 3, rand);
      const holeCand = getFreeCells(0, rows - 2);
      for (let i = 0; i < holeCand.length && holeTarget > 0; i++) {
        const [r, c] = holeCand[i];
        const below = grid[r + 1][c];
        if (below === TILE.LADDER || below === TILE.BREAK_LADDER || below === TILE.HOLE) continue;
        if (r > 0 && grid[r - 1][c] === TILE.HOLE) continue;
        grid[r][c] = TILE.HOLE;
        const rc = computeReachable(grid, rows, cols, rows - 1, playerCol);
        if (countVisitedRows(rc, cols) < rows) {
          grid[r][c] = TILE.EMPTY;
        } else {
          holeTarget -= 1;
        }
      }

      // 4. 鉄柱 (1〜3個, row 1..5, 真上にドラム缶・鉄柱・穴・ドア・通常ハシゴ不可)
      let pillarTarget = randInt(1, 3, rand);
      let reachNow = computeReachable(grid, rows, cols, rows - 1, playerCol);
      const pillarCand = getFreeCells(1, rows - 1);
      for (let i = 0; i < pillarCand.length && pillarTarget > 0; i++) {
        const [r, c] = pillarCand[i];
        if (!reachNow.has(keyOf(r, c))) continue;
        const above = grid[r - 1][c];
        if (above === TILE.DRUM ||
            above === TILE.PILLAR ||
            above === TILE.HOLE ||
            above === TILE.DOOR ||
            above === TILE.LADDER) {
          continue;
        }
        grid[r][c] = TILE.PILLAR;
        const rc = computeReachable(grid, rows, cols, rows - 1, playerCol);
        if (countVisitedRows(rc, cols) < rows) {
          grid[r][c] = TILE.EMPTY;
        } else {
          reachNow = rc;
          pillarTarget -= 1;
        }
      }

      // 5. 壊せるハシゴ (2〜4個, row 1..5)
      let blTarget = randInt(2, 4, rand);
      const blCand = getFreeCells(1, rows - 1);
      for (let i = 0; i < blCand.length && blTarget > 0; i++) {
        const [r, c] = blCand[i];
        if (r < rows - 1 && grid[r + 1][c] === TILE.PILLAR) continue;
        if (r > 0 && (grid[r - 1][c] === TILE.DRUM || grid[r - 1][c] === TILE.HOLE)) continue;
        grid[r][c] = TILE.BREAK_LADDER;
        const rc = computeReachable(grid, rows, cols, rows - 1, playerCol);
        if (rc.has(keyOf(r, c))) {
          reachNow = rc;
          blTarget -= 1;
        } else {
          grid[r][c] = TILE.EMPTY;
        }
      }

      // 6. 壁1(6..9), 壁2(3..5), 壁3(1..3), ドア(2..3) を全段へバランスよく配置
      const bag = [];
      for (let i = 0; i < randInt(6, 9, rand); i++) bag.push(TILE.WALL_1);
      for (let i = 0; i < randInt(3, 5, rand); i++) bag.push(TILE.WALL_2);
      for (let i = 0; i < randInt(1, 3, rand); i++) bag.push(TILE.WALL_3);
      for (let i = 0; i < randInt(2, 3, rand); i++) bag.push(TILE.DOOR);
      shuffleArray(bag, rand);

      reachNow = computeReachable(grid, rows, cols, rows - 1, playerCol);
      const rowCounts = new Array(rows).fill(0);

      const canPlaceTarget = (r, c, t) => {
        if (grid[r][c] !== TILE.EMPTY || (r === rows - 1 && c === playerCol)) return false;
        if (t === TILE.DOOR && r < rows - 1 && grid[r + 1][c] === TILE.PILLAR) return false;
        if (reachNow.has(keyOf(r, c))) return true;
        if (r < rows - 1 && grid[r + 1][c] === TILE.PILLAR) {
          return (c - 1 >= MIN_COL && reachNow.has(keyOf(r, c - 1))) ||
            (c + 1 <= MAX_COL && reachNow.has(keyOf(r, c + 1)));
        }
        return false;
      };

      for (let i = 0; i < bag.length; i++) {
        const t = bag[i];
        const cand = [];
        for (let r = 0; r < rows; r++) {
          for (let c = MIN_COL; c <= MAX_COL; c++) {
            if (canPlaceTarget(r, c, t)) {
              cand.push({ r, c, weight: rowCounts[r] + rand() * 0.9 });
            }
          }
        }
        if (cand.length === 0) continue;
        cand.sort((a, b) => a.weight - b.weight);
        const pickPoolSize = Math.max(1, Math.floor(cand.length / 2));
        const chosen = cand[Math.floor(rand() * pickPoolSize)];
        grid[chosen.r][chosen.c] = t;
        rowCounts[chosen.r] += 1;
      }

      // 7. 爆弾 (2〜3個) - 左右隣に破壊可能物がある場所を優先しつつ、絶対に連鎖させない
      let bombTarget = randInt(2, 3, rand);
      const bombCand = getFreeCells(0, rows - 1).filter(([r, c]) => reachNow.has(keyOf(r, c)));
      const hasAdjBreakable = (r, c) => {
        if (c - 1 >= MIN_COL && isBreakableTile(grid[r][c - 1])) return true;
        if (c + 1 <= MAX_COL && isBreakableTile(grid[r][c + 1])) return true;
        return false;
      };
      bombCand.sort((a, b) => {
        const adjA = hasAdjBreakable(a[0], a[1]) ? 0 : 1;
        const adjB = hasAdjBreakable(b[0], b[1]) ? 0 : 1;
        return adjA - adjB;
      });

      for (let i = 0; i < bombCand.length && bombTarget > 0; i++) {
        const [r, c] = bombCand[i];
        grid[r][c] = TILE.BOMB;
        if (hasBombChain(grid, rows, cols)) {
          grid[r][c] = TILE.EMPTY;
        } else {
          bombTarget -= 1;
        }
      }

      if (isValidBattleMap(grid, rows, cols, playerCol)) {
        return buildStageFromGrid(grid, rows, cols, playerCol, rand);
      }
    }

    return createFallbackBattleStage();
  }

  const api = {
    BATTLE_COLS,
    BATTLE_ROWS,
    hasBombChain,
    computeReachable,
    isValidBattleMap,
    generateBattleStage
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.BreakerGame = Object.assign(root.BreakerGame || {}, api);
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
