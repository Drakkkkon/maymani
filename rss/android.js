'use strict';
/* Внутри приложения Android (window.MLApp) нет озвучки, «Поделиться» и скачивания: передаём их приложению. */
if (window.MLApp) {
  let current = null, number = 0;
  window.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; this.rate = 1; this.lang = 'ru-RU'; } };
  const synth = {
    speaking: false, pending: false,
    getVoices: () => [],
    speak(u) { current = u; u.id = String(++number); this.speaking = true; MLApp.speak(u.text, u.lang, u.rate, u.id); },
    cancel() { current = null; this.speaking = false; MLApp.stopSpeak(); }
  };
  Object.defineProperty(window, 'speechSynthesis', {value: synth, configurable: true});
  window.mlTts = (id, event) => {
    const u = current;
    if (!u || u.id !== id) return;
    if (event === 'start') return u.onstart?.();
    synth.speaking = false; current = null;
    if (event === 'end') u.onend?.(); else u.onerror?.({error: 'synthesis-failed'});
  };
  Object.defineProperty(navigator, 'share', {value: async d => MLApp.share(d.title || '', d.url || ''), configurable: true});
  window.download = (name, text, type) => MLApp.save(name, text, type);
}
