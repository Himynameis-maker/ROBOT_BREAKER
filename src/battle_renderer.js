(function (root) {
  "use strict";

  // プレイ中のポップアップ点数用（従来の5x7細字フォント）
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

  // HUD・リザルト用（本編バナーと同じ7x7太字ファミコン仕様フォント）
  const FONT_7X7 = {
    A: ["0011100", "0111110", "1100011", "1100011", "1111111", "1100011", "1100011"],
    B: ["1111110", "1100011", "1100011", "1111110", "1100011", "1100011", "1111110"],
    C: ["0111110", "1100011", "1100000", "1100000", "1100000", "1100011", "0111110"],
    D: ["1111100", "1100110", "1100011", "1100011", "1100011", "1100110", "1111100"],
    E: ["1111111", "1100000", "1100000", "1111110", "1100000", "1100000", "1111111"],
    F: ["1111111", "1100000", "1100000", "1111110", "1100000", "1100000", "1100000"],
    G: ["0111110", "1100011", "1100000", "1101111", "1100011", "1100011", "0111110"],
    H: ["1100011", "1100011", "1100011", "1111111", "1100011", "1100011", "1100011"],
    I: ["0111110", "0011100", "0011100", "0011100", "0011100", "0011100", "0111110"],
    J: ["0011111", "0001100", "0001100", "0001100", "1101100", "1101100", "0111000"],
    K: ["1100011", "1100110", "1101100", "1111000", "1101100", "1100110", "1100011"],
    L: ["1100000", "1100000", "1100000", "1100000", "1100000", "1100000", "1111111"],
    M: ["1100011", "1110111", "1111111", "1101011", "1100011", "1100011", "1100011"],
    N: ["1100011", "1110011", "1111011", "1101111", "1100111", "1100011", "1100011"],
    O: ["0111110", "1100011", "1100011", "1100011", "1100011", "1100011", "0111110"],
    P: ["1111110", "1100011", "1100011", "1111110", "1100000", "1100000", "1100000"],
    Q: ["0111110", "1100011", "1100011", "1100011", "1101011", "1100110", "0111101"],
    R: ["1111110", "1100011", "1100011", "1111110", "1101100", "1100110", "1100011"],
    S: ["0111110", "1100011", "1100000", "0111110", "0000011", "1100011", "0111110"],
    T: ["1111111", "0011100", "0011100", "0011100", "0011100", "0011100", "0011100"],
    U: ["1100011", "1100011", "1100011", "1100011", "1100011", "1100011", "0111110"],
    V: ["1100011", "1100011", "1100011", "1100011", "0110110", "0111110", "0011100"],
    W: ["1100011", "1100011", "1100011", "1101011", "1111111", "1110111", "1100011"],
    X: ["1100011", "1100011", "0110110", "0011100", "0110110", "1100011", "1100011"],
    Y: ["1100011", "1100011", "0110110", "0011100", "0011100", "0011100", "0011100"],
    Z: ["1111111", "0000111", "0001110", "0011100", "0111000", "1110000", "1111111"],
    "0": ["0111110", "1100011", "1100111", "1101011", "1110011", "1100011", "0111110"],
    "1": ["0011100", "0111100", "0011100", "0011100", "0011100", "0011100", "0111110"],
    "2": ["0111110", "1100011", "0000011", "0011110", "0111000", "1100000", "1111111"],
    "3": ["0111110", "1100011", "0000011", "0011110", "0000011", "1100011", "0111110"],
    "4": ["0001110", "0011110", "0110110", "1100110", "1111111", "0000110", "0000110"],
    "5": ["1111111", "1100000", "1111110", "0000011", "0000011", "1100011", "0111110"],
    "6": ["0111110", "1100000", "1100000", "1111110", "1100011", "1100011", "0111110"],
    "7": ["1111111", "1100011", "0000011", "0000110", "0001100", "0001100", "0001100"],
    "8": ["0111110", "1100011", "1100011", "0111110", "1100011", "1100011", "0111110"],
    "9": ["0111110", "1100011", "1100011", "0111111", "0000011", "0000011", "0111110"],
    ".": ["0000000", "0000000", "0000000", "0000000", "0000000", "0011100", "0011100"],
    "*": ["0000000", "1101011", "0111110", "1111111", "0111110", "1101011", "0000000"],
    "!": ["0111110", "0111110", "0011100", "0011100", "0011100", "0000000", "0011100"],
    ":": ["0000000", "0011100", "0011100", "0000000", "0011100", "0011100", "0000000"],
    "-": ["0000000", "0000000", "0000000", "0111110", "0000000", "0000000", "0000000"],
    " ": ["0000000", "0000000", "0000000", "0000000", "0000000", "0000000", "0000000"]
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
                ctx.fillRect(gx + c * scale, startY + r * scale + oy, scale, scale);
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

    drawPixelText7x7(ctx, text, x, y, options = {}) {
      const str = String(text || "").toUpperCase();
      if (!str) return;
      const scale = options.scale || 1;
      const color = options.color || "#ffffff";
      const shadow = options.shadowColor !== undefined ? options.shadowColor : "#040814";
      const align = options.align || "left";
      const stepX = 8 * scale;
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
          const glyph = FONT_7X7[str[i]] || FONT_7X7[" "];
          const gx = startX + i * stepX + ox;
          for (let r = 0; r < 7; r++) {
            const line = glyph[r];
            for (let c = 0; c < 7; c++) {
              if (line[c] === "1") {
                ctx.fillRect(gx + c * scale, startY + r * scale + oy, scale, scale);
              }
            }
          }
        }
      };

      // 控えめなドット影（右・下・右下のみのL字ドロップシャドウ）
      if (shadow) {
        const d = scale;
        drawGlyphs(d, 0, shadow);
        drawGlyphs(0, d, shadow);
        drawGlyphs(d, d, shadow);
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
        const textColor = p.byPlayer
          ? (p.isAction ? "#98f4ff" : "#ffffff")
          : (p.isAction ? "#ffb0a0" : "#ffe878");
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
      this.drawPixelText7x7(ctx, "PLAYER", 6, 3, {
        scale: 1,
        color: "#5ce4ff",
        shadowColor: "#040814",
        align: "left"
      });
      this.drawPixelText7x7(ctx, padScore5(battle.scores.player.total), 6, 12, {
        scale: 1,
        color: "#ffffff",
        shadowColor: "#040814",
        align: "left"
      });

      // 右スコア（ハンター）
      this.drawPixelText7x7(ctx, "HUNTER", w - 6, 3, {
        scale: 1,
        color: "#ff724c",
        shadowColor: "#040814",
        align: "right"
      });
      this.drawPixelText7x7(ctx, padScore5(battle.scores.hunter.total), w - 6, 12, {
        scale: 1,
        color: "#ffffff",
        shadowColor: "#040814",
        align: "right"
      });

      // 中央ファミコン風タイマー枠
      const boxW = 48;
      const boxH = 17;
      const bx = centerX - Math.floor(boxW / 2);
      const by = 2;

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
      this.drawPixelText7x7(ctx, timeStr, centerX, by + 5, {
        scale: 1,
        color: timeColor,
        shadowColor: "#040814",
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
          this.drawPixelText7x7(ctx, "RESULT", midX, 10, {
            scale: 2,
            color: "#ffe868",
            shadowColor: "#000000",
            align: "center"
          });

          // 中央の縦区切り（点線）
          ctx.fillStyle = "#3a4c70";
          for (let yy = 32; yy <= 178; yy += 6) {
            ctx.fillRect(midX - 1, yy, 2, 3);
          }

          // 左右プレイヤー見出し
          this.drawPixelText7x7(ctx, "PLAYER", leftCx, 30, {
            scale: 1,
            color: "#5ce4ff",
            shadowColor: "#000000",
            align: "center"
          });
          this.drawPixelText7x7(ctx, "HUNTER", rightCx, 30, {
            scale: 1,
            color: "#ff724c",
            shadowColor: "#000000",
            align: "center"
          });

          const ps = battle.scores.player;
          const hs = battle.scores.hunter;

          // 壁・通常オブジェクト破壊内訳 200*N, 400*N, 600*N
          const objRows = [
            { label: "200*", key: "c200", at: 15, color: "#ffffff", y: 45 },
            { label: "400*", key: "c400", at: 35, color: "#98f0ff", y: 65 },
            { label: "600*", key: "c600", at: 55, color: "#ffe870", y: 85 }
          ];

          for (let i = 0; i < objRows.length; i++) {
            const row = objRows[i];
            if (t < row.at) continue;
            this.drawPixelText7x7(ctx, row.label + padCount2(ps[row.key]), leftCx, row.y, {
              scale: 2,
              color: row.color,
              shadowColor: "#000000",
              align: "center"
            });
            this.drawPixelText7x7(ctx, row.label + padCount2(hs[row.key]), rightCx, row.y, {
              scale: 2,
              color: row.color,
              shadowColor: "#000000",
              align: "center"
            });
          }

          // アクション枠（敵表裏移動・敵落とし・相手落とし：すべて400点）
          if (t >= 75) {
            this.drawPixelText7x7(ctx, "ACTION", leftCx, 107, {
              scale: 1,
              color: "#ff90a8",
              shadowColor: "#000000",
              align: "center"
            });
            this.drawPixelText7x7(ctx, "ACTION", rightCx, 107, {
              scale: 1,
              color: "#ff90a8",
              shadowColor: "#000000",
              align: "center"
            });

            this.drawPixelText7x7(ctx, "400*" + padCount2(ps.cAction), leftCx, 117, {
              scale: 2,
              color: "#ff90a8",
              shadowColor: "#000000",
              align: "center"
            });
            this.drawPixelText7x7(ctx, "400*" + padCount2(hs.cAction), rightCx, 117, {
              scale: 2,
              color: "#ff90a8",
              shadowColor: "#000000",
              align: "center"
            });
          }

          // 少し間を置いて合計点
          if (t >= 110) {
            ctx.fillStyle = "#526890";
            ctx.fillRect(14, 140, midX - 24, 2);
            ctx.fillRect(midX + 10, 140, midX - 24, 2);

            this.drawPixelText7x7(ctx, "TOTAL", leftCx, 148, {
              scale: 1,
              color: "#a8c0e8",
              shadowColor: "#000000",
              align: "center"
            });
            this.drawPixelText7x7(ctx, "TOTAL", rightCx, 148, {
              scale: 1,
              color: "#a8c0e8",
              shadowColor: "#000000",
              align: "center"
            });

            this.drawPixelText7x7(ctx, padScore5(ps.total), leftCx, 160, {
              scale: 2,
              color: "#ffffff",
              shadowColor: "#000000",
              align: "center"
            });
            this.drawPixelText7x7(ctx, padScore5(hs.total), rightCx, 160, {
              scale: 2,
              color: "#ffffff",
              shadowColor: "#000000",
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
            this.drawPixelText7x7(ctx, winText, midX, 192, {
              scale: 2,
              color: winColor,
              shadowColor: "#000000",
              align: "center"
            });
          }

          if (battle.resultFinished && ((t >> 4) & 1) === 0) {
            this.drawPixelText7x7(ctx, "PRESS HAMMER", midX, 222, {
              scale: 1,
              color: "#b4c8e8",
              shadowColor: "#000000",
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
