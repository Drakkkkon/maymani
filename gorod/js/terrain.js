// «Мое_город» — природа (с 0.21.0): деревья, каменистые площадки и горы.
// Всё считается по «зерну» мира (env.seed) и номеру клетки, без хранения: одна и та же клетка всегда даёт одно и то же,
// поэтому карту можно подгружать кусками по 100×100, а в сохранении мира нужно лишь зерно и список срубленных деревьев.
// Деревья не растут и не размножаются: после создания мира их можно только убрать (рубка при стройке или инструмент «Удалить»).
// С 0.22.0 природу можно «досеять» в старый мир кнопкой 🌲 «Обновить»: env.keep — список прямоугольников [x0, z0, x1, z1] (конец не входит)
// вокруг уже построенного. В них гор и каменистых площадок нет, а деревья растут на свободных клетках (занятые закрывает список срубленных).
//
// Виды клетки (terr): 0 — трава, 1 — каменистая площадка, 2 — гора (склон, строить нельзя), 3 — подножие горы (каменистая земля).
// Деревья (tree): 0 — нет, 1 — дуб, 2 — сосна, 3 — ясень.
(function () {
  'use strict';
  var TREE_NAMES = ['', 'дуб', 'сосна', 'ясень'];

  // ---------- хеш и гладкий шум ----------
  function h32(seed, a, b, c) {
    var h = (seed ^ 0x9e3779b9) | 0;
    h = Math.imul(h ^ a, 0x85ebca6b); h ^= h >>> 13;
    h = Math.imul(h ^ b, 0xc2b2ae35); h ^= h >>> 16;
    h = Math.imul(h ^ c, 0x27d4eb2f); h ^= h >>> 15;
    h = Math.imul(h, 0x165667b1); h ^= h >>> 13;
    return h >>> 0;
  }
  function r01(seed, a, b, c) { return h32(seed, a | 0, b | 0, c | 0) / 4294967296; }
  function vnoise(seed, salt, x, z) {
    var xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
    var sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
    var a = r01(seed, xi, zi, salt), b = r01(seed, xi + 1, zi, salt), c = r01(seed, xi, zi + 1, salt), d = r01(seed, xi + 1, zi + 1, salt);
    return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
  }
  function fbm(seed, salt, x, z) {
    return vnoise(seed, salt, x, z) * 0.6 + vnoise(seed, salt + 1, x * 2.1, z * 2.1) * 0.28 + vnoise(seed, salt + 2, x * 4.3, z * 4.3) * 0.12;
  }

  // ---------- настройки ----------
  var MS = 32;            // горы: одна «ячейка» 32×32 клетки, в ней не больше одной горы (середина — не ближе 11 клеток к краю)
  var P_MOUNT = 0.62;     // у какой доли ячеек есть гора
  var T_BODY = 0.3;       // выше этой высоты клетка — склон (строить нельзя)
  var FOOT = 2;           // ширина каменистого подножия вокруг склона, клеток
  var RS = 20;            // каменистые площадки: ячейка 20×20
  var P_ROCK = 0.72;
  var START = 8;          // вокруг центра карты — чистая лужайка (полуширина, клеток; на маленькой карте меньше)
  function msOf(N) { return N < 80 ? 24 : MS; }       // на маленькой карте ячейки и горы меньше
  function kOf(N) { return N < 80 ? 0.7 : 1; }
  function startOf(N) { return N < 80 ? 5 : START; }
  var FOREST_T = 0.60;    // шум леса выше этого значения — лес (подобрано так, что лес занимает около четверти карты)
  var SP_A = 0.431, SP_B = 0.566; // границы видов деревьев по шуму: дуб / сосна / ясень примерно по трети

  // ---------- горы ----------
  var mcache = {};
  function holes(env, N) {
    var c = Math.floor(N / 2), st = startOf(N), a = [[c - st, c - st, c + st, c + st]];
    if (env.hole) a.push(env.hole);
    return a;
  }
  function hitsHole(env, N, x0, z0, x1, z1) {
    function hit(h) { return !(x1 < h[0] - 1 || x0 > h[2] + 1 || z1 < h[1] - 1 || z0 > h[3] + 1); }
    return holes(env, N).some(hit) || keepsOf(env).some(hit);
  }
  function keepsOf(env) { return Array.isArray(env.keep) ? env.keep : []; }
  function mountainOf(env, N, sx, sz) {
    var seed = env.seed, k = seed + ':' + N + ':' + (env.hole ? env.hole.join('_') : '') + ':' + keepsOf(env).length + ':' + sx + ',' + sz;
    if (mcache[k] !== undefined) return mcache[k];
    var d = null;
    if (r01(seed, sx, sz, 101) < P_MOUNT) {
      var M = msOf(N), kk = kOf(N), mg = N < 80 ? 8 : 11;
      var cx = sx * M + mg + r01(seed, sx, sz, 102) * (M - 2 * mg), cz = sz * M + mg + r01(seed, sx, sz, 103) * (M - 2 * mg);
      var R = (3.0 + r01(seed, sx, sz, 104) * 1.6) * kk, H = (2.7 + r01(seed, sx, sz, 105) * 1.5) * (N < 80 ? 0.85 : 1);
      var peaks = [{ x: cx, z: cz, rb: R + 1.0, h: H }];
      var extra = 1 + (r01(seed, sx, sz, 106) < 0.55 ? 1 : 0), i;
      for (i = 0; i < extra; i++) {
        var a = r01(seed, sx, sz, 110 + i) * Math.PI * 2, dd = R * (0.35 + r01(seed, sx, sz, 120 + i) * 0.45), rr = R * (0.55 + r01(seed, sx, sz, 130 + i) * 0.25);
        peaks.push({ x: cx + Math.cos(a) * dd, z: cz + Math.sin(a) * dd, rb: rr + 0.9, h: H * (0.55 + r01(seed, sx, sz, 140 + i) * 0.3) });
      }
      var x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
      peaks.forEach(function (p) {
        p.rbody = p.h <= T_BODY ? 0 : p.rb * (1 - Math.pow(T_BODY / p.h, 1 / 1.25));
        x0 = Math.min(x0, p.x - p.rb - FOOT); x1 = Math.max(x1, p.x + p.rb + FOOT); z0 = Math.min(z0, p.z - p.rb - FOOT); z1 = Math.max(z1, p.z + p.rb + FOOT);
      });
      d = { id: sx + ',' + sz, seed: seed, sx: sx, sz: sz, cx: cx, cz: cz, peaks: peaks, H: H, x0: x0, z0: z0, x1: x1, z1: z1 };
      if (x0 < 1 || z0 < 1 || x1 > N - 1 || z1 > N - 1 || hitsHole(env, N, x0, z0, x1, z1)) d = null; // у края карты и у стартовой лужайки гор нет
    }
    mcache[k] = d;
    return d;
  }
  // высота горы в точке (в клетках карты); 0 — равнина
  function heightAt(d, x, z) {
    var best = 0;
    for (var i = 0; i < d.peaks.length; i++) {
      var p = d.peaks[i], dist = Math.hypot(x - p.x, z - p.z);
      if (dist >= p.rb) continue;
      var h = p.h * Math.pow(1 - dist / p.rb, 1.25);
      if (h > best) best = h;
    }
    return best;
  }
  function mtClass(d, x, z) { // x, z — центр клетки: 2 склон, 3 подножие, 0 мимо
    if (heightAt(d, x, z) >= T_BODY) return 2;
    for (var i = 0; i < d.peaks.length; i++) {
      var p = d.peaks[i]; if (Math.hypot(x - p.x, z - p.z) <= p.rbody + FOOT) return 3;
    }
    return 0;
  }

  // ---------- каменистые площадки ----------
  var rcache = {};
  function rockBlobs(env, sx, sz) {
    var seed = env.seed, k = seed + ':' + sx + ',' + sz;
    if (rcache[k]) return rcache[k];
    var out = [];
    if (r01(seed, sx, sz, 201) < P_ROCK) {
      out.push({ x: sx * RS + 5 + r01(seed, sx, sz, 202) * (RS - 10), z: sz * RS + 5 + r01(seed, sx, sz, 203) * (RS - 10), r: 2.0 + r01(seed, sx, sz, 204) * 1.7 });
      if (r01(seed, sx, sz, 205) < 0.3) { // иногда рядом вторая, поменьше
        var b = out[0], a = r01(seed, sx, sz, 206) * Math.PI * 2;
        out.push({ x: b.x + Math.cos(a) * (b.r + 1.4), z: b.z + Math.sin(a) * (b.r + 1.4), r: 1.5 + r01(seed, sx, sz, 207) * 0.9 });
      }
    }
    return (rcache[k] = out);
  }
  function isRock(env, x, z) {
    var sx = Math.floor(x / RS), sz = Math.floor(z / RS), bl = rockBlobs(env, sx, sz);
    for (var i = 0; i < bl.length; i++) {
      var b = bl[i];
      if (Math.hypot(x + 0.5 - b.x, z + 0.5 - b.z) < b.r * (0.8 + 0.4 * r01(env.seed, x, z, 208))) return true;
    }
    return false;
  }

  // ---------- деревья ----------
  function treeAt(env, x, z) {
    var seed = env.seed, f = fbm(seed, 301, x / 16, z / 16), dens = 0;
    if (f > FOREST_T) dens = Math.min(0.82, 0.3 + (f - FOREST_T) * 5);        // лес: чем глубже, тем гуще
    else if (vnoise(seed, 305, x / 5.5, z / 5.5) > 0.74) dens = 0.3;           // рощица из нескольких деревьев
    var r = r01(seed, x, z, 310);
    if (r >= dens && r01(seed, x, z, 311) >= 0.005) return 0;                  // одинокие деревья — редко, по одному
    var s = fbm(seed, 320, x / 22, z / 22) + (r01(seed, x, z, 312) - 0.5) * 0.12;
    return s < SP_A ? 1 : s < SP_B ? 2 : 3;
  }

  // ---------- карта клеток ----------
  // Область [x0, x1) × [z0, z1): terr — вид клетки, tree — дерево; массивы идут по строкам (z — строка).
  function cells(env, N, x0, z0, x1, z1) {
    var w = x1 - x0, h = z1 - z0, terr = new Uint8Array(w * h), tree = new Uint8Array(w * h), hs = holes(env, N), ms = msOf(N), x, z, i;
    var ks = keepsOf(env).filter(function (k) { return !(k[2] <= x0 || k[0] >= x1 || k[3] <= z0 || k[1] >= z1); }); // только те «зоны построенного», что задевают эту область
    for (z = z0; z < z1; z++) {
      for (x = x0; x < x1; x++) {
        i = (z - z0) * w + (x - x0);
        var skip = false;
        for (var q = 0; q < hs.length; q++) { var hh = hs[q]; if (x >= hh[0] && x < hh[2] && z >= hh[1] && z < hh[3]) { skip = true; break; } }
        if (skip) continue;
        var kept = false;
        for (q = 0; q < ks.length; q++) { var kk = ks[q]; if (x >= kk[0] && x < kk[2] && z >= kk[1] && z < kk[3]) { kept = true; break; } }
        var m = kept ? null : mountainOf(env, N, Math.floor(x / ms), Math.floor(z / ms)), t = m ? mtClass(m, x + 0.5, z + 0.5) : 0;
        if (!t && !kept && isRock(env, x, z)) t = 1;
        terr[i] = t;
        if (!t) tree[i] = treeAt(env, x, z);
      }
    }
    return { w: w, h: h, terr: terr, tree: tree };
  }
  // Горы, которые касаются области [x0, x1] × [z0, z1] (клетки)
  function mountains(env, N, x0, z0, x1, z1) {
    var out = [], M = msOf(N), sx0 = Math.floor((x0 - 12) / M), sx1 = Math.floor((x1 + 12) / M), sz0 = Math.floor((z0 - 12) / M), sz1 = Math.floor((z1 + 12) / M);
    for (var sz = sz0; sz <= sz1; sz++) for (var sx = sx0; sx <= sx1; sx++) {
      var d = mountainOf(env, N, sx, sz);
      if (d && !(d.x1 < x0 || d.x0 > x1 + 1 || d.z1 < z0 || d.z0 > z1 + 1)) out.push(d);
    }
    return out;
  }

  // ---------- вид дерева и камней в клетке ----------
  function treeLook(seed, x, z, kind) {
    var a = r01(seed, x, z, 401), b = r01(seed, x, z, 402), c = r01(seed, x, z, 403), d = r01(seed, x, z, 404);
    var base = kind === 1 ? 0.95 : kind === 2 ? 0.92 : 0.9;
    return { dx: (a - 0.5) * 0.5, dz: (b - 0.5) * 0.5, s: base + c * 0.5, yaw: d * Math.PI * 2 };
  }
  function boulders(seed, x, z, terr) { // [dx, dz, масштаб, поворот, вид 0/1]
    var out = [], n = terr === 3 ? 2 + Math.floor(r01(seed, x, z, 410) * 3) : 1 + Math.floor(r01(seed, x, z, 410) * 3);
    for (var i = 0; i < n; i++) {
      out.push([(r01(seed, x, z, 420 + i) - 0.5) * 0.8, (r01(seed, x, z, 430 + i) - 0.5) * 0.8, (terr === 3 ? 0.9 : 0.6) + r01(seed, x, z, 440 + i) * 0.8, r01(seed, x, z, 450 + i) * 6.28, r01(seed, x, z, 460 + i) < 0.5 ? 0 : 1]);
    }
    return out;
  }

  // ---------- сетка горы для отрисовки: острые грани, цвет вершин: скала внизу, снег на вершинах ----------
  function hexRgb(c) { return [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255]; }
  var ROCKS = ['#8d8a84', '#7d7a75', '#9a9690', '#6f6c68', '#857f77'].map(hexRgb), BASE = ['#7e7a63', '#857f6d'].map(hexRgb), SNOW = ['#f6f9fd', '#e9eff7', '#fbfcff'].map(hexRgb);
  function mountainMesh(d) {
    var S = 0.5, seed = d.seed, x0 = Math.floor(d.x0 - 0.5), z0 = Math.floor(d.z0 - 0.5), x1 = Math.ceil(d.x1 + 0.5), z1 = Math.ceil(d.z1 + 0.5);
    var nx = Math.round((x1 - x0) / S), nz = Math.round((z1 - z0) / S), H = [], i, j;
    function hv(x, z) { // высота с «неровностями»: чем выше — тем сильнее
      var h = heightAt(d, x, z); if (h <= 0) return 0;
      var n = vnoise(seed, 501 + d.sx * 7, x * 1.7, z * 1.7) - 0.5, t = h / d.H;
      return Math.max(0, h * (1 + n * 0.55) + (vnoise(seed, 502, x * 3.1, z * 3.1) - 0.5) * 0.16 * Math.min(1, t * 3));
    }
    var gx = [], gz = [];
    for (j = 0; j <= nz; j++) { gx[j] = []; gz[j] = []; H[j] = []; for (i = 0; i <= nx; i++) {
      var inner = i > 0 && j > 0 && i < nx && j < nz, jx = inner ? (r01(seed, i, j, 511 + d.sx) - 0.5) * 0.28 : 0, jz = inner ? (r01(seed, i, j, 512 + d.sz) - 0.5) * 0.28 : 0;
      gx[j][i] = x0 + i * S + jx; gz[j][i] = z0 + j * S + jz; H[j][i] = hv(gx[j][i], gz[j][i]);
    } }
    var pos = [], nor = [], col = [], ind = [], v = 0;
    function tri(a, b, c, k) {
      var ay = a[1], by = b[1], cy = c[1];
      if (ay <= 0 && by <= 0 && cy <= 0) return;
      // нормаль грани (правая система, y вверх): порядок вершин подобран так, чтобы нормаль смотрела вверх
      var ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], wx = c[0] - a[0], wy = c[1] - a[1], wz = c[2] - a[2];
      var nxv = uy * wz - uz * wy, nyv = uz * wx - ux * wz, nzv = ux * wy - uy * wx, l = Math.hypot(nxv, nyv, nzv) || 1;
      if (nyv < 0) { var t = b; b = c; c = t; nxv = -nxv; nyv = -nyv; nzv = -nzv; }
      nxv /= l; nyv /= l; nzv /= l;
      var ah = (ay + by + cy) / 3 / d.H, rnd = r01(seed, k, v, 520), cc;
      if (ah > 0.58 && nyv > 0.5) cc = SNOW[Math.floor(rnd * SNOW.length)];                        // снежная шапка
      else if (ah > 0.5 && nyv > 0.72) cc = SNOW[Math.floor(rnd * SNOW.length)];
      else if (ah < 0.14 && nyv > 0.55) cc = BASE[Math.floor(rnd * BASE.length)];                  // у подножия — земля
      else cc = ROCKS[Math.floor(rnd * ROCKS.length)];
      var sh = 0.86 + nyv * 0.14;                                                                // крутые грани чуть темнее
      [a, b, c].forEach(function (p) { pos.push(p[0], p[1], p[2]); nor.push(nxv, nyv, nzv); col.push(cc[0] * sh, cc[1] * sh, cc[2] * sh, 1); });
      ind.push(v, v + 1, v + 2); v += 3;
    }
    for (j = 0; j < nz; j++) for (i = 0; i < nx; i++) {
      var p00 = [gx[j][i], H[j][i], gz[j][i]], p10 = [gx[j][i + 1], H[j][i + 1], gz[j][i + 1]], p01 = [gx[j + 1][i], H[j + 1][i], gz[j + 1][i]], p11 = [gx[j + 1][i + 1], H[j + 1][i + 1], gz[j + 1][i + 1]];
      if ((i + j) % 2) { tri(p00, p10, p11, j * nx + i); tri(p00, p11, p01, j * nx + i + 1); } else { tri(p00, p10, p01, j * nx + i); tri(p10, p11, p01, j * nx + i + 1); }
    }
    return { pos: pos, nor: nor, col: col, ind: ind, tris: ind.length / 3 };
  }

  var API = {
    names: TREE_NAMES, START: START, FOOT: FOOT, T_BODY: T_BODY,
    cells: cells, mountains: mountains, mountainMesh: mountainMesh, heightAt: heightAt, treeLook: treeLook, boulders: boulders, r01: r01,
    _internals: { treeAt: treeAt, isRock: isRock, mountainOf: mountainOf, mtClass: mtClass, fbm: fbm, SP: [SP_A, SP_B], FOREST_T: FOREST_T }
  };
  if (typeof window !== 'undefined') window.TERRAIN = API;
  if (typeof module !== 'undefined') module.exports = API;
})();
