(() => {
  'use strict';

  const canvas = document.querySelector('#gameCanvas');
  const ctx = canvas.getContext('2d');
  const arena = document.querySelector('#arena');
  const remainingEl = document.querySelector('#remaining');
  const timerEl = document.querySelector('#timer');
  const coinCountEl = document.querySelector('#coinCount');
  const coinCountdownEl = document.querySelector('#coinCountdown');
  const jumpStatusEl = document.querySelector('#jumpStatus');
  const toastEl = document.querySelector('#toast');
  const startScreen = document.querySelector('#startScreen');
  const resultScreen = document.querySelector('#resultScreen');
  const winnerFace = document.querySelector('#winnerFace');
  const winnerName = document.querySelector('#winnerName');
  const resultText = document.querySelector('#resultText');
  const shopDialog = document.querySelector('#shopDialog');
  const shopButton = document.querySelector('#shopButton');
  const shopItems = document.querySelector('#shopItems');
  const UPGRADES = [
    { id: 'speed', name: '이동 속도', icon: '↗', description: '이동 속도와 가속도 +15%', base: 3, max: 4 },
    { id: 'jump', name: '점프 재충전', icon: '↑', description: '점프 쿨타임 −0.2초', base: 4, max: 5 },
    { id: 'shield', name: '리스폰 보호막', icon: '◇', description: '리스폰 무적 시간 +0.6초', base: 3, max: 4 },
    { id: 'magnet', name: '코인 수집 범위', icon: '◎', description: '코인 수집 거리 +24', base: 3, max: 4 },
  ];

  const COLORS = ['#ff3355', '#30a9ff', '#66ef45', '#32e5e0', '#ff79b7', '#ff9c32', '#f4f0e9', '#ffe94b', '#9454ff', '#20c7ff'];
  const NAMES = ['루비', '웨이브', '라임', '민트', '피치', '탱고', '모찌', '레몬', '바이올렛', '스카이'];
  const AI_COUNT = 20;
  const TOTAL_CONTESTANTS = AI_COUNT + 1;
  const TAU = Math.PI * 2;
  const state = {
    running: false,
    finished: false,
    lastTime: 0,
    elapsed: 0,
    nextCull: 8.5,
    nextCoinTime: 10,
    coins: [],
    coinScore: 0,
    shopOpen: false,
    upgrades: {},
    hubs: [],
    rods: [],
    viewScale: 1,
    viewOffsetX: 0,
    viewOffsetY: 0,
    dpr: 1,
    round: 1,
    width: 0,
    height: 0,
    scale: 1,
    cx: 0,
    cy: 0,
    arenaRadius: 0,
    contestants: [],
    particles: [],
    ripples: [],
    pointer: { x: 0, y: 0, px: 0, py: 0, down: false, active: false, id: null, type: null },
    keys: new Set(),
    toastTimer: 0,
  };

  const rand = (min, max) => min + Math.random() * (max - min);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const hypot = (x, y) => Math.hypot(x, y) || 0.0001;

  function resize() {
    const rect = arena.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    // Fixed world dimensions: resizing only changes the view, never the physics.
    state.width = 1400;
    state.height = 1800;
    state.scale = 1;
    state.cx = 700;
    state.cy = 925;
    state.arenaRadius = 660;
    state.dpr = dpr;
    state.viewScale = Math.min(rect.width / state.width, rect.height / state.height);
    state.viewOffsetX = (rect.width - state.width * state.viewScale) / 2;
    state.viewOffsetY = (rect.height - state.height * state.viewScale) / 2;
  }

  function newGame(autostart = true) {
    state.shopOpen = false;
    if (shopDialog.open) shopDialog.close();
    state.upgrades = Object.fromEntries(UPGRADES.map(u => [u.id, 0]));
    state.elapsed = 0;
    state.nextCull = 8.5;
    state.nextCoinTime = 10;
    state.coins.length = 0;
    state.coinScore = 0;
    state.round = 1;
    state.finished = false;
    state.particles.length = 0;
    state.ripples.length = 0;
    clearInput();
    clearTimeout(state.toastTimer);
    toastEl.classList.remove('show');
    // Each pivot has its own four rods. Sweep circles are separated even at
    // maximum length, including the T-caps, so different zones cannot interlock.
    state.hubs = [
      { id: 0, x: 700, y: 620, radius: 25 },
      { id: 1, x: 400, y: 1130, radius: 25 },
      { id: 2, x: 1000, y: 1130, radius: 25 },
    ];
    state.rods = state.hubs.flatMap(hub => Array.from({ length: 4 }, (_, i) => {
      const angularVelocity = (Math.random() < .5 ? -1 : 1) * rand(1.05, 1.8);
      return {
        id: hub.id * 4 + i, hub, rodActive: true,
        color: COLORS[(hub.id * 3 + i) % COLORS.length],
        angle: i / 4 * TAU + rand(-.12, .12), angularVelocity,
        spinDirection: Math.sign(angularVelocity), targetSpinSpeed: rand(1.1, 2.15),
        turnTorque: rand(2.6, 4.5), nextDirectionChange: rand(1, 4),
        turnMode: 'inertia', avoidanceUntil: 0,
        length: rand(230, 265), width: 6, flash: 0,
      };
    }));
    state.contestants = Array.from({ length: TOTAL_CONTESTANTS }, (_, i) => {
      const color = COLORS[i % COLORS.length];
      const hub = state.hubs[i % state.hubs.length];
      const angle = Math.floor(i / 3) / 7 * TAU + rand(-.12, .12);
      const spawnAngle = angle;
      const orbit = i % 2 ? 200 : 145;
      const tangent = rand(-20, 20);
      return {
        id: i,
        name: i === 0 ? 'YOU' : `${NAMES[i % NAMES.length]} ${i}`,
        player: i === 0,
        color,
        alive: true,
        alpha: 1,
        radius: i === 0 ? 27 : 25,
        x: hub.x + Math.cos(spawnAngle) * orbit,
        y: hub.y + Math.sin(spawnAngle) * orbit,
        aiHub: hub.id,
        vx: Math.cos(angle + Math.PI / 2) * tangent + rand(-14, 14),
        vy: Math.sin(angle + Math.PI / 2) * tangent + rand(-14, 14),
        spin: rand(-2, 2),
        faceAngle: rand(0, TAU),
        danger: 0,
        scoreJitter: Math.random(),
        aiPhase: rand(0, TAU),
        jumpHeight: 0,
        jumpVelocity: 0,
        jumpCooldown: 0,
        aiThinkIn: rand(0, .14),
        jumps: 0,
        moveAcceleration: 520,
        maxMoveSpeed: 360,
        jumpPower: i === 0 ? 300 : rand(290, 325),
        jumpCooldownDuration: i === 0 ? 2 : rand(1.8, 2.7),
        respawnShieldDuration: 1.2,
        coinReach: 0,
        dangerLimit: 1.8,
        invulnerableUntil: 0,
        respawns: 0,
        flash: 0,
      };
    });
    remainingEl.textContent = String(TOTAL_CONTESTANTS);
    coinCountEl.textContent = '0';
    coinCountdownEl.textContent = '코인까지 10초';
    timerEl.textContent = '00:00';
    jumpStatusEl.textContent = 'SPACE · READY';
    jumpStatusEl.classList.add('ready');
    resultScreen.classList.remove('visible');
    state.running = autostart;
    shopButton.disabled = !autostart;
    state.lastTime = performance.now();
    startScreen.classList.toggle('visible', !autostart);
    if (autostart) canvas.focus({ preventScroll: true });
  }

  function pointSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const t = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby), 0, 1);
    const x = ax + abx * t;
    const y = ay + aby * t;
    return { x, y, dx: px - x, dy: py - y, t };
  }

  function collideCircleWithSegment(body, ax, ay, bx, by, halfWidth, rod) {
    if (body.jumpHeight > 14 || state.elapsed < body.invulnerableUntil) return;
    const hit = pointSegment(body.x, body.y, ax, ay, bx, by);
    const minDist = body.radius + halfWidth;
    let d = hypot(hit.dx, hit.dy);
    if (d >= minDist) return;
    let nx = hit.dx / d;
    let ny = hit.dy / d;
    if (d < .01) {
      nx = -(by - ay) / hypot(bx - ax, by - ay);
      ny = (bx - ax) / hypot(bx - ax, by - ay);
      d = .01;
    }
    const overlap = minDist - d;
    body.x += nx * overlap;
    body.y += ny * overlap;

    const rx = hit.x - rod.hub.x;
    const ry = hit.y - rod.hub.y;
    const surfaceVx = -ry * rod.angularVelocity;
    const surfaceVy = rx * rod.angularVelocity;
    const relVx = body.vx - surfaceVx;
    const relVy = body.vy - surfaceVy;
    const into = relVx * nx + relVy * ny;
    if (into < -1) {
      const bounce = -(1.38 * into) + 5;
      body.vx += nx * bounce;
      body.vy += ny * bounce;
      body.vx += surfaceVx * .075;
      body.vy += surfaceVy * .075;
      const torque = (rx * (-nx * bounce) + ry * (-ny * bounce)) / Math.max(rod.length * rod.length, 1);
      rod.angularVelocity += torque * 1.7;
      body.flash = .12;
    }
  }

  function resolveRodCollision(a, b) {
    if (!a.rodActive || !b.rodActive || a.hub !== b.hub) return;
    const delta = ((a.angle - b.angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
    const angularGap = rodAngularGap(a, b);
    const distance = Math.abs(delta);
    if (distance >= angularGap) return;

    const side = Math.sign(delta) || (a.id < b.id ? -1 : 1);
    const overlap = angularGap - distance;
    a.angle += side * overlap * .52;
    b.angle -= side * overlap * .52;

    const relativeSpeed = a.angularVelocity - b.angularVelocity;
    const closing = relativeSpeed * side < 0;
    if (!closing) return;

    const average = (a.angularVelocity + b.angularVelocity) * .5;
    const rebound = Math.max(Math.abs(relativeSpeed) * .43, .26);
    a.angularVelocity = average + side * rebound;
    b.angularVelocity = average - side * rebound;
  }

  function rodAngularGap(a, b) {
    const reach = Math.min(a.length, b.length);
    // Include both T-caps, not just the thin shafts, in the safety angle.
    return Math.atan2((a.length + b.length) * .12 + a.width + b.width, reach);
  }

  function positiveAngleDistance(from, to) {
    return ((to - from) % TAU + TAU) % TAU;
  }

  function forceRodEscape(rod, direction) {
    const speed = Math.max(Math.abs(rod.angularVelocity), rand(1.25, 2));
    rod.spinDirection = direction;
    rod.targetSpinSpeed = rand(1.25, 2.2);
    rod.angularVelocity = direction * speed;
    rod.turnMode = 'impact';
    rod.avoidanceUntil = state.elapsed + .38;
    rod.nextDirectionChange = Math.max(rod.nextDirectionChange, state.elapsed + rand(1.2, 2.4));
  }

  function avoidApproachingRods(rods) {
    if (rods.length < 2) return;
    const sorted = [...rods].sort((a, b) => {
      const aa = ((a.angle % TAU) + TAU) % TAU;
      const bb = ((b.angle % TAU) + TAU) % TAU;
      return aa - bb;
    });
    const handled = new Set();

    if (sorted.length >= 3) {
      for (let i = 0; i < sorted.length; i++) {
        const center = sorted[i];
        const clockwise = sorted[(i - 1 + sorted.length) % sorted.length];
        const counterClockwise = sorted[(i + 1) % sorted.length];
        const clockwiseDistance = positiveAngleDistance(clockwise.angle, center.angle);
        const counterDistance = positiveAngleDistance(center.angle, counterClockwise.angle);
        const clockwiseRange = Math.max(rodAngularGap(clockwise, center) * 1.65, .3);
        const counterRange = Math.max(rodAngularGap(center, counterClockwise) * 1.65, .3);
        const clockwiseClosing = center.angularVelocity - clockwise.angularVelocity < -.12;
        const counterClosing = counterClockwise.angularVelocity - center.angularVelocity < -.12;
        const unlocked = state.elapsed >= clockwise.avoidanceUntil && state.elapsed >= counterClockwise.avoidanceUntil;

        if (clockwiseDistance < clockwiseRange && counterDistance < counterRange && clockwiseClosing && counterClosing && unlocked) {
          forceRodEscape(clockwise, -1);
          forceRodEscape(counterClockwise, 1);
          handled.add(clockwise);
          handled.add(center);
          handled.add(counterClockwise);
          break;
        }
      }
    }

    for (let i = 0; i < rods.length; i++) {
      for (let j = i + 1; j < rods.length; j++) {
        const a = rods[i];
        const b = rods[j];
        if (handled.has(a) || handled.has(b)) continue;
        if (state.elapsed < a.avoidanceUntil || state.elapsed < b.avoidanceUntil) continue;
        const delta = ((a.angle - b.angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
        const side = Math.sign(delta) || (a.id < b.id ? -1 : 1);
        const approachRange = Math.max(rodAngularGap(a, b) * 1.4, .22);
        const closing = (a.angularVelocity - b.angularVelocity) * side < -.12;
        if (Math.abs(delta) < approachRange && closing) {
          forceRodEscape(a, side);
          forceRodEscape(b, -side);
          handled.add(a);
          handled.add(b);
        }
      }
    }
  }

  function startJump() {
    const player = state.contestants.find(c => c.player && c.alive);
    if (!state.running || state.finished || !player) return;
    beginJump(player);
  }

  function beginJump(body) {
    if (!body.alive || body.jumpCooldown > 0 || body.jumpHeight > 0 || body.jumpVelocity > 0) return false;
    body.jumpVelocity = body.jumpPower;
    body.jumpCooldown = body.jumpCooldownDuration;
    body.jumps++;
    state.ripples.push({ x: body.x, y: body.y, radius: 5, life: .5, color: body.color });
    return true;
  }

  function updateAIJump(body, rods, dt) {
    if (body.player) return;
    body.aiThinkIn -= dt;
    if (body.aiThinkIn > 0) return;
    body.aiThinkIn = rand(.08, .14);
    if (body.jumpCooldown > 0 || body.jumpHeight > 0 || state.elapsed < body.invulnerableUntil) return;

    // Predict both the shaft and T-cap at the AI's future position.
    for (const rod of rods) {
      for (const ahead of [.12, .24, .36]) {
        const angle = rod.angle + rod.angularVelocity * ahead;
        const ux = Math.cos(angle), uy = Math.sin(angle);
        const ex = rod.hub.x + ux * rod.length, ey = rod.hub.y + uy * rod.length;
        const px = body.x + body.vx * ahead, py = body.y + body.vy * ahead;
        const shaft = pointSegment(px, py, rod.hub.x, rod.hub.y, ex, ey);
        const tx = -uy * rod.length * .12, ty = ux * rod.length * .12;
        const cap = pointSegment(px, py, ex - tx, ey - ty, ex + tx, ey + ty);
        const clearance = Math.min(hypot(shaft.dx, shaft.dy), hypot(cap.dx, cap.dy));
        if (clearance < body.radius + rod.width + 9) {
          beginJump(body);
          return;
        }
      }
    }
  }

  function updateJump(body, dt) {
    body.jumpCooldown = Math.max(0, body.jumpCooldown - dt);
    if (body.jumpHeight <= 0 && body.jumpVelocity <= 0) return;

    body.jumpHeight += body.jumpVelocity * dt;
    body.jumpVelocity -= 760 * dt;
    if (body.jumpHeight <= 0) {
      body.jumpHeight = 0;
      body.jumpVelocity = 0;
      state.ripples.push({ x: body.x, y: body.y, radius: 8, life: .9, color: body.color });
      for (let i = 0; i < (body.player ? 8 : 3); i++) {
        const angle = rand(0, TAU);
        const speed = rand(22, 70);
        state.particles.push({ x: body.x, y: body.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: rand(.2, .45), maxLife: .45, color: '#ffffff', size: rand(1, 2.5) });
      }
    }
  }

  function updateJumpStatus() {
    const player = state.contestants.find(c => c.player);
    if (!player || !player.alive) return;
    if (player.jumpCooldown <= 0) {
      jumpStatusEl.textContent = 'SPACE · READY';
      jumpStatusEl.classList.add('ready');
    } else {
      jumpStatusEl.textContent = `JUMP · ${player.jumpCooldown.toFixed(1)}s`;
      jumpStatusEl.classList.remove('ready');
    }
  }


  function spawnCoin() {
    if (state.coins.length >= 32) return;
    for (let attempt = 0; attempt < 30; attempt++) {
      const angle = rand(0, TAU);
      const hub = state.hubs[Math.floor(Math.random() * state.hubs.length)];
      const radius = rand(100, 290);
      const x = hub.x + Math.cos(angle) * radius;
      const y = hub.y + Math.sin(angle) * radius;
      if (hypot(x - state.cx, y - state.cy) > state.arenaRadius - 50) continue;
      if (state.hubs.some(h => hypot(x - h.x, y - h.y) < h.radius + 24)) continue;
      if (state.coins.some(c => hypot(c.x - x, c.y - y) < 48)) continue;
      if (state.contestants.some(c => hypot(c.x - x, c.y - y) < c.radius + 24)) continue;
      state.coins.push({ x, y, radius: 14, expiresAt: state.elapsed + 30, phase: rand(0, TAU) });
      showToast('코인 1개 등장! 금색 코인을 모으세요');
      return;
    }
  }

  function updateCoins() {
    state.coins = state.coins.filter(c => c.expiresAt > state.elapsed);
    while (state.elapsed >= state.nextCoinTime) {
      spawnCoin();
      state.nextCoinTime += 10;
    }
    const player = state.contestants.find(c => c.player && c.alive);
    if (player && player.jumpHeight < 24) {
      state.coins = state.coins.filter(coin => {
        if (hypot(player.x - coin.x, player.y - coin.y) > player.radius + coin.radius + player.coinReach) return true;
        state.coinScore++;
        state.ripples.push({ x: coin.x, y: coin.y, radius: 8, life: .65, color: '#ffe268' });
        return false;
      });
    }
    coinCountEl.textContent = String(state.coinScore);
    coinCountdownEl.textContent = `코인까지 ${Math.max(0, Math.ceil(state.nextCoinTime - state.elapsed))}초`;
  }

  function upgradePrice(upgrade) {
    return upgrade.base + state.upgrades[upgrade.id] * 2;
  }

  function renderShop() {
    const player = state.contestants.find(c => c.player);
    document.querySelector('#shopBalance').textContent = String(state.coinScore);
    coinCountEl.textContent = String(state.coinScore);
    const stats = {
      speed: `기본 대비 +${state.upgrades.speed * 15}%`,
      jump: `현재 ${player.jumpCooldownDuration.toFixed(1)}초`,
      shield: `현재 ${player.respawnShieldDuration.toFixed(1)}초 무적`,
      magnet: `추가 수집 거리 ${player.coinReach}`,
    };
    for (const upgrade of UPGRADES) {
      const card = shopItems.querySelector(`[data-upgrade="${upgrade.id}"]`);
      const level = state.upgrades[upgrade.id];
      const maxed = level >= upgrade.max;
      const price = upgradePrice(upgrade);
      card.querySelector('.upgrade-level').textContent = `LV ${level} / ${upgrade.max}`;
      card.querySelector('.upgrade-stat').textContent = stats[upgrade.id];
      const button = card.querySelector('button');
      button.disabled = maxed || state.coinScore < price;
      button.textContent = maxed ? '최대 강화 완료' : `◉ ${price} · ${state.coinScore < price ? '코인 부족' : '업그레이드'}`;
    }
  }

  function openShop() {
    if (!state.running || state.shopOpen || state.finished) return;
    state.shopOpen = true;
    state.running = false;
    clearInput();
    document.querySelector('#shopMessage').textContent = '강화는 리스폰 후에도 유지됩니다.';
    renderShop();
    shopDialog.showModal();
  }

  function buyUpgrade(id) {
    const upgrade = UPGRADES.find(u => u.id === id);
    if (!state.shopOpen || !upgrade || state.upgrades[id] >= upgrade.max) return false;
    const price = upgradePrice(upgrade);
    if (state.coinScore < price) return false;
    state.coinScore -= price;
    state.upgrades[id]++;
    const player = state.contestants.find(c => c.player);
    player.moveAcceleration = 520 * (1 + state.upgrades.speed * .15);
    player.maxMoveSpeed = 360 * (1 + state.upgrades.speed * .15);
    player.jumpCooldownDuration = 2 - state.upgrades.jump * .2;
    player.jumpCooldown = Math.min(player.jumpCooldown, player.jumpCooldownDuration);
    player.respawnShieldDuration = 1.2 + state.upgrades.shield * .6;
    player.coinReach = state.upgrades.magnet * 24;
    renderShop();
    updateJumpStatus();
    document.querySelector('#shopMessage').textContent = `${upgrade.name} LV ${state.upgrades[id]} 강화 완료!`;
    return true;
  }

  function applyCenterPull(body, dt) {
    const dx = state.cx - body.x;
    const dy = state.cy - body.y;
    const distance = Math.hypot(dx, dy);
    if (distance < .001) return;
    // A gentle, capped acceleration preserves momentum and player control.
    // Ease off near the center instead of snapping characters into place.
    const acceleration = Math.min(distance * .12, 30);
    body.vx += dx / distance * acceleration * dt;
    body.vy += dy / distance * acceleration * dt;
  }

  function physicsStep(dt) {
    const alive = state.contestants.filter(c => c.alive);
    const rods = state.rods;
    const phaseBoost = 1;

    for (const rod of rods) {
      if (state.elapsed >= rod.nextDirectionChange) {
        rod.spinDirection = -(Math.sign(rod.angularVelocity) || rod.spinDirection);
        rod.targetSpinSpeed = rand(1.05, 2.2);
        rod.nextDirectionChange = state.elapsed + rand(1, 4);

        if (Math.random() < .42) {
          rod.turnMode = 'impact';
          rod.angularVelocity = rod.spinDirection * rand(1.3, 2.2);
        } else {
          rod.turnMode = 'inertia';
          rod.turnTorque = rand(2.6, 4.8);
          rod.angularVelocity += rand(-.18, .18);
        }
      }

      const targetVelocity = rod.spinDirection * rod.targetSpinSpeed;
      const responseTorque = rod.turnMode === 'impact' ? 3.8 : rod.turnTorque;
      const velocityError = targetVelocity - rod.angularVelocity;
      rod.angularVelocity += clamp(velocityError, -responseTorque * dt, responseTorque * dt);
      rod.angularVelocity *= Math.pow(.999, dt * 60);
      rod.angularVelocity += Math.sin(state.elapsed * .9 + rod.id * 2.1) * .0007;
      rod.angularVelocity = clamp(rod.angularVelocity, -2.25 * phaseBoost, 2.25 * phaseBoost);
      rod.angle += rod.angularVelocity * dt * phaseBoost;
      rod.flash = Math.max(0, rod.flash - dt);
    }

    for (const body of alive) {
      updateAIJump(body, rods, dt);
      updateJump(body, dt);
    }

    for (const hub of state.hubs) avoidApproachingRods(rods.filter(r => r.hub === hub));

    for (let i = 0; i < rods.length; i++) {
      for (let j = i + 1; j < rods.length; j++) resolveRodCollision(rods[i], rods[j]);
    }

    for (const body of alive) applySurvivalControl(body, alive, rods, dt);

    for (const body of alive) {
      body.vx *= Math.pow(.988, dt * 60);
      body.vy *= Math.pow(.988, dt * 60);
      body.spin *= Math.pow(.985, dt * 60);
      body.faceAngle += body.spin * dt;
      applyCenterPull(body, dt);

      for (const rod of rods) {
        const ux = Math.cos(rod.angle);
        const uy = Math.sin(rod.angle);
        const ex = rod.hub.x + ux * rod.length;
        const ey = rod.hub.y + uy * rod.length;
        collideCircleWithSegment(body, rod.hub.x, rod.hub.y, ex, ey, rod.width * .55, rod);
        const tx = -uy * rod.length * .12;
        const ty = ux * rod.length * .12;
        collideCircleWithSegment(body, ex - tx, ey - ty, ex + tx, ey + ty, rod.width * .55, rod);
      }

      for (const hub of state.hubs) {
        const hx = body.x - hub.x;
        const hy = body.y - hub.y;
        const hubDist = hypot(hx, hy);
        const hubRadius = hub.radius + body.radius;
        if (hubDist < hubRadius && body.jumpHeight <= 14 && state.elapsed >= body.invulnerableUntil) {
          const nx = hubDist < .01 ? 1 : hx / hubDist;
          const ny = hubDist < .01 ? 0 : hy / hubDist;
          body.x = hub.x + nx * hubRadius;
          body.y = hub.y + ny * hubRadius;
          const inward = body.vx * nx + body.vy * ny;
          if (inward < 0) {
            body.vx -= inward * nx * 1.7;
            body.vy -= inward * ny * 1.7;
          }
        }
      }
    }

    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        if (a.jumpHeight > 14 || b.jumpHeight > 14) continue;
        if (state.elapsed < a.invulnerableUntil || state.elapsed < b.invulnerableUntil) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = hypot(dx, dy);
        const minD = a.radius + b.radius;
        if (d >= minD) continue;
        const nx = dx / d;
        const ny = dy / d;
        const overlap = (minD - d) * .52;
        a.x -= nx * overlap;
        a.y -= ny * overlap;
        b.x += nx * overlap;
        b.y += ny * overlap;
        const relative = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (relative < 0) {
          const impulse = -relative * .78 + 10;
          a.vx -= nx * impulse;
          a.vy -= ny * impulse;
          b.vx += nx * impulse;
          b.vy += ny * impulse;
          a.spin -= impulse * .025;
          b.spin += impulse * .025;
        }
      }
    }

    for (const body of alive) {
      body.x += body.vx * dt;
      body.y += body.vy * dt;
      const dist = hypot(body.x - state.cx, body.y - state.cy);
      const safeRadius = state.arenaRadius;
      if (state.elapsed < body.invulnerableUntil) {
        body.danger = 0;
        continue;
      }
      body.danger = dist > safeRadius ? body.danger + dt : Math.max(0, body.danger - dt * 1.7);
      if (dist > safeRadius * .84) {
        const nx = (state.cx - body.x) / dist;
        const ny = (state.cy - body.y) / dist;
        const pull = (dist / safeRadius - .84) * 115;
        body.vx += nx * pull * dt;
        body.vy += ny * pull * dt;
      }
      if (body.danger > body.dangerLimit) eliminate(body, 'OUT OF ORBIT');
    }

    if (state.elapsed >= state.nextCull && alive.length > 1) {
      const candidates = state.contestants.filter(c => c.alive && state.elapsed >= c.invulnerableUntil);
      if (!candidates.length) return;
      const loser = candidates.sort((a, b) => {
        const da = hypot(a.x - state.cx, a.y - state.cy) + a.scoreJitter * 12;
        const db = hypot(b.x - state.cx, b.y - state.cy) + b.scoreJitter * 12;
        return db - da;
      })[0];
      const dx = loser.x - state.cx;
      const dy = loser.y - state.cy;
      const d = hypot(dx, dy);
      loser.vx += dx / d * 380;
      loser.vy += dy / d * 380;
      loser.danger = 1.2;
      state.nextCull += Math.max(4.2, 7.2 - state.round * .35);
    }
  }

  function applySurvivalControl(body, alive, rods, dt) {
    let ax = 0;
    let ay = 0;

    if (body.player) {
      const left = state.keys.has('ArrowLeft') || state.keys.has('KeyA');
      const right = state.keys.has('ArrowRight') || state.keys.has('KeyD');
      const up = state.keys.has('ArrowUp') || state.keys.has('KeyW');
      const down = state.keys.has('ArrowDown') || state.keys.has('KeyS');
      const inputX = Number(right) - Number(left);
      const inputY = Number(down) - Number(up);
      if (inputX || inputY) {
        const d = hypot(inputX, inputY);
        ax += inputX / d * body.moveAcceleration;
        ay += inputY / d * body.moveAcceleration;
        state.pointer.active = false;
      } else if (state.pointer.active) {
        const dx = state.pointer.x - body.x;
        const dy = state.pointer.y - body.y;
        const d = hypot(dx, dy);
        if (d < 12) {
          state.pointer.active = false;
        } else {
          const power = clamp(d * 4.2, 90, body.moveAcceleration);
          ax += dx / d * power;
          ay += dy / d * power;
        }
      }
    } else {
      const cx = state.cx - body.x;
      const cy = state.cy - body.y;
      const centerDist = hypot(cx, cy);
      const edgeRatio = centerDist / state.arenaRadius;
      const inwardPower = Math.max(0, edgeRatio - .78) * 520;
      ax += cx / centerDist * inwardPower;
      ay += cy / centerDist * inwardPower;

      // Each AI patrols a zone instead of every AI crowding the world center.
      const home = state.hubs[body.aiHub];
      const orbitAngle = body.aiPhase + state.elapsed * .22;
      ax += clamp((home.x + Math.cos(orbitAngle) * 180 - body.x) * .65, -150, 150);
      ay += clamp((home.y + Math.sin(orbitAngle) * 180 - body.y) * .65, -150, 150);

      for (const rod of rods) {
        const ex = rod.hub.x + Math.cos(rod.angle) * rod.length;
        const ey = rod.hub.y + Math.sin(rod.angle) * rod.length;
        const hit = pointSegment(body.x, body.y, rod.hub.x, rod.hub.y, ex, ey);
        const d = hypot(hit.dx, hit.dy);
        const avoidRange = body.radius + 52;
        if (d < avoidRange) {
          const nx = hit.dx / d;
          const ny = hit.dy / d;
          const rx = hit.x - rod.hub.x;
          const ry = hit.y - rod.hub.y;
          const surfaceVx = -ry * rod.angularVelocity;
          const surfaceVy = rx * rod.angularVelocity;
          const approaching = Math.max(0, -((body.vx - surfaceVx) * nx + (body.vy - surfaceVy) * ny));
          const power = (1 - d / avoidRange) * (95 + approaching * .75);
          ax += nx * power;
          ay += ny * power;
        }
      }

      for (const other of alive) {
        if (other === body) continue;
        const dx = body.x - other.x;
        const dy = body.y - other.y;
        const d = hypot(dx, dy);
        if (d < body.radius * 4.2) {
          const power = (1 - d / (body.radius * 4.2)) * 55;
          ax += dx / d * power;
          ay += dy / d * power;
        }
      }

      const wander = state.elapsed * (.75 + body.id * .025) + body.aiPhase;
      ax += Math.cos(wander) * 45;
      ay += Math.sin(wander * 1.13) * 45;
    }

    body.vx += ax * dt;
    body.vy += ay * dt;
    const speed = hypot(body.vx, body.vy);
    const maxSpeed = body.player ? body.maxMoveSpeed : 280;
    if (speed > maxSpeed) {
      body.vx = body.vx / speed * maxSpeed;
      body.vy = body.vy / speed * maxSpeed;
    }
  }

  function respawnContestant(body) {
    const oldX = body.x;
    const oldY = body.y;
    const others = state.contestants.filter(c => c.alive && c !== body);
    const rods = state.rods;
    const offset = rand(0, TAU);
    let best = { x: state.cx, y: state.cy, score: -Infinity };

    for (let i = 0; i < 18; i++) {
      const angle = offset + i / 18 * TAU;
      const hub = state.hubs[body.player ? i % state.hubs.length : body.aiHub];
      const radius = i % 2 ? 210 : 160;
      const x = hub.x + Math.cos(angle) * radius;
      const y = hub.y + Math.sin(angle) * radius;
      let characterClearance = state.arenaRadius;
      let rodClearance = state.arenaRadius;

      for (const other of others) characterClearance = Math.min(characterClearance, hypot(x - other.x, y - other.y));
      for (const rod of rods) {
        const ux = Math.cos(rod.angle), uy = Math.sin(rod.angle);
        const ex = rod.hub.x + ux * rod.length;
        const ey = rod.hub.y + uy * rod.length;
        const hit = pointSegment(x, y, rod.hub.x, rod.hub.y, ex, ey);
        const tx = -uy * rod.length * .12, ty = ux * rod.length * .12;
        const cap = pointSegment(x, y, ex - tx, ey - ty, ex + tx, ey + ty);
        rodClearance = Math.min(rodClearance, hypot(hit.dx, hit.dy), hypot(cap.dx, cap.dy));
      }

      const score = Math.min(characterClearance, rodClearance * 1.7);
      if (score > best.score) best = { x, y, score };
    }

    burst(oldX, oldY, body.color, 22);
    body.x = best.x;
    body.y = best.y;
    body.vx = 0;
    body.vy = 0;
    body.danger = 0;
    body.jumpHeight = 0;
    body.jumpVelocity = 0;
    body.invulnerableUntil = state.elapsed + body.respawnShieldDuration;
    body.respawns++;
    body.flash = .5;
    if (body.player) state.pointer.active = false;
    state.ripples.push({ x: body.x, y: body.y, radius: 7, life: 1, color: '#ffffff' });
    showToast(`${body.name} 리스폰 · ${body.respawnShieldDuration.toFixed(1)}초 보호`);
  }

  function eliminate(body, reason) {
    if (!body.alive || state.finished) return;
    respawnContestant(body);
  }

  function burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const speed = rand(45, 220);
      state.particles.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: rand(.4, 1), maxLife: 1, color, size: rand(2, 5) });
    }
    state.ripples.push({ x, y, radius: 10, life: 1, color });
  }

  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1500);
  }


  function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function updateParticles(dt) {
    for (const p of state.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(.97, dt * 60);
      p.vy *= Math.pow(.97, dt * 60);
    }
    state.particles = state.particles.filter(p => p.life > 0);
    for (const r of state.ripples) {
      r.life -= dt * 1.4;
      r.radius += dt * 100;
    }
    state.ripples = state.ripples.filter(r => r.life > 0);
  }

  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const scale = state.dpr * state.viewScale;
    ctx.setTransform(scale, 0, 0, scale, state.viewOffsetX * state.dpr, state.viewOffsetY * state.dpr);
    drawArena();
    drawCoins();
    const rods = state.rods;
    const characters = state.contestants.filter(c => c.alive).sort((a, b) => a.id - b.id);
    for (const rod of rods) drawRod(rod);
    for (const hub of state.hubs) drawHub(hub);
    for (const body of characters.filter(c => !c.player).sort((a, b) => a.jumpHeight - b.jumpHeight)) drawCharacter(body);
    const player = characters.find(c => c.player);
    if (player) drawCharacter(player);
    drawEffects();
    if (state.pointer.active) drawPointer();
  }

  function drawArena() {
    ctx.save();
    ctx.translate(state.cx, state.cy);
    const pulse = Math.sin(state.elapsed * 2) * 2;
    ctx.setLineDash([2, 10]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.beginPath();
    ctx.arc(0, 0, state.arenaRadius + pulse, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(216,255,62,.16)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(0, 0, state.arenaRadius, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(216,255,62,.90)';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#d8ff3e';
    ctx.shadowBlur = 14;
    ctx.stroke();
    ctx.restore();
    for (const hub of state.hubs) {
      ctx.strokeStyle = 'rgba(255,255,255,.055)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 12]);
      ctx.beginPath();
      ctx.arc(hub.x, hub.y, 280, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,.28)';
      ctx.font = '500 18px "DM Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText(`SECTOR 0${hub.id + 1}`, hub.x, hub.y - 295);
    }
  }

  function drawCoins() {
    for (const coin of state.coins) {
      ctx.save();
      ctx.translate(coin.x, coin.y);
      ctx.globalAlpha = coin.expiresAt - state.elapsed < 3 ? .55 + Math.sin(state.elapsed * 9) * .3 : 1;
      const pulse = 1 + Math.sin(state.elapsed * 3 + coin.phase) * .07;
      ctx.scale(pulse, pulse);
      ctx.shadowColor = '#ffcf38';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ffd64a';
      ctx.beginPath();
      ctx.arc(0, 0, coin.radius, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#a66a12';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, coin.radius * .7, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(0, 6);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawRod(rod) {
    const ux = Math.cos(rod.angle);
    const uy = Math.sin(rod.angle);
    const ex = rod.hub.x + ux * rod.length;
    const ey = rod.hub.y + uy * rod.length;
    const tx = -uy * rod.length * .12;
    const ty = ux * rod.length * .12;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.shadowColor = rod.color;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = rod.color;
    ctx.lineWidth = rod.width;
    ctx.globalAlpha = .95;
    ctx.beginPath();
    ctx.moveTo(rod.hub.x, rod.hub.y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.lineWidth = rod.width * 1.12;
    ctx.beginPath();
    ctx.moveTo(ex - tx, ey - ty);
    ctx.lineTo(ex + tx, ey + ty);
    ctx.stroke();
    ctx.restore();
  }

  function drawHub(hub) {
    const r = hub.radius;
    const glow = ctx.createRadialGradient(hub.x, hub.y, 0, hub.x, hub.y, r * 2.4);
    glow.addColorStop(0, 'rgba(255,255,255,.65)');
    glow.addColorStop(.35, 'rgba(255,255,255,.13)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, r * 2.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#e8e9e5';
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0b0c10';
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, r * .42, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(hub.x, hub.y, r * .7, state.elapsed, state.elapsed + Math.PI * 1.35);
    ctx.stroke();
  }

  function drawCharacter(body) {
    ctx.save();
    ctx.translate(body.x, body.y);
    if (body.jumpHeight > 0) {
      const heightRatio = clamp(body.jumpHeight / 60, 0, 1);
      ctx.fillStyle = `rgba(0,0,0,${.42 - heightRatio * .2})`;
      ctx.beginPath();
      ctx.ellipse(0, body.radius * .72, body.radius * (1 - heightRatio * .28), body.radius * .34, 0, 0, TAU);
      ctx.fill();
    }
    const visualLift = body.jumpHeight * .6;
    const airScale = 1 + body.jumpHeight / 520;
    ctx.translate(0, -visualLift);
    // Equal scaling preserves a perfectly round body at takeoff and landing.
    ctx.scale(airScale, airScale);
    ctx.rotate(body.faceAngle);
    if (state.elapsed < body.invulnerableUntil) {
      const shieldAlpha = .4 + Math.sin(state.elapsed * 22) * .18;
      ctx.fillStyle = `rgba(216,255,62,${shieldAlpha * .22})`;
      ctx.strokeStyle = `rgba(216,255,62,${shieldAlpha + .25})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, body.radius + 11, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    if (body.player) {
      ctx.strokeStyle = 'rgba(255,255,255,.92)';
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.arc(0, 0, body.radius + 7 + Math.sin(state.elapsed * 6) * 1.5, 0, TAU);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (body.danger > 0) {
      ctx.strokeStyle = `rgba(255,58,82,${clamp(body.danger, 0, 1)})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, body.radius + 6 + Math.sin(state.elapsed * 12) * 2, 0, TAU);
      ctx.stroke();
    }
    ctx.shadowColor = body.color;
    ctx.shadowBlur = body.flash > 0 ? 25 : 13;
    ctx.fillStyle = body.color;
    ctx.beginPath();
    ctx.arc(0, 0, body.radius, 0, TAU);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,.30)';
    ctx.beginPath();
    ctx.ellipse(-body.radius * .28, -body.radius * .35, body.radius * .22, body.radius * .13, -.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#090a0d';
    ctx.beginPath();
    ctx.arc(-body.radius * .31, -body.radius * .05, body.radius * .1, 0, TAU);
    ctx.arc(body.radius * .31, -body.radius * .05, body.radius * .1, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#090a0d';
    ctx.lineWidth = Math.max(1.5, body.radius * .09);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, body.radius * .12, body.radius * .28, .22, Math.PI - .22);
    ctx.stroke();
    if (body.player) {
      ctx.save();
      ctx.rotate(-body.faceAngle);
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 18px "DM Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('YOU', 0, -body.radius - 13);
      ctx.restore();
    }
    ctx.restore();
  }

  function drawEffects() {
    for (const r of state.ripples) {
      ctx.globalAlpha = r.life;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.radius, 0, TAU);
      ctx.stroke();
    }
    for (const p of state.particles) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPointer() {
    const p = state.pointer;
    const radius = 23 + Math.sin(state.elapsed * 8) * 3;
    ctx.strokeStyle = 'rgba(216,255,62,.68)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = 'rgba(216,255,62,.10)';
    ctx.fill();
  }

  function frame(now) {
    const dt = Math.min((now - state.lastTime) / 1000 || 0, .025);
    state.lastTime = now;
    if (state.running) {
      // Small integration steps keep fast rods from tunnelling through circles.
      for (let remaining = dt; remaining > .000001;) {
        const step = Math.min(remaining, 1 / 120);
        state.elapsed += step;
        physicsStep(step);
        remaining -= step;
      }
      updateParticles(dt);
      updateCoins();
      timerEl.textContent = formatTime(state.elapsed);
      updateJumpStatus();
    }
    draw();
    requestAnimationFrame(frame);
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left - state.viewOffsetX) / state.viewScale,
      y: (event.clientY - rect.top - state.viewOffsetY) / state.viewScale,
    };
  }

  arena.addEventListener('pointerdown', event => {
    if (event.target.closest('button')) return;
    if (!state.running || state.pointer.id !== null || event.button !== 0) return;
    event.preventDefault();
    const p = pointerPosition(event);
    state.pointer = { x: p.x, y: p.y, px: p.x, py: p.y, down: true, active: true, id: event.pointerId, type: event.pointerType };
    arena.setPointerCapture?.(event.pointerId);
    state.ripples.push({ x: p.x, y: p.y, radius: 8, life: .8, color: '#d8ff3e' });
  });

  arena.addEventListener('pointermove', event => {
    if (!state.pointer.down || event.pointerId !== state.pointer.id || !state.running) return;
    const p = pointerPosition(event);
    state.pointer.x = p.x;
    state.pointer.y = p.y;
    state.pointer.active = true;
  });

  function releasePointer(event) {
    if (event && event.pointerId !== state.pointer.id) return;
    const id = state.pointer.id;
    // Mouse clicks keep their destination; touch only steers while held.
    if (!event || event.type !== 'pointerup' || state.pointer.type !== 'mouse') state.pointer.active = false;
    state.pointer.down = false;
    state.pointer.id = null;
    state.pointer.type = null;
    if (id !== null && arena.hasPointerCapture?.(id)) arena.releasePointerCapture(id);
  }
  function clearInput() {
    state.keys.clear();
    releasePointer();
  }
  arena.addEventListener('pointerup', releasePointer);
  arena.addEventListener('pointercancel', releasePointer);
  arena.addEventListener('lostpointercapture', releasePointer);

  window.addEventListener('keydown', event => {
    if (event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (event.code === 'KeyB') {
      event.preventDefault();
      if (!event.repeat) {
        if (shopDialog.open) shopDialog.close();
        else openShop();
      }
      return;
    }
    if (state.shopOpen) return;
    if (event.code === 'Space') {
      if (event.target.closest('button')) return;
      event.preventDefault();
      if (!event.repeat) startJump();
      return;
    }
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
      event.preventDefault();
      state.keys.add(event.code);
    }
  });
  window.addEventListener('keyup', event => state.keys.delete(event.code));
  window.addEventListener('blur', clearInput);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });

  document.querySelector('#startButton').addEventListener('click', event => {
    event.stopPropagation();
    newGame(true);
  });
  document.querySelector('#againButton').addEventListener('click', event => {
    event.stopPropagation();
    newGame(true);
  });
  document.querySelector('#restartButton').addEventListener('click', () => newGame(true));
  const jumpButton = document.querySelector('#jumpButton');
  jumpButton.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse') return;
    event.preventDefault();
    startJump();
  });
  // The cooldown makes a subsequent compatibility click harmless; keyboard
  // and mouse users keep normal button activation.
  jumpButton.addEventListener('click', startJump);
  shopButton.addEventListener('click', openShop);
  document.querySelector('#closeShopButton').addEventListener('click', () => shopDialog.close());
  shopDialog.addEventListener('close', () => {
    if (!state.shopOpen || shopDialog.open) return;
    state.shopOpen = false;
    state.keys.clear();
    state.lastTime = performance.now();
    state.running = !state.finished;
    // Avoid leaving gameplay Space captured by the previously focused button.
    canvas.focus({ preventScroll: true });
  });
  shopItems.innerHTML = UPGRADES.map(u => `<article class="upgrade-card" data-upgrade="${u.id}">
    <div class="upgrade-top"><span class="upgrade-icon" aria-hidden="true">${u.icon}</span><span class="upgrade-level"></span></div>
    <h3>${u.name}</h3><p>${u.description}</p><p class="upgrade-stat"></p>
    <button type="button" aria-label="${u.name} 업그레이드"></button></article>`).join('');
  shopItems.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button) buyUpgrade(button.closest('[data-upgrade]').dataset.upgrade);
  });

  window.addEventListener('resize', () => {
    clearInput();
    const oldCx = state.cx;
    const oldCy = state.cy;
    resize();
    const dx = state.cx - oldCx;
    const dy = state.cy - oldCy;
    for (const c of state.contestants) { c.x += dx; c.y += dy; }
  });

  resize();
  newGame(false);
  requestAnimationFrame(frame);
})();
