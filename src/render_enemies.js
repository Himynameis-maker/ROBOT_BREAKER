(function (root) {
  "use strict";

  const R = root.BreakerRender;
  if (!R || !R.Renderer) return;

  Object.assign(R.Renderer.prototype, {
    // 予備フォールバック描画（char_drone.js / char_crawler.js がロードされていればそちらを使用）
    drawFallbackEnemyAt(enemy, baseX, drawY) {
      if (enemy.state === 15 || enemy.state === 16) return;
      const ctx = this.ctx;
      const isBack = !!enemy.isBack;
      ctx.save();
      if (isBack) ctx.globalAlpha = 0.7;
      ctx.fillStyle = isBack ? "#25324e" : "#5a6b86";
      ctx.fillRect(baseX + 3, drawY + 4, 10, 14);
      ctx.fillStyle = isBack ? "#465878" : "#9cb0d0";
      ctx.fillRect(baseX + 5, drawY + 7, 6, 4);
      ctx.restore();
    },

    drawEnemy(enemy, worldWidth, world) {
      if (enemy.enemyType !== "crawler" && typeof this.drawDrone === "function") {
        this.drawDrone(enemy, worldWidth, world);
        return;
      }
      if (enemy.enemyType === "crawler" && typeof this.drawCrawler === "function") {
        this.drawCrawler(enemy, worldWidth, world);
        return;
      }
      const drawY = enemy.y - 22;
      this.drawFallbackEnemyAt(enemy, enemy.x, drawY);
      if (enemy.x > worldWidth - 16) {
        this.drawFallbackEnemyAt(enemy, enemy.x - worldWidth, drawY);
      }
      if (enemy.x < 16) {
        this.drawFallbackEnemyAt(enemy, enemy.x + worldWidth, drawY);
      }
    }
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
