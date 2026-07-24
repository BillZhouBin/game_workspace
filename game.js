(function () {
  'use strict';

  // ============================================================
  // 资源图片：已指向 assets/ 目录下文件，加载失败时自动回退到内置绘制。
  // 如需替换，直接修改 IMG 中对应 loadImg 路径即可。
  // ============================================================
  function loadImg(src){ const i = new Image(); i.src = src; return i; }
  // 用户提供的资源：图片不存在或加载失败时自动回退到内置绘制。
  const IMG = {
    balloon:   loadImg('assets/gif_color_hotAirBalloon.gif'), // 彩色热气球
    coin:      loadImg('assets/square_box.png'),              // 收集物（金币）
    fence:     loadImg('assets/single_fence.png'),            // 栅栏纹理
    power:     loadImg('assets/square_color.gif'),           // 彩色方块：变色 + 免疫道具
    magnet:    null,                                          // 磁铁道具：暂用程序绘制占位，后续替换图片
  };


  // ---------- 画布初始化 ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    if (balloon) {
      balloon.r = Math.max(20, Math.min(W, H) * 0.055);
    }
  }
  window.addEventListener('resize', resize);

  // ---------- 游戏状态 ----------
  let state = 'ready'; // ready | playing | over
  let score = 0;
  let best = +(localStorage.getItem('hab_best') || 0);

  const balloon = { x: 0, y: 0, r: 24, immune: 0, magnet: 0 }; // immune/magnet: 剩余秒数
  let obstacles = [];   // 栅栏 {y, h, gapX, gapW}
  let coins = [];       // 金币 {x, y, r, got}
  let powers = [];      // 道具 {x, y, r, t, type}
  let clouds = [];      // 背景云

  let distSinceObs = 0; // 距上次生成栅栏的下落距离
  let coinTimer = 0;
  let powerTimer = 0;
  let magnetTimer = 0;
  let flash = 0;        // 死亡闪屏
  let t = 0;            // 全局时间（秒）

  const hudScore = document.getElementById('score');
  const hudBest  = document.getElementById('best');
  const immuneBar = document.getElementById('immuneBar');
  const immuneFill = immuneBar.querySelector('i');
  const magnetBar = document.getElementById('magnetBar');
  const magnetFill = magnetBar.querySelector('i');
  const balloonImg = document.getElementById('balloonImg');

  // 用 DOM <img> 定位热气球，让 GIF 动画在 iOS Safari 上也能播放
  function positionBalloonImg(x, y, r, immune) {
    const w = r * 2.2, h = r * 2.8;
    balloonImg.style.width = w + 'px';
    balloonImg.style.height = h + 'px';
    balloonImg.style.left = (x - w / 2) + 'px';
    balloonImg.style.top = (y - h / 2 + r * 0.1) + 'px';
    balloonImg.style.display = (state === 'playing') ? 'block' : 'none';
    balloonImg.style.filter = immune
      ? 'drop-shadow(0 0 10px rgba(255,255,255,.9))'
      : 'none';
  }

  // 彩色方块是 GIF：用 DOM <img> 池显示动画（canvas 绘制在 iOS Safari 上不会动画）
  const powerImgPool = [];
  function syncPowerImgs(list) {
    for (let i = 0; i < list.length; i++) {
      let el = powerImgPool[i];
      if (!el) {
        el = document.createElement('img');
        el.src = 'assets/square_color.gif';
        el.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;' +
          'z-index:2;display:none;transform:translateZ(0);' +
          'filter:drop-shadow(0 0 8px rgba(180,120,255,.7));';
        document.body.appendChild(el);
        powerImgPool[i] = el;
      }
      const p = list[i];
      const s = p.r * 2.2;
      el.style.width = s + 'px';
      el.style.height = s + 'px';
      el.style.left = (p.x - s / 2) + 'px';
      el.style.top = (p.y - s / 2) + 'px';
      el.style.display = (state === 'playing') ? 'block' : 'none';
    }
    for (let i = list.length; i < powerImgPool.length; i++) {
      powerImgPool[i].style.display = 'none';
    }
  }
  const readyEl = document.getElementById('ready');
  const overEl  = document.getElementById('over');

  hudBest.textContent = '最高 ' + best;

  // ---------- 难度曲线 ----------
  function worldSpeed() {            // 障碍/世界下落速度（像素/秒）
    return Math.min(0.62 * H, (0.20 + Math.min(score, 900) * 0.0007) * H);
  }
  function gapWidth() {              // 栅栏缺口宽度
    return Math.max(0.20 * W, 0.44 * W - score * 0.0009 * W);
  }
  function obsSpacing() {            // 栅栏之间的垂直间距
    return Math.max(0.42 * H, 0.60 * H - score * 0.0004 * H);
  }

  // ---------- 生成 ----------
  function spawnObstacle() {
    const rowH = 26;
    const img = IMG.fence;
    // 单块栅栏图片的显示宽度（保持原图比例）
    let tw = rowH;
    if (img && img.complete && img.naturalWidth) tw = rowH * (img.width / img.height);
    // 整行由整数个栅栏图片组成，缺口也对齐到整数个
    const total = Math.max(3, Math.round(W / tw));
    const tileW = W / total;                       // 拉伸填满，保证整行是整数个
    let gapTiles = Math.max(1, Math.round(gapWidth() / tileW));
    gapTiles = Math.min(gapTiles, total - 2);
    const leftTiles = 1 + Math.floor(Math.random() * (total - gapTiles - 1));
    const gapX = leftTiles * tileW;
    const gapW = gapTiles * tileW;
    const o = { y: -rowH, h: rowH, gapX, gapW, tileW };
    obstacles.push(o);
    // 移除会与新栅栏实心部分重叠的金币，保证金币不与栅栏重叠
    coins = coins.filter(c => !coinHitsFence(c, o));
  }
  // 金币是否与某栅栏的实心部分重叠（垂直重叠且不在缺口内即视为重叠）
  function coinHitsFence(c, o) {
    if (c.y + c.r > o.y - 2 && c.y - c.r < o.y + o.h + 2) {
      return !(c.x > o.gapX + c.r && c.x < o.gapX + o.gapW - c.r);
    }
    return false;
  }
  // 金币落点是否合法：不碰栅栏、不碰其它金币
  function coinFits(c) {
    for (const o of obstacles) if (coinHitsFence(c, o)) return false;
    for (const e of coins) {
      const dx = e.x - c.x, dy = e.y - c.y, min = e.r + c.r + 4;
      if (dx * dx + dy * dy < min * min) return false;
    }
    return true;
  }
  function spawnCoin(x, y) {
    const r = Math.max(9, balloon.r * 0.42);
    const c = { x, y, r, got: false };
    if (coinFits(c)) coins.push(c);   // 重叠则放弃本次生成
  }
  function spawnPower() {
    powers.push({ x: 40 + Math.random() * (W - 80), y: -30, r: Math.max(14, balloon.r * 0.6), t: 0, type: 'power' });
  }
  function spawnMagnet() {
    powers.push({ x: 40 + Math.random() * (W - 80), y: -30, r: Math.max(14, balloon.r * 0.6), t: 0, type: 'magnet' });
  }
  function initClouds() {
    clouds = [];
    for (let i = 0; i < 6; i++) {
      clouds.push({ x: Math.random() * W, y: Math.random() * H, s: 0.5 + Math.random() * 0.8, sp: 8 + Math.random() * 16 });
    }
  }

  // ---------- 开始 / 结束 ----------
  function startGame() {
    state = 'playing';
    score = 0;
    obstacles = []; coins = []; powers = [];
    distSinceObs = 0; coinTimer = 0; powerTimer = 4 + Math.random() * 4; magnetTimer = 14 + Math.random() * 8; flash = 0;
    balloon.r = Math.max(20, Math.min(W, H) * 0.055);
    balloon.x = W / 2;
    balloon.y = H * 0.62;
    balloon.immune = 0; balloon.magnet = 0;
    readyEl.classList.add('hidden');
    overEl.classList.add('hidden');
    hudScore.textContent = '0';
  }
  function gameOver() {
    state = 'over';
    flash = 1;
    if (score > best) { best = Math.floor(score); localStorage.setItem('hab_best', best); }
    document.getElementById('finalScore').textContent = Math.floor(score);
    document.getElementById('bestScore').textContent = best;
    hudBest.textContent = '最高 ' + best;
    overEl.classList.remove('hidden');
  }

  // ---------- 输入（拖动热气球） ----------
  let dragging = false;
  function pos(e) {
    const r = canvas.getBoundingClientRect();
    const p = (e.touches && e.touches[0]) || e;
    return { x: p.clientX - r.left, y: p.clientY - r.top };
  }
  function moveTo(p) {
    balloon.x = Math.max(balloon.r, Math.min(W - balloon.r, p.x));
    balloon.y = Math.max(balloon.r, Math.min(H - balloon.r, p.y));
  }
  function onDown(e) {
    e.preventDefault();
    if (state === 'ready') { startGame(); return; }
    if (state === 'over') return;
    dragging = true; moveTo(pos(e));
  }
  function onMove(e) {
    if (!dragging || state !== 'playing') return;
    e.preventDefault(); moveTo(pos(e));
  }
  function onUp() { dragging = false; }

  // Pointer Events 已同时覆盖触摸与鼠标，无需再单独绑定 touch 事件
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  document.getElementById('startBtn').addEventListener('click', startGame);
  document.getElementById('retryBtn').addEventListener('click', startGame);

  // ---------- 更新 ----------
  function update(dt) {
    const sp = worldSpeed();
    t += dt;

    // 背景云
    for (const c of clouds) {
      c.y += c.sp * dt;
      if (c.y - 40 > H) { c.y = -40; c.x = Math.random() * W; }
    }

    // 生成栅栏（按下落距离保持间距一致）
    distSinceObs += sp * dt;
    if (distSinceObs >= obsSpacing()) { distSinceObs = 0; spawnObstacle(); }

    // 生成金币
    coinTimer -= dt;
    if (coinTimer <= 0) {
      coinTimer = 0.28 + Math.random() * 0.25;
      const n = 1 + (Math.random() < 0.3 ? 2 : 0);
      for (let i = 0; i < n; i++) spawnCoin(30 + Math.random() * (W - 60), -20 - i * 26);
    }

    // 生成彩色方块（变色 + 免疫）
    powerTimer -= dt;
    if (powerTimer <= 0) { powerTimer = 11 + Math.random() * 6; spawnPower(); }

    // 生成磁铁道具（吸附金币）
    magnetTimer -= dt;
    if (magnetTimer <= 0) { magnetTimer = 16 + Math.random() * 8; spawnMagnet(); }

    // 移动 + 碰撞：栅栏
    for (const o of obstacles) {
      o.y += sp * dt;
      if (balloon.immune <= 0) {
        const overlapY = balloon.y + balloon.r > o.y && balloon.y - balloon.r < o.y + o.h;
        if (overlapY) {
          const inGap = balloon.x - balloon.r >= o.gapX && balloon.x + balloon.r <= o.gapX + o.gapW;
          if (!inGap) { gameOver(); return; }
        }
      }
    }
    obstacles = obstacles.filter(o => o.y < H + 40);

    // 移动 + 收集：金币（磁铁生效时吸附附近金币）
    const MR = Math.min(W, H) * 0.32;
    for (const c of coins) {
      c.y += sp * dt;
      if (balloon.magnet > 0) {
        const dx = balloon.x - c.x, dy = balloon.y - c.y;
        const d = Math.hypot(dx, dy);
        if (d < MR && d > 1) {
          const v = 230 * (1 - d / MR) + 110; // 越近吸力越强
          c.x += dx / d * v * dt;
          c.y += dy / d * v * dt;
        }
      }
      if (!c.got) {
        const dx = c.x - balloon.x, dy = c.y - balloon.y;
        if (dx * dx + dy * dy < (c.r + balloon.r) * (c.r + balloon.r)) {
          c.got = true; score += 5;
        }
      }
    }
    coins = coins.filter(c => !c.got && c.y < H + 40);

    // 移动 + 收集：道具（彩色方块=变色+免疫，磁铁=吸附金币）
    for (const p of powers) {
      p.y += sp * dt; p.t += dt;
      const dx = p.x - balloon.x, dy = p.y - balloon.y;
      if (dx * dx + dy * dy < (p.r + balloon.r) * (p.r + balloon.r)) {
        p.got = true;
        if (p.type === 'magnet') balloon.magnet = 6;  // 磁铁 6 秒
        else balloon.immune = 6;                      // 免疫 6 秒
      }
    }
    powers = powers.filter(p => !p.got && p.y < H + 40);

    // 免疫 / 磁铁 计时
    if (balloon.immune > 0) balloon.immune = Math.max(0, balloon.immune - dt);
    if (balloon.magnet > 0) balloon.magnet = Math.max(0, balloon.magnet - dt);

    // 被动得分（保证难度随时间提升）
    score += dt * 1.5;
    hudScore.textContent = Math.floor(score);

    // 免疫进度条
    if (balloon.immune > 0) {
      immuneBar.style.opacity = '1';
      immuneFill.style.width = (balloon.immune / 6 * 100) + '%';
    } else {
      immuneBar.style.opacity = '0';
    }
    // 磁铁进度条
    if (balloon.magnet > 0) {
      magnetBar.style.opacity = '1';
      magnetFill.style.width = (balloon.magnet / 6 * 100) + '%';
    } else {
      magnetBar.style.opacity = '0';
    }

    if (flash > 0) flash = Math.max(0, flash - dt * 2);
  }

  // ---------- 绘制 ----------
  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#7ec8ff');
    g.addColorStop(0.5, '#aee0ff');
    g.addColorStop(1, '#e8f6ff');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // 云
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    for (const c of clouds) {
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, 34 * c.s, 20 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x + 26 * c.s, c.y + 6 * c.s, 24 * c.s, 15 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(c.x - 26 * c.s, c.y + 6 * c.s, 22 * c.s, 14 * c.s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // 图片按最大边界等比缩放，保持原图比例
  function drawImgFit(img, cx, cy, maxW, maxH) {
    if (!img || !img.complete || !img.naturalWidth) return;
    const ratio = Math.min(maxW / img.width, maxH / img.height);
    const w = img.width * ratio, h = img.height * ratio;
    ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  }

  function drawFence(o) {
    const drawSeg = (x, w) => {
      if (w <= 0) return;
      const img = IMG.fence;
      if (img && img.complete && img.naturalWidth) {
        // 单行：按整数个平铺（tileW 与生成时一致，缺口两侧均为整块），纵向仅一行
        const rowH = o.h;
        const tileW = o.tileW || rowH;
        let px = x;
        while (px < x + w - 0.5) {
          const tw = Math.min(tileW, x + w - px);
          ctx.drawImage(img, px, o.y, tw, rowH);
          px += tileW;
        }
      } else {
        const g = ctx.createLinearGradient(0, o.y, 0, o.y + o.h);
        g.addColorStop(0, '#ff6b5e');
        g.addColorStop(1, '#d8362c');
        ctx.fillStyle = g;
        ctx.fillRect(x, o.y, w, o.h);
        ctx.strokeStyle = 'rgba(120,20,15,.45)';
        ctx.lineWidth = 2;
        for (let px = x + 6; px < x + w; px += 14) {
          ctx.beginPath(); ctx.moveTo(px, o.y + 2); ctx.lineTo(px, o.y + o.h - 2); ctx.stroke();
        }
        ctx.fillStyle = 'rgba(255,255,255,.35)';
        ctx.fillRect(x, o.y, w, 3);
        ctx.fillStyle = 'rgba(0,0,0,.18)';
        ctx.fillRect(x, o.y + o.h - 3, w, 3);
      }
    };
    drawSeg(0, o.gapX);
    drawSeg(o.gapX + o.gapW, W - (o.gapX + o.gapW));
  }

  function drawCoin(c) {
    drawImgFit(IMG.coin, c.x, c.y, c.r * 2, c.r * 2);
    if (IMG.coin && IMG.coin.complete) return;
    const g = ctx.createRadialGradient(c.x - c.r * 0.3, c.y - c.r * 0.3, c.r * 0.2, c.x, c.y, c.r);
    g.addColorStop(0, '#fff3b0'); g.addColorStop(0.5, '#ffd24d'); g.addColorStop(1, '#e6a017');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(180,120,0,.6)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.beginPath(); ctx.arc(c.x - c.r * 0.3, c.y - c.r * 0.3, c.r * 0.22, 0, Math.PI * 2); ctx.fill();
  }

  function drawPower(p) {
    // 彩色方块是 GIF：用 DOM <img> 显示动画（canvas 绘制在 iOS Safari 上不会动画）
    if (IMG.power && IMG.power.complete) return;
    const pulse = 1 + Math.sin(p.t * 6) * 0.12;
    const r = p.r * pulse;
    // 光晕
    const glow = ctx.createRadialGradient(p.x, p.y, r * 0.3, p.x, p.y, r * 1.8);
    glow.addColorStop(0, 'rgba(255,255,255,.9)');
    glow.addColorStop(0.4, 'rgba(180,120,255,.5)');
    glow.addColorStop(1, 'rgba(180,120,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.8, 0, Math.PI * 2); ctx.fill();
    // 球体（彩虹）
    const g = ctx.createLinearGradient(p.x - r, p.y - r, p.x + r, p.y + r);
    g.addColorStop(0, '#ff5d5d'); g.addColorStop(0.25, '#ffd24d');
    g.addColorStop(0.5, '#5dff8f'); g.addColorStop(0.75, '#5db8ff'); g.addColorStop(1, '#c45dff');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    // 闪电符号
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(p.x + r * 0.18, p.y - r * 0.55);
    ctx.lineTo(p.x - r * 0.35, p.y + r * 0.12);
    ctx.lineTo(p.x - r * 0.02, p.y + r * 0.12);
    ctx.lineTo(p.x - r * 0.18, p.y + r * 0.55);
    ctx.lineTo(p.x + r * 0.38, p.y - r * 0.18);
    ctx.lineTo(p.x + r * 0.02, p.y - r * 0.18);
    ctx.closePath(); ctx.fill();
  }

  function drawMagnet(p) {
    // 占位绘制（程序绘制），后续可替换为 IMG.magnet 图片
    drawImgFit(IMG.magnet, p.x, p.y, p.r * 2.2, p.r * 2.2);
    if (IMG.magnet && IMG.magnet.complete) return;
    const pulse = 1 + Math.sin(p.t * 6) * 0.1;
    const r = p.r * pulse;
    const glow = ctx.createRadialGradient(p.x, p.y, r * 0.3, p.x, p.y, r * 1.8);
    glow.addColorStop(0, 'rgba(120,220,255,.9)');
    glow.addColorStop(1, 'rgba(120,220,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.8, 0, Math.PI * 2); ctx.fill();
    // 磁铁造型（U 形 + 两极高光）
    ctx.fillStyle = '#39c6ff';
    ctx.beginPath();
    ctx.arc(p.x, p.y - r * 0.2, r * 0.9, Math.PI, 0, false);
    ctx.lineTo(p.x + r * 0.9, p.y + r * 0.5);
    ctx.lineTo(p.x + r * 0.3, p.y + r * 0.5);
    ctx.lineTo(p.x + r * 0.3, p.y + r * 0.05);
    ctx.lineTo(p.x - r * 0.3, p.y + r * 0.05);
    ctx.lineTo(p.x - r * 0.3, p.y + r * 0.5);
    ctx.lineTo(p.x - r * 0.9, p.y + r * 0.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#ff5d5d';
    ctx.fillRect(p.x - r * 0.9, p.y + r * 0.5, r * 0.6, r * 0.35);
    ctx.fillStyle = '#dfe9ef';
    ctx.fillRect(p.x + r * 0.3, p.y + r * 0.5, r * 0.6, r * 0.35);
  }

  function drawBalloon() {
    const x = balloon.x, y = balloon.y, r = balloon.r;
    const immune = balloon.immune > 0;

    // 磁铁光环（青色）
    if (balloon.magnet > 0) {
      const a = 0.30 + Math.sin(t * 8) * 0.12;
      const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.2);
      glow.addColorStop(0, 'rgba(120,220,255,' + a + ')');
      glow.addColorStop(1, 'rgba(120,220,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, Math.PI * 2); ctx.fill();
    }

    // 免疫光环
    if (immune) {
      const a = 0.35 + Math.sin(t * 10) * 0.15;
      const glow = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.2);
      glow.addColorStop(0, 'rgba(255,255,255,' + a + ')');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, Math.PI * 2); ctx.fill();
    }

    if (IMG.balloon && IMG.balloon.complete) {
      // 用 DOM <img> 显示动画 GIF（canvas 绘制在 iOS Safari 上不会动画）
      positionBalloonImg(x, y, r, immune);
      if (immune) {
        ctx.save();
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'hsl(' + ((t * 240) % 360) + ',90%,62%)';
        ctx.beginPath(); ctx.arc(x, y, r * 1.5, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      return;
    }
    balloonImg.style.display = 'none'; // 兜底程序绘制时隐藏 DOM 图

    const top = y - r * 1.25, bh = r * 2; // 球体
    // 球体（分瓣）
    const segs = 6;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2 - Math.PI / 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.ellipse(x, top + r, r, r, 0, a0, a1);
      ctx.lineTo(x, top + r);
      ctx.closePath();
      if (immune) {
        const hue = (i / segs) * 360 + t * 60;
        ctx.fillStyle = 'hsl(' + hue + ',85%,60%)';
      } else {
        ctx.fillStyle = (i % 2 === 0) ? '#e9edf2' : '#c7ced8'; // 灰白色
      }
      ctx.fill();
    }
    // 球体描边
    ctx.strokeStyle = immune ? 'rgba(255,255,255,.9)' : 'rgba(120,130,145,.6)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(x, top + r, r, r, 0, 0, Math.PI * 2); ctx.stroke();

    // 吊绳
    ctx.strokeStyle = 'rgba(90,90,90,.7)'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.5, top + r * 1.9); ctx.lineTo(x - r * 0.32, y + r * 0.55);
    ctx.moveTo(x + r * 0.5, top + r * 1.9); ctx.lineTo(x + r * 0.32, y + r * 0.55);
    ctx.stroke();
    // 吊篮
    ctx.fillStyle = immune ? '#caa15a' : '#9a6b3a';
    ctx.beginPath();
    ctx.moveTo(x - r * 0.34, y + r * 0.55);
    ctx.lineTo(x + r * 0.34, y + r * 0.55);
    ctx.lineTo(x + r * 0.26, y + r * 0.95);
    ctx.lineTo(x - r * 0.26, y + r * 0.95);
    ctx.closePath(); ctx.fill();
  }

  function render() {
    drawBackground();
    for (const o of obstacles) drawFence(o);
    for (const c of coins) drawCoin(c);
    const powerItems = [];
    for (const p of powers) {
      if (p.type === 'magnet') drawMagnet(p);
      else { drawPower(p); powerItems.push(p); }
    }
    syncPowerImgs(powerItems);
    if (state !== 'ready') drawBalloon();
    else balloonImg.style.display = 'none';

    if (flash > 0) {
      ctx.fillStyle = 'rgba(255,40,40,' + (flash * 0.4) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  // ---------- 主循环 ----------
  let last = 0;
  function loop(ts) {
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0);
    last = ts;
    if (state === 'playing') update(dt);
    else t += dt; // 让背景/动画在菜单也动起来
    render();
    requestAnimationFrame(loop);
  }

  resize();
  initClouds();
  requestAnimationFrame(loop);
})();
