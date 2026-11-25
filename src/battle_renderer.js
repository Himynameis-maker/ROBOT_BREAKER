(function (root) {
  "use strict";

  const FONT_5X7 = {
    A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
    B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
    C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
    D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
    E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
    F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
    G: ["01111", "10000", "10000", "10111", "10001", "10001", "01110"],
    H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
    I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
    J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
    K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
    L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
    M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
    N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
    O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
    P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
    Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
    R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
    S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
    T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
    U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
    V: ["10001", "10001", "10001", "10001", "01010", "01010", "00100"],
    W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
    X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
    Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
    Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
    "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
    "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
    "3": ["01110", "10001", "00001", "00110", "00001", "10001", "01110"],
    "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
    "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
    "7": ["11111", "10001", "00001", "00010", "00100", "00100", "00100"],
    "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
    "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
    ".": ["00000", "00000", "00000", "00000", "00000", "00110", "00110"],
    "*": ["00000", "10101", "01110", "11111", "01110", "10101", "00000"],
    "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
    ":": ["00000", "00100", "00100", "00000", "00100", "00100", "00000"],
    "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
    " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"]
  };

  function padScore5(n) {
    return String(Math.min(99999, Math.max(0, n | 0))).padStart(5, "0");
  }

  function padCount2(n) {
    return String(Math.min(99, Math.max(0, n | 0))).padStart(2, "0");
  }

  // ファミコン風タイマー表記（25.00 -> 00.00、小数2桁は3F=5刻みで大雑把に進める）
  function formatBattleTimer(remainFrames) {
    const rem = Math.max(0, remainFrames | 0);
    const sec = Math.floor(rem / 60);
    const subF = rem % 60;
    const coarseCentis = Math.floor(subF / 3) * 5;
    return String(sec).padStart(2, "0") + "." + String(coarseCentis).padStart(2, "0");
  }

  const R = root.BreakerRender;
  if (!R || !R.Renderer) return;

  Object.assign(R.Renderer.prototype, {
    drawPixelText5x7(ctx, text, x, y, options = {}) {
      const str = String(text || "").toUpperCase();
      if (!str) return;
      const scale = options.scale || 1;
      const color = options.color || "#ffffff";
      const outline = options.outlineColor !== undefined ? options.outlineColor : "#050810";
      const align = options.align || "left";
      const stepX = 6 * scale;
      const totalW = Math.max(0, str.length * stepX - scale);

      let startX = Math.round(x);
      if (align === "center") {
        startX = Math.round(x - totalW / 2);
      } else if (align === "right") {
        startX = Math.round(x - totalW);
      }
      const startY = Math.round(y);

      const drawGlyphs = (ox, oy, fill) => {
        ctx.fillStyle = fill;
        for (let i = 0; i < str.length; i++) {
          const glyph = FONT_5X7[str[i]] || FONT_5X7[" "];
          const gx = startX + i * stepX + ox;
          for (let r = 0; r < 7; r++) {
            const line = glyph[r];
            for (let c = 0; c < 5; c++) {
              if (line[c] === "1") {
                ctx.fillRect(gx + c * scale, startY + r * scale, scale, scale);
              }
            }
          }
        }
      };

      if (outline) {
        const d = scale;
        drawGlyphs(-d, 0, outline);
        drawGlyphs(d, 0, outline);
        drawGlyphs(0, -d, outline);
        drawGlyphs(0, d, outline);
        drawGlyphs(d, d, outline);
      }
      drawGlyphs(0, 0, color);
    },

    drawBattlePopups(world) {
      const battle = world.battleManager;
      if (!battle || !battle.popups || battle.popups.length === 0) return;
      const ctx = this.ctx;

      for (let i = 0; i < battle.popups.length; i++) {
        const p = battle.popups[i];
        const blink = p.timer <= 8 && (p.timer & 1) === 1;
        if (blink) continue;
        const textColor = p.byPlayer ? "#ffffff" : "#ffe878";
        const outlineColor = p.byPlayer ? "#105898" : "#981e10";
        this.drawPixelText5x7(ctx, String(p.points), p.x, p.y, {
          scale: 1,
          color: textColor,
          outlineColor,
          align: "center"
        });
      }
    },

    drawBattleHUD(world) {
      const battle = world.battleManager;
      if (!battle) return;
      const ctx = this.ctx;
      const w = world.worldWidth;
      const centerX = Math.round(w / 2);

      // 左スコア（プレイヤー）
      this.drawPixelText5x7(ctx, "PLAYER", 6, 3, {
        scale: 1,
        color: "#5ce4ff",
        outlineColor: "#040814",
        align: "left"
      });
      this.drawPixelText5x7(ctx, padScore5(battle.scores.player.total), 6, 12, {
        scale: 1,
        color: "#ffffff",
        outlineColor: "#040814",
        align: "left"
      });

      // 右スコア（ハンター）
      this.drawPixelText5x7(ctx, "HUNTER", w - 6, 3, {
        scale: 1,
        color: "#ff724c",
        outlineColor: "#040814",
        align: "right"
      });
      this.drawPixelText5x7(ctx, padScore5(battle.scores.hunter.total), w - 6, 12, {
        scale: 1,
        color: "#ffffff",
        outlineColor: "#040814",
        align: "right"
      });

      // 中央ファミコン風タイマー枠
      const boxW = 48;
      const boxH = 17;
      const bx = centerX - Math.floor(boxW / 2);
      const by = 2;

      // 外枠影＋角欠けドット枠
      ctx.fillStyle = "#04060e";
      ctx.fillRect(bx + 1, by, boxW - 2, boxH);
      ctx.fillRect(bx, by + 1, boxW, boxH - 2);

      ctx.fillStyle = "#e8f2ff";
      ctx.fillRect(bx + 1, by, boxW - 2, 1);
      ctx.fillRect(bx + 1, by + boxH - 1, boxW - 2, 1);
      ctx.fillRect(bx, by + 1, 1, boxH - 2);
      ctx.fillRect(bx + boxW - 1, by + 1, 1, boxH - 2);

      ctx.fillStyle = "#3c84e8";
      ctx.fillRect(bx + 1, by + 1, boxW - 2, 1);
      ctx.fillRect(bx + 1, by + boxH - 2, boxW - 2, 1);
      ctx.fillRect(bx + 1, by + 1, 1, boxH - 2);
      ctx.fillRect(bx + boxW - 2, by + 1, 1, boxH - 2);

      ctx.fillStyle = "#081024";
      ctx.fillRect(bx + 2, by + 2, boxW - 4, boxH - 4);

      // 4隅のレトロ飾りドット
      ctx.fillStyle = "#ffd058";
      ctx.fillRect(bx + 2, by + 2, 1, 1);
      ctx.fillRect(bx + boxW - 3, by + 2, 1, 1);
      ctx.fillRect(bx + 2, by + boxH - 3, 1, 1);
      ctx.fillRect(bx + boxW - 3, by + boxH - 3, 1, 1);

      const timeStr = formatBattleTimer(battle.remainFrames);
      let timeColor = "#ffffff";
      if (battle.remainFrames <= 300) {
        timeColor = ((world.f >> 3) & 1) ? "#ff5244" : "#ffe070";
      } else if (battle.remainFrames <= 600) {
        timeColor = "#ffe070";
      }
      this.drawPixelText5x7(ctx, timeStr, centerX, by + 5, {
        scale: 1,
        color: timeColor,
        outlineColor: "#040814",
        align: "center"
      });
    },

    drawBattleOverlay(world) {
      const battle = world.battleManager;
      if (!battle) return;
      const ctx = this.ctx;
      const w = world.worldWidth;
      const h = this.viewHeight;

      if (battle.ended) {
        if (battle.resultPhase === 1) {
          this.drawBannerText(ctx, w, battle.endReason || "TIME UP!", 100);
          return;
        }
        if (battle.resultPhase === 2) {
          ctx.fillStyle = "rgba(4, 6, 14, 0.88)";
          ctx.fillRect(0, 0, w, h);

          const t = battle.resultTimer || 0;
          const leftCx = Math.round(w * 0.25);
          const rightCx = Math.round(w * 0.75);
          const midX = Math.round(w / 2);

          // タイトル
          this.drawPixelText5x7(ctx, "RESULT", midX, 12, {
            scale: 2,
            color: "#ffe868",
            outlineColor: "#000000",
            align: "center"
          });

          // 中央の縦区切り（点線）
          ctx.fillStyle = "#3a4c70";
          for (let yy = 34; yy <= 178; yy += 6) {
            ctx.fillRect(midX - 1, yy, 2, 3);
          }

          // 左右プレイヤー見出し
          this.drawPixelText5x7(ctx, "PLAYER", leftCx, 36, {
            scale: 1,
            color: "#5ce4ff",
            outlineColor: "#000000",
            align: "center"
          });
          this.drawPixelText5x7(ctx, "HUNTER", rightCx, 36, {
            scale: 1,
            color: "#ff724c",
            outlineColor: "#000000",
            align: "center"
          });

          // 内訳 200*N, 400*N, 600*N, 800*N を段階表示
          const rows = [
            { label: "200*", key: "c200", at: 15, color: "#ffffff", y: 54 },
            { label: "400*", key: "c400", at: 35, color: "#98f0ff", y: 76 },
            { label: "600*", key: "c600", at: 55, color: "#ffe870", y: 98 },
            { label: "800*", key: "c800", at: 75, color: "#ff90a8", y: 120 }
          ];

          const ps = battle.scores.player;
          const hs = battle.scores.hunter;

          for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (t < row.at) continue;
            this.drawPixelText5x7(ctx, row.label + padCount2(ps[row.key]), leftCx, row.y, {
              scale: 2,
              color: row.color,
              outlineColor: "#000000",
              align: "center"
            });
            this.drawPixelText5x7(ctx, row.label + padCount2(hs[row.key]), rightCx, row.y, {
              scale: 2,
              color: row.color,
              outlineColor: "#000000",
              align: "center"
            });
          }

          // 少し間を置いて合計点
          if (t >= 110) {
            ctx.fillStyle = "#526890";
            ctx.fillRect(14, 142, midX - 24, 2);
            ctx.fillRect(midX + 10, 142, midX - 24, 2);

            this.drawPixelText5x7(ctx, "TOTAL", leftCx, 148, {
              scale: 1,
              color: "#a8c0e8",
              outlineColor: "#000000",
              align: "center"
            });
            this.drawPixelText5x7(ctx, "TOTAL", rightCx, 148, {
              scale: 1,
              color: "#a8c0e8",
              outlineColor: "#000000",
              align: "center"
            });

            this.drawPixelText5x7(ctx, padScore5(ps.total), leftCx, 160, {
              scale: 2,
              color: "#ffffff",
              outlineColor: "#000000",
              align: "center"
            });
            this.drawPixelText5x7(ctx, padScore5(hs.total), rightCx, 160, {
              scale: 2,
              color: "#ffffff",
              outlineColor: "#000000",
              align: "center"
            });
          }

          // 最後に勝者発表
          if (t >= 150) {
            let winText = "DRAW GAME!";
            let winColor = "#ffe868";
            if (ps.total > hs.total) {
              winText = "PLAYER WIN!";
              winColor = ((t >> 3) & 1) ? "#68f0ff" : "#ffffff";
            } else if (hs.total > ps.total) {
              winText = "HUNTER WIN!";
              winColor = ((t >> 3) & 1) ? "#ff7a52" : "#ffe080";
            }
            this.drawPixelText5x7(ctx, winText, midX, 194, {
              scale: 2,
              color: winColor,
              outlineColor: "#000000",
              align: "center"
            });
          }

          if (battle.resultFinished && ((t >> 4) & 1) === 0) {
            this.drawPixelText5x7(ctx, "PRESS HAMMER", midX, 222, {
              scale: 1,
              color: "#b4c8e8",
              outlineColor: "#000000",
              align: "center"
            });
          }
        }
        return;
      }

      if (world.introActive) {
        this.drawBannerText(ctx, w, "VS HUNTER", 44);
      } else if (world.startBannerTimer > 0) {
        const elapsed = Math.max(0, 72 - world.startBannerTimer);
        if (Math.floor(elapsed / 6) % 2 === 0) {
          this.drawBannerText(ctx, w, "START!", 44);
        }
      }
    }
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
