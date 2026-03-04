// ==========================
// CANVAS SETUP
// ==========================
const canvas = document.querySelector("canvas");
const ctx = canvas.getContext("2d");

// ==========================
// LOAD IMAGES
// ==========================
const sprites = {
    idle: new Image(),
    run: new Image(),
    jump: new Image(),
    attack: new Image()
};

sprites.idle.src = "Aeris_Idle.png";
sprites.run.src = "Aeris_Run.png";
sprites.jump.src = "Aeris_Jump.png";
sprites.attack.src = "Aeris_Attack.png";

// ==========================
// PLAYER OBJECT
// ==========================
const player = {
    x: 300,
    y: 300,

    state: "idle",
    frameIndex: 0,
    frameTimer: 0,

    animations: {
        idle: { frames: 12, frameWidth: 160, frameHeight: 160, speed: 150, loop: true },
        run: { frames: 8, frameWidth: 160, frameHeight: 160, speed: 100, loop: true },
        jump: { frames: 6, frameWidth: 160, frameHeight: 160, speed: 120, loop: false },
        attack: { frames: 10, frameWidth: 160, frameHeight: 160, speed: 90, loop: false }
    }
};

function setState(newState) {
    if (player.state === newState) return;

    player.state = newState;
    player.frameIndex = 0;
    player.frameTimer = 0;
}

let lastTime = 0;

function gameLoop(timestamp) {
    const deltaTime = timestamp - lastTime;
    lastTime = timestamp;

    update(deltaTime);
    draw();

    requestAnimationFrame(gameLoop);
}

requestAnimationFrame(gameLoop);

function update(deltaTime) {
    updateAnimation(deltaTime);
}

function updateAnimation(deltaTime) {
    const anim = player.animations[player.state];

    player.frameTimer += deltaTime;

    if (player.frameTimer > anim.speed) {
        player.frameTimer = 0;
        player.frameIndex++;

        if (player.frameIndex >= anim.frames) {
            if (anim.loop) {
                player.frameIndex = 0;
            } else {
                player.frameIndex = anim.frames - 1;
            }
        }
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const anim = player.animations[player.state];
    const sprite = sprites[player.state];

    const frameWidth = anim.frameWidth;
    const frameHeight = anim.frameHeight;

    ctx.drawImage(
        sprite,
        player.frameIndex * frameWidth,  // source X
        0,                               // source Y (single row PNG)
        frameWidth,
        frameHeight,
        player.x,
        player.y,
        frameWidth,
        frameHeight
    );
}

