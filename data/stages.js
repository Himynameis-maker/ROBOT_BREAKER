(function (root) {
  "use strict";

  const G = (typeof module !== "undefined" && module.exports && !root.BreakerGame)
    ? require("../src/constants.js")
    : (root.BreakerGame || {});
  const TILE = G.TILE;
  const RIGHT = G.RIGHT || 1;
  const LEFT = G.LEFT || 2;

  const L = TILE.LADDER;
  const SL = TILE.SAND_LADDER;
  const D = TILE.DRUM;
  const H = TILE.HOLE;
  const W1 = TILE.WALL_1;
  const W2 = TILE.WALL_2;
  const W3 = TILE.WALL_3;
  const B = TILE.BOMB;
  const TB = TILE.TIMED_BOMB;
  const BL = TILE.BREAK_LADDER;
  const DR = TILE.DOOR;
  const P = TILE.PILLAR;

  const STAGES = {
    sandLadderDemo: {
      stageNumber: 1,
      cols: 20,
      rows: 8,
      tiles: [
        [4, 5, L], [4, 9, SL], [4, 13, L],
        [5, 5, L], [5, 9, SL], [5, 11, SL], [5, 13, L], [5, 15, SL],
        [6, 5, L], [6, 7, SL], [6, 11, BL], [6, 13, SL], [6, 15, P], [6, 16, B], [6, 17, W1],
        [7, 2, D], [7, 4, L], [7, 10, SL], [7, 14, L], [7, 17, D]
      ],
      player: { x: 64, y: 224 },
      hunter: { x: 176, y: 128 },
      enemies: [
        { enemyType: "drone", x: 192, y: 192, dir: LEFT },
        { enemyType: "crawler", x: 208, y: 224, dir: LEFT }
      ]
    },
    timedBombDemo: {
      stageNumber: 2,
      cols: 20,
      rows: 8,
      tiles: [
        [4, 6, L], [4, 8, TB], [4, 12, TB], [4, 14, L],
        [5, 6, L], [5, 12, P], [5, 14, L], [5, 16, DR],
        [6, 6, L], [6, 8, W1], [6, 9, TB], [6, 10, B], [6, 11, W2], [6, 14, L],
        [7, 2, D], [7, 4, L], [7, 6, L], [7, 12, B], [7, 13, W1], [7, 14, TB], [7, 15, W1], [7, 16, DR], [7, 17, D]
      ],
      timedBombs: [
        { row: 6, col: 9, sec: 15 },
        { row: 4, col: 12, sec: 30 },
        { row: 4, col: 8, sec: 45 },
        { row: 7, col: 14, sec: 60 }
      ],
      player: { x: 64, y: 224 },
      hunter: { x: 240, y: 64 },
      enemies: [
        { enemyType: "drone", x: 208, y: 192, dir: RIGHT },
        { enemyType: "drone", x: 128, y: 256, dir: RIGHT }
      ]
    },
    enemyDemo: {
      stageNumber: 3,
      cols: 20,
      rows: 8,
      tiles: [
        [4, 4, BL], [4, 8, D], [4, 12, BL], [4, 15, BL],
        [5, 4, BL], [5, 7, H], [5, 8, P], [5, 10, DR], [5, 12, BL], [5, 15, BL], [5, 16, D],
        [6, 4, BL], [6, 6, D], [6, 9, BL], [6, 14, BL],
        [7, 2, D], [7, 6, DR], [7, 9, W1], [7, 10, B], [7, 12, L], [7, 14, DR], [7, 17, D]
      ],
      player: { x: 224, y: 192 },
      hunter: { x: 224, y: 64 },
      enemies: [
        { enemyType: "drone", x: 272, y: 192, dir: LEFT },
        { enemyType: "droneFast", x: 192, y: 224, dir: LEFT },
        { enemyType: "crawler", x: 48, y: 192, dir: RIGHT }
      ]
    },
    doorDemo: {
      stageNumber: 4,
      cols: 20,
      rows: 8,
      tiles: [
        [1, 12, L],
        [2, 4, L], [2, 6, DR], [2, 8, H], [2, 12, L],
        [3, 4, L], [3, 8, DR], [3, 12, L], [3, 15, B], [3, 16, DR], [3, 17, W1],
        [4, 4, L], [4, 7, DR], [4, 12, L],
        [5, 4, L], [5, 12, L], [5, 15, H],
        [6, 4, L], [6, 6, DR], [6, 8, B], [6, 9, DR], [6, 10, W1], [6, 11, W2], [6, 12, L], [6, 15, DR],
        [7, 2, D], [7, 17, D]
      ],
      player: { x: 64, y: 224 },
      hunter: { x: 192, y: 224 }
    },
    pillarDemo: {
      stageNumber: 5,
      cols: 20,
      rows: 8,
      tiles: [
        [0, 3, P], [0, 12, L],
        [1, 5, W1], [1, 7, D], [1, 9, BL], [1, 12, L],
        [2, 5, P], [2, 7, P], [2, 9, BL], [2, 12, L],
        [3, 4, L], [3, 9, P], [3, 12, L],
        [4, 4, L], [4, 12, L],
        [5, 4, L], [5, 8, D], [5, 10, B], [5, 12, L], [5, 14, W2],
        [6, 4, L], [6, 6, P], [6, 8, P], [6, 10, P], [6, 12, L], [6, 14, P],
        [7, 2, D], [7, 17, D]
      ],
      player: { x: 80, y: 224 },
      hunter: { x: 144, y: 224 }
    },
    hammerDemo: {
      stageNumber: 6,
      cols: 20,
      rows: 8,
      tiles: [
        [2, 5, W2], [2, 6, W1], [2, 7, B], [2, 8, W3], [2, 10, L], [2, 13, D],
        [3, 10, L], [3, 13, H],
        [4, 5, L], [4, 7, B], [4, 8, BL], [4, 10, L], [4, 14, H], [4, 16, W1],
        [5, 5, BL], [5, 8, BL], [5, 10, L], [5, 14, D], [5, 16, W2],
        [6, 6, W1], [6, 7, W2], [6, 8, W3], [6, 10, L],
        [6, 12, B], [6, 13, W1], [6, 14, W2], [6, 15, W1], [6, 16, B], [6, 17, W3],
        [7, 2, D], [7, 17, D]
      ],
      player: { x: 64, y: 224 },
      hunter: { x: 192, y: 192 }
    },
    standard8: {
      stageNumber: 7,
      cols: 20,
      rows: 8,
      tiles: [
        [0, 7, H], [0, 8, H], [0, 12, L],
        [1, 5, L], [1, 7, D], [1, 8, L], [1, 12, L], [1, 15, D],
        [2, 5, L], [2, 8, L], [2, 10, H], [2, 12, L],
        [3, 4, D], [3, 8, L], [3, 10, D], [3, 14, L],
        [4, 6, L], [4, 9, H], [4, 14, L], [4, 16, D],
        [5, 6, L], [5, 9, L], [5, 11, D], [5, 13, H],
        [6, 4, L], [6, 9, L], [6, 13, D], [6, 16, L],
        [7, 2, D], [7, 17, D]
      ],
      player: { x: 80, y: 224 },
      hunter: { x: 240, y: 64 }
    },
    wide10: {
      stageNumber: 8,
      cols: 24,
      rows: 10,
      tiles: [
        [0, 6, L], [0, 11, H], [0, 17, L],
        [1, 6, L], [1, 11, D], [1, 14, H], [1, 17, L], [1, 20, D],
        [2, 4, D], [2, 6, L], [2, 9, L], [2, 14, L], [2, 17, L],
        [3, 9, L], [3, 12, D], [3, 14, L], [3, 19, H],
        [4, 5, H], [4, 9, L], [4, 16, L], [4, 19, D],
        [5, 5, L], [5, 7, D], [5, 12, H], [5, 16, L],
        [6, 5, L], [6, 10, L], [6, 12, D], [6, 18, L],
        [7, 3, D], [7, 10, L], [7, 14, H], [7, 18, L],
        [8, 7, L], [8, 10, L], [8, 14, L], [8, 20, D],
        [9, 7, L], [9, 14, L]
      ],
      player: { x: 96, y: 320 },
      hunter: { x: 288, y: 64 }
    },
    compact6: {
      stageNumber: 9,
      cols: 16,
      rows: 6,
      tiles: [
        [0, 5, H], [0, 10, L],
        [1, 5, D], [1, 7, L], [1, 10, L],
        [2, 4, L], [2, 7, L], [2, 11, D],
        [3, 4, L], [3, 9, H], [3, 12, L],
        [4, 6, D], [4, 9, L], [4, 12, L]
      ],
      player: { x: 64, y: 192 },
      hunter: { x: 176, y: 64 }
    },
    u6: {
      stageNumber: 10,
      cols: 20,
      rows: 6,
      tiles: [[1, 7, L]],
      player: { x: 112, y: 64 },
      hunter: { x: 112, y: 64 }
    }
  };

  const api = {
    STAGES
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.BreakerStages = Object.assign(root.BreakerStages || {}, api);
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
