// «Мое_город» — расчёт жителей в отдельном фоновом потоке (Web Worker).
// Жители хранятся не как 3D-человечки, а как числа в плотных массивах (typed arrays):
// так можно держать сотни тысяч людей и не тормозить картинку.
(function () {
  'use strict';

  // Ядро расчёта. Работает внутри потока; если потоков нет — прямо на странице.
  // data: { homes: [[id, x, z, adults, total], ...], works: [[id, x, z, slots], ...] }
  function simCore(data) {
    var t0 = Date.now();
    var H = data.homes, W = data.works, nh = H.length, nw = W.length, i, j, k;

    // --- Люди: у каждого дом и работа (-1 — нет работы) ---
    var P = 0;
    for (i = 0; i < nh; i++) P += H[i][4];
    var pHome = new Int32Array(P), pWork = new Int32Array(P).fill(-1), pAdult = new Uint8Array(P);
    var p = 0;
    for (i = 0; i < nh; i++) {
      for (k = 0; k < H[i][4]; k++) { pHome[p] = i; pAdult[p] = k < H[i][3] ? 1 : 0; p++; }
    }

    // --- Работа: сетка-корзины, чтобы быстро искать ближайшую ---
    var CS = 8, minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9;
    var free = new Int32Array(nw), slots = 0;
    for (j = 0; j < nw; j++) {
      free[j] = W[j][3]; slots += W[j][3];
      if (W[j][1] < minX) minX = W[j][1]; if (W[j][1] > maxX) maxX = W[j][1];
      if (W[j][2] < minZ) minZ = W[j][2]; if (W[j][2] > maxZ) maxZ = W[j][2];
    }
    var gw = nw ? Math.floor((maxX - minX) / CS) + 1 : 0, gh = nw ? Math.floor((maxZ - minZ) / CS) + 1 : 0;
    var cells = [];
    for (i = 0; i < gw * gh; i++) cells.push([]);
    for (j = 0; j < nw; j++) cells[Math.floor((W[j][2] - minZ) / CS) * gw + Math.floor((W[j][1] - minX) / CS)].push(j);

    // --- Каждый взрослый ищет работу поближе к дому ---
    var homeEmp = new Int32Array(nh), workFill = new Int32Array(nw), left = slots, employed = 0;
    p = 0;
    for (i = 0; i < nh && left > 0; i++) {
      var need = H[i][3], first = p;
      while (p < P && pHome[p] === i) p++;
      if (!need) continue;
      var hx = H[i][1], hz = H[i][2];
      var cx = Math.floor((hx - minX) / CS), cz = Math.floor((hz - minZ) / CS), maxR = Math.max(gw, gh) + Math.abs(cx) + Math.abs(cz);
      var q = first;
      for (var r = 0; r <= maxR && need > 0; r++) {
        var cand = [];
        for (var zz = cz - r; zz <= cz + r; zz++) {
          if (zz < 0 || zz >= gh) continue;
          for (var xx = cx - r; xx <= cx + r; xx++) {
            if (xx < 0 || xx >= gw) continue;
            if (Math.max(Math.abs(xx - cx), Math.abs(zz - cz)) !== r) continue; // только кольцо
            var c = cells[zz * gw + xx];
            for (k = 0; k < c.length; k++) if (free[c[k]] > 0) cand.push(c[k]);
          }
        }
        if (!cand.length) continue;
        cand.sort(function (a, b) {
          var da = (W[a][1] - hx) * (W[a][1] - hx) + (W[a][2] - hz) * (W[a][2] - hz);
          var db = (W[b][1] - hx) * (W[b][1] - hx) + (W[b][2] - hz) * (W[b][2] - hz);
          return da - db;
        });
        for (k = 0; k < cand.length && need > 0; k++) {
          var w = cand[k];
          while (free[w] > 0 && need > 0) {
            while (q < p && !pAdult[q]) q++;
            if (q >= p) { need = 0; break; }
            pWork[q++] = w; free[w]--; workFill[w]++; homeEmp[i]++; employed++; left--; need--;
          }
        }
      }
    }

    var adults = 0;
    for (i = 0; i < nh; i++) adults += H[i][3];
    var hOut = [], wOut = [];
    for (i = 0; i < nh; i++) hOut.push([H[i][0], homeEmp[i]]);
    for (j = 0; j < nw; j++) wOut.push([W[j][0], workFill[j]]);
    return {
      people: P, adults: adults, employed: employed, unemployed: adults - employed,
      jobs: slots, freeJobs: slots - employed, homes: hOut, works: wOut, ms: Date.now() - t0
    };
  }

  var worker = null, busy = false, pending = null, cb = null;
  try {
    var src = simCore.toString() + '\nself.onmessage = function (e) { self.postMessage(simCore(e.data)); };';
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = function (e) { busy = false; if (cb) cb(e.data); next(); };
    worker.onerror = function () { worker = null; busy = false; next(); };
  } catch (e) { worker = null; }

  function next() {
    if (!pending || busy) return;
    var d = pending; pending = null; busy = true;
    if (worker) worker.postMessage(d);
    else setTimeout(function () { var r = simCore(d); busy = false; if (cb) cb(r); next(); }, 0);
  }

  window.SIM = {
    core: simCore,
    threaded: function () { return !!worker; },
    onResult: function (f) { cb = f; },
    // Последний запрос важнее: если поток занят, старый ждущий запрос заменяется новым.
    run: function (data) { pending = data; next(); }
  };
})();
