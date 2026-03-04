/**
 * ============================================================
 *  AERIS — 2D Platformer
 *  game.js — All game logic, animation, physics, rendering
 * ============================================================
 */

'use strict';

/* ============================================================
   CONSTANTS
   ============================================================ */
const CANVAS_W = 1280;
const CANVAS_H = 720;
const GRAVITY   = 1800;   // px/s²
const FRICTION  = 0.78;   // applied when on ground and no input
const MOVE_SPEED = 480;   // px/s max horizontal speed
const JUMP_FORCE = -680;  // px/s initial jump velocity

/* ============================================================
   CHARACTER ROSTER
   Each entry fully describes one character.
   Add more entries here to extend the roster.
   ============================================================ */
const CHARACTERS = [
  {
    id: 'aeris',
    name: 'Aeris',
    class: 'Blade Wanderer',
    // Each animation lists individual pre-cropped, transparent PNG frames.
    // This avoids all sprite-sheet coordinate math (no frameW/sheetY bugs).
    animations: {
      idle: {
        frames: Array.from({length: 12}, (_, i) => `aeris_idle/aeris_idle_${String(i).padStart(2,'0')}.png`),
        frameRate: 8, loop: true,
      },
      run: {
        frames: Array.from({length: 8},  (_, i) => `aeris_run/aeris_run_${String(i).padStart(2,'0')}.png`),
        frameRate: 12, loop: true,
      },
      jump: {
        frames: Array.from({length: 9},  (_, i) => `aeris_jump/aeris_jump_${String(i).padStart(2,'0')}.png`),
        frameRate: 10, loop: false,
      },
    },
    // Aeris renders at this height in game pixels; scale is derived per-frame
    // so she stays the same size regardless of individual frame dimensions.
    targetHeight: 160,
    feetOffsetY:  0.88,
  },
];

/* ============================================================
   ANIMATION CLASS
   Frame-array based: each frame is a separate pre-cropped Image.
   No sprite-sheet coordinate math — eliminates sheetY/frameW bugs entirely.
   ============================================================ */
class Animation {
  /**
   * @param {HTMLImageElement[]} images  - Array of per-frame images (already loaded)
   * @param {object} config              - { frameRate, loop }
   */
  constructor(images, config) {
    this.images       = images;         // one Image per frame
    this.frameCount   = images.length;
    this.frameRate    = config.frameRate;
    this.loop         = config.loop;

    this.currentFrame = 0;
    this.elapsed      = 0;
    this.finished     = false;
  }

  /** Convenience: current frame image */
  get image() { return this.images[this.currentFrame]; }

  /** Width/height of the current frame image */
  get frameW() { return this.images[this.currentFrame].naturalWidth  || this.images[this.currentFrame].width; }
  get frameH() { return this.images[this.currentFrame].naturalHeight || this.images[this.currentFrame].height; }

  /** Advance animation by deltaTime seconds */
  update(dt) {
    if (this.finished) return;

    this.elapsed += dt;
    const frameDuration = 1 / this.frameRate;

    while (this.elapsed >= frameDuration) {
      this.elapsed -= frameDuration;
      this.currentFrame++;

      if (this.currentFrame >= this.frameCount) {
        if (this.loop) {
          this.currentFrame = 0;
        } else {
          this.currentFrame = this.frameCount - 1;
          this.finished = true;
          break;
        }
      }
    }
  }

  /** Reset to first frame */
  reset() {
    this.currentFrame = 0;
    this.elapsed      = 0;
    this.finished     = false;
  }

  /**
   * Draw the current frame onto a canvas context.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} x        - destination centre-x
   * @param {number} y        - destination feet-y
   * @param {number} scale    - pixels-per-source-pixel
   * @param {boolean} flipX   - mirror horizontally
   * @param {number} feetOffY - fraction of frame height above feet anchor
   */
  draw(ctx, x, y, scale, flipX, feetOffY = 0.88) {
    const img = this.images[this.currentFrame];
    const sw  = img.naturalWidth  || img.width;
    const sh  = img.naturalHeight || img.height;
    const dw  = Math.round(sw * scale);
    const dh  = Math.round(sh * scale);
    const dx  = Math.round(x - dw / 2);
    const dy  = Math.round(y - dh * feetOffY);

    ctx.save();
    if (flipX) {
      ctx.translate(x, 0);
      ctx.scale(-1, 1);
      ctx.translate(-x, 0);
    }
    // Simple full-image draw — no sheet coordinate math needed
    ctx.drawImage(img, 0, 0, sw, sh, dx, dy, dw, dh);
    ctx.restore();
  }
}

/* ============================================================
   IMAGE LOADER
   Loads a single PNG and returns a Promise<HTMLImageElement>.
   ============================================================ */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load: ${src}`));
    img.src = src;
  });
}

/**
 * Loads all frame images for one animation definition.
 * @param {object} animDef  - { frames: string[], frameRate, loop }
 * @returns {Promise<Animation>}
 */
async function loadAnimation(animDef) {
  const images = await Promise.all(animDef.frames.map(loadImage));
  return new Animation(images, animDef);
}

/**
 * Loads all animations for a character definition.
 * @param {object} charDef  - entry from CHARACTERS
 * @returns {Promise<object>}  { idle: Animation, run: Animation, jump: Animation }
 */
async function loadCharacterAnimations(charDef) {
  const result = {};
  for (const [key, animDef] of Object.entries(charDef.animations)) {
    result[key] = await loadAnimation(animDef);
  }
  return result;
}

/* ============================================================
   PLAYER CLASS
   ============================================================ */
class Player {
  /**
   * @param {object} charDef   - Entry from CHARACTERS array
   * @param {object} images    - { idle: HTMLImageElement, run: ..., jump: ... }
   * @param {number} x         - starting x
   * @param {number} y         - starting y (feet)
   */
  constructor(charDef, images, x, y) {
    this.charDef = charDef;
    this.x = x;
    this.y = y;

    this.vx = 0;
    this.vy = 0;

    this.onGround   = false;
    this.facingRight = true;

    // animations is already a { idle, run, jump } map of Animation instances
    this.animations  = images;  // renamed parameter, contains Animation objects
    this.currentAnim = 'idle';
    this.animations.idle.reset();

    // Collision box (relative to feet centre)
    this.halfW = 22;  // half-width of hitbox in px
    this.halfH = 50;  // half-height of hitbox in px (above feet)
  }

  /** Switch to a named animation, resetting if it changed */
  setAnimation(name) {
    if (this.currentAnim === name) return;
    this.currentAnim = name;
    this.animations[name].reset();
  }

  /** Per-frame update: physics + input + animation state machine */
  update(dt, input, stage) {
    /* ---- Horizontal movement ---- */
    if (input.left) {
      this.vx -= MOVE_SPEED * dt * 8;
      this.facingRight = false;
    } else if (input.right) {
      this.vx += MOVE_SPEED * dt * 8;
      this.facingRight = true;
    } else if (this.onGround) {
      // Apply friction when no horizontal input and on ground
      this.vx *= Math.pow(FRICTION, dt * 60);
    }

    // Clamp horizontal speed
    this.vx = Math.max(-MOVE_SPEED, Math.min(MOVE_SPEED, this.vx));

    /* ---- Jump ---- */
    if (input.jumpPressed && this.onGround) {
      this.vy = JUMP_FORCE;
      this.onGround = false;
      // Reset jump anim so it always plays from frame 0 on each new jump
      this.animations.jump.reset();
    }
    input.jumpPressed = false; // Consume the press

    /* ---- Gravity ---- */
    this.vy += GRAVITY * dt;

    /* ---- Integrate position ---- */
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    /* ---- Stage collision ---- */
    this.onGround = false;
    stage.resolveCollision(this);

    /* ---- Wrap at screen edges (no walls) ---- */
    if (this.x < -50)        this.x = CANVAS_W + 50;
    if (this.x > CANVAS_W + 50) this.x = -50;

    // If fallen below screen, respawn
    if (this.y > CANVAS_H + 200) {
      this.x = CANVAS_W / 2;
      this.y = stage.platformY - 10;
      this.vx = 0;
      this.vy = 0;
    }

    /* ---- Animation state machine ---- */
    if (!this.onGround) {
      this.setAnimation('jump');
    } else if (Math.abs(this.vx) > 18) {
      this.setAnimation('run');
    } else {
      this.setAnimation('idle');
    }

    this.animations[this.currentAnim].update(dt);
  }

  /** Render the current animation frame */
  draw(ctx) {
    const anim  = this.animations[this.currentAnim];
    // Compute scale from targetHeight so all frames render at the same size
    const scale = this.charDef.targetHeight / anim.frameH;
    const flip  = !this.facingRight;
    anim.draw(ctx, this.x, this.y, scale, flip, this.charDef.feetOffsetY);
  }
}

/* ============================================================
   STAGE CLASS — "Final Destination" style single platform
   ============================================================ */
class Stage {
  constructor(canvasW, canvasH) {
    this.canvasW = canvasW;
    this.canvasH = canvasH;

    // Platform dimensions
    this.platformW = 820;
    this.platformH = 28;
    this.platformX = (canvasW - 820) / 2;
    this.platformY = canvasH - 160;   // top surface Y

    // Background star layer
    this.stars = this._makeStars(160);

    // Animated cloud/orb floats for depth
    this.orbs = this._makeOrbs(6);

    // Sky gradient time offset
    this.time = 0;
  }

  _makeStars(count) {
    const arr = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        x:  Math.random() * CANVAS_W,
        y:  Math.random() * CANVAS_H * 0.75,
        r:  Math.random() * 1.4 + 0.3,
        a:  Math.random(),
        da: (Math.random() * 0.6 + 0.2) * (Math.random() < 0.5 ? 1 : -1),
      });
    }
    return arr;
  }

  _makeOrbs(count) {
    const arr = [];
    for (let i = 0; i < count; i++) {
      arr.push({
        x:  Math.random() * CANVAS_W,
        y:  Math.random() * CANVAS_H * 0.65 + 40,
        r:  Math.random() * 70 + 30,
        vx: (Math.random() - 0.5) * 18,
        vy: (Math.random() - 0.5) * 6,
        hue: Math.random() * 60 + 220,  // blue-purple range
        a:  Math.random() * 0.07 + 0.02,
      });
    }
    return arr;
  }

  update(dt) {
    this.time += dt;

    // Twinkle stars
    for (const s of this.stars) {
      s.a += s.da * dt;
      if (s.a > 1 || s.a < 0) {
        s.da *= -1;
        s.a = Math.max(0, Math.min(1, s.a));
      }
    }

    // Drift orbs
    for (const o of this.orbs) {
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      if (o.x < -100) o.x = CANVAS_W + 100;
      if (o.x > CANVAS_W + 100) o.x = -100;
      if (o.y < -60)  o.y = CANVAS_H * 0.7;
      if (o.y > CANVAS_H * 0.7) o.y = -60;
    }
  }

  /** Resolve player collision against the platform surface */
  resolveCollision(player) {
    const px = this.platformX;
    const py = this.platformY;
    const pw = this.platformW;

    // Only land if player foot is in platform X range and moving downward
    if (
      player.x + player.halfW > px &&
      player.x - player.halfW < px + pw &&
      player.vy >= 0
    ) {
      // Check if crossing the top surface this frame
      if (player.y >= py && player.y - player.vy * 0.016 < py + 5) {
        player.y  = py;
        player.vy = 0;
        player.onGround = true;
      }
    }
  }

  drawBackground(ctx) {
    // Sky gradient
    const t = this.time;
    const sky = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    sky.addColorStop(0,   `hsl(${230 + Math.sin(t*0.1)*8}, 55%, 7%)`);
    sky.addColorStop(0.5, `hsl(${245 + Math.sin(t*0.07)*5}, 40%, 11%)`);
    sky.addColorStop(1,   `hsl(${260}, 30%, 6%)`);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Slow ambient orbs
    for (const o of this.orbs) {
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
      g.addColorStop(0, `hsla(${o.hue}, 70%, 70%, ${o.a})`);
      g.addColorStop(1, 'transparent');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Stars
    for (const s of this.stars) {
      ctx.globalAlpha = s.a * 0.9;
      ctx.fillStyle = '#d8e8ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Horizon glow
    const hz = ctx.createLinearGradient(0, CANVAS_H * 0.5, 0, CANVAS_H * 0.75);
    hz.addColorStop(0,   'rgba(80,60,160,0.0)');
    hz.addColorStop(0.5, 'rgba(80,60,160,0.07)');
    hz.addColorStop(1,   'rgba(30,20,80,0.0)');
    ctx.fillStyle = hz;
    ctx.fillRect(0, CANVAS_H * 0.5, CANVAS_W, CANVAS_H * 0.25);
  }

  drawPlatform(ctx) {
    const px = this.platformX;
    const py = this.platformY;
    const pw = this.platformW;
    const ph = this.platformH;
    const r  = 10;

    // Glow under platform
    const glow = ctx.createLinearGradient(0, py, 0, py + ph + 60);
    glow.addColorStop(0,   'rgba(140,100,220,0.22)');
    glow.addColorStop(0.4, 'rgba(100,80,200,0.10)');
    glow.addColorStop(1,   'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(px - 40, py, pw + 80, 80);

    // Drop shadow
    ctx.shadowColor = 'rgba(100,80,200,0.55)';
    ctx.shadowBlur  = 24;

    // Platform body — rounded rect
    ctx.beginPath();
    ctx.moveTo(px + r, py);
    ctx.lineTo(px + pw - r, py);
    ctx.quadraticCurveTo(px + pw, py, px + pw, py + r);
    ctx.lineTo(px + pw, py + ph - r);
    ctx.quadraticCurveTo(px + pw, py + ph, px + pw - r, py + ph);
    ctx.lineTo(px + r, py + ph);
    ctx.quadraticCurveTo(px, py + ph, px, py + ph - r);
    ctx.lineTo(px, py + r);
    ctx.quadraticCurveTo(px, py, px + r, py);
    ctx.closePath();

    // Body fill — subtle gradient
    const bodyGrad = ctx.createLinearGradient(0, py, 0, py + ph);
    bodyGrad.addColorStop(0, '#2a2440');
    bodyGrad.addColorStop(1, '#1a1630');
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    ctx.shadowBlur = 0;

    // Top edge highlight
    ctx.strokeStyle = 'rgba(180,150,255,0.55)';
    ctx.lineWidth   = 2;
    ctx.beginPath();
    ctx.moveTo(px + r, py + 1);
    ctx.lineTo(px + pw - r, py + 1);
    ctx.stroke();

    // Subtle inner lines for texture
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let lx = px + 60; lx < px + pw - 40; lx += 60) {
      ctx.beginPath();
      ctx.moveTo(lx, py + 4);
      ctx.lineTo(lx, py + ph - 4);
      ctx.stroke();
    }
  }
}

/* ============================================================
   INPUT MANAGER
   ============================================================ */
class InputManager {
  constructor() {
    this.keys = {};
    this.jumpPressed = false;

    window.addEventListener('keydown', e => {
      if (!this.keys[e.code]) {
        // Rising edge — only trigger jumpPressed once per press
        if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'KeyW') {
          this.jumpPressed = true;
        }
      }
      this.keys[e.code] = true;
      // Prevent page scroll from arrow keys
      if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
    });

    window.addEventListener('keyup', e => {
      this.keys[e.code] = false;
    });
  }

  get left()  { return !!(this.keys['ArrowLeft']  || this.keys['KeyA']); }
  get right() { return !!(this.keys['ArrowRight'] || this.keys['KeyD']); }
  get jump()  { return !!(this.keys['Space'] || this.keys['ArrowUp'] || this.keys['KeyW']); }
}

/* ============================================================
   GAME CLASS — Main orchestrator
   ============================================================ */
class Game {
  constructor(canvas) {
    this.canvas  = canvas;
    this.ctx     = canvas.getContext('2d');
    this.stage   = new Stage(CANVAS_W, CANVAS_H);
    this.input   = new InputManager();
    this.player  = null;

    this.lastTime = null;
    this._rafId   = null;
  }

  /** Called after character is selected and assets loaded */
  start(player) {
    this.player = player;
    this.lastTime = performance.now();
    this._loop(this.lastTime);
  }

  _loop(timestamp) {
    this._rafId = requestAnimationFrame(ts => this._loop(ts));

    const dt = Math.min((timestamp - this.lastTime) / 1000, 0.05); // cap at 50ms
    this.lastTime = timestamp;

    this._update(dt);
    this._draw();
  }

  _update(dt) {
    this.stage.update(dt);
    this.player.update(dt, this.input, this.stage);
  }

  _draw() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    this.stage.drawBackground(ctx);
    this.stage.drawPlatform(ctx);
    this.player.draw(ctx);
  }

  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }
}

/* ============================================================
   CHARACTER SELECT SCREEN
   ============================================================ */
class CharacterSelectScreen {
  /**
   * @param {HTMLElement} container  - The card-grid element
   * @param {Function} onSelect      - callback(charDef)
   */
  constructor(container, onSelect) {
    this.container = container;
    this.onSelect  = onSelect;
    this._previewAnims = {};  // card id → { anim, canvas, ctx, img }
    this._rafId = null;
    this._render();
    this._startPreviewLoop();
  }

  _render() {
    this.container.innerHTML = '';

    for (const char of CHARACTERS) {
      const card = document.createElement('div');
      card.className = 'char-card';
      card.dataset.id = char.id;

      // Portrait canvas for animated preview
      const portrait = document.createElement('div');
      portrait.className = 'card-portrait';
      const cvs = document.createElement('canvas');
      cvs.width  = 220;
      cvs.height = 220;
      portrait.appendChild(cvs);

      const info = document.createElement('div');
      info.className = 'card-info';
      info.innerHTML = `
        <div class="card-name">${char.name}</div>
        <div class="card-class">${char.class}</div>
      `;

      card.appendChild(portrait);
      card.appendChild(info);
      this.container.appendChild(card);

      // Load idle animation frames for preview
      loadAnimation(char.animations.idle).then(anim => {
        this._previewAnims[char.id] = {
          anim,
          canvas: cvs,
          ctx: cvs.getContext('2d'),
          char,
        };
      });

      card.addEventListener('click', () => this.onSelect(char));
    }
  }

  _startPreviewLoop() {
    let last = performance.now();
    const loop = (ts) => {
      this._rafId = requestAnimationFrame(loop);
      const dt = Math.min((ts - last) / 1000, 0.05);
      last = ts;

      for (const entry of Object.values(this._previewAnims)) {
        const { anim, canvas, ctx } = entry;
        anim.update(dt);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Scale to fill card consistently
        const scale = (canvas.height * 0.82) / anim.frameH;
        const dw    = anim.frameW * scale;
        const dh    = anim.frameH * scale;
        const dx    = (canvas.width - dw) / 2;
        const dy    = canvas.height - dh - 8;

        // Draw the current frame image directly — no sheet math needed
        ctx.drawImage(anim.image, dx, dy, dw, dh);
      }
    };
    this._rafId = requestAnimationFrame(loop);
  }

  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
  }
}

/* ============================================================
   BOOTSTRAP — Wires everything together
   ============================================================ */
(function bootstrap() {
  /* Set up canvas */
  const canvas = document.getElementById('gameCanvas');
  canvas.width  = CANVAS_W;
  canvas.height = CANVAS_H;

  // Scale canvas to fit window while maintaining aspect ratio
  function resizeCanvas() {
    const scaleX = window.innerWidth  / CANVAS_W;
    const scaleY = window.innerHeight / CANVAS_H;
    const scale  = Math.min(scaleX, scaleY);
    canvas.style.width  = `${CANVAS_W * scale}px`;
    canvas.style.height = `${CANVAS_H * scale}px`;
  }
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  const selectScreen = document.getElementById('select-screen');
  const gameScreen   = document.getElementById('game-screen');

  /* Kick off character select */
  const cardGrid = document.getElementById('card-grid');
  const selectUI = new CharacterSelectScreen(cardGrid, async (charDef) => {
    /* Transition out */
    selectScreen.classList.add('fade-out');

    /* Load all animation frames for chosen character */
    let animations;
    try {
      animations = await loadCharacterAnimations(charDef);
    } catch (err) {
      console.error('Failed to load sprites:', err);
      selectScreen.classList.remove('fade-out');
      return;
    }

    /* Create player — start on platform center */
    const stage = new Stage(CANVAS_W, CANVAS_H);
    const startX = CANVAS_W / 2;
    const startY = stage.platformY;
    const player = new Player(charDef, animations, startX, startY);

    /* Show game screen */
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
