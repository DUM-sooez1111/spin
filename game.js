(() => {
  'use strict';

  const canvas = document.querySelector('#gameCanvas');
  const ctx = canvas.getContext('2d');
  const arena = document.querySelector('#arena');
  const remainingEl = document.querySelector('#remaining');
  const timerEl = document.querySelector('#timer');
  const roundEl = document.querySelector('#roundLabel');
  const jumpStatusEl = document.querySelector('#jumpStatus');
  const toastEl = document.querySelector('#toast');
  const startScreen = document.querySelector('#startScreen');
  const resultScreen = document.querySelector('#resultScreen');
  const winnerFace = document.querySelector('#winnerFace');
  const winnerName = document.querySelector('#winnerName');
  const resultText = document.querySelector('#resultText');

  const COLORS = ['#ff3355', '#30a9ff', '#66ef45', '#32e5e0', '#ff79b7', '#ff9c32', '#f4f0e9', '#ffe94b', '#9454ff', '#20c7ff'];
  const NAMES = ['루비', '웨이브', '라임', '민트', '피치', '탱고', '모찌', '레몬', '바이올렛', '스카이'];
  const TAU = Math.PI * 2;
  const state = {
    running: false,
    finished: false,
    lastTime: 0,
    elapsed: 0,
    nextCull: 8.5,
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
    pointer: { x: 0, y: 0, px: 0, py: 0, down: false, active: false },
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.width = rect.width;
    state.height = rect.height;
    state.scale = Math.min(rect.width / 520, rect.height / 720);
    state.cx = rect.width / 2;
    state.cy = rect.height / 2 + rect.height * 0.025;
    state.arenaRadius = Math.min(rect.width * 0.455, rect.height * 0.355);
  }

  function newGame(autostart = true) {
    state.elapsed = 0;
    state.nextCull = 8.5;
    state.round = 1;
    state.finished = false;
    state.particles.length = 0;
    state.ripples.length = 0;
    state.pointer.active = false;
    state.pointer.down = false;
    state.keys.clear();
    state.contestants = COLORS.map((color, i) => {
      const angle = (i / COLORS.length) * TAU + rand(-0.12, 0.12);
      const length = state.arenaRadius * rand(.63, .9);
      const orbit = length * rand(.48, .82);
      const tangent = rand(-20, 20);
      const initialDirection = Math.random() < .5 ? -1 : 1;
      const angularVelocity = initialDirection * rand(1.05, 1.8);
      return {
        id: i,
        name: i === 0 ? 'YOU' : NAMES[i],
        player: i === 0,
        rodActive: i < 4,
        color,
        alive: true,
        alpha: 1,
        angle,
        angularVelocity,
        spinDirection: Math.sign(angularVelocity) || (i % 2 ? 1 : -1),
        targetSpinSpeed: rand(1.1, 2.15),
        turnTorque: rand(2.6, 4.5),
        nextDirectionChange: rand(1, 4),
        turnMode: 'inertia',
        avoidanceUntil: 0,
        length,
        width: Math.max(4, state.scale * 5),
        radius: Math.max(13, state.scale * 16),
        x: state.cx + Math.cos(angle) * orbit,
        y: state.cy + Math.sin(angle) * orbit,
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
        jumpSquash: 0,
        invulnerableUntil: 0,
        respawns: 0,
        flash: 0,
      };
    });
    remainingEl.textContent = String(COLORS.length);
    roundEl.textContent = 'ROUND 01';
    timerEl.textContent = '00:00';
    jumpStatusEl.textContent = 'SPACE · READY';
    jumpStatusEl.classList.add('ready');
    resultScreen.classList.remove('visible');
    state.running = autostart;
    state.lastTime = performance.now();
    if (autostart) startScreen.classList.remove('visible');
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
    if (body.jumpHeight > 14 || (body.player && state.elapsed < body.invulnerableUntil)) return;
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

    const rx = hit.x - state.cx;
    const ry = hit.y - state.cy;
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
    if (!a.rodActive || !b.rodActive) return;
    const delta = ((a.angle - b.angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
    const reach = Math.min(a.length, b.length);
    const angularGap = (a.width + b.width + 5) / Math.max(reach, 1);
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
    return (a.width + b.width + 5) / Math.max(reach, 1);
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
        const clockwiseRange = Math.max(rodAngularGap(clockwise, center) * 4, .3);
        const counterRange = Math.max(rodAngularGap(center, counterClockwise) * 4, .3);
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
        const approachRange = Math.max(rodAngularGap(a, b) * 3.2, .22);
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
    if (!state.running || state.finished || !player || player.jumpCooldown > 0 || player.jumpHeight > 0) return;
    player.jumpVelocity = 300;
    player.jumpCooldown = 2;
    player.jumpSquash = 1;
    state.ripples.push({ x: player.x, y: player.y, radius: 5, life: .75, color: '#ffffff' });
  }

  function updateJump(body, dt) {
    if (!body.player) return;
    body.jumpCooldown = Math.max(0, body.jumpCooldown - dt);
    body.jumpSquash *= Math.pow(.035, dt);
    if (body.jumpHeight <= 0 && body.jumpVelocity <= 0) return;

    body.jumpHeight += body.jumpVelocity * dt;
    body.jumpVelocity -= 760 * dt;
    if (body.jumpHeight <= 0) {
      body.jumpHeight = 0;
      body.jumpVelocity = 0;
      body.jumpSquash = -.7;
      state.ripples.push({ x: body.x, y: body.y, radius: 8, life: .9, color: body.color });
      for (let i = 0; i < 8; i++) {
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

  function physicsStep(dt) {
    const alive = state.contestants.filter(c => c.alive);
    const rods = state.contestants.filter(c => c.rodActive);
    const phaseBoost = 1 + (COLORS.length - alive.length) * .045;

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

    for (const body of alive) updateJump(body, dt);

    avoidApproachingRods(rods);

    for (let i = 0; i < rods.length; i++) {
      for (let j = i + 1; j < rods.length; j++) resolveRodCollision(rods[i], rods[j]);
    }

    for (const body of alive) applySurvivalControl(body, alive, rods, dt);

    for (const body of alive) {
      body.vx *= Math.pow(.988, dt * 60);
      body.vy *= Math.pow(.988, dt * 60);
      body.spin *= Math.pow(.985, dt * 60);
      body.faceAngle += body.spin * dt;
      body.vx += (state.cx - body.x) * .035 * dt;
      body.vy += (state.cy - body.y) * .035 * dt;

      for (const rod of rods) {
        const ux = Math.cos(rod.angle);
        const uy = Math.sin(rod.angle);
        const ex = state.cx + ux * rod.length;
        const ey = state.cy + uy * rod.length;
        collideCircleWithSegment(body, state.cx, state.cy, ex, ey, rod.width * .55, rod);
        const tx = -uy * rod.length * .12;
        const ty = ux * rod.length * .12;
        collideCircleWithSegment(body, ex - tx, ey - ty, ex + tx, ey + ty, rod.width * .55, rod);
      }

      const hx = body.x - state.cx;
      const hy = body.y - state.cy;
      const hubDist = hypot(hx, hy);
      const hubRadius = state.arenaRadius * .075 + body.radius;
      if (hubDist < hubRadius && body.jumpHeight <= 14 && !(body.player && state.elapsed < body.invulnerableUntil)) {
        const nx = hx / hubDist;
        const ny = hy / hubDist;
        body.x = state.cx + nx * hubRadius;
        body.y = state.cy + ny * hubRadius;
        const inward = body.vx * nx + body.vy * ny;
        if (inward < 0) {
          body.vx -= inward * nx * 1.7;
          body.vy -= inward * ny * 1.7;
        }
      }
    }

    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) {
        const a = alive[i];
        const b = alive[j];
        if (a.jumpHeight > 14 || b.jumpHeight > 14) continue;
        if ((a.player && state.elapsed < a.invulnerableUntil) || (b.player && state.elapsed < b.invulnerableUntil)) continue;
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
      const safeRadius = state.arenaRadius * (1.03 - Math.min(.14, state.elapsed * .0015));
      if (body.player && state.elapsed < body.invulnerableUntil) {
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
      if (body.danger > 1.8) eliminate(body, 'OUT OF ORBIT');
    }

    if (state.elapsed >= state.nextCull && alive.length > 1) {
      const candidates = state.contestants.filter(c => c.alive && !(c.player && state.elapsed < c.invulnerableUntil));
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
        ax += inputX / d * 285;
        ay += inputY / d * 285;
        state.pointer.active = false;
      } else if (state.pointer.active) {
        const dx = state.pointer.x - body.x;
        const dy = state.pointer.y - body.y;
        const d = hypot(dx, dy);
        if (d < 12) {
          state.pointer.active = false;
        } else {
          const power = clamp(d * 4.2, 90, 285);
          ax += dx / d * power;
          ay += dy / d * power;
        }
      }
    } else {
      const cx = state.cx - body.x;
      const cy = state.cy - body.y;
      const centerDist = hypot(cx, cy);
      const edgeRatio = centerDist / state.arenaRadius;
      const inwardPower = 18 + Math.max(0, edgeRatio - .55) * 230;
      ax += cx / centerDist * inwardPower;
      ay += cy / centerDist * inwardPower;

      for (const rod of rods) {
        const ex = state.cx + Math.cos(rod.angle) * rod.length;
        const ey = state.cy + Math.sin(rod.angle) * rod.length;
        const hit = pointSegment(body.x, body.y, state.cx, state.cy, ex, ey);
        const d = hypot(hit.dx, hit.dy);
        const avoidRange = body.radius + 34;
        if (d < avoidRange) {
          const nx = hit.dx / d;
          const ny = hit.dy / d;
          const rx = hit.x - state.cx;
          const ry = hit.y - state.cy;
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
      ax += Math.cos(wander) * 24;
      ay += Math.sin(wander * 1.13) * 24;
    }

    body.vx += ax * dt;
    body.vy += ay * dt;
    const speed = hypot(body.vx, body.vy);
    const maxSpeed = body.player ? 245 : 195;
    if (speed > maxSpeed) {
      body.vx = body.vx / speed * maxSpeed;
      body.vy = body.vy / speed * maxSpeed;
    }
  }

  function respawnPlayer(body) {
    const oldX = body.x;
    const oldY = body.y;
    const others = state.contestants.filter(c => c.alive && c !== body);
    const rods = state.contestants.filter(c => c.rodActive);
    const offset = rand(0, TAU);
    let best = { x: state.cx, y: state.cy, score: -Infinity };

    for (let i = 0; i < 18; i++) {
      const angle = offset + i / 18 * TAU;
      const radius = state.arenaRadius * (i % 2 ? .42 : .3);
      const x = state.cx + Math.cos(angle) * radius;
      const y = state.cy + Math.sin(angle) * radius;
      let characterClearance = state.arenaRadius;
      let rodClearance = state.arenaRadius;

      for (const other of others) characterClearance = Math.min(characterClearance, hypot(x - other.x, y - other.y));
      for (const rod of rods) {
        const ex = state.cx + Math.cos(rod.angle) * rod.length;
        const ey = state.cy + Math.sin(rod.angle) * rod.length;
        const hit = pointSegment(x, y, state.cx, state.cy, ex, ey);
        rodClearance = Math.min(rodClearance, hypot(hit.dx, hit.dy));
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
    body.jumpSquash = -.85;
    body.invulnerableUntil = state.elapsed + 1.2;
    body.respawns++;
    body.flash = .5;
    state.pointer.active = false;
    state.ripples.push({ x: body.x, y: body.y, radius: 7, life: 1, color: '#ffffff' });
    showToast(`YOU 리스폰 · 1.2초 보호`);
  }

  function eliminate(body, reason) {
    if (!body.alive || state.finished) return;
    if (body.player) {
      respawnPlayer(body);
      return;
    }
    body.alive = false;
    state.round++;
    const alive = state.contestants.filter(c => c.alive);
    remainingEl.textContent = String(alive.length);
    roundEl.textContent = `ROUND ${String(Math.min(state.round, 10)).padStart(2, '0')}`;
    showToast(`${body.name} 탈락 · ${reason}`);
    burst(body.x, body.y, body.color, 26);
    if (alive.length === 1) finish(alive[0]);
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

  function finish(winner) {
    state.finished = true;
    setTimeout(() => {
      state.running = false;
      winnerFace.style.setProperty('--winner', winner.color);
      winnerName.textContent = `${winner.name} 승리!`;
      resultText.textContent = `${formatTime(state.elapsed)} 동안 마지막 궤도를 지켰습니다.`;
      resultScreen.classList.add('visible');
    }, 900);
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
    ctx.clearRect(0, 0, state.width, state.height);
    drawArena();
    const rods = state.contestants.filter(c => c.rodActive).sort((a, b) => a.id - b.id);
    const characters = state.contestants.filter(c => c.alive).sort((a, b) => a.id - b.id);
    for (const rod of rods) drawRod(rod);
    drawHub();
    for (const body of characters.filter(c => !c.player)) drawCharacter(body);
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
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    ctx.beginPath();
    ctx.arc(0, 0, state.arenaRadius + pulse, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(216,255,62,.04)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(0, 0, state.arenaRadius, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  function drawRod(rod) {
    const ux = Math.cos(rod.angle);
    const uy = Math.sin(rod.angle);
    const ex = state.cx + ux * rod.length;
    const ey = state.cy + uy * rod.length;
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
    ctx.moveTo(state.cx, state.cy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.lineWidth = rod.width * 1.12;
    ctx.beginPath();
    ctx.moveTo(ex - tx, ey - ty);
    ctx.lineTo(ex + tx, ey + ty);
    ctx.stroke();
    ctx.restore();
  }

  function drawHub() {
    const r = state.arenaRadius * .075;
    const glow = ctx.createRadialGradient(state.cx, state.cy, 0, state.cx, state.cy, r * 2.4);
    glow.addColorStop(0, 'rgba(255,255,255,.65)');
    glow.addColorStop(.35, 'rgba(255,255,255,.13)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(state.cx, state.cy, r * 2.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#e8e9e5';
    ctx.beginPath();
    ctx.arc(state.cx, state.cy, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0b0c10';
    ctx.beginPath();
    ctx.arc(state.cx, state.cy, r * .42, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(state.cx, state.cy, r * .7, state.elapsed, state.elapsed + Math.PI * 1.35);
    ctx.stroke();
  }

  function drawCharacter(body) {
    ctx.save();
    ctx.translate(body.x, body.y);
    if (body.player && body.jumpHeight > 0) {
      const heightRatio = clamp(body.jumpHeight / 60, 0, 1);
      ctx.fillStyle = `rgba(0,0,0,${.42 - heightRatio * .2})`;
      ctx.beginPath();
      ctx.ellipse(0, body.radius * .72, body.radius * (1 - heightRatio * .28), body.radius * .34, 0, 0, TAU);
      ctx.fill();
    }
    const visualLift = body.player ? body.jumpHeight * .34 : 0;
    const airScale = body.player ? 1 + body.jumpHeight / 520 : 1;
    const squashX = 1 - body.jumpSquash * .1;
    const squashY = 1 + body.jumpSquash * .15;
    ctx.translate(0, -visualLift);
    ctx.scale(airScale * squashX, airScale * squashY);
    ctx.rotate(body.faceAngle);
    if (body.player && state.elapsed < body.invulnerableUntil) {
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
      ctx.font = '700 9px "DM Mono", monospace';
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
      state.elapsed += dt;
      physicsStep(dt);
      updateParticles(dt);
      timerEl.textContent = formatTime(state.elapsed);
      updateJumpStatus();
    }
    draw();
    requestAnimationFrame(frame);
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  arena.addEventListener('pointerdown', event => {
    if (!state.running) return;
    const p = pointerPosition(event);
    state.pointer = { x: p.x, y: p.y, px: p.x, py: p.y, down: true, active: true };
    arena.setPointerCapture?.(event.pointerId);
    state.ripples.push({ x: p.x, y: p.y, radius: 8, life: .8, color: '#d8ff3e' });
  });

  arena.addEventListener('pointermove', event => {
    if (!state.pointer.down) return;
    const p = pointerPosition(event);
    state.pointer.x = p.x;
    state.pointer.y = p.y;
  });

  const releasePointer = () => { state.pointer.down = false; };
  arena.addEventListener('pointerup', releasePointer);
  arena.addEventListener('pointercancel', releasePointer);

  window.addEventListener('keydown', event => {
    if (event.code === 'Space') {
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
  window.addEventListener('blur', () => state.keys.clear());

  document.querySelector('#startButton').addEventListener('click', event => {
    event.stopPropagation();
    newGame(true);
  });
  document.querySelector('#againButton').addEventListener('click', event => {
    event.stopPropagation();
    newGame(true);
  });
  document.querySelector('#restartButton').addEventListener('click', () => newGame(true));

  window.addEventListener('resize', () => {
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
