(() => {
  'use strict';

  const canvas = document.querySelector('#gameCanvas');
  const ctx = canvas.getContext('2d');
  const arena = document.querySelector('#arena');
  const remainingEl = document.querySelector('#remaining');
  const timerEl = document.querySelector('#timer');
  const roundEl = document.querySelector('#roundLabel');
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
    state.arenaRadius = Math.min(rect.width * 0.43, rect.height * 0.34);
  }

  function newGame(autostart = true) {
    state.elapsed = 0;
    state.nextCull = 8.5;
    state.round = 1;
    state.finished = false;
    state.particles.length = 0;
    state.ripples.length = 0;
    state.contestants = COLORS.map((color, i) => {
      const angle = (i / COLORS.length) * TAU + rand(-0.12, 0.12);
      const length = state.arenaRadius * rand(.63, .9);
      const orbit = length * rand(.48, .82);
      const tangent = rand(-20, 20);
      return {
        id: i,
        name: NAMES[i],
        color,
        alive: true,
        alpha: 1,
        angle,
        angularVelocity: rand(-1.05, 1.05) + (i % 2 ? .22 : -.22),
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
        flash: 0,
      };
    });
    remainingEl.textContent = String(COLORS.length);
    roundEl.textContent = 'ROUND 01';
    timerEl.textContent = '00:00';
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
    if (!a.alive || !b.alive) return;
    let delta = ((a.angle - b.angle + Math.PI) % TAU + TAU) % TAU - Math.PI;
    const reach = Math.min(a.length, b.length);
    const angularGap = (a.width + b.width + 5) / Math.max(reach, 1);
    if (Math.abs(delta) < angularGap && Math.sign(a.angularVelocity - b.angularVelocity) === -Math.sign(delta)) {
      const mix = a.angularVelocity;
      a.angularVelocity = b.angularVelocity * .78 + mix * .12;
      b.angularVelocity = mix * .78 + b.angularVelocity * .12;
      a.angle += Math.sign(delta || 1) * angularGap * .5;
      b.angle -= Math.sign(delta || 1) * angularGap * .5;
    }
  }

  function physicsStep(dt) {
    const alive = state.contestants.filter(c => c.alive);
    const phaseBoost = 1 + (COLORS.length - alive.length) * .045;

    for (const rod of alive) {
      rod.angularVelocity *= Math.pow(.994, dt * 60);
      rod.angularVelocity += Math.sin(state.elapsed * .7 + rod.id * 2.1) * .00055;
      rod.angularVelocity = clamp(rod.angularVelocity, -2.25 * phaseBoost, 2.25 * phaseBoost);
      rod.angle += rod.angularVelocity * dt * phaseBoost;
      rod.flash = Math.max(0, rod.flash - dt);
    }

    for (let i = 0; i < alive.length; i++) {
      for (let j = i + 1; j < alive.length; j++) resolveRodCollision(alive[i], alive[j]);
    }

    for (const body of alive) {
      body.vx *= Math.pow(.988, dt * 60);
      body.vy *= Math.pow(.988, dt * 60);
      body.spin *= Math.pow(.985, dt * 60);
      body.faceAngle += body.spin * dt;
      body.vx += (state.cx - body.x) * .035 * dt;
      body.vy += (state.cy - body.y) * .035 * dt;

      for (const rod of alive) {
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
      if (hubDist < hubRadius) {
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

    if (state.pointer.down) applyPointerForce(dt);

    for (const body of alive) {
      body.x += body.vx * dt;
      body.y += body.vy * dt;
      const dist = hypot(body.x - state.cx, body.y - state.cy);
      const safeRadius = state.arenaRadius * (1.03 - Math.min(.14, state.elapsed * .0015));
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
      const candidates = state.contestants.filter(c => c.alive);
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

  function applyPointerForce(dt) {
    const p = state.pointer;
    const dragX = p.x - p.px;
    const dragY = p.y - p.py;
    const dragSpeed = hypot(dragX, dragY);
    for (const body of state.contestants) {
      if (!body.alive) continue;
      const dx = body.x - p.x;
      const dy = body.y - p.y;
      const d = hypot(dx, dy);
      const reach = state.arenaRadius * .48;
      if (d < reach) {
        const influence = (1 - d / reach) * dt * 60;
        body.vx += (dragX * 2.6 + dx / d * 15) * influence;
        body.vy += (dragY * 2.6 + dy / d * 15) * influence;
        body.spin += (dragX * dy - dragY * dx) * .00012;
      }
    }
    if (dragSpeed > 1.5) {
      for (const rod of state.contestants) {
        if (!rod.alive) continue;
        const ex = state.cx + Math.cos(rod.angle) * rod.length;
        const ey = state.cy + Math.sin(rod.angle) * rod.length;
        const hit = pointSegment(p.x, p.y, state.cx, state.cy, ex, ey);
        if (hypot(hit.dx, hit.dy) < 26) {
          const rx = p.x - state.cx;
          const ry = p.y - state.cy;
          rod.angularVelocity += (rx * dragY - ry * dragX) / Math.max(rod.length * rod.length, 1) * 2.3;
        }
      }
    }
    p.px += dragX * .45;
    p.py += dragY * .45;
  }

  function eliminate(body, reason) {
    if (!body.alive || state.finished) return;
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
    const rods = state.contestants.filter(c => c.alive).sort((a, b) => a.id - b.id);
    for (const rod of rods) drawRod(rod);
    drawHub();
    for (const body of rods) drawCharacter(body);
    drawEffects();
    if (state.pointer.down) drawPointer();
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
    ctx.rotate(body.faceAngle);
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
