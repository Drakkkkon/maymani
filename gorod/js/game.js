// «Мое_город» — простой градостроитель на Three.js.
(function () {
  'use strict';
  var G = window.GAME, N = G.mapSize;
  var SAVE_KEY = 'moe_gorod_save_v1', SEEN_KEY = 'moe_gorod_seen';
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
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 250);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function rebuildOcc() {
    occ.fill(0);
    state.buildings.forEach(function (b) { markOcc(b, b.id); });
  }
  function markOcc(b, val) {
    var f = foot(b.size, b.rot);
    for (var z = b.z; z < b.z + f.d; z++) for (var x = b.x; x < b.x + f.w; x++) if (inMap(x, z)) occ[idx(x, z)] = val;
  }
  function getB(id) { for (var i = 0; i < state.buildings.length; i++) if (state.buildings[i].id === id) return state.buildings[i]; return null; }
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

  // ---------- Three.js ----------
  var canvas = $('scene');
  var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  var scene = new THREE.Scene();
  scene.background = new THREE.Color('#a9d0f0');
  scene.fog = new THREE.Fog('#a9d0f0', 70, 140);
  var camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);

  scene.add(new THREE.HemisphereLight('#dbeeff', '#5d7a45', 0.85));
  // Солнце идёт за камерой: тени чёткие на карте любого размера.
  var SUN_OFF = new THREE.Vector3(-22, 40, 18);
  var sun = new THREE.DirectionalLight('#fff3dc', 1.6);
  sun.position.copy(SUN_OFF);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  var sc = sun.shadow.camera; sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 140;
  sun.shadow.bias = -0.0008;
  scene.add(sun); scene.add(sun.target);
  var shadowExt = 32;
  function updateSun() {
    sun.target.position.set(cam.tx, 0, cam.tz);
    sun.position.set(cam.tx + SUN_OFF.x, SUN_OFF.y, cam.tz + SUN_OFF.z);
    var ext = Math.round(clamp(cam.dist * 1.1, 18, 70));
    if (ext !== shadowExt) { shadowExt = ext; sc.left = sc.bottom = -ext; sc.right = sc.top = ext; sc.updateProjectionMatrix(); }
  }

  // Земля, сетка и рамка — пересоздаются при смене размера карты.
  var mapGroup = new THREE.Group(); scene.add(mapGroup);
  var groundMat = new THREE.MeshLambertMaterial({ color: '#8cc068' }), outerMat = new THREE.MeshLambertMaterial({ color: '#6f9a52' });
  var frameMat = new THREE.MeshLambertMaterial({ color: '#c9b78f' });
  function buildMapScene() {
    while (mapGroup.children.length) {
      var o = mapGroup.children.pop();
      if (o.geometry) o.geometry.dispose();
      if (o.material && o.material.dispose && o.material !== groundMat && o.material !== outerMat && o.material !== frameMat) o.material.dispose();
    }
    var ground = new THREE.Mesh(new THREE.PlaneGeometry(N, N), groundMat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; mapGroup.add(ground);
    var outer = new THREE.Mesh(new THREE.PlaneGeometry(N * 6, N * 6), outerMat);
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.03; outer.receiveShadow = true; mapGroup.add(outer);
    var grid = new THREE.GridHelper(N, N, '#2d4a22', '#2d4a22');
    grid.material.transparent = true; grid.material.opacity = N > 80 ? 0.16 : 0.22; grid.position.y = 0.006; mapGroup.add(grid);
    var t = 0.25, h = 0.12; // рамка карты
    [[0, -N / 2 - t / 2, N + 2 * t, t], [0, N / 2 + t / 2, N + 2 * t, t], [-N / 2 - t / 2, 0, t, N], [N / 2 + t / 2, 0, t, N]].forEach(function (a) {
      var e = new THREE.Mesh(new THREE.BoxGeometry(a[2], h, a[3]), frameMat); e.position.set(a[0], h / 2 - 0.02, a[1]); e.receiveShadow = true; mapGroup.add(e);
    });
  }

  var buildGroup = new THREE.Group(), roadGroup = new THREE.Group(), truckGroup = new THREE.Group();
  scene.add(roadGroup); scene.add(buildGroup); scene.add(truckGroup);
  var bMeshes = {}, rMeshes = {}, tMeshes = {};

  function cellCenter(x, z) { return { x: x - N / 2 + 0.5, z: z - N / 2 + 0.5 }; }

  // ---------- Текстуры окон ----------
  var texCache = {}, matCache = {};
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
    var t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4;
    return t;
  }
  var perUnit = { res: 1.5, office: 2.5, glass: 2.5, army: 2, gov: 2, shop: 1, plain: 0 };
  function wallMats(style, wall, roof, w, d, floors) {
    var k = [style, wall, roof, w.toFixed(2), d.toFixed(2), floors].join('|');
    if (matCache[k]) return matCache[k];
    var roofM = new THREE.MeshLambertMaterial({ color: roof });
    var res;
    if (style === 'plain') {
      var wm = new THREE.MeshLambertMaterial({ color: wall });
      res = [wm, wm, roofM, roofM, wm, wm];
    } else {
      var tk = style + wall;
      var base = texCache[tk] || (texCache[tk] = windowCanvas(style, wall));
      var tw = base.clone(), td = base.clone();
      tw.needsUpdate = td.needsUpdate = true;
      tw.repeat.set(Math.max(1, Math.round(w * perUnit[style])), floors);
      td.repeat.set(Math.max(1, Math.round(d * perUnit[style])), floors);
      var mw = new THREE.MeshLambertMaterial({ map: tw }), md = new THREE.MeshLambertMaterial({ map: td });
      res = [md, md, roofM, roofM, mw, mw];
    }
    matCache[k] = res;
    return res;
  }
  var simpleMat = {};
  function mat(color) { return simpleMat[color] || (simpleMat[color] = new THREE.MeshLambertMaterial({ color: color })); }

  // ---------- Модели зданий ----------
  var RES_WALL = ['#f2d3a2', '#e9b98f', '#f4e7c8', '#d9c2a7', '#f0c9c0', '#cfe0c3', '#e3d0e8'];
  var RES_ROOF = ['#b8553a', '#8e4a3a', '#6b4c3b', '#a0522d', '#5e6a7a', '#3f6b5a'];

  function buildModel(cat, size, seed) {
    var s = G.sizes[size], W = s.w, D = s.d, m = 0.08;
    var r = rng(seed), g = new THREE.Group();
    function mesh(geo, material, x, y, z) {
      var o = new THREE.Mesh(geo, material); o.position.set(x - W / 2, y, z - D / 2);
      o.castShadow = true; o.receiveShadow = true; g.add(o); return o;
    }
    function part(x0, z0, x1, z1, y0, h, floors, style, wall, roof, roofType, roofH) {
      var w = x1 - x0, d = z1 - z0;
      mesh(new THREE.BoxGeometry(w, h, d), wallMats(style, wall, roof, w, d, floors), (x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
      if (roofType === 'hip') {
        var cone = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1); cone.rotateY(Math.PI / 4);
        var c = mesh(cone, mat(roof), (x0 + x1) / 2, y0 + h + roofH / 2, (z0 + z1) / 2);
        c.scale.set(w * 1.12, roofH, d * 1.12);
      } else if (roofType === 'flat') {
        mesh(new THREE.BoxGeometry(w + 0.04, 0.05, d + 0.04), mat(roof), (x0 + x1) / 2, y0 + h + 0.025, (z0 + z1) / 2);
      }
    }
    function cube(x0, z0, x1, z1, y0, h, color) {
      return mesh(new THREE.BoxGeometry(x1 - x0, h, z1 - z0), mat(color), (x0 + x1) / 2, y0 + h / 2, (z0 + z1) / 2);
    }
    function flag(x, y, z, color) {
      mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 6), mat('#c9ccd1'), x, y + 0.3, z);
      mesh(new THREE.BoxGeometry(0.26, 0.15, 0.01), mat(color || '#19a7c9'), x + 0.14, y + 0.51, z);
    }
    function tree(x, z, sc) {
      sc = sc || 1;
      mesh(new THREE.CylinderGeometry(0.03 * sc, 0.04 * sc, 0.2 * sc, 6), mat('#7a5634'), x, 0.1 * sc, z);
      mesh(new THREE.ConeGeometry(0.17 * sc, 0.42 * sc, 7), mat('#3f8f46'), x, 0.38 * sc, z);
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
        for (var i = 0; i < 5; i++) mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.9, 10), mat('#f5f2ea'), 0.25 + i * 0.375, 0.45, D - 0.22);
        cube(m, D - 0.45, W - m, D - m, 0.9, 0.12, '#e6e2d6');
        cube(m, D - 0.45, W - m, D - m + 0.04, 0, 0.05, '#cfcabd');
        flag(1.0, 1.05, 0.8);
      } else {
        part(F[0], F[1], F[2], F[3], 0, 0.8, 2, 'gov', '#ece6d6', '#8c949e', 'flat');
        part(0.8, 0.6, 3.2, 3.0, 0.8, 1.4, 4, 'gov', '#f1ebdc', '#8c949e', 'flat');
        var dome = new THREE.SphereGeometry(0.55, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2);
        mesh(dome, mat('#3f8fbf'), 2.0, 2.25, 1.8);
        flag(2.0, 2.8, 1.8);
        for (var j = 0; j < 6; j++) mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.75, 10), mat('#fbf8f0'), 0.9 + j * 0.44, 0.4, D - 0.02);
        cube(0.7, D - 0.1, 3.3, D - 0.0, 0.76, 0.1, '#ece6d6');
      }
    } else if (cat === 'army') {
      var aw = '#7d8b5a', ar = '#58623f';
      if (size === '1x1') {
        part(0.3, 0.3, 0.72, 0.72, 0, 0.45, 1, 'army', aw, ar, 'flat');
        cube(0.15, 0.82, 0.95, 0.86, 0.22, 0.04, '#e25b4a'); cube(0.12, 0.78, 0.18, 0.9, 0, 0.25, '#555');
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
        var barrel = mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.38, 6), mat('#3f4a2b'), 2.95, 0.24, 2.72); barrel.rotation.x = Math.PI / 2;
        // вышка
        cube(0.35, 3.25, 0.65, 3.55, 0, 1.0, '#6c6a5a'); cube(0.25, 3.15, 0.75, 3.65, 1.0, 0.25, aw); cube(0.22, 3.12, 0.78, 3.68, 1.25, 0.04, ar);
        flag(1.2, 0, 2.8, '#2f6b3a');
      }
    } else if (cat === 'corp') {
      if (size === '1x1') {
        part(F[0], F[1], F[2], F[3], 0, 0.5, 1, 'shop', '#f6d9a0', '#8d8d8d', 'flat');
        var aw2 = cube(0.12, D - m, 0.88, D - m + 0.16, 0.4, 0.03, '#d9534f'); aw2.rotation.x = 0.25;
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
        mesh(new THREE.CylinderGeometry(0.02, 0.05, 1.1, 8), mat('#d0d6dc'), 2.0, 6.85, 2.0);
      }
    }
    return g;
  }

  // ---------- Грузовик «Бригада» (зелёный, в стиле 60-х). Смотрит вперёд по +z ----------
  function truckModel() {
    var g = new THREE.Group();
    var GREEN = '#4f8f3e', DARK = '#3b6e2e', CREAM = '#ece4c8', CHROME = '#d9dcd2', TIRE = '#1c1c1c', WOOD = '#a8844f', GLASS = '#9cc3dd';
    function add(geo, color, x, y, z) { var o = new THREE.Mesh(geo, mat(color)); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; }
    function box(w, h, d, color, x, y, z) { return add(new THREE.BoxGeometry(w, h, d), color, x, y, z); }
    // рама
    box(0.26, 0.05, 0.86, '#2c2c2a', 0, 0.12, -0.02);
    // колёса с белыми колпаками
    [[0.15, 0.27], [-0.15, 0.27], [0.15, -0.25], [-0.15, -0.25]].forEach(function (p) {
      var w = new THREE.CylinderGeometry(0.075, 0.075, 0.06, 14); w.rotateZ(Math.PI / 2); add(w, TIRE, p[0], 0.075, p[1]);
      var h = new THREE.CylinderGeometry(0.035, 0.035, 0.064, 10); h.rotateZ(Math.PI / 2); add(h, CHROME, p[0], 0.075, p[1]);
    });
    // круглые крылья над передними колёсами
    [0.15, -0.15].forEach(function (x) {
      var f = new THREE.CylinderGeometry(0.095, 0.095, 0.08, 14, 1, false, 0, Math.PI); f.rotateZ(Math.PI / 2); add(f, DARK, x, 0.1, 0.27);
    });
    // капот с округлой крышкой
    box(0.22, 0.1, 0.22, GREEN, 0, 0.2, 0.33);
    var hood = new THREE.CylinderGeometry(0.11, 0.11, 0.22, 14, 1, false, Math.PI / 2, Math.PI); hood.rotateX(Math.PI / 2);
    var hm = add(hood, GREEN, 0, 0.25, 0.33); hm.scale.set(1, 0.5, 1);
    // хромированная решётка, бампер, круглые фары
    box(0.15, 0.08, 0.012, CHROME, 0, 0.2, 0.445);
    for (var i = 0; i < 3; i++) box(0.15, 0.008, 0.016, '#7b7e78', 0, 0.175 + i * 0.025, 0.446);
    box(0.32, 0.03, 0.035, CHROME, 0, 0.12, 0.46);
    [0.085, -0.085].forEach(function (x) {
      var l = new THREE.CylinderGeometry(0.028, 0.028, 0.02, 12); l.rotateX(Math.PI / 2); add(l, '#fff4c2', x, 0.245, 0.447);
    });
    // кабина: зелёная, крыша кремовая (двухцветная окраска 60-х)
    box(0.3, 0.2, 0.2, GREEN, 0, 0.3, 0.12);
    box(0.31, 0.035, 0.21, CREAM, 0, 0.418, 0.12);
    box(0.24, 0.085, 0.012, GLASS, 0, 0.345, 0.222);             // лобовое
    box(0.304, 0.075, 0.12, GLASS, 0, 0.345, 0.125);             // боковые окна
    box(0.302, 0.02, 0.202, CREAM, 0, 0.27, 0.12);               // молдинг
    // кузов: деревянные борта, внутри кирпич и доски
    box(0.32, 0.03, 0.42, WOOD, 0, 0.17, -0.21);
    box(0.02, 0.1, 0.42, WOOD, 0.15, 0.23, -0.21); box(0.02, 0.1, 0.42, WOOD, -0.15, 0.23, -0.21);
    box(0.32, 0.1, 0.02, WOOD, 0, 0.23, -0.41); box(0.32, 0.13, 0.02, DARK, 0, 0.245, 0.0);
    box(0.322, 0.012, 0.422, '#7d6136', 0, 0.255, -0.21);
    box(0.18, 0.07, 0.14, '#b5563c', -0.04, 0.22, -0.13);
    box(0.08, 0.04, 0.33, '#e0c48a', 0.08, 0.205, -0.22);
    // лесенка-стремянка на кузове
    box(0.04, 0.02, 0.3, '#f0b23c', -0.07, 0.28, -0.26);
    return g;
  }
  var truckTpl = null;
  function newTruckMesh() { if (!truckTpl) truckTpl = truckModel(); var m = truckTpl.clone(); m.scale.setScalar(0.78); return m; }

  // ---------- Здания и стройплощадки на сцене ----------
  function placeMesh(obj, b) {
    var f = foot(b.size, b.rot);
    obj.position.set(b.x + f.w / 2 - N / 2, 0, b.z + f.d / 2 - N / 2);
    obj.rotation.y = -b.rot * Math.PI / 2;
  }
  function addSiteParts(g, b) {
    var s = G.sizes[b.size], W = s.w, D = s.d, site = new THREE.Group();
    var box = new THREE.Box3().setFromObject(g.userData.model);
    g.userData.h = Math.max(0.45, box.max.y);
    function bx(w, h, d, color, x, y, z, shadow) { var o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color)); o.position.set(x, y, z); o.castShadow = !!shadow; o.receiveShadow = true; site.add(o); return o; }
    bx(W - 0.1, 0.04, D - 0.1, '#a39d92', 0, 0.02, 0);                // фундамент
    var e = 0.03;                                                     // ограждение
    bx(W - 0.02, 0.05, e, '#ff8a1f', 0, 0.13, -D / 2 + e); bx(W - 0.02, 0.05, e, '#ff8a1f', 0, 0.13, D / 2 - e);
    bx(e, 0.05, D - 0.02, '#ff8a1f', -W / 2 + e, 0.13, 0); bx(e, 0.05, D - 0.02, '#ff8a1f', W / 2 - e, 0.13, 0);
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(function (c) { bx(0.04, 0.18, 0.04, '#f2f2ea', c[0] * (W / 2 - e), 0.09, c[1] * (D / 2 - e), true); });
    // полоска прогресса над стройкой
    var bar = new THREE.Group(), bw = Math.min(W, 2.4) * 0.8;
    var bg = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.08, 0.11, 0.11), mat('#26303d'));
    var fg = new THREE.BoxGeometry(bw, 0.075, 0.13); fg.translate(bw / 2, 0, 0);
    var fill = new THREE.Mesh(fg, mat('#5fd35a')); fill.position.x = -bw / 2;
    bar.add(bg); bar.add(fill); site.add(bar);
    g.add(site);
    g.userData.site = site; g.userData.fill = fill; g.userData.bar = bar;
  }
  function updateSiteMesh(b) {
    var g = bMeshes[b.id]; if (!g || !g.userData.site) return;
    var p = clamp(b.prog, 0, 1), sy = Math.max(0.04, p);
    g.userData.model.scale.y = sy;
    g.userData.fill.scale.x = Math.max(0.001, p);
    g.userData.bar.position.y = g.userData.h * sy + 0.35;
    dirty();
  }
  function addBuildingMesh(b) {
    var g = new THREE.Group(), m = buildModel(b.cat, b.size, b.seed);
    g.add(m); g.userData.model = m;
    if (isSite(b)) addSiteParts(g, b);
    g.traverse(function (o) { o.userData.bid = b.id; });
    placeMesh(g, b);
    buildGroup.add(g); bMeshes[b.id] = g;
    if (isSite(b)) updateSiteMesh(b);
  }
  function removeBuildingMesh(id) {
    var g = bMeshes[id]; if (!g) return;
    buildGroup.remove(g);
    g.traverse(function (o) { if (o.geometry) o.geometry.dispose(); });
    delete bMeshes[id];
  }

  // ---------- Дороги ----------
  var roadMat = {
    asphalt: new THREE.MeshLambertMaterial({ color: G.roads.asphalt.color }),
    dirt: new THREE.MeshLambertMaterial({ color: G.roads.dirt.color })
  };
  (function () { // лёгкий шум для текстуры дорог
    ['asphalt', 'dirt'].forEach(function (t) {
      var c = document.createElement('canvas'); c.width = c.height = 64; var g = c.getContext('2d');
      g.fillStyle = G.roads[t].color; g.fillRect(0, 0, 64, 64);
      var r = rng(t === 'dirt' ? 7 : 3);
      for (var i = 0; i < 260; i++) {
        var v = r(); g.fillStyle = t === 'dirt' ? (v > .5 ? 'rgba(120,90,55,.35)' : 'rgba(200,170,120,.3)') : (v > .5 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.07)');
        g.fillRect(r() * 64, r() * 64, 2, 2);
      }
      var tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
      roadMat[t].map = tx; roadMat[t].color.set('#ffffff'); roadMat[t].needsUpdate = true;
    });
  })();
  var lineMat = new THREE.MeshLambertMaterial({ color: '#f1f1e6' });
  var curbMat = new THREE.MeshLambertMaterial({ color: '#c4c4bc' });
  var rutMat = new THREE.MeshLambertMaterial({ color: '#8a6a44' });
  var planeGeo = new THREE.PlaneGeometry(1, 1); planeGeo.rotateX(-Math.PI / 2);

  function flatQuad(material, cx, cz, w, d, y) {
    var q = new THREE.Mesh(planeGeo, material); q.scale.set(w, 1, d); q.position.set(cx, y, cz); q.receiveShadow = true; return q;
  }
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  function buildRoadCell(x, z) {
    var k = key(x, z);
    if (rMeshes[k]) { roadGroup.remove(rMeshes[k]); delete rMeshes[k]; }
    var t = state.roads[k]; if (!t) return;
    var c = cellCenter(x, z), g = new THREE.Group();
    g.add(flatQuad(roadMat[t], c.x, c.z, 1, 1, 0.012));
    DIRS.forEach(function (dv) {
      var n = state.roads[key(x + dv[0], z + dv[1])];
      var hx = dv[0] !== 0, sgn = dv[0] + dv[1];
      if (t === 'asphalt') {
        if (n === 'asphalt') { // разметка к соседу
          g.add(hx ? flatQuad(lineMat, c.x + sgn * 0.3, c.z, 0.22, 0.05, 0.016) : flatQuad(lineMat, c.x, c.z + sgn * 0.3, 0.05, 0.22, 0.016));
        } else if (!n) { // бордюр
          g.add(hx ? flatQuad(curbMat, c.x + sgn * 0.46, c.z, 0.08, 1, 0.018) : flatQuad(curbMat, c.x, c.z + sgn * 0.46, 1, 0.08, 0.018));
        }
      } else if (n) { // колея к соседу
        g.add(hx ? flatQuad(rutMat, c.x + sgn * 0.25, c.z - 0.18, 0.5, 0.06, 0.015) : flatQuad(rutMat, c.x - 0.18, c.z + sgn * 0.25, 0.06, 0.5, 0.015));
        g.add(hx ? flatQuad(rutMat, c.x + sgn * 0.25, c.z + 0.18, 0.5, 0.06, 0.015) : flatQuad(rutMat, c.x + 0.18, c.z + sgn * 0.25, 0.06, 0.5, 0.015));
      }
    });
    roadGroup.add(g); rMeshes[k] = g;
  }
  function refreshRoadAround(x, z) {
    buildRoadCell(x, z);
    DIRS.forEach(function (d) { if (inMap(x + d[0], z + d[1])) buildRoadCell(x + d[0], z + d[1]); });
  }

  // ---------- Бригады ----------
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
    Object.keys(tMeshes).forEach(function (id) { truckGroup.remove(tMeshes[id]); delete tMeshes[id]; });
    state.brigades.forEach(addTruck);
  }
  function addTruck(br) {
    var m = newTruckMesh(); m.position.set(br.x, 0, br.z); m.rotation.y = br.yaw || 0;
    truckGroup.add(m); tMeshes[br.id] = m; dirty();
  }
  function buyBrigade() {
    var u = G.units.brigade;
    if (!canPay(u.price)) { hint('Не хватает долларов на бригаду', true); return; }
    pay(u.price);
    var i = state.brigades.length, p = parkSpot(i);
    var br = { id: state.nextBr++, x: p.x, z: N / 2 + 1.6, yaw: Math.PI, park: p, site: 0 };
    state.brigades.push(br); addTruck(br);
    assignBrigades(); save(); refreshNeed(); renderMech();
    hint(state.buildings.some(isSite) ? '🚚 Бригада выехала на стройку' : '🚚 Бригада куплена — теперь можно строить');
  }
  function sellBrigade() {
    if (!state.brigades.length) return;
    var j = state.brigades.length - 1;
    for (var i = state.brigades.length - 1; i >= 0; i--) if (!state.brigades[i].site) { j = i; break; } // сначала свободную
    var br = state.brigades.splice(j, 1)[0];
    if (tMeshes[br.id]) { truckGroup.remove(tMeshes[br.id]); delete tMeshes[br.id]; }
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
      br.work = false;
      if (tgt) {
        var dx = tgt.x - br.x, dz = tgt.z - br.z, d = Math.hypot(dx, dz);
        if (d > 0.02) {
          var v = Math.max(u.speed, d / 3), st = Math.min(d, v * dt);
          br.x += dx / d * st; br.z += dz / d * st;
          br.yaw = angTo(br.yaw || 0, Math.atan2(dx, dz), Math.min(1, dt * 10)); any = true;
        } else {
          br.x = tgt.x; br.z = tgt.z;
          if (Math.abs(Math.atan2(Math.sin(tgt.yaw - br.yaw), Math.cos(tgt.yaw - br.yaw))) > 0.01) { br.yaw = angTo(br.yaw, tgt.yaw, Math.min(1, dt * 8)); any = true; }
          if (atSite) { br.work = true; arrived[b.id] = (arrived[b.id] || 0) + 1; any = true; }
        }
      }
      var m = tMeshes[br.id];
      if (m) {
        m.position.set(br.x, br.work ? Math.abs(Math.sin(t * 0.012 + br.id * 1.7)) * 0.012 : 0, br.z);
        m.rotation.y = br.yaw || 0; m.rotation.z = br.work ? Math.sin(t * 0.02 + br.id) * 0.02 : 0;
      }
    });
    var done = [];
    state.buildings.forEach(function (b) {
      var a = arrived[b.id]; if (!a || !isSite(b)) return;
      b.prog = Math.min(1, b.prog + dt * a * u.power / buildTime(b));
      updateSiteMesh(b);
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
    if (!mapGroup.children.length || state.size !== N) { N = state.size; occ = new Int32Array(N * N); buildMapScene(); }
    Object.keys(bMeshes).forEach(function (id) { removeBuildingMesh(+id); });
    Object.keys(rMeshes).forEach(function (k) { roadGroup.remove(rMeshes[k]); delete rMeshes[k]; });
    rebuildOcc();
    state.buildings.forEach(addBuildingMesh);
    Object.keys(state.roads).forEach(function (k) { var p = k.split(','); buildRoadCell(+p[0], +p[1]); });
    rebuildTrucks(); assignBrigades();
    updateStats(); updateMoney(); refreshNeed(); dirty();
  }

  // ---------- Призрак и курсор ----------
  var ghost = null, ghostKey = '', ghostFoot = flatQuad(new THREE.MeshBasicMaterial({ color: '#4cd964', transparent: true, opacity: 0.45, depthWrite: false }), 0, 0, 1, 1, 0.03);
  ghostFoot.visible = false; ghostFoot.renderOrder = 2; scene.add(ghostFoot);
  var cursor = flatQuad(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.4, depthWrite: false }), 0, 0, 1, 1, 0.035);
  cursor.visible = false; cursor.renderOrder = 2; scene.add(cursor);

  function setGhost(cat, size, seed) {
    var k = cat + size + seed;
    if (k === ghostKey && ghost) return;
    if (ghost) { scene.remove(ghost); ghost = null; }
    ghostKey = k;
    ghost = buildModel(cat, size, seed);
    ghost.traverse(function (o) {
      if (!o.material) return;
      var cl = function (mm) { var c = mm.clone(); c.transparent = true; c.opacity = 0.6; c.depthWrite = false; return c; };
      o.material = Array.isArray(o.material) ? o.material.map(cl) : cl(o.material);
      o.castShadow = false;
    });
    ghost.visible = false; scene.add(ghost);
  }
  function showGhostAt(size, rot, x, z, ok) {
    var b = { size: size, rot: rot, x: x, z: z }, f = foot(size, rot);
    placeMesh(ghost, b); ghost.visible = true;
    ghostFoot.scale.set(f.w, 1, f.d); ghostFoot.position.set(b.x + f.w / 2 - N / 2, 0.03, b.z + f.d / 2 - N / 2);
    ghostFoot.material.color.set(ok ? '#4cd964' : '#ff3b30'); ghostFoot.visible = true;
    dirty();
  }
  function hideGhost() { if (ghost) ghost.visible = false; ghostFoot.visible = false; dirty(); }
  function showCursor(x, z, color) {
    if (!inMap(x, z)) { cursor.visible = false; dirty(); return; }
    var c = cellCenter(x, z); cursor.position.set(c.x, 0.035, c.z); cursor.material.color.set(color); cursor.visible = true; dirty();
  }

  // ---------- Камера ----------
  var cam = { tx: 0, tz: 2, dist: 34, yaw: Math.PI / 4, pitch: 0.95 };
  function camHome() {
    cam.tx = 0; cam.tz = 2; cam.yaw = Math.PI / 4; cam.pitch = 0.95;
    cam.dist = clamp(N * 0.72, 24, 90) * (window.innerWidth < window.innerHeight ? 1.3 : 1);
    updateCam();
  }
  function updateCam() {
    cam.dist = clamp(cam.dist, 5, Math.max(80, N * 1.3)); cam.pitch = clamp(cam.pitch, 0.35, 1.45);
    cam.tx = clamp(cam.tx, -N / 2, N / 2); cam.tz = clamp(cam.tz, -N / 2, N / 2);
    var cp = Math.cos(cam.pitch);
    camera.position.set(cam.tx + cam.dist * cp * Math.sin(cam.yaw), cam.dist * Math.sin(cam.pitch), cam.tz + cam.dist * cp * Math.cos(cam.yaw));
    camera.lookAt(cam.tx, 0, cam.tz);
    camera.updateMatrixWorld();
    camera.far = Math.max(400, cam.dist * 6); camera.updateProjectionMatrix();
    scene.fog.near = cam.dist * 1.6 + 15; scene.fog.far = cam.dist * 3.2 + 60;
    updateSun();
    dirty();
  }
  function resize() {
    var w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.fov = w < h ? 55 : 45; camera.updateProjectionMatrix(); updateCam();
  }
  window.addEventListener('resize', resize);

  var ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), gplane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), tmpV = new THREE.Vector3();
  function setRay(sx, sy) {
    var rc = canvas.getBoundingClientRect();
    ndc.set(((sx - rc.left) / rc.width) * 2 - 1, -((sy - rc.top) / rc.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
  }
  function groundAt(sx, sy) {
    setRay(sx, sy);
    var p = ray.ray.intersectPlane(gplane, tmpV);
    return p ? { x: p.x, z: p.z } : null;
  }
  function cellAt(sx, sy) {
    var p = groundAt(sx, sy); if (!p) return null;
    return { x: Math.floor(p.x + N / 2), z: Math.floor(p.z + N / 2), px: p.x + N / 2, pz: p.z + N / 2 };
  }
  function pickBuilding(sx, sy) {
    setRay(sx, sy);
    var hits = ray.intersectObjects(buildGroup.children, true);
    for (var i = 0; i < hits.length; i++) { var id = hits[i].object.userData.bid; if (id) return getB(id); }
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
    hideGhost(); cursor.visible = false;
    if (moving) cancelMove();
    if (t !== 'view') closeInfo();
    if (t === 'build') { setGhost(buildCat, buildSize, buildSeed); refreshNeed(); }
    if (t === 'build' && !state.brigades.length) hint(NO_BRIGADE, true); else hint();
  }
  function refreshNeed() { $('needBr').hidden = state.brigades.length > 0; }
  $('needBuy').addEventListener('click', function () { openMech('build'); });

  // --- миниатюры (рисуются один раз в маленьком отдельном рендере) ---
  var thumbs = {}, thumbR = null;
  function thumbOf(k, make) {
    if (thumbs[k] !== undefined) return thumbs[k];
    try {
      if (!thumbR) {
        var tc = document.createElement('canvas'); tc.width = tc.height = 160;
        thumbR = { r: new THREE.WebGLRenderer({ canvas: tc, antialias: true, alpha: true, preserveDrawingBuffer: true }), s: new THREE.Scene(), c: new THREE.PerspectiveCamera(30, 1, 0.1, 100) };
        thumbR.r.setSize(160, 160, false);
        thumbR.s.add(new THREE.HemisphereLight('#e6f2ff', '#6d8a55', 1.0));
        var dl = new THREE.DirectionalLight('#fff3dc', 1.5); dl.position.set(-3, 6, 4); thumbR.s.add(dl);
      }
      var T = thumbR, g = make();
      T.s.add(g);
      var box = new THREE.Box3().setFromObject(g), sph = box.getBoundingSphere(new THREE.Sphere());
      var dist = sph.radius / Math.sin(THREE.MathUtils.degToRad(T.c.fov / 2)) * 1.02;
      T.c.position.set(sph.center.x + dist * 0.55, sph.center.y + dist * 0.5, sph.center.z + dist * 0.67);
      T.c.lookAt(sph.center); T.c.updateProjectionMatrix();
      T.r.render(T.s, T.c);
      thumbs[k] = T.r.domElement.toDataURL('image/png');
      T.s.remove(g);
    } catch (e) { thumbs[k] = ''; }
    return thumbs[k];
  }
  function thumbUrl(cat, size) {
    return thumbOf(cat + size, function () {
      var g = buildModel(cat, size, 12345 + size.length);
      var s0 = G.sizes[size], pad = new THREE.Mesh(new THREE.BoxGeometry(s0.w, 0.06, s0.d), mat('#8cc068'));
      pad.position.y = -0.03; g.add(pad); return g;
    });
  }
  function truckThumb() {
    return thumbOf('truck', function () {
      var g = new THREE.Group(), t = truckModel(); t.rotation.y = -0.35; g.add(t);
      var pad = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.04, 1.05), mat('#8cc068')); pad.position.y = -0.02; g.add(pad);
      return g;
    });
  }
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
        var on = ck === buildCat && sk === buildSize, src = thumbUrl(ck, sk);
        h += '<button class="bcard' + (on ? ' on' : '') + '" data-cat="' + ck + '" data-size="' + sk + '">' +
          (src ? '<img class="th" alt="" src="' + src + '">' : '<span class="th"></span>') +
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
    if (tool === 'build' && lastHover && ghost && ghost.visible) buildGhostTo(lastHover);
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
    markOcc(b, 0); removeBuildingMesh(b.id);
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
    var g = bMeshes[b.id]; if (g) g.visible = false;
    moving = { b: b, offX: c.px - b.x, offZ: c.pz - b.z, rot: b.rot, x: b.x, z: b.z };
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
      placeMesh(bMeshes[b.id], b); save();
    } else hint('Сюда нельзя — здание вернулось на место', true);
    if (bMeshes[b.id]) bMeshes[b.id].visible = true;
    hideGhost();
  }
  function cancelMove() { if (!moving) return; if (bMeshes[moving.b.id]) bMeshes[moving.b.id].visible = true; moving = null; hideGhost(); }

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
    if (mouse && e.button === 1) { gest = { type: 'rotate', lx: e.clientX, ly: e.clientY }; return; }
    if (mouse && e.button === 2) { if (e.shiftKey) gest = { type: 'rotate', lx: e.clientX, ly: e.clientY }; else startPan(e, false); return; }
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
      cam.yaw = gest.yaw - (c.ang - gest.c.ang);
      updateCam();
      var g2 = groundAt(c.x, c.y);
      if (g2 && gest.grab) { cam.tx -= g2.x - gest.grab.x; cam.tz -= g2.z - gest.grab.z; updateCam(); }
      return;
    }
    if (gest.type === 'rotate') {
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
      if (g.touch) { cursor.visible = false; dirty(); }
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse' && !gest) { if (!moving) hideGhost(); cursor.visible = false; dirty(); } });

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
    cursor.visible = false; gest = null; dirty();
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
    if (k === 'q' || k === 'й') { cam.yaw += Math.PI / 8; updateCam(); }
    else if (k === 'e' || k === 'у') { cam.yaw -= Math.PI / 8; updateCam(); }
    else if (k === 'r' || k === 'к') rotateCurrent();
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

  $('camRotL').addEventListener('click', function () { cam.yaw += Math.PI / 8; updateCam(); });
  $('camRotR').addEventListener('click', function () { cam.yaw -= Math.PI / 8; updateCam(); });
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
      var src = k === 'brigade' ? truckThumb() : '';
      h += '<div class="unit">' + (src ? '<img class="uimg" alt="" src="' + src + '">' : '<span class="uimg"></span>') +
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
  var resCache = {};
  function residents(b) {
    var ck = b.id + ':' + b.seed; if (resCache[ck]) return resCache[ck];
    var r = rng(b.seed ^ 0x5bd1e995), nf = G.cats.res.families[b.size], fams = [], total = 0;
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
      total += mem.length; fams.push(fam);
    }
    return (resCache[ck] = { families: fams, total: total });
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
      var R = residents(b);
      h += '<div class="kv"><span>Живут</span><span><b>' + R.total + '</b> чел., ' + R.families.length + ' ' + plural(R.families.length, 'семья', 'семьи', 'семей') + '</span>' +
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
      var w = workplace(b), headLabel = c.head[b.size] + (c.rank ? ' (' + c.rank[b.size] + ')' : '');
      h += '<div class="about">' + esc(c.about[b.size]) + '</div>';
      h += '<div class="kv">' + (w.company ? '<span>Компания</span><span>«' + esc(w.company) + '»</span>' : '') +
        '<span>' + esc(headLabel) + '</span><span>' + esc(w.head) + '</span>' +
        '<span>Работают</span><span><b>' + w.staff + '</b> чел.</span>' +
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

  var hl = flatQuad(new THREE.MeshBasicMaterial({ color: '#ffc94a', transparent: true, opacity: 0.55, depthWrite: false }), 0, 0, 1, 1, 0.025);
  hl.visible = false; scene.add(hl);
  function highlight(id) {
    var b = id && getB(id);
    if (!b) { hl.visible = false; dirty(); return; }
    var f = foot(b.size, b.rot);
    hl.scale.set(f.w + 0.2, 1, f.d + 0.2); hl.position.set(b.x + f.w / 2 - N / 2, 0.025, b.z + f.d / 2 - N / 2); hl.visible = true; dirty();
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
  }

  // ---------- Меню ----------
  function openModal(html) { $('modalBody').innerHTML = html; $('modal').hidden = false; }
  function closeModal() { $('modal').hidden = true; }
  $('modalClose').addEventListener('click', closeModal);
  $('modal').addEventListener('click', function (e) { if (e.target === $('modal')) closeModal(); });

  function helpHtml() {
    return '<details open><summary>🚚 Бригады и стройка</summary><ul>' +
      '<li>Строить можно только с бригадой. Откройте 🚚 «Механизмы» → «Строительство» и купите «Бригаду» — зелёный грузовик.</li>' +
      '<li>Поставьте здание: бригада приедет, дом начнёт расти, над ним — полоска прогресса.</li>' +
      '<li>Чем больше бригад, тем быстрее. Бригады делятся между стройками поровну.</li>' +
      '<li>Доллары — вверху экрана. Пока их бесконечно (∞), но у зданий и бригад уже есть цены.</li></ul></details>' +
      '<details' + (TOUCH ? ' open' : '') + '><summary>Телефон и планшет</summary><ul>' +
      '<li>Один палец — двигать карту (в режиме «Смотреть»).</li><li>Два пальца — масштаб (щипок) и поворот карты.</li>' +
      '<li>«Строить»: выберите вид и размер, коснитесь карты и ведите пальцем, отпустите — начнётся стройка. Зелёная клетка — можно, красная — занято.</li>' +
      '<li>«Дорога»: ведите пальцем по клеткам. «Переместить»: возьмите дом и перетащите. «Удалить»: нажмите на дом или ведите по дороге.</li>' +
      '<li>Кнопки справа: поворот камеры и масштаб.</li></ul></details>' +
      '<details' + (TOUCH ? '' : ' open') + '><summary>Компьютер</summary><ul>' +
      '<li>Левая кнопка — действие (в «Смотреть» — двигать карту и открыть справку).</li><li>Правая кнопка — двигать карту, колёсико — масштаб, средняя кнопка или Shift+правая — поворот и наклон.</li>' +
      '<li>Размер карты (от 32×32 до 128×128) — в меню ☰ → «Размер карты». Можно расширить карту, не теряя город.</li>' +
      '<li>W A S D или стрелки — двигать карту, Q / E — поворот камеры, R — повернуть дом, 1–5 — инструменты, 6 — «Механизмы», Esc — «Смотреть».</li></ul></details>' +
      '<details><summary>Здания</summary><ul>' + Object.keys(G.cats).map(function (k) {
        var c = G.cats[k]; return '<li><b>' + c.label + '</b>: ' + Object.keys(G.sizes).map(function (s) { return G.sizes[s].label + ' ' + c.names[s].toLowerCase(); }).join(', ') + '.</li>';
      }).join('') + '</ul></details>';
  }
  function changelogHtml() {
    return G.changelog.map(function (c) { return '<p><b>' + c.v + '</b> · ' + c.date + '</p><ul>' + c.items.map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>'; }).join('');
  }
  function openMenu() {
    openModal('<h2>Мое_город ' + G.version + '</h2>' +
      '<button class="menu-btn" data-m="help">❓ Как играть</button>' +
      '<button class="menu-btn" data-m="news">📝 Что нового</button>' +
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
    state = s; closeInfo(); cancelMove(); rebuildAll(); save();
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
  var needRender = true, lastT = performance.now(), lastSave = 0, lastUi = 0;
  function dirty() { needRender = true; }
  function loop(t) {
    var dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
    keyPan(dt);
    var active = tickBrigades(dt, t);
    if (active && t - lastSave > 2000) { saveNow(); lastSave = t; }
    if (t - lastUi > 400) {
      lastUi = t;
      if (infoId) { var ib = getB(infoId); if (ib && isSite(ib)) renderInfo(ib, true); }
      if (active) renderMech();
    }
    if (needRender) { renderer.render(scene, camera); needRender = false; }
    requestAnimationFrame(loop);
  }
  window.addEventListener('pagehide', saveNow);

  // ---------- Старт ----------
  state = load() || demoState(G.mapSize);
  $('ver').textContent = G.version;
  renderChips(); rebuildAll(); resize(); setTool('view');
  camHome();
  requestAnimationFrame(loop);
  try {
    var seen = localStorage.getItem(SEEN_KEY);
    if (seen !== G.version) {
      openModal(seen ? '<h2>Что нового в ' + G.version + '</h2>' + changelogHtml() : '<h2>Добро пожаловать в «Мое_город»!</h2><p>Купите бригаду в 🚚 «Механизмы», стройте дома, службы и дороги. Нажмите на любое здание, чтобы узнать, кто там живёт.</p>' + helpHtml());
      localStorage.setItem(SEEN_KEY, G.version);
    }
  } catch (e) {}
  window.__gorod = { state: function () { return state; }, size: function () { return N; }, cam: cam, setTool: setTool, openInfo: function (id) { openInfo(getB(id)); }, updateCam: updateCam,
    buy: buyBrigade, openMech: openMech, place: function (cat, size, x, z) { buildCat = cat; buildSize = size; buildRot = 0; placeBuilding({ px: x + G.sizes[size].w / 2, pz: z + G.sizes[size].d / 2 }); } };
})();
