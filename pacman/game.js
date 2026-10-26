(() => {
  'use strict';

  /* ───────────────────────────────────────────
     캔버스 초기화
  ─────────────────────────────────────────── */
  const cv  = document.getElementById('game');
  const ctx = cv.getContext('2d');
  const W = 560, H = 560;
  cv.width  = W;
  cv.height = H;

  const FONT  = '"Courier New", monospace';
  const KFONT = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';

  /* ───────────────────────────────────────────
     맵 정의 (19×19)
     # = 벽   . = 도트   o = 파워펠릿
     P = 팩맨 시작   G = 고스트 시작   = = 고스트 집 문
  ─────────────────────────────────────────── */
  const MAP_SRC = [
    '###################',
    '#........#........#',
    '#o##.###.#.###.##o#',
    '#.................#',
    '#.##.#.#####.#.##.#',
    '#....#...#...#....#',
    '####.### # ###.####',
    '####.#       #.####',
    '####.# ##=## #.####',
    '     .  #G#  .     ',
    '####.# ##### #.####',
    '####.#       #.####',
    '####.# ##### #.####',
    '#........#........#',
    '#.##.###.#.###.##.#',
    '#o.#.....P.....#.o#',
    '##.#.#.#####.#.#.##',
    '#....#...#...#....#',
    '###################',
  ];

  const ROWS = MAP_SRC.length;       // 19
  const COLS = MAP_SRC[0].length;    // 19
  const CS   = W / COLS;             // 셀 크기 ≈ 29.47

  /* 타일 상수 */
  const T_WALL  = 0;
  const T_DOT   = 1;
  const T_POWER = 2;
  const T_EMPTY = 3;

  let map        = [];
  let totalDots  = 0;
  let pacStart   = { r: 15, c: 9 };
  let ghostStarts = [];

  /* ───────────────────────────────────────────
     맵 빌드
  ─────────────────────────────────────────── */
  function buildMap() {
    map = [];
    totalDots   = 0;
    ghostStarts = [];

    for (let r = 0; r < ROWS; r++) {
      map[r] = [];
      for (let c = 0; c < COLS; c++) {
        const ch = MAP_SRC[r][c];
        if      (ch === '#') { map[r][c] = T_WALL; }
        else if (ch === '.') { map[r][c] = T_DOT;   totalDots++; }
        else if (ch === 'o') { map[r][c] = T_POWER; totalDots++; }
        else if (ch === 'P') { map[r][c] = T_DOT;   totalDots++; pacStart = { r, c }; }
        else if (ch === 'G') { map[r][c] = T_EMPTY; ghostStarts.push({ r, c }); }
        else if (ch === '=') { map[r][c] = T_EMPTY; } // 고스트 집 문
        else                  { map[r][c] = T_EMPTY; }
      }
    }
  }

  /* ───────────────────────────────────────────
     게임 상태
  ─────────────────────────────────────────── */
  let state      = 'title'; // title | play | pause | dead | gameover | clear
  let score      = 0;
  let hi         = 0;
  let lives      = 3;
  let dotsEaten  = 0;
  let level      = 1;
  let t          = 0;
  let deadTimer  = 0;
  let clearTimer = 0;
  let titleBlink = 0;

  try { hi = +localStorage.getItem('pacman_hi') || 0; } catch (e) { hi = 0; }

  /* ───────────────────────────────────────────
     팩맨
  ─────────────────────────────────────────── */
  let pac = {};

  function resetPac() {
    pac = {
      r:        pacStart.r + 0.5,
      c:        pacStart.c + 0.5,
      dir:      { r: 0, c: 0 },
      next:     { r: 0, c: -1 },
      speed:    7.5,   // 셀/초
      mouth:    0,     // 0~1
      mouthDir: 1,
      angle:    0,     // 표시 방향 (라디안)
      alive:    true,
    };
  }

  /* ───────────────────────────────────────────
     고스트
  ─────────────────────────────────────────── */
  const GHOST_COLORS     = ['#FF0000', '#FFB8FF', '#00FFFF', '#FFB852'];
  const GHOST_NAMES      = ['Blinky', 'Pinky', 'Inky', 'Clyde'];
  const FRIGHTENED_CLR   = '#2121DE';
  const FRIGHTENED_BLINK = '#FFFFFF';

  let ghosts = [];

  function resetGhosts() {
    ghosts = GHOST_NAMES.map((name, i) => ({
      name,
      r:           (ghostStarts[i] || ghostStarts[0]).r + 0.5,
      c:           (ghostStarts[i] || ghostStarts[0]).c + 0.5,
      dir:         { r: 0, c: i % 2 === 0 ? 1 : -1 },
      speed:       7.0,
      mode:        'scatter', // scatter | chase | frightened | eaten
      frightenedT: 0,
      scatterT:    0,
      exitDelay:   i * 1.8,
      inHouse:     true,
      color:       GHOST_COLORS[i],
    }));
  }

  /* ───────────────────────────────────────────
     오디오
  ─────────────────────────────────────────── */
  let AC     = null;
  let muted  = false;

  function initAudio() {
    if (AC) return;
    try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { AC = null; }
  }

  function beep(freq, dur, type, vol, endFreq) {
    if (muted || !AC) return;
    try {
      const o   = AC.createOscillator();
      const g   = AC.createGain();
      const now = AC.currentTime;
      o.type = type || 'square';
      o.frequency.setValueAtTime(freq, now);
      if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, now + dur);
      g.gain.setValueAtTime(vol || 0.04, now);
      g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
      o.connect(g);
      g.connect(AC.destination);
      o.start(now);
      o.stop(now + dur);
    } catch (e) { /* ignore */ }
  }

  const sfx = {
    dot:   () => beep(440, 0.05, 'square', 0.02),
    power: () => beep(200, 0.15, 'sawtooth', 0.06, 400),
    eat:   () => beep(300, 0.2,  'sawtooth', 0.05, 80),
    die:   () => {
      [440, 415, 392, 370, 349, 330, 311, 294, 277, 262, 247, 233, 220]
        .forEach((f, i) => setTimeout(() => beep(f, 0.09, 'square', 0.05), i * 80));
    },
    start: () => {
      [440, 494, 523, 587, 659, 698, 784]
        .forEach((f, i) => setTimeout(() => beep(f, 0.1, 'square', 0.04), i * 90));
    },
    clear: () => {
      [523, 659, 784, 1047]
        .forEach((f, i) => setTimeout(() => beep(f, 0.15, 'square', 0.05), i * 120));
    },
  };

  /* ───────────────────────────────────────────
     입력
  ─────────────────────────────────────────── */
  const keys = {};
  let swipeStart = null;

  function tryStart() {
    if (state === 'title' || state === 'gameover' || state === 'clear') startGame();
  }

  addEventListener('keydown', e => {
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    keys[e.code] = true;
    initAudio();
    if (e.repeat) return;
    if (e.code === 'Enter' || e.code === 'Space') tryStart();
    if (e.code === 'KeyP' || e.code === 'Escape') {
      if      (state === 'play')  state = 'pause';
      else if (state === 'pause') state = 'play';
    }
    if (e.code === 'KeyM') muted = !muted;
  });

  addEventListener('keyup', e => { keys[e.code] = false; });

  addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    if (state === 'play') state = 'pause';
  });

  /* 스와이프 (모바일) */
  cv.addEventListener('pointerdown', e => {
    initAudio();
    swipeStart = { x: e.clientX, y: e.clientY };
    tryStart();
    if (state === 'pause') state = 'play';
  });

  cv.addEventListener('pointerup', e => {
    if (!swipeStart) return;
    const dx = e.clientX - swipeStart.x;
    const dy = e.clientY - swipeStart.y;
    const adx = Math.abs(dx), ady = Math.abs(dy);
    if (Math.max(adx, ady) < 15) { swipeStart = null; return; }
    if (adx > ady) {
      pac.next = dx > 0 ? { r: 0, c:  1 } : { r: 0, c: -1 };
    } else {
      pac.next = dy > 0 ? { r:  1, c: 0 } : { r: -1, c: 0 };
    }
    swipeStart = null;
  });

  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.focus();

  /* ───────────────────────────────────────────
     게임 흐름
  ─────────────────────────────────────────── */
  function startGame() {
    score = 0; lives = 3; dotsEaten = 0; level = 1;
    buildMap();
    resetPac();
    resetGhosts();
    state = 'play';
    sfx.start();
  }

  function nextLevel() {
    level++;
    dotsEaten = 0;
    buildMap();
    resetPac();
    resetGhosts();
    pac.speed = Math.min(10.5, 7.5 + level * 0.25);
    ghosts.forEach(g => { g.speed = Math.min(9.5, 7.0 + level * 0.2); });
  }

  /* ───────────────────────────────────────────
     유틸리티
  ─────────────────────────────────────────── */
  function centerDist(e) {
    return {
      dr: e.r - (Math.floor(e.r) + 0.5),
      dc: e.c - (Math.floor(e.c) + 0.5),
    };
  }

  function canMove(r, c, dir) {
    const nr = r + dir.r * 0.5;
    const nc = c + dir.c * 0.5;
    const ri = Math.round(nr), ci = Math.round(nc);
    if (ri < 0 || ri >= ROWS || ci < 0 || ci >= COLS) return false;
    return map[ri][ci] !== T_WALL;
  }

  function reverseDir(d) { return { r: -d.r, c: -d.c }; }

  function mdist(r1, c1, r2, c2) { return Math.abs(r1 - r2) + Math.abs(c1 - c2); }

  /* ───────────────────────────────────────────
     고스트 AI
  ─────────────────────────────────────────── */
  const DIRS = [
    { r: -1, c:  0 },
    { r:  1, c:  0 },
    { r:  0, c: -1 },
    { r:  0, c:  1 },
  ];

  function ghostTarget(g) {
    if (g.mode === 'frightened') return null;
    if (g.mode === 'eaten')      return { r: ghostStarts[0].r, c: ghostStarts[0].c };

    const pr = pac.r, pc = pac.c, pd = pac.dir;
    if (g.name === 'Blinky') return { r: pr, c: pc };
    if (g.name === 'Pinky')  return { r: pr + pd.r * 4, c: pc + pd.c * 4 };
    if (g.name === 'Inky') {
      const ref   = { r: ghosts[0].r, c: ghosts[0].c };
      const ahead = { r: pr + pd.r * 2, c: pc + pd.c * 2 };
      return { r: ahead.r + (ahead.r - ref.r), c: ahead.c + (ahead.c - ref.c) };
    }
    // Clyde: 8셀 이상 멀면 추격, 가까우면 산개
    return mdist(g.r, g.c, pr, pc) > 8
      ? { r: pr, c: pc }
      : { r: ROWS - 1, c: 0 };
  }

  function chooseGhostDir(g) {
    const target   = ghostTarget(g);
    const rev      = reverseDir(g.dir);
    let bestDir    = null;
    let bestScore  = Infinity;

    for (const d of DIRS) {
      if (d.r === rev.r && d.c === rev.c) continue; // 되돌아가기 금지

      const nr = g.r + d.r * 0.5, nc = g.c + d.c * 0.5;
      const ri = Math.round(nr), ci = Math.round(nc);
      if (ri < 0 || ri >= ROWS || ci < 0 || ci >= COLS) continue;
      if (map[ri][ci] === T_WALL) continue;

      const sc = g.mode === 'frightened' || !target
        ? Math.random()
        : mdist(g.r + d.r, g.c + d.c, target.r, target.c);

      if (sc < bestScore) { bestScore = sc; bestDir = d; }
    }
    return bestDir || g.dir;
  }

  /* ───────────────────────────────────────────
     업데이트
  ─────────────────────────────────────────── */
  function updatePac(dt) {
    if (!pac.alive) return;

    // 방향 입력
    if      (keys.ArrowLeft  || keys.KeyA) pac.next = { r:  0, c: -1 };
    else if (keys.ArrowRight || keys.KeyD) pac.next = { r:  0, c:  1 };
    else if (keys.ArrowUp    || keys.KeyW) pac.next = { r: -1, c:  0 };
    else if (keys.ArrowDown  || keys.KeyS) pac.next = { r:  1, c:  0 };

    // 셀 중앙 근처에서 방향 전환 시도
    const { dr, dc } = centerDist(pac);
    const onCenter   = Math.abs(dr) < 0.18 && Math.abs(dc) < 0.18;

    if (onCenter && (pac.next.r !== pac.dir.r || pac.next.c !== pac.dir.c)) {
      if (canMove(pac.r, pac.c, pac.next)) {
        pac.dir = { ...pac.next };
        pac.r   = Math.floor(pac.r) + 0.5;
        pac.c   = Math.floor(pac.c) + 0.5;
      }
    }

    // 이동
    if (canMove(pac.r, pac.c, pac.dir)) {
      pac.r += pac.dir.r * pac.speed * dt;
      pac.c += pac.dir.c * pac.speed * dt;
    }

    // 터널 (좌우 루프)
    if (pac.c < 0)      pac.c = COLS - 0.5;
    if (pac.c >= COLS)  pac.c = 0.5;

    // 방향에 따른 입 각도
    if      (pac.dir.c > 0)  pac.angle =  0;
    else if (pac.dir.c < 0)  pac.angle =  Math.PI;
    else if (pac.dir.r < 0)  pac.angle = -Math.PI / 2;
    else if (pac.dir.r > 0)  pac.angle =  Math.PI / 2;

    // 입 애니메이션
    pac.mouth += pac.mouthDir * 4 * dt;
    if (pac.mouth >= 1) { pac.mouth = 1; pac.mouthDir = -1; }
    if (pac.mouth <= 0) { pac.mouth = 0; pac.mouthDir =  1; }

    // 도트 먹기
    const cr = Math.floor(pac.r), cc = Math.floor(pac.c);
    if (cr >= 0 && cr < ROWS && cc >= 0 && cc < COLS) {
      if (map[cr][cc] === T_DOT) {
        map[cr][cc] = T_EMPTY;
        score += 10; dotsEaten++;
        sfx.dot();
        checkClear();
      } else if (map[cr][cc] === T_POWER) {
        map[cr][cc] = T_EMPTY;
        score += 50; dotsEaten++;
        sfx.power();
        ghosts.forEach(g => {
          if (g.mode !== 'eaten') {
            g.mode        = 'frightened';
            g.frightenedT = 6 + Math.max(0, 3 - level * 0.4);
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

  function updateGhost(g, dt) {
    // 집에서 나오기
    if (g.inHouse) {
      g.exitDelay -= dt;
      if (g.exitDelay > 0) return;
      g.inHouse = false;
    }

    // frightened 타이머
    if (g.mode === 'frightened') {
      g.frightenedT -= dt;
      if (g.frightenedT <= 0) g.mode = 'chase';
    }

    // 셀 중앙 통과 시 방향 결정
    const { dr, dc } = centerDist(g);
    if (Math.abs(dr) < 0.2 && Math.abs(dc) < 0.2) {
      g.dir = chooseGhostDir(g);
      g.r   = Math.floor(g.r) + 0.5;
      g.c   = Math.floor(g.c) + 0.5;
    }

    // 이동 속도 결정
    const spd = g.mode === 'frightened' ? g.speed * 0.55
              : g.mode === 'eaten'      ? g.speed * 1.6
              : g.speed;

    const nr  = g.r + g.dir.r * spd * dt;
    const nc  = g.c + g.dir.c * spd * dt;
    const nri = Math.round(nr), nci = Math.round(nc);

    if (nri >= 0 && nri < ROWS && nci >= 0 && nci < COLS && map[nri][nci] !== T_WALL) {
      g.r = nr; g.c = nc;
    } else {
      g.dir = chooseGhostDir(g);
    }

    // 터널
    if (g.c < 0)      g.c = COLS - 0.5;
    if (g.c >= COLS)  g.c = 0.5;

    // 먹힌 고스트 집 복귀
    if (g.mode === 'eaten' && mdist(g.r, g.c, ghostStarts[0].r, ghostStarts[0].c) < 0.6) {
      g.mode    = 'scatter';
      g.inHouse = false;
    }
  }

  function checkCollisions() {
    for (const g of ghosts) {
      if (Math.abs(g.r - pac.r) >= 0.8 || Math.abs(g.c - pac.c) >= 0.8) continue;

      if (g.mode === 'frightened') {
        g.mode  = 'eaten';
        score  += 200;
        sfx.eat();
      } else if (g.mode !== 'eaten') {
        pac.alive  = false;
        lives--;
        deadTimer  = 2.0;
        sfx.die();

        if (lives <= 0) {
          setTimeout(() => {
            state = 'gameover';
            if (score > hi) {
              hi = score;
              try { localStorage.setItem('pacman_hi', String(hi)); } catch (e) { /* ignore */ }
            }
          }, 2100);
        } else {
          setTimeout(() => { resetPac(); resetGhosts(); state = 'play'; }, 2100);
        }
        state = 'dead';
        return;
      }
    }
  }

  function update(dt) {
    t          += dt;
    titleBlink += dt;

    if (state === 'play') {
      updatePac(dt);
      ghosts.forEach(g => updateGhost(g, dt));
      checkCollisions();
    }

    if (state === 'clear') {
      clearTimer -= dt;
      if (clearTimer <= 0) { nextLevel(); state = 'play'; }
    }
  }

  /* ───────────────────────────────────────────
     그리기 – 좌표 헬퍼
  ─────────────────────────────────────────── */
  function cellX(c) { return c * CS; }
  function cellY(r) { return r * CS + 80; } // HUD = 80 px

  /* ── 맵 ── */
  function drawMap() {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x    = cellX(c), y = cellY(r);
        const tile = map[r][c];

        if (tile === T_WALL) {
          ctx.fillStyle = '#1a1aff';
          ctx.fillRect(x + 1, y + 1, CS - 2, CS - 2);
          ctx.strokeStyle = '#4444ff';
          ctx.lineWidth   = 1.5;
          ctx.strokeRect(x + 2.5, y + 2.5, CS - 5, CS - 5);

        } else if (tile === T_DOT) {
          ctx.fillStyle = '#ffdbac';
          ctx.beginPath();
          ctx.arc(x + CS / 2, y + CS / 2, CS * 0.1, 0, Math.PI * 2);
          ctx.fill();

        } else if (tile === T_POWER) {
          const pulse = 0.7 + 0.3 * Math.sin(t * 5);
          ctx.globalAlpha = pulse;
          ctx.fillStyle   = '#ffdbac';
          ctx.beginPath();
          ctx.arc(x + CS / 2, y + CS / 2, CS * 0.22, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }
  }

  /* ── 팩맨 ── */
  function drawPac() {
    const px = cellX(pac.c - 0.5) + CS / 2;
    const py = cellY(pac.r - 0.5) + CS / 2;

    ctx.save();
    ctx.translate(px, py);

    if (!pac.alive) {
      // 죽는 애니메이션: 부채꼴이 점점 좁아짐
      const prog      = Math.max(0, 1 - deadTimer / 2.0);
      const openAngle = prog * Math.PI;
      ctx.fillStyle   = '#FFD700';
      ctx.beginPath();
      if (openAngle < Math.PI - 0.05) {
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, CS * 0.44, openAngle, Math.PI * 2 - openAngle);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    ctx.rotate(pac.angle);
    const mouthAngle = pac.mouth * (Math.PI / 4.5);
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, CS * 0.44, mouthAngle, Math.PI * 2 - mouthAngle);
    ctx.closePath();
    ctx.fill();

    // 눈
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(CS * 0.12, -CS * 0.22, CS * 0.06, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /* ── 고스트 ── */
  function drawGhost(g) {
    const x = cellX(g.c - 0.5) + CS / 2;
    const y = cellY(g.r - 0.5) + CS / 2;
    const r = CS * 0.44;

    let color;
    if (g.mode === 'frightened') {
      const blink = g.frightenedT < 2 && ((t * 4) | 0) % 2 === 0;
      color = blink ? FRIGHTENED_BLINK : FRIGHTENED_CLR;
    } else if (g.mode === 'eaten') {
      color = 'rgba(0,0,0,0)';
    } else {
      color = g.color;
    }

    ctx.save();
    ctx.translate(x, y);

    if (g.mode === 'eaten') {
      // 눈만 그리기
      ctx.fillStyle = '#fff';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(side * CS * 0.15, -CS * 0.08, CS * 0.09, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#2121DE';
        ctx.beginPath();
        ctx.arc(
          side * CS * 0.15 + CS * 0.04 * (g.dir.c || 0.5),
          -CS * 0.08 + CS * 0.04 * (g.dir.r || 0),
          CS * 0.05, 0, Math.PI * 2
        );
        ctx.fill();
        ctx.fillStyle = '#fff';
      }
      ctx.restore();
      return;
    }

    // 몸통 (위 반원 + 아래 물결)
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, r, Math.PI, 0);
    const segW = (r * 2) / 3;
    ctx.lineTo(r, r * 0.55);
    for (let i = 2; i >= 0; i--) {
      const bx  = -r + segW * i + segW / 2;
      const dir = i % 2 === 0 ? 1 : -1;
      ctx.quadraticCurveTo(bx + segW / 2 * dir * 0.6, r * 1.0, bx + segW, r * 0.55);
    }
    ctx.closePath();
    ctx.fill();

    // 눈
    if (g.mode !== 'frightened') {
      const ex = g.dir.c * CS * 0.06;
      const ey = g.dir.r * CS * 0.06;
      ctx.fillStyle = '#fff';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(side * CS * 0.16, -CS * 0.1, CS * 0.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = '#2121DE';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(side * CS * 0.16 + ex, -CS * 0.1 + ey, CS * 0.055, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // frightened 표정 (흰 눈 두 개)
      ctx.fillStyle = color === FRIGHTENED_BLINK ? '#2121DE' : '#fff';
      for (const ox of [-CS * 0.16, CS * 0.16]) {
        ctx.beginPath();
        ctx.arc(ox, -CS * 0.1, CS * 0.07, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }

  /* ── HUD ── */
  function drawHUD() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, 76);

    // 1UP / 점수
    ctx.font          = 'bold 13px ' + FONT;
    ctx.textAlign     = 'left';
    ctx.textBaseline  = 'top';
    ctx.fillStyle     = '#ff4d6d';
    ctx.fillText('1UP', 14, 6);
    ctx.fillStyle = '#fff';
    ctx.font      = 'bold 18px ' + FONT;
    ctx.fillText(String(score).padStart(6, '0'), 14, 24);

    // 하이스코어
    ctx.font      = 'bold 13px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ff4d6d';
    ctx.fillText('HI-SCORE', W / 2, 6);
    ctx.fillStyle = '#FFD700';
    ctx.font      = 'bold 18px ' + FONT;
    ctx.fillText(String(hi).padStart(6, '0'), W / 2, 24);

    // 레벨
    ctx.textAlign = 'right';
    ctx.fillStyle = '#4cc9f0';
    ctx.font      = 'bold 13px ' + FONT;
    ctx.fillText('LEVEL', W - 14, 6);
    ctx.fillStyle = '#fff';
    ctx.font      = 'bold 18px ' + FONT;
    ctx.fillText(String(level), W - 14, 24);

    // 잔여 목숨 아이콘
    const reserve = Math.max(0, lives - 1);
    for (let i = 0; i < Math.min(reserve, 5); i++) {
      ctx.fillStyle = '#FFD700';
      ctx.beginPath();
      ctx.moveTo(16 + i * 26, 56);
      ctx.arc(16 + i * 26, 56, 10, 0.3, Math.PI * 2 - 0.3);
      ctx.closePath();
      ctx.fill();
    }

    if (muted) {
      ctx.fillStyle = '#888';
      ctx.font      = '12px ' + FONT;
      ctx.textAlign = 'right';
      ctx.fillText('MUTE', W - 14, 54);
    }
  }

  /* ── 텍스트 헬퍼 ── */
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

  /* ── 타이틀 화면 ── */
  function drawTitle() {
    overlay(0.65);
    const pulse = 1 + Math.sin(t * 2.5) * 0.04;
    ctx.save();
    ctx.translate(W / 2, 160);
    ctx.scale(pulse, pulse);
    txt('PAC', 0, -20, 58, '#FFD700', 'center');
    txt('MAN', 0,  38, 58, '#FFD700', 'center');
    ctx.restore();

    // 팩맨 아이콘 애니메이션
    ctx.save();
    ctx.translate(W / 2, 270);
    const m  = 0.5 + 0.5 * Math.abs(Math.sin(t * 3));
    const ma = m * (Math.PI / 4);
    ctx.fillStyle = '#FFD700';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 26, ma, Math.PI * 2 - ma);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    txt('← → ↑ ↓ / WASD   이동',      W / 2, 330, 14, '#cfd8ff', 'center', KFONT);
    txt('모바일: 스와이프로 방향 전환',  W / 2, 354, 12, '#8fa0d8', 'center', KFONT);
    txt('P   일시정지   M   음소거',     W / 2, 378, 14, '#cfd8ff', 'center', KFONT);
    txt('●  = 10pt',    W / 2 - 60, 420, 14, '#ffdbac', 'center');
    txt('⬤  = 50pt',   W / 2 + 60, 420, 14, '#ffdbac', 'center');

    if (((titleBlink * 2) | 0) % 2 === 0) {
      txt('PRESS ENTER OR SPACE', W / 2, 480, 20, '#FFD700', 'center');
    }
    txt('터치해도 시작합니다', W / 2, 510, 13, '#8fa0d8', 'center', KFONT);
  }

  /* ── 게임 오버 ── */
  function drawGameOver() {
    overlay(0.65);
    txt('GAME',              W / 2, H / 2 - 40,  52, '#ff4d6d', 'center');
    txt('OVER',              W / 2, H / 2 + 18,  52, '#ff4d6d', 'center');
    txt('SCORE  ' + score,   W / 2, H / 2 + 88,  22, '#fff',    'center');
    txt('HI-SCORE  ' + hi,   W / 2, H / 2 + 120, 22, '#FFD700', 'center');
    if (((titleBlink * 2) | 0) % 2 === 0) {
      txt('PRESS ENTER TO RETRY', W / 2, H / 2 + 168, 18, '#FFD700', 'center');
    }
  }

  /* ── 스테이지 클리어 ── */
  function drawClear() {
    overlay(0.45);
    const pulse = 1 + Math.sin(t * 6) * 0.04;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(pulse, pulse);
    txt('STAGE',  0, -28, 44, '#7CFC00', 'center');
    txt('CLEAR!', 0,  26, 44, '#7CFC00', 'center');
    ctx.restore();
  }

  /* ── 메인 드로우 ── */
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
      txt('PAUSE', W / 2, H / 2 - 10, 46, '#fff', 'center');
      txt('P 또는 터치로 계속하기', W / 2, H / 2 + 38, 15, '#cfd8ff', 'center', KFONT);
    }
  }

  /* ───────────────────────────────────────────
     메인 루프
  ─────────────────────────────────────────── */
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
