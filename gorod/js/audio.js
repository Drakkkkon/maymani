// «Мое_город» — звук и музыка (с 0.24.0).
// 1) Звуки действий (стройка, дорога, снос, покупка, ошибки, клики) синтезируются на лету через Web Audio — файлов для них нет.
// 2) Музыка — 110 классических произведений в папке music/ (первые 10 — MP3, остальные — AAC .m4a 96 кбит/с, записи Musopen: общественное достояние).
//    Плеер живёт в левом меню ☰: название трека над кнопками «назад / пауза / вперёд».
// Браузеры запрещают звук до первого касания, поэтому музыка и звуки включаются при первом нажатии на экран.
(function () {
  'use strict';
  var TRACKS = [
    {"f": "01_grieg_morning.mp3", "c": "Григ", "t": "Григ — «Утро»", "s": "Пер Гюнт, сюита № 1"},
    {"f": "02_grieg_anitra.mp3", "c": "Григ", "t": "Григ — «Сон Анитры»", "s": "Пер Гюнт, сюита № 1"},
    {"f": "03_grieg_mountain_king.mp3", "c": "Григ", "t": "Григ — «В пещере горного короля»", "s": "Пер Гюнт, сюита № 1"},
    {"f": "04_mozart_figaro.mp3", "c": "Моцарт", "t": "Моцарт — «Свадьба Фигаро»", "s": "увертюра"},
    {"f": "05_bach_goldberg_aria.mp3", "c": "Бах", "t": "Бах — Ария", "s": "Гольдберг-вариации"},
    {"f": "06_brahms_sym3_iii.mp3", "c": "Брамс", "t": "Брамс — Симфония № 3", "s": "III. Poco allegretto"},
    {"f": "07_brahms_sym2_iii.mp3", "c": "Брамс", "t": "Брамс — Симфония № 2", "s": "III. Allegretto grazioso"},
    {"f": "08_mendelssohn_italian_ii.mp3", "c": "Мендельсон", "t": "Мендельсон — «Итальянская» симфония", "s": "II. Andante con moto"},
    {"f": "09_mendelssohn_scottish_ii.mp3", "c": "Мендельсон", "t": "Мендельсон — «Шотландская» симфония", "s": "II. Vivace non troppo"},
    {"f": "10_borodin_steppes.mp3", "c": "Бородин", "t": "Бородин — «В степях Средней Азии»", "s": "музыкальная картина"},
    {"f": "c011_bach.m4a", "c": "Бах", "t": "Бах — Ария да капо", "s": "Гольдберг-вариации, BWV 988"},
    {"f": "c012_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 1", "s": "Гольдберг-вариации, BWV 988"},
    {"f": "c013_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 2", "s": "Гольдберг-вариации, BWV 988"},
    {"f": "c014_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 3", "s": "Гольдберг-вариации, BWV 988 · канон в унисон"},
    {"f": "c015_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 4", "s": "Гольдберг-вариации, BWV 988"},
    {"f": "c016_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 5", "s": "Гольдберг-вариации, BWV 988"},
    {"f": "c017_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 6", "s": "Гольдберг-вариации, BWV 988 · канон во второй"},
    {"f": "c018_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 7", "s": "Гольдберг-вариации, BWV 988"},
    {"f": "c019_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 8", "s": "Гольдберг-вариации, BWV 988"},
    {"f": "c020_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 9", "s": "Гольдберг-вариации, BWV 988 · канон в терцию"},
    {"f": "c021_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 10", "s": "Гольдберг-вариации, BWV 988 · фугетта"},
    {"f": "c022_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 12", "s": "Гольдберг-вариации, BWV 988 · канон в кварту"},
    {"f": "c023_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 13", "s": "Гольдберг-вариации, BWV 988"},
    {"f": "c024_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 14", "s": "Гольдберг-вариации, BWV 988"},
    {"f": "c025_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 15", "s": "Гольдберг-вариации, BWV 988 · канон в квинту"},
    {"f": "c026_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 16", "s": "Гольдберг-вариации, BWV 988 · увертюра"},
    {"f": "c027_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 18", "s": "Гольдберг-вариации, BWV 988 · канон в сексту"},
    {"f": "c028_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 19", "s": "Гольдберг-вариации, BWV 988"},
    {"f": "c029_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 21", "s": "Гольдберг-вариации, BWV 988 · канон в септиму"},
    {"f": "c030_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 22", "s": "Гольдберг-вариации, BWV 988"},
    {"f": "c031_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 25", "s": "Гольдберг-вариации, BWV 988"},
    {"f": "c032_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 29", "s": "Гольдберг-вариации, BWV 988"},
    {"f": "c033_bach.m4a", "c": "Бах", "t": "Бах — Вариация № 30", "s": "Гольдберг-вариации, BWV 988 · кводлибет"},
    {"f": "c034_beethoven.m4a", "c": "Бетховен", "t": "Бетховен — Увертюра «Кориолан»", "s": "соч. 62"},
    {"f": "c035_beethoven.m4a", "c": "Бетховен", "t": "Бетховен — Увертюра «Эгмонт»", "s": "соч. 84"},
    {"f": "c036_beethoven.m4a", "c": "Бетховен", "t": "Бетховен — Симфония № 3 «Героическая»", "s": "III. Scherzo Allegro vivace"},
    {"f": "c037_beethoven.m4a", "c": "Бетховен", "t": "Бетховен — Симфония № 3 «Героическая»", "s": "IV. Finale Allegro molto"},
    {"f": "c038_beethoven.m4a", "c": "Бетховен", "t": "Бетховен — Струнный квартет № 6, соч. 18", "s": "I. Allegro con brio"},
    {"f": "c039_beethoven.m4a", "c": "Бетховен", "t": "Бетховен — Струнный квартет № 6, соч. 18", "s": "II. Adagio ma non troppo"},
    {"f": "c040_beethoven.m4a", "c": "Бетховен", "t": "Бетховен — Струнный квартет № 6, соч. 18", "s": "III. Scherzo Allegro"},
    {"f": "c041_beethoven.m4a", "c": "Бетховен", "t": "Бетховен — Струнный квартет № 6, соч. 18", "s": "IV. (Adagio) La Malinconia"},
    {"f": "c042_borodin.m4a", "c": "Бородин", "t": "Бородин — Струнный квартет № 1", "s": "II. Andante con moto"},
    {"f": "c043_borodin.m4a", "c": "Бородин", "t": "Бородин — Струнный квартет № 1", "s": "III. Scherzo Prestissimo"},
    {"f": "c044_borodin.m4a", "c": "Бородин", "t": "Бородин — Струнный квартет № 1", "s": "IV. Andante - Allegro risoluto"},
    {"f": "c045_borodin.m4a", "c": "Бородин", "t": "Бородин — Струнный квартет № 2", "s": "I. Allegro moderato"},
    {"f": "c046_borodin.m4a", "c": "Бородин", "t": "Бородин — Струнный квартет № 2", "s": "II. Scherzo Allegro"},
    {"f": "c047_borodin.m4a", "c": "Бородин", "t": "Бородин — Струнный квартет № 2", "s": "III. Nocturne Andante"},
    {"f": "c048_borodin.m4a", "c": "Бородин", "t": "Бородин — Струнный квартет № 2", "s": "IV. Finale Andante - Vivace"},
    {"f": "c049_brahms.m4a", "c": "Брамс", "t": "Брамс — Симфония № 2", "s": "II. Adagio non toppo"},
    {"f": "c050_brahms.m4a", "c": "Брамс", "t": "Брамс — Симфония № 2", "s": "IV. Allegro Con Spirito"},
    {"f": "c051_brahms.m4a", "c": "Брамс", "t": "Брамс — Симфония № 1", "s": "II. Andante sostenuto"},
    {"f": "c052_brahms.m4a", "c": "Брамс", "t": "Брамс — Симфония № 1", "s": "III. Un poco allegretto e grazioso"},
    {"f": "c053_brahms.m4a", "c": "Брамс", "t": "Брамс — Симфония № 3", "s": "I. Allegro con brio"},
    {"f": "c054_brahms.m4a", "c": "Брамс", "t": "Брамс — Симфония № 3", "s": "II. Andante"},
    {"f": "c055_brahms.m4a", "c": "Брамс", "t": "Брамс — Симфония № 3", "s": "IV. Allegro"},
    {"f": "c056_brahms.m4a", "c": "Брамс", "t": "Брамс — Симфония № 4", "s": "II. Andante Moderato"},
    {"f": "c057_brahms.m4a", "c": "Брамс", "t": "Брамс — Симфония № 4", "s": "III. Allegro Giocoso"},
    {"f": "c058_brahms.m4a", "c": "Брамс", "t": "Брамс — Симфония № 4", "s": "IV. Allegro Energico e Passionato"},
    {"f": "c059_grieg.m4a", "c": "Григ", "t": "Григ — «Смерть Озе»", "s": "Пер Гюнт, сюита № 1"},
    {"f": "c060_haydn.m4a", "c": "Гайдн", "t": "Гайдн — Струнный квартет «Жаворонок», соч. 64", "s": "I. Allegro Moderato"},
    {"f": "c061_haydn.m4a", "c": "Гайдн", "t": "Гайдн — Струнный квартет «Жаворонок», соч. 64", "s": "II. Adagio, Cantabile"},
    {"f": "c062_haydn.m4a", "c": "Гайдн", "t": "Гайдн — Струнный квартет «Жаворонок», соч. 64", "s": "III. Menuetto Allegretto"},
    {"f": "c063_haydn.m4a", "c": "Гайдн", "t": "Гайдн — Струнный квартет «Жаворонок», соч. 64", "s": "IV. Finale Vivace"},
    {"f": "c064_dvorak.m4a", "c": "Дворжак", "t": "Дворжак — Струнный квартет № 12 «Американский»", "s": "I. Allegro ma non troppo"},
    {"f": "c065_dvorak.m4a", "c": "Дворжак", "t": "Дворжак — Струнный квартет № 12 «Американский»", "s": "II. Lento"},
    {"f": "c066_dvorak.m4a", "c": "Дворжак", "t": "Дворжак — Струнный квартет № 12 «Американский»", "s": "III. Molto Vivace"},
    {"f": "c067_dvorak.m4a", "c": "Дворжак", "t": "Дворжак — Струнный квартет № 12 «Американский»", "s": "IV. Finale - Vivace ma non troppo"},
    {"f": "c068_dvorak.m4a", "c": "Дворжак", "t": "Дворжак — Струнный квартет № 10, соч. 51", "s": "I. Allegro Ma Non Troppo"},
    {"f": "c069_dvorak.m4a", "c": "Дворжак", "t": "Дворжак — Струнный квартет № 10, соч. 51", "s": "II. Dumka"},
    {"f": "c070_dvorak.m4a", "c": "Дворжак", "t": "Дворжак — Струнный квартет № 10, соч. 51", "s": "III. Romanza"},
    {"f": "c071_dvorak.m4a", "c": "Дворжак", "t": "Дворжак — Струнный квартет № 10, соч. 51", "s": "IV. Finale Allegro Assai"},
    {"f": "c072_mendelssohn.m4a", "c": "Мендельсон", "t": "Мендельсон — «Итальянская» симфония", "s": "I. Allegro vivace"},
    {"f": "c073_mendelssohn.m4a", "c": "Мендельсон", "t": "Мендельсон — «Итальянская» симфония", "s": "III. Con moto moderato"},
    {"f": "c074_mendelssohn.m4a", "c": "Мендельсон", "t": "Мендельсон — «Итальянская» симфония", "s": "IV. Saltarello (Presto)"},
    {"f": "c075_mendelssohn.m4a", "c": "Мендельсон", "t": "Мендельсон — «Шотландская» симфония", "s": "III. Adagio"},
    {"f": "c076_mendelssohn.m4a", "c": "Мендельсон", "t": "Мендельсон — «Шотландская» симфония", "s": "IV. Allegro vivacissimo"},
    {"f": "c077_mendelssohn.m4a", "c": "Мендельсон", "t": "Мендельсон — Струнный квартет № 6, соч. 80", "s": "I. Allegro vivace assai"},
    {"f": "c078_mendelssohn.m4a", "c": "Мендельсон", "t": "Мендельсон — Струнный квартет № 6, соч. 80", "s": "II. Allegro assai"},
    {"f": "c079_mendelssohn.m4a", "c": "Мендельсон", "t": "Мендельсон — Струнный квартет № 6, соч. 80", "s": "III. Adagio"},
    {"f": "c080_mendelssohn.m4a", "c": "Мендельсон", "t": "Мендельсон — Струнный квартет № 6, соч. 80", "s": "IV. Fuga"},
    {"f": "c081_mozart.m4a", "c": "Моцарт", "t": "Моцарт — Увертюра к опере «Волшебная флейта»", "s": "K. 620"},
    {"f": "c082_mozart.m4a", "c": "Моцарт", "t": "Моцарт — Симфония № 4", "s": null},
    {"f": "c083_mozart.m4a", "c": "Моцарт", "t": "Моцарт — Симфония № 4", "s": "II. Andante"},
    {"f": "c084_mozart.m4a", "c": "Моцарт", "t": "Моцарт — Симфония № 4", "s": "III. Menuetto; Allegretto"},
    {"f": "c085_mozart.m4a", "c": "Моцарт", "t": "Моцарт — Симфония № 4", "s": "IV. Allegro assai"},
    {"f": "c086_mozart.m4a", "c": "Моцарт", "t": "Моцарт — Струнный квартет № 15, K. 421", "s": "I. Allegro Moderato"},
    {"f": "c087_mozart.m4a", "c": "Моцарт", "t": "Моцарт — Струнный квартет № 15, K. 421", "s": "II. Andante"},
    {"f": "c088_mozart.m4a", "c": "Моцарт", "t": "Моцарт — Струнный квартет № 15, K. 421", "s": "III. Minuetto"},
    {"f": "c089_mozart.m4a", "c": "Моцарт", "t": "Моцарт — Струнный квартет № 15, K. 421", "s": "IV. Allegro Ma Non Troppo"},
    {"f": "c090_mozart.m4a", "c": "Моцарт", "t": "Моцарт — Струнный квартет № 19 «Диссонансов», K. 465", "s": "II. Andante cantabile"},
    {"f": "c091_mozart.m4a", "c": "Моцарт", "t": "Моцарт — Струнный квартет № 19 «Диссонансов», K. 465", "s": "III. Minuetto. Allegretto"},
    {"f": "c092_mozart.m4a", "c": "Моцарт", "t": "Моцарт — Струнный квартет № 19 «Диссонансов», K. 465", "s": "IV. Allegro molto"},
    {"f": "c093_rimsky.m4a", "c": "Римский-Корсаков", "t": "Римский-Корсаков — Увертюра «Светлый праздник»", "s": "соч. 36"},
    {"f": "c094_schubert.m4a", "c": "Шуберт", "t": "Шуберт — Фортепианная соната, D 664", "s": "I. Allegro moderato"},
    {"f": "c095_schubert.m4a", "c": "Шуберт", "t": "Шуберт — Фортепианная соната, D 664", "s": "II. Andante"},
    {"f": "c096_schubert.m4a", "c": "Шуберт", "t": "Шуберт — Фортепианная соната, D 664", "s": "III. Allegro"},
    {"f": "c097_schubert.m4a", "c": "Шуберт", "t": "Шуберт — Фортепианная соната, D 784", "s": "II. Andante"},
    {"f": "c098_schubert.m4a", "c": "Шуберт", "t": "Шуберт — Фортепианная соната, D 784", "s": "III. Allegro vivace"},
    {"f": "c099_schubert.m4a", "c": "Шуберт", "t": "Шуберт — Фортепианная соната, D 845", "s": "III. Scherzo. Allegro vivace - Trio. Un poco piu lento"},
    {"f": "c100_schubert.m4a", "c": "Шуберт", "t": "Шуберт — Фортепианная соната, D 845", "s": "IV. Rondo. Allegro vivace"},
    {"f": "c101_schubert.m4a", "c": "Шуберт", "t": "Шуберт — Фортепианная соната, D 959", "s": "III. Scherzo. Allegro vivace"},
    {"f": "c102_schubert.m4a", "c": "Шуберт", "t": "Шуберт — Фортепианная соната, D 958", "s": "II. Adagio"},
    {"f": "c103_schubert.m4a", "c": "Шуберт", "t": "Шуберт — Фортепианная соната, D 958", "s": "III. Menuetto Allegro"},
    {"f": "c104_schubert.m4a", "c": "Шуберт", "t": "Шуберт — Фортепианная соната, D 568", "s": "II. Andante molto"},
    {"f": "c105_schubert.m4a", "c": "Шуберт", "t": "Шуберт — Фортепианная соната, D 568", "s": "III. Menuetto Allegretto"},
    {"f": "c106_smetana.m4a", "c": "Сметана", "t": "Сметана — «Влтава»", "s": "цикл «Моя родина»"},
    {"f": "c107_suk.m4a", "c": "Сук", "t": "Сук — «Размышление»", "s": "соч. 35а"},
    {"f": "c108_tchaikovsky.m4a", "c": "Чайковский", "t": "Чайковский — Симфония № 6 «Патетическая»", "s": "II. Allegro con gracia"},
    {"f": "c109_tchaikovsky.m4a", "c": "Чайковский", "t": "Чайковский — Симфония № 6 «Патетическая»", "s": "III. Allegro molto vivace"},
    {"f": "c110_tchaikovsky.m4a", "c": "Чайковский", "t": "Чайковский — Симфония № 6 «Патетическая»", "s": "IV. Finale Adagio lamentoso"}
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
    if (coverFor !== st.track) { coverFor = st.track; drawCover(tr); renderList(); }
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
  var seeking = false, coverFor = -1;
  // Обложка: рисуется на лету (портреты не скачиваем) — цвет и орнамент зависят от композитора
  var CC = {};
  function ccol(c) {
    if (CC[c]) return CC[c];
    var h = 0; for (var i = 0; i < c.length; i++) h = (h * 31 + c.charCodeAt(i)) % 360;
    return (CC[c] = h);
  }
  function drawCover(tr) {
    var cv = $('plCover'); if (!cv || !cv.getContext) return;
    var g = cv.getContext('2d'), W = cv.width, hue = ccol(tr.c);
    var gr = g.createLinearGradient(0, 0, W, W);
    gr.addColorStop(0, 'hsl(' + hue + ',45%,30%)'); gr.addColorStop(1, 'hsl(' + ((hue + 40) % 360) + ',50%,16%)');
    g.fillStyle = gr; g.fillRect(0, 0, W, W);
    g.strokeStyle = 'hsla(' + hue + ',60%,75%,.25)'; g.lineWidth = 2;
    for (var k = 0; k < 5; k++) { g.beginPath(); g.moveTo(8, 30 + k * 10); g.bezierCurveTo(40, 12 + k * 10, 70, 56 + k * 10, W - 8, 28 + k * 10); g.stroke(); }
    g.fillStyle = 'rgba(255,230,160,.95)'; g.font = 'bold 46px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(tr.c.charAt(0), W / 2, W / 2 - 4);
    g.font = '13px sans-serif'; g.fillStyle = 'rgba(255,255,255,.85)';
    g.fillText(tr.c.length > 12 ? tr.c.slice(0, 11) + '.' : tr.c, W / 2, W - 14);
  }
  function renderList() {
    var box = $('plList'); if (!box) return;
    var q = (($('plSearch') || {}).value || '').trim().toLowerCase(), out = '', n = 0;
    for (var i = 0; i < TRACKS.length; i++) {
      var t = TRACKS[i];
      if (q && (t.c + ' ' + t.t + ' ' + t.s).toLowerCase().indexOf(q) < 0) continue;
      n++; var dup = TRACKS.some(function (u, j) { return j !== i && u.t === t.t; });
      out += '<button class="pl-row' + (i === st.track ? ' on' : '') + '" type="button" data-i="' + i + '"><i style="background:hsl(' + ccol(t.c) + ',55%,55%)"></i><span>' + (dup && t.s ? t.t + ' · ' + t.s : t.t).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span><small>' + (i + 1) + '</small></button>';
    }
    box.innerHTML = out || '<div class="pl-empty">Ничего не найдено</div>';
    var on = box.querySelector('.on'); if (on && !q) box.scrollTop = Math.max(0, on.offsetTop - 60);
  }
  function bindUi() {
    if (!$('plPlayer')) return;
    $('plPrev').addEventListener('click', function () { prev(); });
    $('plNext').addEventListener('click', function () { next(true); });
    $('plPlay').addEventListener('click', function () { toggle(); });
    $('plSfx').addEventListener('click', function () { st.sfx = !st.sfx; save(); ui(); if (st.sfx) sfx('ui'); });
    $('plVol').addEventListener('input', function () { st.vol = this.value / 100; au.volume = st.vol; save(); });
    $('plSfxVol').addEventListener('input', function () { st.sfxVol = this.value / 100; if (master) master.gain.value = st.sfxVol; save(); });
    $('plSfxVol').addEventListener('change', function () { sfx('done'); });
    $('plSearch').addEventListener('input', function () { renderList(); });
    $('plList').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('.pl-row') : null; if (!b) return;
      go(+b.getAttribute('data-i'), true);
    });
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
