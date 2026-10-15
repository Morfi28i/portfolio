(() => {
  const root = document.documentElement;
  root.classList.add('js');
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
  };

  // Split Arabic into separate letters that still look joined: a zero-width joiner on
  // each side keeps every letter in its connected form. Returned in visual (left→right) order.
  const NO_NEXT = new Set([...'اأإآٱدذرزوؤةء']);   // letters that never join the following one
  const isAr = (ch) => /[\u0620-\u064A\u066E-\u06D3]/.test(ch);
  function arabicLetters(word) {
    const ch = [...word];
    const out = ch.map((c, i) => {
      if (!isAr(c)) return c;
      const prev = ch[i - 1], next = ch[i + 1];
      const joinPrev = prev && isAr(prev) && !NO_NEXT.has(prev);
      const joinNext = next && isAr(next) && !NO_NEXT.has(c) && c !== 'ء';
      return `${joinPrev ? '\u200d' : ''}${c}${joinNext ? '\u200d' : ''}`;
    });
    return out.reverse();
  }

  /* ---------- Page size, measured when it changes (never during scroll) ---------- */
  const page = { h: 1, max: 1, vh: innerHeight };
  const measurePage = () => {
    page.h = document.documentElement.scrollHeight;
    page.vh = innerHeight;
    page.max = Math.max(1, page.h - page.vh);
    document.dispatchEvent(new Event('pagesize'));
  };
  measurePage();
  addEventListener('resize', measurePage);
  addEventListener('load', measurePage);
  new ResizeObserver(() => measurePage()).observe(document.body);

  /* ---------- Language ---------- */
  let lang = 'en';
  const t = (key) => translations[lang]?.[key] ?? translations.en[key] ?? '';

  function setLanguage(next) {
    if (!translations[next]) next = 'en';
    lang = next;
    root.lang = next;
    root.dir = next === 'ar' ? 'rtl' : 'ltr';
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const value = t(el.dataset.i18n);
      if (value) el.textContent = value;
    });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => {
      const value = t(el.dataset.i18nPh);
      if (value) el.placeholder = value;
    });
    document.querySelectorAll('.lang button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.lang === next));
    });
    splitWordmark();
    document.dispatchEvent(new Event('langchange'));
  }

  // Wrap each letter of the hero wordmark so it can animate in.
  // Arabic letters join, so Arabic keeps the word whole.
  function splitWordmark() {
    const wm = document.getElementById('wordmark');
    const text = wm.textContent;
    wm.setAttribute('aria-label', text);
    // Arabic stays one connected word here; it only breaks into letters while flying
    const parts = lang === 'ar' ? [text] : [...text];
    // Letters cut in from the centre outward
    const mid = (parts.length - 1) / 2;
    wm.innerHTML = parts.map((ch, i) => `<span class="ch" aria-hidden="true" style="--i:${Math.abs(i - mid)}">${ch}</span>`).join('');
    if (wm.dataset.ready) wm.classList.add('settled');
    wm.dataset.ready = '1';
  }

  document.querySelectorAll('.lang button').forEach((b) => {
    b.addEventListener('click', () => {
      if (b.dataset.lang === lang) return;
      store.set('morfi-lang', b.dataset.lang);
      // reload in the new language, coming back to the same spot
      try { sessionStorage.setItem('morfi-relang', String(Math.round(scrollY))); } catch {}
      location.reload();
    });
  });
  // First visit: follow the browser's language
  const browserLang = () => {
    for (const l of navigator.languages || [navigator.language || 'en']) {
      const code = l.slice(0, 2).toLowerCase();
      if (translations[code]) return code;
    }
    return 'en';
  };
  setLanguage(store.get('morfi-lang') || browserLang());

  /* ---------- Back to the same spot after a language reload ---------- */
  try {
    const y = sessionStorage.getItem('morfi-relang');
    if (y !== null) {
      sessionStorage.removeItem('morfi-relang');
      history.scrollRestoration = 'manual';
      const go = () => { root.style.scrollBehavior = 'auto'; scrollTo(0, +y); root.style.scrollBehavior = ''; };
      go();
      addEventListener('load', go, { once: true });
    }
  } catch {}

  /* ---------- Intro ---------- */
  const intro = document.getElementById('intro');
  if (root.classList.contains('intro-on')) {
    // The intro opens on the hero, so don't restore an old scroll position under it
    if (!location.hash) { history.scrollRestoration = 'manual'; scrollTo(0, 0); }
    const itc = document.getElementById('introTc');
    const t0 = performance.now();
    const roll = (now) => {
      const f = Math.min(Math.floor(((now - t0) / 800) * 25), 24);
      itc.textContent = `00:00:00:${String(f).padStart(2, '0')}`;
      if (f < 24) requestAnimationFrame(roll);
    };
    requestAnimationFrame(roll);
    setTimeout(() => intro.remove(), 1500);
  } else {
    intro.remove();
  }

  /* ---------- Side ruler ---------- */
  // A 0–100% scale of the page. Normally it's spread out and scrolls past a moving
  // playhead; hovering zooms out to the whole page like a minimap, with the visible
  // part highlighted and section names beside it. Click anywhere to jump there.
  const ruler = document.querySelector('.ruler');
  const rulerTrack = document.getElementById('rulerTrack');
  const rulerHead = document.querySelector('.ruler-head');
  const rulerView = document.querySelector('.ruler-view');
  const rulerHover = document.getElementById('rulerHover');
  const rulerMap = document.querySelector('.ruler-map');
  const odo = document.getElementById('odo');
  const STEP = 40;   // px of scroll per second, for the section bars' timecodes
  const fmt = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  const maxScroll = () => page.max;
  const PAD = 18, SPREAD = 24;   // spacing per 1% when not zoomed out
  let ticks = [], rClips = [], marks = [], open = false;
  const cur = { s: SPREAD, y: PAD, head: PAD };

  odo.innerHTML = [0, 1, 2].map(() => `<span class="odo-d"><span>${'0123456789'.split('').map((d) => `<i>${d}</i>`).join('')}</span></span>`).join('') + '<span class="odo-pct">%</span>';
  const odoCols = [...odo.querySelectorAll('.odo-d > span')];
  let lastPct = -1;
  const setOdo = (pct) => {
    if (pct === lastPct) return;
    lastPct = pct;
    String(pct).padStart(3, '0').split('').forEach((d, i) => { odoCols[i].style.transform = `translateY(${-d}em)`; });
  };

  const sections = () => [...document.querySelectorAll('.hero, .sec')].map((sec) => {
    const top = sec.getBoundingClientRect().top + scrollY;
    return { sec, a: Math.min(1, top / maxScroll()), b: Math.min(1, (top + sec.offsetHeight) / maxScroll()) };
  });
  const buildRuler = () => {
    let html = '';
    for (let i = 0; i <= 100; i++) {
      html += `<span class="tick${i % 5 === 0 ? ' major' : ''}">${i % 5 === 0 ? `<b>${i}</b>` : ''}</span>`;
    }
    const secs = sections();
    secs.forEach(({ sec }) => {
      if (sec.classList.contains('hero')) return;
      html += `<span class="ruler-clip" data-color="${sec.querySelector('.sbar')?.dataset.color || 'a'}"></span>`;
    });
    rulerTrack.innerHTML = html;
    ticks = [...rulerTrack.querySelectorAll('.tick')];
    rClips = [...rulerTrack.querySelectorAll('.ruler-clip')].map((el, i) => ({ el, ...secs.filter((s) => !s.sec.classList.contains('hero'))[i] }));
    // section names for the zoomed-out view
    const names = [t('hero.title'), t('nav.work'), t('nav.about'), t('nav.services'), t('nav.contact')];
    rulerMap.innerHTML = secs.map((s, i) => `<b>${names[i] || ''}</b>`).join('');
    marks = [...rulerMap.children].map((el, i) => ({ el, a: secs[i].a, b: secs[i].b }));
  };

  // Where things should be for the current scroll and mode
  const target = () => {
    const p = Math.min(1, scrollY / maxScroll());
    const H = ruler.clientHeight - PAD * 2;
    if (open) {
      const s = H / 100;
      return { p, s, y: PAD, head: PAD + p * 100 * s };
    }
    const head = PAD + p * H;
    return { p, s: SPREAD, y: head - p * 100 * SPREAD, head };
  };
  let raf = 0;
  const render = () => {
    raf = 0;
    const tg = target();
    const k = 0.2;
    cur.s += (tg.s - cur.s) * k; cur.y += (tg.y - cur.y) * k; cur.head += (tg.head - cur.head) * k;
    const settled = Math.abs(tg.s - cur.s) < 0.01 && Math.abs(tg.y - cur.y) < 0.2 && Math.abs(tg.head - cur.head) < 0.2;
    if (settled) Object.assign(cur, { s: tg.s, y: tg.y, head: tg.head });
    const dense = cur.s < 10;   // hide minor labels when zoomed out
    ticks.forEach((tk, i) => {
      tk.style.transform = `translateY(${(cur.y + i * cur.s).toFixed(1)}px)`;
      tk.style.opacity = dense && i % 5 ? '.22' : '';
    });
    rClips.forEach(({ el, a, b }) => {
      el.style.transform = `translateY(${(cur.y + a * 100 * cur.s).toFixed(1)}px) scaleY(${Math.max(4, (b - a) * 100 * cur.s - 3).toFixed(1)})`;
      el.style.height = '1px';
    });
    const vA = scrollY / page.h, vB = (scrollY + page.vh) / page.h;
    rulerView.style.transform = `translateY(${(cur.y + vA * 100 * cur.s).toFixed(1)}px) scaleY(${Math.max(2, (vB - vA) * 100 * cur.s).toFixed(1)})`;
    rulerHead.style.transform = `translateY(${cur.head.toFixed(1)}px)`;
    const here = marks.findIndex((m) => tg.p >= m.a && tg.p < m.b + 0.001);
    marks.forEach((m, i) => {
      m.el.style.top = `${(cur.y + m.a * 100 * cur.s - 6).toFixed(1)}px`;
      m.el.classList.toggle('here', i === here);
    });
    setOdo(Math.round(tg.p * 100));
    if (!settled) raf = requestAnimationFrame(render);
  };
  const moveRuler = () => { if (!raf) raf = requestAnimationFrame(render); };

  // Hover zooms out; the crosshair shows the percent under the cursor; click jumps there
  const pctAt = (clientY) => Math.min(100, Math.max(0, (clientY - ruler.getBoundingClientRect().top - cur.y) / cur.s));
  ruler.addEventListener('pointerenter', () => { open = true; ruler.classList.add('open'); rulerMap.classList.add('open'); moveRuler(); });
  ruler.addEventListener('pointerleave', () => {
    open = false; ruler.classList.remove('open', 'hovering'); rulerMap.classList.remove('open'); moveRuler();
  });
  ruler.addEventListener('pointermove', (e) => {
    rulerHover.style.transform = `translateY(${e.clientY - ruler.getBoundingClientRect().top}px)`;
    rulerHover.firstElementChild.textContent = `${String(Math.round(pctAt(e.clientY))).padStart(3, '0')}%`;
    ruler.classList.add('hovering');
  });
  ruler.addEventListener('click', (e) => {
    scrollTo({ top: (pctAt(e.clientY) / 100) * maxScroll(), behavior: reduceMotion ? 'auto' : 'smooth' });
  });
  // Each section bar shows where that section sits on the timeline (in → out)
  const stampTracks = () => {
    document.querySelectorAll('.sec').forEach((sec) => {
      const tc = sec.querySelector('.sbar-tc');
      if (!tc) return;
      const top = sec.getBoundingClientRect().top + scrollY;
      tc.innerHTML = `${fmt(Math.floor(top / STEP))}<i>→</i>${fmt(Math.floor((top + sec.offsetHeight) / STEP))}`;
    });
  };
  const refreshRuler = () => { stampTracks(); buildRuler(); moveRuler(); };
  addEventListener('resize', refreshRuler);
  addEventListener('load', refreshRuler);
  document.fonts?.ready.then(refreshRuler);
  document.addEventListener('langchange', refreshRuler);
  document.addEventListener('pagesize', refreshRuler);
  refreshRuler();
  addEventListener('scroll', moveRuler, { passive: true });

  /* ---------- Theme ---------- */
  document.getElementById('themeBtn').addEventListener('click', () => {
    const current = root.dataset.theme
      || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = current === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    store.set('morfi-theme', next);
  });

  /* ---------- Mobile menu ---------- */
  const menuBtn = document.getElementById('menuBtn');
  const mobileNav = document.getElementById('mobileNav');
  const toggleMenu = (open) => {
    menuBtn.setAttribute('aria-expanded', String(open));
    mobileNav.classList.toggle('open', open);
  };
  menuBtn.addEventListener('click', () => toggleMenu(menuBtn.getAttribute('aria-expanded') !== 'true'));
  mobileNav.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => toggleMenu(false)));
  addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleMenu(false); });
  matchMedia('(min-width: 901px)').addEventListener('change', (e) => { if (e.matches) toggleMenu(false); });

  /* ---------- Header state + scroll progress ---------- */
  const bar = document.querySelector('.progress span');
  const onScroll = () => {
    bar.style.setProperty('--p', (Math.min(1, scrollY / page.max)).toFixed(4));
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Active nav link ---------- */
  const links = [...document.querySelectorAll('.nav a, .mobile-nav .hud')];
  const navObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((a) => a.classList.toggle('active', a.hash === '#' + e.target.id));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  document.querySelectorAll('main section[id]').forEach((s) => navObserver.observe(s));

  /* ---------- Reveal on scroll ---------- */
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('in');
      revealObserver.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.reveal').forEach((el) => {
    // Stagger siblings that reveal together (cards, list rows)
    const siblings = [...el.parentElement.children].filter((c) => c.classList.contains('reveal'));
    el.style.setProperty('--d', `${Math.min(siblings.indexOf(el), 5) * 0.08}s`);
    revealObserver.observe(el);
  });

  /* ---------- Hero timecode (25 fps) ---------- */
  const tc = document.getElementById('timecode');
  const start = performance.now();
  const pad = (n) => String(n).padStart(2, '0');
  let lastFrame = -1;
  const tick = () => {
    const frames = Math.floor(((performance.now() - start) / 1000) * 25);
    if (frames === lastFrame) return;
    lastFrame = frames;
    const f = frames % 25, s = Math.floor(frames / 25) % 60;
    const m = Math.floor(frames / 1500) % 60, h = Math.floor(frames / 90000);
    tc.textContent = `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
  };
  tick();


  /* ---------- Hero rings, drawn on one canvas ---------- */
  // Same strokes, dashes, colours and speeds as the old SVG rings (units are a 200×200 box).
  const ringCanvas = document.getElementById('rings');
  const rctx = ringCanvas.getContext('2d');
  const RINGS = [
    { r: 96,  w: 3,   dash: [0.6, 4.4], color: 'line', alpha: 1,   period: 90, dir: 1 },
    { r: 88,  w: 0.5, dash: [90, 463],  color: 'accent', alpha: 0.8, period: 24, dir: 1, cap: 'round' },
    { r: 80,  w: 0.3, dash: [2, 6],     color: 'teal', alpha: 0.4, period: 60, dir: -1 },
    { r: 135, w: 0.35, dash: [260, 590], color: 'accent', alpha: 0.85, period: 38, dir: 1 },
    { r: 175, w: 0.35, dash: [340, 760], color: 'teal', alpha: 0.85, period: 52, dir: -1 },
    { r: 220, w: 0.35, dash: [220, 1160], color: 'rec', alpha: 0.6, period: 70, dir: 1 },
  ];
  let ringBox = 0, ringColors = {}, cw = 0, ch = 0;
  const sizeRings = () => {
    const vmin = Math.min(innerWidth, innerHeight);
    ringBox = Math.min(vmin * 0.86, 760);            // the old SVG box size
    // the canvas only covers the viewfinder area: rings beyond it were never visible
    cw = ringCanvas.clientWidth; ch = ringCanvas.clientHeight;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    ringCanvas.width = Math.round(cw * dpr);
    ringCanvas.height = Math.round(ch * dpr);
    rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  const readRingColors = () => {
    const cs = getComputedStyle(root);
    ringColors = { line: cs.getPropertyValue('--line').trim(), accent: cs.getPropertyValue('--accent').trim(),
      teal: cs.getPropertyValue('--teal').trim(), rec: cs.getPropertyValue('--rec').trim() };
  };
  const drawRings = (now) => {
    const k = ringBox / 200;
    rctx.clearRect(0, 0, cw, ch);
    for (const g of RINGS) {
      const ang = reduceMotion ? 0 : ((now / 1000) / g.period) * Math.PI * 2 * g.dir;
      rctx.save();
      rctx.translate(cw / 2, ch / 2);
      rctx.rotate(ang);
      rctx.globalAlpha = g.alpha;
      rctx.strokeStyle = ringColors[g.color];
      rctx.lineWidth = g.w * k;
      rctx.lineCap = g.cap || 'butt';
      rctx.setLineDash(g.dash.map((d) => d * k));
      rctx.beginPath();
      rctx.arc(0, 0, g.r * k, 0, Math.PI * 2);
      rctx.stroke();
      rctx.restore();
    }
  };
  sizeRings();
  readRingColors();
  drawRings(performance.now());
  addEventListener('resize', () => { sizeRings(); drawRings(performance.now()); });
  // theme / LUT changes recolour the rings
  new MutationObserver(() => { readRingColors(); drawRings(performance.now()); })
    .observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-lut'] });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { readRingColors(); drawRings(performance.now()); });

  /* ---------- Hero footage orbit ---------- */
  // The person's clips circle the wordmark on tilted rings, like footage orbiting the lens.
  const field = document.getElementById('field');
  const fieldInner = document.getElementById('fieldInner');
  const clips = [
    ['6kj0zz', 9 / 16], ['19tkx7', 9 / 16], ['na6ruu', 9 / 16], ['crf0gr', 9 / 16], ['lq2gll', 16 / 9],
  ];
  const small = innerWidth < 700;
  // rx/ry are fractions of the hero's half-width/half-height; depth pushes the far side back
  const rings = small
    ? [{ n: 5, rx: 0.92, ry: 0.5, depth: 200, speed: 0.14 }, { n: 6, rx: 1.12, ry: 0.78, depth: 300, speed: -0.09 }]
    : [{ n: 7, rx: 0.8, ry: 0.66, depth: 260, speed: 0.1 },
       { n: 9, rx: 1.02, ry: 0.92, depth: 380, speed: -0.06 }];
  const shots = [];
  let idx = 0;
  rings.forEach((ring, r) => {
    for (let i = 0; i < ring.n; i++) {
      const [id, ratio] = clips[idx % clips.length];
      const el = document.createElement('figure');
      el.className = 'shot';
      const w = (ratio > 1 ? 176 : 98) * (small ? 0.62 : 1) * (1 - r * 0.06);
      el.style.width = `${w}px`;
      el.style.height = `${Math.round(w / ratio)}px`;
      el.dataset.tc = `A${String(++idx).padStart(3, '0')}`;
      el.innerHTML = `<img src="assets/work/sm/${id}.jpg" alt="" decoding="async">`;
      fieldInner.appendChild(el);
      shots.push({ el, ring, a: (i / ring.n) * Math.PI * 2 + r * 0.7, tilt: (Math.random() - 0.5) * 10 });
    }
  });

  let fieldVisible = true, fieldRaf = 0;
  new IntersectionObserver(([e]) => {
    root.classList.toggle('past-hero', !e.isIntersecting);
  }, { rootMargin: '0px 0px -40% 0px' }).observe(field);
  // Stop the whole loop while the hero is off screen or the tab is hidden
  const runField = () => { if (!fieldRaf && !reduceMotion) { last = performance.now(); fieldRaf = requestAnimationFrame(drawField); } };
  new IntersectionObserver(([e]) => { fieldVisible = e.isIntersecting; if (fieldVisible) runField(); }).observe(field);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && fieldVisible) runField(); });

  let last = performance.now();
  let W = field.clientWidth / 2, H = field.clientHeight / 2;
  addEventListener('resize', () => { W = field.clientWidth / 2; H = field.clientHeight / 2; });
  const halfRate = root.classList.contains('lite');   // modest devices: move cards every other frame
  let odd = false;
  const drawField = (now) => {
    fieldRaf = 0;
    if (!fieldVisible || document.hidden) return;
    if (halfRate && (odd = !odd)) { fieldRaf = requestAnimationFrame(drawField); return; }
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    tick();
    drawRings(now);
    for (const s of shots) {
      if (!reduceMotion) s.a += s.ring.speed * dt;
      const sin = Math.sin(s.a), cos = Math.cos(s.a);
      const x = cos * s.ring.rx * W;
      const y = sin * s.ring.ry * H;
      const z = sin * s.ring.depth;                  // lower half comes forward, upper half recedes
      const front = (sin + 1) / 2;                   // 0 at the back, 1 at the front
      s.el.style.opacity = (0.3 + front * 0.7).toFixed(2);
      const zi = Math.round(front * 20);
      if (zi !== s.zi) { s.zi = zi; s.el.style.zIndex = zi; }
      const far = front < 0.35;
      if (far !== s.far) { s.far = far; s.el.classList.toggle('far', far); }
      s.el.style.transform =
        `translate(-50%, -50%) translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px) rotateY(${(-cos * 18).toFixed(1)}deg) rotate(${s.tilt.toFixed(1)}deg)`;
    }
    if (!reduceMotion) fieldRaf = requestAnimationFrame(drawField);
  };
  fieldRaf = requestAnimationFrame(drawField);

  // Subtle camera pan following the pointer
  if (!reduceMotion && matchMedia('(pointer: fine)').matches) {
    document.querySelector('.hero').addEventListener('pointermove', (e) => {
      const nx = e.clientX / innerWidth - 0.5, ny = e.clientY / innerHeight - 0.5;
      fieldInner.style.transform = `rotateY(${nx * 8}deg) rotateX(${-ny * 6}deg)`;
    });
  }

  /* ---------- Count-up stats ---------- */
  const countObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target, target = +el.dataset.count;
      countObserver.unobserve(el);
      if (reduceMotion) { el.textContent = target; return; }
      const t0 = performance.now(), dur = 1400;
      const step = (now) => {
        const p = Math.min((now - t0) / dur, 1);
        el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
  });
  document.querySelectorAll('[data-count]').forEach((el) => countObserver.observe(el));

  /* ---------- Video player (iframe loads only on click) ---------- */
  const player = document.getElementById('player');
  const frame = document.getElementById('playerFrame');
  const closePlayer = () => player.close();

  document.querySelectorAll('.clip-card').forEach((card) => {
    card.setAttribute('aria-label', `${t('work.play')}: ${card.querySelector('.clip-title').textContent}`);
    card.addEventListener('click', () => {
      const ratio = card.dataset.ratio;
      player.dataset.ratio = ratio;
      frame.style.setProperty('--ratio', ratio.replace('/', ' / '));
      frame.innerHTML = `<iframe src="https://streamable.com/e/${card.dataset.video}?autoplay=1&loop=0"
        allow="autoplay; fullscreen" allowfullscreen title="${card.querySelector('.clip-title').textContent}"></iframe>`;
      player.showModal();
    });
  });
  document.getElementById('playerClose').addEventListener('click', closePlayer);
  player.addEventListener('click', (e) => { if (e.target === player) closePlayer(); });
  player.addEventListener('close', () => { frame.innerHTML = ''; });

  /* ---------- Contact form → WhatsApp ---------- */
  const form = document.getElementById('contactForm');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    let ok = true;
    const flag = (el, bad, focusEl = el) => {
      el.classList.toggle('invalid', bad);
      if (bad && ok) { focusEl.focus(); ok = false; }
    };
    const nameEl = form.elements.name, msgEl = form.elements.message;
    const picked = [...form.querySelectorAll('input[name="service"]:checked')];
    flag(nameEl, !nameEl.value.trim());
    flag(document.getElementById('serviceField'), !picked.length, form.querySelector('input[name="service"]'));
    flag(msgEl, !msgEl.value.trim());
    if (!ok) return;
    // Build a tidy brief: one line per choice, only for what was picked
    const vals = (name) => [...form.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.nextElementSibling.textContent);
    const rows = [
      ['🎬', t('form.service'), picked.map((p) => p.nextElementSibling.textContent)],
      ['📱', t('form.platform'), vals('platform')],
      ['⏱️', t('form.length'), vals('length')],
      ['💰', t('form.budget'), form.elements.budget.value.trim() ? [form.elements.budget.value.trim()] : []],
      ['📅', t('form.when'), vals('when')],
    ].filter(([, , v]) => v.length).map(([icon, label, v]) => `${icon} *${label}:* ${v.join(' + ')}`);
    const rule = '━━━━━━━━━━━━';
    const text = [
      `${t('form.greeting')} *${nameEl.value.trim()}* 👋`,
      rule,
      ...rows,
      rule,
      `📝 *${t('form.message')}:*`,
      msgEl.value.trim(),
      '',
      `— ${t('form.sentFrom')}`,
    ].join('\n');
    const url = `https://wa.me/201127402410?text=${encodeURIComponent(text)}`;
    // a quick "render" bar, like exporting from an editor
    form.classList.remove('rendering'); void form.offsetWidth; form.classList.add('rendering');
    setTimeout(() => form.classList.remove('rendering'), 1600);
    const note = form.querySelector('.form-note');
    note.textContent = t('form.opening');
    note.classList.add('sending');
    setTimeout(() => { note.textContent = t('form.note'); note.classList.remove('sending'); }, 4000);
    // open WhatsApp in a new tab; if the browser blocks that, go there directly
    const win = window.open(url, '_blank');
    if (win) win.opener = null; else location.href = url;
  });
  form.addEventListener('input', (e) => {
    e.target.classList.remove('invalid');
    if (e.target.name === 'service') document.getElementById('serviceField').classList.remove('invalid');
  });

  /* ---------- Section title "train" ---------- */
  // Each section's name waits small at the bottom-right. As the section scrolls in,
  // its letters travel right, climb the timeline ruler, curve over and settle large at
  // the top; finished sections shrink into a stack above. The hero wordmark flies up
  // to become the first entry.
  (() => {
    const nav = document.getElementById('train');
    const desk = matchMedia('(min-width: 901px)');
    const BASE = 40, RAIL = 0.66;
    // Arabic glyphs read smaller, so the stack gets bigger letters and more room
    let SMALL = 0.56, GAP = 26, ACT = 36;
    const wm = document.getElementById('wordmark');
    const sections = [
      { el: document.getElementById('hero'), key: 'hero.title', hero: true },
      { el: document.getElementById('work'), key: 'nav.work' },
      { el: document.getElementById('about'), key: 'nav.about' },
      { el: document.getElementById('services'), key: 'nav.services' },
      { el: document.getElementById('contact'), key: 'nav.contact' },
    ];
    const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
    const lerp = (a, b, p) => a + (b - a) * p;
    let items = [];


    function build() {
      nav.innerHTML = '';
      items = sections.map((sec) => {
        const label = t(sec.key);
        const a = document.createElement('a');
        a.href = sec.hero ? '#top' : `#${sec.el.id}`;
        a.className = 'train-hit';
        a.setAttribute('aria-label', label);
        nav.appendChild(a);
        const parts = lang !== 'ar' ? [...label.toUpperCase()] : arabicLetters(label);
        const letters = parts.map((ch) => {
          const s = document.createElement('span');
          s.className = `train-ch${sec.hero ? ' is-hero' : ''}`;
          s.setAttribute('aria-hidden', 'true');
          s.textContent = ch;
          nav.appendChild(s);
          return s;
        });
        return { ...sec, a, letters };
      });
      layout();
    }

    // Measure letters and pre-compute each section's travel path (in LTR screen space)
    function layout() {
      const vw = innerWidth, vh = innerHeight, n = items.length;
      const ar = lang === 'ar';
      SMALL = ar ? 0.7 : 0.56; GAP = ar ? 36 : 26; ACT = ar ? 50 : 36;
      const right = vw - 84, railX = vw - 28;
      items.forEach((it, i) => {
        let x = 0;
        const seam = lang === 'ar' ? 0.8 : 0;   // overlap joined Arabic letters so no hairline shows
        it.wid = it.letters.map((s) => { const t0 = s.style.transform; s.style.transform = 'none'; const w = s.getBoundingClientRect().width - seam; s.style.transform = t0; return w; });
        it.adv = it.wid.map((w) => { const c = x + w / 2; x += w; return c; });
        it.W = x;
        it.yTop = (ar ? 112 : 100) + i * GAP;
        it.yAct = it.yTop + ACT;
        it.yBot = vh - 40 - (n - 1 - i) * GAP;
        it.right = right;
        it.pageTop = it.el.getBoundingClientRect().top + scrollY;
        if (it.hero) {
          // where each wordmark letter starts, from layout boxes (unaffected by the intro animation)
          const box = wm.getBoundingClientRect();
          const chs = [...wm.querySelectorAll('.ch')];
          const whole = chs.length !== it.letters.length;
          it.big = parseFloat(getComputedStyle(wm).fontSize) / BASE;
          it.fromY = box.top + scrollY + box.height / 2;
          it.from = it.letters.map((_, k) => (whole
            ? box.left + (it.adv[k] / it.W) * box.width
            : box.left + (chs[k].offsetLeft - wm.offsetLeft) + chs[k].offsetWidth / 2));
          return;
        }
        // Path for the leading edge of the word: bottom slot → ruler → up → curve → active slot
        const pts = [[right - 3000, it.yBot], [right, it.yBot]];
        const quad = (p0, c, p1) => { for (let k = 1; k <= 10; k++) { const u = k / 10; pts.push([
          (1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * c[0] + u * u * p1[0],
          (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * c[1] + u * u * p1[1]]); } };
        const cubic = (p0, c1, c2, p1) => { for (let k = 1; k <= 24; k++) { const u = k / 24, v = 1 - u; pts.push([
          v ** 3 * p0[0] + 3 * v * v * u * c1[0] + 3 * v * u * u * c2[0] + u ** 3 * p1[0],
          v ** 3 * p0[1] + 3 * v * v * u * c1[1] + 3 * v * u * u * c2[1] + u ** 3 * p1[1]]); } };
        pts.push([railX - 22, it.yBot]);
        quad([railX - 22, it.yBot], [railX, it.yBot], [railX, it.yBot - 22]);
        // Climb the ruler; the last stretch (a swing into the slot) is handled per letter
        it.yHead = it.yAct + 26;
        pts.push([railX, it.yHead]);
        const len = [0];
        for (let k = 1; k < pts.length; k++) len.push(len[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
        it.pts = pts; it.len = len;
        it.sStart = len[1];                       // leading edge at the bottom slot's right end
        it.sRail = len[1] + (railX - 22 - right);
        it.sUp = it.sRail + 35;
        it.sEnd = len[len.length - 1];
        it.sCurve = it.sEnd;
        // Where each letter sits when the word reaches the top of the ruler
        it.dock = [];
        let pos = it.sEnd;
        for (let k = it.letters.length - 1; k >= 0; k--) {
          const half = it.wid[k] / 2;
          pos -= half * scaleAt(it, pos);
          const [x, y] = at(it, pos);
          it.dock[k] = [x, y];
          pos -= half * scaleAt(it, pos);
        }
      });
    }

    // Point + heading on a path at arc length s
    function at(it, s) {
      const { pts, len } = it;
      let k = 1;
      while (k < len.length - 1 && len[k] < s) k++;
      const seg = len[k] - len[k - 1] || 1;
      const u = clamp((s - len[k - 1]) / seg);
      const [x0, y0] = pts[k - 1], [x1, y1] = pts[k];
      // Tilt with the climb only: upright when sliding sideways, -90° on the ruler, never upside down
      const dl = Math.hypot(x1 - x0, y1 - y0) || 1;
      return [lerp(x0, x1, u), lerp(y0, y1, u), y1 < y0 ? (-90 * (y0 - y1)) / dl : 0];
    }
    // Letters grow as they travel: small → a bit bigger on the ruler → full size at the top
    function scaleAt(it, s) {
      if (s <= it.sRail) return SMALL;
      if (s <= it.sUp) return lerp(SMALL, RAIL, (s - it.sRail) / (it.sUp - it.sRail));
      return RAIL;
    }

    function place(s, x, y, rot, sc, rtl) {
      if (rtl) { x = innerWidth - x; rot = -rot; }
      s.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%) rotate(${rot.toFixed(1)}deg) scale(${sc.toFixed(3)})`;
      s.style.opacity = (0.62 + 0.38 * clamp((sc - SMALL) / (1 - SMALL))).toFixed(2);
    }
    function hit(it, x, y, w, h, on, rtl) {
      if (rtl) x = innerWidth - x - w;
      Object.assign(it.a.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, pointerEvents: on ? 'auto' : 'none' });
    }

    function frame() {
      if (!desk.matches || !items.length) { wm.style.visibility = ''; return; }
      const vh = innerHeight, rtl = false, n = items.length;
      const enter = items.map((it, i) => (i === 0 ? 1
        : clamp((vh - (it.pageTop - scrollY)) / (vh - 140))));

      items.forEach((it, i) => {
        const exit = i + 1 < n ? enter[i + 1] : 0;
        const L = it.letters.length;

        if (it.hero) {
          // Fly from the big hero wordmark to the top of the stack
          const p = clamp(exit * 1.6);
          const flying = p > 0.001;
          wm.style.visibility = flying ? 'hidden' : '';
          const big = it.big;
          it.letters.forEach((s, k) => {
            if (!flying) { s.style.opacity = 0; return; }
            // Each letter leaves on its own beat (right-most first), fans out mid-flight,
            // then they regroup small at the top of the stack
            const raw = clamp(p * 1.4 - ((L - 1 - k) / Math.max(1, L - 1)) * 0.4);
            const pk = ease(raw);
            const lift = Math.sin(Math.PI * raw);
            const off = k - (L - 1) / 2;
            const fromX = it.from[k];
            // the wordmark scrolls away under the header, so letters peel off and stay on screen
            const fromY = Math.max(it.fromY - scrollY, 150);
            const toX = it.right - (it.W - it.adv[k]) * SMALL;
            place(s, lerp(fromX, toX, pk) + off * lift * 90, lerp(fromY, it.yTop, pk) + lift * 50 * (1 + Math.abs(off) * 0.35),
              off * lift * 8, lerp(big, SMALL, pk), rtl);
          });
          hit(it, it.right - it.W * SMALL, it.yTop - 12, it.W * SMALL, 24, p >= 1, rtl);
          return;
        }

        const e = enter[i];
        if (e >= 1) {
          // Active (large) → shrinks into the stack as the next section arrives
          const xP = ease(exit);
          it.letters.forEach((s, k) => {
            const pk = xP;
            const sc = lerp(1, SMALL, pk);
            const ax = it.right - it.W + it.adv[k];
            const tx = it.right - (it.W - it.adv[k]) * SMALL;
            place(s, lerp(ax, tx, pk), lerp(it.yAct, it.yTop, pk), 0, sc, rtl);
          });
          const sc = lerp(1, SMALL, xP), y = lerp(it.yAct, it.yTop, xP);
          hit(it, it.right - it.W * sc, y - (BASE / 2) * sc, it.W * sc, BASE * sc, true, rtl);
          return;
        }

        // Travelling: first along the bottom and up the ruler (A), then each letter
        // swings off the ruler into its place in the title (B), top letters first.
        const SPLIT = 0.62;
        if (e < SPLIT) {
          const head = lerp(it.sStart, it.sEnd, ease(e / SPLIT));
          let pos = head;
          for (let k = L - 1; k >= 0; k--) {
            const half = it.wid[k] / 2;
            pos -= half * scaleAt(it, pos);
            const sc = scaleAt(it, pos);
            const [x, y, rot] = at(it, pos);
            place(it.letters[k], x, y, rot, sc, rtl);
            pos -= half * sc;
          }
        } else {
          const q = (e - SPLIT) / (1 - SPLIT);
          it.letters.forEach((s, k) => {
            const qk = ease(clamp(q * 1.5 - ((L - 1 - k) / Math.max(1, L - 1)) * 0.5));
            const [ax, ay] = it.dock[k];
            const dx = it.right - it.W + it.adv[k], dy = it.yAct;
            // curve: up off the ruler first, then across into place
            const cx = ax, cy = dy;
            const x = (1 - qk) ** 2 * ax + 2 * (1 - qk) * qk * cx + qk * qk * dx;
            const y = (1 - qk) ** 2 * ay + 2 * (1 - qk) * qk * cy + qk * qk * dy;
            place(s, x, y, lerp(-90, 0, qk), lerp(RAIL, 1, qk), rtl);
          });
        }
        hit(it, it.right - it.W * SMALL, it.yBot - 12, it.W * SMALL, 24, e === 0, rtl);
      });
    }

    let queued = false;
    const request = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; frame(); }); } };
    addEventListener('scroll', request, { passive: true });
    addEventListener('resize', () => { layout(); request(); });
    desk.addEventListener('change', () => { layout(); request(); });
    document.addEventListener('langchange', () => { build(); request(); });
    document.addEventListener('pagesize', () => { layout(); request(); });
    // Fonts change letter widths, so re-measure once they're in
    document.fonts?.ready.then(() => { layout(); request(); });
    build();
    request();
  })();

  /* ---------- Work cards lean toward the pointer ---------- */
  const finePointer = matchMedia('(pointer: fine)').matches;
  if (!reduceMotion && finePointer) {
    document.querySelectorAll('.clip-card').forEach((card) => {
      const media = card.querySelector('.clip-media');
      card.addEventListener('pointermove', (e) => {
        const r = media.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5, ny = (e.clientY - r.top) / r.height - 0.5;
        card.style.setProperty('--ry', `${(nx * 10).toFixed(1)}deg`);
        card.style.setProperty('--rx', `${(-ny * 8).toFixed(1)}deg`);
      });
      card.addEventListener('pointerleave', () => {
        card.style.setProperty('--rx', '0deg');
        card.style.setProperty('--ry', '0deg');
      });
    });
  }

  /* ---------- Cursor: a small viewfinder that becomes a PLAY badge over clips ---------- */
  if (!reduceMotion && finePointer) {
    const cur = document.createElement('div');
    cur.className = 'cursor';
    cur.setAttribute('aria-hidden', 'true');
    cur.innerHTML = '<span></span>';
    document.body.appendChild(cur);
    let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y, followRaf = 0;
    // only animate while the cursor is catching up, then sleep
    const follow = () => {
      x += (tx - x) * 0.22;
      y += (ty - y) * 0.22;
      cur.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      followRaf = Math.abs(tx - x) + Math.abs(ty - y) > 0.3 ? requestAnimationFrame(follow) : 0;
    };
    addEventListener('pointermove', (e) => {
      tx = e.clientX; ty = e.clientY; cur.classList.add('on');
      if (!followRaf) followRaf = requestAnimationFrame(follow);
    }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => cur.classList.remove('on'));
    document.addEventListener('pointerover', (e) => {
      const clip = e.target.closest('.clip-card');
      const hot = e.target.closest('a, button, select, input, textarea, label, .ruler');
      cur.classList.toggle('play', !!clip);
      cur.classList.toggle('link', !clip && !!hot);
      if (clip) cur.firstElementChild.textContent = t('work.play');
    });
  }

  /* ---------- Phone scrollbar ---------- */
  // The timeline ruler is hidden on phones, so give them a clear, draggable scrollbar instead.
  const ms = document.createElement('div');
  ms.className = 'mscroll';
  ms.setAttribute('aria-hidden', 'true');
  ms.innerHTML = '<span class="mscroll-thumb"></span>';
  document.body.appendChild(ms);
  const thumb = ms.firstElementChild;
  let track = 0, thumbH = 48;
  const measureThumb = () => {
    track = ms.clientHeight;
    thumbH = Math.max(48, track * (page.vh / page.h));
    thumb.style.height = `${thumbH}px`;
  };
  const sizeThumb = () => {
    const p = Math.min(1, scrollY / page.max);
    thumb.style.transform = `translateY(${(p * (track - thumbH)).toFixed(1)}px)`;
  };
  document.addEventListener('pagesize', () => { measureThumb(); sizeThumb(); });
  measureThumb();
  let drag = null;
  thumb.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, s: scrollY };
    thumb.setPointerCapture(e.pointerId);
    ms.classList.add('dragging');
  });
  thumb.addEventListener('pointermove', (e) => {
    if (!drag) return;
    scrollTo(0, drag.s + ((e.clientY - drag.y) / Math.max(1, track - thumbH)) * page.max);
  });
  const endDrag = () => { drag = null; ms.classList.remove('dragging'); };
  thumb.addEventListener('pointerup', endDrag);
  thumb.addEventListener('pointercancel', endDrag);
  addEventListener('scroll', sizeThumb, { passive: true });
  addEventListener('load', sizeThumb);
  sizeThumb();

  /* ---------- Labels decode like a timecode readout ---------- */
  const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/:#';
  const decode = (el) => {
    if (lang === 'ar' || reduceMotion) return;
    const final = el.textContent;
    const t0 = performance.now(), dur = 520;
    const step = (now) => {
      const p = Math.min((now - t0) / dur, 1);
      const lock = Math.floor(final.length * p);
      el.textContent = [...final].map((ch, i) => (i < lock || ch === ' ' ? ch : GLYPHS[(Math.random() * GLYPHS.length) | 0])).join('');
      if (p < 1) requestAnimationFrame(step); else el.textContent = final;
    };
    requestAnimationFrame(step);
  };
  const decodeObserver = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      decodeObserver.unobserve(e.target);
      e.target.querySelectorAll('.sbar-title [data-i18n], .strip > span:first-child').forEach(decode);
    });
  }, { rootMargin: '0px 0px -15% 0px' });
  document.querySelectorAll('.sbar, .grid > .cell').forEach((el) => decodeObserver.observe(el));

  /* ---------- Buttons lean toward the pointer ---------- */
  if (!reduceMotion && finePointer) {
    document.querySelectorAll('.hbtn, .cta').forEach((btn) => {
      btn.addEventListener('pointermove', (e) => {
        const r = btn.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
        btn.style.transform = `translate(${(dx * 0.18).toFixed(1)}px, ${(dy * 0.3).toFixed(1)}px)`;
      });
      btn.addEventListener('pointerleave', () => { btn.style.transform = ''; });
    });
  }

  /* ---------- Grade the site ---------- */
  // Visitors try colour-grading looks on the whole page; the new look wipes in like a
  // before/after compare. The choice is remembered.
  const LUTS = { none: 'Original', teal: 'Teal & Orange', noir: 'Noir', kodak: 'Kodak 2383', bleach: 'Bleach Bypass' };
  const gradeBtn = document.getElementById('gradeBtn');
  const gradePanel = document.getElementById('gradePanel');
  const gradeName = document.getElementById('gradeName');
  const wipe = document.querySelector('.wipe');
  const setLut = (key) => {
    if (key === 'none') delete root.dataset.lut; else root.dataset.lut = key;
    gradeName.textContent = LUTS[key];
    document.querySelectorAll('.g-item').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lut === key)));
    store.set('morfi-lut', key);
  };
  const applyLut = (key) => {
    if (!LUTS[key] || (root.dataset.lut || 'none') === key) return;
    if (!document.startViewTransition || reduceMotion) { setLut(key); return; }
    document.getElementById('wipeName').textContent = `LUT · ${LUTS[key]}`;
    root.classList.add('grading');
    wipe.classList.remove('run'); void wipe.offsetWidth; wipe.classList.add('run');
    const vt = document.startViewTransition(() => setLut(key));
    vt.finished.finally(() => { root.classList.remove('grading'); wipe.classList.remove('run'); });
  };
  const toggleGrade = (open) => {
    gradePanel.hidden = !open;
    gradeBtn.setAttribute('aria-expanded', String(open));
  };
  gradeBtn.addEventListener('click', () => toggleGrade(gradePanel.hidden));
  document.querySelectorAll('.g-item').forEach((b) => b.addEventListener('click', () => applyLut(b.dataset.lut)));
  document.addEventListener('click', (e) => { if (!e.target.closest('#grade')) toggleGrade(false); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleGrade(false); });
  setLut(LUTS[store.get('morfi-lut')] ? store.get('morfi-lut') : 'none');

  /* ---------- J / K / L shuttle, like every editing app ---------- */
  // L plays forward (press again to go faster), J plays backward, K stops.
  const shuttleEl = document.getElementById('shuttle');
  const SPEEDS = [0, 2.5, 6, 14, 30];  // px per frame for 1×, 2×, 4×, 8×
  let shuttle = 0, shuttleRaf = 0, hideShuttle = 0;
  const showShuttle = () => {
    const n = Math.abs(shuttle);
    shuttleEl.innerHTML = shuttle === 0 ? '<b>❚❚</b>&nbsp; K' : `<b>${shuttle > 0 ? '▶▶' : '◀◀'}</b>&nbsp; ${2 ** (n - 1)}×`;
    shuttleEl.classList.add('show');
    clearTimeout(hideShuttle);
    if (shuttle === 0) hideShuttle = setTimeout(() => shuttleEl.classList.remove('show'), 900);
  };
  const runShuttle = () => {
    const before = scrollY;
    scrollBy(0, Math.sign(shuttle) * SPEEDS[Math.abs(shuttle)]);
    // stop at either end of the page
    if (shuttle !== 0 && scrollY === before) { shuttle = 0; showShuttle(); }
    shuttleRaf = shuttle ? requestAnimationFrame(runShuttle) : 0;
  };
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable]')) return;
    const k = e.key.toLowerCase();
    if (k !== 'j' && k !== 'k' && k !== 'l') return;
    if (k === 'k') shuttle = 0;
    if (k === 'l') shuttle = shuttle <= 0 ? 1 : Math.min(shuttle + 1, 4);
    if (k === 'j') shuttle = shuttle >= 0 ? -1 : Math.max(shuttle - 1, -4);
    showShuttle();
    if (shuttle && !shuttleRaf) {
      root.style.scrollBehavior = 'auto';
      shuttleRaf = requestAnimationFrame(runShuttle);
    }
    if (!shuttle) root.style.scrollBehavior = '';
  });
  // One-time tip for desktop visitors
  const tip = document.getElementById('tip');
  if (finePointer && !store.get('morfi-tip')) {
    setTimeout(() => {
      tip.hidden = false;
      setTimeout(() => { tip.hidden = true; }, 9000);
    }, 4500);
  }
  document.getElementById('tipClose').addEventListener('click', () => { tip.hidden = true; store.set('morfi-tip', '1'); });
  addEventListener('keydown', (e) => { if ('jkl'.includes(e.key.toLowerCase()) && !tip.hidden) { tip.hidden = true; store.set('morfi-tip', '1'); } });

  /* ---------- About quote lights up word by word, like subtitles ---------- */
  const quote = document.querySelector('.quote');
  const splitQuote = () => {
    quote.innerHTML = quote.textContent.trim().split(/\s+/).map((w) => `<span class="w">${w}</span>`).join(' ');
  };
  const lightQuote = () => {
    const words = quote.querySelectorAll('.w');
    const r = quote.getBoundingClientRect();
    const p = Math.min(1, Math.max(0, (innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.4)));
    const n = Math.round(p * words.length);
    words.forEach((w, i) => { w.classList.toggle('lit', i < n); w.classList.toggle('now', i === n - 1 && p < 1); });
  };
  splitQuote();
  lightQuote();
  let quoteRaf = 0;
  addEventListener('scroll', () => { if (!quoteRaf) quoteRaf = requestAnimationFrame(() => { quoteRaf = 0; lightQuote(); }); }, { passive: true });
  document.addEventListener('langchange', () => { splitQuote(); lightQuote(); });

  /* ---------- Wordmark letters rise toward the pointer ---------- */
  if (!reduceMotion && finePointer) {
    const heroEl = document.querySelector('.hero');
    heroEl.addEventListener('pointermove', (e) => {
      document.querySelectorAll('#wordmark .ch').forEach((ch) => {
        const r = ch.getBoundingClientRect();
        const d = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
        const k = Math.max(0, 1 - d / 360);
        ch.style.translate = `0 ${(-k * 14).toFixed(1)}px`;
        ch.style.scale = `1 ${(1 + k * 0.1).toFixed(3)}`;
        ch.style.color = k > 0.75 ? 'var(--accent)' : '';
      });
    });
    heroEl.addEventListener('pointerleave', () => {
      document.querySelectorAll('#wordmark .ch').forEach((ch) => { ch.style.translate = ''; ch.style.scale = ''; ch.style.color = ''; });
    });
  }

  /* ---------- Tab title pauses while the visitor is away ---------- */
  const baseTitle = document.title;
  document.addEventListener('visibilitychange', () => {
    document.title = document.hidden ? `❚❚ ${t('tab.paused')}` : baseTitle;
  });

  /* ---------- End credits appear one after another ---------- */
  const credits = document.querySelector('.credits');
  credits.querySelectorAll('.credits-list div').forEach((d, k) => d.style.setProperty('--k', k));
  new IntersectionObserver(([e], obs) => {
    if (!e.isIntersecting) return;
    credits.classList.add('in');
    obs.disconnect();
  }, { rootMargin: '0px 0px -10% 0px' }).observe(credits);

  document.getElementById('year').textContent = new Date().getFullYear();
})();
