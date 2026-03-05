/**
 * ============================================================
 *  AERIS — 2D Platformer  |  game.js
 * ============================================================
 */
'use strict';

/* ============================================================
   CONSTANTS
   ============================================================ */
const CANVAS_W   = 1280;
const CANVAS_H   = 720;
const GRAVITY    = 1800;
const FRICTION   = 0.78;
const MOVE_SPEED = 480;
const JUMP_FORCE = -680;

/* ============================================================
   CHARACTER ROSTER
   Sprite sheets are pre-processed PNGs with transparent backgrounds.
   frameW / frameH are the exact pixel dimensions of ONE frame cell.
   ============================================================ */
const CHARACTERS = [
  {
    id:    'aeris',
    name:  'Aeris',
    class: 'Blade Wanderer',
    sheets: {
      idle: 'Aeris_idle_v2.png',
      run:  'Aeris_run_v2.png',
      jump: 'Aeris_jump_v2.png',
    },
    animations: {
      //           frameCount  frameW  frameH  frameRate  loop
      idle: { n:12, fw:128, fh:508, fps:15, loop:true  },
      run:  { n:8,  fw:192, fh:628, fps:18, loop:true  },
      jump: { n:9,  fw:170, fh:722, fps:14, loop:false },
    },
    targetHeight: 600,   // rendered height in canvas pixels
    feetOffsetY:  0.998, // feet are at the very bottom of the frame
  },
];

/* ============================================================
   IMAGE LOADER
   ============================================================ */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img   = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Cannot load: ' + src));
    img.src     = src;
  });
}

/* ============================================================
   ANIMATION CLASS
   Drives a horizontal sprite sheet: each frame is a fixed-width
   column. drawImage uses exact source rects — no drift possible.
   ============================================================ */
class Animation {
  /**
   * @param {HTMLImageElement} sheet  - The loaded sprite sheet
   * @param {object}           cfg   - { n, fw, fh, fps, loop }
   */
  constructor(sheet, cfg) {
    this.sheet  = sheet;
    this.n      = cfg.n;      // frame count
    this.fw     = cfg.fw;     // frame width  (px in sheet)
    this.fh     = cfg.fh;     // frame height (px in sheet)
    this.fps    = cfg.fps;    // playback speed
    this.loop   = cfg.loop;

    this.frame    = 0;
    this.elapsed  = 0;
    this.finished = false;
  }

  reset() {
    this.frame    = 0;
    this.elapsed  = 0;
    this.finished = false;
  }

  update(dt) {
    if (this.finished) return;
    this.elapsed += dt;
    const dur = 1 / this.fps;
    // Advance exactly one frame per update — no multi-skip on dt spikes
    if (this.elapsed >= dur) {
      this.elapsed -= dur;
      if (this.elapsed > dur) this.elapsed = 0; // absorb any spike remainder
      this.frame++;
      if (this.frame >= this.n) {
        if (this.loop) {
          this.frame = 0;
        } else {
          this.frame    = this.n - 1;
          this.finished = true;
        }
      }
    }
  }

  /**
   * Draw current frame centred on (x) with feet at (y).
   * @param {CanvasRenderingContext2D} ctx
   * @param {number}  x         centre-x on canvas
   * @param {number}  y         feet-y on canvas
   * @param {number}  targetH   desired rendered height in canvas px
   * @param {number}  feetFrac  fraction of frame height above feet
   * @param {boolean} flipX
   */
  draw(ctx, x, y, targetH, feetFrac, flipX) {
    const scale = targetH / this.fh;
    const dw    = Math.round(this.fw * scale);
    const dh    = Math.round(this.fh * scale);
    const dx    = Math.round(x - dw / 2);
    const dy    = Math.round(y - dh * feetFrac);

    // Source rect: exactly one frame column, row 0
    const sx = this.frame * this.fw;
    const sy = 0;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (flipX) {
      ctx.translate(x, 0);
      ctx.scale(-1, 1);
      ctx.translate(-x, 0);
    }
    ctx.drawImage(this.sheet, sx, sy, this.fw, this.fh, dx, dy, dw, dh);
    ctx.restore();
  }
}

/* ============================================================
   PLAYER
   ============================================================ */
class Player {
  constructor(charDef, anims, x, y) {
    this.def   = charDef;
    this.anims = anims;   // { idle, run, jump } — Animation instances
    this.x     = x;
    this.y     = y;
    this.vx    = 0;
    this.vy    = 0;

    this.onGround    = false;
    this.facingRight = true;
    this.curAnim     = 'idle';
    this.anims.idle.reset();

    this.halfW = 22;
    this.halfH = 50;
  }

  setAnim(name) {
    if (this.curAnim === name) return;
    this.curAnim = name;
    this.anims[name].reset();
  }

  update(dt, input, stage) {
    /* Horizontal */
    if (input.left) {
      this.vx -= MOVE_SPEED * dt * 8;
      this.facingRight = false;
    } else if (input.right) {
      this.vx += MOVE_SPEED * dt * 8;
      this.facingRight = true;
    } else if (this.onGround) {
      this.vx *= Math.pow(FRICTION, dt * 60);
    }
    this.vx = Math.max(-MOVE_SPEED, Math.min(MOVE_SPEED, this.vx));

    /* Jump */
    if (input.jumpPressed && this.onGround) {
      this.vy = JUMP_FORCE;
      this.onGround = false;
      this.anims.jump.reset();
    }
    input.jumpPressed = false;

    /* Gravity + integrate */
    this.vy += GRAVITY * dt;
    this.x  += this.vx  * dt;
    this.y  += this.vy  * dt;

    /* Collision */
    this.onGround = false;
    stage.resolveCollision(this);

    /* Wrap */
    if (this.x < -50)           this.x = CANVAS_W + 50;
    if (this.x > CANVAS_W + 50) this.x = -50;

    /* Respawn */
    if (this.y > CANVAS_H + 200) {
      this.x = CANVAS_W / 2;
      this.y = stage.platformY - 10;
      this.vx = this.vy = 0;
    }

    /* Animation state machine */
    if (!this.onGround) {
      this.setAnim('jump');
    } else if (Math.abs(this.vx) > 18) {
      this.setAnim('run');
    } else {
      this.setAnim('idle');
    }

    this.anims[this.curAnim].update(dt);
  }

  draw(ctx) {
    const a = this.anims[this.curAnim];
    a.draw(ctx, this.x, this.y,
           this.def.targetHeight, this.def.feetOffsetY,
           !this.facingRight);
  }
}

/* ============================================================
   STAGE
   ============================================================ */
class Stage {
  constructor(w, h) {
    this.canvasW    = w;
    this.canvasH    = h;
    this.platformW  = 820;
    this.platformH  = 28;
    this.platformX  = (w - 820) / 2;
    this.platformY  = h - 160;
    this.stars      = this._makeStars(160);
    this.orbs       = this._makeOrbs(6);
    this.time       = 0;
  }

  _makeStars(n) {
    return Array.from({length:n}, () => ({
      x:  Math.random() * CANVAS_W,
      y:  Math.random() * CANVAS_H * 0.75,
      r:  Math.random() * 1.4 + 0.3,
      a:  Math.random(),
      da: (Math.random() * 0.6 + 0.2) * (Math.random() < 0.5 ? 1 : -1),
    }));
  }

  _makeOrbs(n) {
    return Array.from({length:n}, () => ({
      x:   Math.random() * CANVAS_W,
      y:   Math.random() * CANVAS_H * 0.65 + 40,
      r:   Math.random() * 70 + 30,
      vx:  (Math.random() - 0.5) * 18,
      vy:  (Math.random() - 0.5) * 6,
      hue: Math.random() * 60 + 220,
      a:   Math.random() * 0.07 + 0.02,
    }));
  }

  update(dt) {
    this.time += dt;
    for (const s of this.stars) {
      s.a += s.da * dt;
      if (s.a > 1 || s.a < 0) { s.da *= -1; s.a = Math.max(0, Math.min(1, s.a)); }
    }
    for (const o of this.orbs) {
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (o.x < -100)            o.x = CANVAS_W + 100;
      if (o.x > CANVAS_W + 100)  o.x = -100;
      if (o.y < -60)             o.y = CANVAS_H * 0.7;
      if (o.y > CANVAS_H * 0.7)  o.y = -60;
    }
  }

  resolveCollision(player) {
    const { platformX:px, platformY:py, platformW:pw } = this;
    if (player.x + player.halfW > px &&
        player.x - player.halfW < px + pw &&
        player.vy >= 0 &&
        player.y >= py &&
        player.y - player.vy * 0.016 < py + 5) {
      player.y       = py;
      player.vy      = 0;
      player.onGround = true;
    }
  }

  drawBackground(ctx) {
    const t   = this.time;
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0,   `hsl(${230 + Math.sin(t*0.1)*8},55%,7%)`);
    sky.addColorStop(0.5, `hsl(${245 + Math.sin(t*0.07)*5},40%,11%)`);
    sky.addColorStop(1,   `hsl(260,30%,6%)`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    for (const o of this.orbs) {
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
      g.addColorStop(0, `hsla(${o.hue},70%,70%,${o.a})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI*2); ctx.fill();
    }

    ctx.globalAlpha = 1;
    for (const s of this.stars) {
      ctx.globalAlpha = s.a * 0.9;
      ctx.fillStyle   = '#d8e8ff';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;

    const hz = ctx.createLinearGradient(0, CANVAS_H*0.5, 0, CANVAS_H*0.75);
    hz.addColorStop(0,   'rgba(80,60,160,0.0)');
    hz.addColorStop(0.5, 'rgba(80,60,160,0.07)');
    hz.addColorStop(1,   'rgba(30,20,80,0.0)');
    ctx.fillStyle = hz;
    ctx.fillRect(0, CANVAS_H*0.5, CANVAS_W, CANVAS_H*0.25);
  }

  drawPlatform(ctx) {
    const { platformX:px, platformY:py, platformW:pw, platformH:ph } = this;
    const r = 10;

    const glow = ctx.createLinearGradient(0, py, 0, py+ph+60);
    glow.addColorStop(0,   'rgba(140,100,220,0.22)');
    glow.addColorStop(0.4, 'rgba(100,80,200,0.10)');
    glow.addColorStop(1,   'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(px-40, py, pw+80, 80);

    ctx.shadowColor = 'rgba(100,80,200,0.55)';
    ctx.shadowBlur  = 24;
    ctx.beginPath();
    ctx.moveTo(px+r, py);
    ctx.lineTo(px+pw-r, py);    ctx.quadraticCurveTo(px+pw, py,    px+pw, py+r);
    ctx.lineTo(px+pw, py+ph-r); ctx.quadraticCurveTo(px+pw, py+ph, px+pw-r, py+ph);
    ctx.lineTo(px+r, py+ph);    ctx.quadraticCurveTo(px,    py+ph, px,    py+ph-r);
    ctx.lineTo(px, py+r);       ctx.quadraticCurveTo(px,    py,    px+r,  py);
    ctx.closePath();

    const body = ctx.createLinearGradient(0, py, 0, py+ph);
    body.addColorStop(0, '#2a2440');
    body.addColorStop(1, '#1a1630');
    ctx.fillStyle = body; ctx.fill();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(180,150,255,0.55)';
    ctx.lineWidth   = 2;
    ctx.beginPath(); ctx.moveTo(px+r, py+1); ctx.lineTo(px+pw-r, py+1); ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth   = 1;
    for (let lx = px+60; lx < px+pw-40; lx += 60) {
      ctx.beginPath(); ctx.moveTo(lx, py+4); ctx.lineTo(lx, py+ph-4); ctx.stroke();
    }
  }
}

/* ============================================================
   INPUT
   ============================================================ */
class InputManager {
  constructor() {
    this.keys        = {};
    this.jumpPressed = false;
    window.addEventListener('keydown', e => {
      if (!this.keys[e.code] &&
          (e.code==='Space'||e.code==='ArrowUp'||e.code==='KeyW'))
        this.jumpPressed = true;
      this.keys[e.code] = true;
      if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))
        e.preventDefault();
    });
    window.addEventListener('keyup', e => { this.keys[e.code] = false; });
  }
  get left()  { return !!(this.keys['ArrowLeft']  || this.keys['KeyA']); }
  get right() { return !!(this.keys['ArrowRight'] || this.keys['KeyD']); }
  get jump()  { return !!(this.keys['Space'] || this.keys['ArrowUp'] || this.keys['KeyW']); }
}

/* ============================================================
   GAME LOOP
   ============================================================ */
class Game {
  constructor(canvas) {
    this.canvas   = canvas;
    this.ctx      = canvas.getContext('2d');
    this.stage    = new Stage(CANVAS_W, CANVAS_H);
    this.input    = new InputManager();
    this.player   = null;
    this.lastTime = null;
    this._rafId   = null;
  }

  start(player) {
    this.player   = player;
    this.lastTime = performance.now();
    this._loop(this.lastTime);
  }

  _loop(ts) {
    this._rafId = requestAnimationFrame(t => this._loop(t));
    const dt    = this.lastTime === null ? 0
                  : Math.min((ts - this.lastTime) / 1000, 0.033);
    this.lastTime = ts;
    this.stage.update(dt);
    this.player.update(dt, this.input, this.stage);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.stage.drawBackground(ctx);
    this.stage.drawPlatform(ctx);
    this.player.draw(ctx);
  }

  stop() { if (this._rafId) cancelAnimationFrame(this._rafId); }
}

/* ============================================================
   CHARACTER SELECT
   ============================================================ */
class CharacterSelectScreen {
  constructor(container, onSelect) {
    this.container    = container;
    this.onSelect     = onSelect;
    this._previews    = {};
    this._rafId       = null;
    this._render();
    this._previewLoop();
  }

  _render() {
    this.container.innerHTML = '';
    for (const char of CHARACTERS) {
      const card     = document.createElement('div');
      card.className = 'char-card';
      card.dataset.id = char.id;

      const portrait = document.createElement('div');
      portrait.className = 'card-portrait';
      const cvs = document.createElement('canvas');
      cvs.width = 220; cvs.height = 220;
      portrait.appendChild(cvs);

      const info = document.createElement('div');
      info.className = 'card-info';
      info.innerHTML = `<div class="card-name">${char.name}</div>
                        <div class="card-class">${char.class}</div>`;

      card.appendChild(portrait);
      card.appendChild(info);
      this.container.appendChild(card);

      // Load idle sheet for preview
      loadImage(char.sheets.idle).then(sheet => {
        const cfg  = char.animations.idle;
        const anim = new Animation(sheet, cfg);
        this._previews[char.id] = { anim, cvs, ctx: cvs.getContext('2d'), char };
      });

      card.addEventListener('click', () => this.onSelect(char));
    }
  }

  _previewLoop() {
    let last = null;
    const loop = ts => {
      this._rafId = requestAnimationFrame(loop);
      const dt = last === null ? 0 : Math.min((ts - last) / 1000, 0.033);
      last = ts;

      for (const { anim, cvs, ctx } of Object.values(this._previews)) {
        anim.update(dt);
        ctx.clearRect(0, 0, cvs.width, cvs.height);
        const scale = (cvs.height * 0.82) / anim.fh;
        const dw    = Math.round(anim.fw * scale);
        const dh    = Math.round(anim.fh * scale);
        const dx    = Math.round((cvs.width - dw) / 2);
        const dy    = cvs.height - dh - 8;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(anim.sheet,
          anim.frame * anim.fw, 0, anim.fw, anim.fh,
          dx, dy, dw, dh);
      }
    };
    this._rafId = requestAnimationFrame(loop);
  }

  destroy() { if (this._rafId) cancelAnimationFrame(this._rafId); }
}

/* ============================================================
   BOOTSTRAP
   ============================================================ */
(function bootstrap() {
  const canvas  = document.getElementById('gameCanvas');
  canvas.width  = CANVAS_W;
  canvas.height = CANVAS_H;

  function resize() {
    const s = Math.min(window.innerWidth / CANVAS_W, window.innerHeight / CANVAS_H);
    canvas.style.width  = CANVAS_W * s + 'px';
    canvas.style.height = CANVAS_H * s + 'px';
  }
  resize();
  window.addEventListener('resize', resize);

  const selectScreen = document.getElementById('select-screen');
  const gameScreen   = document.getElementById('game-screen');
  const cardGrid     = document.getElementById('card-grid');

  const selectUI = new CharacterSelectScreen(cardGrid, async charDef => {
    selectScreen.classList.add('fade-out');

    let sheets;
    try {
      sheets = {
        idle: await loadImage(charDef.sheets.idle),
        run:  await loadImage(charDef.sheets.run),
        jump: await loadImage(charDef.sheets.jump),
      };
    } catch (err) {
      console.error('Sprite load failed:', err);
      selectScreen.classList.remove('fade-out');
      return;
    }

    const anims = {};
    for (const [key, cfg] of Object.entries(charDef.animations)) {
      anims[key] = new Animation(sheets[key], cfg);
    }

    const stage  = new Stage(CANVAS_W, CANVAS_H);
    const player = new Player(charDef, anims, CANVAS_W / 2, stage.platformY);

    setTimeout(() => {
      selectScreen.classList.add('hidden');
      gameScreen.classList.remove('hidden');
      gameScreen.classList.add('fade-in');
      selectUI.destroy();
      const game = new Game(canvas);
      game.stage = stage;
      game.start(player);
    }, 500);
  });
})();
