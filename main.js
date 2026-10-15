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
    const parts = lang === 'ar' ? arabicLetters(text) : [...text];
    wm.classList.toggle('split-ar', lang === 'ar');
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

  /* ---------- Side timeline ruler ---------- */
  // The whole page is one timeline (40px of scroll = 1s). The ruler stays put and the
  // red playhead travels down it as you scroll. Each section shows as a coloured clip.
  const ruler = document.querySelector('.ruler');
  const rulerTrack = document.getElementById('rulerTrack');
  const rulerHead = document.querySelector('.ruler-head');
  const rulerTc = document.getElementById('rulerTc');
  const rulerHover = document.getElementById('rulerHover');
  const STEP = 40;
  const fmt = (sec) => `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  const maxScroll = () => Math.max(1, document.documentElement.scrollHeight - innerHeight);
  const PAD = 18; // keep the playhead clear of the ruler's ends
  const span = () => ruler.clientHeight - PAD * 2;

  const buildRuler = () => {
    const H = span(), total = maxScroll() / STEP;
    const n = Math.max(10, Math.round(H / 14));      // a tick every ~14px
    let html = '';
    for (let i = 0; i <= n; i++) {
      const major = i % 5 === 0;
      html += `<span class="tick${major ? ' major' : ''}" style="top:${PAD + (i / n) * H}px">${major ? `<b>${fmt(Math.round((i / n) * total))}</b>` : ''}</span>`;
    }
    // Sections as clips on the track
    document.querySelectorAll('.sec').forEach((sec) => {
      const bar = sec.querySelector('.sbar');
      const top = sec.getBoundingClientRect().top + scrollY;
      const a = Math.min(1, top / maxScroll()), b = Math.min(1, (top + sec.offsetHeight) / maxScroll());
      html += `<span class="ruler-clip" data-color="${bar?.dataset.color || 'a'}" data-for="${sec.id}" style="top:${PAD + a * H}px;height:${Math.max(4, (b - a) * H - 3)}px"></span>`;
    });
    rulerTrack.innerHTML = html;
  };
  const moveRuler = () => {
    const p = Math.min(1, scrollY / maxScroll());
    rulerHead.style.transform = `translateY(${(PAD + p * span()).toFixed(1)}px)`;
    rulerTc.textContent = fmt(Math.floor(scrollY / STEP));
  };
  // Hover shows the timecode under the cursor; click jumps there
  const yToScroll = (clientY) => {
    const y = clientY - ruler.getBoundingClientRect().top - PAD;
    return Math.min(1, Math.max(0, y / span())) * maxScroll();
  };
  ruler.addEventListener('pointermove', (e) => {
    rulerHover.style.transform = `translateY(${e.clientY - ruler.getBoundingClientRect().top}px)`;
    rulerHover.firstElementChild.textContent = fmt(Math.floor(yToScroll(e.clientY) / STEP));
    ruler.classList.add('hovering');
  });
  ruler.addEventListener('pointerleave', () => ruler.classList.remove('hovering'));
  ruler.addEventListener('click', (e) => {
    scrollTo({ top: yToScroll(e.clientY), behavior: reduceMotion ? 'auto' : 'smooth' });
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
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.setProperty('--p', max > 0 ? (scrollY / max).toFixed(4) : 0);
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
  const tick = (now) => {
    const frames = Math.floor(((now - start) / 1000) * 25);
    const f = frames % 25, s = Math.floor(frames / 25) % 60;
    const m = Math.floor(frames / 1500) % 60, h = Math.floor(frames / 90000);
    tc.textContent = `${pad(h)}:${pad(m)}:${pad(s)}:${pad(f)}`;
    if (!reduceMotion) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);

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
      el.innerHTML = `<img src="assets/work/${id}.jpg" alt="" decoding="async">`;
      fieldInner.appendChild(el);
      shots.push({ el, ring, a: (i / ring.n) * Math.PI * 2 + r * 0.7, tilt: (Math.random() - 0.5) * 10 });
    }
  });

  let fieldVisible = true;
  new IntersectionObserver(([e]) => {
    fieldVisible = e.isIntersecting;
    root.classList.toggle('past-hero', !e.isIntersecting);
  }, { rootMargin: '0px 0px -40% 0px' }).observe(field);

  let last = performance.now();
  const drawField = (now) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const W = field.clientWidth / 2, H = field.clientHeight / 2;
    for (const s of shots) {
      if (!reduceMotion && fieldVisible) s.a += s.ring.speed * dt;
      const sin = Math.sin(s.a), cos = Math.cos(s.a);
      const x = cos * s.ring.rx * W;
      const y = sin * s.ring.ry * H;
      const z = sin * s.ring.depth;                  // lower half comes forward, upper half recedes
      const front = (sin + 1) / 2;                   // 0 at the back, 1 at the front
      s.el.style.opacity = (0.35 + front * 0.65).toFixed(3);
      s.el.style.zIndex = Math.round(front * 100);
      s.el.style.filter = front < 0.4 ? `blur(${((0.4 - front) * 6).toFixed(1)}px)` : 'none';
      s.el.style.transform =
        `translate(-50%, -50%) translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, ${z.toFixed(1)}px) rotateY(${(-cos * 18).toFixed(1)}deg) rotate(${s.tilt.toFixed(1)}deg)`;
    }
    if (!reduceMotion) requestAnimationFrame(drawField);
  };
  requestAnimationFrame(drawField);

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
        it.wid = it.letters.map((s) => s.offsetWidth);
        it.adv = it.wid.map((w) => { const c = x + w / 2; x += w; return c; });
        it.W = x;
        it.yTop = (ar ? 112 : 100) + i * GAP;
        it.yAct = it.yTop + ACT;
        it.yBot = vh - 40 - (n - 1 - i) * GAP;
        it.right = right;
        if (it.hero) return;
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
        : clamp((vh - it.el.getBoundingClientRect().top) / (vh - 140))));

      items.forEach((it, i) => {
        const exit = i + 1 < n ? enter[i + 1] : 0;
        const L = it.letters.length;

        if (it.hero) {
          // Fly from the big hero wordmark to the top of the stack
          const p = clamp(exit * 1.6);
          const flying = p > 0.001;
          wm.style.visibility = flying ? 'hidden' : '';
          const chs = wm.querySelectorAll('.ch');
          const big = parseFloat(getComputedStyle(wm).fontSize) / BASE;
          it.letters.forEach((s, k) => {
            if (!flying) { s.style.opacity = 0; return; }
            // Each letter leaves on its own beat (right-most first), fans out mid-flight,
            // then they regroup small at the top of the stack
            const raw = clamp(p * 1.4 - ((L - 1 - k) / Math.max(1, L - 1)) * 0.4);
            const pk = ease(raw);
            const lift = Math.sin(Math.PI * raw);
            const off = k - (L - 1) / 2;
            const r = (chs[k] || chs[0]).getBoundingClientRect();
            const fromX = r.left + r.width / 2;
            // the wordmark scrolls away under the header, so letters peel off and stay on screen
            const fromY = Math.max(r.top + r.height / 2, 150);
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
    let x = innerWidth / 2, y = innerHeight / 2, tx = x, ty = y;
    addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; cur.classList.add('on'); }, { passive: true });
    document.documentElement.addEventListener('pointerleave', () => cur.classList.remove('on'));
    const follow = () => {
      x += (tx - x) * 0.22;
      y += (ty - y) * 0.22;
      cur.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      requestAnimationFrame(follow);
    };
    follow();
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
  const sizeThumb = () => {
    const track = ms.clientHeight;
    const h = Math.max(48, track * (innerHeight / document.documentElement.scrollHeight));
    thumb.style.height = `${h}px`;
    const p = Math.min(1, scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight));
    thumb.style.transform = `translateY(${(p * (track - h)).toFixed(1)}px)`;
  };
  let drag = null;
  thumb.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, s: scrollY };
    thumb.setPointerCapture(e.pointerId);
    ms.classList.add('dragging');
  });
  thumb.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const track = ms.clientHeight - thumb.offsetHeight;
    const max = document.documentElement.scrollHeight - innerHeight;
    scrollTo(0, drag.s + ((e.clientY - drag.y) / track) * max);
  });
  const endDrag = () => { drag = null; ms.classList.remove('dragging'); };
  thumb.addEventListener('pointerup', endDrag);
  thumb.addEventListener('pointercancel', endDrag);
  addEventListener('scroll', sizeThumb, { passive: true });
  addEventListener('resize', sizeThumb);
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
  addEventListener('scroll', lightQuote, { passive: true });
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
