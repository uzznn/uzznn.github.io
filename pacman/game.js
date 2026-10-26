(() => {
  'use strict';

  /* ── 캔버스 ── */
  const cv  = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const W = 560, H = 620;
  cv.width  = W;
  cv.height = H;

  const FONT  = '"Courier New", monospace';
  const KFONT = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';

  /* ── 맵 (21×21) ──
     # 벽  . 도트  o 파워펠릿  ' ' 통로(빈칸)  G 고스트홈  = 고스트집문  P 팩맨시작
  */
  const MAP_SRC = [
    '#####################',
    '#........#..........#',
    '#o##.###.#.###.##.o#',
    '#...................#',
    '#.##.#.#######.#.##.#',
    '#....#....#....#....#',
    '#.######. # .######.#',
    '#.#    .   .    #.  #',
    '#.# ##.#####.## #.  #',
    '#   #   GGG   #     #',
    '#.# #   ###   # #.  #',
    '#.# ##.#####.## #.  #',
    '#.#    .   .    #.  #',
    '#.######. # .######.#',
    '#....#....#....#....#',
    '#.##.#.#######.#.##.#',
    '#...................#',
    '#o##.###.#.###.##.o#',
    '#........P..........#',
    '#####################',
  ];

  /* 맵이 직사각형이 아닐 수 있으니 최대 열 길이로 정규화 */
  const ROWS = MAP_SRC.length;
  const COLS = Math.max(...MAP_SRC.map(r => r.length));
  /* 모든 행을 COLS 길이로 맞추기 (짧은 행은 빈칸 패딩) */
  const MAP_NORM = MAP_SRC.map(r => r.padEnd(COLS, ' '));

  const HUD_H = 80;                   // 상단 HUD 높이
  const CS    = (H - HUD_H) / ROWS;  // 셀 크기

  const T_WALL  = 0;
  const T_DOT   = 1;
  const T_POWER = 2;
  const T_EMPTY = 3;

  let map        = [];
  let totalDots  = 0;
  let pacStart   = { r: 18, c: 9 };
  let ghostStarts = [];

  function buildMap() {
    map = [];
    totalDots   = 0;
    ghostStarts = [];
    for (let r = 0; r < ROWS; r++) {
      map[r] = [];
      for (let c = 0; c < COLS; c++) {
        const ch = MAP_NORM[r][c];
        if      (ch === '#') { map[r][c] = T_WALL; }
        else if (ch === '.') { map[r][c] = T_DOT;   totalDots++; }
        else if (ch === 'o') { map[r][c] = T_POWER; totalDots++; }
        else if (ch === 'P') { map[r][c] = T_DOT;   totalDots++; pacStart = { r, c }; }
        else if (ch === 'G') { map[r][c] = T_EMPTY; ghostStarts.push({ r, c }); }
        else if (ch === '=') { map[r][c] = T_EMPTY; }
        else                  { map[r][c] = T_EMPTY; }
      }
    }
    /* 고스트 시작점 없으면 중앙 근처 기본값 */
    if (ghostStarts.length === 0) ghostStarts = [{ r: 9, c: 10 }];
  }

  /* ── 상태 ── */
  let state      = 'title';
  let score      = 0;
  let hi         = 0;
  let lives      = 3;
  let dotsEaten  = 0;
  let level      = 1;
  let t          = 0;
  let titleBlink = 0;
  let deadTimer  = 0;
  let clearTimer = 0;
  let deadPending = false;

  try { hi = +localStorage.getItem('pacman_hi') || 0; } catch (e) { hi = 0; }

  /* ================================================================
     팩맨 이동 – 픽셀 좌표 기반, 셀 중앙 스냅으로 벽 끼임 방지
     pos.x / pos.y : 픽셀 위치 (셀 중앙)
     dir  : 현재 이동 방향  { x, y }
     next : 다음 입력 방향
  ================================================================ */
  let pac = {};

  function cellToPixel(r, c) {
    return {
      x: c * CS + CS / 2,
      y: r * CS + CS / 2 + HUD_H,
    };
  }

  function pixelToCell(x, y) {
    return {
      r: Math.floor((y - HUD_H) / CS),
      c: Math.floor(x / CS),
    };
  }

  /* 픽셀 좌표에서 셀 중앙까지의 오프셋 (−CS/2 ~ +CS/2) */
  function offsetFromCenter(x, y) {
    const col = Math.floor(x / CS);
    const row = Math.floor((y - HUD_H) / CS);
    const cx  = col * CS + CS / 2;
    const cy  = row * CS + CS / 2 + HUD_H;
    return { dx: x - cx, dy: y - cy };
  }

  function tileAt(r, c) {
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return T_EMPTY;
    return map[r][c];
  }

  /* 방향 { x, y } 로 한 칸 이동 시 벽인지 확인 */
  function wallAhead(px, py, dx, dy) {
    /* 이동 방향 앞 셀의 중앙에 닿기 직전 판단 */
    const checkX = px + dx * CS;
    const checkY = py + dy * CS;
    const cell   = pixelToCell(checkX, checkY);
    return tileAt(cell.r, cell.c) === T_WALL;
  }

  /* 현재 위치가 셀 중앙에 충분히 가까운지 (방향 전환 허용 임계값) */
  const SNAP_THRESH = CS * 0.4;

  function nearCenter(px, py) {
    const { dx, dy } = offsetFromCenter(px, py);
    return Math.abs(dx) < SNAP_THRESH && Math.abs(dy) < SNAP_THRESH;
  }

  /* 셀 중앙으로 스냅 */
  function snapToCenter(px, py) {
    const col = Math.floor(px / CS);
    const row = Math.floor((py - HUD_H) / CS);
    return {
      x: col * CS + CS / 2,
      y: row * CS + CS / 2 + HUD_H,
    };
  }

  function resetPac() {
    const { x, y } = cellToPixel(pacStart.r, pacStart.c);
    pac = {
      x, y,
      dir:      { x: 0, y: 0 },
      next:     { x: -1, y: 0 },
      speed:    CS * 7,   // px/초
      mouth:    0,
      mouthDir: 1,
      angle:    0,
      alive:    true,
    };
  }

  /* ================================================================
     고스트
  ================================================================ */
  const GHOST_COLORS     = ['#FF0000', '#FFB8FF', '#00FFFF', '#FFB852'];
  const GHOST_NAMES      = ['Blinky', 'Pinky', 'Inky', 'Clyde'];
  const FRIGHTENED_CLR   = '#2121DE';
  const FRIGHTENED_BLINK = '#FFFFFF';

  let ghosts = [];

  function resetGhosts() {
    ghosts = GHOST_NAMES.map((name, i) => {
      const gs = ghostStarts[i % ghostStarts.length];
      const { x, y } = cellToPixel(gs.r, gs.c);
      return {
        name,
        x, y,
        dir:         { x: i % 2 === 0 ? 1 : -1, y: 0 },
        speed:       CS * 6.5,
        mode:        'scatter',
        frightenedT: 0,
        exitDelay:   i * 2.0,
        inHouse:     true,
        color:       GHOST_COLORS[i],
      };
    });
  }

  /* ── 오디오 ── */
  let AC = null, muted = false;
  function initAudio() {
    if (AC) return;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; }
  }
  function beep(freq, dur, type, vol, endFreq) {
    if (muted || !AC) return;
    try {
      const o = AC.createOscillator(), g = AC.createGain(), now = AC.currentTime;
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, now);
      if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, now + dur);
      g.gain.setValueAtTime(vol || 0.04, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g); g.connect(AC.destination);
      o.start(now); o.stop(now + dur);
    } catch (e) {}
  }
  const sfx = {
    dot:   () => beep(440, 0.05, 'square', 0.02),
    power: () => beep(200, 0.15, 'sawtooth', 0.06, 400),
    eat:   () => beep(300, 0.2, 'sawtooth', 0.05, 80),
    die:   () => [440,415,392,370,349,330,311,294,277,262,247,233,220]
                   .forEach((f, i) => setTimeout(() => beep(f, 0.09, 'square', 0.05), i * 80)),
    start: () => [440,494,523,587,659,698,784]
                   .forEach((f, i) => setTimeout(() => beep(f, 0.1, 'square', 0.04), i * 90)),
    clear: () => [523,659,784,1047]
                   .forEach((f, i) => setTimeout(() => beep(f, 0.15, 'square', 0.05), i * 120)),
  };

  /* ── 입력 ── */
  const keys = {};
  let swipeStart = null;

  function tryStart() {
    if (state === 'title' || state === 'gameover' || state === 'clear') startGame();
  }

  addEventListener('keydown', e => {
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space'].includes(e.code)) e.preventDefault();
    keys[e.code] = true;
    initAudio();
    if (e.repeat) return;
    if (e.code === 'Enter' || e.code === 'Space') tryStart();
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if (state === 'play') state = 'pause';
      else if (state === 'pause') state = 'play';
    }
    if (e.code === 'KeyM') muted = !muted;
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    if (state === 'play') state = 'pause';
  });

  cv.addEventListener('pointerdown', e => {
    initAudio();
    swipeStart = { x: e.clientX, y: e.clientY };
    tryStart();
    if (state === 'pause') state = 'play';
  });
  cv.addEventListener('pointerup', e => {
    if (!swipeStart) return;
    const dx = e.clientX - swipeStart.x, dy = e.clientY - swipeStart.y;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (Math.max(adx, ady) < 15) { swipeStart = null; return; }
    if (adx > ady) pac.next = { x: dx > 0 ? 1 : -1, y: 0 };
    else           pac.next = { x: 0, y: dy > 0 ? 1 : -1 };
    swipeStart = null;
  });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.focus();

  /* ── 게임 흐름 ── */
  function startGame() {
    score = 0; lives = 3; dotsEaten = 0; level = 1; deadPending = false;
    buildMap();
    resetPac();
    resetGhosts();
    state = 'play';
    sfx.start();
  }

  function nextLevel() {
    level++;
    dotsEaten  = 0;
    deadPending = false;
    buildMap();
    resetPac();
    resetGhosts();
    const lv = level - 1;
    pac.speed = CS * Math.min(10, 7 + lv * 0.3);
    ghosts.forEach(g => { g.speed = CS * Math.min(9, 6.5 + lv * 0.25); });
  }

  /* ================================================================
     팩맨 업데이트
  ================================================================ */
  function updatePac(dt) {
    if (!pac.alive) {
      deadTimer -= dt;
      return;
    }

    /* 키 입력 → next 방향 */
    if      (keys.ArrowLeft  || keys.KeyA) pac.next = { x: -1, y: 0 };
    else if (keys.ArrowRight || keys.KeyD) pac.next = { x:  1, y: 0 };
    else if (keys.ArrowUp    || keys.KeyW) pac.next = { x:  0, y: -1 };
    else if (keys.ArrowDown  || keys.KeyS) pac.next = { x:  0, y:  1 };

    /* 셀 중앙 근처일 때만 방향 전환/벽 체크 */
    if (nearCenter(pac.x, pac.y)) {
      /* 중앙으로 스냅 (부동소수점 오차 제거) */
      const snapped = snapToCenter(pac.x, pac.y);
      pac.x = snapped.x;
      pac.y = snapped.y;

      /* next 방향으로 전환 가능하면 전환 */
      if ((pac.next.x !== 0 || pac.next.y !== 0) &&
          !wallAhead(pac.x, pac.y, pac.next.x, pac.next.y)) {
        pac.dir = { ...pac.next };
      }

      /* 현재 dir 로 진행 불가 → 정지 */
      if ((pac.dir.x !== 0 || pac.dir.y !== 0) &&
          wallAhead(pac.x, pac.y, pac.dir.x, pac.dir.y)) {
        pac.dir = { x: 0, y: 0 };
      }
    }

    /* 이동 */
    pac.x += pac.dir.x * pac.speed * dt;
    pac.y += pac.dir.y * pac.speed * dt;

    /* 터널 (좌우) */
    const tunnelY = HUD_H + CS * 9 + CS / 2; // 9번 행 (터널 행)
    if (Math.abs(pac.y - tunnelY) < CS) {
      if (pac.x < -CS / 2)         pac.x = W + CS / 2;
      if (pac.x > W + CS / 2)      pac.x = -CS / 2;
    }

    /* 방향각 */
    if      (pac.dir.x > 0)  pac.angle =  0;
    else if (pac.dir.x < 0)  pac.angle =  Math.PI;
    else if (pac.dir.y < 0)  pac.angle = -Math.PI / 2;
    else if (pac.dir.y > 0)  pac.angle =  Math.PI / 2;

    /* 입 애니메이션 */
    if (pac.dir.x !== 0 || pac.dir.y !== 0) {
      pac.mouth += pac.mouthDir * 4.5 * dt;
      if (pac.mouth >= 1) { pac.mouth = 1; pac.mouthDir = -1; }
      if (pac.mouth <= 0) { pac.mouth = 0; pac.mouthDir =  1; }
    }

    /* 도트 먹기 – 현재 셀 */
    const cell = pixelToCell(pac.x, pac.y);
    if (cell.r >= 0 && cell.r < ROWS && cell.c >= 0 && cell.c < COLS) {
      const tile = map[cell.r][cell.c];
      if (tile === T_DOT) {
        map[cell.r][cell.c] = T_EMPTY;
        score += 10; dotsEaten++;
        sfx.dot();
        checkClear();
      } else if (tile === T_POWER) {
        map[cell.r][cell.c] = T_EMPTY;
        score += 50; dotsEaten++;
        sfx.power();
        ghosts.forEach(g => {
          if (g.mode !== 'eaten') {
            g.mode        = 'frightened';
            g.frightenedT = Math.max(4, 7 - level * 0.4);
          }
        });
        checkClear();
      }
    }
  }

  function checkClear() {
    if (dotsEaten >= totalDots) {
      state      = 'clear';
      clearTimer = 2.5;
      sfx.clear();
    }
  }

  /* ================================================================
     고스트 업데이트
  ================================================================ */
  const G_DIRS = [
    { x: 1, y: 0 }, { x: -1, y: 0 },
    { x: 0, y: 1 }, { x: 0, y: -1 },
  ];

  function ghostTarget(g) {
    if (g.mode === 'frightened') return null;
    if (g.mode === 'eaten') {
      const gs = ghostStarts[0];
      return cellToPixel(gs.r, gs.c);
    }
    if (g.name === 'Blinky') return { x: pac.x, y: pac.y };
    if (g.name === 'Pinky')  return { x: pac.x + pac.dir.x * CS * 4, y: pac.y + pac.dir.y * CS * 4 };
    if (g.name === 'Inky') {
      const b = ghosts[0];
      const ax = pac.x + pac.dir.x * CS * 2, ay = pac.y + pac.dir.y * CS * 2;
      return { x: ax + (ax - b.x), y: ay + (ay - b.y) };
    }
    // Clyde
    const d = Math.hypot(g.x - pac.x, g.y - pac.y);
    return d > CS * 8 ? { x: pac.x, y: pac.y } : { x: 0, y: H };
  }

  function chooseGhostDir(g) {
    const target  = ghostTarget(g);
    const rev     = { x: -g.dir.x, y: -g.dir.y };
    let bestDir   = null, bestVal = Infinity;

    for (const d of G_DIRS) {
      if (d.x === rev.x && d.y === rev.y) continue; // 되돌아가기 금지
      /* 앞 셀이 벽인지 체크 */
      const nx = g.x + d.x * CS, ny = g.y + d.y * CS;
      const cell = pixelToCell(nx, ny);
      if (tileAt(cell.r, cell.c) === T_WALL) continue;

      const val = (g.mode === 'frightened' || !target)
        ? Math.random()
        : Math.hypot(nx - target.x, ny - target.y);

      if (val < bestVal) { bestVal = val; bestDir = d; }
    }
    return bestDir || rev; // 막히면 되돌아가기
  }

  function updateGhost(g, dt) {
    if (g.inHouse) {
      g.exitDelay -= dt;
      if (g.exitDelay > 0) return;
      g.inHouse = false;
    }

    if (g.mode === 'frightened') {
      g.frightenedT -= dt;
      if (g.frightenedT <= 0) g.mode = 'chase';
    }

    /* 셀 중앙 근처에서 방향 결정 */
    if (nearCenter(g.x, g.y)) {
      const snapped = snapToCenter(g.x, g.y);
      g.x = snapped.x;
      g.y = snapped.y;
      g.dir = chooseGhostDir(g);
    }

    const spd = g.mode === 'frightened' ? g.speed * 0.5
              : g.mode === 'eaten'      ? g.speed * 1.8
              : g.speed;

    /* 다음 위치가 벽이면 방향 재결정 후 정지 */
    const nx = g.x + g.dir.x * spd * dt;
    const ny = g.y + g.dir.y * spd * dt;
    const nc = pixelToCell(nx, ny);
    if (tileAt(nc.r, nc.c) === T_WALL) {
      g.dir = chooseGhostDir(g);
    } else {
      g.x = nx; g.y = ny;
    }

    /* 터널 */
    const tunnelY = HUD_H + CS * 9 + CS / 2;
    if (Math.abs(g.y - tunnelY) < CS) {
      if (g.x < -CS / 2)    g.x = W + CS / 2;
      if (g.x > W + CS / 2) g.x = -CS / 2;
    }

    /* eaten → 집 복귀 */
    if (g.mode === 'eaten') {
      const gs = ghostStarts[0];
      const hp = cellToPixel(gs.r, gs.c);
      if (Math.hypot(g.x - hp.x, g.y - hp.y) < CS * 0.6) {
        g.mode = 'scatter';
      }
    }
  }

  /* ── 충돌 ── */
  function checkCollisions() {
    if (!pac.alive || deadPending) return;
    for (const g of ghosts) {
      if (Math.hypot(g.x - pac.x, g.y - pac.y) > CS * 0.75) continue;
      if (g.mode === 'frightened') {
        g.mode  = 'eaten';
        score  += 200;
        sfx.eat();
      } else if (g.mode !== 'eaten') {
        deadPending = true;
        pac.alive   = false;
        deadTimer   = 2.0;
        lives--;
        sfx.die();
        if (lives <= 0) {
          setTimeout(() => {
            state = 'gameover';
            if (score > hi) {
              hi = score;
              try { localStorage.setItem('pacman_hi', String(hi)); } catch (e) {}
            }
          }, 2100);
        } else {
          setTimeout(() => {
            deadPending = false;
            resetPac();
            resetGhosts();
            state = 'play';
          }, 2100);
        }
        state = 'dead';
        return;
      }
    }
  }

  /* ── 메인 업데이트 ── */
  function update(dt) {
    t          += dt;
    titleBlink += dt;

    if (state === 'play' || state === 'dead') {
      updatePac(dt);
      if (state === 'play') {
        ghosts.forEach(g => updateGhost(g, dt));
        checkCollisions();
      }
    }

    if (state === 'clear') {
      clearTimer -= dt;
      if (clearTimer <= 0) { nextLevel(); state = 'play'; }
    }
  }

  /* ================================================================
     그리기
  ================================================================ */
  function cellPx(r, c) {
    return { x: c * CS, y: r * CS + HUD_H };
  }

  function drawMap() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const { x, y } = cellPx(r, c);
        const tile      = map[r][c];

        if (tile === T_WALL) {
          ctx.fillStyle = '#1a1aff';
          ctx.fillRect(x + 1, y + 1, CS - 2, CS - 2);
          ctx.strokeStyle = '#4466ff';
          ctx.lineWidth   = 1;
          ctx.strokeRect(x + 2.5, y + 2.5, CS - 5, CS - 5);
        } else if (tile === T_DOT) {
          ctx.fillStyle = '#ffdbac';
          ctx.beginPath();
          ctx.arc(x + CS / 2, y + CS / 2, CS * 0.1, 0, Math.PI * 2);
          ctx.fill();
        } else if (tile === T_POWER) {
          const pulse = 0.65 + 0.35 * Math.sin(t * 6);
          ctx.globalAlpha = pulse;
          ctx.fillStyle   = '#ffdbac';
          ctx.beginPath();
          ctx.arc(x + CS / 2, y + CS / 2, CS * 0.24, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  function drawPac() {
    ctx.save();
    ctx.translate(pac.x, pac.y);

    if (!pac.alive) {
      /* 죽는 애니메이션 */
      const prog  = Math.max(0, Math.min(1, 1 - deadTimer / 2.0));
      const angle = prog * Math.PI;
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      if (angle < Math.PI - 0.05) {
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, CS * 0.44, angle, Math.PI * 2 - angle);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    ctx.rotate(pac.angle);
    const ma = pac.mouth * (Math.PI / 5);
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, CS * 0.44, ma, Math.PI * 2 - ma);
    ctx.closePath();
    ctx.fill();

    /* 눈 */
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(CS * 0.1, -CS * 0.2, CS * 0.065, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawGhost(g) {
    let color;
    if (g.mode === 'frightened') {
      const blink = g.frightenedT < 2 && ((t * 5) | 0) % 2 === 0;
      color = blink ? FRIGHTENED_BLINK : FRIGHTENED_CLR;
    } else if (g.mode === 'eaten') {
      color = null;
    } else {
      color = g.color;
    }

    ctx.save();
    ctx.translate(g.x, g.y);

    if (g.mode === 'eaten') {
      /* 눈만 */
      ctx.fillStyle = '#fff';
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx * CS * 0.16, -CS * 0.08, CS * 0.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2121DE';
        ctx.beginPath();
        ctx.arc(sx * CS * 0.16 + g.dir.x * CS * 0.05,
                -CS * 0.08 + g.dir.y * CS * 0.05,
                CS * 0.055, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
      }
      ctx.restore();
      return;
    }

    const r = CS * 0.44;
    /* 몸통 */
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, 0);
    const sw = r * 2 / 3;
    ctx.lineTo(r, r * 0.5);
    for (let i = 2; i >= 0; i--) {
      const bx  = -r + sw * i + sw / 2;
      const sgn = i % 2 === 0 ? 1 : -1;
      ctx.quadraticCurveTo(bx + sw / 2 * sgn * 0.7, r, bx + sw, r * 0.5);
    }
    ctx.closePath();
    ctx.fill();

    /* 눈 */
    if (g.mode !== 'frightened') {
      ctx.fillStyle = '#fff';
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx * CS * 0.16, -CS * 0.1, CS * 0.11, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#2121DE';
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx * CS * 0.16 + g.dir.x * CS * 0.06,
                -CS * 0.1 + g.dir.y * CS * 0.06,
                CS * 0.06, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      /* frightened 눈 */
      const ec = color === FRIGHTENED_BLINK ? '#2121DE' : '#fff';
      ctx.fillStyle = ec;
      for (const sx of [-CS * 0.16, CS * 0.16]) {
        ctx.beginPath();
        ctx.arc(sx, -CS * 0.1, CS * 0.07, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  function drawHUD() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, HUD_H);

    ctx.font = 'bold 13px ' + FONT;
    ctx.textBaseline = 'top';

    ctx.textAlign = 'left';
    ctx.fillStyle = '#ff4d6d';
    ctx.fillText('1UP', 14, 6);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px ' + FONT;
    ctx.fillText(String(score).padStart(7, '0'), 14, 24);

    ctx.font = 'bold 13px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff4d6d';
    ctx.fillText('HI-SCORE', W / 2, 6);
    ctx.fillStyle = '#FFD700';
    ctx.font = 'bold 18px ' + FONT;
    ctx.fillText(String(hi).padStart(7, '0'), W / 2, 24);

    ctx.font = 'bold 13px ' + FONT;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#4cc9f0';
    ctx.fillText('LEVEL', W - 14, 6);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 18px ' + FONT;
    ctx.fillText(String(level), W - 14, 24);

    /* 잔여 목숨 */
    const reserve = Math.max(0, lives - 1);
    for (let i = 0; i < Math.min(reserve, 5); i++) {
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.moveTo(18 + i * 28, 60);
      ctx.arc(18 + i * 28, 60, 10, 0.3, Math.PI * 2 - 0.3);
      ctx.closePath();
      ctx.fill();
    }

    if (muted) {
      ctx.fillStyle = '#888';
      ctx.font = '12px ' + FONT;
      ctx.textAlign = 'right';
      ctx.fillText('MUTE', W - 14, 58);
    }
  }

  function txt(str, x, y, size, color, align, font) {
    ctx.font          = 'bold ' + size + 'px ' + (font || FONT);
    ctx.textAlign     = align || 'left';
    ctx.textBaseline  = 'middle';
    ctx.fillStyle     = color || '#fff';
    ctx.fillText(str, x, y);
  }

  function overlay(alpha) {
    ctx.fillStyle = 'rgba(0,0,10,' + alpha + ')';
    ctx.fillRect(0, 0, W, H);
  }

  function drawTitle() {
    overlay(0.68);
    const pulse = 1 + Math.sin(t * 2.5) * 0.04;
    ctx.save();
    ctx.translate(W / 2, 180);
    ctx.scale(pulse, pulse);
    txt('PAC', 0, -22, 60, '#FFD700', 'center');
    txt('MAN', 0,  40, 60, '#FFD700', 'center');
    ctx.restore();

    ctx.save();
    ctx.translate(W / 2, 300);
    const m  = 0.5 + 0.5 * Math.abs(Math.sin(t * 3));
    const ma = m * (Math.PI / 4);
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 28, ma, Math.PI * 2 - ma);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    txt('← → ↑ ↓ / WASD   이동',     W / 2, 360, 14, '#cfd8ff', 'center', KFONT);
    txt('모바일: 스와이프로 방향 전환', W / 2, 384, 12, '#8fa0d8', 'center', KFONT);
    txt('P   일시정지   M   음소거',    W / 2, 408, 14, '#cfd8ff', 'center', KFONT);
    txt('●  = 10pt   ⬤  = 50pt   👻 먹기 = 200pt', W / 2, 450, 13, '#ffdbac', 'center');

    if (((titleBlink * 2) | 0) % 2 === 0)
      txt('PRESS ENTER OR SPACE', W / 2, 510, 20, '#FFD700', 'center');
    txt('터치해도 시작합니다', W / 2, 542, 13, '#8fa0d8', 'center', KFONT);
  }

  function drawGameOver() {
    overlay(0.68);
    txt('GAME',           W / 2, H / 2 - 46, 54, '#ff4d6d', 'center');
    txt('OVER',           W / 2, H / 2 + 16, 54, '#ff4d6d', 'center');
    txt('SCORE  ' + score,  W / 2, H / 2 + 90,  22, '#fff',    'center');
    txt('HI-SCORE  ' + hi,  W / 2, H / 2 + 122, 22, '#FFD700', 'center');
    if (((titleBlink * 2) | 0) % 2 === 0)
      txt('PRESS ENTER TO RETRY', W / 2, H / 2 + 172, 18, '#FFD700', 'center');
  }

  function drawClear() {
    overlay(0.48);
    const pulse = 1 + Math.sin(t * 6) * 0.05;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(pulse, pulse);
    txt('STAGE',  0, -30, 46, '#7CFC00', 'center');
    txt('CLEAR!', 0,  28, 46, '#7CFC00', 'center');
    ctx.restore();
  }

  function draw() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    drawMap();
    ghosts.forEach(drawGhost);
    drawPac();
    drawHUD();

    if (state === 'title')    drawTitle();
    if (state === 'gameover') drawGameOver();
    if (state === 'clear')    drawClear();
    if (state === 'pause') {
      overlay(0.55);
      txt('PAUSE', W / 2, H / 2 - 12, 48, '#fff', 'center');
      txt('P 또는 터치로 계속하기', W / 2, H / 2 + 40, 15, '#cfd8ff', 'center', KFONT);
    }
  }

  /* ── 메인 루프 ── */
  buildMap();
  resetPac();
  resetGhosts();

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state !== 'pause') update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
