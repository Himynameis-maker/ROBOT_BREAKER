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
    isLadderTile,
    isSolidDrum
  } = G;

  class HunterAI {
    constructor() {
      this.lastPlayerDir = 4;
      this.timer = 0;
    }

    update(world) {
      const hu = world.hunter;
      if (!hu) return;
      const pl = world.player;
      if (hu.state === 15 || hu.state === 16) {
        hu.bits = 0;
        return;
      }

      if (pl.row === hu.row && hu.y === pl.y) {
        let v = (this.timer - 1) & 0xff;
        if (v >= 0x80) {
          v = 0x20;
          if (pl.dir === this.lastPlayerDir) {
            v = 0;
            hu.bits = this.horizontalVsPlayer(pl, hu);
          }
        }
        this.timer = v;
        this.lastPlayerDir = pl.dir;
        this.wallAvoid(world, 0, 0);
        return;
      }

      const vert = (pl.row !== hu.row)
        ? (hu.row > pl.row ? UP : DOWN)
        : (hu.y > pl.y ? UP : DOWN);
      const { horiz, bestRow, bestCol } = this.horizontalVsLadder(world, vert);
      hu.bits = vert | horiz;
      this.wallAvoid(world, bestRow, bestCol);
    }

    wallAvoid(world, bestRow, bestCol) {
      const hu = world.hunter;
      const pl = world.player;
      const horiz = hu.bits & 0x03;
      if (horiz === 0) return;

      const isRight = (horiz & RIGHT) !== 0;
      let wallCol = null;

      if (isRight) {
        for (let c = hu.col + 1; c < world.cols; c++) {
          if (isSolidDrum(world.getTile(hu.row, c))) {
            wallCol = c;
            break;
          }
        }
      } else {
        for (let c = hu.col - 1; c >= 0; c--) {
          if (isSolidDrum(world.getTile(hu.row, c))) {
            wallCol = c;
            break;
          }
        }
      }

      if (wallCol === null) return;

      const sameRow = pl.row === hu.row;
      const wallPos = hu.row * world.cols + wallCol;
      const plPos = pl.row * world.cols + pl.col;

      if (isRight) {
        if (!sameRow && wallCol >= bestCol) return;
        if (wallPos >= plPos) return;
      } else {
        if (!sameRow && wallCol < bestCol) return;
        if (wallPos < plPos) return;
      }
      hu.bits ^= 0x03;
    }

    horizontalVsLadder(world, vert) {
      const hu = world.hunter;
      const searchRow = vert === UP ? hu.row : Math.min(world.rows - 1, hu.row + 1);
      let bestCol = 0;
      let bestRow = 0;
      let minDist = world.cols + 1;
      let found = false;

      for (let c = 0; c < world.cols; c++) {
        if (isLadderTile(world.getTile(searchRow, c))) {
          const dist = Math.abs(c - hu.col);
          if (dist < minDist) {
            minDist = dist;
            bestCol = c;
            bestRow = searchRow;
            found = true;
          }
        }
      }

      if (!found) {
        bestRow = 0;
        bestCol = 0;
      }

      const bestPos = bestRow * world.cols + bestCol;
      const huPos = searchRow * world.cols + hu.col;

      if (bestPos === huPos) {
        return { horiz: hu.dir & 0x03, bestRow, bestCol };
      }
      return { horiz: bestPos < huPos ? LEFT : RIGHT, bestRow, bestCol };
    }

    horizontalVsPlayer(pl, hu) {
      if (pl.col === hu.col) return 0;
      return pl.col < hu.col ? LEFT : RIGHT;
    }
  }

  const api = {
    HunterAI
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.BreakerGame = Object.assign(root.BreakerGame || {}, api);
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
