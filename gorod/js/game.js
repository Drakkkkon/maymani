// «Мое_город» — градостроитель на Babylon.js.
// Три вида: «3D» (свободная камера), «ИЗО» (изометрия с крупными пикселями, как в старых SimCity)
// и «ИЗО HD» (та же изометрия, но с полным разрешением, сглаживанием, SSAO и подробными текстурами).
// Одинаковые здания рисуются пачками (thin instances): тысячи домов — это десятки вызовов отрисовки.
(function () {
  'use strict';
  var G = window.GAME, N = G.mapSize, B = window.BABYLON;
  var SAVE_KEY = 'moe_gorod_save_v1', SEEN_KEY = 'moe_gorod_seen', VIEW_KEY = 'moe_gorod_view';
  var $ = function (id) { return document.getElementById(id); };
  var TOUCH = window.matchMedia && matchMedia('(pointer: coarse)').matches;

  // ---------- Случайные числа с зерном ----------
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick(r, arr) { return arr[Math.floor(r() * arr.length)]; }
  function rint(r, a, b) { return a + Math.floor(r() * (b - a + 1)); }
  function newSeed() { return (Math.random() * 2147483647) | 0; }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function hex(c) { return B.Color3.FromHexString(c); }

  // ---------- Состояние ----------
  // b.prog (0…1) есть только у зданий, которые ещё строятся.
  var state, occ = new Int32Array(N * N);
  function sizeOk(n) { return typeof n === 'number' && n >= 16 && n <= 160 && (n | 0) === n; }
  function idx(x, z) { return z * N + x; }
  function inMap(x, z) { return x >= 0 && z >= 0 && x < N && z < N; }
  function key(x, z) { return x + ',' + z; }
  function foot(sz, rot) { var s = G.sizes[sz]; return rot % 2 ? { w: s.d, d: s.w } : { w: s.w, d: s.d }; }
  function isSite(b) { return typeof b.prog === 'number' && b.prog < 1; }

  function demoState(n) {
    n = n || G.mapSize;
    var s = emptyState(n);
    var x, z, o = Math.floor((n - 48) / 2); // пример нарисован для 48×48 — ставим его в центр
    function rd(x, z, t) { x += o; z += o; if (x >= 0 && z >= 0 && x < n && z < n) s.roads[key(x, z)] = t; }
    for (x = 12; x <= 36; x++) rd(x, 24, 'asphalt');
    for (z = 12; z <= 36; z++) rd(24, z, 'asphalt');
    for (x = 8; x <= 23; x++) rd(x, 31, 'dirt');
    for (z = 14; z <= 23; z++) rd(30, z, 'asphalt');
    for (z = 25; z <= 30; z++) rd(12, z, 'dirt');
    var list = [
      ['res', '1x1', 19, 23, 0], ['res', '1x1', 21, 23, 0], ['res', '2x1', 16, 23, 0], ['res', '1x1', 14, 30, 2],
      ['res', '2x1', 17, 30, 2], ['res', '1x1', 20, 30, 2], ['res', '2x2', 26, 22, 0], ['res', '4x4', 31, 19, 0],
      ['social', '2x2', 26, 25, 2], ['social', '1x1', 22, 25, 2], ['gov', '2x2', 19, 25, 2], ['gov', '4x4', 25, 18, 0],
      ['corp', '4x4', 28, 27, 3], ['corp', '2x1', 22, 22, 0], ['corp', '1x1', 25, 30, 1], ['army', '2x2', 14, 26, 1]
    ];
    list.forEach(function (b) {
      var f = foot(b[1], b[4]), bx = b[2] + o, bz = b[3] + o;
      if (bx < 0 || bz < 0 || bx + f.w > n || bz + f.d > n) return;
      s.buildings.push({ id: s.nextId++, cat: b[0], size: b[1], x: bx, z: bz, rot: b[4], seed: newSeed() });
    });
    return s;
  }
  function emptyState(n) { return { v: 1, size: n || G.mapSize, nextId: 1, buildings: [], roads: {}, brigades: [], nextBr: 1, spent: 0 }; }
  function fixState(s) {
    if (!sizeOk(s.size)) s.size = 48;
    if (!Array.isArray(s.brigades)) s.brigades = [];
    s.nextBr = s.nextBr || s.brigades.length + 1;
    s.spent = s.spent || 0;
    return s;
  }

  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(SAVE_KEY));
      if (s && s.v === 1 && Array.isArray(s.buildings) && s.roads) return fixState(s);
    } catch (e) {}
    return null;
  }
  var saveTimer = 0;
  function save() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 250); }
  function saveNow() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function rebuildOcc() { occ.fill(0); state.buildings.forEach(function (b) { markOcc(b, b.id); }); }
  function markOcc(b, val) {
    var f = foot(b.size, b.rot);
    for (var z = b.z; z < b.z + f.d; z++) for (var x = b.x; x < b.x + f.w; x++) if (inMap(x, z)) occ[idx(x, z)] = val;
  }
  var byId = {};
  function getB(id) { return byId[id] || null; }
  function canPlace(sz, rot, x, z, ignoreId) {
    var f = foot(sz, rot);
    for (var zz = z; zz < z + f.d; zz++) for (var xx = x; xx < x + f.w; xx++) {
      if (!inMap(xx, zz)) return false;
      var o = occ[idx(xx, zz)];
      if (o && o !== ignoreId) return false;
      if (state.roads[key(xx, zz)]) return false;
    }
    return true;
  }

  // ---------- Доллары ----------
  function money() { return isFinite(G.money) ? G.money - state.spent : Infinity; }
  function canPay(x) { return money() >= x; }
  function pay(x) { state.spent += x; updateMoney(); }
  function usd(n) { return isFinite(n) ? '$' + Math.round(n).toLocaleString('ru-RU') : '∞'; }
  function costOf(cat, size) { return Math.round(G.costs[size] * (G.costK[cat] || 1) / 1000) * 1000; }
  function buildTime(b) { return G.buildTime[b.size] || 20; }
  function updateMoney() { var m = money(); $('stMoney').textContent = isFinite(m) ? Math.round(m).toLocaleString('ru-RU') : '∞'; }

  // ---------- Движок Babylon.js ----------
  var canvas = $('scene');
  var engine = new B.Engine(canvas, true, { stencil: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }, false);
  var scene = new B.Scene(engine);
  scene.useRightHandedSystem = true;      // как в прежней версии: x вправо, z к зрителю
  scene.skipPointerMovePicking = true;    // свои обработчики касаний — движку не нужно искать объекты
  scene.autoClearDepthAndStencil = true;
  var SKY = '#a9d0f0', VOID = '#10141c';
  scene.clearColor = B.Color4.FromHexString(SKY + 'ff');
  scene.fogColor = hex(SKY);

  var camera = new B.FreeCamera('cam', new B.Vector3(0, 30, 30), scene);
  camera.fov = 45 * Math.PI / 180; camera.minZ = 0.1; camera.maxZ = 600;
  camera.inputs.clear();

  var hemi = new B.HemisphericLight('hemi', new B.Vector3(0, 1, 0), scene);
  hemi.diffuse = hex('#e8f2ff'); hemi.groundColor = hex('#6f8a5a'); hemi.specular = B.Color3.Black(); hemi.intensity = 0.72;
  // Солнце идёт за камерой: тени чёткие на карте любого размера.
  var SUN_OFF = new B.Vector3(-22, 40, 18);
  var sun = new B.DirectionalLight('sun', SUN_OFF.scale(-1).normalize(), scene);
  sun.diffuse = hex('#fff3dc'); sun.specular = B.Color3.Black(); sun.intensity = 0.62;
  sun.autoUpdateExtends = false; sun.autoCalcShadowZBounds = false;
  sun.shadowMinZ = 1; sun.shadowMaxZ = 200;
  var shadowGen = new B.ShadowGenerator(2048, sun);
  shadowGen.bias = 0.0015; shadowGen.normalBias = 0.01;
  function setShadowStyle(iso) {
    // Один и тот же фильтр в обоих видах: смена фильтра на лету пересобирает шейдеры.
    shadowGen.usePercentageCloserFiltering = true;
    shadowGen.filteringQuality = B.ShadowGenerator.QUALITY_MEDIUM;
    shadowGen.usePoissonSampling = false;
  }

  // ---------- Материалы (на каждую сцену свой набор) ----------
  function windowCanvas(style, wall) {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var g = c.getContext('2d');
    g.fillStyle = wall; g.fillRect(0, 0, 64, 64);
    function win(x, y, w, h, glass, frame) {
      if (frame) { g.fillStyle = frame; g.fillRect(x - 2, y - 2, w + 4, h + 4); }
      var gr = g.createLinearGradient(x, y, x + w, y + h);
      gr.addColorStop(0, glass[0]); gr.addColorStop(1, glass[1]);
      g.fillStyle = gr; g.fillRect(x, y, w, h);
    }
    if (style === 'res') win(18, 18, 28, 28, ['#a9cbe8', '#5f86ad'], '#fbf8f0');
    else if (style === 'office') win(4, 20, 56, 24, ['#9bbbd9', '#557aa1'], '#e8edf2');
    else if (style === 'glass') {
      var gr = g.createLinearGradient(0, 0, 64, 64); gr.addColorStop(0, '#7fb0dd'); gr.addColorStop(1, wall);
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      g.fillStyle = 'rgba(220,235,250,.75)'; g.fillRect(0, 0, 64, 3); g.fillRect(0, 0, 3, 64);
    }
    else if (style === 'army') win(22, 24, 20, 14, ['#56634f', '#303a2c'], '#4b553a');
    else if (style === 'gov') win(22, 12, 20, 40, ['#a3c1dc', '#5d7fa0'], '#fffdf6');
    else if (style === 'shop') win(6, 14, 52, 42, ['#c3def2', '#6f98bd'], '#ffffff');
    return c;
  }
  // Окна для «ИЗО HD»: та же раскладка, но 256×256 — рамы, подоконники, блики на стекле, фактура стен.
  function shade(c, k) { // осветлить (k>0) или затемнить (k<0) цвет #rrggbb
    var n = parseInt(c.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    function f(v) { return Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k)); }
    return 'rgb(' + f(r) + ',' + f(g) + ',' + f(b) + ')';
  }
  function windowCanvasHD(style, wall) {
    var S = 256, c = document.createElement('canvas'); c.width = c.height = S;
    var g = c.getContext('2d'), r = rng(style.length * 131 + parseInt(wall.slice(1), 16));
    g.fillStyle = wall; g.fillRect(0, 0, S, S);
    // штукатурка: мелкий шум
    for (var i = 0; i < 1800; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.05)';
      g.fillRect(r() * S, r() * S, 1 + r() * 2, 1 + r() * 2);
    }
    // межэтажный пояс сверху и тень снизу
    g.fillStyle = shade(wall, 0.18); g.fillRect(0, 0, S, 6);
    g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(0, 6, S, 3);
    g.fillStyle = 'rgba(0,0,0,.08)'; g.fillRect(0, S - 4, S, 4);
    function glass(x, y, w, h, c0, c1) {
      var gr = g.createLinearGradient(x, y, x + w * 0.4, y + h);
      gr.addColorStop(0, c0); gr.addColorStop(1, c1);
      g.fillStyle = gr; g.fillRect(x, y, w, h);
      // отражение неба — косая светлая полоса
      g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
      g.fillStyle = 'rgba(255,255,255,.22)';
      g.beginPath(); g.moveTo(x + w * 0.15, y + h); g.lineTo(x + w * 0.45, y); g.lineTo(x + w * 0.62, y); g.lineTo(x + w * 0.32, y + h); g.fill();
      g.fillStyle = 'rgba(255,255,255,.12)';
      g.beginPath(); g.moveTo(x + w * 0.5, y + h); g.lineTo(x + w * 0.8, y); g.lineTo(x + w * 0.88, y); g.lineTo(x + w * 0.58, y + h); g.fill();
      // тень от рамы сверху
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, y, w, Math.max(3, h * 0.06));
      g.restore();
    }
    function win(x, y, w, h, c0, c1, frame, opt) {
      opt = opt || {};
      x *= 4; y *= 4; w *= 4; h *= 4;
      var fw = opt.fw || 7;
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x - fw + 3, y - fw + 4, w + fw * 2, h + fw * 2); // тень проёма
      g.fillStyle = frame; g.fillRect(x - fw, y - fw, w + fw * 2, h + fw * 2);
      g.fillStyle = shade(frame, -0.18); g.fillRect(x - fw, y + h, w + fw * 2, fw);            // низ рамы темнее
      glass(x, y, w, h, c0, c1);
      g.fillStyle = frame;
      if (opt.cross) { g.fillRect(x + w / 2 - 3, y, 6, h); g.fillRect(x, y + h * 0.38 - 3, w, 6); }
      if (opt.vbars) for (var k = 1; k < opt.vbars; k++) g.fillRect(x + w * k / opt.vbars - 3, y, 6, h);
      if (opt.curtain) { g.fillStyle = opt.curtain; g.fillRect(x + 2, y + 2, w * 0.22, h - 4); g.fillRect(x + w - w * 0.22 - 2, y + 2, w * 0.22, h - 4); }
      if (opt.sill) { // подоконник
        g.fillStyle = '#f4f2ec'; g.fillRect(x - fw - 6, y + h + fw, w + fw * 2 + 12, 8);
        g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x - fw - 4, y + h + fw + 8, w + fw * 2 + 8, 5);
      }
    }
    var CUR = ['#f3e6c4', '#e9c9c0', '#d8e4c9', '#f1efe9'];
    if (style === 'res') win(18, 18, 28, 28, '#b9d6ee', '#557ca3', '#fbf8f0', { cross: true, sill: true, curtain: pick(r, CUR) });
    else if (style === 'office') win(4, 20, 56, 24, '#a9c7e3', '#4c7099', '#e8edf2', { vbars: 4, fw: 5 });
    else if (style === 'glass') {
      var gr = g.createLinearGradient(0, 0, S * 0.5, S); gr.addColorStop(0, '#9cc6ea'); gr.addColorStop(0.55, shade(wall, 0.1)); gr.addColorStop(1, shade(wall, -0.25));
      g.fillStyle = gr; g.fillRect(0, 0, S, S);
      g.fillStyle = 'rgba(255,255,255,.18)';
      g.beginPath(); g.moveTo(0, S * 0.9); g.lineTo(S * 0.55, 0); g.lineTo(S * 0.75, 0); g.lineTo(S * 0.2, S); g.lineTo(0, S); g.fill();
      g.fillStyle = 'rgba(200,225,248,.85)'; g.fillRect(0, 0, S, 8); g.fillRect(0, 0, 8, S);
      g.fillStyle = 'rgba(20,40,70,.35)'; g.fillRect(0, 8, S, 4); g.fillRect(S / 2 - 2, 8, 4, S - 8);
    }
    else if (style === 'army') win(22, 24, 20, 14, '#6a7a60', '#2c3628', '#4b553a', { fw: 5, vbars: 2 });
    else if (style === 'gov') win(22, 12, 20, 40, '#b4cfe6', '#53769a', '#fffdf6', { cross: true, sill: true, fw: 6 });
    else if (style === 'shop') {
      win(6, 14, 52, 42, '#d2e8f7', '#6690b6', '#ffffff', { vbars: 3, fw: 6 });
      g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(0, 0, S, 40);   // тень от козырька
    }
    return c;
  }
  function makeKit(sc) {
    var mats = {}, wallM = {}, wallInfo = [], kitHD = false;
    function base(name) { var m = new B.StandardMaterial(name, sc); m.specularColor = B.Color3.Black(); return m; }
    return {
      scene: sc,
      mat: function (color) {
        if (mats[color]) return mats[color];
        var m = base('m' + color); m.diffuseColor = hex(color); return (mats[color] = m);
      },
      wall: function (style, wall) {
        var k = style + wall; if (wallM[k]) return wallM[k];
        var m = base('w' + k), info = { m: m, style: style, wall: wall, lo: null, hi: null };
        m.diffuseColor = B.Color3.White(); wallInfo.push(info);
        wallTex(info, kitHD);
        return (wallM[k] = m);
      },
      // переключить окна всех домов между обычными (64 px) и HD (256 px)
      setHD: function (hd) { kitHD = hd; wallInfo.forEach(function (i) { wallTex(i, hd); }); }
    };
    function wallTex(info, hd) {
      var slot = hd ? 'hi' : 'lo';
      if (!info[slot]) {
        var t = new B.DynamicTexture('t' + slot + info.style + info.wall, (hd ? windowCanvasHD : windowCanvas)(info.style, info.wall), sc, true);
        t.update(); t.wrapU = t.wrapV = B.Texture.WRAP_ADDRESSMODE; t.anisotropicFilteringLevel = hd ? 8 : 4;
        info[slot] = t;
      }
      info.m.diffuseTexture = info[slot];
      if (info.style === 'glass') info.m.specularColor = hd ? hex('#3a4656') : B.Color3.Black(); // блик на стеклянных башнях
      if (info.style === 'glass') info.m.specularPower = 48;
    }
  }
  var kit = makeKit(scene);

  // ---------- Модели зданий ----------
  // Модель собирается из простых фигур и сливается в ОДНУ сетку (с несколькими материалами).
  var RES_WALL = ['#f2d3a2', '#e9b98f', '#f4e7c8', '#d9c2a7', '#f0c9c0', '#cfe0c3', '#e3d0e8'];
  var RES_ROOF = ['#b8553a', '#8e4a3a', '#6b4c3b', '#a0522d', '#5e6a7a', '#3f6b5a'];
  var perUnit = { res: 1.5, office: 2.5, glass: 2.5, army: 2, gov: 2, shop: 1, plain: 0 };

  function Shapes(K, ox, oz) {
    var sc = K.scene, parts = [];
    function put(m, material, x, y, z) { m.position.set(x - ox, y, z - oz); m.material = material; parts.push(m); return m; }
    var api = {
      parts: parts,
      box: function (w, h, d, material, x, y, z, faceUV) {
        return put(B.MeshBuilder.CreateBox('b', { width: w, height: h, depth: d, faceUV: faceUV, wrap: true }, sc), material, x, y, z);
      },
      cube: function (x0, z0, x1, z1, y0, h, color) {
        return api.box(x1 - x0, h, z1 - z0, K.mat(color), (x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
      },
      cyl: function (rt, rb, h, seg, color, x, y, z) {
        return put(B.MeshBuilder.CreateCylinder('c', { diameterTop: rt * 2, diameterBottom: rb * 2, height: h, tessellation: seg }, sc), K.mat(color), x, y, z);
      },
      // поворот «запекается» в вершины, затем масштаб — как в прежней версии
      bake: function (m, rx, ry, rz) { m.rotation.set(rx || 0, ry || 0, rz || 0); var p = m.position.clone(); m.position.set(0, 0, 0); m.bakeCurrentTransformIntoVertices(); m.position.copyFrom(p); return m; },
      merge: function () {
        var m = B.Mesh.MergeMeshes(parts, true, true, undefined, false, true);
        m.refreshBoundingInfo();
        return m;
      }
    };
    return api;
  }

  function buildModel(K, cat, size, seed) {
    var s = G.sizes[size], W = s.w, D = s.d, m = 0.08;
    var r = rng(seed), S = Shapes(K, W / 2, D / 2);
    function part(x0, z0, x1, z1, y0, h, floors, style, wall, roof, roofType, roofH) {
      var w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
      if (style === 'plain') S.box(w, h, d, K.mat(wall), cx, y0 + h / 2, cz);
      else {
        var uw = Math.max(1, Math.round(w * perUnit[style])), ud = Math.max(1, Math.round(d * perUnit[style])), cap = new B.Vector4(0.02, 0.02, 0.03, 0.03);
        S.box(w, h, d, K.wall(style, wall), cx, y0 + h / 2, cz,
          [new B.Vector4(0, 0, uw, floors), new B.Vector4(0, 0, uw, floors), new B.Vector4(0, 0, ud, floors), new B.Vector4(0, 0, ud, floors), cap, cap]);
      }
      if (roofType === 'hip') {
        var cone = B.MeshBuilder.CreateCylinder('r', { diameterTop: 0, diameterBottom: Math.SQRT2, height: 1, tessellation: 4 }, K.scene);
        cone.material = K.mat(roof);
        S.bake(cone, 0, Math.PI / 4, 0);
        cone.convertToFlatShadedMesh();
        cone.scaling.set(w * 1.12, roofH, d * 1.12);
        cone.position.set(cx - W / 2, y0 + h + roofH / 2, cz - D / 2);
        S.parts.push(cone);
      } else if (roofType === 'flat') {
        S.box(w + 0.04, 0.05, d + 0.04, K.mat(roof), cx, y0 + h + 0.025, cz);
      } else if (roofType === 'none' && style !== 'plain') {
        S.box(w, 0.01, d, K.mat(roof), cx, y0 + h + 0.005, cz);
      }
    }
    var cube = S.cube;
    function flag(x, y, z, color) {
      S.cyl(0.015, 0.015, 0.6, 6, '#c9ccd1', x, y + 0.3, z);
      S.box(0.26, 0.15, 0.01, K.mat(color || '#19a7c9'), x + 0.14, y + 0.51, z);
    }
    function tree(x, z, sc) {
      sc = sc || 1;
      S.cyl(0.03 * sc, 0.04 * sc, 0.2 * sc, 6, '#7a5634', x, 0.1 * sc, z);
      S.cyl(0, 0.17 * sc, 0.42 * sc, 7, '#3f8f46', x, 0.38 * sc, z);
    }
    function cross(x, y, z, color, flat) {
      if (flat) { cube(x - 0.25, z - 0.07, x + 0.25, z + 0.07, y, 0.03, color); cube(x - 0.07, z - 0.25, x + 0.07, z + 0.25, y, 0.03, color); }
      else { cube(x - 0.1, z - 0.012, x + 0.1, z + 0.012, y - 0.03, 0.06, color); cube(x - 0.03, z - 0.012, x + 0.03, z + 0.012, y - 0.1, 0.2, color); }
    }
    var F = [m, m, W - m, D - m];

    if (cat === 'res') {
      var wall = pick(r, RES_WALL), roof = pick(r, RES_ROOF);
      if (size === '1x1') { part(F[0], F[1], F[2], F[3], 0, 0.5, 1, 'res', wall, roof, 'hip', 0.38); cube(0.62, 0.3, 0.72, 0.4, 0.55, 0.35, '#8a6b5a'); }
      else if (size === '2x1') { part(F[0], F[1], F[2], F[3], 0, 0.55, 1, 'res', wall, roof, 'hip', 0.42); cube(1.45, 0.35, 1.56, 0.46, 0.6, 0.35, '#8a6b5a'); tree(0.25, 0.85, 0.6); }
      else if (size === '2x2') { part(F[0], F[1], F[2], F[3], 0, 1.5, 5, 'res', wall, roof, 'flat'); cube(0.4, 0.4, 0.75, 0.75, 1.55, 0.2, '#b9b2a6'); }
      else {
        part(m, m, W - m, 1.7, 0, 1.8, 6, 'res', wall, roof, 'flat');
        part(m, 1.7, 1.7, D - m, 0, 1.8, 6, 'res', pick(r, RES_WALL), roof, 'flat');
        part(2.3, 2.3, W - m, D - m, 0, 3.0, 10, 'res', wall, roof, 'flat');
        cube(1.75, 1.75, 3.92, 2.25, 0, 0.02, '#7fb25e'); cube(1.75, 2.25, 2.25, 3.92, 0, 0.02, '#7fb25e');
        tree(2.0, 3.4); tree(2.0, 2.6, 0.8); tree(3.2, 2.0, 0.9);
      }
    } else if (cat === 'social') {
      if (size === '1x1') { part(F[0], F[1], F[2], F[3], 0, 0.5, 1, 'shop', '#f3f0e6', '#9aa7ad', 'flat'); cross(0.5, 0.42, D - m + 0.015, '#2fa64a'); }
      else if (size === '2x1') {
        part(F[0], F[1], F[2], F[3], 0, 0.5, 1, 'res', '#fff1c9', '#e5664d', 'hip', 0.35);
        cube(0.15, 0.78, 0.45, 0.92, 0, 0.05, '#f2d16b');
      } else if (size === '2x2') {
        part(m, m, W - m, 1.25, 0, 0.95, 3, 'res', '#efe0c8', '#7a8d99', 'flat');
        part(m, 1.25, 1.05, D - m, 0, 0.7, 2, 'office', '#e9d6b8', '#7a8d99', 'flat');
        cube(1.15, 1.35, 1.92, 1.92, 0, 0.02, '#c9725a'); flag(1.85, 0.97, 0.15);
      } else {
        part(F[0], F[1], F[2], F[3], 0, 0.7, 2, 'office', '#f4f6f7', '#9aa7ad', 'flat');
        part(0.6, 0.8, 3.4, 3.2, 0.7, 1.6, 5, 'res', '#f4f6f7', '#b5c0c6', 'flat');
        cross(2.0, 2.35, 2.0, '#e03b3b', true);
        cube(0.3, D - m - 0.02, 1.0, D - m + 0.25, 0, 0.35, '#e03b3b');
      }
    } else if (cat === 'gov') {
      if (size === '1x1') { part(F[0], F[1], F[2], F[3], 0, 0.5, 1, 'gov', '#e8e3d2', '#3a6ea5', 'hip', 0.3); cube(0.75, D - m, 0.86, D - m + 0.1, 0, 0.22, '#2f6fc2'); }
      else if (size === '2x1') {
        part(F[0], F[1], F[2], F[3], 0, 0.75, 2, 'office', '#e3e7ee', '#7d8794', 'flat');
        cube(m - 0.01, m - 0.01, W - m + 0.01, D - m + 0.01, 0.33, 0.06, '#2c5aa0');
        flag(1.8, 0.8, 0.2);
      } else if (size === '2x2') {
        part(m, m, W - m, D - 0.45, 0, 1.0, 3, 'gov', '#e6e2d6', '#8c949e', 'flat');
        for (var i = 0; i < 5; i++) S.cyl(0.045, 0.05, 0.9, 10, '#f5f2ea', 0.25 + i * 0.375, 0.45, D - 0.22);
        cube(m, D - 0.45, W - m, D - m, 0.9, 0.12, '#e6e2d6');
        cube(m, D - 0.45, W - m, D - m + 0.04, 0, 0.05, '#cfcabd');
        flag(1.0, 1.05, 0.8);
      } else {
        part(F[0], F[1], F[2], F[3], 0, 0.8, 2, 'gov', '#ece6d6', '#8c949e', 'flat');
        part(0.8, 0.6, 3.2, 3.0, 0.8, 1.4, 4, 'gov', '#f1ebdc', '#8c949e', 'flat');
        var dome = B.MeshBuilder.CreateSphere('d', { diameter: 1.1, segments: 12, slice: 0.5 }, K.scene);
        dome.material = K.mat('#3f8fbf'); dome.position.set(2.0 - W / 2, 2.25, 1.8 - D / 2); S.parts.push(dome);
        flag(2.0, 2.8, 1.8);
        for (var j = 0; j < 6; j++) S.cyl(0.05, 0.055, 0.75, 10, '#fbf8f0', 0.9 + j * 0.44, 0.4, D - 0.02);
        cube(0.7, D - 0.1, 3.3, D - 0.0, 0.76, 0.1, '#ece6d6');
      }
    } else if (cat === 'army') {
      var aw = '#7d8b5a', ar = '#58623f';
      if (size === '1x1') {
        part(0.3, 0.3, 0.72, 0.72, 0, 0.45, 1, 'army', aw, ar, 'flat');
        cube(0.15, 0.82, 0.95, 0.86, 0.22, 0.04, '#e25b4a'); cube(0.12, 0.78, 0.18, 0.9, 0, 0.25, '#555555');
      } else if (size === '2x1') {
        part(F[0], F[1], F[2], F[3], 0, 0.7, 2, 'army', '#c9c2a0', ar, 'flat');
        cube(m - 0.01, m - 0.01, W - m + 0.01, D - m + 0.01, 0.05, 0.08, aw);
        flag(1.75, 0.75, 0.25, '#2f6b3a');
      } else if (size === '2x2') {
        part(m, 0.18, W - m, 0.92, 0, 0.55, 1, 'army', aw, ar, 'hip', 0.2);
        part(m, 1.1, W - m, 1.84, 0, 0.55, 1, 'army', aw, ar, 'hip', 0.2);
        flag(0.15, 0, 1.0, '#2f6b3a');
      } else {
        var fc = '#6b6b5e', fh = 0.18, ft = 0.04;
        cube(m, m, W - m, m + ft, 0, fh, fc); cube(m, D - m - ft, W - m, D - m, 0, fh, fc);
        cube(m, m, m + ft, D - m, 0, fh, fc); cube(W - m - ft, m, W - m, 1.6, 0, fh, fc); cube(W - m - ft, 2.4, W - m, D - m, 0, fh, fc);
        part(0.3, 0.35, 1.8, 1.05, 0, 0.5, 1, 'army', aw, ar, 'hip', 0.18);
        part(0.3, 1.35, 1.8, 2.05, 0, 0.5, 1, 'army', aw, ar, 'hip', 0.18);
        part(2.2, 0.35, 3.7, 1.75, 0, 0.8, 1, 'plain', '#8a9465', '#6c7650', 'flat');
        cube(2.2, 2.2, 3.7, 3.7, 0, 0.02, '#9e9e94');
        // танк
        cube(2.65, 2.75, 3.25, 3.15, 0.02, 0.16, '#4e5a35'); cube(2.8, 2.82, 3.1, 3.08, 0.18, 0.1, '#5b6840');
        S.bake(S.cyl(0.02, 0.02, 0.38, 6, '#3f4a2b', 2.95, 0.24, 2.72), Math.PI / 2, 0, 0);
        // вышка
        cube(0.35, 3.25, 0.65, 3.55, 0, 1.0, '#6c6a5a'); cube(0.25, 3.15, 0.75, 3.65, 1.0, 0.25, aw); cube(0.22, 3.12, 0.78, 3.68, 1.25, 0.04, ar);
        flag(1.2, 0, 2.8, '#2f6b3a');
      }
    } else if (cat === 'corp') {
      if (size === '1x1') {
        part(F[0], F[1], F[2], F[3], 0, 0.5, 1, 'shop', '#f6d9a0', '#8d8d8d', 'flat');
        S.bake(cube(0.12, D - m, 0.88, D - m + 0.16, 0.4, 0.03, '#d9534f'), 0.25, 0, 0);
      } else if (size === '2x1') {
        part(F[0], F[1], F[2], F[3], 0, 1.3, 4, 'office', '#cfd8e3', '#7b8794', 'flat');
        cube(0.3, 0.3, 0.55, 0.55, 1.35, 0.12, '#a9b1b9'); cube(1.3, 0.35, 1.6, 0.6, 1.35, 0.12, '#a9b1b9');
      } else if (size === '2x2') {
        part(F[0], F[1], F[2], F[3], 0, 2.8, 9, 'glass', '#2f5f93', '#5c6b7a', 'flat');
        cube(0.6, 0.6, 1.4, 1.4, 2.85, 0.25, '#8695a5');
      } else {
        part(F[0], F[1], F[2], F[3], 0, 0.6, 2, 'glass', '#264b78', '#5c6b7a', 'flat');
        part(0.7, 0.7, 3.3, 3.3, 0.65, 5.2, 17, 'glass', '#2f5f93', '#5c6b7a', 'none');
        part(1.0, 1.0, 3.0, 3.0, 5.85, 0.4, 1, 'plain', '#c7d2dd', '#9aa7b4', 'flat');
        S.cyl(0.02, 0.05, 1.1, 8, '#d0d6dc', 2.0, 6.85, 2.0);
      }
    }
    return S.merge();
  }

  // ---------- Грузовик «Бригада» (зелёный, в стиле 60-х). Смотрит вперёд по +z ----------
  function truckModel(K) {
    var S = Shapes(K, 0, 0);
    var GREEN = '#4f8f3e', DARK = '#3b6e2e', CREAM = '#ece4c8', CHROME = '#d9dcd2', TIRE = '#1c1c1c', WOOD = '#a8844f', GLASS = '#9cc3dd';
    function box(w, h, d, color, x, y, z) { return S.box(w, h, d, K.mat(color), x, y, z); }
    box(0.26, 0.05, 0.86, '#2c2c2a', 0, 0.12, -0.02);                                   // рама
    [[0.15, 0.27], [-0.15, 0.27], [0.15, -0.25], [-0.15, -0.25]].forEach(function (p) {   // колёса с белыми колпаками
      S.bake(S.cyl(0.075, 0.075, 0.06, 14, TIRE, p[0], 0.075, p[1]), 0, 0, Math.PI / 2);
      S.bake(S.cyl(0.035, 0.035, 0.064, 10, CHROME, p[0], 0.075, p[1]), 0, 0, Math.PI / 2);
    });
    [0.15, -0.15].forEach(function (x) { box(0.08, 0.03, 0.2, DARK, x, 0.17, 0.27); });  // крылья над передними колёсами
    box(0.22, 0.1, 0.22, GREEN, 0, 0.2, 0.33);                                            // капот
    var hood = S.bake(S.cyl(0.11, 0.11, 0.22, 14, GREEN, 0, 0.25, 0.33), Math.PI / 2, 0, 0); hood.scaling.set(1, 0.5, 1);
    box(0.15, 0.08, 0.012, CHROME, 0, 0.2, 0.445);                                        // решётка, бампер, фары
    for (var i = 0; i < 3; i++) box(0.15, 0.008, 0.016, '#7b7e78', 0, 0.175 + i * 0.025, 0.446);
    box(0.32, 0.03, 0.035, CHROME, 0, 0.12, 0.46);
    [0.085, -0.085].forEach(function (x) { S.bake(S.cyl(0.028, 0.028, 0.02, 12, '#fff4c2', x, 0.245, 0.447), Math.PI / 2, 0, 0); });
    box(0.3, 0.2, 0.2, GREEN, 0, 0.3, 0.12);                                              // кабина
    box(0.31, 0.035, 0.21, CREAM, 0, 0.418, 0.12);
    box(0.24, 0.085, 0.012, GLASS, 0, 0.345, 0.222);
    box(0.304, 0.075, 0.12, GLASS, 0, 0.345, 0.125);
    box(0.302, 0.02, 0.202, CREAM, 0, 0.27, 0.12);
    box(0.32, 0.03, 0.42, WOOD, 0, 0.17, -0.21);                                          // кузов
    box(0.02, 0.1, 0.42, WOOD, 0.15, 0.23, -0.21); box(0.02, 0.1, 0.42, WOOD, -0.15, 0.23, -0.21);
    box(0.32, 0.1, 0.02, WOOD, 0, 0.23, -0.41); box(0.32, 0.13, 0.02, DARK, 0, 0.245, 0.0);
    box(0.322, 0.012, 0.422, '#7d6136', 0, 0.255, -0.21);
    box(0.18, 0.07, 0.14, '#b5563c', -0.04, 0.22, -0.13);                                 // кирпич и доски
    box(0.08, 0.04, 0.33, '#e0c48a', 0.08, 0.205, -0.22);
    box(0.04, 0.02, 0.3, '#f0b23c', -0.07, 0.28, -0.26);                                  // стремянка
    return S.merge();
  }

  // ---------- Пачки (thin instances): одна сетка — много копий ----------
  var batches = {}, dirtyBatches = {};
  var tmpM = B.Matrix.Identity(), tmpQ = new B.Quaternion(), tmpS = new B.Vector3(), tmpT = new B.Vector3();
  function getBatch(k, make) {
    var bt = batches[k];
    if (bt) return bt;
    var mesh = make();
    mesh.isPickable = false; mesh.receiveShadows = true; mesh.alwaysSelectAsActiveMesh = true;
    mesh.setEnabled(false);
    shadowGen.addShadowCaster(mesh, false);
    bt = batches[k] = { key: k, mesh: mesh, h: mesh.getBoundingInfo().boundingBox.maximumWorld.y, ids: [], at: {}, buf: new Float32Array(16 * 8) };
    return bt;
  }
  function batchSet(bt, id, x, y, z, yaw, sx, sy, sz, roll) {
    var i = bt.at[id];
    if (i === undefined) {
      i = bt.at[id] = bt.ids.length; bt.ids.push(id);
      if (bt.buf.length < bt.ids.length * 16) { var nb = new Float32Array(bt.buf.length * 2); nb.set(bt.buf); bt.buf = nb; }
    }
    B.Quaternion.FromEulerAnglesToRef(0, yaw, roll || 0, tmpQ);
    tmpS.set(sx, sy, sz); tmpT.set(x, y, z);
    B.Matrix.ComposeToRef(tmpS, tmpQ, tmpT, tmpM);
    tmpM.copyToArray(bt.buf, i * 16);
    dirtyBatches[bt.key] = bt;
  }
  function batchRemove(bt, id) {
    var i = bt.at[id]; if (i === undefined) return;
    var last = bt.ids.length - 1, lid = bt.ids[last];
    if (i !== last) { bt.buf.copyWithin(i * 16, last * 16, last * 16 + 16); bt.ids[i] = lid; bt.at[lid] = i; }
    bt.ids.pop(); delete bt.at[id];
    dirtyBatches[bt.key] = bt;
  }
  function flushBatches() {
    for (var k in dirtyBatches) {
      var bt = dirtyBatches[k], n = bt.ids.length;
      if (n) {
        bt.mesh.thinInstanceSetBuffer('matrix', bt.buf.subarray(0, n * 16), 16, false);
        bt.mesh.setEnabled(true);
      } else bt.mesh.setEnabled(false);
    }
    dirtyBatches = {};
  }

  // Вариант модели: у жилых — 6 расцветок, у остальных — одна.
  var RES_VARIANTS = 6;
  function variantOf(cat, seed) { return cat === 'res' ? (seed >>> 0) % RES_VARIANTS : 0; }
  function modelSeed(cat, v) { return cat === 'res' ? 9001 + v * 7919 : 1; }
  function tplKey(cat, size, seed) { return cat + '|' + size + '|' + variantOf(cat, seed); }
  function buildingBatch(b) {
    var v = variantOf(b.cat, b.seed);
    return getBatch(tplKey(b.cat, b.size, b.seed), function () { return buildModel(kit, b.cat, b.size, modelSeed(b.cat, v)); });
  }

  // ---------- Карта: земля, сетка, рамка, «срез» земли для изометрии ----------
  var mapNodes = [];
  var groundMat = kit.mat('#8cc068'), outerMat = kit.mat('#6f9a52'), frameMat = kit.mat('#c9b78f');
  var outerGround = null, slab = null, slabHD = null, gridMesh = null, groundMesh = null;
  function buildMapScene() {
    if (slabHD && slabHD.material) { slabHD.material.diffuseTexture.dispose(); slabHD.material.dispose(); }
    mapNodes.forEach(function (o) { o.dispose(); }); mapNodes = [];
    var ground = groundMesh = B.MeshBuilder.CreateGround('ground', { width: N, height: N }, scene);
    ground.material = groundMat; ground.receiveShadows = true; ground.isPickable = false; mapNodes.push(ground);
    outerGround = B.MeshBuilder.CreateGround('outer', { width: N * 6, height: N * 6 }, scene);
    outerGround.position.y = -0.03; outerGround.material = outerMat; outerGround.receiveShadows = true; outerGround.isPickable = false; mapNodes.push(outerGround);
    // Срез земли под картой (видно в изометрии, как в SimCity 2000): трава, земля, камень.
    slab = new B.TransformNode('slab', scene); mapNodes.push(slab);
    [['#7b5a3c', 0.9, -0.47], ['#5e4632', 0.7, -1.27], ['#4a4a4f', 0.5, -1.87]].forEach(function (L) {
      var s = B.MeshBuilder.CreateBox('slab', { width: N, height: L[1], depth: N }, scene);
      s.position.y = L[2]; s.material = kit.mat(L[0]); s.isPickable = false; s.parent = slab;
    });
    // Срез для «ИЗО HD»: один блок с нарисованными слоями — дёрн, земля с камнями, глина, скала.
    slabHD = B.MeshBuilder.CreateBox('slabHD', { width: N, height: 2.12, depth: N }, scene);
    slabHD.position.y = -1.06 - 0.001; slabHD.isPickable = false; slabHD.material = hdMats().slab(N); mapNodes.push(slabHD);
    var lines = [], h = N / 2;
    for (var i = 0; i <= N; i++) {
      lines.push([new B.Vector3(-h + i, 0.006, -h), new B.Vector3(-h + i, 0.006, h)]);
      lines.push([new B.Vector3(-h, 0.006, -h + i), new B.Vector3(h, 0.006, -h + i)]);
    }
    var grid = B.MeshBuilder.CreateLineSystem('grid', { lines: lines }, scene);
    grid.color = hex('#2d4a22'); grid.alpha = N > 80 ? 0.16 : 0.22; grid.isPickable = false; grid.applyFog = false; mapNodes.push(grid);
    gridMesh = grid;
    var t = 0.25, fh = 0.12;
    [[0, -N / 2 - t / 2, N + 2 * t, t], [0, N / 2 + t / 2, N + 2 * t, t], [-N / 2 - t / 2, 0, t, N], [N / 2 + t / 2, 0, t, N]].forEach(function (a) {
      var e = B.MeshBuilder.CreateBox('frame', { width: a[2], height: fh, depth: a[3] }, scene);
      e.position.set(a[0], fh / 2 - 0.02, a[1]); e.material = frameMat; e.receiveShadows = true; e.isPickable = false; mapNodes.push(e);
    });
    applyViewScenery();
  }

  function cellCenter(x, z) { return { x: x - N / 2 + 0.5, z: z - N / 2 + 0.5 }; }

  // ---------- Плоские четырёхугольники (дороги, подсветка) ----------
  function flatMat(color, opts) {
    opts = opts || {};
    var m = new B.StandardMaterial('f' + color, scene);
    m.specularColor = B.Color3.Black(); m.backFaceCulling = false;
    if (opts.overlay) { m.disableLighting = true; m.emissiveColor = hex(color); m.alpha = opts.alpha; m.zOffset = -3; m.disableDepthWrite = true; }
    else m.diffuseColor = hex(color);
    return m;
  }
  function quadsMesh(name, quads, material) { // quads: [cx, cz, w, d, y]
    var pos = [], nor = [], uv = [], ind = [];
    quads.forEach(function (q, i) {
      var x0 = q[0] - q[2] / 2, x1 = q[0] + q[2] / 2, z0 = q[1] - q[3] / 2, z1 = q[1] + q[3] / 2, y = q[4];
      pos.push(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
      nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      var o = i * 4; ind.push(o, o + 2, o + 1, o, o + 3, o + 2);
    });
    var m = new B.Mesh(name, scene), vd = new B.VertexData();
    vd.positions = pos; vd.normals = nor; vd.uvs = uv; vd.indices = ind; vd.applyToMesh(m);
    m.material = material; m.isPickable = false;
    return m;
  }

  // ---------- Дороги: куски карты 16×16 клеток, каждый — одна сетка на материал ----------
  var roadMat = {};
  ['asphalt', 'dirt'].forEach(function (t) {
    var c = document.createElement('canvas'); c.width = c.height = 64; var g = c.getContext('2d');
    g.fillStyle = G.roads[t].color; g.fillRect(0, 0, 64, 64);
    var r = rng(t === 'dirt' ? 7 : 3);
    for (var i = 0; i < 260; i++) {
      var v = r(); g.fillStyle = t === 'dirt' ? (v > .5 ? 'rgba(120,90,55,.35)' : 'rgba(200,170,120,.3)') : (v > .5 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.07)');
      g.fillRect(r() * 64, r() * 64, 2, 2);
    }
    var m = flatMat('#ffffff'), tx = new B.DynamicTexture('road' + t, c, scene, true); tx.update();
    m.diffuseTexture = tx; roadMat[t] = m;
  });
  roadMat.line = flatMat('#f1f1e6'); roadMat.curb = flatMat('#c4c4bc'); roadMat.rut = flatMat('#8a6a44');
  var CH = 16, chunks = {}, dirtyChunks = {};
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function markRoad(x, z) { dirtyChunks[Math.floor(x / CH) + ',' + Math.floor(z / CH)] = 1; }
  function buildChunk(ck) {
    (chunks[ck] || []).forEach(function (m) { m.dispose(); }); chunks[ck] = [];
    var p = ck.split(','), X0 = +p[0] * CH, Z0 = +p[1] * CH, Q = { asphalt: [], dirt: [], line: [], curb: [], rut: [] };
    for (var z = Z0; z < Z0 + CH; z++) for (var x = X0; x < X0 + CH; x++) {
      var t = state.roads[key(x, z)]; if (!t || !inMap(x, z)) continue;
      var c = cellCenter(x, z);
      Q[t].push([c.x, c.z, 1, 1, 0.012]);
      DIRS.forEach(function (dv) {
        var n = state.roads[key(x + dv[0], z + dv[1])], hx = dv[0] !== 0, sgn = dv[0] + dv[1];
        if (t === 'asphalt') {
          if (n === 'asphalt') Q.line.push(hx ? [c.x + sgn * 0.3, c.z, 0.22, 0.05, 0.016] : [c.x, c.z + sgn * 0.3, 0.05, 0.22, 0.016]);
          else if (!n) Q.curb.push(hx ? [c.x + sgn * 0.46, c.z, 0.08, 1, 0.018] : [c.x, c.z + sgn * 0.46, 1, 0.08, 0.018]);
        } else if (n) {
          Q.rut.push(hx ? [c.x + sgn * 0.25, c.z - 0.18, 0.5, 0.06, 0.015] : [c.x - 0.18, c.z + sgn * 0.25, 0.06, 0.5, 0.015]);
          Q.rut.push(hx ? [c.x + sgn * 0.25, c.z + 0.18, 0.5, 0.06, 0.015] : [c.x + 0.18, c.z + sgn * 0.25, 0.06, 0.5, 0.015]);
        }
      });
    }
    Object.keys(Q).forEach(function (k) {
      if (!Q[k].length) return;
      var m = quadsMesh('road', Q[k], roadMat[k]); m.receiveShadows = true; chunks[ck].push(m);
    });
  }
  function flushRoads() { for (var ck in dirtyChunks) buildChunk(ck); dirtyChunks = {}; }
  function refreshRoadAround(x, z) { markRoad(x, z); DIRS.forEach(function (d) { markRoad(x + d[0], z + d[1]); }); }

  // ---------- Здания и стройплощадки на сцене ----------
  var placed = {}, sites = {}; // id -> batch; id -> узел стройки
  function bPos(b) { var f = foot(b.size, b.rot); return { x: b.x + f.w / 2 - N / 2, z: b.z + f.d / 2 - N / 2, yaw: -b.rot * Math.PI / 2 }; }
  function writeBuilding(b) {
    var bt = placed[b.id]; if (!bt) return;
    var p = bPos(b), hide = moving && moving.b.id === b.id;
    var sy = isSite(b) ? Math.max(0.04, clamp(b.prog, 0, 1)) : 1;
    if (hide) batchSet(bt, b.id, p.x, -50, p.z, p.yaw, 0.001, 0.001, 0.001);
    else batchSet(bt, b.id, p.x, 0, p.z, p.yaw, 1, sy, 1);
    var st = sites[b.id];
    if (st) { st.node.position.set(p.x, 0, p.z); st.node.rotation.y = p.yaw; st.node.setEnabled(!hide); }
    dirty();
  }
  function addSiteParts(b) {
    var s = G.sizes[b.size], W = s.w, D = s.d, node = new B.TransformNode('site' + b.id, scene), S = Shapes(kit, 0, 0), e = 0.03;
    S.box(W - 0.1, 0.04, D - 0.1, kit.mat('#a39d92'), 0, 0.02, 0);                   // фундамент
    S.box(W - 0.02, 0.05, e, kit.mat('#ff8a1f'), 0, 0.13, -D / 2 + e); S.box(W - 0.02, 0.05, e, kit.mat('#ff8a1f'), 0, 0.13, D / 2 - e);
    S.box(e, 0.05, D - 0.02, kit.mat('#ff8a1f'), -W / 2 + e, 0.13, 0); S.box(e, 0.05, D - 0.02, kit.mat('#ff8a1f'), W / 2 - e, 0.13, 0);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) { S.box(0.04, 0.18, 0.04, kit.mat('#f2f2ea'), c[0] * (W / 2 - e), 0.09, c[1] * (D / 2 - e)); });
    var fence = S.merge(); fence.parent = node; fence.receiveShadows = true; fence.isPickable = false;
    var bw = Math.min(W, 2.4) * 0.8, bar = new B.TransformNode('bar', scene); bar.parent = node;
    var bg = B.MeshBuilder.CreateBox('bbg', { width: bw + 0.08, height: 0.11, depth: 0.11 }, scene); bg.material = kit.mat('#26303d'); bg.parent = bar;
    var fill = B.MeshBuilder.CreateBox('bfill', { width: bw, height: 0.075, depth: 0.13 }, scene);
    fill.setPivotPoint(new B.Vector3(-bw / 2, 0, 0)); fill.material = kit.mat('#5fd35a'); fill.parent = bar;
    [bg, fill].forEach(function (m) { m.isPickable = false; });
    sites[b.id] = { node: node, fill: fill, bar: bar };
  }
  function updateSite(b) {
    var st = sites[b.id]; if (!st) return;
    var p = clamp(b.prog, 0, 1), sy = Math.max(0.04, p), h = Math.max(0.45, placed[b.id].h);
    st.fill.scaling.x = Math.max(0.001, p);
    st.bar.position.y = h * sy + 0.35;
    writeBuilding(b);
  }
  function addBuildingMesh(b) {
    byId[b.id] = b;
    placed[b.id] = buildingBatch(b);
    if (isSite(b)) { addSiteParts(b); updateSite(b); }
    writeBuilding(b);
  }
  function removeBuildingMesh(id) {
    if (placed[id]) { batchRemove(placed[id], id); delete placed[id]; }
    if (sites[id]) { sites[id].node.dispose(); delete sites[id]; }
    dirty();
  }

  // ---------- Бригады ----------
  function truckBatch() { return getBatch('truck', function () { return truckModel(kit); }); }
  function writeTruck(br, bob, roll) { batchSet(truckBatch(), br.id, br.x, bob || 0, br.z, br.yaw || 0, 0.78, 0.78, 0.78, roll || 0); }
  function parkSpot(i, n) { n = n || N; return { x: ((i % 6) - 2.5) * 0.9, z: n / 2 - 0.9 - Math.floor(i / 6) * 0.9 }; }
  function siteCenter(b) { var f = foot(b.size, b.rot); return { x: b.x + f.w / 2 - N / 2, z: b.z + f.d / 2 - N / 2 }; }
  // k-я машина на объекте встаёт вдоль сторон участка
  function slotPos(b, k) {
    var f = foot(b.size, b.rot), c = siteCenter(b);
    var sides = [[0, 1, f.w, f.d], [1, 0, f.d, f.w], [0, -1, f.w, f.d], [-1, 0, f.d, f.w]];
    for (var lap = 0; lap < 30; lap++) for (var s = 0; s < 4; s++) {
      var sd = sides[s], len = sd[2], cap = Math.max(1, Math.floor(len / 0.75));
      if (k < cap) {
        var t = -len / 2 + (k + 0.5) * len / cap, out = sd[3] / 2 + 0.38 + lap * 0.62;
        return { x: c.x + sd[0] * out + (sd[1] !== 0 ? t : 0), z: c.z + sd[1] * out + (sd[0] !== 0 ? t : 0), yaw: sd[0] !== 0 ? 0 : Math.PI / 2 };
      }
      k -= cap;
    }
    return { x: c.x, z: c.z, yaw: 0 };
  }
  // Бригады делятся между стройками поровну; уже работающие остаются на своём объекте.
  function assignBrigades() {
    var S = state.buildings.filter(isSite), n = state.brigades.length;
    if (!S.length) { state.brigades.forEach(function (br) { if (br.site) { br.park = { x: br.x, z: br.z }; } br.site = 0; }); return; }
    var want = {}, have = {};
    S.forEach(function (s, i) { want[s.id] = Math.floor(n / S.length) + (i < n % S.length ? 1 : 0); have[s.id] = 0; });
    var free = [];
    state.brigades.forEach(function (br) {
      if (br.site && want[br.site] !== undefined && have[br.site] < want[br.site]) have[br.site]++;
      else free.push(br);
    });
    free.forEach(function (br) {
      var best = 0, bd = 1e9;
      S.forEach(function (s) {
        if (have[s.id] >= want[s.id]) return;
        var c = siteCenter(s), d = Math.hypot(c.x - br.x, c.z - br.z);
        if (d < bd) { bd = d; best = s.id; }
      });
      br.site = best; if (best) have[best]++;
    });
  }
  function siteCrew(id) {
    var all = 0, here = 0;
    state.brigades.forEach(function (br) { if (br.site === id) { all++; if (br.work) here++; } });
    return { all: all, here: here };
  }
  function rebuildTrucks() {
    var bt = truckBatch();
    bt.ids.slice().forEach(function (id) { batchRemove(bt, id); });
    state.brigades.forEach(function (br) { writeTruck(br); });
    dirty();
  }
  function buyBrigade() {
    var u = G.units.brigade;
    if (!canPay(u.price)) { hint('Не хватает долларов на бригаду', true); return; }
    pay(u.price);
    var i = state.brigades.length, p = parkSpot(i);
    var br = { id: state.nextBr++, x: p.x, z: N / 2 + 1.6, yaw: Math.PI, park: p, site: 0 };
    state.brigades.push(br); writeTruck(br); dirty();
    assignBrigades(); save(); refreshNeed(); renderMech();
    hint(state.buildings.some(isSite) ? '🚚 Бригада выехала на стройку' : '🚚 Бригада куплена — теперь можно строить');
  }
  function sellBrigade() {
    if (!state.brigades.length) return;
    var j = state.brigades.length - 1;
    for (var i = state.brigades.length - 1; i >= 0; i--) if (!state.brigades[i].site) { j = i; break; } // сначала свободную
    var br = state.brigades.splice(j, 1)[0];
    batchRemove(truckBatch(), br.id);
    state.spent -= Math.round(G.units.brigade.price / 2); updateMoney();
    assignBrigades(); save(); refreshNeed(); renderMech(); dirty();
    hint('Бригада продана, вернули ' + usd(G.units.brigade.price / 2));
  }
  function angTo(a, b, k) { return a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * k; }
  // Шаг анимации: машины едут к объектам, стройка растёт. Возвращает true, если что-то двигалось.
  function tickBrigades(dt, t) {
    if (!state.brigades.length) return false;
    var any = false, perSite = {}, arrived = {}, u = G.units.brigade;
    state.brigades.forEach(function (br) {
      var b = br.site ? getB(br.site) : null, tgt = null, atSite = false;
      if (b && isSite(b)) { var k = perSite[b.id] || 0; perSite[b.id] = k + 1; tgt = slotPos(b, k); atSite = true; }
      else if (br.park) tgt = { x: br.park.x, z: br.park.z, yaw: br.yaw };
      var was = br.work, moved = false;
      br.work = false;
      if (tgt) {
        var dx = tgt.x - br.x, dz = tgt.z - br.z, d = Math.hypot(dx, dz);
        if (d > 0.02) {
          var v = Math.max(u.speed, d / 3), st = Math.min(d, v * dt);
          br.x += dx / d * st; br.z += dz / d * st;
          br.yaw = angTo(br.yaw || 0, Math.atan2(dx, dz), Math.min(1, dt * 10)); moved = true;
        } else {
          br.x = tgt.x; br.z = tgt.z;
          if (Math.abs(Math.atan2(Math.sin(tgt.yaw - br.yaw), Math.cos(tgt.yaw - br.yaw))) > 0.01) { br.yaw = angTo(br.yaw, tgt.yaw, Math.min(1, dt * 8)); moved = true; }
          if (atSite) { br.work = true; arrived[b.id] = (arrived[b.id] || 0) + 1; moved = true; }
        }
      }
      if (moved || was) {
        writeTruck(br, br.work ? Math.abs(Math.sin(t * 0.012 + br.id * 1.7)) * 0.012 : 0, br.work ? Math.sin(t * 0.02 + br.id) * 0.02 : 0);
        any = true;
      }
    });
    var done = [];
    state.buildings.forEach(function (b) {
      var a = arrived[b.id]; if (!a || !isSite(b)) return;
      b.prog = Math.min(1, b.prog + dt * a * u.power / buildTime(b));
      updateSite(b);
      if (b.prog >= 1) done.push(b);
    });
    done.forEach(finishSite);
    if (any) dirty();
    return any;
  }
  function finishSite(b) {
    delete b.prog;
    removeBuildingMesh(b.id); addBuildingMesh(b);
    assignBrigades(); updateStats(); saveNow();
    if (infoId === b.id) renderInfo(b, true);
    hint('✅ Построено: ' + G.cats[b.cat].names[b.size]);
    renderMech();
  }

  function rebuildAll() {
    if (!mapNodes.length || state.size !== N) { N = state.size; occ = new Int32Array(N * N); buildMapScene(); }
    Object.keys(placed).forEach(function (id) { removeBuildingMesh(+id); });
    byId = {};
    Object.keys(chunks).forEach(function (ck) { chunks[ck].forEach(function (m) { m.dispose(); }); }); chunks = {};
    rebuildOcc();
    state.buildings.forEach(addBuildingMesh);
    Object.keys(state.roads).forEach(function (k) { var p = k.split(','); markRoad(+p[0], +p[1]); });
    rebuildTrucks(); assignBrigades();
    resCache = {}; workCache = {};
    updateStats(); updateMoney(); refreshNeed(); dirty();
  }

  // ---------- Призрак и курсор ----------
  var ghost = null, ghostKey = '';
  var ghostFoot = quadsMesh('gfoot', [[0, 0, 1, 1, 0.03]], flatMat('#4cd964', { overlay: true, alpha: 0.45 }));
  var cursor = quadsMesh('cursor', [[0, 0, 1, 1, 0.035]], flatMat('#ffffff', { overlay: true, alpha: 0.4 }));
  var hl = quadsMesh('hl', [[0, 0, 1, 1, 0.025]], flatMat('#ffc94a', { overlay: true, alpha: 0.55 }));
  [ghostFoot, cursor, hl].forEach(function (m) { m.setEnabled(false); });
  function setOverlay(m, x, z, w, d, color) {
    m.position.set(x, 0, z); m.scaling.set(w, 1, d);
    if (color) m.material.emissiveColor = hex(color);
    m.setEnabled(true); dirty();
  }

  function setGhost(cat, size, seed) {
    var k = tplKey(cat, size, seed);
    if (k === ghostKey && ghost) return;
    if (ghost) { var mm = ghost.material; ghost.dispose(); if (mm) mm.dispose(); ghost = null; }
    ghostKey = k;
    ghost = buildModel(kit, cat, size, modelSeed(cat, variantOf(cat, seed)));
    ghost.visibility = 0.6; ghost.isPickable = false;
    ghost.setEnabled(false);
  }
  function showGhostAt(size, rot, x, z, ok) {
    var b = { size: size, rot: rot, x: x, z: z }, f = foot(size, rot), p = bPos(b);
    ghost.position.set(p.x, 0, p.z); ghost.rotation.y = p.yaw; ghost.setEnabled(true);
    setOverlay(ghostFoot, p.x, p.z, f.w, f.d, ok ? '#4cd964' : '#ff3b30');
  }
  function hideGhost() { if (ghost) ghost.setEnabled(false); ghostFoot.setEnabled(false); dirty(); }
  function showCursor(x, z, color) {
    if (!inMap(x, z)) { cursor.setEnabled(false); dirty(); return; }
    var c = cellCenter(x, z); setOverlay(cursor, c.x, c.z, 1, 1, color);
  }

  // ---------- Камера: 3D и изометрия ----------
  var ISO_PITCH = Math.PI / 6; // 30° — пропорция клетки 2:1, как в SimCity 2000
  var view = 'persp';
  try { var sv = localStorage.getItem(VIEW_KEY); if (sv === 'iso' || sv === 'isohd') view = sv; } catch (e) {}
  var cam = { tx: 0, tz: 2, dist: 34, yaw: Math.PI / 4, pitch: 0.95, yawGoal: null };
  function isIso() { return view !== 'persp'; }   // обе изометрии: «ИЗО» (пиксели) и «ИЗО HD»
  function isHD() { return view === 'isohd'; }
  function snapYaw(y) { var q = Math.PI / 2; return Math.round((y - Math.PI / 4) / q) * q + Math.PI / 4; }
  function camHome() {
    cam.tx = 0; cam.tz = 2; cam.yaw = Math.PI / 4; cam.pitch = isIso() ? ISO_PITCH : 0.95; cam.yawGoal = null;
    cam.dist = clamp(N * 0.72, 24, 90) * (window.innerWidth < window.innerHeight ? 1.3 : 1);
    updateCam();
  }
  function aspect() { return engine.getRenderWidth() / Math.max(1, engine.getRenderHeight()); }
  function updateCam() {
    cam.dist = clamp(cam.dist, 5, Math.max(80, N * 1.3));
    cam.pitch = isIso() ? ISO_PITCH : clamp(cam.pitch, 0.35, 1.45);
    cam.tx = clamp(cam.tx, -N / 2, N / 2); cam.tz = clamp(cam.tz, -N / 2, N / 2);
    var cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), dx = cp * Math.sin(cam.yaw), dz = cp * Math.cos(cam.yaw);
    var halfH = cam.dist * Math.tan(camera.fov / 2), ext;
    if (isIso()) {
      // Ортографическая камера: дальние дома не уменьшаются, все линии параллельны.
      var far = N * 2 + 60;
      camera.mode = B.Camera.ORTHOGRAPHIC_CAMERA;
      camera.orthoTop = halfH; camera.orthoBottom = -halfH;
      camera.orthoLeft = -halfH * aspect(); camera.orthoRight = halfH * aspect();
      camera.position.set(cam.tx + far * dx, far * sp, cam.tz + far * dz);
      camera.minZ = 1; camera.maxZ = far * 2.5;
      ext = halfH * Math.max(1, aspect()) * 1.6;
      if (hdState && hdState.ssao) hdState.ssao.maxZ = camera.maxZ;
    } else {
      camera.mode = B.Camera.PERSPECTIVE_CAMERA;
      camera.position.set(cam.tx + cam.dist * dx, cam.dist * sp, cam.tz + cam.dist * dz);
      camera.minZ = 0.1; camera.maxZ = Math.max(400, cam.dist * 6);
      scene.fogStart = cam.dist * 1.6 + 15; scene.fogEnd = cam.dist * 3.2 + 60;
      ext = clamp(cam.dist * 1.1, 18, 70);
    }
    camera.setTarget(new B.Vector3(cam.tx, 0, cam.tz));
    // солнце и тени следуют за камерой
    sun.position.set(cam.tx + SUN_OFF.x * 2, SUN_OFF.y * 2, cam.tz + SUN_OFF.z * 2);
    sun.orthoLeft = -ext; sun.orthoRight = ext; sun.orthoTop = ext; sun.orthoBottom = -ext;
    sun.shadowMaxZ = 200 + ext;
    dirty();
  }
  function applyViewScenery() {
    var iso = isIso(), hd = isHD();
    if (outerGround) outerGround.setEnabled(!iso);
    if (slab) slab.setEnabled(iso && !hd);
    if (slabHD) slabHD.setEnabled(hd);
    if (gridMesh) gridMesh.alpha = (N > 80 ? 0.16 : 0.22) * (hd ? 0.35 : iso ? 0.7 : 1);
    scene.fogMode = iso ? B.Scene.FOGMODE_NONE : B.Scene.FOGMODE_LINEAR;
    scene.clearColor = B.Color4.FromHexString((hd ? VOID_HD : iso ? VOID : SKY) + 'ff');
    setShadowStyle(iso);
    setQuality(hd);
    if (groundMesh) {
      var gm = hdMats().grass;
      gm.diffuseTexture.uScale = gm.diffuseTexture.vScale = N / 3; // одна «плитка» травы на 3 клетки
      groundMesh.material = hd ? gm : groundMat;
    }
  }

  // ---------- «ИЗО HD»: та же изометрия, но картинка намного качественнее ----------
  // Полное разрешение экрана, сглаживание (MSAA + FXAA), мягкое затенение углов (SSAO),
  // тени 4096, кинематографичная цветокоррекция (ACES), окна 256 px, трава и срез земли с фактурой.
  var VOID_HD = '#141b27', hdState = null, hdMatCache = null;
  function canvasTex(name, c, uS, vS) {
    var t = new B.DynamicTexture(name, c, scene, true); t.update();
    t.wrapU = t.wrapV = B.Texture.WRAP_ADDRESSMODE; t.anisotropicFilteringLevel = 8;
    t.uScale = uS || 1; t.vScale = vS || 1; return t;
  }
  function hdMats() {
    if (hdMatCache) return hdMatCache;
    // трава: пятна разного оттенка и короткие травинки
    var c = document.createElement('canvas'); c.width = c.height = 256; var g = c.getContext('2d'), r = rng(42);
    g.fillStyle = '#86bd62'; g.fillRect(0, 0, 256, 256);
    for (var i = 0; i < 90; i++) {
      var x = r() * 256, y = r() * 256, rad = 10 + r() * 30;
      var gr = g.createRadialGradient(x, y, 0, x, y, rad), col = r() > 0.5 ? '120,178,84' : '150,196,104';
      gr.addColorStop(0, 'rgba(' + col + ',.3)'); gr.addColorStop(1, 'rgba(' + col + ',0)');
      g.fillStyle = gr;
      [[0, 0], [-256, 0], [256, 0], [0, -256], [0, 256]].forEach(function (o) { g.fillRect(x + o[0] - rad, y + o[1] - rad, rad * 2, rad * 2); });
    }
    for (i = 0; i < 2600; i++) {
      g.fillStyle = r() > 0.55 ? 'rgba(60,110,40,.35)' : 'rgba(205,232,150,.35)';
      g.fillRect(r() * 256, r() * 256, 1, 2 + r() * 3);
    }
    var grass = new B.StandardMaterial('grassHD', scene); grass.specularColor = B.Color3.Black();
    grass.diffuseTexture = canvasTex('grassHDt', c, 1, 1);
    // срез земли
    function slabCanvas() {
      var W = 512, H = 256, s = document.createElement('canvas'); s.width = W; s.height = H; var q = s.getContext('2d'), rr = rng(7);
      var L = [[0, 0.07, '#5f9a43'], [0.07, 0.43, '#7b5a3c'], [0.43, 0.76, '#5e4632'], [0.76, 1, '#4a4a50']];
      L.forEach(function (l, k) {
        var y0 = l[0] * H, y1 = l[1] * H, gr = q.createLinearGradient(0, y0, 0, y1);
        gr.addColorStop(0, shade(l[2], 0.08)); gr.addColorStop(1, shade(l[2], -0.12));
        q.fillStyle = gr; q.fillRect(0, y0, W, y1 - y0 + 1);
        // волнистая граница слоя
        if (k) { q.fillStyle = shade(l[2], -0.2); for (var x = 0; x < W; x += 4) q.fillRect(x, y0 + Math.sin(x / 23 + k) * 3, 4, 3); }
      });
      for (var i = 0; i < 520; i++) { // камешки
        var x = rr() * W, y = (0.1 + rr() * 0.9) * H, w = 2 + rr() * (y > H * 0.76 ? 14 : 6);
        q.fillStyle = y > H * 0.76 ? (rr() > 0.5 ? '#5d5d64' : '#38383d') : (rr() > 0.5 ? 'rgba(160,130,95,.7)' : 'rgba(40,28,18,.5)');
        q.beginPath(); q.ellipse(x, y, w, w * 0.6, 0, 0, Math.PI * 2); q.fill();
      }
      for (i = 0; i < 160; i++) { q.fillStyle = 'rgba(70,120,50,.8)'; q.fillRect(rr() * W, 0.06 * H, 2, 2 + rr() * 6); } // корешки травы
      return s;
    }
    var slabC = slabCanvas();
    hdMatCache = {
      grass: grass,
      slab: function (n) {
        var m = new B.StandardMaterial('slabHD', scene); m.specularColor = B.Color3.Black();
        m.emissiveColor = new B.Color3(0.3, 0.28, 0.26); // срез в тени не должен уходить в черноту
        m.diffuseTexture = canvasTex('slabHDt', slabC, n / 8, -1); // -1: дёрн сверху, скала снизу
        return m;
      }
    };
    return hdMatCache;
  }
  function setQuality(hd) {
    if (!!hdState === hd) return;
    kit.setHD(hd);
    if (hd) {
      var dpr = window.devicePixelRatio || 1;
      hdState = { hemi: hemi.intensity, sun: sun.intensity, sunC: sun.diffuse.clone(), ground: hemi.groundColor.clone() };
      hemi.intensity = 0.7; hemi.groundColor = hex('#66745a');
      sun.intensity = 1.0; sun.diffuse = hex('#fff1d8'); sun.specular = hex('#ffffff');
      shadowGen.getShadowMap().resize(TOUCH ? 2048 : 4096);
      shadowGen.filteringQuality = B.ShadowGenerator.QUALITY_HIGH;
      shadowGen.darkness = 0.04;
      try {
        // мягкие тени в углах и у основания домов
        var ssao = new B.SSAO2RenderingPipeline('ssao', scene, { ssaoRatio: TOUCH ? 0.5 : 1, blurRatio: TOUCH ? 0.5 : 1 }, [camera], true);
        ssao.radius = 0.9; ssao.totalStrength = 1.15; ssao.base = 0.08; ssao.samples = TOUCH ? 8 : 16;
        ssao.expensiveBlur = !TOUCH; ssao.maxZ = 400; ssao.minZAspect = 0.2;
        hdState.ssao = ssao;
      } catch (e) { hdState.ssao = null; }
      var pp = new B.DefaultRenderingPipeline('hd', true, scene, [camera]);
      pp.samples = 4; pp.fxaaEnabled = true;
      pp.imageProcessingEnabled = true;
      var ip = pp.imageProcessing;
      ip.toneMappingEnabled = true; ip.toneMappingType = B.ImageProcessingConfiguration.TONEMAPPING_ACES;
      ip.exposure = 1.32; ip.contrast = 1.18;
      ip.vignetteEnabled = true; ip.vignetteWeight = 2.2; ip.vignetteStretch = 0.4; ip.vignetteColor = new B.Color4(0.02, 0.03, 0.06, 0);
      pp.sharpenEnabled = true; pp.sharpen.edgeAmount = 0.22; pp.sharpen.colorAmount = 1;
      hdState.pp = pp;
    } else {
      // снять эффекты с камеры и убрать их из движка целиком (иначе он пытается обновлять удалённые)
      var pm = scene.postProcessRenderPipelineManager;
      [hdState.pp, hdState.ssao].forEach(function (pl) {
        if (!pl) return;
        try { pm.detachCamerasFromRenderPipeline(pl._name, camera); } catch (e) {}
        try { pl.dispose(); } catch (e) {}
        if (pm.removePipeline) pm.removePipeline(pl._name);
      });
      hemi.intensity = hdState.hemi; hemi.groundColor = hdState.ground;
      sun.intensity = hdState.sun; sun.diffuse = hdState.sunC; sun.specular = B.Color3.Black();
      shadowGen.getShadowMap().resize(2048);
      shadowGen.filteringQuality = B.ShadowGenerator.QUALITY_MEDIUM;
      shadowGen.darkness = 0;
      hdState = null;
    }
    dirty();
  }

  function pixelScale() {
    var dpr = window.devicePixelRatio || 1;
    // «ИЗО»: рисуем в пониженном разрешении и растягиваем без сглаживания — крупные пиксели.
    // «ИЗО HD» и 3D — полное разрешение экрана (до 2× на «ретина»-экранах).
    return view === 'iso' ? (TOUCH ? 1.5 : 2) : 1 / Math.min(dpr, 2);
  }
  var VIEWS = { persp: { btn: '3D', name: '🎥 Вид 3D' }, iso: { btn: 'ИЗО', name: '🧱 Изометрия (пиксели, как в SimCity)' }, isohd: { btn: 'HD', name: '✨ Изометрия HD (качественная картинка)' } };
  var VIEW_ORDER = ['persp', 'iso', 'isohd'];
  function nextView() { return VIEW_ORDER[(VIEW_ORDER.indexOf(view) + 1) % VIEW_ORDER.length]; }
  function setView(v) {
    if (!VIEWS[v]) v = 'persp';
    var wasIso = isIso();
    view = v;
    try { localStorage.setItem(VIEW_KEY, v); } catch (e) {}
    canvas.classList.toggle('iso', v === 'iso'); document.body.classList.toggle('iso', isIso());
    // на кнопке — текущий вид; нажатие переключает по кругу 3D → ИЗО → HD
    $('camMode').textContent = VIEWS[v].btn;
    $('camMode').classList.toggle('hd', v === 'isohd');
    $('camMode').title = 'Вид: ' + VIEWS[v].btn + '. Нажмите — ' + VIEWS[nextView()].btn;
    if (isIso()) { cam.pitch = ISO_PITCH; if (!wasIso) { cam.yaw = snapYaw(cam.yaw); cam.yawGoal = null; } }
    else cam.pitch = 0.95;
    applyViewScenery(); resize();
  }
  function rotateCam(dir) { // dir: +1 влево, -1 вправо
    if (isIso()) { cam.yawGoal = snapYaw((cam.yawGoal === null ? cam.yaw : cam.yawGoal) + dir * Math.PI / 2); }
    else { cam.yaw += dir * Math.PI / 8; updateCam(); }
  }
  function tickCam(dt) {
    if (cam.yawGoal === null) return;
    var d = cam.yawGoal - cam.yaw;
    if (Math.abs(d) < 0.002) { cam.yaw = cam.yawGoal; cam.yawGoal = null; }
    else cam.yaw += d * Math.min(1, dt * 12);
    updateCam();
  }
  function resize() {
    engine.setHardwareScalingLevel(pixelScale());
    engine.resize();
    camera.fov = (window.innerWidth < window.innerHeight ? 55 : 45) * Math.PI / 180;
    updateCam();
  }
  window.addEventListener('resize', resize);

  // Луч из точки экрана: пересечение с землёй и со зданиями (без помощи движка — быстро и на тысячах домов).
  var rayM = B.Matrix.Identity();
  function rayAt(sx, sy) {
    var rc = canvas.getBoundingClientRect();
    return scene.createPickingRay(sx - rc.left, sy - rc.top, rayM, camera, false);
  }
  function groundAt(sx, sy) {
    var r = rayAt(sx, sy);
    if (Math.abs(r.direction.y) < 1e-6) return null;
    var t = -r.origin.y / r.direction.y; if (t < 0) return null;
    return { x: r.origin.x + r.direction.x * t, z: r.origin.z + r.direction.z * t };
  }
  function cellAt(sx, sy) {
    var p = groundAt(sx, sy); if (!p) return null;
    return { x: Math.floor(p.x + N / 2), z: Math.floor(p.z + N / 2), px: p.x + N / 2, pz: p.z + N / 2 };
  }
  function rayBox(o, d, x0, y0, z0, x1, y1, z1) {
    var tmin = -Infinity, tmax = Infinity, a = [o.x, o.y, o.z], v = [d.x, d.y, d.z], lo = [x0, y0, z0], hi = [x1, y1, z1];
    for (var i = 0; i < 3; i++) {
      if (Math.abs(v[i]) < 1e-9) { if (a[i] < lo[i] || a[i] > hi[i]) return -1; continue; }
      var t1 = (lo[i] - a[i]) / v[i], t2 = (hi[i] - a[i]) / v[i];
      if (t1 > t2) { var tt = t1; t1 = t2; t2 = tt; }
      if (t1 > tmin) tmin = t1; if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    return tmax < 0 ? -1 : Math.max(0, tmin);
  }
  function pickBuilding(sx, sy) {
    var r = rayAt(sx, sy), best = null, bt = Infinity;
    state.buildings.forEach(function (b) {
      var f = foot(b.size, b.rot), x0 = b.x - N / 2, z0 = b.z - N / 2, bh = placed[b.id] ? placed[b.id].h : 1;
      var h = isSite(b) ? Math.max(0.2, bh * b.prog) : bh;
      var t = rayBox(r.origin, r.direction, x0 + 0.05, 0, z0 + 0.05, x0 + f.w - 0.05, h, z0 + f.d - 0.05);
      if (t >= 0 && t < bt) { bt = t; best = b; }
    });
    if (best) return best;
    var c = cellAt(sx, sy);
    if (c && inMap(c.x, c.z) && occ[idx(c.x, c.z)]) return getB(occ[idx(c.x, c.z)]);
    return null;
  }
  function originFor(size, rot, c) {
    var f = foot(size, rot);
    return { x: clamp(Math.round(c.px - f.w / 2), 0, N - f.w), z: clamp(Math.round(c.pz - f.d / 2), 0, N - f.d) };
  }

  // ---------- Инструменты ----------
  var tool = 'view', buildCat = 'res', buildSize = '1x1', buildRot = 0, buildSeed = newSeed(), roadType = 'asphalt';
  var moving = null; // {b, offX, offZ, rot, x, z}

  var HINTS = {
    view: TOUCH ? 'Нажмите на здание — справка. Два пальца — масштаб и поворот.' : 'Нажмите на здание — справка. ЛКМ/ПКМ — двигать карту, колесо — масштаб, Q/E — поворот.',
    build: TOUCH ? 'Ведите пальцем, отпустите — начнётся стройка.' : 'Наведите на карту и нажмите — начнётся стройка. R — повернуть.',
    road: 'Ведите по клеткам, чтобы проложить дорогу.',
    move: TOUCH ? 'Возьмите здание пальцем и перетащите на новое место.' : 'Зажмите здание и перетащите на новое место. R — повернуть.',
    delete: 'Нажмите на здание или ведите по дороге, чтобы удалить.'
  };
  var NO_BRIGADE = 'Сначала купите бригаду: 🚚 Механизмы → Строительство';
  var hintTimer = 0;
  function hint(text, warn) {
    var h = $('hint'); h.textContent = text || HINTS[tool]; h.className = 'hint' + (warn ? ' warn' : ''); h.style.opacity = 1;
    clearTimeout(hintTimer);
    hintTimer = warn ? setTimeout(function () { hint(); }, 2200) : setTimeout(function () { h.style.opacity = 0; }, 6000);
  }

  function setTool(t) {
    tool = t;
    document.querySelectorAll('.tool').forEach(function (b) { b.classList.toggle('on', b.dataset.tool === t); });
    $('panelBuild').hidden = t !== 'build';
    $('panelRoad').hidden = t !== 'road';
    hideGhost(); cursor.setEnabled(false);
    if (moving) cancelMove();
    if (t !== 'view') closeInfo();
    if (t === 'build') { setGhost(buildCat, buildSize, buildSeed); refreshNeed(); }
    if (t === 'build' && !state.brigades.length) hint(NO_BRIGADE, true); else hint();
  }
  function refreshNeed() { $('needBr').hidden = state.brigades.length > 0; }
  $('needBuy').addEventListener('click', function () { openMech('build'); });

  // --- миниатюры: отдельный маленький движок, рисуются по очереди и подставляются в карточки ---
  var thumbs = {}, tq = [], T = null, tBusy = false;
  function thumbReq(k, make) {
    if (thumbs[k] !== undefined) return thumbs[k];
    thumbs[k] = ''; tq.push({ k: k, make: make }); pumpThumbs();
    return '';
  }
  function thumbInit() {
    var tc = document.createElement('canvas'); tc.width = tc.height = 160;
    var en = new B.Engine(tc, true, { preserveDrawingBuffer: true, stencil: false, alpha: true }, false);
    var sc = new B.Scene(en); sc.useRightHandedSystem = true; sc.clearColor = new B.Color4(0, 0, 0, 0);
    var h = new B.HemisphericLight('h', new B.Vector3(0, 1, 0), sc); h.diffuse = hex('#eef6ff'); h.groundColor = hex('#6d8a55'); h.intensity = 0.85; h.specular = B.Color3.Black();
    var dl = new B.DirectionalLight('d', new B.Vector3(3, -6, -4), sc); dl.intensity = 0.6; dl.specular = B.Color3.Black();
    var c = new B.FreeCamera('c', new B.Vector3(0, 3, 3), sc); c.fov = 30 * Math.PI / 180; c.minZ = 0.05; c.maxZ = 100;
    T = { canvas: tc, engine: en, scene: sc, cam: c, kit: makeKit(sc) };
  }
  function pumpThumbs() { if (tBusy || !tq.length) return; tBusy = true; requestAnimationFrame(thumbStep); }
  function thumbStep() {
    try {
      if (!T) thumbInit();
      var it = tq[0];
      if (!it.mesh) {
        it.mesh = it.make(T.kit);
        it.mesh.computeWorldMatrix(true);
        var bi = it.mesh.getHierarchyBoundingVectors(true), ctr = bi.min.add(bi.max).scale(0.5), rad = bi.max.subtract(bi.min).length() / 2;
        var dist = rad / Math.sin(T.cam.fov / 2) * 1.02;
        T.cam.position.set(ctr.x + dist * 0.55, ctr.y + dist * 0.5, ctr.z + dist * 0.67);
        T.cam.setTarget(ctr);
        it.tries = 0;
      }
      if (!T.scene.isReady() && it.tries++ < 60) { requestAnimationFrame(thumbStep); return; }
      T.scene.render();
      var url = T.canvas.toDataURL('image/png');
      thumbs[it.k] = url;
      document.querySelectorAll('img[data-th="' + it.k + '"]').forEach(function (im) { im.src = url; });
      it.mesh.getChildMeshes(false).concat([it.mesh]).forEach(function (m) { var mm = m.material; m.dispose(); if (mm && mm.subMaterials) mm.dispose(); });
    } catch (e) { if (tq[0]) thumbs[tq[0].k] = ''; }
    tq.shift();
    if (tq.length) requestAnimationFrame(thumbStep); else tBusy = false;
  }
  function thumbUrl(cat, size) {
    return thumbReq(cat + size, function (K) {
      var root = new B.Mesh('thumb', K.scene), g = buildModel(K, cat, size, modelSeed(cat, 0)), s0 = G.sizes[size];
      g.parent = root;
      var pad = B.MeshBuilder.CreateBox('pad', { width: s0.w, height: 0.06, depth: s0.d }, K.scene); pad.position.y = -0.03; pad.material = K.mat('#8cc068'); pad.parent = root;
      return root;
    });
  }
  function truckThumb() {
    return thumbReq('truck', function (K) {
      var root = new B.Mesh('thumb', K.scene), t = truckModel(K); t.rotation.y = -0.35; t.parent = root;
      var pad = B.MeshBuilder.CreateBox('pad', { width: 0.75, height: 0.04, depth: 1.05 }, K.scene); pad.position.y = -0.02; pad.material = K.mat('#8cc068'); pad.parent = root;
      return root;
    });
  }
  function thumbImg(cls, k, src) { return '<img class="' + cls + '" alt="" data-th="' + k + '"' + (src ? ' src="' + src + '"' : '') + '>'; }

  function workText(cat, size) {
    var c = G.cats[cat];
    if (cat === 'res') { var f = c.families[size]; return '👥 ' + f + ' ' + plural(f, 'семья', 'семьи', 'семей'); }
    var n = c.staff[size]; return '👷 ~' + n.toLocaleString('ru-RU') + '<span class="wl"> работают</span><span class="ws"> чел.</span>';
  }
  var buildFilter = 'all';
  function renderChips() {
    $('catChips').innerHTML = '<button class="chip' + (buildFilter === 'all' ? ' on' : '') + '" data-cat="all">Все</button>' + Object.keys(G.cats).map(function (k) {
      var c = G.cats[k];
      return '<button class="chip' + (k === buildFilter ? ' on' : '') + '" data-cat="' + k + '"><span class="sw" style="background:' + c.tag + '"></span>' + c.label + '</button>';
    }).join('');
    $('roadChips').innerHTML = Object.keys(G.roads).map(function (k) {
      return '<button class="chip' + (k === roadType ? ' on' : '') + '" data-road="' + k + '"><span class="sw" style="background:' + G.roads[k].color + '"></span>' + G.roads[k].label + '</button>';
    }).join('');
    renderCards();
  }
  function renderCards() {
    var cats = buildFilter === 'all' ? Object.keys(G.cats) : [buildFilter], h = '';
    cats.forEach(function (ck) {
      var c = G.cats[ck];
      Object.keys(G.sizes).forEach(function (sk) {
        var on = ck === buildCat && sk === buildSize;
        h += '<button class="bcard' + (on ? ' on' : '') + '" data-cat="' + ck + '" data-size="' + sk + '">' + thumbImg('th', ck + sk, thumbUrl(ck, sk)) +
          '<span class="tx"><b>' + esc(c.names[sk]) + '</b><small>' + workText(ck, sk) + '</small>' +
          '<span class="sz"><i style="background:' + c.tag + '"></i>' + G.sizes[sk].label + ' · <em>' + usd(costOf(ck, sk)) + '</em></span></span></button>';
      });
    });
    $('bGrid').innerHTML = h;
    var sel = $('bGrid').querySelector('.bcard.on');
    if (sel) sel.scrollIntoView({ block: 'nearest' });
  }
  function secText(s) { s = Math.max(1, Math.ceil(s)); return s < 60 ? s + ' с' : Math.floor(s / 60) + ' мин ' + (s % 60 ? s % 60 + ' с' : ''); }
  function buildHint() {
    var n = state.brigades.length;
    if (!n) { hint(NO_BRIGADE, true); return; }
    hint('Строим: ' + G.cats[buildCat].names[buildSize] + ' (' + G.sizes[buildSize].label + ') · ' + usd(costOf(buildCat, buildSize)) +
      ' · ⏱ ~' + secText(G.buildTime[buildSize] / n) + ' (' + n + ' ' + plural(n, 'бригада', 'бригады', 'бригад') + ')');
  }
  $('catChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cat]'); if (!b) return;
    buildFilter = b.dataset.cat;
    if (buildFilter !== 'all' && buildCat !== buildFilter) { buildCat = buildFilter; buildSeed = newSeed(); setGhost(buildCat, buildSize, buildSeed); buildHint(); }
    renderChips(); $('bGrid').scrollTop = 0;
  });
  $('bGrid').addEventListener('click', function (e) {
    var b = e.target.closest('.bcard'); if (!b) return;
    buildCat = b.dataset.cat; buildSize = b.dataset.size; buildSeed = newSeed();
    $('bGrid').querySelectorAll('.bcard').forEach(function (x) { x.classList.toggle('on', x === b); });
    setGhost(buildCat, buildSize, buildSeed); buildHint();
  });
  $('roadChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-road]'); if (!b) return;
    roadType = b.dataset.road; renderChips();
  });
  function rotateCurrent() {
    if (moving) { moving.rot = (moving.rot + 1) % 4; if (lastHover) moveGhostTo(lastHover); return; }
    buildRot = (buildRot + 1) % 4;
    if (tool === 'build' && lastHover && ghost && ghost.isEnabled()) buildGhostTo(lastHover);
  }
  $('btnRotate').addEventListener('click', rotateCurrent);
  $('toolbar').addEventListener('click', function (e) {
    var b = e.target.closest('.tool'); if (!b) return;
    if (b.dataset.tool === 'mech') openMech(); else setTool(b.dataset.tool);
  });

  // --- действия ---
  var lastHover = null;
  function buildGhostTo(c) {
    var o = originFor(buildSize, buildRot, c);
    showGhostAt(buildSize, buildRot, o.x, o.z, canPlace(buildSize, buildRot, o.x, o.z, 0) && state.brigades.length > 0);
    return o;
  }
  function placeBuilding(c) {
    if (!state.brigades.length) { hint(NO_BRIGADE, true); return; }
    var o = originFor(buildSize, buildRot, c), cost = costOf(buildCat, buildSize);
    if (!canPlace(buildSize, buildRot, o.x, o.z, 0)) { hint('Здесь занято или край карты', true); return; }
    if (!canPay(cost)) { hint('Не хватает долларов: нужно ' + usd(cost), true); return; }
    pay(cost);
    var b = { id: state.nextId++, cat: buildCat, size: buildSize, x: o.x, z: o.z, rot: buildRot, seed: buildSeed, prog: 0 };
    state.buildings.push(b); markOcc(b, b.id); addBuildingMesh(b);
    assignBrigades();
    buildSeed = newSeed(); setGhost(buildCat, buildSize, buildSeed);
    save(); updateStats(); renderMech(); dirty();
    var crew = siteCrew(b.id).all;
    hint(crew ? '🏗️ Стройка началась: ' + G.cats[b.cat].names[b.size] : '🏗️ Стройка ждёт: все бригады заняты — купите ещё, чтобы быстрее');
  }
  function deleteBuilding(b) {
    markOcc(b, 0); removeBuildingMesh(b.id); delete byId[b.id];
    state.buildings.splice(state.buildings.indexOf(b), 1);
    if (infoId === b.id) closeInfo();
    if (isSite(b)) { assignBrigades(); renderMech(); }
    save(); updateStats(); dirty();
  }
  function setRoad(x, z, t) {
    if (!inMap(x, z)) return;
    var k = key(x, z);
    if (t) { if (occ[idx(x, z)] || state.roads[k] === t) return; state.roads[k] = t; }
    else { if (!state.roads[k]) return; delete state.roads[k]; }
    refreshRoadAround(x, z); save(); dirty();
  }
  function lineCells(a, b, fn) { // Брезенхэм
    var x0 = a.x, z0 = a.z, x1 = b.x, z1 = b.z, dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0), sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1, err = dx - dz;
    for (var guard = 0; guard < 500; guard++) {
      fn(x0, z0);
      if (x0 === x1 && z0 === z1) break;
      var e2 = 2 * err;
      if (e2 > -dz && e2 < dx) { // без диагональных шагов: дорога остаётся связной
        if (Math.abs(x1 - x0) >= Math.abs(z1 - z0)) { err -= dz; x0 += sx; } else { err += dx; z0 += sz; }
      } else {
        if (e2 > -dz) { err -= dz; x0 += sx; }
        if (e2 < dx) { err += dx; z0 += sz; }
      }
    }
  }
  function deleteAt(sx, sy, c) {
    if (c && inMap(c.x, c.z) && state.roads[key(c.x, c.z)]) { setRoad(c.x, c.z, null); return; }
    var b = pickBuilding(sx, sy); if (b) deleteBuilding(b);
  }

  function startMove(b, c) {
    moving = { b: b, offX: c.px - b.x, offZ: c.pz - b.z, rot: b.rot, x: b.x, z: b.z };
    writeBuilding(b);
    setGhost(b.cat, b.size, b.seed);
    moveGhostTo(c);
  }
  function moveGhostTo(c) {
    var f = foot(moving.b.size, moving.rot), fo = foot(moving.b.size, moving.b.rot);
    // центр захвата сохраняется при повороте
    var cx = c.px - moving.offX + fo.w / 2, cz = c.pz - moving.offZ + fo.d / 2;
    moving.x = clamp(Math.round(cx - f.w / 2), 0, N - f.w); moving.z = clamp(Math.round(cz - f.d / 2), 0, N - f.d);
    showGhostAt(moving.b.size, moving.rot, moving.x, moving.z, canPlace(moving.b.size, moving.rot, moving.x, moving.z, moving.b.id));
  }
  function finishMove() {
    var mv = moving, b = mv.b; moving = null;
    if (canPlace(b.size, mv.rot, mv.x, mv.z, b.id)) {
      markOcc(b, 0); b.x = mv.x; b.z = mv.z; b.rot = mv.rot; markOcc(b, b.id);
      save(); updateStats();
    } else hint('Сюда нельзя — здание вернулось на место', true);
    writeBuilding(b);
    hideGhost();
  }
  function cancelMove() { if (!moving) return; var b = moving.b; moving = null; writeBuilding(b); hideGhost(); }

  // ---------- Указатель: мышь и касания ----------
  var ptrs = new Map(), gest = null;
  function centroid() { var a = Array.from(ptrs.values()); return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), ang: Math.atan2(a[1].y - a[0].y, a[1].x - a[0].x) }; }
  function startPan(e, tap) { var p = groundAt(e.clientX, e.clientY); gest = { type: 'pan', grab: p, sx: e.clientX, sy: e.clientY, moved: false, tap: tap, t: Date.now() }; }

  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
  canvas.addEventListener('pointerdown', function (e) {
    canvas.focus();
    try { canvas.setPointerCapture(e.pointerId); } catch (er) {}
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (ptrs.size === 2) {
      cancelAction();
      var c = centroid();
      gest = { type: 'two', c: c, grab: groundAt(c.x, c.y), dist: cam.dist, yaw: cam.yaw, pitch: cam.pitch };
      return;
    }
    if (ptrs.size > 2) return;
    var mouse = e.pointerType === 'mouse';
    if (mouse && e.button === 1) { gest = { type: 'rotate', lx: e.clientX, ly: e.clientY, acc: 0 }; return; }
    if (mouse && e.button === 2) { if (e.shiftKey) gest = { type: 'rotate', lx: e.clientX, ly: e.clientY, acc: 0 }; else startPan(e, false); return; }
    if (tool === 'view') { startPan(e, true); return; }
    var c2 = cellAt(e.clientX, e.clientY); if (!c2) return;
    gest = { type: 'action', sx: e.clientX, sy: e.clientY, t: Date.now(), touch: !mouse, last: c2 };
    if (tool === 'build') buildGhostTo(c2);
    else if (tool === 'road') { gest.snap = JSON.stringify(state.roads); setRoad(c2.x, c2.z, roadType); }
    else if (tool === 'delete') { gest.snap = JSON.stringify(state); deleteAt(e.clientX, e.clientY, c2); }
    else if (tool === 'move') {
      var b = pickBuilding(e.clientX, e.clientY);
      if (b) startMove(b, c2); else startPan(e, false);
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    var p = ptrs.get(e.pointerId);
    if (p) { p.x = e.clientX; p.y = e.clientY; }
    if (!gest) { // наведение мышью
      if (e.pointerType !== 'mouse') return;
      var h = cellAt(e.clientX, e.clientY); lastHover = h; if (!h) return;
      if (tool === 'build') buildGhostTo(h);
      else if (tool === 'road') showCursor(h.x, h.z, G.roads[roadType].color === '#3c4047' ? '#ffffff' : '#ffe08a');
      else if (tool === 'delete') showCursor(h.x, h.z, '#ff3b30');
      return;
    }
    if (gest.type === 'two' && ptrs.size === 2) {
      var c = centroid();
      cam.dist = gest.dist * (gest.c.d / Math.max(c.d, 1));
      if (isIso()) { // в изометрии поворот двумя пальцами — щелчком на 90°
        var da = c.ang - gest.c.ang;
        if (Math.abs(da) > 0.6) { rotateCam(da > 0 ? -1 : 1); gest.c.ang = c.ang; }
      } else cam.yaw = gest.yaw - (c.ang - gest.c.ang);
      updateCam();
      var g2 = groundAt(c.x, c.y);
      if (g2 && gest.grab) { cam.tx -= g2.x - gest.grab.x; cam.tz -= g2.z - gest.grab.z; updateCam(); }
      return;
    }
    if (gest.type === 'rotate') {
      if (isIso()) {
        gest.acc += e.clientX - gest.lx; gest.lx = e.clientX;
        if (Math.abs(gest.acc) > 80) { rotateCam(gest.acc > 0 ? -1 : 1); gest.acc = 0; }
        return;
      }
      cam.yaw -= (e.clientX - gest.lx) * 0.008; cam.pitch += (e.clientY - gest.ly) * 0.005;
      gest.lx = e.clientX; gest.ly = e.clientY; updateCam(); return;
    }
    if (gest.type === 'pan') {
      if (Math.hypot(e.clientX - gest.sx, e.clientY - gest.sy) > 6) gest.moved = true;
      if (!gest.moved || !gest.grab) return;
      var g = groundAt(e.clientX, e.clientY);
      if (g) { cam.tx -= g.x - gest.grab.x; cam.tz -= g.z - gest.grab.z; updateCam(); }
      return;
    }
    if (gest.type === 'action') {
      var cl = cellAt(e.clientX, e.clientY); if (!cl) return; lastHover = cl;
      if (tool === 'build') buildGhostTo(cl);
      else if (tool === 'move' && moving) moveGhostTo(cl);
      else if (tool === 'road') { lineCells(gest.last, cl, function (x, z) { setRoad(x, z, roadType); }); showCursor(cl.x, cl.z, '#ffffff'); }
      else if (tool === 'delete') {
        lineCells(gest.last, cl, function (x, z) { if (inMap(x, z) && state.roads[key(x, z)]) setRoad(x, z, null); });
        if (cl.x !== gest.last.x || cl.z !== gest.last.z) { var bb = pickBuilding(e.clientX, e.clientY); if (bb) deleteBuilding(bb); }
        showCursor(cl.x, cl.z, '#ff3b30');
      }
      gest.last = cl;
    }
  });

  function endPointer(e) {
    ptrs.delete(e.pointerId);
    if (!gest) return;
    if (gest.type === 'two') { if (ptrs.size === 0) gest = null; return; }
    if (ptrs.size > 0) return;
    var g = gest; gest = null;
    if (e.type === 'pointercancel') { cancelAction(g); return; }
    if (g.type === 'pan' && g.tap && !g.moved) {
      var b = pickBuilding(e.clientX, e.clientY);
      if (b) openInfo(b); else closeInfo();
      return;
    }
    if (g.type === 'action') {
      var c = cellAt(e.clientX, e.clientY) || g.last;
      if (tool === 'build') { placeBuilding(c); if (g.touch) hideGhost(); else buildGhostTo(c); }
      else if (tool === 'move' && moving) finishMove();
      if (g.touch) { cursor.setEnabled(false); dirty(); }
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && !gest) { if (!moving) hideGhost(); cursor.setEnabled(false); dirty(); } });

  function cancelAction(g) {
    g = g || gest;
    if (!g || g.type !== 'action') return;
    if (tool === 'build') hideGhost();
    if (tool === 'move') cancelMove();
    // второй палец быстро после первого — отменить случайную дорогу/удаление
    if (g.touch && Date.now() - g.t < 450) {
      if (tool === 'road' && g.snap) { state.roads = JSON.parse(g.snap); rebuildAll(); save(); }
      if (tool === 'delete' && g.snap) { state = fixState(JSON.parse(g.snap)); rebuildAll(); save(); }
    }
    cursor.setEnabled(false); gest = null; dirty();
  }

  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    var before = groundAt(e.clientX, e.clientY);
    cam.dist *= Math.exp(e.deltaY * 0.0012); updateCam();
    var after = groundAt(e.clientX, e.clientY);
    if (before && after) { cam.tx -= after.x - before.x; cam.tz -= after.z - before.z; updateCam(); }
  }, { passive: false });

  var keys = {};
  window.addEventListener('keydown', function (e) {
    if (e.target.tagName === 'INPUT') return;
    var k = e.key.toLowerCase();
    if (k === 'q' || k === 'й') rotateCam(1);
    else if (k === 'e' || k === 'у') rotateCam(-1);
    else if (k === 'r' || k === 'к') rotateCurrent();
    else if (k === 'i' || k === 'ш') cycleView();
    else if (k === 'escape') { if (!$('modal').hidden) closeModal(); else if (!$('mech').hidden) closeMech(); else { closeInfo(); setTool('view'); } }
    else if (k === '6') openMech();
    else if ('12345'.indexOf(k) >= 0 && k) setTool(['view', 'build', 'road', 'move', 'delete'][+k - 1]);
    else if (k === '+' || k === '=') { cam.dist /= 1.2; updateCam(); }
    else if (k === '-') { cam.dist *= 1.2; updateCam(); }
    keys[k] = true;
  });
  window.addEventListener('keyup', function (e) { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', function () { keys = {}; });
  function keyPan(dt) {
    if (!$('mech').hidden) return;
    var f = 0, s = 0;
    if (keys.w || keys['ц'] || keys.arrowup) f += 1;
    if (keys.s || keys['ы'] || keys.arrowdown) f -= 1;
    if (keys.d || keys['в'] || keys.arrowright) s += 1;
    if (keys.a || keys['ф'] || keys.arrowleft) s -= 1;
    if (!f && !s) return;
    var sp = cam.dist * 0.9 * dt, sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
    cam.tx += (-sy * f + cy * s) * sp; cam.tz += (-cy * f - sy * s) * sp; updateCam();
  }

  function cycleView() {
    setView(nextView());
    hint(view === 'isohd' ? '✨ Изометрия HD: сглаживание, мягкие тени, чёткие окна' : view === 'iso' ? '🧱 Изометрия: крупные пиксели, поворот ⟲ ⟳ — на 90°' : '🎥 Вид 3D');
  }
  $('camMode').addEventListener('click', cycleView);
  $('camRotL').addEventListener('click', function () { rotateCam(1); });
  $('camRotR').addEventListener('click', function () { rotateCam(-1); });
  $('camIn').addEventListener('click', function () { cam.dist /= 1.25; updateCam(); });
  $('camOut').addEventListener('click', function () { cam.dist *= 1.25; updateCam(); });

  // ---------- Страница «Механизмы» ----------
  var mechTab = 'build';
  function openMech(tab) {
    if (tab) mechTab = tab;
    closeInfo(); if (moving) cancelMove();
    $('mech').hidden = false;
    document.querySelector('.tool.mech').classList.add('open');
    $('mechTabs').innerHTML = G.mechTabs.map(function (t) { return '<button class="tab' + (t.id === mechTab ? ' on' : '') + '" data-tab="' + t.id + '">' + t.label + '</button>'; }).join('');
    var h = '';
    Object.keys(G.units).forEach(function (k) {
      var u = G.units[k]; if (u.tab !== mechTab) return;
      h += '<div class="unit">' + (k === 'brigade' ? thumbImg('uimg', 'truck', truckThumb()) : '<span class="uimg"></span>') +
        '<div class="uinfo"><h3>' + esc(u.name) + '</h3><p>' + esc(u.about) + '</p>' +
        '<div class="ukv"><span>Цена</span><span class="usd">' + usd(u.price) + '</span>' +
        '<span>В парке</span><span><b id="mHave">0</b></span>' +
        '<span>Сейчас строят</span><span id="mBusy">—</span>' +
        '<span>Скорость</span><span id="mSpeed">—</span></div></div></div>' +
        '<div class="ubtns"><button class="btn-buy" data-act="buy">Купить за ' + usd(u.price) + '</button>' +
        '<button class="btn-sell" data-act="sell" id="mSell">Продать</button></div>';
    });
    h += '<h4>Стройки</h4><div id="mSites"></div>' +
      '<p class="note">Как это работает: без бригады строить нельзя. Поставьте здание — бригада приедет, и дом начнёт расти. ' +
      'Бригады делятся между стройками поровну; две бригады на одном доме строят вдвое быстрее. Деньги пока бесконечные (∞), продажа возвращает половину цены.</p>';
    $('mechBody').innerHTML = h;
    renderMech();
  }
  function closeMech() { $('mech').hidden = true; document.querySelector('.tool.mech').classList.remove('open'); }
  function renderMech() {
    if ($('mech').hidden || !$('mHave')) return;
    var n = state.brigades.length, busy = 0;
    state.brigades.forEach(function (br) { if (br.site) busy++; });
    $('mHave').textContent = n;
    $('mBusy').textContent = n ? busy + ' из ' + n : 'нет бригад';
    $('mSpeed').textContent = n ? 'одна стройка — до ×' + n : 'стройка невозможна';
    $('mSell').disabled = !n;
    var S = state.buildings.filter(isSite), h = '';
    S.forEach(function (b) {
      var crew = siteCrew(b.id), left = (1 - b.prog) * buildTime(b) / Math.max(1, crew.all), pct = Math.floor(b.prog * 100);
      h += '<div class="site-row"><div class="sr-top"><b>' + esc(G.cats[b.cat].names[b.size]) + '</b><span>' + pct + '%</span></div>' +
        '<div class="pbar"><i style="width:' + pct + '%"></i></div>' +
        '<div style="font-size:13px;color:#a9b6c8;margin:-4px 0 8px">' + (crew.all ? '🚚 ' + crew.all + ' ' + plural(crew.all, 'бригада', 'бригады', 'бригад') +
          (crew.here < crew.all ? ' (едут: ' + (crew.all - crew.here) + ')' : '') + ' · осталось ≈ ' + secText(left) : '<span class="wait">ждёт свободную бригаду</span>') + '</div></div>';
    });
    $('mSites').innerHTML = h || '<div class="empty">Сейчас ничего не строится.</div>';
  }
  $('mechClose').addEventListener('click', closeMech);
  $('mech').addEventListener('click', function (e) {
    if (e.target === $('mech')) { closeMech(); return; }
    var t = e.target.closest('[data-tab]'); if (t) { openMech(t.dataset.tab); return; }
    var a = e.target.closest('[data-act]'); if (!a) return;
    if (a.dataset.act === 'buy') buyBrigade(); else if (a.dataset.act === 'sell') sellBrigade();
  });

  // ---------- Жители и сотрудники ----------
  var P = G.people;
  function person(r, male, sur, ageMin, ageMax) {
    var age = rint(r, ageMin, ageMax);
    var job = age < 7 ? 'дошкольник' : age < 18 ? 'школьник' : age < 22 && r() < 0.6 ? 'студент' : age >= 63 ? 'пенсионер' : pick(r, P.jobs);
    return { name: (male ? pick(r, P.male) : pick(r, P.female)) + ' ' + (male ? sur[0] : sur[1]), age: age, job: job, m: male };
  }
  function ageWord(n) { var a = n % 10, b = n % 100; return n + ' ' + (b >= 11 && b <= 14 ? 'лет' : a === 1 ? 'год' : a >= 2 && a <= 4 ? 'года' : 'лет'); }
  function canWork(m) { return m.age >= 18 && m.age < 63 && m.job !== 'студент'; }
  var resCache = {};
  function residents(b) {
    var ck = b.id + ':' + b.seed; if (resCache[ck]) return resCache[ck];
    var r = rng(b.seed ^ 0x5bd1e995), nf = G.cats.res.families[b.size], fams = [], total = 0, adults = 0;
    for (var i = 0; i < nf; i++) {
      var sur = pick(r, P.surnames), roll = r(), mem = [], male = r() < 0.5;
      if (roll < 0.18) mem.push(person(r, male, sur, 20, 80));
      else if (roll < 0.4) { mem.push(person(r, true, sur, 24, 60)); mem.push(person(r, false, sur, 22, 58)); }
      else if (roll < 0.88) {
        var pa = person(r, true, sur, 28, 50); mem.push(pa); mem.push(person(r, false, sur, 26, 48));
        var kids = rint(r, 1, 3);
        for (var k = 0; k < kids; k++) mem.push(person(r, r() < 0.5, sur, 1, Math.min(20, pa.age - 20)));
      } else { mem.push(person(r, true, sur, 63, 85)); mem.push(person(r, false, sur, 61, 83)); }
      var fam = { surname: sur, members: mem, pet: r() < 0.35 ? pick(r, P.pets) : null, flat: b.size === '2x2' || b.size === '4x4' ? String(i + 1) : null };
      total += mem.length; mem.forEach(function (m) { if (canWork(m)) adults++; }); fams.push(fam);
    }
    return (resCache[ck] = { families: fams, total: total, adults: adults });
  }
  var workCache = {};
  function workplace(b) {
    var ck = b.id + ':' + b.seed; if (workCache[ck]) return workCache[ck];
    var c = G.cats[b.cat], r = rng(b.seed ^ 0x27d4eb2f);
    var staff = Math.max(2, Math.round(c.staff[b.size] * (0.85 + r() * 0.3)));
    var sur = pick(r, P.surnames), male = r() < 0.55;
    var head = (male ? pick(r, P.male) : pick(r, P.female)) + ' ' + (male ? sur[0] : sur[1]);
    var team = [];
    for (var i = 0; i < Math.min(4, staff - 1); i++) {
      var s2 = pick(r, P.surnames), m2 = r() < 0.5;
      team.push({ name: (m2 ? pick(r, P.male) : pick(r, P.female)) + ' ' + (m2 ? s2[0] : s2[1]), role: pick(r, c.roles), age: rint(r, 20, 60) });
    }
    var vn = c.visitN[b.size];
    var res = { staff: staff, head: head, team: team, visits: rint(r, vn[0], vn[1]), company: c.company ? pick(r, c.company) : null };
    return (workCache[ck] = res);
  }
  function address(b) { return G.streets[Math.floor(b.z / 4) % G.streets.length] + ', ' + (b.x + 1); }
  function roadNear(b) {
    var f = foot(b.size, b.rot), seen = {};
    for (var x = b.x - 1; x <= b.x + f.w; x++) for (var z = b.z - 1; z <= b.z + f.d; z++) {
      var onEdge = x === b.x - 1 || x === b.x + f.w || z === b.z - 1 || z === b.z + f.d;
      var corner = (x === b.x - 1 || x === b.x + f.w) && (z === b.z - 1 || z === b.z + f.d);
      if (onEdge && !corner) { var t = state.roads[key(x, z)]; if (t) seen[t] = 1; }
    }
    if (seen.asphalt) return 'асфальт';
    if (seen.dirt) return 'простая дорога';
    return 'нет — дом стоит без дороги';
  }

  // ---------- Расчёт жителей в фоне (js/sim.js) ----------
  var sim = { people: 0, adults: 0, employed: 0, unemployed: 0, jobs: 0, freeJobs: 0, home: {}, work: {}, ms: 0, ready: false };
  var simTimer = 0;
  function simRequest() {
    clearTimeout(simTimer);
    simTimer = setTimeout(function () {
      var homes = [], works = [];
      state.buildings.forEach(function (b) {
        if (isSite(b)) return;
        var c = siteCenter(b);
        if (b.cat === 'res') { var R = residents(b); homes.push([b.id, c.x, c.z, R.adults, R.total]); }
        else works.push([b.id, c.x, c.z, workplace(b).staff]);
      });
      window.SIM.run({ homes: homes, works: works });
    }, 200);
  }
  window.SIM.onResult(function (r) {
    sim.people = r.people; sim.adults = r.adults; sim.employed = r.employed; sim.unemployed = r.unemployed;
    sim.jobs = r.jobs; sim.freeJobs = r.freeJobs; sim.ms = r.ms; sim.ready = true;
    sim.home = {}; sim.work = {};
    r.homes.forEach(function (h) { sim.home[h[0]] = h[1]; });
    r.works.forEach(function (w) { sim.work[w[0]] = w[1]; });
    $('stJobsWrap').title = 'Рабочие места: ' + r.jobs.toLocaleString('ru-RU') + ', занято ' + r.employed.toLocaleString('ru-RU') + ', без работы ' + r.unemployed.toLocaleString('ru-RU');
    if (infoId) { var ib = getB(infoId); if (ib) renderInfo(ib, true); }
  });

  // ---------- Справка о здании ----------
  var infoId = 0;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function openInfo(b) { renderInfo(b, false); }
  function renderInfo(b, keepScroll) {
    infoId = b.id;
    var c = G.cats[b.cat], name = c.names[b.size], h = '';
    h += '<h2>' + esc(name) + '</h2>';
    h += '<div class="sub"><span class="tag" style="background:' + c.tag + '">' + esc(c.label) + '</span>' + esc(address(b)) + ' · ' + G.sizes[b.size].label + '</div>';
    if (isSite(b)) {
      var crew = siteCrew(b.id), pct = Math.floor(b.prog * 100), left = (1 - b.prog) * buildTime(b) / Math.max(1, crew.all);
      h += '<div class="build-now">🏗️ Идёт стройка — ' + pct + '%</div><div class="pbar"><i style="width:' + pct + '%"></i></div>';
      h += '<div class="kv"><span>Бригады</span><span>' + (crew.all ? crew.all + (crew.here < crew.all ? ' (в пути ' + (crew.all - crew.here) + ')' : ' на месте') : state.brigades.length ? 'ждёт свободную' : 'нет — купите в «Механизмы»') + '</span>' +
        (crew.all ? '<span>Осталось</span><span>≈ ' + secText(left) + '</span>' : '') +
        '<span>Цена</span><span>' + usd(costOf(b.cat, b.size)) + '</span>' +
        '<span>После стройки</span><span>' + (b.cat === 'res' ? 'заедут ' + c.families[b.size] + ' ' + plural(c.families[b.size], 'семья', 'семьи', 'семей') : 'работа для ~' + c.staff[b.size] + ' чел.') + '</span></div>';
    } else if (b.cat === 'res') {
      var R = residents(b), emp = sim.home[b.id];
      h += '<div class="kv"><span>Живут</span><span><b>' + R.total + '</b> чел., ' + R.families.length + ' ' + plural(R.families.length, 'семья', 'семьи', 'семей') + '</span>' +
        '<span>Работают</span><span>' + (emp === undefined ? '…считаем' : emp + ' из ' + R.adults + ' взрослых' + (emp < R.adults ? ' — ' + (R.adults - emp) + ' ищут работу' : '')) + '</span>' +
        '<span>Дорога рядом</span><span>' + roadNear(b) + '</span></div>';
      var show = R.families.slice(0, 8);
      show.forEach(function (f) {
        var adults = f.members.length;
        h += '<div class="fam"><b>' + (f.flat ? 'Кв. ' + f.flat + ' — ' : '') + (adults > 1 ? 'Семья ' + esc(famName(f.surname[0])) : ('Живёт ' + (f.members[0].m ? 'один' : 'одна'))) + '</b>' +
          f.members.map(function (m) { return '<div>' + esc(m.name) + ', ' + ageWord(m.age) + ' — ' + esc(m.job) + '</div>'; }).join('') +
          (f.pet ? '<div>🐾 ' + esc(f.pet) + '</div>' : '') + '</div>';
      });
      if (R.families.length > show.length) h += '<div class="more">…и ещё ' + (R.families.length - show.length) + ' ' + plural(R.families.length - show.length, 'семья', 'семьи', 'семей') + '</div>';
    } else {
      var w = workplace(b), headLabel = c.head[b.size] + (c.rank ? ' (' + c.rank[b.size] + ')' : ''), filled = sim.work[b.id];
      h += '<div class="about">' + esc(c.about[b.size]) + '</div>';
      h += '<div class="kv">' + (w.company ? '<span>Компания</span><span>«' + esc(w.company) + '»</span>' : '') +
        '<span>' + esc(headLabel) + '</span><span>' + esc(w.head) + '</span>' +
        '<span>Мест</span><span><b>' + w.staff + '</b></span>' +
        '<span>Из горожан</span><span>' + (filled === undefined ? '…считаем' : filled + ' чел.' + (filled < w.staff ? ' — свободно ' + (w.staff - filled) : ' — все места заняты')) + '</span>' +
        '<span>' + esc(cap(c.visitors[b.size])) + '</span><span>' + w.visits + '</span>' +
        '<span>Дорога рядом</span><span>' + roadNear(b) + '</span></div>';
      if (w.team.length) {
        h += '<div class="fam"><b>Сотрудники</b>' + w.team.map(function (t) { return '<div>' + esc(t.name) + ', ' + ageWord(t.age) + ' — ' + esc(t.role) + '</div>'; }).join('') + '</div>';
        if (w.staff - 1 > w.team.length) h += '<div class="more">…и ещё ' + (w.staff - 1 - w.team.length) + ' чел.</div>';
      }
    }
    $('infoBody').innerHTML = h; $('info').hidden = false; if (!keepScroll) $('info').scrollTop = 0;
    highlight(b.id);
  }
  function famName(s) { return /(ов|ев|ин)$/.test(s) ? s + 'ых' : s; }
  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function plural(n, a, b, c) { var x = n % 10, y = n % 100; return y >= 11 && y <= 14 ? c : x === 1 ? a : x >= 2 && x <= 4 ? b : c; }
  function closeInfo() { infoId = 0; $('info').hidden = true; highlight(0); }
  $('infoClose').addEventListener('click', closeInfo);
  function highlight(id) {
    var b = id && getB(id);
    if (!b) { hl.setEnabled(false); dirty(); return; }
    var f = foot(b.size, b.rot), p = bPos(b);
    setOverlay(hl, p.x, p.z, f.w + 0.2, f.d + 0.2);
  }

  // ---------- Статистика ----------
  function updateStats() {
    var people = 0, jobs = 0, built = 0;
    state.buildings.forEach(function (b) {
      if (isSite(b)) return; built++;
      if (b.cat === 'res') people += residents(b).total; else jobs += workplace(b).staff;
    });
    $('stPeople').textContent = people.toLocaleString('ru-RU');
    $('stJobs').textContent = jobs.toLocaleString('ru-RU');
    $('stBuild').textContent = built;
    simRequest();
  }

  // ---------- Меню ----------
  function openModal(html) { $('modalBody').innerHTML = html; $('modal').hidden = false; }
  function closeModal() { $('modal').hidden = true; }
  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });

  function helpHtml() {
    return '<details open><summary>🧱 Виды: 3D, ИЗО и ИЗО HD</summary><ul>' +
      '<li>Верхняя кнопка справа показывает текущий вид и переключает их по кругу: <b>3D → ИЗО → HD</b>.</li>' +
      '<li><b>ИЗО</b> — изометрия как в старых SimCity: камера под постоянным углом, крупные пиксели, город на срезе земли.</li>' +
      '<li><b>HD</b> — та же изометрия, но качественная картинка: полное разрешение, сглаженные края, мягкие тени в углах, подробные окна, трава и слои земли. Нагружает телефон сильнее.</li>' +
      '<li>В изометрии ⟲ ⟳ поворачивают карту ровно на 90°. Вид можно выбрать и в меню ☰. На компьютере — клавиша I.</li></ul></details>' +
      '<details><summary>🚚 Бригады и стройка</summary><ul>' +
      '<li>Строить можно только с бригадой. Откройте 🚚 «Механизмы» → «Строительство» и купите «Бригаду» — зелёный грузовик.</li>' +
      '<li>Поставьте здание: бригада приедет, дом начнёт расти, над ним — полоска прогресса.</li>' +
      '<li>Чем больше бригад, тем быстрее. Бригады делятся между стройками поровну.</li>' +
      '<li>Доллары — вверху экрана. Пока их бесконечно (∞), но у зданий и бригад уже есть цены.</li></ul></details>' +
      '<details><summary>👥 Жители и работа</summary><ul>' +
      '<li>Каждый взрослый житель сам ищет работу поближе к дому. Это считается в фоне и не тормозит игру.</li>' +
      '<li>В справке дома видно, сколько жильцов работают; у работы — сколько мест заняли горожане.</li>' +
      '<li>Сводка по городу — ☰ → «Город».</li></ul></details>' +
      '<details' + (TOUCH ? ' open' : '') + '><summary>Телефон и планшет</summary><ul>' +
      '<li>Один палец — двигать карту (в режиме «Смотреть»).</li><li>Два пальца — масштаб (щипок) и поворот карты.</li>' +
      '<li>«Строить»: выберите вид и размер, коснитесь карты и ведите пальцем, отпустите — начнётся стройка. Зелёная клетка — можно, красная — занято.</li>' +
      '<li>«Дорога»: ведите пальцем по клеткам. «Переместить»: возьмите дом и перетащите. «Удалить»: нажмите на дом или ведите по дороге.</li>' +
      '<li>Кнопки справа: вид ИЗО/3D, поворот камеры и масштаб.</li></ul></details>' +
      '<details' + (TOUCH ? '' : ' open') + '><summary>Компьютер</summary><ul>' +
      '<li>Левая кнопка — действие (в «Смотреть» — двигать карту и открыть справку).</li><li>Правая кнопка — двигать карту, колёсико — масштаб, средняя кнопка или Shift+правая — поворот и наклон.</li>' +
      '<li>Размер карты (от 32×32 до 128×128) — в меню ☰ → «Размер карты». Можно расширить карту, не теряя город.</li>' +
      '<li>W A S D или стрелки — двигать карту, Q / E — поворот камеры, I — ИЗО/3D, R — повернуть дом, 1–5 — инструменты, 6 — «Механизмы», Esc — «Смотреть».</li></ul></details>' +
      '<details><summary>Здания</summary><ul>' + Object.keys(G.cats).map(function (k) {
        var c = G.cats[k]; return '<li><b>' + c.label + '</b>: ' + Object.keys(G.sizes).map(function (s) { return G.sizes[s].label + ' ' + c.names[s].toLowerCase(); }).join(', ') + '.</li>';
      }).join('') + '</ul></details>';
  }
  function cityHtml() {
    var f = function (n) { return Number(n).toLocaleString('ru-RU'); };
    var nb = Object.keys(batches).filter(function (k) { return batches[k].ids.length; }).length;
    return '<h2>📊 Город</h2><div class="kv">' +
      '<span>Жителей</span><span><b>' + f(sim.people) + '</b></span>' +
      '<span>Взрослых, кто может работать</span><span>' + f(sim.adults) + '</span>' +
      '<span>Работают</span><span>' + f(sim.employed) + '</span>' +
      '<span>Ищут работу</span><span>' + f(sim.unemployed) + '</span>' +
      '<span>Рабочих мест</span><span>' + f(sim.jobs) + ' (свободно ' + f(sim.freeJobs) + ')</span>' +
      '<span>Зданий</span><span>' + f(state.buildings.length) + '</span></div>' +
      '<p style="font-size:13px;color:#a9b6c8">Расчёт жителей: ' + (window.SIM.threaded() ? 'в фоновом потоке' : 'на странице') + ', ' + sim.ms + ' мс. ' +
      'Отрисовка: Babylon.js ' + B.Engine.Version + ', ' + nb + ' ' + plural(nb, 'пачка', 'пачки', 'пачек') + ' одинаковых моделей.</p>';
  }
  function changelogHtml() {
    return G.changelog.map(function (c) { return '<p><b>' + c.v + '</b> · ' + c.date + '</p><ul>' + c.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>'; }).join('');
  }
  function openMenu() {
    openModal('<h2>Мое_город ' + G.version + '</h2>' +
      '<button class="menu-btn" data-m="help">❓ Как играть</button>' +
      '<button class="menu-btn" data-m="news">📝 Что нового</button>' +
      '<button class="menu-btn" data-m="city">📊 Город</button>' +
      VIEW_ORDER.map(function (v) { return '<button class="menu-btn' + (v === view ? ' cur' : '') + '" data-m="view" data-v="' + v + '">' + VIEWS[v].name + (v === view ? ' <span style="float:right;color:#a9b6c8">сейчас</span>' : '') + '</button>'; }).join('') +
      '<button class="menu-btn" data-m="mech">🚚 Механизмы</button>' +
      '<button class="menu-btn" data-m="size">🗺️ Размер карты <span style="float:right;color:#a9b6c8">' + N + '×' + N + '</span></button>' +
      '<button class="menu-btn" data-m="demo">🏘️ Загрузить город-пример</button>' +
      '<button class="menu-btn danger" data-m="clear">🧹 Новая пустая карта</button>' +
      '<p style="font-size:13px;color:#a9b6c8">Город сохраняется сам в этом браузере. Бригады переезжают на новую карту вместе с вами.</p>');
  }
  var pickSize = 0;
  function sizeLabel(n) { for (var i = 0; i < G.mapSizes.length; i++) if (G.mapSizes[i].n === n) return G.mapSizes[i].label; return 'Своя'; }
  function lostCount(n) { // сколько зданий и дорог не поместится при смене размера
    var o = Math.floor((n - N) / 2), lb = 0, lr = 0;
    state.buildings.forEach(function (b) { var f = foot(b.size, b.rot); if (b.x + o < 0 || b.z + o < 0 || b.x + o + f.w > n || b.z + o + f.d > n) lb++; });
    Object.keys(state.roads).forEach(function (k) { var p = k.split(','), x = +p[0] + o, z = +p[1] + o; if (x < 0 || z < 0 || x >= n || z >= n) lr++; });
    return { b: lb, r: lr };
  }
  function openSize() {
    if (!pickSize) pickSize = N;
    var h = '<h2>Размер карты</h2><p>Сейчас: <b>' + sizeLabel(N).toLowerCase() + ', ' + N + '×' + N + '</b> клеток.</p><div class="size-grid">' +
      G.mapSizes.map(function (m) {
        return '<button class="size-opt' + (m.n === pickSize ? ' on' : '') + '" data-n="' + m.n + '"><i style="width:' + Math.round(14 + m.n / 128 * 30) + 'px;height:' + Math.round(14 + m.n / 128 * 30) + 'px"></i><b>' + m.label + '</b><span>' + m.n + '×' + m.n + '</span></button>';
      }).join('') + '</div>';
    if (pickSize !== N) {
      var L = lostCount(pickSize), warn = '';
      if (L.b || L.r) warn = '<p class="warn">Не поместятся у края: ' + (L.b ? L.b + ' ' + plural(L.b, 'здание', 'здания', 'зданий') : '') + (L.b && L.r ? ' и ' : '') + (L.r ? L.r + ' ' + plural(L.r, 'клетка', 'клетки', 'клеток') + ' дороги' : '') + ' — они будут удалены.</p>';
      h += '<button class="menu-btn" data-m="resize">' + (pickSize > N ? '↔️ Расширить карту — город останется в центре' : '↘️ Уменьшить карту — город останется в центре') + '</button>' + warn +
        '<button class="menu-btn" data-m="newdemo">🏘️ Новая карта ' + pickSize + '×' + pickSize + ' с городом-примером</button>' +
        '<button class="menu-btn danger" data-m="newempty">🧹 Новая пустая карта ' + pickSize + '×' + pickSize + '</button>';
    } else h += '<p style="font-size:13px;color:#a9b6c8">Выберите другой размер, чтобы расширить или уменьшить карту.</p>';
    h += '<p style="font-size:13px;color:#a9b6c8">Огромные карты на слабых телефонах могут работать медленнее.</p>';
    openModal(h);
  }
  function resizeMap(n) {
    var o = Math.floor((n - N) / 2), nb = [], nr = {};
    state.buildings.forEach(function (b) {
      var f = foot(b.size, b.rot); b.x += o; b.z += o;
      if (b.x >= 0 && b.z >= 0 && b.x + f.w <= n && b.z + f.d <= n) nb.push(b);
    });
    Object.keys(state.roads).forEach(function (k) {
      var p = k.split(','), x = +p[0] + o, z = +p[1] + o;
      if (x >= 0 && z >= 0 && x < n && z < n) nr[key(x, z)] = state.roads[k];
    });
    state.brigades.forEach(function (br, i) {
      br.x = clamp(br.x, -n / 2, n / 2); br.z = clamp(br.z, -n / 2, n / 2 + 2);
      if (br.park) br.park = parkSpot(i, n);
    });
    state.buildings = nb; state.roads = nr; state.size = n;
    resCache = {}; workCache = {};
  }
  // Новая карта: бригады и потраченные доллары переезжают с игроком
  function carryUnits(s) {
    s.brigades = state.brigades.map(function (br, i) { var p = parkSpot(i, s.size); return { id: br.id, x: p.x, z: p.z, yaw: Math.PI, park: p, site: 0 }; });
    s.nextBr = state.nextBr; s.spent = state.spent;
    return s;
  }
  function applyState(s, keepCam) {
    closeInfo(); cancelMove(); state = s; rebuildAll(); save();
    if (keepCam) updateCam(); else camHome();
    pickSize = 0; closeModal();
    hint('Карта ' + N + '×' + N + ' готова');
  }
  $('btnMenu').addEventListener('click', openMenu);
  var confirmArm = '';
  $('modalBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-m],[data-n]'); if (!b) return;
    var m = b.dataset.m;
    var sb = e.target.closest('[data-n]');
    if (sb) { pickSize = +sb.dataset.n; confirmArm = ''; openSize(); return; }
    if (m === 'help') openModal('<h2>Как играть</h2>' + helpHtml());
    else if (m === 'city') openModal(cityHtml());
    else if (m === 'view') { closeModal(); setView(b.dataset.v); }
    else if (m === 'mech') { closeModal(); openMech(); }
    else if (m === 'size') { pickSize = N; confirmArm = ''; openSize(); }
    else if (m === 'resize') {
      var L = lostCount(pickSize);
      if ((L.b || L.r) && confirmArm !== m) { confirmArm = m; b.textContent = 'Точно? Часть города у края пропадёт — нажмите ещё раз'; return; }
      confirmArm = ''; resizeMap(pickSize); applyState(state, false);
    }
    else if (m === 'newdemo' || m === 'newempty') {
      if (confirmArm !== m) { confirmArm = m; b.textContent = 'Точно? Текущий город пропадёт — нажмите ещё раз'; return; }
      confirmArm = ''; applyState(carryUnits(m === 'newdemo' ? demoState(pickSize) : emptyState(pickSize)), false);
    }
    else if (m === 'news') openModal('<h2>Что нового</h2>' + changelogHtml());
    else if (m === 'demo' || m === 'clear') {
      if (confirmArm !== m) { confirmArm = m; b.textContent = 'Точно? Текущий город пропадёт — нажмите ещё раз'; return; }
      confirmArm = ''; applyState(carryUnits(m === 'demo' ? demoState(N) : emptyState(N)), true);
    }
  });

  // ---------- Цикл отрисовки ----------
  // Кадр рисуется только когда что-то изменилось — телефон не греется на пустом месте.
  var needRender = true, lastT = performance.now(), lastSave = 0, lastUi = 0, frames = 0;
  function dirty() { needRender = true; }
  function loop() {
    var t = performance.now(), dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
    keyPan(dt); tickCam(dt);
    var active = tickBrigades(dt, t);
    if (active && t - lastSave > 2000) { saveNow(); lastSave = t; }
    if (t - lastUi > 400) {
      lastUi = t;
      if (infoId) { var ib = getB(infoId); if (ib && isSite(ib)) renderInfo(ib, true); }
      if (active) renderMech();
    }
    flushRoads(); flushBatches();
    if (needRender) {
      needRender = false;
      scene.render();
      frames++;
      if (!scene.isReady()) needRender = true; // шейдеры ещё собираются — дорисуем следующим кадром
    }
  }
  window.addEventListener('pagehide', saveNow);

  // ---------- Старт ----------
  state = load() || demoState(G.mapSize);
  $('ver').textContent = G.version;
  setView(view);
  renderChips(); rebuildAll(); setTool('view');
  camHome();
  engine.runRenderLoop(loop);
  scene.executeWhenReady(function () { $('loading').classList.add('done'); dirty(); });
  setTimeout(function () { $('loading').classList.add('done'); }, 5000);
  try {
    var seen = localStorage.getItem(SEEN_KEY);
    if (seen !== G.version) {
      openModal(seen ? '<h2>Что нового в ' + G.version + '</h2>' + changelogHtml() : '<h2>Добро пожаловать в «Мое_город»!</h2><p>Купите бригаду в 🚚 «Механизмы», стройте дома, службы и дороги. Нажмите на любое здание, чтобы узнать, кто там живёт.</p>' + helpHtml());
      localStorage.setItem(SEEN_KEY, G.version);
    }
  } catch (e) {}
  window.__gorod = {
    state: function () { return state; }, size: function () { return N; }, cam: cam, setTool: setTool, openInfo: function (id) { openInfo(getB(id)); }, updateCam: updateCam,
    buy: buyBrigade, openMech: openMech, setView: setView, sim: function () { return sim; }, frames: function () { return frames; },
    batches: function () { return Object.keys(batches).map(function (k) { return k + ':' + batches[k].ids.length; }); },
    place: function (cat, size, x, z) { buildCat = cat; buildSize = size; buildRot = 0; placeBuilding({ px: x + G.sizes[size].w / 2, pz: z + G.sizes[size].d / 2 }); },
    bulk: function (n) { // тест: мгновенно застроить карту n зданиями
      var cats = Object.keys(G.cats), sz = ['1x1', '2x1', '2x2'], made = 0;
      for (var tries = 0; tries < n * 20 && made < n; tries++) {
        var cat = cats[made % cats.length], s = sz[made % 3], f = foot(s, 0), x = Math.floor(Math.random() * (N - f.w)), z = Math.floor(Math.random() * (N - f.d));
        if (!canPlace(s, 0, x, z, 0)) continue;
        var b = { id: state.nextId++, cat: cat, size: s, x: x, z: z, rot: 0, seed: newSeed() };
        state.buildings.push(b); markOcc(b, b.id); addBuildingMesh(b); made++;
      }
      updateStats(); save(); return made;
    }
  };
})();
