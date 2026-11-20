// Мое_мемы — редактор на canvas
const Editor = (() => {
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const $ = id => document.getElementById(id);

  const S = {
    aspect: '1:1', res: 1800, bg: '#ffffff',
    img: null,          // HTMLImageElement
    src: null,          // {type:'url', url, name} | {type:'blob', blob, name}
    crop: null,         // {x,y,w,h} в пикселях исходника
    pos: { x: 900, y: 900, scale: 1 },
    texts: [],
    sel: null,          // id текста | 'img' | null
    cropMode: false, cropRect: null,
    savedId: null
  };
  let uid = 1;

  // ---------- размеры ----------
  function sizeFor(aspect, res) {
    let a = aspect;
    if (a === 'img') {
      if (!S.img) a = '1:1';
      else { const c = S.crop; return dims(c.w, c.h, res); }
    }
    const [w, h] = a.split(':').map(Number);
    return dims(w, h, res);
  }
  function dims(w, h, res) {
    return w >= h ? { w: res, h: Math.round(res * h / w) } : { w: Math.round(res * w / h), h: res };
  }
  function applySize(keepRel) {
    const old = { w: cv.width, h: cv.height };
    const d = sizeFor(S.aspect, S.res);
    if (d.w === cv.width && d.h === cv.height) { render(); return; }
    cv.width = d.w; cv.height = d.h;
    if (keepRel) {
      const kx = d.w / old.w, ky = d.h / old.h, k = Math.min(kx, ky);
      S.texts.forEach(t => { t.x *= kx; t.y *= ky; t.size *= k; t.sw *= k; });
    }
    fit('contain');
    $('size-label').textContent = (S.aspect === 'img' ? 'как у картинки' : S.aspect) + ' · ' + d.w + '×' + d.h;
  }

  // ---------- картинка ----------
  function loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.crossOrigin = 'anonymous';
      im.onload = () => res(im);
      im.onerror = () => {
        if (src.type === 'url' && !src._proxied) {
          // запасной путь через прокси с CORS
          src._proxied = true;
          const p = new Image(); p.crossOrigin = 'anonymous';
          p.onload = () => res(p); p.onerror = rej;
          p.src = 'https://images.weserv.nl/?url=' + encodeURIComponent(src.url.replace(/^https?:\/\//, ''));
        } else rej(new Error('img'));
      };
      im.src = src.type === 'url' ? src.url : URL.createObjectURL(src.blob);
    });
  }

  async function openSource(src, project) {
    toast('Загружаю картинку…');
    try {
      const im = await loadImage(src);
      S.img = im; S.src = src; S.savedId = null;
      S.crop = { x: 0, y: 0, w: im.naturalWidth, h: im.naturalHeight };
      S.texts = []; S.sel = null; S.cropMode = false;
      if (project) {
        S.aspect = project.aspect; S.res = project.res; S.bg = project.bg;
        S.crop = project.crop; S.savedId = project.savedId || null;
        syncSizeControls();
        const d = sizeFor(S.aspect, S.res); cv.width = d.w; cv.height = d.h;
        S.pos = Object.assign({}, project.pos);
        S.baseScale = Math.min(d.w / S.crop.w, d.h / S.crop.h);
        $('img-scale').value = Math.round(S.pos.scale / S.baseScale * 100);
        S.texts = project.texts.map(t => Object.assign({}, t, { id: uid++ }));
        $('size-label').textContent = (S.aspect === 'img' ? 'как у картинки' : S.aspect) + ' · ' + d.w + '×' + d.h;
        await loadFonts(); render();
      } else {
        applySizeForce();
        addText('ВЕРХНИЙ ТЕКСТ', 'top', true);
        addText('НИЖНИЙ ТЕКСТ', 'bottom', true);
        S.sel = null; updatePanel(); render();
      }
      toast('Готово — редактируй');
    } catch (e) {
      toast('Не удалось загрузить картинку. Проверь интернет.');
    }
  }
  function applySizeForce() {
    const d = sizeFor(S.aspect, S.res); cv.width = d.w; cv.height = d.h;
    $('size-label').textContent = (S.aspect === 'img' ? 'как у картинки' : S.aspect) + ' · ' + d.w + '×' + d.h;
    fit('contain');
  }
  function syncSizeControls() {
    $('aspect').value = S.aspect; $('res').value = String(S.res); $('bg').value = S.bg;
  }

  function fit(mode) {
    if (!S.img) { render(); return; }
    const c = S.crop;
    const k = mode === 'cover' ? Math.max(cv.width / c.w, cv.height / c.h) : Math.min(cv.width / c.w, cv.height / c.h);
    S.pos = { x: cv.width / 2, y: cv.height / 2, scale: k };
    S.baseScale = k;
    $('img-scale').value = 100;
    render();
  }

  function blank() {
    S.img = null; S.src = null; S.crop = null; S.texts = []; S.sel = null; S.savedId = null; S.cropMode = false;
    $('crop-bar').classList.add('hidden');
    applySizeForce();
    addText('ТВОЙ ТЕКСТ', 'center', true);
    S.texts[0].color = '#000000'; S.texts[0].stroke = '#ffffff';
    updatePanel(); render();
  }

  // ---------- текст ----------
  function addText(str, where, silent) {
    const t = {
      id: uid++, text: str || 'ТЕКСТ', x: cv.width / 2, y: cv.height / 2,
      size: Math.round(Math.min(cv.width, cv.height) * 0.085), font: 'Impact, "Oswald"',
      color: '#ffffff', stroke: '#000000', sw: Math.round(Math.min(cv.width, cv.height) * 0.006),
      bold: true, italic: false, upper: true, align: 'center', maxw: 92, rot: 0,
      bgOn: false, bgColor: '#000000', opacity: 100
    };
    S.texts.push(t);
    placeText(t, where || 'center');
    if (!silent) { S.sel = t.id; updatePanel(); }
    render();
    return t;
  }
  function placeText(t, where) {
    const m = measure(t);
    const pad = Math.min(cv.width, cv.height) * 0.03;
    if (where === 'top') t.y = pad + m.h / 2;
    else if (where === 'bottom') t.y = cv.height - pad - m.h / 2;
    else t.y = cv.height / 2;
    t.x = cv.width / 2;
  }
  function fontStr(t) {
    return (t.italic ? 'italic ' : '') + (t.bold ? '700 ' : '400 ') + Math.round(t.size) + 'px ' + t.font + ', sans-serif';
  }
  function lines(t) {
    ctx.font = fontStr(t);
    const maxW = cv.width * t.maxw / 100;
    const txt = t.upper ? t.text.toUpperCase() : t.text;
    const out = [];
    txt.split('\n').forEach(par => {
      const words = par.split(' ');
      let cur = '';
      words.forEach(w => {
        const test = cur ? cur + ' ' + w : w;
        if (ctx.measureText(test).width > maxW && cur) { out.push(cur); cur = w; }
        else cur = test;
      });
      out.push(cur);
    });
    return out;
  }
  function measure(t) {
    const ls = lines(t);
    ctx.font = fontStr(t);
    const lh = t.size * 1.15;
    let w = 0; ls.forEach(l => { w = Math.max(w, ctx.measureText(l).width); });
    const pad = t.bgOn ? t.size * 0.25 : t.sw;
    return { ls, lh, w: w + pad * 2, h: ls.length * lh + pad * 2, tw: w };
  }
  function drawText(t, showSel) {
    const m = measure(t);
    ctx.save();
    ctx.translate(t.x, t.y);
    ctx.rotate(t.rot * Math.PI / 180);
    ctx.globalAlpha = t.opacity / 100;
    if (t.bgOn) {
      ctx.fillStyle = t.bgColor;
      roundRect(-m.w / 2, -m.h / 2, m.w, m.h, t.size * 0.15); ctx.fill();
    }
    ctx.font = fontStr(t);
    ctx.textBaseline = 'middle';
    ctx.textAlign = t.align;
    ctx.lineJoin = 'round'; ctx.miterLimit = 2;
    const ax = t.align === 'left' ? -m.tw / 2 : t.align === 'right' ? m.tw / 2 : 0;
    const y0 = -(m.ls.length - 1) * m.lh / 2;
    m.ls.forEach((l, i) => {
      const y = y0 + i * m.lh;
      if (t.sw > 0) { ctx.strokeStyle = t.stroke; ctx.lineWidth = t.sw * 2; ctx.strokeText(l, ax, y); }
      ctx.fillStyle = t.color; ctx.fillText(l, ax, y);
    });
    ctx.globalAlpha = 1;
    if (showSel) {
      ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = Math.max(3, cv.width / 400);
      ctx.setLineDash([cv.width / 90, cv.width / 140]);
      ctx.strokeRect(-m.w / 2 - 6, -m.h / 2 - 6, m.w + 12, m.h + 12);
      ctx.setLineDash([]);
    }
    ctx.restore();
    t._m = m;
  }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  // ---------- отрисовка ----------
  function imgRect() {
    const c = S.crop, p = S.pos;
    const w = c.w * p.scale, h = c.h * p.scale;
    return { x: p.x - w / 2, y: p.y - h / 2, w, h };
  }
  function render(forExport) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = S.bg; ctx.fillRect(0, 0, cv.width, cv.height);
    if (S.img) {
      if (S.cropMode && !forExport) { renderCrop(); return; }
      const c = S.crop, r = imgRect();
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(S.img, c.x, c.y, c.w, c.h, r.x, r.y, r.w, r.h);
      if (!forExport && S.sel === 'img') {
        ctx.strokeStyle = '#4dabff'; ctx.lineWidth = Math.max(3, cv.width / 400);
        ctx.strokeRect(r.x, r.y, r.w, r.h);
      }
    }
    S.texts.forEach(t => drawText(t, !forExport && S.sel === t.id));
  }

  // режим обрезки: показываем всю исходную картинку и рамку
  function cropView() {
    const im = S.img, W = im.naturalWidth, H = im.naturalHeight;
    const k = Math.min(cv.width * 0.92 / W, cv.height * 0.8 / H);
    return { k, ox: (cv.width - W * k) / 2, oy: (cv.height * 0.9 - H * k) / 2 };
  }
  function renderCrop() {
    const v = cropView(), im = S.img, r = S.cropRect;
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(im, v.ox, v.oy, im.naturalWidth * v.k, im.naturalHeight * v.k);
    const rx = v.ox + r.x * v.k, ry = v.oy + r.y * v.k, rw = r.w * v.k, rh = r.h * v.k;
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.beginPath(); ctx.rect(0, 0, cv.width, cv.height); ctx.rect(rx, ry, rw, rh); ctx.fill('evenodd');
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = Math.max(4, cv.width / 300); ctx.strokeRect(rx, ry, rw, rh);
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2;
    for (let i = 1; i < 3; i++) {
      ctx.beginPath(); ctx.moveTo(rx + rw * i / 3, ry); ctx.lineTo(rx + rw * i / 3, ry + rh); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(rx, ry + rh * i / 3); ctx.lineTo(rx + rw, ry + rh * i / 3); ctx.stroke();
    }
    const hs = cv.width / 28;
    ctx.fillStyle = '#ffd23f';
    [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]].forEach(([x, y]) => {
      ctx.beginPath(); ctx.arc(x, y, hs / 2, 0, Math.PI * 2); ctx.fill();
    });
  }
  function startCrop() {
    if (!S.img) { toast('Сначала выбери картинку'); return; }
    S.cropMode = true; S.sel = null; updatePanel();
    S.cropRect = Object.assign({}, S.crop);
    $('crop-bar').classList.remove('hidden');
    render();
  }
  function endCrop(apply) {
    if (apply) {
      const r = S.cropRect;
      S.crop = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
    }
    S.cropMode = false;
    $('crop-bar').classList.add('hidden');
    if (apply && S.aspect === 'img') applySize(true); else fit('contain');
  }
  function cropSquare() {
    const r = S.cropRect, im = S.img;
    const s = Math.min(r.w, r.h), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    r.w = r.h = s;
    r.x = Math.min(Math.max(0, cx - s / 2), im.naturalWidth - s);
    r.y = Math.min(Math.max(0, cy - s / 2), im.naturalHeight - s);
    render();
  }

  // ---------- касания ----------
  const ptrs = new Map();
  let drag = null;
  function pt(e) {
    const b = cv.getBoundingClientRect();
    return { x: (e.clientX - b.left) * cv.width / b.width, y: (e.clientY - b.top) * cv.height / b.height };
  }
  function hitText(p) {
    for (let i = S.texts.length - 1; i >= 0; i--) {
      const t = S.texts[i], m = t._m || measure(t);
      const a = -t.rot * Math.PI / 180, dx = p.x - t.x, dy = p.y - t.y;
      const lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a);
      const pad = cv.width / 60;
      if (Math.abs(lx) <= m.w / 2 + pad && Math.abs(ly) <= m.h / 2 + pad) return t;
    }
    return null;
  }
  function selObj() { return S.texts.find(t => t.id === S.sel); }

  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    const p = pt(e); ptrs.set(e.pointerId, p);
    if (ptrs.size === 2) { startPinch(); return; }
    if (S.cropMode) { cropDown(p); return; }
    const t = hitText(p);
    if (t) {
      S.sel = t.id;
      drag = { kind: 'text', t, sx: p.x, sy: p.y, ox: t.x, oy: t.y };
    } else if (S.img) {
      const r = imgRect();
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) {
        S.sel = 'img'; drag = { kind: 'img', sx: p.x, sy: p.y, ox: S.pos.x, oy: S.pos.y };
      } else { S.sel = null; drag = null; }
    } else { S.sel = null; drag = null; }
    updatePanel(); render();
  });
  cv.addEventListener('pointermove', e => {
    if (!ptrs.has(e.pointerId)) return;
    const p = pt(e); ptrs.set(e.pointerId, p);
    if (ptrs.size >= 2 && pinch) { doPinch(); return; }
    if (S.cropMode) { cropMove(p); return; }
    if (!drag) return;
    const dx = p.x - drag.sx, dy = p.y - drag.sy;
    if (drag.kind === 'text') { drag.t.x = drag.ox + dx; drag.t.y = drag.oy + dy; }
    else { S.pos.x = drag.ox + dx; S.pos.y = drag.oy + dy; }
    render();
  });
  const up = e => {
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0) { drag = null; cdrag = null; }
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    const k = e.deltaY < 0 ? 1.06 : 1 / 1.06;
    const t = selObj();
    if (t) { t.size = clamp(t.size * k, 10, 1200); updatePanel(); }
    else if (S.img) { S.pos.scale *= k; syncScale(); }
    render();
  }, { passive: false });

  let pinch = null;
  function pinchData() {
    const [a, b] = [...ptrs.values()];
    return { d: Math.hypot(b.x - a.x, b.y - a.y), ang: Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI };
  }
  function startPinch() {
    drag = null; cdrag = null;
    if (S.cropMode) return;
    const t = selObj(), pd = pinchData();
    if (t) pinch = { kind: 'text', t, d: pd.d, ang: pd.ang, size: t.size, rot: t.rot, sw: t.sw };
    else if (S.img) pinch = { kind: 'img', d: pd.d, scale: S.pos.scale };
  }
  function doPinch() {
    const pd = pinchData(), k = pd.d / pinch.d;
    if (pinch.kind === 'text') {
      pinch.t.size = clamp(pinch.size * k, 10, 1200);
      pinch.t.sw = pinch.sw * k;
      let r = pinch.rot + (pd.ang - pinch.ang);
      if (r > 180) r -= 360; if (r < -180) r += 360;
      pinch.t.rot = Math.round(r);
      updatePanel();
    } else { S.pos.scale = pinch.scale * k; syncScale(); }
    render();
  }

  let cdrag = null;
  function toSrc(p) { const v = cropView(); return { x: (p.x - v.ox) / v.k, y: (p.y - v.oy) / v.k }; }
  function cropDown(p) {
    const s = toSrc(p), r = S.cropRect, v = cropView(), tol = cv.width / 18 / v.k;
    const corners = { tl: [r.x, r.y], tr: [r.x + r.w, r.y], bl: [r.x, r.y + r.h], br: [r.x + r.w, r.y + r.h] };
    for (const k in corners) {
      if (Math.hypot(s.x - corners[k][0], s.y - corners[k][1]) < tol) { cdrag = { kind: k, s, r0: Object.assign({}, r) }; return; }
    }
    if (s.x > r.x && s.x < r.x + r.w && s.y > r.y && s.y < r.y + r.h) cdrag = { kind: 'move', s, r0: Object.assign({}, r) };
    else cdrag = { kind: 'new', s, r0: { x: s.x, y: s.y, w: 0, h: 0 } };
  }
  function cropMove(p) {
    if (!cdrag) return;
    const s = toSrc(p), W = S.img.naturalWidth, H = S.img.naturalHeight, o = cdrag.r0, r = S.cropRect;
    const dx = s.x - cdrag.s.x, dy = s.y - cdrag.s.y, min = 20;
    let x1 = o.x, y1 = o.y, x2 = o.x + o.w, y2 = o.y + o.h;
    if (cdrag.kind === 'move') {
      const nx = clamp(o.x + dx, 0, W - o.w), ny = clamp(o.y + dy, 0, H - o.h);
      Object.assign(r, { x: nx, y: ny, w: o.w, h: o.h }); render(); return;
    }
    if (cdrag.kind === 'new') { x1 = cdrag.s.x; y1 = cdrag.s.y; x2 = s.x; y2 = s.y; }
    if (cdrag.kind.includes('l')) x1 = o.x + dx;
    if (cdrag.kind.includes('r')) x2 = o.x + o.w + dx;
    if (cdrag.kind.includes('t')) y1 = o.y + dy;
    if (cdrag.kind.includes('b')) y2 = o.y + o.h + dy;
    let ax = clamp(Math.min(x1, x2), 0, W), bx = clamp(Math.max(x1, x2), 0, W);
    let ay = clamp(Math.min(y1, y2), 0, H), by = clamp(Math.max(y1, y2), 0, H);
    if (bx - ax < min || by - ay < min) return;
    Object.assign(r, { x: ax, y: ay, w: bx - ax, h: by - ay });
    render();
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function syncScale() { if (S.baseScale) $('img-scale').value = Math.round(S.pos.scale / S.baseScale * 100); }

  // ---------- панель текста ----------
  function updatePanel() {
    const t = selObj();
    $('text-controls').classList.toggle('hidden', !t);
    $('text-hint').classList.toggle('hidden', !!t);
    if (!t) return;
    if (document.activeElement !== $('t-text')) $('t-text').value = t.text;
    $('t-font').value = t.font;
    $('t-color').value = t.color; $('t-stroke').value = t.stroke;
    $('t-size').value = Math.round(t.size); $('t-size-v').textContent = Math.round(t.size) + 'px';
    $('t-sw').value = Math.round(t.sw); $('t-maxw').value = t.maxw; $('t-rot').value = t.rot;
    $('t-bold').classList.toggle('on', t.bold); $('t-italic').classList.toggle('on', t.italic);
    $('t-upper').classList.toggle('on', t.upper); $('t-bgon').classList.toggle('on', t.bgOn);
    $('t-bgcolor').value = t.bgColor; $('t-opacity').value = t.opacity;
    $('t-align').textContent = { left: '⇤ влево', center: '≡ центр', right: '⇥ вправо' }[t.align];
  }
  function bind(id, ev, fn) { $(id).addEventListener(ev, e => { const t = selObj(); if (!t) return; fn(t, e); updatePanel(); render(); }); }
  bind('t-text', 'input', (t, e) => { t.text = e.target.value; });
  bind('t-font', 'change', (t, e) => { t.font = e.target.value; loadFonts().then(render); });
  bind('t-color', 'input', (t, e) => { t.color = e.target.value; });
  bind('t-stroke', 'input', (t, e) => { t.stroke = e.target.value; });
  bind('t-size', 'input', (t, e) => { t.size = +e.target.value; });
  bind('t-sw', 'input', (t, e) => { t.sw = +e.target.value; });
  bind('t-maxw', 'input', (t, e) => { t.maxw = +e.target.value; });
  bind('t-rot', 'input', (t, e) => { t.rot = +e.target.value; });
  bind('t-bold', 'click', t => { t.bold = !t.bold; });
  bind('t-italic', 'click', t => { t.italic = !t.italic; });
  bind('t-upper', 'click', t => { t.upper = !t.upper; });
  bind('t-bgon', 'click', t => { t.bgOn = !t.bgOn; });
  bind('t-bgcolor', 'input', (t, e) => { t.bgColor = e.target.value; t.bgOn = true; });
  bind('t-opacity', 'input', (t, e) => { t.opacity = +e.target.value; });
  bind('t-align', 'click', t => { t.align = { left: 'center', center: 'right', right: 'left' }[t.align]; });
  bind('t-top', 'click', t => placeText(t, 'top'));
  bind('t-bottom', 'click', t => placeText(t, 'bottom'));
  bind('t-center', 'click', t => placeText(t, 'center'));
  bind('t-dup', 'click', t => {
    const c = Object.assign({}, t, { id: uid++, x: t.x + cv.width * 0.03, y: t.y + cv.height * 0.03 });
    S.texts.push(c); S.sel = c.id;
  });
  bind('t-del', 'click', t => { S.texts = S.texts.filter(x => x !== t); S.sel = null; });

  $('add-text').onclick = () => addText('ТЕКСТ', 'center');
  $('crop-btn').onclick = startCrop;
  $('crop-apply').onclick = () => endCrop(true);
  $('crop-cancel').onclick = () => endCrop(false);
  $('crop-square').onclick = cropSquare;
  $('fit-btn').onclick = () => fit('contain');
  $('fill-btn').onclick = () => fit('cover');
  $('aspect').onchange = e => { S.aspect = e.target.value; applySize(true); };
  $('res').onchange = e => { S.res = +e.target.value; applySize(true); };
  $('bg').oninput = e => { S.bg = e.target.value; render(); };
  $('img-scale').oninput = e => { if (S.img && S.baseScale) { S.pos.scale = S.baseScale * e.target.value / 100; render(); } };

  // ---------- шрифты ----------
  function loadFonts() {
    if (!document.fonts) return Promise.resolve();
    const fams = new Set(S.texts.map(t => t.font));
    const jobs = [];
    fams.forEach(f => f.split(',').forEach(n => {
      n = n.trim(); if (!n.startsWith('"')) return;
      jobs.push(document.fonts.load('700 40px ' + n, 'АбвAbc'), document.fonts.load('400 40px ' + n, 'АбвAbc'));
    }));
    return Promise.all(jobs).catch(() => {});
  }
  if (document.fonts) document.fonts.ready.then(() => render());

  // ---------- экспорт ----------
  function exportBlob(q) {
    const sel = S.sel; S.sel = null;
    render(true);
    return new Promise((res, rej) => {
      try {
        cv.toBlob(b => { S.sel = sel; render(); b ? res(b) : rej(new Error('blob')); }, 'image/jpeg', q || 0.92);
      } catch (e) { S.sel = sel; render(); rej(e); }
    });
  }
  function thumbFrom(blob) {
    return new Promise(res => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas'), k = 360 / Math.max(im.width, im.height);
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.8)); URL.revokeObjectURL(im.src);
      };
      im.src = URL.createObjectURL(blob);
    });
  }
  function project() {
    return {
      aspect: S.aspect, res: S.res, bg: S.bg, crop: S.crop, pos: S.pos,
      texts: S.texts.map(t => { const c = Object.assign({}, t); delete c._m; delete c.id; return c; })
    };
  }
  function name() {
    const first = S.texts.find(t => t.text.trim());
    return (S.src && S.src.name) || (first ? first.text.slice(0, 40) : 'Мем');
  }

  function toast(m) { if (typeof App !== 'undefined') App.toast(m); }

  return {
    S, openSource, blank, exportBlob, thumbFrom, project, name, render,
    hasContent: () => !!S.img || S.texts.length > 0,
    init() { blank(); }
  };
})();
