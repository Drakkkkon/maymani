// «Мое_город» — звук и музыка (с 0.24.0).
// 1) Звуки действий (стройка, дорога, снос, покупка, ошибки, клики) синтезируются на лету через Web Audio — файлов для них нет.
// 2) Музыка — 10 классических произведений в папке music/ (MP3, 256 кбит/с, записи Musopen: общественное достояние).
//    Плеер живёт в левом меню ☰: название трека над кнопками «назад / пауза / вперёд».
// Браузеры запрещают звук до первого касания, поэтому музыка и звуки включаются при первом нажатии на экран.
(function () {
  'use strict';
  var TRACKS = [
    { f: '01_grieg_morning.mp3',           t: 'Григ — «Утро»',                         s: 'Пер Гюнт, сюита № 1' },
    { f: '02_grieg_anitra.mp3',            t: 'Григ — «Сон Анитры»',                s: 'Пер Гюнт, сюита № 1' },
    { f: '03_grieg_mountain_king.mp3',     t: 'Григ — «В пещере горного короля»',      s: 'Пер Гюнт, сюита № 1' },
    { f: '04_mozart_figaro.mp3',           t: 'Моцарт — «Свадьба Фигаро»',             s: 'увертюра' },
    { f: '05_bach_goldberg_aria.mp3',      t: 'Бах — Ария',                            s: 'Гольдберг-вариации' },
    { f: '06_brahms_sym3_iii.mp3',         t: 'Брамс — Симфония № 3',                  s: 'III. Poco allegretto' },
    { f: '07_brahms_sym2_iii.mp3',         t: 'Брамс — Симфония № 2',                  s: 'III. Allegretto grazioso' },
    { f: '08_mendelssohn_italian_ii.mp3',  t: 'Мендельсон — «Итальянская» симфония',   s: 'II. Andante con moto' },
    { f: '09_mendelssohn_scottish_ii.mp3', t: 'Мендельсон — «Шотландская» симфония',   s: 'II. Vivace non troppo' },
    { f: '10_borodin_steppes.mp3',         t: 'Бородин — «В степях Средней Азии»',  s: 'музыкальная картина' }
  ];
  var KEY = 'moe_gorod_audio';
  var $ = function (id) { return document.getElementById(id); };

  // ---------- Настройки (запоминаются на устройстве) ----------
  var st = { track: 0, vol: 0.5, music: true, sfx: true, sfxVol: 0.7 };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && typeof saved === 'object') {
      if (typeof saved.track === 'number' && saved.track >= 0 && saved.track < TRACKS.length) st.track = saved.track | 0;
      if (typeof saved.vol === 'number') st.vol = Math.min(1, Math.max(0, saved.vol));
      if (typeof saved.sfxVol === 'number') st.sfxVol = Math.min(1, Math.max(0, saved.sfxVol));
      if (typeof saved.music === 'boolean') st.music = saved.music;
      if (typeof saved.sfx === 'boolean') st.sfx = saved.sfx;
    }
  } catch (e) {}
  function save() { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) {} }

  // ---------- Музыка ----------
  var au = new Audio();
  au.preload = 'none';
  au.volume = st.vol;
  var loadedTrack = -1;   // какой трек сейчас загружен в элемент <audio>
  var want = st.music;    // хотим ли, чтобы музыка играла (пока браузер может её не пустить без касания)
  var failed = 0;         // сколько треков подряд не открылось (чтобы не крутить по кругу без конца)

  function trackUrl(i) { return 'music/' + TRACKS[i].f; }
  function fmt(s) { if (!isFinite(s) || s < 0) return '0:00'; s = Math.floor(s); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }

  function load(i) {
    if (loadedTrack === i) return;
    loadedTrack = i;
    au.src = trackUrl(i);
  }
  function play() {
    want = true; st.music = true; save();
    load(st.track);
    var p = au.play();
    if (p && p.catch) p.catch(function (err) {
      // автозапуск не разрешён — подождём первого касания (want остаётся true)
      if (err && err.name === 'NotAllowedError') return;
      if (err && err.name === 'AbortError') return;
      failed++; if (failed < TRACKS.length) next(true);
    });
    ui();
  }
  function pause() { want = false; st.music = false; save(); au.pause(); ui(); }
  function toggle() { if (!au.paused && want) pause(); else play(); }
  function go(i, keepPlaying) {
    st.track = (i + TRACKS.length) % TRACKS.length; save();
    loadedTrack = -1;
    if (keepPlaying) play(); else { load(st.track); ui(); }
  }
  function next(keep) { go(st.track + 1, keep !== false && want); }
  function prev() {
    // если трек играет уже больше 4 секунд — «назад» начинает его заново, как в обычном плеере
    if (au.currentTime > 4 && loadedTrack === st.track) { au.currentTime = 0; ui(); return; }
    go(st.track - 1, want);
  }
  au.addEventListener('ended', function () { failed = 0; next(true); });
  au.addEventListener('playing', function () { failed = 0; ui(); });
  au.addEventListener('pause', ui);
  au.addEventListener('timeupdate', tickUi);
  au.addEventListener('loadedmetadata', tickUi);
  au.addEventListener('error', function () {
    if (!au.src || loadedTrack < 0) return;
    failed++;
    var t = $('plSub'); if (t) t.textContent = 'файл не открылся — пробуем следующий';
    if (want && failed < TRACKS.length) setTimeout(function () { next(true); }, 600);
  });
  // Вкладка ушла в фон — музыку на паузу, вернулись — продолжаем
  var pausedByHide = false;
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { if (!au.paused) { pausedByHide = true; au.pause(); } }
    else if (pausedByHide) { pausedByHide = false; if (want) { var p = au.play(); if (p && p.catch) p.catch(function () {}); } }
  });

  // ---------- Плеер в левом меню ----------
  function ui() {
    var tr = TRACKS[st.track], on = want && !au.paused;
    var ti = $('plTitle'); if (!ti) return;
    ti.textContent = '🎵 ' + tr.t;
    ti.title = tr.t + ' · ' + tr.s;
    $('plPlay').textContent = on ? '⏸' : '▶';
    $('plPlay').setAttribute('aria-label', on ? 'Пауза' : 'Играть');
    $('plSfx').textContent = st.sfx ? '🔊' : '🔇';
    $('plSfx').setAttribute('aria-pressed', st.sfx ? 'true' : 'false');
    $('plSfx').title = st.sfx ? 'Звуки игры включены' : 'Звуки игры выключены';
    $('plVol').value = Math.round(st.vol * 100);
    $('plSfxVol').value = Math.round(st.sfxVol * 100);
    $('plPlayer').classList.toggle('playing', on);
    tickUi();
  }
  function tickUi() {
    var sub = $('plSub'); if (!sub) return;
    var tr = TRACKS[st.track], d = au.duration, cur = loadedTrack === st.track ? au.currentTime : 0;
    var on = want && !au.paused;
    sub.textContent = (st.track + 1) + ' / ' + TRACKS.length + ' · ' + tr.s + (isFinite(d) && loadedTrack === st.track ? ' · ' + fmt(cur) + ' / ' + fmt(d) : (on ? ' · загрузка…' : ''));
    var sk = $('plSeek');
    if (sk && !seeking) sk.value = isFinite(d) && d > 0 && loadedTrack === st.track ? Math.round(cur / d * 1000) : 0;
  }
  var seeking = false;
  function bindUi() {
    if (!$('plPlayer')) return;
    $('plPrev').addEventListener('click', function () { prev(); });
    $('plNext').addEventListener('click', function () { next(true); });
    $('plPlay').addEventListener('click', function () { toggle(); });
    $('plSfx').addEventListener('click', function () { st.sfx = !st.sfx; save(); ui(); if (st.sfx) sfx('ui'); });
    $('plVol').addEventListener('input', function () { st.vol = this.value / 100; au.volume = st.vol; save(); });
    $('plSfxVol').addEventListener('input', function () { st.sfxVol = this.value / 100; if (master) master.gain.value = st.sfxVol; save(); });
    $('plSfxVol').addEventListener('change', function () { sfx('done'); });
    var sk = $('plSeek');
    sk.addEventListener('input', function () { seeking = true; });
    sk.addEventListener('change', function () {
      seeking = false;
      if (loadedTrack === st.track && isFinite(au.duration)) au.currentTime = au.duration * sk.value / 1000;
      else { play(); }
    });
    ui();
  }

  // ---------- Звуки действий (синтез) ----------
  var ctx = null, master = null, noiseBuf = null, lastAt = {};
  function ensureCtx() {
    if (ctx) { if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} } return ctx; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = st.sfxVol;
      var comp = ctx.createDynamicsCompressor();
      master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      var d = noiseBuf.getChannelData(0); for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ctx = null; }
    return ctx;
  }
  function tone(f0, t0, dur, type, vol, f1) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t0);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.012, dur / 4)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.03);
  }
  function noise(t0, dur, vol, type, f0, f1, q) {
    var s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noiseBuf; s.loop = true;
    fl.type = type || 'lowpass'; fl.frequency.setValueAtTime(f0, t0); if (f1) fl.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t0 + dur); fl.Q.value = q || 0.8;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + Math.min(0.01, dur / 3)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(fl); fl.connect(g); g.connect(master); s.start(t0, Math.random() * 0.5); s.stop(t0 + dur + 0.03);
  }
  function knock(t, vol, pitch) { noise(t, 0.07, 0.5 * vol, 'lowpass', 900, 200, 1); tone(pitch || 150, t, 0.11, 'triangle', 0.55 * vol, (pitch || 150) * 0.55); }
  // название: [минимальная пауза между такими звуками в секундах, функция]
  var SND = {
    ui:     [0.04, function (t) { tone(760, t, 0.05, 'triangle', 0.10, 520); }],
    tool:   [0.06, function (t) { tone(520, t, 0.06, 'triangle', 0.12, 700); }],
    open:   [0.1,  function (t) { noise(t, 0.2, 0.18, 'bandpass', 300, 1800, 1.2); }],
    close:  [0.1,  function (t) { noise(t, 0.2, 0.16, 'bandpass', 1800, 300, 1.2); }],
    place:  [0.15, function (t) { knock(t, 1, 160); knock(t + 0.11, 0.8, 140); knock(t + 0.24, 0.9, 170); }],
    drop:   [0.15, function (t) { knock(t, 0.9, 130); tone(300, t + 0.02, 0.1, 'sine', 0.08, 200); }],
    work:   [0.35, function (t) { knock(t, 0.28, 190 + Math.random() * 60); if (Math.random() < 0.5) knock(t + 0.13, 0.2, 170 + Math.random() * 50); }],
    chop:   [0.25, function (t) { noise(t, 0.05, 0.3, 'bandpass', 1400, 600, 2); tone(220, t, 0.09, 'square', 0.12, 110); }],
    done:   [0.3,  function (t) { tone(784, t, 0.5, 'sine', 0.22); tone(988, t + 0.11, 0.5, 'sine', 0.2); tone(1175, t + 0.22, 0.8, 'sine', 0.2); tone(1568, t + 0.22, 0.8, 'sine', 0.06); }],
    road:   [0.07, function (t) { noise(t, 0.06, 0.28, 'highpass', 1800, 1200, 0.7); tone(110, t, 0.05, 'sine', 0.12); }],
    roadx:  [0.07, function (t) { noise(t, 0.09, 0.3, 'bandpass', 900, 350, 1); }],
    del:    [0.12, function (t) { noise(t, 0.34, 0.5, 'lowpass', 1600, 160, 0.9); tone(95, t, 0.3, 'sawtooth', 0.2, 45); }],
    buy:    [0.2,  function (t) { tone(1319, t, 0.09, 'square', 0.09); tone(1760, t + 0.09, 0.35, 'square', 0.1); noise(t, 0.05, 0.12, 'highpass', 5000, 5000, 1); }],
    sell:   [0.2,  function (t) { tone(1760, t, 0.09, 'square', 0.09); tone(1175, t + 0.09, 0.3, 'square', 0.09); }],
    error:  [0.45, function (t) { tone(190, t, 0.1, 'square', 0.13); tone(142, t + 0.11, 0.16, 'square', 0.13); }],
    mm:     [0.2,  function (t) { tone(660, t, 0.07, 'triangle', 0.09, 880); }]
  };
  function sfx(name) {
    if (!st.sfx) return;
    var def = SND[name]; if (!def) return;
    var now = performance.now() / 1000;
    if (lastAt[name] && now - lastAt[name] < def[0]) return;
    if (!ensureCtx() || ctx.state !== 'running') return;   // пока браузер не разрешил звук — молчим
    lastAt[name] = now;
    try { def[1](ctx.currentTime + 0.005); } catch (e) { if (!sfx.warned) { sfx.warned = 1; console.warn('Мое_город: звук «' + name + '» не сыгран', e); } }
  }

  // ---------- Первое касание: разрешаем звук и стартуем музыку ----------
  var unlocked = false;
  function unlock() {
    if (unlocked) return;
    unlocked = true;
    ensureCtx();
    if (want) play();
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { document.removeEventListener(ev, unlock, true); });
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, unlock, true); });

  // Щелчок по любой кнопке меню — тихий «тик» (звуки самих действий — отдельно, из game.js)
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('button, .chip, .bcard, [role="menuitem"], summary');
    if (!b || b.disabled || b.closest('#plPlayer') || b.dataset.nosnd != null) return;
    sfx('ui');
  }, true);

  window.MoeAudio = { sfx: sfx, play: play, pause: pause, next: function () { next(true); }, prev: prev, tracks: TRACKS, state: function () { return st; }, el: au };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindUi); else bindUi();
})();
