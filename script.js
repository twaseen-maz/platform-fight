'use strict';

// ============================================================
//  PLATFORM FIGHTER — script.js
//  Architecture: sprite animation engine + full game engine
//
//  Sprite animation system (top of file):
//   SpriteLoader    — loads PNG, exposes drawFrame()
//   MARTH_SHEET     — singleton sheet instance
//   MARTH_ANIMS     — maps animation names → per-frame {x,y,w,h} data
//   SpriteAnimator  — per-fighter state machine (currentState, frameIndex,
//                     frameTimer, frameDuration, animations)
//   getMarthAnim()  — maps engine state → animation name
//
//  Game engine (rest of file):
//   Constants, Fighter class, stage, hitbox resolution,
//   scene manager, menus, match loop, rAF render loop.
// ============================================================


// ============================================================
//  SECTION 1 — SpriteLoader
//  Loads a sprite sheet PNG once and exposes drawFrame().
//  Rendering uses drawImage with manual source-rect selection —
//  NOT CSS backgroundPosition, NOT CSS steps().
// ============================================================

class SpriteLoader {
  /**
   * @param {string} src  Path to the sprite sheet PNG (relative to HTML).
   */
  constructor(src) {
    this.ready = false;
    this.img   = new Image();
    this.img.onload  = () => {
      this.ready = true;
      console.log('[SpriteLoader] loaded:', src, this.img.naturalWidth + 'x' + this.img.naturalHeight);
    };
    this.img.onerror = () => {
      console.error('[SpriteLoader] FAILED to load:', src, '— check file is in same folder as index.html');
    };
    this.img.src = src;
  }

  /**
   * Draw one frame from the sheet onto a canvas context.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {{x,y,w,h}} frame   Source rect on the sheet.
   * @param {number}    dx      Destination x (world space, top-left of sprite).
   * @param {number}    dy      Destination y.
   * @param {number}    scale   Render scale (default 3 — sheet sprites are tiny).
   * @param {number}    facing  +1 = normal,  -1 = mirror horizontally.
   * @param {number}    alpha   Opacity 0-1.
   */
  drawFrame(ctx, frame, dx, dy, scale = 3, facing = 1, alpha = 1) {
    if (!this.ready || !frame) return;

    const { x, y, w, h } = frame;
    const dw = w * scale;
    const dh = h * scale;

    ctx.save();
    ctx.globalAlpha = alpha;

    if (facing === -1) {
      // Mirror: translate to right edge, flip left-right, draw from local origin
      ctx.translate(dx + dw, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(this.img, x, y, w, h, 0, 0, dw, dh);
    } else {
      ctx.drawImage(this.img, x, y, w, h, dx, dy, dw, dh);
    }

    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

// Singleton — loaded once at startup, shared by all Marth fighters
const MARTH_SHEET = new SpriteLoader('marth.png');


// ============================================================
//  SECTION 2 — MARTH_ANIMS (frame data)
//
//  Format per animation:
//    animationName: [
//      { x, y, w, h },   // frame 0 — source rect on the sheet
//      { x, y, w, h },   // frame 1
//      ...
//    ]
//
//  hitboxFrames is attached after construction:
//    anim.hitboxFrames = [firstActiveFrame, lastActiveFrame]
//
//  Row assignments verified against the sprite sheet by the artist:
//    Row 2  (y=66-87)   = bair
//    Row 5  (y=141-176) = crouch
//    Row 6  (y=180-201) = dair
//    Row 7  (y=203-227) = run
//    Row 8  (y=230-249) = dashAttack
//    Row 28 (y=858-881) = idle
//    Row 29 (y=884-915) = walk
// ============================================================

const MARTH_ANIMS = (() => {
  // Raw frame data: each entry is [srcX, srcY, srcW, srcH]
  // Coordinates were extracted by pixel-analysing green column dividers in the sheet.
  const raw = {
    walk:        [[12,884,8,32],[53,884,10,32],[96,884,11,32],[138,884,10,32],[178,884,12,32],[219,884,12,32],[258,884,14,32],[300,884,14,32],[342,884,13,32],[383,884,12,32],[421,884,13,32]],
    bair:        [[13,66,15,22],[34,66,17,22],[64,66,10,22],[88,66,10,22],[112,66,13,22],[139,66,11,22],[165,66,10,22]],
    jump:        [[8,91,10,22],[30,91,12,22],[53,91,16,22],[79,91,16,22],[106,91,13,22],[130,91,10,22],[155,91,9,22],[179,91,9,22],[204,91,9,22],[228,91,10,22],[252,91,11,22]],
    land:        [[12,117,11,22],[40,117,10,22],[67,117,13,22],[97,117,12,22],[126,117,12,22]],
    crouch:      [[21,141,7,36],[61,141,9,36],[98,141,10,36],[138,141,10,36],[177,141,9,36],[212,141,12,36],[256,141,6,36],[293,141,9,36],[332,141,12,36],[371,141,15,36],[410,141,15,36],[449,141,14,36],[489,141,8,36],[527,141,10,36],[566,141,9,36]],
    dair:        [[10,180,11,22],[36,180,9,22],[62,180,11,22],[86,180,16,22],[111,180,16,22],[139,180,15,22],[161,180,18,22],[187,180,15,22],[210,180,15,22],[239,180,9,22],[262,180,10,22],[288,180,11,22]],
    run:         [[18,203,12,25],[56,203,11,25],[90,203,14,25],[122,203,16,25],[162,203,12,25],[198,203,17,25],[238,203,18,25],[279,203,17,25],[319,203,17,25],[358,203,18,25],[397,203,16,25],[434,203,17,25],[471,203,15,25],[509,203,13,25],[550,203,11,25],[590,203,9,25],[627,203,12,25]],
    dashAttack:  [[6,230,10,20],[18,230,10,20],[29,230,10,20],[41,230,11,20],[55,230,10,20],[67,230,12,20],[82,230,10,20]],
    dblJump:     [[12,254,12,24],[38,254,9,24],[62,254,9,24],[89,254,10,24],[114,254,11,24],[138,254,11,24],[162,254,14,24],[188,254,12,24],[215,254,11,24],[239,254,14,24],[266,254,13,24],[293,254,11,24],[319,254,11,24],[344,254,11,24],[371,254,11,24],[395,254,13,24]],
    fastFall:    [[9,280,10,22],[27,280,10,22],[44,280,9,22],[60,280,10,22],[79,280,9,22],[97,280,9,22],[115,280,9,22],[134,280,9,22],[151,280,11,22]],
    ledgeHang:   [[9,306,10,25],[46,306,11,25],[83,306,17,25],[120,306,16,25],[162,306,14,25],[196,306,17,25],[237,306,14,25],[275,306,13,25],[311,306,11,25],[343,306,13,25],[384,306,9,25],[420,306,11,25]],
    dash:        [[21,340,10,26],[67,340,12,26],[117,340,12,26],[169,340,14,26],[219,340,12,26],[268,340,12,26],[312,340,16,26],[361,340,15,26],[409,340,13,26],[457,340,9,26],[502,340,13,26],[549,340,15,26],[597,340,17,26],[646,340,14,26],[695,340,13,26],[744,340,16,26],[792,340,11,26],[843,340,13,26],[893,340,11,26],[943,340,10,26],[993,340,9,26],[1040,340,11,26]],
    dashTurn:    [[10,367,10,23],[33,367,10,23],[54,367,12,23],[75,367,13,23],[98,367,10,23],[118,367,13,23],[140,367,12,23],[163,367,11,23],[186,367,10,23],[208,367,10,23],[229,367,10,23]],
    shield:      [[10,392,9,28],[46,392,10,28],[83,392,10,28],[125,392,7,28],[163,392,9,28],[201,392,9,28],[237,392,9,28],[275,392,10,28],[313,392,8,28],[349,392,8,28],[387,392,8,28],[422,392,7,28]],
    rollF:       [[15,421,8,49],[51,421,7,49],[86,421,7,49],[197,421,6,49],[306,421,8,49],[340,421,8,49],[376,421,8,49],[410,421,9,49],[446,421,9,49]],
    rollB:       [[17,471,8,45],[61,471,8,45],[105,471,8,45],[153,471,4,45],[191,471,5,45],[243,471,6,45],[332,471,11,45],[379,471,4,45],[384,471,4,45],[600,471,8,45],[644,471,7,45],[687,471,9,45]],
    airdodge:    [[18,518,9,26],[50,518,8,26],[83,518,9,26],[119,518,9,26],[153,518,10,26],[188,518,9,26],[214,518,14,26],[250,518,11,26],[283,518,10,26],[317,518,9,26],[351,518,9,26],[385,518,8,26],[419,518,10,26],[452,518,9,26],[486,518,10,26],[518,518,11,26],[551,518,11,26]],
    jab1:        [[7,546,14,30],[46,546,9,30],[82,546,12,30],[117,546,11,30],[153,546,13,30],[188,546,12,30],[222,546,13,30],[257,546,12,30],[291,546,14,30],[332,546,9,30],[365,546,11,30],[398,546,12,30],[433,546,11,30],[468,546,11,30]],
    jab2:        [[9,578,10,28],[24,578,97,28]],
    fair:        [[20,608,9,24],[56,608,8,24],[90,608,13,24],[123,608,15,24],[163,608,11,24],[199,608,15,24],[240,608,16,24],[279,608,14,24],[319,608,13,24],[357,608,5,24],[363,608,9,24],[404,608,9,24],[435,608,15,24],[471,608,14,24],[512,608,10,24],[551,608,10,24],[590,608,9,24],[628,608,10,24]],
    nair:        [[15,634,14,22],[40,634,12,22],[64,634,11,22],[88,634,11,22],[113,634,12,22],[140,634,11,22],[165,634,11,22]],
    uair:        [[16,658,8,38],[49,658,9,38],[82,658,9,38],[116,658,8,38],[149,658,9,38],[182,658,9,38],[215,658,9,38],[248,658,10,38],[282,658,9,38],[315,658,9,38],[349,658,8,38],[382,658,9,38],[416,658,8,38],[449,658,9,38],[483,658,8,38],[515,658,9,38],[549,658,10,38],[580,658,11,38],[617,658,7,38]],
    fsmash:      [[11,699,9,23],[33,699,11,23],[55,699,11,23],[75,699,13,23],[99,699,10,23],[119,699,13,23],[140,699,13,23],[164,699,11,23],[186,699,10,23],[208,699,10,23],[229,699,11,23]],
    usmash:      [[36,724,8,27],[69,724,5,27],[77,724,5,27],[99,724,13,27],[128,724,12,27],[158,724,13,27],[188,724,13,27],[218,724,11,27],[246,724,11,27],[275,724,11,27]],
    dsmashOut:   [[72,754,16,25],[126,754,12,25],[178,754,12,25],[226,754,11,25],[277,754,12,25],[329,754,14,25],[386,754,14,25],[442,754,8,25],[493,754,8,25],[541,754,11,25],[592,754,12,25],[643,754,12,25],[691,754,13,25],[739,754,14,25],[791,754,11,25],[843,754,11,25]],
    dsmashIn:    [[8,782,11,23],[36,782,11,23],[66,782,10,23],[94,782,14,23],[122,782,18,23],[150,782,17,23],[178,782,15,23],[206,782,13,23],[235,782,11,23],[261,782,11,23],[287,782,13,23],[318,782,11,23]],
    grab:        [[23,807,13,49],[40,807,14,49],[58,807,12,49],[75,807,13,49],[92,807,14,49]],
    idle:        [[11,858,8,24],[35,858,11,24],[59,858,13,24],[89,858,11,24],[119,858,8,24],[144,858,10,24],[169,858,16,24],[194,858,15,24],[226,858,9,24],[245,858,9,24],[267,858,13,24],[296,858,10,24]],
    throwF:      [[8,919,12,53],[29,919,7,53],[43,919,15,53],[67,919,19,53],[87,919,9,53],[107,919,13,53]],
    throwB:      [[10,974,11,24],[29,974,11,24]],
    throwU:      [[22,999,9,28],[36,999,10,28],[52,999,9,28],[67,999,9,28],[82,999,9,28]],
    throwD:      [[13,1030,10,23],[38,1030,10,23],[64,1030,9,23],[86,1030,10,23],[109,1030,11,23],[130,1030,13,23],[152,1030,16,23],[180,1030,13,23],[207,1030,11,23],[232,1030,10,23]],
    grabMiss:    [[9,1056,7,23],[26,1056,9,23],[46,1056,8,23],[65,1056,8,23],[83,1056,7,23],[100,1056,8,23]],
    neutralB:    [[18,1104,10,24],[59,1104,9,24],[101,1104,9,24],[143,1104,8,24],[183,1104,11,24],[225,1104,10,24],[267,1104,11,24],[308,1104,12,24],[351,1104,13,24],[393,1104,14,24],[436,1104,10,24],[478,1104,11,24],[521,1104,10,24],[563,1104,10,24],[604,1104,10,24],[646,1104,10,24],[688,1104,10,24],[729,1104,8,24],[769,1104,13,24],[812,1104,12,24]],
    sideB:       [[12,1131,10,32],[58,1131,10,32],[105,1131,11,32],[151,1131,9,32],[196,1131,10,32],[243,1131,7,32],[288,1131,11,32],[335,1131,13,32],[382,1131,11,32],[428,1131,13,32],[481,1131,7,32],[521,1131,4,32],[528,1131,10,32],[574,1131,11,32],[622,1131,10,32],[666,1131,9,32],[704,1131,11,32]],
    upB:         [[13,1164,11,22],[58,1164,10,22],[101,1164,11,22],[145,1164,12,22],[190,1164,13,22],[234,1164,11,22],[278,1164,12,22],[322,1164,12,22],[370,1164,6,22],[377,1164,9,22],[415,1164,17,22],[457,1164,16,22],[504,1164,13,22],[552,1164,10,22],[597,1164,9,22],[638,1164,10,22],[681,1164,11,22]],
    downB:       [[12,1188,12,24],[55,1188,10,24],[97,1188,11,24],[140,1188,11,24],[182,1188,10,24],[223,1188,11,24],[268,1188,14,24],[311,1188,18,24],[357,1188,17,24],[400,1188,16,24],[442,1188,15,24],[484,1188,17,24],[528,1188,16,24],[573,1188,13,24],[618,1188,12,24],[661,1188,11,24],[703,1188,10,24],[744,1188,11,24],[787,1188,11,24],[828,1188,13,24]],
    dmgLight:    [[6,1213,13,22],[26,1213,12,22],[46,1213,13,22],[72,1213,11,22],[91,1213,11,22],[109,1213,12,22],[128,1213,11,22]],
    dmgMid:      [[18,1237,12,23],[48,1237,10,23],[76,1237,12,23],[112,1237,13,23],[138,1237,20,23],[168,1237,14,23],[202,1237,12,23],[235,1237,10,23],[266,1237,11,23],[298,1237,9,23]],
    dmgHeavy:    [[10,1262,17,19],[32,1262,18,19],[55,1262,15,19],[71,1262,4,19],[80,1262,19,19],[104,1262,19,19]],
    dmgAir:      [[12,1283,12,25],[59,1283,17,25],[104,1283,17,25],[150,1283,17,25],[195,1283,16,25],[240,1283,15,25],[285,1283,15,25],[330,1283,13,25],[375,1283,12,25],[420,1283,11,25],[462,1283,12,25],[506,1283,12,25]],
    tumbleAir:   [[7,1310,16,23],[46,1310,16,23],[83,1310,19,23],[122,1310,17,23],[160,1310,16,23],[194,1310,17,23],[232,1310,14,23],[272,1310,11,23],[308,1310,10,23],[346,1310,10,23]],
    tumbleBig:   [[16,1370,12,25],[54,1370,13,25],[93,1370,12,25],[134,1370,12,25],[177,1370,14,25],[223,1370,8,25],[262,1370,10,25],[302,1370,10,25],[336,1370,16,25],[376,1370,15,25],[416,1370,13,25],[453,1370,13,25],[492,1370,9,25],[535,1370,9,25],[575,1370,9,25],[616,1370,9,25],[656,1370,10,25],[696,1370,10,25],[735,1370,10,25]],
    floorBounce: [[10,1396,11,27],[41,1396,10,27],[72,1396,11,27],[103,1396,11,27],[133,1396,12,27],[164,1396,12,27],[194,1396,12,27],[222,1396,11,27],[249,1396,14,27],[282,1396,10,27],[314,1396,11,27],[344,1396,10,27],[373,1396,9,27],[402,1396,12,27],[432,1396,12,27]],
    win1:        [[10,1424,10,32],[51,1424,12,32],[91,1424,12,32],[136,1424,9,32],[174,1424,12,32],[216,1424,10,32],[261,1424,6,32],[295,1424,11,32],[333,1424,12,32],[374,1424,12,32],[414,1424,12,32],[454,1424,12,32],[492,1424,9,32],[531,1424,11,32],[571,1424,10,32]],
    win2:        [[18,1458,8,34],[61,1458,9,34],[106,1458,8,34],[150,1458,8,34],[193,1458,7,34],[235,1458,8,34],[278,1458,8,34],[321,1458,9,34],[365,1458,8,34],[408,1458,8,34],[451,1458,8,34],[495,1458,11,34],[538,1458,14,34],[580,1458,11,34],[621,1458,8,34],[660,1458,11,34],[698,1458,15,34],[740,1458,13,34],[784,1458,11,34],[829,1458,9,34]],
  };

  // Convert [x,y,w,h] tuples to {x,y,w,h} objects
  const anims = {};
  for (const [name, frames] of Object.entries(raw)) {
    anims[name] = frames.map(([x, y, w, h]) => ({ x, y, w, h }));
  }

  // Hitbox windows: [firstActiveFrame, lastActiveFrame] (0-indexed, inclusive).
  // These drive the visual hitbox overlay — actual damage is handled by the engine.
  const hitboxWindows = {
    jab1:       [5, 9],   jab2:      [0, 1],
    fair:       [5, 10],  bair:      [2, 5],
    uair:       [6, 12],  dair:      [4, 8],
    nair:       [2, 5],   fsmash:    [5, 9],
    usmash:     [3, 7],   dsmashOut: [1, 3],
    dsmashIn:   [1, 3],   dashAttack:[2, 5],
    grab:       [1, 3],   throwF:    [1, 3],
    throwB:     [0, 1],   throwU:    [1, 3],
    throwD:     [1, 3],   neutralB:  [7, 14],
    sideB:      [6, 11],  upB:       [4, 9],
    downB:      [6, 13],
  };
  for (const [name, [s, e]] of Object.entries(hitboxWindows)) {
    if (anims[name]) anims[name].hitboxFrames = [s, e];
  }

  return anims;
})();


// ============================================================
//  SECTION 3 — SpriteAnimator (state machine)
//
//  One instance lives on each sprite-based Fighter.
//  Tracks the following state:
//    currentState  — name of the active animation (string key into MARTH_ANIMS)
//    frameIndex    — which frame of that animation we are on (0-based)
//    frameTimer    — how many game ticks we have held the current frame
//    frameDuration — how many game ticks to hold each frame before advancing
//    loop          — whether the animation wraps at the end
//
//  Rules:
//    • setAnim()   — switch animation ONLY if the name changed (preserves continuity)
//    • forceSet()  — always restart from frame 0 (use on attack entry)
//    • update()    — advance timer/index once per game tick
//    • currentFrame() — returns the {x,y,w,h} rect to draw this tick
//    • isHitboxFrame() — true when frameIndex is in the active hitbox window
// ============================================================

class SpriteAnimator {
  /**
   * @param {object} anims  The animation table (MARTH_ANIMS or AERIS_ANIMS).
   */
  constructor(anims) {
    this._anims        = anims;    // which frame table to look up
    // State machine fields — all mutation happens through setAnim / forceSet / update
    this.currentState  = 'idle';   // active animation name
    this.frameIndex    = 0;        // current frame within the animation
    this.frameTimer    = 0;        // ticks elapsed on this frame
    this.frameDuration = 3;        // ticks to hold each frame (lower = faster)
    this.loop          = true;     // whether to wrap at the end
    this.done          = false;    // true when a non-looping anim has finished
  }

  // ── Internal: start a named animation from frame 0 ─────────
  _startAnimation(name, loop, frameDuration) {
    this.currentState  = name;
    this.frameIndex    = 0;
    this.frameTimer    = 0;
    this.loop          = loop;
    this.frameDuration = frameDuration;
    this.done          = false;  // cleared on every fresh start
  }

  /**
   * Switch to a new animation state.
   * No-op if the animation is already playing — prevents mid-loop resets.
   * Use this for movement/idle states that should transition smoothly.
   *
   * @param {string}  name          Key into MARTH_ANIMS.
   * @param {boolean} loop          Whether to loop (default true).
   * @param {number}  frameDuration Game ticks per sprite frame (default 3).
   */
  setAnim(name, loop = true, frameDuration = 3) {
    if (!this._anims[name]) return;       // guard: unknown animation name
    if (name === this.currentState) return; // already playing — preserve continuity
    // Switching to a new animation always resets (even if done)
    this._startAnimation(name, loop, frameDuration);
  }

  /**
   * Force-restart an animation from frame 0 even if already playing.
   * Use this on attack STARTUP entry so the animation always begins fresh.
   *
   * @param {string}  name
   * @param {boolean} loop          Default false — attacks don't loop.
   * @param {number}  frameDuration Default 2 — attacks play slightly faster.
   */
  forceSet(name, loop = false, frameDuration = 2) {
    if (!this._anims[name]) return;
    this._startAnimation(name, loop, frameDuration);
  }

  /**
   * Advance the animation by one game tick.
   * Call this once per physics tick inside Fighter.update().
   */
  update() {
    const frames = this._anims[this.currentState];
    if (!frames || frames.length === 0) return;

    this.frameTimer++;

    if (this.frameTimer >= this.frameDuration) {
      this.frameTimer = 0;
      this.frameIndex++;

      if (this.frameIndex >= frames.length) {
        if (this.loop) {
          // Looping animation: wrap back to start
          this.frameIndex = 0;
        } else {
          // Non-looping animation: hold last frame and mark as done
          this.frameIndex = frames.length - 1;
          this.done = true;
        }
      }
    }
  }

  /**
   * Return the source rect for the current frame.
   * @returns {{x,y,w,h} | null}
   */
  currentFrame() {
    const frames = this._anims[this.currentState];
    if (!frames) return null;
    return frames[Math.min(this.frameIndex, frames.length - 1)];
  }

  /**
   * True when the current frame falls inside the active hitbox window.
   * Used to sync the visual hitbox overlay with the sprite pose.
   * @returns {boolean}
   */
  isHitboxFrame() {
    const frames = this._anims[this.currentState];
    if (!frames?.hitboxFrames) return false;
    const [start, end] = frames.hitboxFrames;
    return this.frameIndex >= start && this.frameIndex <= end;
  }
}


// ============================================================
//  SECTION 4 — getMarthAnim()
//
//  Translates the fighter engine's state (IDLE, RUN, STARTUP…)
//  and active move ID into an animation descriptor:
//    { name, loop, frameDuration, force }
//
//  The Fighter.update() loop calls this every tick and passes
//  the result to SpriteAnimator.setAnim() or .forceSet().
// ============================================================

/**
 * @param   {Fighter} fighter
 * @returns {{ name: string, loop: boolean, frameDuration: number, force: boolean }}
 */
function getMarthAnim(fighter) {
  const state     = fighter.state;
  const moveId    = fighter.currentMove?.id ?? '';
  const onGround  = fighter.onGround;
  const stateTick = fighter.stateTimer; // incremented at top of update before this runs

  // ── Attack / move phases (STARTUP → ACTIVE → ENDLAG) ────────
  // Force-restart on the very first tick of STARTUP so every attack
  // begins at frame 0 regardless of what was playing before.
  if (state === 'STARTUP' || state === 'ACTIVE' || state === 'ENDLAG') {
    const force = (state === 'STARTUP' && stateTick <= 1);

    // Map engine move IDs → MARTH_ANIMS keys
    const moveAnimMap = {
      jab:            'jab1',
      dashAttack:     'dashAttack',
      nair:           'nair',
      fair:           'fair',
      bair:           'bair',
      uair:           'uair',
      dair:           'dair',
      fsmash:         'fsmash',
      usmash:         'usmash',
      dsmash:         'dsmashOut',
      grab:           'grab',
      fthrow:         'throwF',
      bthrow:         'throwB',
      uthrow:         'throwU',
      dthrow:         'throwD',
      neutralSpecial: 'neutralB',
      sideSpecial:    'sideB',
      upSpecial:      'upB',
      downSpecial:    'downB',
    };

    const animName = moveAnimMap[moveId];
    if (animName) return { name: animName, loop: false, frameDuration: 2, force };

    // Unknown move — hold idle as fallback
    return { name: 'idle', loop: true, frameDuration: 3, force: false };
  }

  // ── Airborne — separate from state map for conditional logic ─
  if (state === 'AIRBORNE') {
    // Use dblJump frames while rising, run frames while falling
    const name = fighter.vy <= 0 ? 'dblJump' : 'run';
    return { name, loop: true, frameDuration: 3, force: false };
  }

  // ── Hitstun — pick intensity based on incoming velocity ─────
  if (state === 'HITSTUN') {
    let name;
    if (onGround) {
      name = Math.abs(fighter.vy) > 200 ? 'dmgMid' : 'dmgLight';
    } else {
      name = Math.abs(fighter.vy) > 500 ? 'tumbleAir' : 'dmgAir';
    }
    return { name, loop: true, frameDuration: 3, force: false };
  }

  // ── Ground / defensive state map ────────────────────────────
  const stateAnimMap = {
    IDLE:        { name: 'idle',      loop: true,  frameDuration: 3 },
    WALK:        { name: 'walk',      loop: true,  frameDuration: 3 },
    RUN:         { name: 'run',       loop: true,  frameDuration: 3 },
    DASH:        { name: 'dash',      loop: false, frameDuration: 3 },
    CROUCH:      { name: 'crouch',    loop: true,  frameDuration: 4 },
    JUMP:        { name: 'jump',      loop: false, frameDuration: 2 },
    FASTFALL:    { name: 'fastFall',  loop: false, frameDuration: 3 },
    LANDING:     { name: 'land',      loop: false, frameDuration: 2 },
    LANDLAG:     { name: 'land',      loop: false, frameDuration: 2 },
    SHIELD:      { name: 'shield',    loop: false, frameDuration: 3 },
    SHIELDSTUN:  { name: 'shield',    loop: false, frameDuration: 3 },
    SHIELDBREAK: { name: 'dmgHeavy', loop: true,  frameDuration: 4 },
    ROLL_F:      { name: 'rollF',     loop: false, frameDuration: 3 },
    ROLL_B:      { name: 'rollB',     loop: false, frameDuration: 3 },
    AIRDODGE:    { name: 'airdodge',  loop: false, frameDuration: 2 },
    LEDGE:       { name: 'ledgeHang', loop: true,  frameDuration: 4 },
  };

  const entry = stateAnimMap[state];
  if (entry) return { ...entry, force: false };

  // Default fallback — should rarely trigger
  return { name: 'idle', loop: true, frameDuration: 3, force: false };
}


// ============================================================
//  GAME ENGINE
//  Everything below is unchanged from the original game.
//  SpriteLoader / SpriteAnimator / MARTH_ANIMS / getMarthAnim
//  above replace the old sprite system; the Fighter class and
//  everything else is preserved verbatim.
// ============================================================



// ── Aeris sprite sheet ────────────────────────────────────
// Sheet layout (1680×1110, RGBA, 140×185 cells, 12 cols max):
//   Row 0  y=0    — idle        (11 frames)
//   Row 1  y=185  — run         ( 8 frames)
//   Row 2  y=370  — jump/land   ( 8 frames)
//   Row 3  y=555  — jab/attack  (10 frames)
//   Row 4  y=740  — nair+fair   (10 frames)
//   Row 5  y=925  — bair+uair+dash(11 frames)
const AERIS_SHEET = new SpriteLoader('aeris.png');

const AERIS_ANIMS = (() => {
  // Each frame: [x, y, w, h] — top-left corner inside the sheet.
  // Cells are 140×185 px; all sprites are centered within cells.
  const CW = 140, CH = 185;
  function row(rowIdx, count) {
    // Build `count` evenly-spaced frames along a single row
    const frames = [];
    for (let i = 0; i < count; i++) {
      frames.push([i * CW, rowIdx * CH, CW, CH]);
    }
    return frames;
  }

  const raw = {
    idle:       row(0, 11),
    run:        row(1,  8),
    // jump row: frames 0-2 = jump, 3-4 = fall, 5-7 = land
    jump:       [row(2,8)[0], row(2,8)[1], row(2,8)[2]],
    fall:       [row(2,8)[3], row(2,8)[4]],
    land:       [row(2,8)[5], row(2,8)[6], row(2,8)[7]],
    jab:        row(3, 10),
    nair:       [row(4,10)[0], row(4,10)[1], row(4,10)[2], row(4,10)[3]],
    fair:       [row(4,10)[4], row(4,10)[5], row(4,10)[6], row(4,10)[7], row(4,10)[8], row(4,10)[9]],
    bair:       [row(5,11)[0], row(5,11)[1], row(5,11)[2], row(5,11)[3]],
    uair:       [row(5,11)[4], row(5,11)[5], row(5,11)[6]],
    dashAttack: [row(5,11)[7], row(5,11)[8], row(5,11)[9], row(5,11)[10]],
    // Aliases for states not in sheet — reuse closest match
    dblJump:    row(2,8).slice(1, 4),
    fastFall:   row(2,8).slice(3, 5),
    ledgeHang:  row(0,11).slice(0, 3),
    dash:       row(1,8).slice(0, 4),
    dashTurn:   row(1,8).slice(3, 6),
    shield:     row(0,11).slice(5, 8),
    rollF:      row(1,8),
    rollB:      row(1,8),
    airdodge:   row(2,8).slice(1, 5),
    jab2:       [row(3,10)[3], row(3,10)[4]],
    fsmash:     row(3,10).slice(1, 8),
    usmash:     row(3,10).slice(2, 7),
    dsmashOut:  row(3,10).slice(0, 6),
    dsmashIn:   row(3,10).slice(5, 10),
    grab:       row(0,11).slice(0, 3),
    throwF:     row(3,10).slice(6, 10),
    throwB:     row(3,10).slice(0, 2),
    throwU:     row(3,10).slice(2, 5),
    throwD:     row(3,10).slice(4, 8),
    grabMiss:   row(0,11).slice(0, 3),
    neutralB:   row(4,10),
    sideB:      row(4,10).slice(2, 8),
    upB:        row(2,8).slice(0, 5),
    downB:      row(5,11).slice(0, 6),
    dmgLight:   row(0,11).slice(8, 11),
    dmgMid:     row(0,11).slice(6, 10),
    dmgHeavy:   row(0,11).slice(7, 11),
    dmgAir:     row(2,8).slice(2, 6),
    tumbleAir:  row(2,8).slice(3, 6),
    tumbleBig:  row(2,8).slice(2, 7),
    floorBounce:row(2,8).slice(4, 8),
    win1:       row(0,11).slice(0, 6),
    win2:       row(0,11).slice(5, 11),
  };

  const anims = {};
  for (const [name, frames] of Object.entries(raw))
    anims[name] = frames.map(([x, y, w, h]) => ({ x, y, w, h }));

  // Hitbox windows
  const hitboxWindows = {
    jab:   [2, 5], jab2:  [0, 1], fair:  [2, 5], bair:  [1, 3],
    uair:  [1, 2], nair:  [1, 3], fsmash:[3, 6], usmash:[2, 4],
    dsmashOut:[1,3], dsmashIn:[1,3], dashAttack:[1,3],
    grab:  [0, 1], throwF:[0, 2], throwB:[0, 1], throwU:[0, 2], throwD:[0, 2],
    neutralB:[4,8], sideB:[2,5], upB:[1,4], downB:[2,5],
  };
  for (const [n, [s, e]] of Object.entries(hitboxWindows))
    if (anims[n]) anims[n].hitboxFrames = [s, e];

  return anims;
})();

// ── Aeris animation state machine ────────────────────────
function getAerisAnim(fighter) {
  const state    = fighter.state;
  const moveId   = fighter.currentMove?.id ?? '';
  const onGround = fighter.onGround;
  const tick     = fighter.stateTimer;

  if (state === 'STARTUP' || state === 'ACTIVE' || state === 'ENDLAG') {
    const force = (state === 'STARTUP' && tick <= 1);
    const moveAnimMap = {
      jab: 'jab', dashAttack: 'dashAttack',
      nair: 'nair', fair: 'fair', bair: 'bair', uair: 'uair',
      fsmash: 'fsmash', usmash: 'usmash', dsmash: 'dsmashOut',
      grab: 'grab', fthrow: 'throwF', bthrow: 'throwB',
      uthrow: 'throwU', dthrow: 'throwD',
      neutralSpecial: 'neutralB', sideSpecial: 'sideB',
      upSpecial: 'upB', downSpecial: 'downB',
    };
    const animName = moveAnimMap[moveId];
    if (animName) return { name: animName, loop: false, frameDuration: 2, force };
    return { name: 'idle', loop: true, frameDuration: 3, force: false };
  }

  if (state === 'AIRBORNE') {
    const name = fighter.vy <= 0 ? 'dblJump' : 'fall';
    return { name, loop: true, frameDuration: 3, force: false };
  }

  if (state === 'HITSTUN') {
    const name = onGround
      ? (Math.abs(fighter.vy) > 200 ? 'dmgMid' : 'dmgLight')
      : (Math.abs(fighter.vy) > 500 ? 'tumbleAir' : 'dmgAir');
    return { name, loop: true, frameDuration: 3, force: false };
  }

  const stateAnimMap = {
    IDLE:        { name: 'idle',      loop: true,  frameDuration: 4 },
    WALK:        { name: 'run',       loop: true,  frameDuration: 4 },
    RUN:         { name: 'run',       loop: true,  frameDuration: 3 },
    DASH:        { name: 'dash',      loop: false, frameDuration: 3 },
    CROUCH:      { name: 'shield',    loop: true,  frameDuration: 5 },
    JUMP:        { name: 'jump',      loop: false, frameDuration: 2 },
    FASTFALL:    { name: 'fastFall',  loop: false, frameDuration: 3 },
    LANDING:     { name: 'land',      loop: false, frameDuration: 2 },
    LANDLAG:     { name: 'land',      loop: false, frameDuration: 2 },
    SHIELD:      { name: 'shield',    loop: true,  frameDuration: 4 },
    SHIELDSTUN:  { name: 'shield',    loop: false, frameDuration: 3 },
    SHIELDBREAK: { name: 'dmgHeavy', loop: true,  frameDuration: 4 },
    ROLL_F:      { name: 'rollF',     loop: false, frameDuration: 3 },
    ROLL_B:      { name: 'rollB',     loop: false, frameDuration: 3 },
    AIRDODGE:    { name: 'airdodge',  loop: false, frameDuration: 2 },
    LEDGE:       { name: 'ledgeHang', loop: true,  frameDuration: 4 },
  };

  const entry = stateAnimMap[state];
  if (entry) return { ...entry, force: false };
  return { name: 'idle', loop: true, frameDuration: 3, force: false };
}

// ── MARTH fighter definition ─────────────────────────────
// Added to FIGHTER_DEFS after the object is created (see below).
// Reuses BLADE's moveset — Marth plays identically but renders with sprites.
// sprite: true tells Fighter.draw() to use SpriteAnimator instead of rect.

const MARTH_DEF_ENTRY = {
  color:'#c8a0ff', shadowColor:'rgba(180,140,255,0.55)',
  width: 42, height: 54,   // collision box (slightly wider than sprite for fairness)
  weight: 95,
  groundSpeed: 490, groundAccel: 2700,
  airSpeed: 410,    airAccel: 1700,
  groundFrict: 0.72, airFrict: 0.978,
  jumpVy: -800, dblJumpVy: -680, fastFallVy: 950,
  maxJumps: 2,
  sprite: true,            // flag: use sprite renderer
  spriteSheet: 'MARTH',    // key into SPRITE_SHEET_MAP
  animFn:      'MARTH',    // key into ANIM_FN_MAP / ANIM_TABLE_MAP
  spriteScale: 3.2,        // render scale — sheet sprites are ~14px wide → ~45px rendered
  spriteOffsetX: -4,       // nudge sprite to align with collision box
  spriteOffsetY: -2,
  // moveset assigned after MOVESETS are defined — see FIGHTER_DEFS injection below
};


// ── AERIS fighter definition ─────────────────────────────
// Balanced swordfighter — good speed, average weight, versatile moveset.
// Uses her own sprite sheet (aeris.png) and getAerisAnim() state machine.
const AERIS_DEF_ENTRY = {
  color: '#40e0d0', shadowColor: 'rgba(64,224,208,0.55)',
  width: 44, height: 56,
  weight: 98,
  groundSpeed: 500, groundAccel: 2600,
  airSpeed:    420, airAccel:    1750,
  groundFrict: 0.72, airFrict:  0.978,
  jumpVy: -820, dblJumpVy: -700, fastFallVy: 940,
  maxJumps: 2,
  sprite:       true,
  spriteSheet:  'AERIS',       // key used by Fighter.draw() to pick the right sheet
  spriteScale:  2.0,           // scale 2 gives ~120px body height on 540px canvas
  spriteOffsetX: 0,
  spriteOffsetY: 2,
  animFn:       'AERIS',       // key into ANIM_FN_MAP
};

// ═══════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════
const FIXED_DT   = 1 / 60;
const GRAVITY    = 2200;
const TERMINAL_V = 1400;

// Hit pause thresholds — in Brawl KB units (post-formula, pre-velocity scaling).
// Keeps hit-freeze feel data-driven and consistent with the new formula.
const HIT_PAUSE_THRESHOLDS = [
  { minKb: 60, frames: 8 },
  { minKb: 40, frames: 5 },
  { minKb: 20, frames: 3 },
  { minKb:  0, frames: 1 },
];

// Brawl uses hitstunFrames = floor(KB * 0.4).
// Per-move hitstunMult on each moveDef overrides this (normals lower, specials higher).
const HITSTUN_SCALE = 0.4;

// Converts Brawl abstract KB units → px/s for our physics.
// Brawl gravity ≈ 2800 u/s²; ours = 2200 px/s².
// Tuned so KB ≈ 100 (strong mid-% hit) launches ~1300 px/s.
const KB_TO_PX = 3.5;

// Debug overlay toggle
let debugMode = false;
window.addEventListener('keydown', e => { if (e.code === 'Tab') { e.preventDefault(); debugMode = !debugMode; } });

// ═══════════════════════════════════════════════════════════
//  STATE ENUM
// ═══════════════════════════════════════════════════════════
const State = Object.freeze({
  IDLE:        'IDLE',
  RUN:         'RUN',
  AIRBORNE:    'AIRBORNE',
  FASTFALL:    'FASTFALL',
  LANDING:     'LANDING',
  STARTUP:     'STARTUP',
  ACTIVE:      'ACTIVE',
  ENDLAG:      'ENDLAG',
  LANDLAG:     'LANDLAG',
  HITSTUN:     'HITSTUN',
  // ── New v0.4 states ──────────────────────
  SHIELD:      'SHIELD',      // holding shield button, grounded
  SHIELDSTUN:  'SHIELDSTUN',  // brief lockout after absorbing a hit on shield
  SHIELDBREAK: 'SHIELDBREAK', // shield broke — long stun, vulnerable
  ROLL_F:      'ROLL_F',      // forward roll (grounded dodge)
  ROLL_B:      'ROLL_B',      // backward roll (grounded dodge)
  AIRDODGE:    'AIRDODGE',    // aerial dodge (directional, one use per air-time)
  LEDGE:       'LEDGE',       // hanging on a ledge, invincible for first N frames
});

const ATTACK_STATES = new Set([State.STARTUP, State.ACTIVE, State.ENDLAG]);
const isAttackState = s => ATTACK_STATES.has(s);

// States that completely block voluntary action (movement, attacks, jumps)
const LOCKED_STATES = new Set([
  ...ATTACK_STATES,
  State.HITSTUN, State.SHIELDSTUN, State.SHIELDBREAK,
  State.ROLL_F, State.ROLL_B, State.AIRDODGE, State.LEDGE,
  State.LANDLAG,
]);
const isLocked = s => LOCKED_STATES.has(s);

// ── Shield constants ──────────────────────────────────────
const SHIELD_MAX          = 100;   // full shield health
const SHIELD_REGEN_RATE   = 0.28;  // hp per frame when shield is up but not being hit
const SHIELD_PASSIVE_DRAIN= 0.10;  // hp per frame while actively held
const SHIELD_MIN_SIZE     = 0.38;  // minimum bubble radius as fraction of full
const SHIELD_BREAK_STUN   = 180;   // frames of break stun (3 seconds)
const SHIELD_COOLDOWN     = 60;    // frames after releasing shield before it can be used again if near-broken
const SHIELD_STUN_BASE    = 2;     // base frames of shield stun
const SHIELD_STUN_PER_DMG = 0.6;   // extra frames per damage point of the blocked hit

// ── Roll constants ────────────────────────────────────────
const ROLL_DURATION       = 20;    // total frames of a roll
const ROLL_INVULN_START   = 4;     // first invincible frame (1-indexed)
const ROLL_INVULN_END     = 16;    // last invincible frame
const ROLL_DISTANCE       = 110;   // pixels traveled over full duration
const ROLL_COOLDOWN       = 40;    // frames before rolling again after a roll

// ── Air dodge constants ───────────────────────────────────
const AIRDODGE_DURATION   = 26;    // total frames
const AIRDODGE_INVULN_START = 4;
const AIRDODGE_INVULN_END   = 20;
const AIRDODGE_SPEED      = 580;   // px/s in chosen direction
const AIRDODGE_ENDLAG     = 14;    // frames of non-invincible post-dodge lag

// ── Ledge constants ───────────────────────────────────────
const LEDGE_INVULN_FRAMES = 30;    // invincible frames immediately after snapping
const LEDGE_SNAP_DIST     = 60;    // px — how close hand must be to snap (generous for recovery)
const LEDGE_HANG_LIMIT    = 300;   // frames before auto-release (prevents camping)
const LEDGE_GETUP_FRAMES  = 18;    // landing-lag equivalent after climbing up

// ═══════════════════════════════════════════════════════════
//  RECT — shared axis-aligned bounding box primitive
//  Used by both Hitbox and Hurtbox; keeps overlap logic DRY.
// ═══════════════════════════════════════════════════════════
class Rect {
  constructor(x, y, w, h) { this.x = x; this.y = y; this.w = w; this.h = h; }
  get right()  { return this.x + this.w; }
  get bottom() { return this.y + this.h; }

  overlaps(other) {
    return this.x < other.right  && this.right  > other.x &&
           this.y < other.bottom && this.bottom > other.y;
  }

  // Draw helper used by both Hitbox and Hurtbox
  draw(ctx, fillStyle, strokeStyle, alpha = 0.4) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = fillStyle;
    ctx.fillRect(Math.round(this.x), Math.round(this.y), this.w, this.h);
    ctx.globalAlpha = Math.min(1, alpha + 0.4);
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth   = 1;
    ctx.strokeRect(Math.round(this.x) + .5, Math.round(this.y) + .5, this.w - 1, this.h - 1);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}

// ═══════════════════════════════════════════════════════════
//  HITBOX
//  Represents a single offensive box spawned during a move's
//  ACTIVE window. Owns the move data it was created from and
//  a Set of targets already struck (prevents multi-hit within
//  the same activation — the core anti-abuse mechanism).
//
//  World-space rect is computed fresh each frame from the
//  owner's current position and facing, so it tracks the
//  fighter correctly even if they move during an active window.
// ═══════════════════════════════════════════════════════════
class Hitbox {
  /**
   * @param {Fighter} owner    — the fighter who owns this hitbox
   * @param {object}  moveDef  — the move data object (from MOVESETS)
   */
  constructor(owner, moveDef) {
    this.owner      = owner;
    this.moveDef    = moveDef;
    // hitTargets: Set<Fighter> — each fighter can only be hit once per
    // hitbox activation. Reset when a new Hitbox is created (i.e. each
    // time the move re-enters ACTIVE, which can't currently happen, but
    // the architecture supports multi-hit moves in the future via a
    // hitReset flag on the move data).
    this.hitTargets = new Set();
    this.id         = Hitbox._nextId++;
  }

  // Returns the current world-space Rect (facing-aware, re-computed every call)
  getRect() {
    const { ox, oy, w, h } = this.moveDef.hitbox;
    const facedOx = ox * this.owner.facing;
    return new Rect(
      this.owner.cx + facedOx - w / 2,
      this.owner.y  + oy,
      w, h
    );
  }

  // Convenience: test against a Hurtbox
  overlapsHurtbox(hurtbox) {
    return this.getRect().overlaps(hurtbox.getRect());
  }

  draw(ctx) {
    const r = this.getRect();
    ctx.save();
    ctx.shadowColor = this.moveDef.sfxColor;
    ctx.shadowBlur  = 14;
    r.draw(ctx, this.moveDef.sfxColor, '#ffffff', 0.50);
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}
Hitbox._nextId = 0;

// ═══════════════════════════════════════════════════════════
//  HURTBOX
//  Represents the vulnerable area of a fighter.
//  By default it matches the fighter's body rect exactly.
//  The architecture intentionally supports multiple hurtboxes
//  per fighter (e.g. extended limb during a move), and per-state
//  hurtbox modification (crouch shrinks hurtbox, etc.) — simply
//  push additional Hurtbox objects into fighter.hurtboxes.
//
//  offset/size are defined relative to the fighter's body rect.
//  ox = 0, oy = 0, w = fighter.w, h = fighter.h  → full body.
// ═══════════════════════════════════════════════════════════
class Hurtbox {
  /**
   * @param {Fighter} owner
   * @param {object}  def    — { ox, oy, w, h } body-relative offsets
   * @param {string}  [tag]  — optional tag ('body', 'head', 'leg') for future use
   */
  constructor(owner, def, tag = 'body') {
    this.owner = owner;
    this.def   = def;   // { ox, oy, w, h }
    this.tag   = tag;
    this.active = true; // can be toggled per state (e.g. invincibility frames)
  }

  getRect() {
    return new Rect(
      this.owner.x + this.def.ox,
      this.owner.y + this.def.oy,
      this.def.w,
      this.def.h
    );
  }

  draw(ctx) {
    if (!this.active) return;
    const r = this.getRect();
    r.draw(ctx, 'rgba(0,200,255,0.18)', 'rgba(0,200,255,0.9)', 0.18);
  }
}

// ═══════════════════════════════════════════════════════════
//  KNOCKBACK CALCULATOR  —  Brawl formula
//
//  Brawl KB formula (from Smashwiki):
//    KB = (((p/10 + p*d/20) * (200/(w+200)) * 1.4) + 18) * (KBG/100) + BKB
//
//  Where:
//    p   = target's current damage percent (BEFORE this hit is added)
//    d   = damage dealt by the move
//    w   = target's weight (100 = Mario baseline)
//    BKB = base knockback
//    KBG = knockback growth
//
//  KB is an abstract unit.  Multiply by KB_TO_PX to get px/s velocity.
//
//  Hitstun (Brawl):  floor(KB * 0.4)
//  Per-move hitstunMult overrides the 0.4 coefficient.
//
//  Hit pause: looked up from HIT_PAUSE_THRESHOLDS by final KB value.
// ═══════════════════════════════════════════════════════════
function computeKnockback(moveDef, targetPercent, attackerFacing, targetWeight) {
  const { damage: d, angle, baseKb: BKB, kbGrowth: KBG } = moveDef;
  const p = targetPercent;   // percent BEFORE this hit
  const w = targetWeight ?? 100;

  // ── Brawl formula ─────────────────────────────────────────
  // Damage-scaling portion (grows with both target's percent and move damage)
  const dmgPart  = (p / 10 + p * d / 20) * (200 / (w + 200)) * 1.4;
  // Full KB in Brawl abstract units
  const KB       = (dmgPart + 18) * (KBG / 100) + BKB;

  // ── Velocity conversion ────────────────────────────────────
  const speed    = Math.max(0, KB) * KB_TO_PX;   // px/s magnitude
  const rad      = angle * Math.PI / 180;
  const vx       =  Math.cos(rad) * speed * attackerFacing;
  const vy       = -Math.abs(Math.sin(rad) * speed);  // negative = up

  // ── Hitstun ────────────────────────────────────────────────
  const mult          = moveDef.hitstunMult ?? HITSTUN_SCALE;
  const hitstunFrames = Math.floor(Math.max(0, KB) * mult);

  // ── Hit pause — from final KB (already weight/damage scaled) ─
  let hitPauseFrames = 0;
  for (const t of HIT_PAUSE_THRESHOLDS) {
    if (KB >= t.minKb) { hitPauseFrames = t.frames; break; }
  }

  return { vx, vy, hitstunFrames, hitPauseFrames, scaledKb: KB, rawKb: KB };
}

// ═══════════════════════════════════════════════════════════
//  HIT EVENT
//  Immutable record created by resolveHitboxes() and applied
//  after all collision checks are done in the same tick.
//  This prevents order-of-iteration artifacts (e.g. fighter A
//  hitting fighter B mutating B's state before B's hitbox is
//  checked against A's hurtbox).
// ═══════════════════════════════════════════════════════════
class HitEvent {
  constructor(attacker, defender, moveDef, kbResult) {
    this.attacker  = attacker;
    this.defender  = defender;
    this.moveDef   = moveDef;
    this.kbResult  = kbResult;
  }
}

// ═══════════════════════════════════════════════════════════
//  SHIELD
//  Tracks health, break state, stun, cooldown, and regeneration.
//  Lives on each Fighter as fighter.shield.
//
//  Health model:
//    - Drains passively while held (prevents infinite shielding)
//    - Drains by hit damage when absorbing an attack
//    - Regenerates automatically while not held (up to SHIELD_MAX)
//    - At 0 HP → shield breaks, fighter enters SHIELDBREAK stun
//
//  Size: the rendered bubble radius scales with health so players
//  can visually read how much shield remains.
// ═══════════════════════════════════════════════════════════
class Shield {
  constructor() {
    this.hp          = SHIELD_MAX;
    this.broken      = false;       // true while broken and not yet fully regenerated
    this.stunLeft    = 0;           // frames of shield-stun remaining
    this.cooldown    = 0;           // frames before shield can be raised again
    this.regenDelay  = 0;           // frames before regen starts after last hit
  }

  // Fraction 0–1 representing current health
  get fraction() { return Math.max(0, this.hp / SHIELD_MAX); }

  // Radius of the shield bubble in pixels (scales with health)
  bubbleRadius(fighter) {
    const base = Math.max(fighter.w, fighter.h) * 0.72;
    return base * (SHIELD_MIN_SIZE + (1 - SHIELD_MIN_SIZE) * this.fraction);
  }

  // Called every frame
  tick(isHeld) {
    if (this.stunLeft  > 0) this.stunLeft--;
    if (this.cooldown  > 0) this.cooldown--;
    if (this.regenDelay> 0) { this.regenDelay--; return; }

    if (this.broken) {
      // Regen while broken — once full, un-break
      this.hp = Math.min(SHIELD_MAX, this.hp + SHIELD_REGEN_RATE * 2);
      if (this.hp >= SHIELD_MAX) { this.hp = SHIELD_MAX; this.broken = false; }
    } else if (isHeld) {
      // Passive drain while holding
      this.hp = Math.max(0, this.hp - SHIELD_PASSIVE_DRAIN);
    } else {
      // Regen when not held
      this.hp = Math.min(SHIELD_MAX, this.hp + SHIELD_REGEN_RATE);
    }
  }

  // Absorb a hit. Returns true if shield breaks.
  absorbHit(damage) {
    this.hp       -= damage;
    this.regenDelay = 90;     // 1.5s delay before regen
    this.stunLeft   = Math.ceil(SHIELD_STUN_BASE + damage * SHIELD_STUN_PER_DMG);
    if (this.hp <= 0) {
      this.hp      = 0;
      this.broken  = true;
      this.cooldown= SHIELD_BREAK_STUN + 60; // long cooldown post-break
      return true;
    }
    return false;
  }

  // Can the shield be raised right now?
  canRaise() { return !this.broken && this.cooldown === 0 && this.hp > 2; }
}

// ═══════════════════════════════════════════════════════════
//  LEDGE
//  A snap point at the corner of a platform.
//  Fighters near the edge while moving toward it will snap and hang.
//
//  Each Ledge is defined by:
//    x, y   — the exact corner pixel
//    facing — which direction you face when hanging (+1 = right ledge, -1 = left ledge)
//    holder — the Fighter currently occupying it (only one per ledge)
// ═══════════════════════════════════════════════════════════
class Ledge {
  constructor(x, y, facing) {
    this.x      = x;
    this.y      = y;
    this.facing = facing;  // +1 = right side of a platform, -1 = left side
    this.holder = null;    // Fighter | null
  }

  isFree()  { return this.holder === null; }

  occupy(fighter) {
    this.holder = fighter;
    fighter.ledge = this;
  }

  release() {
    if (this.holder) { this.holder.ledge = null; }
    this.holder = null;
  }
}

// ═══════════════════════════════════════════════════════════
//  MOVE DATA SCHEMA
//
//  id            {string}   unique identifier
//  aerial        {bool}     true = air-only, false = ground-only
//  startup       {int}      frames before hitbox appears
//  active        {int}      frames hitbox is live
//  endlag        {int}      recovery frames after active window
//  landLag       {int}      frames of landing lag if aerial touches ground
//  damage        {number}   % damage dealt on hit
//  angle         {number}   launch angle degrees (0=right, 90=up, 180=left, 270=down)
//  baseKb        {number}   base knockback (see computeKnockback)
//  kbGrowth      {number}   knockback scaling per 1% damage dealt
//  hitbox        {object}   { ox, oy, w, h } — facing-relative offset from fighter cx/top
//  hurtboxMod    {object|null} optional per-move hurtbox override { ox, oy, w, h }
//  sfxColor      {string}   hitbox glow / flash colour
//  locksMovement {bool}     freeze vx during startup+active
// ═══════════════════════════════════════════════════════════
const MOVESETS = {

  // ╔═══════════════════════════════════════════════════════╗
  // ║  BLADE — Balanced Swordfighter                        ║
  // ║  Philosophy: moderate frame data, disjointed range,   ║
  // ║  strong edgeguarding, reliable KO options at mid-%.   ║
  // ║  Frame legend: startup | active | endlag              ║
  // ╚═══════════════════════════════════════════════════════╝
  BLADE: {

    // ── GROUND MOVES ─────────────────────────────────────

    // Jab — quick two-hit poke. Low commitment, safe on block.
    // startup 4 | active 3 | endlag 9  → total 16f
    jab: {
      id:'jab', aerial:false,
      startup:4, active:3, endlag:9, landLag:0,
      damage:5, angle:35, baseKb:20, kbGrowth:70,
      hitbox:{ ox:16, oy:2, w:44, h:20 }, hurtboxMod:null,
      sfxColor:'#c8e0ff', locksMovement:false, hitstunMult:0.30,
    },

    // ── AERIALS ──────────────────────────────────────────

    // Neutral Air — spinning blade. Multi-directional, safe landing option.
    // startup 6 | active 10 | endlag 12 | landLag 8
    nair: {
      id:'nair', aerial:true,
      startup:6, active:10, endlag:12, landLag:8,
      damage:8, angle:45, baseKb:25, kbGrowth:90,
      hitbox:{ ox:0, oy:0, w:52, h:52 }, hurtboxMod:null,
      sfxColor:'#c8e0ff', locksMovement:false, hitstunMult:0.30,
    },

    // Forward Air — horizontal swipe. Strong edgeguard tool, low endlag.
    // startup 9 | active 5 | endlag 14 | landLag 10
    fair: {
      id:'fair', aerial:true,
      startup:9, active:5, endlag:14, landLag:10,
      damage:12, angle:22, baseKb:30, kbGrowth:100,
      hitbox:{ ox:18, oy:4, w:50, h:28 }, hurtboxMod:null,
      sfxColor:'#88ccff', locksMovement:false, hitstunMult:0.30,
    },

    // Back Air — quick reverse slash. Fast, strong, KO potential near ledge.
    // startup 7 | active 4 | endlag 13 | landLag 9
    bair: {
      id:'bair', aerial:true,
      startup:7, active:4, endlag:13, landLag:9,
      damage:13, angle:155, baseKb:32, kbGrowth:105,
      hitbox:{ ox:-20, oy:2, w:48, h:26 }, hurtboxMod:null,
      sfxColor:'#aaddff', locksMovement:false, hitstunMult:0.30,
    },

    // Up Air — upward thrust. Juggle and ceiling KO tool.
    // startup 8 | active 6 | endlag 12 | landLag 8
    uair: {
      id:'uair', aerial:true,
      startup:8, active:6, endlag:12, landLag:8,
      damage:11, angle:84, baseKb:28, kbGrowth:95,
      hitbox:{ ox:-4, oy:-42, w:46, h:44 }, hurtboxMod:null,
      sfxColor:'#66ddff', locksMovement:false, hitstunMult:0.30,
    },

    // Down Air — SPIKE. Downward plunge, stalls then plunges. High risk/reward.
    // startup 14 | active 6 | endlag 18 | landLag 22
    dair: {
      id:'dair', aerial:true,
      startup:14, active:6, endlag:18, landLag:22,
      damage:14, angle:270, baseKb:35, kbGrowth:100,
      hitbox:{ ox:-4, oy:36, w:44, h:32 }, hurtboxMod:null,
      sfxColor:'#ff4488', locksMovement:true, hitstunMult:0.30,
    },

    // ── SPECIALS ─────────────────────────────────────────

    // Neutral Special — Blade Beam. Projectile (placeholder hitbox as thrown blade).
    // startup 18 | active 30 | endlag 20
    neutralSpecial: {
      id:'neutralSpecial', aerial:false,
      startup:18, active:30, endlag:20, landLag:0,
      damage:7, angle:10, baseKb:28, kbGrowth:85,
      hitbox:{ ox:30, oy:8, w:36, h:16 }, hurtboxMod:null,
      sfxColor:'#44ffff', locksMovement:true, hitstunMult:0.60, airOk:true,
    },

    // Side Special — Dash Slash. Lunging attack with forward momentum.
    // startup 10 | active 6 | endlag 16
    sideSpecial: {
      id:'sideSpecial', aerial:false,
      startup:10, active:6, endlag:16, landLag:12,
      damage:11, angle:30, baseKb:32, kbGrowth:95,
      hitbox:{ ox:22, oy:-4, w:52, h:36 }, hurtboxMod:null,
      sfxColor:'#aaffee', locksMovement:false, hitstunMult:0.60, airOk:true,
    },

    // Up Special — Rising Blade. Recovery move, vertical launch.
    // startup 5 | active 8 | endlag 30 (high endlag = punishable off-stage)
    upSpecial: {
      id:'upSpecial', aerial:true,
      startup:5, active:8, endlag:30, landLag:24,
      damage:9, angle:82, baseKb:30, kbGrowth:90,
      hitbox:{ ox:-2, oy:-44, w:40, h:48 }, hurtboxMod:null,
      sfxColor:'#ffffff', locksMovement:true, hitstunMult:0.60,
    },

    // Down Special — Counter Stance. Placeholder active window = parry window.
    // startup 4 | active 20 | endlag 22
    downSpecial: {
      id:'downSpecial', aerial:false,
      startup:4, active:20, endlag:22, landLag:0,
      damage:14, angle:60, baseKb:38, kbGrowth:110,
      hitbox:{ ox:0, oy:0, w:36, h:52 }, hurtboxMod:null,
      sfxColor:'#ffaaff', locksMovement:true, hitstunMult:0.60, airOk:true,
    },

    // ── GRAB + THROWS ────────────────────────────────────
    // Grabs have damage:0, baseKb:0 (engine skips KB for grab moves).

    // Grab — standing grab reach.
    // startup 7 | active 3 | endlag 14
    grab: {
      id:'grab', aerial:false,
      startup:7, active:3, endlag:14, landLag:0,
      damage:0, angle:0, baseKb:0, kbGrowth:0,
      hitbox:{ ox:14, oy:4, w:36, h:24 }, hurtboxMod:null,
      sfxColor:'#ffffff', locksMovement:true, hitstunMult:0.40,
    },

    // Forward Throw — standard launch.
    fthrow: {
      id:'fthrow', aerial:false,
      startup:2, active:1, endlag:16, landLag:0,
      damage:9, angle:30, baseKb:40, kbGrowth:80,
      hitbox:{ ox:12, oy:4, w:36, h:28 }, hurtboxMod:null,
      sfxColor:'#88ccff', locksMovement:true, hitstunMult:0.40,
    },

    // Back Throw — strong horizontal KO throw near ledge.
    bthrow: {
      id:'bthrow', aerial:false,
      startup:3, active:1, endlag:18, landLag:0,
      damage:11, angle:155, baseKb:45, kbGrowth:90,
      hitbox:{ ox:-12, oy:4, w:36, h:28 }, hurtboxMod:null,
      sfxColor:'#aaddff', locksMovement:true, hitstunMult:0.40,
    },

    // Up Throw — juggle throw, sets up aerial combos.
    uthrow: {
      id:'uthrow', aerial:false,
      startup:3, active:1, endlag:20, landLag:0,
      damage:8, angle:90, baseKb:35, kbGrowth:85,
      hitbox:{ ox:0, oy:-16, w:36, h:28 }, hurtboxMod:null,
      sfxColor:'#66ddff', locksMovement:true, hitstunMult:0.40,
    },

    // Down Throw — combo throw at low %, tech-chase at high %.
    dthrow: {
      id:'dthrow', aerial:false,
      startup:2, active:1, endlag:22, landLag:0,
      damage:7, angle:75, baseKb:25, kbGrowth:70,
      hitbox:{ ox:0, oy:20, w:36, h:24 }, hurtboxMod:null,
      sfxColor:'#44ffaa', locksMovement:true, hitstunMult:0.40,
    },
  },

  // ╔═══════════════════════════════════════════════════════╗
  // ║  GRUNT — Heavy Melee Brawler                          ║
  // ║  Philosophy: slow startup & high endlag on everything,║
  // ║  massive base knockback, large body + large hitboxes, ║
  // ║  can KO extremely early. Limited aerial game.         ║
  // ╚═══════════════════════════════════════════════════════╝
  GRUNT: {

    // ── GROUND MOVES ─────────────────────────────────────

    // Jab — haymaker. Slow but hurts even on jab.
    // startup 9 | active 3 | endlag 16 → total 28f
    jab: {
      id:'jab', aerial:false,
      startup:9, active:3, endlag:16, landLag:0,
      damage:8, angle:25, baseKb:28, kbGrowth:80,
      hitbox:{ ox:16, oy:2, w:40, h:26 }, hurtboxMod:null,
      sfxColor:'#ff9900', locksMovement:false, hitstunMult:0.30,
    },

    // ── AERIALS ──────────────────────────────────────────

    // Neutral Air — body check. Simple, covers all sides.
    // startup 12 | active 8 | endlag 20 | landLag 16
    nair: {
      id:'nair', aerial:true,
      startup:12, active:8, endlag:20, landLag:16,
      damage:12, angle:40, baseKb:32, kbGrowth:100,
      hitbox:{ ox:0, oy:0, w:56, h:56 }, hurtboxMod:null,
      sfxColor:'#ff9900', locksMovement:false, hitstunMult:0.30,
    },

    // Forward Air — hammer fist. Very slow, kills on hit.
    // startup 18 | active 5 | endlag 22 | landLag 18
    fair: {
      id:'fair', aerial:true,
      startup:18, active:5, endlag:22, landLag:18,
      damage:16, angle:25, baseKb:40, kbGrowth:120,
      hitbox:{ ox:18, oy:6, w:54, h:36 }, hurtboxMod:null,
      sfxColor:'#ff6600', locksMovement:true, hitstunMult:0.30,
    },

    // Back Air — elbow smash. Fastest aerial, still slow overall.
    // startup 14 | active 5 | endlag 16 | landLag 12
    bair: {
      id:'bair', aerial:true,
      startup:14, active:5, endlag:16, landLag:12,
      damage:14, angle:150, baseKb:38, kbGrowth:110,
      hitbox:{ ox:-18, oy:4, w:50, h:32 }, hurtboxMod:null,
      sfxColor:'#ffaa00', locksMovement:false, hitstunMult:0.30,
    },

    // Up Air — headbutt upward. Vertical KO near top blast zone.
    // startup 16 | active 6 | endlag 18 | landLag 14
    uair: {
      id:'uair', aerial:true,
      startup:16, active:6, endlag:18, landLag:14,
      damage:15, angle:88, baseKb:40, kbGrowth:115,
      hitbox:{ ox:-4, oy:-44, w:56, h:46 }, hurtboxMod:null,
      sfxColor:'#ffcc00', locksMovement:true, hitstunMult:0.30,
    },

    // Down Air — SPIKE. Meteor crash — devastating but very slow.
    // startup 20 | active 6 | endlag 24 | landLag 28
    dair: {
      id:'dair', aerial:true,
      startup:20, active:6, endlag:24, landLag:28,
      damage:18, angle:270, baseKb:45, kbGrowth:115,
      hitbox:{ ox:-6, oy:40, w:56, h:36 }, hurtboxMod:null,
      sfxColor:'#ff2200', locksMovement:true, hitstunMult:0.30,
    },

    // ── SPECIALS ─────────────────────────────────────────

    // Neutral Special — Ground Slam charge. High damage, high endlag.
    // startup 24 | active 6 | endlag 30
    neutralSpecial: {
      id:'neutralSpecial', aerial:false,
      startup:24, active:6, endlag:30, landLag:0,
      damage:20, angle:80, baseKb:48, kbGrowth:130,
      hitbox:{ ox:-8, oy:20, w:64, h:32 }, hurtboxMod:null,
      sfxColor:'#ff4400', locksMovement:true, hitstunMult:0.60, airOk:true,
    },

    // Side Special — Bull Rush. Armoured horizontal charge.
    // startup 14 | active 12 | endlag 20
    sideSpecial: {
      id:'sideSpecial', aerial:false,
      startup:14, active:12, endlag:20, landLag:16,
      damage:13, angle:20, baseKb:35, kbGrowth:105,
      hitbox:{ ox:20, oy:0, w:56, h:48 }, hurtboxMod:null,
      sfxColor:'#ff8800', locksMovement:false, hitstunMult:0.60, airOk:true,
    },

    // Up Special — Rocket Jump. Damages below, poor recovery distance.
    // startup 10 | active 10 | endlag 32
    upSpecial: {
      id:'upSpecial', aerial:true,
      startup:10, active:10, endlag:32, landLag:26,
      damage:12, angle:270, baseKb:30, kbGrowth:90,
      hitbox:{ ox:-4, oy:24, w:56, h:40 }, hurtboxMod:null,
      sfxColor:'#ffcc00', locksMovement:true, hitstunMult:0.60,
    },

    // Down Special — Earthquake. Hits both sides at ground level.
    // startup 18 | active 14 | endlag 24
    downSpecial: {
      id:'downSpecial', aerial:false,
      startup:18, active:14, endlag:24, landLag:0,
      damage:15, angle:50, baseKb:40, kbGrowth:110,
      hitbox:{ ox:-30, oy:24, w:108, h:24 }, hurtboxMod:null,
      sfxColor:'#ff6600', locksMovement:true, hitstunMult:0.60, airOk:true,
    },

    // ── GRAB + THROWS ────────────────────────────────────

    // Grab — slow but huge reach.
    // startup 10 | active 4 | endlag 18
    grab: {
      id:'grab', aerial:false,
      startup:10, active:4, endlag:18, landLag:0,
      damage:0, angle:0, baseKb:0, kbGrowth:0,
      hitbox:{ ox:14, oy:2, w:44, h:28 }, hurtboxMod:null,
      sfxColor:'#ffffff', locksMovement:true, hitstunMult:0.40,
    },

    // Forward Throw — power toss, direct KO threat near ledge.
    fthrow: {
      id:'fthrow', aerial:false,
      startup:3, active:1, endlag:20, landLag:0,
      damage:13, angle:30, baseKb:50, kbGrowth:90,
      hitbox:{ ox:14, oy:4, w:44, h:32 }, hurtboxMod:null,
      sfxColor:'#ff9900', locksMovement:true, hitstunMult:0.40,
    },

    // Back Throw — spinning toss, highest raw throw KB.
    bthrow: {
      id:'bthrow', aerial:false,
      startup:4, active:1, endlag:22, landLag:0,
      damage:15, angle:160, baseKb:55, kbGrowth:95,
      hitbox:{ ox:-14, oy:4, w:44, h:32 }, hurtboxMod:null,
      sfxColor:'#ffaa00', locksMovement:true, hitstunMult:0.40,
    },

    // Up Throw — catapult into ceiling, combo extension.
    uthrow: {
      id:'uthrow', aerial:false,
      startup:4, active:1, endlag:24, landLag:0,
      damage:10, angle:90, baseKb:40, kbGrowth:90,
      hitbox:{ ox:0, oy:-20, w:44, h:32 }, hurtboxMod:null,
      sfxColor:'#ffcc00', locksMovement:true, hitstunMult:0.40,
    },

    // Down Throw — pile-driver. Combo starter at low %, kills at very high %.
    dthrow: {
      id:'dthrow', aerial:false,
      startup:4, active:1, endlag:26, landLag:0,
      damage:12, angle:78, baseKb:30, kbGrowth:75,
      hitbox:{ ox:0, oy:24, w:44, h:32 }, hurtboxMod:null,
      sfxColor:'#ff6600', locksMovement:true, hitstunMult:0.40,
    },
  },

  // ╔═══════════════════════════════════════════════════════╗
  // ║  VEX — Lightweight Ranged Zoner                       ║
  // ║  Philosophy: very fast moves, low knockback,          ║
  // ║  excellent projectile space control, poor close-range, ║
  // ║  kills late (110-130%+). Tiny hurtbox. High air speed.║
  // ╚═══════════════════════════════════════════════════════╝
  VEX: {

    // ── GROUND MOVES ─────────────────────────────────────

    // Jab — lightning-fast stab. Best OOS option, very low damage.
    // startup 2 | active 3 | endlag 6 → total 11f
    jab: {
      id:'jab', aerial:false,
      startup:2, active:3, endlag:6, landLag:0,
      damage:2, angle:20, baseKb:10, kbGrowth:50,
      hitbox:{ ox:12, oy:6, w:28, h:16 }, hurtboxMod:null,
      sfxColor:'#aaff88', locksMovement:false, hitstunMult:0.30,
    },

    // ── AERIALS ──────────────────────────────────────────

    // Neutral Air — spinning burst. Decent coverage, safe on landing.
    // startup 5 | active 12 | endlag 9 | landLag 6
    nair: {
      id:'nair', aerial:true,
      startup:5, active:12, endlag:9, landLag:6,
      damage:6, angle:50, baseKb:18, kbGrowth:75,
      hitbox:{ ox:0, oy:0, w:40, h:40 }, hurtboxMod:null,
      sfxColor:'#aaff88', locksMovement:false, hitstunMult:0.30,
    },

    // Forward Air — arcing beam shot. Long active window, chains off zoning.
    // startup 7 | active 8 | endlag 10 | landLag 7
    fair: {
      id:'fair', aerial:true,
      startup:7, active:8, endlag:10, landLag:7,
      damage:8, angle:18, baseKb:22, kbGrowth:85,
      hitbox:{ ox:18, oy:4, w:52, h:22 }, hurtboxMod:null,
      sfxColor:'#88ff44', locksMovement:false, hitstunMult:0.30,
    },

    // Back Air — reverse kick. Solid knockback for a zoner, edgeguard tool.
    // startup 6 | active 5 | endlag 11 | landLag 8
    bair: {
      id:'bair', aerial:true,
      startup:6, active:5, endlag:11, landLag:8,
      damage:10, angle:160, baseKb:26, kbGrowth:90,
      hitbox:{ ox:-18, oy:6, w:40, h:24 }, hurtboxMod:null,
      sfxColor:'#ccff44', locksMovement:false, hitstunMult:0.30,
    },

    // Up Air — upward energy pulse. Juggle tool, weak but fast.
    // startup 5 | active 7 | endlag 8 | landLag 5
    uair: {
      id:'uair', aerial:true,
      startup:5, active:7, endlag:8, landLag:5,
      damage:7, angle:84, baseKb:20, kbGrowth:80,
      hitbox:{ ox:-4, oy:-36, w:40, h:36 }, hurtboxMod:null,
      sfxColor:'#88ffcc', locksMovement:false, hitstunMult:0.30,
    },

    // Down Air — SPIKE. Concentrated beam shot downward.
    // Small hitbox, requires precise aim. Fast startup for a spike.
    // startup 10 | active 4 | endlag 14 | landLag 16
    dair: {
      id:'dair', aerial:true,
      startup:10, active:4, endlag:14, landLag:16,
      damage:11, angle:270, baseKb:28, kbGrowth:90,
      hitbox:{ ox:-2, oy:30, w:28, h:28 }, hurtboxMod:null,
      sfxColor:'#44ffcc', locksMovement:true, hitstunMult:0.30,
    },

    // ── SPECIALS ─────────────────────────────────────────

    // Neutral Special — Homing Orb. Slow-moving projectile (large active window).
    // startup 12 | active 40 | endlag 14
    neutralSpecial: {
      id:'neutralSpecial', aerial:false,
      startup:12, active:40, endlag:14, landLag:0,
      damage:6, angle:10, baseKb:22, kbGrowth:80,
      hitbox:{ ox:28, oy:8, w:24, h:20 }, hurtboxMod:null,
      sfxColor:'#44ff88', locksMovement:false, hitstunMult:0.60, airOk:true,
    },

    // Side Special — Dash Burst. Quick teleport-dash with trailing hitbox.
    // startup 6 | active 4 | endlag 12
    sideSpecial: {
      id:'sideSpecial', aerial:false,
      startup:6, active:4, endlag:12, landLag:8,
      damage:7, angle:30, baseKb:24, kbGrowth:85,
      hitbox:{ ox:16, oy:2, w:44, h:28 }, hurtboxMod:null,
      sfxColor:'#aaffcc', locksMovement:false, hitstunMult:0.60, airOk:true,
    },

    // Up Special — Boost Jet. Fast vertical recovery, weak hitbox on ascent.
    // startup 4 | active 14 | endlag 22
    upSpecial: {
      id:'upSpecial', aerial:true,
      startup:4, active:14, endlag:22, landLag:14,
      damage:5, angle:88, baseKb:20, kbGrowth:75,
      hitbox:{ ox:-2, oy:-36, w:32, h:50 }, hurtboxMod:null,
      sfxColor:'#ccffaa', locksMovement:true, hitstunMult:0.60,
    },

    // Down Special — Mine Drop. Deploys stationary hitbox (simulated via long active).
    // startup 8 | active 50 | endlag 10
    downSpecial: {
      id:'downSpecial', aerial:false,
      startup:8, active:50, endlag:10, landLag:0,
      damage:9, angle:55, baseKb:26, kbGrowth:85,
      hitbox:{ ox:0, oy:28, w:28, h:20 }, hurtboxMod:null,
      sfxColor:'#ffff44', locksMovement:false, hitstunMult:0.60, airOk:true,
    },

    // ── GRAB + THROWS ────────────────────────────────────

    // Grab — tether-style extended grab. Fast startup, short true active.
    // startup 5 | active 3 | endlag 12
    grab: {
      id:'grab', aerial:false,
      startup:5, active:3, endlag:12, landLag:0,
      damage:0, angle:0, baseKb:0, kbGrowth:0,
      hitbox:{ ox:16, oy:6, w:40, h:20 }, hurtboxMod:null,
      sfxColor:'#ffffff', locksMovement:true, hitstunMult:0.40,
    },

    // Forward Throw — light toss. Sets up zoning pressure.
    fthrow: {
      id:'fthrow', aerial:false,
      startup:2, active:1, endlag:14, landLag:0,
      damage:6, angle:25, baseKb:32, kbGrowth:70,
      hitbox:{ ox:12, oy:6, w:32, h:24 }, hurtboxMod:null,
      sfxColor:'#88ff44', locksMovement:true, hitstunMult:0.40,
    },

    // Back Throw — fling away, creates distance for re-zoning.
    bthrow: {
      id:'bthrow', aerial:false,
      startup:3, active:1, endlag:14, landLag:0,
      damage:7, angle:160, baseKb:35, kbGrowth:80,
      hitbox:{ ox:-12, oy:6, w:32, h:24 }, hurtboxMod:null,
      sfxColor:'#ccff44', locksMovement:true, hitstunMult:0.40,
    },

    // Up Throw — high-angle toss. Best throw for landing aerials.
    uthrow: {
      id:'uthrow', aerial:false,
      startup:3, active:1, endlag:16, landLag:0,
      damage:5, angle:88, baseKb:28, kbGrowth:75,
      hitbox:{ ox:0, oy:-14, w:32, h:24 }, hurtboxMod:null,
      sfxColor:'#aaffcc', locksMovement:true, hitstunMult:0.40,
    },

    // Down Throw — bounces opponent, low angle, combo launcher.
    dthrow: {
      id:'dthrow', aerial:false,
      startup:2, active:1, endlag:18, landLag:0,
      damage:4, angle:68, baseKb:18, kbGrowth:65,
      hitbox:{ ox:0, oy:20, w:32, h:20 }, hurtboxMod:null,
      sfxColor:'#88ffcc', locksMovement:true, hitstunMult:0.40,
    },
  },
};
// ═══════════════════════════════════════════════════════════
const FIGHTER_DEFS = {
  MARTH: Object.assign({}, MARTH_DEF_ENTRY, { moveset: MOVESETS.BLADE }),
  AERIS: Object.assign({}, AERIS_DEF_ENTRY, { moveset: MOVESETS.BLADE }),
};


// ── Per-character sprite sheet and animation function maps ──
// Fighter.draw() uses d.spriteSheet to look up the correct SpriteLoader.
// Fighter.update() uses d.animFn to call the right getMarthAnim / getAerisAnim.
const SPRITE_SHEET_MAP = {
  MARTH: MARTH_SHEET,
  AERIS: AERIS_SHEET,
};
const ANIM_FN_MAP = {
  MARTH: getMarthAnim,
  AERIS: getAerisAnim,
};
const ANIM_TABLE_MAP = {
  MARTH: MARTH_ANIMS,
  AERIS: AERIS_ANIMS,
};

// ═══════════════════════════════════════════════════════════
//  INPUT
//
//  Root causes fixed here:
//
//  Bug 1 — Attacks stop after one use:
//    Old code used object-existence to detect first press. After
//    clearJust() the entry stayed alive with held:true. On the next
//    press, the else branch fired and set justPressed:false immediately.
//    Fix: use the held flag itself to distinguish fresh-press from
//    key-repeat. justPressed is only set true when held was false.
//
//  Bug 2 — Jump missed on landing:
//    clearJust() ran inside gamePhysicsTick(), which fires multiple
//    times per frame during accumulator catch-up. A jump pressed
//    between renders could be consumed by tick 1 before tick 2 reads
//    it. Fix: move clearJust() out of gamePhysicsTick() entirely.
//    Instead it runs once per render frame, AFTER all physics ticks
//    complete, so every justPressed survives the full batch of ticks.
//
//  Extra: keyup now deletes the entry so the next keydown always
//  takes the fresh-press path, even after clearJust has run.
// ═══════════════════════════════════════════════════════════
const keys = {};
window.addEventListener('keydown', e => {
  // Only set justPressed on a genuine new press (held was false or absent)
  const wasHeld = keys[e.code]?.held ?? false;
  if (!wasHeld) {
    keys[e.code] = { held: true, justPressed: true };
  } else {
    // Key-repeat: keep held, do NOT touch justPressed
    keys[e.code].held = true;
  }
  if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) e.preventDefault();
});
window.addEventListener('keyup', e => {
  // Delete entirely so the next keydown always hits the fresh-press path
  delete keys[e.code];
});
const keyHeld = c => !!(keys[c]?.held);
const keyJust = c => !!(keys[c]?.justPressed);
// Called once per RENDER FRAME (not per physics tick) so justPressed
// survives all ticks in a multi-tick catch-up batch.
function clearJust() { for (const k in keys) keys[k].justPressed = false; }

// ═══════════════════════════════════════════════════════════
//  PLATFORM
// ═══════════════════════════════════════════════════════════
class Platform {
  constructor(x, y, w, h, isGround = false) {
    Object.assign(this, { x, y, w, h, isGround });
  }
}

// ═══════════════════════════════════════════════════════════
//  FIGHTER
// ═══════════════════════════════════════════════════════════
class Fighter {
  constructor(defName, x, y, controls) {
    this.defName  = defName;
    this.def      = FIGHTER_DEFS[defName];
    this.controls = controls;

    this.x = x; this.y = y;
    this.vx = 0; this.vy = 0;

    this.state      = State.IDLE;
    this.stateTimer = 0;
    this.facing     = 1;
    this.onGround   = false;
    this.canFastFall= false;
    this.jumpsLeft  = this.def.maxJumps;

    // Combat
    this.damage         = 0;
    this.hitstunLeft    = 0;
    this.hitstunMax     = 0;
    this.hitPauseLeft   = 0;

    // Move tracking
    this.currentMove    = null;
    this.currentFrame   = 0;
    this.pendingLandLag = 0;

    // ── Shield ──────────────────────────────
    this.shield         = new Shield();

    // ── Roll / Air dodge ────────────────────
    // dodgeFrame    : current frame within a roll or airdodge (1-indexed)
    // dodgeDir      : +1 or -1, direction of roll/airdodge
    // rollCooldown  : frames before next roll is allowed
    // airdodgeUsed  : true after first airdodge in air; reset on landing
    this.dodgeFrame     = 0;
    this.dodgeDir       = 1;
    this.rollCooldown   = 0;
    this.airdodgeUsed   = false;

    // ── Ledge ────────────────────────────────
    // ledge         : Ledge | null — the ledge this fighter is hanging on
    // ledgeTimer    : frames spent on this ledge (for auto-release)
    // ledgeInvuln   : frames of invincibility remaining after snapping
    this.ledge          = null;
    this.ledgeTimer     = 0;
    this.ledgeInvuln    = 0;

    // ── Invincibility (shared flag for all sources) ──────
    // invuln > 0 means hurtboxes are inactive this frame
    this.invuln         = 0;

    // ── Box collections ─────────────────────
    // activeHitbox : Hitbox | null — single offensive box per move activation
    // hurtboxes    : Hurtbox[]    — one or more defensive boxes
    this.activeHitbox = null;
    this.hurtboxes    = [
      // Default full-body hurtbox — always present, sized from def
      new Hurtbox(this, { ox:0, oy:0, w:this.def.width, h:this.def.height }, 'body'),
    ];

    this.w = this.def.width;
    this.h = this.def.height;

    this._flashTimer    = 0;
    this._hitEffects    = [];  // { x,y, color, life, maxLife } cosmetic bursts
    this._blasted       = false; // set true when fighter leaves blast zone; cleared by GameScene on respawn

    // ── Sprite animator (any sprite-def fighter) ──────────
    // Resolve sprite resources from maps (keys set on each def entry)
    const animTable   = this.def.sprite ? (ANIM_TABLE_MAP[this.def.animFn]         ?? MARTH_ANIMS)   : null;
    this.spriteAnim   = this.def.sprite ? new SpriteAnimator(animTable) : null;
    this._sheet       = this.def.sprite ? (SPRITE_SHEET_MAP[this.def.spriteSheet]  ?? MARTH_SHEET)   : null;
    this._animFn      = this.def.sprite ? (ANIM_FN_MAP[this.def.animFn]            ?? getMarthAnim)  : null;
    if (this.def.sprite) console.log('[Fighter]', defName, 'sheet=', this.def.spriteSheet, 'sheet.ready=', this._sheet?.ready, 'animFn=', this.def.animFn);
  }

  // ── Bounds (body rect) ─────────────────────
  get left()   { return this.x; }
  get right()  { return this.x + this.w; }
  get top()    { return this.y; }
  get bottom() { return this.y + this.h; }
  get cx()     { return this.x + this.w / 2; }
  get cy()     { return this.y + this.h / 2; }

  setState(s) {
    if (this.state === s) return;
    this.state = s; this.stateTimer = 0;
  }

  // ── HURTBOX MANAGEMENT ────────────────────
  refreshHurtboxes() {
    const bodyHb = this.hurtboxes[0];
    const mod = (this.currentMove?.hurtboxMod) || null;
    bodyHb.def = mod
      ? mod
      : { ox: 0, oy: 0, w: this.def.width, h: this.def.height };

    // Deactivate hurtbox during invincibility (roll, airdodge window, ledge snap)
    bodyHb.active = (this.invuln <= 0);
  }

  // ── TRY MOVE ─────────────────────────────
  tryMove(moveName) {
    const move = this.def.moveset[moveName];
    if (!move) return;
    const inAir = !this.onGround;

    // aerial:true   → air only (aerials)
    // aerial:false + airOk:true → both air and ground (specials)
    // aerial:false + no airOk  → ground only (jab, grab, throws)
    if (move.aerial && !inAir)               return;  // aerial on ground: blocked
    if (!move.aerial && !move.airOk && inAir) return;  // ground-only in air: blocked

    if (isAttackState(this.state))  return;
    if (this.state === State.HITSTUN || this.state === State.LANDLAG) return;

    this.currentMove  = move;
    this.currentFrame = 0;
    this.activeHitbox = null;
    this.setState(State.STARTUP);
  }

  // ── ABSORB HIT ON SHIELD ─────────────────
  // Called instead of applyHit when the defender is shielding.
  // Applies shield damage + stun; triggers break if HP reaches 0.
  absorbOnShield(hitEvent) {
    const { moveDef } = hitEvent;
    const broke = this.shield.absorbHit(moveDef.damage);
    this._spawnHitEffect(this.cx, this.cy - this.h * 0.3, '#4488ff');

    if (broke) {
      // Shield break: major knockback straight up, very long stun
      this.vx = 0;
      this.vy = -400;
      this.hitstunLeft = SHIELD_BREAK_STUN;
      this.hitstunMax  = SHIELD_BREAK_STUN;
      this.currentMove = null; this.activeHitbox = null;
      this.onGround    = false;
      this.setState(State.SHIELDBREAK);
    } else {
      // Shield stun: brief lockout, fighter stays grounded
      this.setState(State.SHIELDSTUN);
    }
    // Small hit pause on both fighters even for shielded hits
    hitEvent.attacker.applyHitPause(2);
    this.applyHitPause(2);
  }

  // ── LEDGE GET-UP ─────────────────────────
  // Called when jump is pressed while on ledge, or after LEDGE_HANG_LIMIT.
  ledgeGetUp() {
    if (!this.ledge) return;
    const l = this.ledge;
    l.release();
    // Snap position to just above the platform surface
    this.x       = l.facing === 1 ? l.x - this.w : l.x;
    this.y       = l.y - this.h;
    this.vx      = 0; this.vy = 0;
    this.onGround= true;
    this.facing  = -l.facing; // face inward onto the stage
    this.pendingLandLag = LEDGE_GETUP_FRAMES;
    this.setState(State.LANDLAG);
  }

  // ── APPLY HIT (called by resolveHitboxes after deferred collection) ──
  // Receives a pre-computed HitEvent so all KB math has been done before
  // any fighter state mutates, preventing order-of-iteration bugs.
  applyHit(hitEvent) {
    const { moveDef, kbResult } = hitEvent;

    this.damage      += moveDef.damage;
    this._flashTimer  = 10;
    this.hitstunLeft  = kbResult.hitstunFrames;
    this.hitstunMax   = kbResult.hitstunFrames;

    // Apply velocity — this IS the knockback; vx/vy are in px/s
    this.vx = kbResult.vx;
    this.vy = kbResult.vy;

    // Interrupt any current action
    this.currentMove  = null;
    this.activeHitbox = null;
    this.onGround     = false;

    // Spawn a hit burst effect at the intersection point
    const hbRect = hitEvent.attacker.activeHitbox?.getRect();
    const ex = hbRect ? hbRect.x + hbRect.w / 2 : this.cx;
    const ey = hbRect ? hbRect.y + hbRect.h / 2 : this.cy;
    this._spawnHitEffect(ex, ey, moveDef.sfxColor);

    this.setState(State.HITSTUN);
  }

  // Apply hit-pause to this fighter (freeze physics for N frames)
  applyHitPause(frames) {
    this.hitPauseLeft = Math.max(this.hitPauseLeft, frames);
  }

  // ── SPAWN HIT EFFECT ─────────────────────
  _spawnHitEffect(x, y, color) {
    this._hitEffects.push({ x, y, color, life: 18, maxLife: 18, particles: [] });
    // Create burst particles
    const last = this._hitEffects[this._hitEffects.length - 1];
    for (let i = 0; i < 8; i++) {
      const ang = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
      const spd = 60 + Math.random() * 80;
      last.particles.push({ x, y, vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd });
    }
  }

  // ── UPDATE ───────────────────────────────
  update(dt, platforms) {
    // ── Hit pause: freeze everything ────────
    if (this.hitPauseLeft > 0) {
      this.hitPauseLeft--;
      this._tickFlash();
      this._tickHitEffects(dt);
      return;
    }

    const d   = this.def;
    const ctl = this.controls;

    this.stateTimer++;
    this._tickFlash();
    this._tickHitEffects(dt);
    if (this.invuln > 0) this.invuln--;

    // ── Sprite animator tick ──────────────────
    if (this.spriteAnim) {
      const { name, loop, frameDuration, force } = this._animFn(this);
      if (force) {
        this.spriteAnim.forceSet(name, loop, frameDuration);
      } else {
        this.spriteAnim.setAnim(name, loop, frameDuration);
      }
      this.spriteAnim.update();
    }

    // Refresh hurtbox geometry (also applies invuln flag)
    this.refreshHurtboxes();

    // ── LEDGE STATE ──────────────────────────
    if (this.state === State.LEDGE) {
      this.ledgeTimer++;
      if (this.ledgeInvuln > 0) this.ledgeInvuln--;

      // Auto-release after hang limit
      if (this.ledgeTimer >= LEDGE_HANG_LIMIT) { this.ledgeGetUp(); return; }

      // Jump or up input → get up
      if (keyJust(ctl.jump) || keyHeld(ctl.up)) { this.ledgeGetUp(); return; }

      // Down input → drop off ledge
      if (keyJust(ctl.down)) {
        if (this.ledge) this.ledge.release();
        this.vy = 100; this.setState(State.AIRBORNE);
        return;
      }

      // While hanging: no physics, fighter is pinned
      return;
    }

    // ── SHIELD TICK (always, even in other states) ───
    const shieldHeld = !isLocked(this.state) && keyHeld(ctl.shield);
    this.shield.tick(this.state === State.SHIELD);

    // ── SHIELD STUN ──────────────────────────
    if (this.state === State.SHIELDSTUN) {
      if (this.shield.stunLeft <= 0) {
        // Re-enter shield if still holding, else idle
        this.setState(shieldHeld ? State.SHIELD : State.IDLE);
      }
      return;
    }

    // ── SHIELD BREAK STUN ────────────────────
    if (this.state === State.SHIELDBREAK) {
      this.hitstunLeft--;
      if (this.hitstunLeft <= 0 && this.onGround) this.setState(State.IDLE);
      this._applyGravity(dt);
      this.x += this.vx * dt; this.y += this.vy * dt;
      this._resolvePlatforms(platforms);
      return;
    }

    // Advance move phase FSM
    if (this.currentMove) this._tickMove();

    // ── HITSTUN ──────────────────────────────
    if (this.state === State.HITSTUN) {
      this.hitstunLeft--;
      if (this.hitstunLeft <= 0 && this.onGround) this.setState(State.IDLE);
      this._applyGravity(dt);
      this.x += this.vx * dt; this.y += this.vy * dt;
      this._resolvePlatforms(platforms);
      return;
    }

    // ── LANDING LAG ──────────────────────────
    if (this.state === State.LANDLAG) {
      if (this.stateTimer >= this.pendingLandLag) { this.pendingLandLag = 0; this.setState(State.IDLE); }
      return;
    }

    // ── ROLL ─────────────────────────────────
    if (this.state === State.ROLL_F || this.state === State.ROLL_B) {
      this.dodgeFrame++;
      // Invuln window
      this.invuln = (this.dodgeFrame >= ROLL_INVULN_START && this.dodgeFrame <= ROLL_INVULN_END) ? 1 : 0;
      // Slide fighter across the ground
      const rollSpeedPerFrame = (ROLL_DISTANCE / ROLL_DURATION) * 60; // px/s
      this.vx = this.dodgeDir * rollSpeedPerFrame;
      if (this.dodgeFrame >= ROLL_DURATION) {
        this.vx = 0; this.invuln = 0;
        this.rollCooldown = ROLL_COOLDOWN;
        this.dodgeFrame   = 0;
        this.setState(State.IDLE);
      }
      this.x += this.vx * dt;
      this._resolvePlatforms(platforms);
      return;
    }

    // ── AIR DODGE ────────────────────────────
    if (this.state === State.AIRDODGE) {
      this.dodgeFrame++;
      this.invuln = (this.dodgeFrame >= AIRDODGE_INVULN_START && this.dodgeFrame <= AIRDODGE_INVULN_END) ? 1 : 0;
      // Momentum decays after invuln window
      if (this.dodgeFrame > AIRDODGE_INVULN_END) {
        this.vx *= 0.85; this.vy *= 0.85;
      }
      if (this.dodgeFrame >= AIRDODGE_DURATION) {
        this.invuln = 0; this.dodgeFrame = 0;
        this.setState(State.AIRBORNE);
      }
      this._applyGravity(dt);
      this.x += this.vx * dt; this.y += this.vy * dt;
      this._resolvePlatforms(platforms);
      return;
    }

    // ── SHIELD (active) ───────────────────────
    if (this.state === State.SHIELD) {
      if (!shieldHeld || this.shield.broken || this.shield.hp <= 0) {
        this.setState(State.IDLE);
      }
      // Cannot act while shielding (except releasing shield)
      return;
    }

    // ── Roll cooldown tick ─────────────────────
    if (this.rollCooldown > 0) this.rollCooldown--;

    const locked = isAttackState(this.state);

    // ── SHIELD RAISE ─────────────────────────
    if (!locked && this.onGround && shieldHeld && this.shield.canRaise()) {
      this.vx = 0; // stop moving when shield goes up
      this.currentMove = null; this.activeHitbox = null;
      this.setState(State.SHIELD);
      return;
    }

    // ── ROLL / AIR DODGE INPUT ────────────────
    if (!locked && keyJust(ctl.dodge)) {
      const l = keyHeld(ctl.left), r = keyHeld(ctl.right);
      const u = keyHeld(ctl.up);
      if (this.onGround && this.rollCooldown === 0) {
        // Ground roll: direction = held input, or forward if neutral
        const dir = r ? 1 : l ? -1 : this.facing;
        this.dodgeDir   = dir;
        this.dodgeFrame = 0;
        this.vx = 0;
        this.setState(dir === this.facing ? State.ROLL_F : State.ROLL_B);
        return;
      } else if (!this.onGround && !this.airdodgeUsed) {
        // Air dodge: launch in held direction (or straight up if neutral)
        const dx = r ? 1 : l ? -1 : 0;
        const dy = u ? -1 : keyHeld(ctl.down) ? 1 : (dx === 0 ? -1 : 0);
        const mag = Math.hypot(dx, dy) || 1;
        this.vx = (dx / mag) * AIRDODGE_SPEED;
        this.vy = (dy / mag) * AIRDODGE_SPEED;
        this.airdodgeUsed = true;
        this.dodgeFrame   = 0;
        this.canFastFall  = false;
        this.setState(State.AIRDODGE);
        return;
      }
    }

    // ── JUMP ─────────────────────────────────
    if (!locked && keyJust(ctl.jump)) {
      if (this.onGround) {
        this.vy = d.jumpVy; this.onGround = false;
        this.canFastFall = true; this.jumpsLeft = d.maxJumps - 1;
        this.currentMove = null; this.setState(State.AIRBORNE);
      } else if (this.jumpsLeft > 0) {
        this.vy = d.dblJumpVy; this.canFastFall = true; this.jumpsLeft--;
        this.currentMove = null; this.setState(State.AIRBORNE);
      }
    }

    // ── FAST FALL ─────────────────────────────
    if (!locked && !this.onGround && keyHeld(ctl.down) && this.vy > -200 && this.canFastFall) {
      this.vy = d.fastFallVy; this.canFastFall = false; this.setState(State.FASTFALL);
    }

    // ── ATTACK INPUT ──────────────────────────
    if (!locked) {
      const air = !this.onGround;
      const l   = keyHeld(ctl.left), r = keyHeld(ctl.right);
      const u   = keyHeld(ctl.up),   d = keyHeld(ctl.down);

      // NORMAL button — directional aerial in air, jab on ground
      // Down+Normal in air = dair (explicit spike input, separate from other aerials)
      if (keyJust(ctl.normal)) {
        if (air) {
          if (d) {
            // Down + Normal → dair (spike)
            this.tryMove('dair');
          } else if (u) {
            this.tryMove('uair');
          } else if ((l && this.facing === 1) ||
                     (r && this.facing === -1)) {
            this.tryMove('bair');
          } else if (l || r) {
            this.tryMove('fair');
          } else {
            this.tryMove('nair');
          }
        } else {
          this.tryMove('jab');
        }
      }

      // SPECIAL button — direction selects which special.
      // All specials work both on ground and in air (airOk:true on neutral/side/down).
      // upSpecial is aerial:true so it only fires in air anyway.
      if (keyJust(ctl.special)) {
        if (u)           this.tryMove('upSpecial');
        else if (d)      this.tryMove('downSpecial');
        else if (l || r) this.tryMove('sideSpecial');
        else             this.tryMove('neutralSpecial');
      }

      // GRAB button — ground only (grab has no airOk)
      if (keyJust(ctl.grab)) this.tryMove('grab');
    }

    // ── HORIZONTAL MOVEMENT ───────────────────
    const moveLocks = locked && this.currentMove?.locksMovement;
    if (!moveLocks) {
      const l = keyHeld(ctl.left), r = keyHeld(ctl.right);
      const inputDir = r ? 1 : l ? -1 : 0;
      const maxSpd = this.onGround ? d.groundSpeed : d.airSpeed;
      const accel  = this.onGround ? d.groundAccel : d.airAccel;
      if (inputDir !== 0) {
        if (!locked) this.facing = inputDir;
        this.vx += inputDir * accel * dt;
        if (Math.abs(this.vx) > maxSpd) this.vx = inputDir * maxSpd;
      } else {
        if (this.onGround) { this.vx *= Math.pow(d.groundFrict, dt*60); if (Math.abs(this.vx) < 4) this.vx = 0; }
        else               { this.vx *= Math.pow(d.airFrict,    dt*60); }
      }
    }

    this._applyGravity(dt);
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this._resolvePlatforms(platforms);
    this._updateMovementState(keyHeld(ctl.right) ? 1 : keyHeld(ctl.left) ? -1 : 0);
  }

  // ── MOVE PHASE TICK ──────────────────────
  // STARTUP → ACTIVE (Hitbox spawns) → ENDLAG → done
  _tickMove() {
    const m  = this.currentMove;
    this.currentFrame++;
    const cf          = this.currentFrame;
    const endStartup  = m.startup;
    const endActive   = m.startup + m.active;
    const endEndlag   = m.startup + m.active + m.endlag;

    if (cf <= endStartup) {
      this.setState(State.STARTUP);
      // Destroy any stale hitbox from a previous activation
      this.activeHitbox = null;
    } else if (cf <= endActive) {
      this.setState(State.ACTIVE);
      // Spawn hitbox on the FIRST frame of ACTIVE only — prevents
      // re-creation (and thus hitTargets reset) on every active frame.
      // To support multi-hit moves: add hitReset interval to moveDef.
      if (!this.activeHitbox) this.activeHitbox = new Hitbox(this, m);
    } else if (cf <= endEndlag) {
      this.setState(State.ENDLAG);
      this.activeHitbox = null;  // hitbox window closed
    } else {
      // Move complete
      this.currentMove  = null;
      this.currentFrame = 0;
      this.activeHitbox = null;
      this.setState(this.onGround ? State.IDLE : State.AIRBORNE);
    }
  }

  _applyGravity(dt) {
    if (!this.onGround) {
      this.vy += GRAVITY * dt;
      if (this.vy > TERMINAL_V) this.vy = TERMINAL_V;
    }
  }

  _resolvePlatforms(platforms) {
    this.onGround = false;
    const sorted = [...platforms].sort((a,b) => (b.isGround?1:0)-(a.isGround?1:0));

    for (const p of sorted) {
      if (this.right <= p.x || this.left >= p.x + p.w) continue;
      const prevBottom = this.bottom - this.vy * FIXED_DT;

      if (this.vy >= 0 && this.bottom >= p.y && prevBottom <= p.y + 2) {
        this.y = p.y - this.h; this.vy = 0;
        this.onGround    = true;
        this.canFastFall = false;
        this.airdodgeUsed= false;   // reset air dodge on landing
        this.jumpsLeft   = this.def.maxJumps;

        // Aerial landing lag
        if (this.currentMove?.aerial && this.currentMove.landLag > 0) {
          this.pendingLandLag = this.currentMove.landLag;
          this.currentMove = null; this.activeHitbox = null; this.currentFrame = 0;
          this.setState(State.LANDLAG); return;
        }
        if (this.state === State.HITSTUN || this.state === State.SHIELDBREAK) {
          this.vx *= 0.4;
          if (this.hitstunLeft <= 0) this.setState(State.IDLE);
        }
      }
    }

    // ── Ledge snap ───────────────────────────
    // Attempt any time the fighter is airborne and not already hanging.
    // Direction and distance checks are handled inside _trySnapLedge().
    if (!this.onGround && this.state !== State.LEDGE) {
      this._trySnapLedge();
    }

    // No side walls — fighters can walk/fly off the edge freely.
    // Blast zone — set flag for GameScene to detect; also clean up state.
    // Uses BLAST constants (left/right/top/bottom) so the layout drives the zone.
    if (this.x + this.w / 2 < BLAST.left  ||
        this.x + this.w / 2 > BLAST.right ||
        this.y + this.h / 2 > BLAST.bottom ||
        this.y + this.h / 2 < BLAST.top) {
      if (!this._blasted) {
        this._blasted = true;
        this.vx = 0; this.vy = 0;
        this.currentMove = null; this.activeHitbox = null;
        this.hitstunLeft = 0;
        if (this.ledge) this.ledge.release();
      }
    }
  }

  // ── LEDGE SNAP ───────────────────────────
  // Modelled on Brawl ledge grab: any airborne fighter within the snap
  // radius of a free ledge grabs it, regardless of velocity direction.
  // The "grab point" is the fighter's upper-body corner (25% down from top),
  // matching where Brawl places the grab hitbox on characters.
  _trySnapLedge() {
    for (const ledge of ledges) {
      if (!ledge.isFree()) continue;

      // Upper-body grab point — 25% down from the top of the sprite,
      // at the near-side horizontal edge (left hand for right ledge, right hand for left ledge).
      const handX = ledge.facing === 1 ? this.left  : this.right;
      const handY = this.top + this.h * 0.25;   // upper-body, not crown

      const dist = Math.hypot(handX - ledge.x, handY - ledge.y);
      if (dist > LEDGE_SNAP_DIST) continue;

      // Only reject if the fighter is INSIDE the stage horizontally —
      // i.e. their center has already passed the ledge into the platform.
      // This prevents accidental ledge grabs when landing on the surface.
      const pastLedge = ledge.facing === 1
        ? this.cx < ledge.x - this.w     // right ledge: center is well inside stage
        : this.cx > ledge.x + this.w;    // left ledge: center is well inside stage
      if (pastLedge) continue;

      // Snap! Pin fighter hanging below the ledge corner.
      this.x  = ledge.facing === 1 ? ledge.x : ledge.x - this.w;
      this.y  = ledge.y;
      this.vx = 0; this.vy = 0;
      this.facing      = -ledge.facing;   // face inward onto the stage
      this.onGround    = false;
      this.ledgeTimer  = 0;
      this.ledgeInvuln = LEDGE_INVULN_FRAMES;
      this.invuln      = LEDGE_INVULN_FRAMES;
      this.currentMove = null; this.activeHitbox = null;
      this.jumpsLeft   = this.def.maxJumps;
      this.airdodgeUsed= false;
      ledge.occupy(this);
      this.setState(State.LEDGE);
      return;
    }
  }

  _updateMovementState(inputDir) {
    if (isAttackState(this.state)) return;
    if (this.state === State.HITSTUN || this.state === State.LANDLAG) return;
    if (this.onGround) {
      if (this.state === State.LANDING) { if (this.stateTimer >= 2) this.setState(State.IDLE); return; }
      if (this.state === State.AIRBORNE || this.state === State.FASTFALL) { this.setState(State.LANDING); return; }
      this.setState(Math.abs(this.vx) > 20 && inputDir !== 0 ? State.RUN : State.IDLE);
    } else {
      if (this.state !== State.FASTFALL) this.setState(State.AIRBORNE);
    }
  }

  _tickFlash() { if (this._flashTimer > 0) this._flashTimer--; }

  _tickHitEffects(dt) {
    this._hitEffects = this._hitEffects.filter(e => e.life > 0);
    for (const e of this._hitEffects) {
      e.life--;
      for (const p of e.particles) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.88; p.vy *= 0.88; }
    }
  }

  // ── DRAW ─────────────────────────────────
  draw(ctx) {
    const d = this.def;
    ctx.save();

    // ── Hit effects (drawn under fighter) ───
    for (const e of this._hitEffects) {
      const t = e.life / e.maxLife;
      ctx.save();
      ctx.globalAlpha = t * 0.9;
      ctx.shadowColor = e.color; ctx.shadowBlur = 10;
      for (const p of e.particles) {
        ctx.fillStyle = e.color;
        const r = 3 + (1 - t) * 4;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI*2); ctx.fill();
      }
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      ctx.restore();
    }

    // ── Roll ghost trail ─────────────────────
    // Faint copy of the fighter's body, offset behind the roll direction,
    // only drawn during the invuln window of a roll.
    if ((this.state === State.ROLL_F || this.state === State.ROLL_B) &&
        this.dodgeFrame >= ROLL_INVULN_START && this.dodgeFrame <= ROLL_INVULN_END) {
      ctx.save();
      ctx.globalAlpha = 0.22;
      if (d.sprite && this.spriteAnim) {
        const frame = this.spriteAnim.currentFrame();
        const ghostOff = -this.dodgeDir * 18;
        const sc = d.spriteScale ?? 3;
        const sx = Math.round(this.x + ghostOff + (d.spriteOffsetX ?? 0));
        const sy = Math.round(this.y + (d.spriteOffsetY ?? 0));
        this._sheet.drawFrame(ctx, frame, sx, sy, sc, this.facing, 0.22);
      } else {
        ctx.fillStyle = d.color;
        const ghostOff = -this.dodgeDir * 18;
        ctx.fillRect(Math.round(this.x + ghostOff), Math.round(this.y), this.w, this.h);
      }
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    // ── Hurtboxes (debug overlay) ────────────
    if (debugMode) {
      for (const hb of this.hurtboxes) hb.draw(ctx);
    }

    // ── Body / Sprite ─────────────────────────
    if (d.sprite && this.spriteAnim && this._sheet?.ready) {
      // ── Sprite path ────────────────────────
      const frame = this.spriteAnim.currentFrame();
      const sc    = d.spriteScale ?? 3;
      const ox    = d.spriteOffsetX ?? 0;
      const oy    = d.spriteOffsetY ?? 0;

      // Sprite draw position: align bottom of sprite with bottom of collision box
      // Frame height varies; pin feet to fighter bottom
      const frameH = frame ? frame.h * sc : this.h;
      const frameW = frame ? frame.w * sc : this.w;
      const sx = Math.round(this.cx - frameW / 2 + ox * this.facing);
      const sy = Math.round(this.bottom - frameH + oy);

      // Invuln blink — skip draw every other 2-tick pair
      const invulnBlink = this.invuln > 0 && Math.floor(this.stateTimer / 2) % 2 === 0;
      const flashWhite  = this._flashTimer > 0 && this._flashTimer % 2 === 0;

      if (!invulnBlink) {
        ctx.save();

        // Hit-pause glow
        if (this.hitPauseLeft > 0 || flashWhite) {
          ctx.shadowColor = flashWhite ? '#ffffff' : d.shadowColor;
          ctx.shadowBlur  = flashWhite ? 20 : 30;
        } else {
          ctx.shadowColor = d.shadowColor;
          ctx.shadowBlur  = 12;
        }

        // Tint during special states using a colored overlay on top
        let tintColor = null, tintAlpha = 0;
        if (this.state === State.ACTIVE)       { tintColor='#ff2244'; tintAlpha=0.35; }
        else if (this.state === State.STARTUP) { tintColor='#ff8800'; tintAlpha=0.25; }
        else if (this.state === State.ENDLAG)  { tintColor='#aa44ff'; tintAlpha=0.20; }
        else if (this.state === State.HITSTUN) { tintColor='#ffffff'; tintAlpha=0.30; }
        else if (this.state === State.LEDGE)   { tintColor='#00ffc8'; tintAlpha=0.15; }

        this._sheet.drawFrame(ctx, frame, sx, sy, sc, this.facing);

        // Tint overlay: draw colored rect blended on top
        if (tintColor) {
          ctx.globalCompositeOperation = 'source-atop';
          // Clip to sprite bounds then fill tint
          ctx.save();
          ctx.globalAlpha = tintAlpha;
          ctx.fillStyle = tintColor;
          ctx.fillRect(sx, sy, frameW, frameH);
          ctx.restore();
          ctx.globalCompositeOperation = 'source-over';
        }

        ctx.shadowBlur = 0;
        ctx.restore();
      }

    } else if (!d.sprite) {
      // ── Rectangle fallback (non-sprite fighters only) ────
      ctx.shadowColor = d.shadowColor;
      ctx.shadowBlur  = this.hitPauseLeft > 0 ? 30 : 16;

      const flashWhite = this._flashTimer > 0 && this._flashTimer % 2 === 0;
      let bodyColor = d.color;
      if      (flashWhite)                             bodyColor = '#ffffff';
      else if (this.state === State.STARTUP)           bodyColor = lerpHex(d.color, '#ff8800', 0.5);
      else if (this.state === State.ACTIVE)            bodyColor = lerpHex(d.color, '#ff2244', 0.6);
      else if (this.state === State.ENDLAG)            bodyColor = lerpHex(d.color, '#aa44ff', 0.4);
      else if (this.state === State.LANDLAG)           bodyColor = lerpHex(d.color, '#aa44ff', 0.5);
      else if (this.state === State.HITSTUN)           bodyColor = lerpHex(d.color, '#ffffff', 0.45);
      else if (this.state === State.SHIELD)            bodyColor = lerpHex(d.color, '#4488ff', 0.4);
      else if (this.state === State.SHIELDSTUN)        bodyColor = lerpHex(d.color, '#4488ff', 0.7);
      else if (this.state === State.SHIELDBREAK)       bodyColor = '#ff2244';
      else if (this.state === State.LEDGE)             bodyColor = lerpHex(d.color, '#00ffc8', 0.35);

      const invulnBlink = this.invuln > 0 && Math.floor(this.stateTimer / 2) % 2 === 0;
      const landBlink   = this.state === State.LANDING && this.stateTimer % 2 === 0;
      ctx.fillStyle = (landBlink || invulnBlink) ? '#ffffff' : bodyColor;
      ctx.fillRect(Math.round(this.x), Math.round(this.y), this.w, this.h);

      ctx.shadowBlur  = 0;
      ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(this.x)+.5, Math.round(this.y)+.5, this.w-1, this.h-1);

      // Eye dot
      const eyeX = this.facing === 1 ? this.x + this.w*0.72 : this.x + this.w*0.28;
      ctx.fillStyle='#fff'; ctx.shadowColor='#fff'; ctx.shadowBlur=5;
      ctx.beginPath(); ctx.arc(eyeX, this.y + this.h*0.28, 4, 0, Math.PI*2); ctx.fill();
      ctx.shadowBlur=0;
    }

    // ── Shield bubble ─────────────────────────
    if (this.state === State.SHIELD || this.state === State.SHIELDSTUN) {
      const radius = this.shield.bubbleRadius(this);
      const frac   = this.shield.fraction;
      // Color shifts from blue → yellow → red as shield shrinks
      const bubbleColor = frac > 0.5
        ? lerpHex('#4488ff', '#ffee00', 1 - (frac - 0.5) * 2)
        : lerpHex('#ffee00', '#ff2244', 1 - frac * 2);

      ctx.save();
      ctx.globalAlpha = 0.35 + frac * 0.25;
      ctx.shadowColor = bubbleColor; ctx.shadowBlur = 18;
      ctx.strokeStyle = bubbleColor; ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(this.cx, this.cy - this.h * 0.1, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.08 + frac * 0.10;
      ctx.fillStyle = bubbleColor;
      ctx.fill();
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      ctx.restore();
    }

    // ── Shield-break shockwave ────────────────
    if (this.state === State.SHIELDBREAK && this.stateTimer < 20) {
      const t = this.stateTimer / 20;
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.7;
      ctx.shadowColor = '#ff2244'; ctx.shadowBlur = 20;
      ctx.strokeStyle = '#ff2244'; ctx.lineWidth = 3;
      const sr = 30 + t * 80;
      ctx.beginPath(); ctx.arc(this.cx, this.cy, sr, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      ctx.restore();
    }

    // ── Ledge hang indicator ──────────────────
    if (this.state === State.LEDGE) {
      // Draw a small grip indicator at the ledge corner
      const gripX = this.facing === -1 ? this.right : this.left;
      const gripY = this.top;
      ctx.save();
      ctx.shadowColor = '#00ffc8'; ctx.shadowBlur = 12;
      ctx.fillStyle   = '#00ffc8';
      ctx.beginPath(); ctx.arc(gripX, gripY, 5, 0, Math.PI * 2); ctx.fill();
      // Invuln remaining bar — tiny horizontal bar above fighter
      if (this.ledgeInvuln > 0) {
        const barW = this.w;
        const pct  = this.ledgeInvuln / LEDGE_INVULN_FRAMES;
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = '#00ffc8';
        ctx.fillRect(Math.round(this.x), Math.round(this.y - 6), Math.round(barW * pct), 3);
        ctx.globalAlpha = 1;
      }
      ctx.shadowBlur = 0;
      ctx.restore();
    }

    // ── Active Hitbox ─────────────────────────
    if (this.activeHitbox) {
      this.activeHitbox.draw(ctx);
      if (debugMode) {
        const r = this.activeHitbox.getRect();
        ctx.fillStyle = '#ffffff'; ctx.font = '7px monospace'; ctx.textAlign = 'center';
        ctx.fillText(`HB#${this.activeHitbox.id} hits:${this.activeHitbox.hitTargets.size}`, r.x+r.w/2, r.y-3);
      }
    }

    // ── State / move label ────────────────────
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.font = '8px "Share Tech Mono",monospace'; ctx.textAlign = 'center';
    const lbl = this.currentMove
      ? `${this.currentMove.id} [${this.currentFrame}]`
      : this.state;
    ctx.fillText(lbl, this.cx, this.y - 5);

    // ── Velocity vector ───────────────────────
    ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(this.cx,this.cy); ctx.lineTo(this.cx+this.vx*0.04, this.cy+this.vy*0.04); ctx.stroke();

    ctx.restore();
  }

  phaseBarData() {
    if (!this.currentMove) return null;
    const m = this.currentMove, cf = this.currentFrame;
    const tot = m.startup + m.active + m.endlag;
    const pct = Math.min(1, cf / tot);
    const color = cf <= m.startup ? 'var(--startup)'
                : cf <= m.startup + m.active ? 'var(--active)' : 'var(--endlag)';
    return { pct, color };
  }
}

// ═══════════════════════════════════════════════════════════
//  HITBOX ↔ HURTBOX RESOLUTION
//
//  Architecture:
//   1. Iterate every fighter's active Hitbox.
//   2. For each live Hitbox, iterate every OTHER fighter's Hurtboxes.
//   3. Test AABB overlap (Hitbox.overlapsHurtbox).
//   4. If overlap AND target not already in hitTargets:
//      a. Mark target in hitTargets (prevents multi-hit THIS activation).
//      b. Compute knockback via computeKnockback().
//      c. Queue a HitEvent — do NOT mutate any fighter yet.
//   5. After all checks: apply all queued HitEvents (applyHit + applyHitPause).
//
//  Deferred application (step 5) is critical: it means Fighter A's hit on
//  Fighter B is computed using B's CURRENT damage percentage (before the
//  hit adds to it), and B's state mutation doesn't affect A's hitbox test.
//
//  Returns: number of hits registered this tick.
// ═══════════════════════════════════════════════════════════
function resolveHitboxes(fighters) {
  const events       = [];   // normal hits
  const shieldEvents = [];   // hits absorbed by shield

  for (const attacker of fighters) {
    if (!attacker.activeHitbox) continue;
    const hitbox = attacker.activeHitbox;

    for (const defender of fighters) {
      if (defender === attacker)                  continue;
      if (hitbox.hitTargets.has(defender))        continue;  // anti-multi-hit
      if (defender.state === State.HITSTUN)       continue;
      if (defender.state === State.SHIELDBREAK)   continue;
      if (defender.hitPauseLeft > 0)              continue;

      // ── Shield intercept ──────────────────────
      // If the defender is actively shielding AND the hitbox touches their
      // body rect (not just hurtbox — shield covers the full body), route
      // the hit to the shield instead of applying knockback.
      if (defender.state === State.SHIELD || defender.state === State.SHIELDSTUN) {
        // Quick AABB test against defender's body rect
        const hr  = hitbox.getRect();
        const inX = hr.x < defender.right && hr.x + hr.w > defender.left;
        const inY = hr.y < defender.bottom && hr.y + hr.h > defender.top;
        if (inX && inY) {
          hitbox.hitTargets.add(defender);
          shieldEvents.push(new HitEvent(attacker, defender, hitbox.moveDef,
            computeKnockback(hitbox.moveDef, defender.damage, attacker.facing, defender.def.weight)));
          continue;
        }
      }

      // ── Normal hurtbox test ───────────────────
      let hitAny = false;
      for (const hurtbox of defender.hurtboxes) {
        if (!hurtbox.active) continue;
        if (hitbox.overlapsHurtbox(hurtbox)) { hitAny = true; break; }
      }

      if (hitAny) {
        hitbox.hitTargets.add(defender);
        const kb = computeKnockback(hitbox.moveDef, defender.damage, attacker.facing, defender.def.weight);
        events.push(new HitEvent(attacker, defender, hitbox.moveDef, kb));
      }
    }
  }

  // Apply shield hits
  for (const ev of shieldEvents) {
    ev.defender.absorbOnShield(ev);
    hitCount++;
  }

  // Apply normal hits atomically
  for (const ev of events) {
    ev.defender.applyHit(ev);
    ev.attacker.applyHitPause(ev.kbResult.hitPauseFrames);
    ev.defender.applyHitPause(ev.kbResult.hitPauseFrames);
    hitCount++;
  }

  return events.length + shieldEvents.length;
}

// ═══════════════════════════════════════════════════════════
//  STAGE
// ═══════════════════════════════════════════════════════════
const stage = { width: 960, height: 540 };

// ── Final Destination-style layout ───────────────────────
//   Main floor:  wide single platform elevated above the void
//   Two floaters: symmetric left/right, slightly above center
//   No side walls — characters walk off edges into the blast zone
const FLOOR_X = 80, FLOOR_Y = 420, FLOOR_W = 800, FLOOR_H = 22;
const PLAT_H  = 14;
const PLAT_L  = { x: 220, y: 285, w: 190 };   // left floating platform
const PLAT_R  = { x: 550, y: 285, w: 190 };   // right floating platform

const platforms = [
  new Platform(FLOOR_X, FLOOR_Y, FLOOR_W, FLOOR_H, true),
  new Platform(PLAT_L.x, PLAT_L.y, PLAT_L.w, PLAT_H),
  new Platform(PLAT_R.x, PLAT_R.y, PLAT_R.w, PLAT_H),
];

// ── Blast zone boundaries ─────────────────────────────────
// Characters outside these bounds lose a stock.
// Generous horizontal/vertical margins allow recovery attempts.
const BLAST = { left: -280, right: 1240, top: -200, bottom: 760 };

// ── Ledge snap points ─────────────────────────────────────
// Main floor: left and right edges
// Each floating platform: left and right edges
const ledges = [
  new Ledge(FLOOR_X,            FLOOR_Y, -1),
  new Ledge(FLOOR_X + FLOOR_W,  FLOOR_Y, +1),
  new Ledge(PLAT_L.x,           PLAT_L.y, -1),
  new Ledge(PLAT_L.x + PLAT_L.w, PLAT_L.y, +1),
  new Ledge(PLAT_R.x,           PLAT_R.y, -1),
  new Ledge(PLAT_R.x + PLAT_R.w, PLAT_R.y, +1),
];

// ═══════════════════════════════════════════════════════════
//  FIGHTER INSTANCES
// ═══════════════════════════════════════════════════════════
const fighters = [
  new Fighter('MARTH', 310, 300, {
    left:'KeyA', right:'KeyD', up:'KeyW', down:'KeyS', jump:'KeyW',
    normal:'KeyJ', special:'KeyK', grab:'KeyL',
    shield:'KeyF', dodge:'KeyG',
  }),
  new Fighter('MARTH', 650, 300, {
    left:'ArrowLeft', right:'ArrowRight', up:'ArrowUp', down:'ArrowDown', jump:'ArrowUp',
    normal:'Numpad1', special:'Numpad2', grab:'Numpad3',
    shield:'Numpad5', dodge:'Numpad6',
  }),
];

// ═══════════════════════════════════════════════════════════
//  RENDERER
// ═══════════════════════════════════════════════════════════
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
canvas.width  = stage.width;
canvas.height = stage.height;
document.getElementById('canvas-wrap').style.width  = stage.width  + 'px';
document.getElementById('canvas-wrap').style.height = stage.height + 'px';

function drawBackground() {
  // Deep space void — FD aesthetic
  const bg = ctx.createLinearGradient(0, 0, 0, stage.height);
  bg.addColorStop(0,   '#04040f');
  bg.addColorStop(0.5, '#070718');
  bg.addColorStop(1,   '#020208');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, stage.width, stage.height);

  // Subtle star field
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  // Deterministic stars using a fixed seed pattern
  const stars = [
    [48,30],[120,88],[210,22],[310,65],[400,40],[510,18],[620,72],[730,30],[850,55],[920,20],
    [70,150],[180,130],[290,170],[430,120],[540,160],[660,140],[780,115],[900,145],
    [35,230],[150,200],[270,250],[390,215],[500,240],[640,195],[760,220],[880,245],
    [95,310],[220,340],[370,300],[490,330],[580,305],[700,355],[820,315],[940,340],
    [55,400],[165,380],[850,390],[940,410],[30,460],[180,450],[820,455],[930,480],
  ];
  for (const [sx, sy] of stars) {
    const r = ((sx * 7 + sy * 13) % 3 === 0) ? 1.5 : 0.8;
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();

  // Faint horizon glow behind the main platform
  ctx.save();
  const glow = ctx.createRadialGradient(stage.width/2, FLOOR_Y + 20, 10, stage.width/2, FLOOR_Y + 20, 500);
  glow.addColorStop(0,   'rgba(0,180,255,0.07)');
  glow.addColorStop(0.4, 'rgba(0,100,200,0.04)');
  glow.addColorStop(1,   'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, stage.width, stage.height);
  ctx.restore();
}

function drawPlatforms() {
  for (const p of platforms) {
    ctx.save();
    if (p.isGround) {
      // ── Main floor — FD-style sleek slab ───────────────
      const radius = 10;

      // Underside fade (void shadow beneath the floor)
      const underGlow = ctx.createLinearGradient(0, p.y, 0, p.y + p.h + 60);
      underGlow.addColorStop(0,   'rgba(0,160,255,0.12)');
      underGlow.addColorStop(1,   'rgba(0,0,0,0)');
      ctx.fillStyle = underGlow;
      ctx.fillRect(p.x - 20, p.y, p.w + 40, 80);

      // Main body — rounded rect fill
      const bodyGrad = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
      bodyGrad.addColorStop(0, '#1a3050');
      bodyGrad.addColorStop(1, '#0a1828');
      ctx.fillStyle = bodyGrad;
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, p.w, p.h, radius);
      ctx.fill();

      // Top surface glow line — the iconic FD edge strip
      ctx.shadowColor = '#00c8ff';
      ctx.shadowBlur  = 12;
      ctx.strokeStyle = '#00c8ff';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(p.x + radius, p.y + 1);
      ctx.lineTo(p.x + p.w - radius, p.y + 1);
      ctx.stroke();

      // Left and right curved end caps (brighter)
      ctx.shadowBlur  = 8;
      ctx.strokeStyle = 'rgba(0,200,255,0.5)';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.arc(p.x + radius, p.y + radius, radius, Math.PI, 1.5 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.x + p.w - radius, p.y + radius, radius, 1.5 * Math.PI, 2 * Math.PI);
      ctx.stroke();

      // Subtle centre line marker
      ctx.shadowBlur  = 0;
      ctx.strokeStyle = 'rgba(0,180,255,0.15)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(p.x + p.w / 2, p.y + 4);
      ctx.lineTo(p.x + p.w / 2, p.y + p.h - 2);
      ctx.stroke();

    } else {
      // ── Floating platforms — thin translucent pads ──────
      const bodyGrad = ctx.createLinearGradient(0, p.y, 0, p.y + p.h);
      bodyGrad.addColorStop(0, 'rgba(40,80,160,0.7)');
      bodyGrad.addColorStop(1, 'rgba(20,40,100,0.5)');
      ctx.fillStyle = bodyGrad;
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, p.w, p.h, 5);
      ctx.fill();

      // Top edge glow
      ctx.shadowColor = 'rgba(80,140,255,0.9)';
      ctx.shadowBlur  = 10;
      ctx.strokeStyle = '#4080ff';
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x + 5, p.y + 1);
      ctx.lineTo(p.x + p.w - 5, p.y + 1);
      ctx.stroke();

      // Left/right edge end caps
      ctx.shadowBlur  = 5;
      ctx.fillStyle   = 'rgba(80,140,255,0.8)';
      ctx.fillRect(p.x, p.y, 3, p.h);
      ctx.fillRect(p.x + p.w - 3, p.y, 3, p.h);
    }
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

function drawLedges() {
  for (const lg of ledges) {
    // Draw a small notch at the ledge corner, brighter if occupied
    const occupied = !lg.isFree();
    ctx.save();
    ctx.shadowColor = occupied ? '#00ffc8' : 'rgba(0,255,200,0.4)';
    ctx.shadowBlur  = occupied ? 10 : 4;
    ctx.fillStyle   = occupied ? '#00ffc8' : 'rgba(0,255,200,0.35)';
    ctx.beginPath();
    ctx.arc(lg.x, lg.y, occupied ? 5 : 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.restore();
  }
}

function render() {
  drawBackground();
  drawPlatforms();
  drawLedges();
  fighters.forEach(f => f.draw(ctx));

  // Debug overlay banner
  if (debugMode) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,238,0,0.15)';
    ctx.fillRect(0,0,stage.width,20);
    ctx.fillStyle = '#ffee00'; ctx.font = '10px "Share Tech Mono",monospace'; ctx.textAlign='center';
    ctx.fillText('DEBUG MODE — Tab to toggle  |  Red=Hitbox  Blue=Hurtbox  Cyan=Ledge', stage.width/2, 13);
    ctx.restore();
  }
}

// ═══════════════════════════════════════════════════════════
//  HUD
// ═══════════════════════════════════════════════════════════
const hudEl = ['p1','p2'].map(id => ({
  dmg:       document.getElementById(`${id}-dmg`),
  state:     document.getElementById(`${id}-state`),
  move:      document.getElementById(`${id}-move`),
  frame:     document.getElementById(`${id}-frame`),
  stun:      document.getElementById(`${id}-stun`),
  jumps:     document.getElementById(`${id}-jumps`),
  shield:    document.getElementById(`${id}-shield`),
  ledgeDot:  document.getElementById(`${id}-ledge`),
  phase:     document.getElementById(`${id}-phase`),
  stunBar:   document.getElementById(`${id}-stun-bar`),
  shieldBar: document.getElementById(`${id}-shield-bar`),
}));
const fpsEl       = document.getElementById('fps');
const tickEl      = document.getElementById('tick');
const hitsEl      = document.getElementById('hits');
const hitPauseEl  = document.getElementById('hitpause');
const debugModeEl = document.getElementById('debug-mode');

function updateHUD(fps, tick) {
  fighters.forEach((f, i) => {
    const el = hudEl[i];
    const dmgStr = `${Math.round(f.damage)}%`;
    if (el.dmg.textContent !== dmgStr) {
      el.dmg.textContent = dmgStr;
      el.dmg.classList.add('flash');
      setTimeout(() => el.dmg.classList.remove('flash'), 140);
    }
    el.state.textContent = f.state;
    el.move.textContent  = f.currentMove ? f.currentMove.id : '—';
    el.frame.textContent = f.currentMove
      ? `${f.currentFrame}/${f.currentMove.startup+f.currentMove.active+f.currentMove.endlag}` : '—';
    el.stun.textContent  = f.state === State.HITSTUN ? f.hitstunLeft : '—';
    el.jumps.textContent = f.jumpsLeft;

    // Shield bar
    const shp  = Math.round(f.shield.hp);
    el.shield.textContent = f.shield.broken ? 'BREAK' : shp;
    el.shield.style.color = f.shield.broken ? '#ff2244'
      : f.shield.hp < 30 ? '#ffee00' : '';
    el.shieldBar.style.width      = (f.shield.fraction * 100) + '%';
    el.shieldBar.classList.toggle('broken', f.shield.broken);

    // Ledge dot
    el.ledgeDot.classList.toggle('active', f.state === State.LEDGE);

    const pb = f.phaseBarData();
    if (pb) { el.phase.style.width = (pb.pct*100)+'%'; el.phase.style.background = pb.color; }
    else    { el.phase.style.width = '0%'; }

    const stunPct = f.hitstunMax > 0 ? f.hitstunLeft / f.hitstunMax : 0;
    el.stunBar.style.width = (stunPct*100)+'%';
  });

  fpsEl.textContent       = fps;
  tickEl.textContent      = tick;
  hitsEl.textContent      = hitCount;
  hitPauseEl.textContent  = Math.max(...fighters.map(f => f.hitPauseLeft));
  debugModeEl.textContent = debugMode ? 'ON' : 'OFF';
  debugModeEl.style.color = debugMode ? '#ffee00' : '';
}

// ═══════════════════════════════════════════════════════════
//  GAME LOOP  (wrapped by SceneManager — see below)
// ═══════════════════════════════════════════════════════════
let prevTime=null, accumulator=0, totalTick=0, hitCount=0;
let fpsFrames=0, fpsAccum=0, displayFps=60;

// Core physics tick used by GameScene
function gamePhysicsTick() {
  fighters.forEach(f => f.update(FIXED_DT, platforms));
  resolveHitboxes(fighters);
  // NOTE: clearJust() is NOT called here. It runs once per render frame
  // in the master loop, after all physics ticks complete. This ensures
  // a justPressed input survives an entire multi-tick catch-up batch
  // and is never dropped between ticks.
  totalTick++;
}

// ── Utility ────────────────────────────────────
function lerpHex(a, b, t) {
  const pa=parseInt(a.slice(1),16), pb=parseInt(b.slice(1),16);
  const ar=(pa>>16)&0xff,ag=(pa>>8)&0xff,ab=pa&0xff;
  const br=(pb>>16)&0xff,bg=(pb>>8)&0xff,bb=pb&0xff;
  const rr=Math.round(ar+(br-ar)*t),rg=Math.round(ag+(bg-ag)*t),rb=Math.round(ab+(bb-ab)*t);
  return `#${rr.toString(16).padStart(2,'0')}${rg.toString(16).padStart(2,'0')}${rb.toString(16).padStart(2,'0')}`;
}

// ═══════════════════════════════════════════════════════════
//  UI CANVAS
//  Separate full-screen canvas used by all menu scenes.
//  Game canvas (960×540) is fixed; UI canvas stretches to window.
// ═══════════════════════════════════════════════════════════
const uiCanvas = document.getElementById('ui-canvas');
const uiCtx    = uiCanvas.getContext('2d');

function resizeUICanvas() {
  uiCanvas.width  = window.innerWidth;
  uiCanvas.height = window.innerHeight;
}
resizeUICanvas();
window.addEventListener('resize', resizeUICanvas);

// Shorthand for centered UI canvas dimensions
const UI = {
  get w() { return uiCanvas.width; },
  get h() { return uiCanvas.height; },
  get cx(){ return uiCanvas.width  / 2; },
  get cy(){ return uiCanvas.height / 2; },
};

// ── Canvas drawing utilities ──────────────────────────────

function uiFillRect(x, y, w, h, color, alpha=1) {
  uiCtx.save();
  uiCtx.globalAlpha = alpha;
  uiCtx.fillStyle   = color;
  uiCtx.fillRect(x, y, w, h);
  uiCtx.restore();
}

function uiText(txt, x, y, { size=18, color='#c8d8e8', align='center', font='Orbitron', alpha=1, glow=null }={}) {
  uiCtx.save();
  uiCtx.globalAlpha  = alpha;
  uiCtx.font         = `900 ${size}px "${font}", monospace`;
  uiCtx.fillStyle    = color;
  uiCtx.textAlign    = align;
  uiCtx.textBaseline = 'middle';
  if (glow) { uiCtx.shadowColor = glow; uiCtx.shadowBlur = 18; }
  uiCtx.fillText(txt, x, y);
  uiCtx.restore();
}

function uiMonoText(txt, x, y, { size=13, color='#c8d8e8', align='center', alpha=1 }={}) {
  uiCtx.save();
  uiCtx.globalAlpha  = alpha;
  uiCtx.font         = `${size}px "Share Tech Mono", monospace`;
  uiCtx.fillStyle    = color;
  uiCtx.textAlign    = align;
  uiCtx.textBaseline = 'middle';
  uiCtx.fillText(txt, x, y);
  uiCtx.restore();
}

function uiLine(x1, y1, x2, y2, color='#1e1e38', width=1, alpha=1) {
  uiCtx.save();
  uiCtx.globalAlpha  = alpha;
  uiCtx.strokeStyle  = color;
  uiCtx.lineWidth    = width;
  uiCtx.beginPath(); uiCtx.moveTo(x1,y1); uiCtx.lineTo(x2,y2); uiCtx.stroke();
  uiCtx.restore();
}

function uiRect(x, y, w, h, color='#1e1e38', width=1, alpha=1) {
  uiCtx.save();
  uiCtx.globalAlpha = alpha;
  uiCtx.strokeStyle = color;
  uiCtx.lineWidth   = width;
  uiCtx.strokeRect(x+.5, y+.5, w-1, h-1);
  uiCtx.restore();
}

// Stat bar: label + filled bar
function uiStatBar(label, value, x, y, barW, color) {
  uiMonoText(label, x, y, { align:'left', size:11, color:'#4a5568' });
  uiFillRect(x+60, y-6, barW, 11, '#0a0a1a');
  uiFillRect(x+60, y-6, Math.round(barW * value), 11, color, 0.85);
  uiRect(x+60, y-6, barW, 11, '#1e1e38');
}

// Scanline overlay for all scenes
function uiScanlines() {
  uiCtx.save();
  uiCtx.globalAlpha = 0.04;
  uiCtx.fillStyle   = '#000000';
  for (let y = 0; y < UI.h; y += 4) uiCtx.fillRect(0, y, UI.w, 2);
  uiCtx.restore();
}

// Vignette
function uiVignette() {
  const g = uiCtx.createRadialGradient(UI.cx, UI.cy, UI.h * 0.2, UI.cx, UI.cy, UI.h * 0.75);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,20,0.55)');
  uiCtx.save();
  uiCtx.fillStyle = g;
  uiCtx.fillRect(0, 0, UI.w, UI.h);
  uiCtx.restore();
}

// Animated grid background for menus
function uiGridBackground(t) {
  uiFillRect(0, 0, UI.w, UI.h, '#080810');
  const spacing = 60;
  const offset  = (t * 12) % spacing;
  uiCtx.save();
  uiCtx.strokeStyle = 'rgba(30,30,60,0.5)';
  uiCtx.lineWidth   = 1;
  for (let x = -spacing + (offset % spacing); x < UI.w + spacing; x += spacing) {
    uiCtx.beginPath(); uiCtx.moveTo(x,0); uiCtx.lineTo(x,UI.h); uiCtx.stroke();
  }
  for (let y = 0; y < UI.h + spacing; y += spacing) {
    uiCtx.beginPath(); uiCtx.moveTo(0,y); uiCtx.lineTo(UI.w,y); uiCtx.stroke();
  }
  uiCtx.restore();
}

// Horizontal separator
function uiSeparator(y, alpha=0.3) {
  uiLine(UI.cx - 200, y, UI.cx + 200, y, '#00ffc8', 1, alpha);
}

// ── Transition helper ─────────────────────────────────────
// Returns 0–1 ease-in-out value for t in [0, duration]
function easeInOut(t, duration) {
  const x = Math.min(1, t / duration);
  return x < 0.5 ? 2*x*x : -1+(4-2*x)*x;
}

// ═══════════════════════════════════════════════════════════
//  CHARACTER ROSTER DATA
//  Maps FIGHTER_DEFS names to display metadata + stat values.
//  Stats are 0–1 fractions used by the stat bars.
// ═══════════════════════════════════════════════════════════
const ROSTER = [
  {
    defName:     'MARTH',
    displayName: 'MARTH',
    subtitle:    'Noble Swordfighter',
    color:       '#c8a0ff',
    stats: { speed: 0.66, weight: 0.52, power: 0.65, range: 0.88 },
    description: 'Elegant swordfighter. Tipper sweetspot rewards precision.',
  },
  {
    defName:     'AERIS',
    displayName: 'AERIS',
    subtitle:    'Balanced Swordfighter',
    color:       '#40e0d0',
    stats: { speed: 0.70, weight: 0.55, power: 0.68, range: 0.82 },
    description: 'Versatile warrior. Balanced stats with fluid sword combos.',
  },
];

// ═══════════════════════════════════════════════════════════
//  MATCH CONFIG
//  Shared object populated by CharacterSelectScene,
//  read by GameScene and VictoryScene.
// ═══════════════════════════════════════════════════════════
const MatchConfig = {
  p1RosterIdx:  0,
  p2RosterIdx:  0,
  p2IsCPU:      false,
  stocks:        3,
  timeLimit:     0,      // 0 = no timer
  mode:         'vs',    // 'vs' | 'training'
};

// ═══════════════════════════════════════════════════════════
//  BASE SCENE
//  All scenes extend this. SceneManager calls enter/exit/update/render.
// ═══════════════════════════════════════════════════════════
class Scene {
  constructor(name) { this.name = name; this._t = 0; }

  // Called when scene becomes active
  enter(params) { this._t = 0; }

  // Called when scene is about to be replaced
  exit() {}

  // Called every animation frame (dt in seconds)
  update(dt) { this._t += dt; }

  // Render to uiCanvas — must clear first
  render() {}

  // Called on keydown. e = KeyboardEvent
  onKey(e) {}

  // Called on mouse events routed from uiCanvas.
  // type = 'move' | 'click'    x/y = UI canvas coords
  onMouse(type, x, y) {}
}

// ═══════════════════════════════════════════════════════════
//  SCENE MANAGER
//  Singleton. Holds the active scene and handles transitions.
// ═══════════════════════════════════════════════════════════
class SceneManager {
  constructor() {
    this._scene       = null;
    this._next        = null;
    this._fadeOut     = 0;     // countdown for fade-to-black before switch
    this._fadeIn      = 0;     // countdown for fade-from-black after switch
    this._fadeAlpha   = 0;
    this.FADE_FRAMES  = 18;    // frames for each half of transition
  }

  // Register all scenes
  init(scenes) {
    this._scenes = {};
    for (const s of scenes) this._scenes[s.name] = s;
  }

  // Switch immediately or queue transition
  goto(name, params={}, instant=false) {
    if (instant) {
      if (this._scene) this._scene.exit();
      this._scene = this._scenes[name];
      this._scene.enter(params);
      this._params = null;
    } else {
      this._next    = name;
      this._params  = params;
      this._fadeOut = this.FADE_FRAMES;
    }
  }

  // Resume a scene without calling enter() — used by PauseScene to unfreeze Game
  resume(name) {
    if (this._scene) this._scene.exit();
    this._scene     = this._scenes[name];
    this._fadeAlpha = 0;
    this._fadeOut   = 0;
    this._fadeIn    = 0;
    // Do NOT call enter() — preserve all game state
  }

  get current() { return this._scene?.name; }

  update(dt) {
    // Fade-out phase
    if (this._fadeOut > 0) {
      this._fadeOut--;
      this._fadeAlpha = 1 - this._fadeOut / this.FADE_FRAMES;
      if (this._fadeOut === 0) {
        // Execute scene switch
        if (this._scene) this._scene.exit();
        this._scene  = this._scenes[this._next];
        this._fadeIn = this.FADE_FRAMES;
        this._scene.enter(this._params || {});
      }
      this._scene?.update(dt);
      return;
    }
    // Fade-in phase
    if (this._fadeIn > 0) {
      this._fadeIn--;
      this._fadeAlpha = this._fadeIn / this.FADE_FRAMES;
    } else {
      this._fadeAlpha = 0;
    }
    this._scene?.update(dt);
  }

  render() {
    this._scene?.render();
    // Black fade overlay
    if (this._fadeAlpha > 0) {
      uiFillRect(0, 0, UI.w, UI.h, '#000000', this._fadeAlpha);
    }
  }

  onKey(e)            { this._scene?.onKey(e); }
  onMouse(type, x, y) { this._scene?.onMouse(type, x, y); }
}

const SM = new SceneManager();

// ═══════════════════════════════════════════════════════════
//  MAIN MENU SCENE
// ═══════════════════════════════════════════════════════════
class MainMenuScene extends Scene {
  constructor() {
    super('MainMenu');
    this._options  = ['START GAME', 'TRAINING MODE', 'OPTIONS'];
    this._sel      = 0;
    this._pulse    = 0;
  }

  enter() {
    super.enter();
    document.getElementById('app').classList.add('menu-active');
    uiCanvas.classList.add('ui-interactive');
    uiCanvas.style.cursor = 'default';
    // Black out game canvas so it doesn't show through
    ctx.fillStyle = '#080810';
    ctx.fillRect(0, 0, stage.width, stage.height);
  }

  exit() {
    document.getElementById('app').classList.remove('menu-active');
    uiCanvas.classList.remove('ui-interactive');
    uiCanvas.style.cursor = 'default';
  }

  update(dt) {
    super.update(dt);
    this._pulse += dt * 2.4;
  }

  render() {
    const W = UI.w, H = UI.h, CX = UI.cx, CY = UI.cy;
    uiGridBackground(this._t);
    uiVignette();

    // ── Title block ───────────────────────────
    const titleY    = H * 0.26;
    const fontSize  = Math.min(Math.round(W * 0.072), 96); // cap so it never outgrows spacing
    const lineGap   = Math.round(fontSize * 1.15);         // spacing scales with the font
    uiText('PLATFORM', CX, titleY - lineGap * 0.5, { size: fontSize, color: '#00ffc8', glow: '#00ffc8' });
    uiText('FIGHTER',  CX, titleY + lineGap * 0.5, { size: fontSize, color: '#ffffff' });

    // Subtitle and separator anchored below the second title word
    const titleBottom = titleY + lineGap * 0.5 + Math.round(fontSize * 0.6);
    uiMonoText('v0.5  —  ENGINE BUILD', CX, titleBottom + 22, { size: 12, color: '#4a5568' });
    uiSeparator(titleBottom + 46);

    // ── Menu options ──────────────────────────
    const optY    = H * 0.56;
    const spacing = 58;
    const barW    = 340;

    // Rebuild hit rects each frame so they always match actual render geometry
    this._hitRects = [];

    this._options.forEach((opt, i) => {
      const y      = optY + i * spacing;
      const active = i === this._sel;
      const rx = CX - barW/2, ry = y - 22, rh = 44;

      // Store hit rect for mouse handling
      this._hitRects.push({ x: rx, y: ry, w: barW, h: rh, idx: i });

      if (active) {
        uiFillRect(rx, ry, barW, rh, '#00ffc8', 0.10);
        uiRect(rx, ry, barW, rh, '#00ffc8', 1.5, 0.6);
        const arrowPulse = 0.7 + 0.3 * Math.sin(this._pulse);
        uiText('▶', CX - 190, y, { size: 16, color: '#00ffc8', alpha: arrowPulse });
        uiText(opt, CX, y, { size: 22, color: '#ffffff', glow: '#00ffc8' });
      } else {
        const disabled = i === 2; // OPTIONS is placeholder
        uiText(opt, CX, y, { size: 18, color: disabled ? '#2a3040' : '#4a6080' });
      }
    });

    // ── Footer ────────────────────────────────
    uiMonoText('↑↓ / MOUSE  NAVIGATE  •  ENTER / CLICK  SELECT', CX, H - 40, { size: 11, color: '#2a3040' });

    uiScanlines();
  }

  onMouse(type, x, y) {
    if (!this._hitRects) return;
    for (const r of this._hitRects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        if (type === 'move') {
          this._sel = r.idx;
          uiCanvas.style.cursor = 'pointer';
          return;
        }
        if (type === 'click') {
          this._sel = r.idx;
          if (r.idx === 0) { MatchConfig.mode = 'vs';       SM.goto('CharSelect'); }
          if (r.idx === 1) { MatchConfig.mode = 'training'; SM.goto('CharSelect'); }
          if (r.idx === 2) { /* OPTIONS — placeholder */ }
          return;
        }
      }
    }
    uiCanvas.style.cursor = 'default';
  }

  onKey(e) {
    if (e.code === 'ArrowUp'   || e.code === 'KeyW') {
      this._sel = (this._sel - 1 + this._options.length) % this._options.length;
    }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') {
      this._sel = (this._sel + 1) % this._options.length;
    }
    if (e.code === 'Enter' || e.code === 'Space') {
      if (this._sel === 0) { MatchConfig.mode = 'vs';       SM.goto('CharSelect'); }
      if (this._sel === 1) { MatchConfig.mode = 'training'; SM.goto('CharSelect'); }
      if (this._sel === 2) { /* OPTIONS — placeholder */ }
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  CHARACTER SELECT SCENE
// ═══════════════════════════════════════════════════════════
class CharacterSelectScene extends Scene {
  constructor() {
    super('CharSelect');
    this._p1Sel     = 0;
    this._p2Sel     = 1;
    this._p2CPU     = false;
    this._phase     = 'p1';   // 'p1' | 'p2' | 'confirm'
    this._confirmPulse = 0;
  }

  enter() {
    super.enter();
    this._phase        = 'p1';
    this._confirmPulse = 0;
    document.getElementById('app').classList.add('menu-active');
    uiCanvas.classList.add('ui-interactive');
    uiCanvas.style.cursor = 'default';
  }

  exit() {
    document.getElementById('app').classList.remove('menu-active');
    uiCanvas.classList.remove('ui-interactive');
    uiCanvas.style.cursor = 'default';
  }

  update(dt) {
    super.update(dt);
    this._confirmPulse += dt * 3;
  }

  render() {
    const W = UI.w, H = UI.h, CX = UI.cx;

    uiGridBackground(this._t * 0.3);
    uiVignette();

    // ── Header ────────────────────────────────
    uiText('SELECT FIGHTER', CX, H * 0.10, { size: Math.round(W * 0.028), color: '#00ffc8', glow: '#00ffc8' });

    const phaseLabels = { p1: 'PLAYER 1  —  CHOOSE YOUR FIGHTER', p2: 'PLAYER 2  —  CHOOSE YOUR FIGHTER', confirm: 'CONFIRM SELECTIONS' };
    uiMonoText(phaseLabels[this._phase], CX, H * 0.17, { size: 13, color: '#4a6080' });

    uiSeparator(H * 0.20);

    // ── Character cards ───────────────────────
    const cardW   = Math.min(220, W * 0.22);
    const cardH   = Math.min(280, H * 0.46);
    const gap     = Math.min(40, W * 0.03);
    const totalW  = ROSTER.length * cardW + (ROSTER.length - 1) * gap;
    const startX  = CX - totalW / 2;
    const cardY   = H * 0.27;

    ROSTER.forEach((char, i) => {
      const x = startX + i * (cardW + gap);
      const isP1 = this._p1Sel === i;
      const isP2 = this._p2Sel === i;
      const isActiveSelection = (this._phase === 'p1' && i === this._p1Sel) ||
                                (this._phase === 'p2' && i === this._p2Sel);

      // Card background
      uiFillRect(x, cardY, cardW, cardH, '#0d0d1a');
      uiRect(x, cardY, cardW, cardH,
        isP1 && isP2 ? '#ffffff' :
        isP1 ? '#00c8ff' :
        isP2 ? '#ff6b35' : '#1e1e38',
        isActiveSelection ? 2.5 : 1.5,
        isActiveSelection ? 1.0 : 0.5);

      // Fighter sprite preview — idle frame 0, scaled to fill card portrait area
      const silH = cardH * 0.55;
      const previewDef   = FIGHTER_DEFS[char.defName];
      const previewSheet = SPRITE_SHEET_MAP[previewDef?.spriteSheet];
      const previewAnims = ANIM_TABLE_MAP[previewDef?.animFn];
      if (previewSheet?.ready && previewAnims?.idle?.[0]) {
        const pFrame = previewAnims.idle[0];
        // Scale so the sprite fills silH vertically, keeping aspect ratio
        const drawSc = (silH - 6) / pFrame.h;
        const dw = Math.round(pFrame.w * drawSc);
        const dh = Math.round(pFrame.h * drawSc);
        const px = Math.round(x + (cardW - dw) / 2);
        const py = Math.round(cardY + silH - dh + 4);
        uiCtx.save();
        uiCtx.imageSmoothingEnabled = false;
        uiCtx.globalAlpha = isActiveSelection ? 1.0 : 0.80;
        uiCtx.drawImage(previewSheet.img, pFrame.x, pFrame.y, pFrame.w, pFrame.h, px, py, dw, dh);
        uiCtx.restore();
      }

      // Character name
      uiText(char.displayName, x + cardW/2, cardY + silH + 22,
        { size: 16, color: char.color, font: 'Orbitron', glow: isActiveSelection ? char.color : null });

      // Subtitle
      uiMonoText(char.subtitle, x + cardW/2, cardY + silH + 44, { size: 9, color: '#4a5568' });

      // Stat bars
      const statsY = cardY + silH + 62;
      const barW2  = cardW - 80;
      uiStatBar('SPD', char.stats.speed,  x + 8, statsY,      barW2, '#00c8ff');
      uiStatBar('WGT', char.stats.weight, x + 8, statsY + 18, barW2, '#ff6b35');
      uiStatBar('PWR', char.stats.power,  x + 8, statsY + 36, barW2, '#ff2244');
      uiStatBar('RNG', char.stats.range,  x + 8, statsY + 54, barW2, '#88ff44');

      // Player badges
      const badgeY = cardY + cardH - 26;
      if (isP1 && isP2) {
        uiMonoText('P1 + P2', x + cardW/2, badgeY, { size: 11, color: '#ffffff' });
      } else if (isP1) {
        uiMonoText('P1', x + cardW/2, badgeY, { size: 11, color: '#00c8ff' });
      } else if (isP2) {
        const lbl = this._p2CPU ? 'CPU' : 'P2';
        uiMonoText(lbl, x + cardW/2, badgeY, { size: 11, color: '#ff6b35' });
      }
    });

    // ── Player preview row ────────────────────
    const previewY = H * 0.80;
    const p1Char   = ROSTER[this._p1Sel];
    const p2Char   = ROSTER[this._p2Sel];

    // P1 side
    uiText('P1', CX * 0.45, previewY, { size: 14, color: '#00c8ff' });
    uiMonoText(p1Char.displayName, CX * 0.45, previewY + 22, { size: 13, color: '#c8d8e8' });
    if (this._phase !== 'p1') {
      uiMonoText('✓ LOCKED', CX * 0.45, previewY + 40, { size: 10, color: '#00ffc8' });
    }

    // VS divider
    uiText('VS', CX, previewY + 10, { size: 20, color: '#4a5568' });

    // P2 side
    const p2Label = this._p2CPU ? 'CPU' : 'P2';
    uiText(p2Label, CX * 1.55, previewY, { size: 14, color: '#ff6b35' });
    uiMonoText(p2Char.displayName, CX * 1.55, previewY + 22, { size: 13, color: '#c8d8e8' });
    if (this._phase === 'confirm') {
      uiMonoText('✓ LOCKED', CX * 1.55, previewY + 40, { size: 10, color: '#00ffc8' });
    }

    // ── CPU toggle hint (during p2 phase) ────
    if (this._phase === 'p2') {
      uiMonoText(`CPU: ${this._p2CPU ? 'ON ←[C] toggle' : 'OFF  [C] toggle'}`,
        CX, H * 0.90, { size: 11, color: this._p2CPU ? '#ffee00' : '#2a3040' });
    }

    // ── Controls hint ─────────────────────────
    const hints = {
      p1:      '← → / CLICK CARD  CHOOSE  •  ENTER / CLICK AGAIN  CONFIRM',
      p2:      '← → / CLICK CARD  CHOOSE  •  ENTER / CLICK AGAIN  CONFIRM  •  ESC BACK',
      confirm: 'CLICK START or ENTER  •  ESC BACK',
    };
    const confirmPulse = this._phase === 'confirm' ? 0.6 + 0.4 * Math.sin(this._confirmPulse) : 1;
    uiMonoText(hints[this._phase], CX, H - 40, { size: 12, color: '#2a3040', alpha: confirmPulse });

    // ── Confirm button (confirm phase) ────────
    this._hitRects = [];
    if (this._phase === 'confirm') {
      const btnW = 260, btnH = 46;
      const btnX = CX - btnW / 2, btnY = H - 34 - btnH;
      const bp = 0.6 + 0.4 * Math.sin(this._confirmPulse);
      uiFillRect(btnX, btnY, btnW, btnH, '#00ffc8', 0.15 * bp);
      uiRect(btnX, btnY, btnW, btnH, '#00ffc8', 2, 0.8 * bp);
      uiText('▶  START MATCH', CX, btnY + btnH / 2, { size: 16, color: '#ffffff', glow: '#00ffc8' });
      this._hitRects.push({ x: btnX, y: btnY, w: btnW, h: btnH, action: 'start' });
    }

    // Record card hit rects for mouse picking
    ROSTER.forEach((_, i) => {
      const x = startX + i * (cardW + gap);
      this._hitRects.push({ x, y: cardY, w: cardW, h: cardH, action: 'card', idx: i });
    });

    uiScanlines();
  }

  onMouse(type, x, y) {
    if (!this._hitRects) return;
    let overBtn = false;
    for (const r of this._hitRects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        overBtn = true;
        if (type === 'move') {
          uiCanvas.style.cursor = 'pointer';
        }
        if (type === 'click') {
          if (r.action === 'start') {
            MatchConfig.p1RosterIdx = this._p1Sel;
            MatchConfig.p2RosterIdx = this._p2Sel;
            MatchConfig.p2IsCPU     = this._p2CPU;
            SM.goto('Game');
          } else if (r.action === 'card') {
            if (this._phase === 'p1') {
              if (this._p1Sel === r.idx) {
                // Already selected — clicking again confirms
                this._phase = 'p2';
              } else {
                this._p1Sel = r.idx;
              }
            } else if (this._phase === 'p2') {
              if (this._p2Sel === r.idx) {
                this._phase = 'confirm';
              } else {
                this._p2Sel = r.idx;
              }
            } else if (this._phase === 'confirm') {
              // Clicking a card in confirm goes back to editing P2
              this._phase = 'p2';
              this._p2Sel = r.idx;
            }
          }
        }
        return;
      }
    }
    if (!overBtn) uiCanvas.style.cursor = 'default';
  }

  onKey(e) {
    if (this._phase === 'p1') {
      if (e.code === 'ArrowLeft')  this._p1Sel = (this._p1Sel - 1 + ROSTER.length) % ROSTER.length;
      if (e.code === 'ArrowRight') this._p1Sel = (this._p1Sel + 1) % ROSTER.length;
      if (e.code === 'Enter' || e.code === 'Space') this._phase = 'p2';
      if (e.code === 'Escape') SM.goto('MainMenu');
    } else if (this._phase === 'p2') {
      if (e.code === 'ArrowLeft')  this._p2Sel = (this._p2Sel - 1 + ROSTER.length) % ROSTER.length;
      if (e.code === 'ArrowRight') this._p2Sel = (this._p2Sel + 1) % ROSTER.length;
      if (e.code === 'KeyC')       this._p2CPU = !this._p2CPU;
      if (e.code === 'Enter' || e.code === 'Space') this._phase = 'confirm';
      if (e.code === 'Escape') this._phase = 'p1';
    } else if (this._phase === 'confirm') {
      if (e.code === 'Enter' || e.code === 'Space') {
        MatchConfig.p1RosterIdx = this._p1Sel;
        MatchConfig.p2RosterIdx = this._p2Sel;
        MatchConfig.p2IsCPU     = this._p2CPU;
        SM.goto('Game');
      }
      if (e.code === 'Escape') this._phase = 'p2';
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  GAME SCENE
//  Wraps the existing fighter engine. Manages stock counts,
//  timer, in-game HUD drawn on uiCanvas, and win detection.
// ═══════════════════════════════════════════════════════════
class GameScene extends Scene {
  constructor() {
    super('Game');
    this._stocks     = [3, 3];
    this._timer      = 0;
    this._timeLimit  = 0;
    this._paused     = false;
    this._gameOver   = false;   // true once SM.goto('Victory') has been queued
    this._ticksSinceStart = 0;
    this._prevDamage = [0, 0];
    this._dmgFlash   = [0, 0];   // flash timer per player
  }

  enter(params) {
    super.enter();
    // Apply MatchConfig character choices
    const p1Def = ROSTER[MatchConfig.p1RosterIdx].defName;
    const p2Def = ROSTER[MatchConfig.p2RosterIdx].defName;

    // Reinitialise fighters with selected characters
    fighters[0] = new Fighter(p1Def, 310, 300, fighters[0].controls);
    fighters[1] = new Fighter(p2Def, 650, 300, fighters[1].controls);

    // Stock reset
    this._stocks     = [MatchConfig.stocks, MatchConfig.stocks];
    this._timer      = 0;
    this._timeLimit  = MatchConfig.timeLimit;
    this._gameOver   = false;
    this._ticksSinceStart = 0;
    this._prevDamage = [fighters[0].damage, fighters[1].damage];
    this._dmgFlash   = [0, 0];
    hitCount         = 0;
    totalTick        = 0;
    accumulator      = 0;

    document.getElementById('app').classList.remove('menu-active');
  }

  _resetFighter(idx) {
    const defName = ROSTER[idx === 0 ? MatchConfig.p1RosterIdx : MatchConfig.p2RosterIdx].defName;
    const ctl     = fighters[idx].controls;
    fighters[idx] = new Fighter(defName, idx === 0 ? 350 : 610, 160, ctl);
  }

  update(dt) {
    super.update(dt);
    if (this._paused) return;

    // Timer
    if (this._timeLimit > 0) this._timer += dt;

    // Fixed-timestep physics (same as old loop)
    accumulator += dt;
    while (accumulator >= FIXED_DT) {
      gamePhysicsTick();
      this._ticksSinceStart++;
      accumulator -= FIXED_DT;
    }

    // Damage flash detection
    fighters.forEach((f, i) => {
      if (f.damage !== this._prevDamage[i]) {
        this._dmgFlash[i] = 40;
        this._prevDamage[i] = f.damage;
      }
      if (this._dmgFlash[i] > 0) this._dmgFlash[i]--;
    });

    // Blast zone → lose a stock (detected via _blasted flag set by engine)
    fighters.forEach((f, i) => {
      if (f._blasted) {
        f._blasted = false;   // clear flag
        this._stocks[i] = Math.max(0, this._stocks[i] - 1);
        if (this._stocks[i] > 0) {
          this._resetFighter(i);
        } else {
          // Park off-screen so engine doesn't keep triggering; GameScene will transition
          f.x = -999; f.y = -999;
        }
      }
    });

    // Win condition — only trigger once; _gameOver prevents repeated SM.goto calls
    // during the fade-out transition (which keeps GameScene.update running)
    const p1Dead = this._stocks[0] <= 0;
    const p2Dead = this._stocks[1] <= 0;
    const timeUp = this._timeLimit > 0 && this._timer >= this._timeLimit;

    if (!this._gameOver && (p1Dead || p2Dead || timeUp)) {
      this._gameOver = true;
      const winner = p1Dead ? 1 : p2Dead ? 0 : (fighters[0].damage < fighters[1].damage ? 0 : 1);
      SM.goto('Victory', {
        winner,
        stocks: [...this._stocks],
        p1Name: ROSTER[MatchConfig.p1RosterIdx].displayName,
        p2Name: ROSTER[MatchConfig.p2RosterIdx].displayName,
      });
    }
  }

  render() {
    // Draw game world onto game canvas (existing engine)
    render();   // drawBackground / drawPlatforms / drawLedges / fighters.draw

    // Draw in-game HUD onto UI canvas (pure canvas, no DOM)
    uiCtx.clearRect(0, 0, UI.w, UI.h);
    this._drawInGameHUD();
  }

  _drawInGameHUD() {
    const W = UI.w, H = UI.h;
    const p1 = fighters[0], p2 = fighters[1];
    const p1Color = ROSTER[MatchConfig.p1RosterIdx].color;
    const p2Color = ROSTER[MatchConfig.p2RosterIdx].color;

    // ── Percent displays ─────────────────────
    // P1 (left side)
    this._drawPlayerHUD(p1, 0, W * 0.14, H * 0.04, 'left', p1Color);
    // P2 (right side)
    this._drawPlayerHUD(p2, 1, W * 0.86, H * 0.04, 'right', p2Color);

    // ── Timer ────────────────────────────────
    if (this._timeLimit > 0) {
      const remaining = Math.max(0, this._timeLimit - this._timer);
      const m = Math.floor(remaining / 60);
      const s = Math.floor(remaining % 60);
      const tStr = `${m}:${s.toString().padStart(2,'0')}`;
      uiFillRect(W/2 - 44, 8, 88, 38, '#0a0a1a', 0.85);
      uiRect(W/2 - 44, 8, 88, 38, '#1e1e38');
      uiText(tStr, W/2, 28, { size: 18, color: remaining < 30 ? '#ff2244' : '#c8d8e8' });
    }

    // ── Stocks ────────────────────────────────
    this._drawStocks(0, W * 0.14, H * 0.04 + 68, p1Color);
    this._drawStocks(1, W * 0.86, H * 0.04 + 68, p2Color, true);
  }

  _drawPlayerHUD(fighter, idx, x, y, side, color) {
    const W = UI.w;
    const boxW = 190, boxH = 62;
    const bx = side === 'left' ? x : x - boxW;

    // Panel background
    uiFillRect(bx, y, boxW, boxH, '#0a0a1a', 0.85);
    uiFillRect(bx, y, side === 'left' ? 3 : 0, boxH, color, 0.9);
    uiFillRect(bx + (side === 'left' ? 0 : boxW - 3), y, 3, boxH, color, 0.9);
    uiRect(bx, y, boxW, boxH, '#1e1e38');

    // Player label
    const label = idx === 0 ? 'P1' : (MatchConfig.p2IsCPU ? 'CPU' : 'P2');
    uiMonoText(label, bx + (side === 'left' ? 12 : boxW - 12), y + 14,
      { size: 11, color, align: side === 'left' ? 'left' : 'right' });

    // Character name
    const charName = ROSTER[idx === 0 ? MatchConfig.p1RosterIdx : MatchConfig.p2RosterIdx].displayName;
    uiMonoText(charName, bx + (side === 'left' ? 12 : boxW - 12), y + 28,
      { size: 10, color: '#4a5568', align: side === 'left' ? 'left' : 'right' });

    // Damage percent — big number
    const dmg    = Math.round(fighter.damage);
    const flash  = this._dmgFlash[idx] > 0;
    const dmgCol = flash ? '#ffffff' : dmg > 100 ? '#ff2244' : dmg > 60 ? '#ffee00' : color;
    const dmgStr = `${dmg}%`;
    const dmgX   = side === 'left' ? bx + boxW - 14 : bx + 14;
    uiText(dmgStr, dmgX, y + 38, { size: 22, color: dmgCol, align: side === 'left' ? 'right' : 'left',
      glow: flash ? '#ffffff' : dmg > 100 ? '#ff2244' : null });
  }

  _drawStocks(idx, x, y, color, rightAlign=false) {
    const stocks  = this._stocks[idx];
    const maxSt   = MatchConfig.stocks;
    const dotR    = 7;
    const dotGap  = 18;
    const totalW  = maxSt * dotR * 2 + (maxSt - 1) * (dotGap - dotR * 2);
    const startX  = rightAlign ? x - totalW : x;

    for (let i = 0; i < maxSt; i++) {
      const dx = startX + i * dotGap + dotR;
      const alive = i < stocks;
      uiCtx.save();
      uiCtx.beginPath();
      uiCtx.arc(dx, y, dotR, 0, Math.PI * 2);
      if (alive) {
        uiCtx.shadowColor = color; uiCtx.shadowBlur = 10;
        uiCtx.fillStyle   = color;
        uiCtx.fill();
      } else {
        uiCtx.strokeStyle = '#2a3040'; uiCtx.lineWidth = 1.5;
        uiCtx.stroke();
      }
      uiCtx.shadowBlur = 0;
      uiCtx.restore();
    }
  }

  onKey(e) {
    // Pause key — instant switch preserves game state, PauseScene.enter() only resets menu sel
    if (e.code === 'Escape' || e.code === 'KeyP') {
      SM.goto('Pause', {}, true);
      return;
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  PAUSE SCENE
//  Semi-transparent overlay on top of the frozen game state.
//  Uses instant (no-fade) transition back to Game.
// ═══════════════════════════════════════════════════════════
class PauseScene extends Scene {
  constructor() {
    super('Pause');
    this._options = ['RESUME', 'RESTART MATCH', 'CHARACTER SELECT', 'MAIN MENU'];
    this._sel     = 0;
    this._pulse   = 0;
  }

  enter() {
    super.enter();
    this._sel   = 0;
    this._pulse = 0;
    uiCanvas.classList.add('ui-interactive');
    uiCanvas.style.cursor = 'default';
  }

  exit() {
    uiCanvas.classList.remove('ui-interactive');
    uiCanvas.style.cursor = 'default';
  }

  update(dt) {
    super.update(dt);
    this._pulse += dt * 2.5;
  }

  render() {
    // Re-render frozen game world on game canvas
    render();
    // Clear UI canvas and draw semi-transparent overlay
    uiCtx.clearRect(0, 0, UI.w, UI.h);

    const W = UI.w, H = UI.h, CX = UI.cx, CY = UI.cy;

    // Dark overlay
    uiFillRect(0, 0, W, H, '#000000', 0.62);

    // Panel
    const pW = 380, pH = 340;
    const px = CX - pW/2, py = CY - pH/2;
    uiFillRect(px, py, pW, pH, '#080810', 0.97);
    uiRect(px, py, pW, pH, '#00ffc8', 2, 0.5);

    // Title
    uiText('PAUSED', CX, py + 52, { size: 32, color: '#00ffc8', glow: '#00ffc8' });
    uiSeparator(py + 82);

    // Options
    const optY    = py + 126;
    const spacing = 54;
    this._hitRects = [];
    this._options.forEach((opt, i) => {
      const y      = optY + i * spacing;
      const active = i === this._sel;
      const rx = px + 20, rw = pW - 40, rh = 36;
      const ry = y - 18;
      this._hitRects.push({ x: rx, y: ry, w: rw, h: rh, idx: i });
      if (active) {
        uiFillRect(rx, ry, rw, rh, '#00ffc8', 0.09);
        const arrowAlpha = 0.6 + 0.4 * Math.sin(this._pulse);
        uiText('▶', CX - 150, y, { size: 14, color: '#00ffc8', alpha: arrowAlpha });
        uiText(opt, CX, y, { size: 18, color: '#ffffff', glow: '#00ffc8' });
      } else {
        uiText(opt, CX, y, { size: 16, color: '#4a6080' });
      }
    });

    uiMonoText('↑↓ / MOUSE  NAVIGATE  •  ENTER / CLICK  SELECT  •  ESC RESUME', CX, py + pH - 24,
      { size: 10, color: '#2a3040' });
  }

  onMouse(type, x, y) {
    if (!this._hitRects) return;
    let over = false;
    for (const r of this._hitRects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        over = true;
        if (type === 'move') { this._sel = r.idx; uiCanvas.style.cursor = 'pointer'; }
        if (type === 'click') {
          this._sel = r.idx;
          if (r.idx === 0) { SM.resume('Game');     }
          if (r.idx === 1) { SM.goto('Game');       }
          if (r.idx === 2) { SM.goto('CharSelect'); }
          if (r.idx === 3) { SM.goto('MainMenu');   }
        }
        return;
      }
    }
    if (!over) uiCanvas.style.cursor = 'default';
  }

  onKey(e) {
    if (e.code === 'Escape') { SM.resume('Game'); return; }
    if (e.code === 'ArrowUp'   || e.code === 'KeyW') this._sel = (this._sel - 1 + this._options.length) % this._options.length;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') this._sel = (this._sel + 1) % this._options.length;
    if (e.code === 'Enter' || e.code === 'Space') {
      if (this._sel === 0) { SM.resume('Game');             }  // Resume — no re-init
      if (this._sel === 1) { SM.goto('Game');               }  // Restart — calls enter(), reinits
      if (this._sel === 2) { SM.goto('CharSelect');         }
      if (this._sel === 3) { SM.goto('MainMenu');           }
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  VICTORY SCENE
// ═══════════════════════════════════════════════════════════
class VictoryScene extends Scene {
  constructor() {
    super('Victory');
    this._options = ['REMATCH', 'CHARACTER SELECT', 'MAIN MENU'];
    this._sel     = 0;
    this._winner  = 0;
    this._stocks  = [0, 0];
    this._pulse   = 0;
    this._p1Name  = 'P1';
    this._p2Name  = 'P2';
  }

  enter(params={}) {
    super.enter();
    this._winner = params.winner ?? 0;
    this._stocks = params.stocks ?? [0, 0];
    this._p1Name = params.p1Name ?? 'P1';
    this._p2Name = params.p2Name ?? 'P2';
    this._sel    = 0;
    this._pulse  = 0;
    document.getElementById('app').classList.add('menu-active');
    uiCanvas.classList.add('ui-interactive');
    uiCanvas.style.cursor = 'default';
  }

  exit() {
    document.getElementById('app').classList.remove('menu-active');
    uiCanvas.classList.remove('ui-interactive');
    uiCanvas.style.cursor = 'default';
  }

  update(dt) {
    super.update(dt);
    this._pulse += dt * 2;
  }

  render() {
    const W = UI.w, H = UI.h, CX = UI.cx, CY = UI.cy;
    const winnerChar = ROSTER[this._winner === 0 ? MatchConfig.p1RosterIdx : MatchConfig.p2RosterIdx];
    const winnerName = this._winner === 0 ? this._p1Name : this._p2Name;
    const winnerLabel= this._winner === 0 ? 'P1' : (MatchConfig.p2IsCPU ? 'CPU' : 'P2');

    uiGridBackground(this._t * 0.2);
    uiVignette();

    // ── Winner announcement ───────────────────
    const glowPulse = 0.7 + 0.3 * Math.sin(this._pulse);
    uiCtx.save();
    uiCtx.globalAlpha = 0.45 * glowPulse;
    const grad = uiCtx.createRadialGradient(CX, H * 0.35, 0, CX, H * 0.35, 240);
    grad.addColorStop(0, winnerChar.color);
    grad.addColorStop(1, 'transparent');
    uiCtx.fillStyle = grad;
    uiCtx.fillRect(0, 0, W, H * 0.7);
    uiCtx.restore();

    uiMonoText('WINNER', CX, H * 0.20, { size: 16, color: '#4a5568' });

    uiText(winnerLabel, CX, H * 0.30,
      { size: Math.round(W * 0.055), color: winnerChar.color, glow: winnerChar.color });
    uiText(winnerName, CX, H * 0.43,
      { size: Math.round(W * 0.04), color: '#ffffff' });

    uiSeparator(H * 0.52);

    // ── Stock summary ─────────────────────────
    const sumY = H * 0.58;
    // P1
    uiMonoText(this._p1Name, CX * 0.58, sumY, { size: 13, color: '#00c8ff' });
    for (let i = 0; i < MatchConfig.stocks; i++) {
      const alive = i < this._stocks[0];
      const dx = CX * 0.58 - (MatchConfig.stocks * 9) + i * 18;
      uiCtx.save();
      uiCtx.beginPath();
      uiCtx.arc(dx, sumY + 20, 7, 0, Math.PI * 2);
      uiCtx.fillStyle = alive ? '#00c8ff' : '#1e1e38';
      uiCtx.fill();
      uiCtx.restore();
    }
    // P2
    const p2Label = MatchConfig.p2IsCPU ? 'CPU' : this._p2Name;
    uiMonoText(p2Label, CX * 1.42, sumY, { size: 13, color: '#ff6b35' });
    for (let i = 0; i < MatchConfig.stocks; i++) {
      const alive = i < this._stocks[1];
      const dx = CX * 1.42 - (MatchConfig.stocks * 9) + i * 18;
      uiCtx.save();
      uiCtx.beginPath();
      uiCtx.arc(dx, sumY + 20, 7, 0, Math.PI * 2);
      uiCtx.fillStyle = alive ? '#ff6b35' : '#1e1e38';
      uiCtx.fill();
      uiCtx.restore();
    }

    uiSeparator(H * 0.68);

    // ── Options ───────────────────────────────
    const optY    = H * 0.75;
    const spacing = 52;
    const barW    = 340;
    this._hitRects = [];
    this._options.forEach((opt, i) => {
      const y      = optY + i * spacing;
      const active = i === this._sel;
      const rx = CX - barW/2, ry = y - 18, rh = 36;
      this._hitRects.push({ x: rx, y: ry, w: barW, h: rh, idx: i });
      if (active) {
        uiFillRect(rx, ry, barW, rh, '#00ffc8', 0.09);
        uiRect(rx, ry, barW, rh, '#00ffc8', 1.5, 0.5);
        const ap = 0.6 + 0.4 * Math.sin(this._pulse);
        uiText('▶', CX - 165, y, { size: 14, color: '#00ffc8', alpha: ap });
        uiText(opt, CX, y, { size: 19, color: '#ffffff', glow: '#00ffc8' });
      } else {
        uiText(opt, CX, y, { size: 16, color: '#4a6080' });
      }
    });

    uiMonoText('↑↓ / MOUSE  NAVIGATE  •  ENTER / CLICK  SELECT', CX, H - 34, { size: 11, color: '#2a3040' });
    uiScanlines();
  }

  onMouse(type, x, y) {
    if (!this._hitRects) return;
    let over = false;
    for (const r of this._hitRects) {
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        over = true;
        if (type === 'move') { this._sel = r.idx; uiCanvas.style.cursor = 'pointer'; }
        if (type === 'click') {
          this._sel = r.idx;
          if (r.idx === 0) SM.goto('Game');
          if (r.idx === 1) SM.goto('CharSelect');
          if (r.idx === 2) SM.goto('MainMenu');
        }
        return;
      }
    }
    if (!over) uiCanvas.style.cursor = 'default';
  }

  onKey(e) {
    if (e.code === 'ArrowUp'   || e.code === 'KeyW') this._sel = (this._sel - 1 + this._options.length) % this._options.length;
    if (e.code === 'ArrowDown' || e.code === 'KeyS') this._sel = (this._sel + 1) % this._options.length;
    if (e.code === 'Enter' || e.code === 'Space') {
      if (this._sel === 0) SM.goto('Game');
      if (this._sel === 1) SM.goto('CharSelect');
      if (this._sel === 2) SM.goto('MainMenu');
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  REGISTER SCENES + INITIAL ROUTE
// ═══════════════════════════════════════════════════════════
SM.init([
  new MainMenuScene(),
  new CharacterSelectScene(),
  new GameScene(),
  new PauseScene(),
  new VictoryScene(),
]);

// Route all keydown events through the active scene
window.addEventListener('keydown', e => {
  if (e.code === 'Tab') return;  // Tab is debug-mode, handled separately
  SM.onKey(e);
});

// Route mouse events through the active scene.
// We use uiCanvas (the full-screen overlay) as the hit surface.
// Coordinates are in UI canvas space (same space scenes render into).
uiCanvas.addEventListener('mousemove', e => {
  const r = uiCanvas.getBoundingClientRect();
  SM.onMouse('move', e.clientX - r.left, e.clientY - r.top);
});
uiCanvas.addEventListener('click', e => {
  const r = uiCanvas.getBoundingClientRect();
  SM.onMouse('click', e.clientX - r.left, e.clientY - r.top);
});

// Boot into Main Menu
SM.goto('MainMenu', {}, true);

// ═══════════════════════════════════════════════════════════
//  MASTER LOOP
//  All timing, updating, and rendering flows through here.
// ═══════════════════════════════════════════════════════════
function loop(timestamp) {
  requestAnimationFrame(loop);
  if (prevTime === null) { prevTime = timestamp; return; }

  let rawDt = Math.min((timestamp - prevTime) / 1000, 0.1);
  prevTime  = timestamp;

  fpsAccum += rawDt; fpsFrames++;
  if (fpsAccum >= 0.5) { displayFps = Math.round(fpsFrames / fpsAccum); fpsAccum = fpsFrames = 0; }

  SM.update(rawDt);   // runs all physics ticks (may be multiple per frame)
  clearJust();        // clear justPressed ONCE after all ticks — never drops inputs mid-batch
  SM.render();
}

requestAnimationFrame(loop);
