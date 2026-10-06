/**
 * SoundManager - Web Audio API puro (sin dependencias externas).
 *
 * SFX y jingles cortos (victory/gameover) se descargan y decodifican por
 * completo antes de sonar (son chicos, rapido). Las pistas de musica que
 * loopean (menu/battle) van por <audio> + MediaElementSource en cambio:
 * el navegador las va transmitiendo (streaming) y empiezan a sonar apenas
 * hay buffer suficiente, sin esperar el archivo entero - importante
 * porque estas pistas pueden pesar varias decenas de MB y bloquear TODO
 * el audio (incluidos los SFX) detras de esa descarga si se tratan igual
 * que el resto.
 */
class SoundManager {
  constructor(config) {
    this.config = config;
    this.ctx = null;
    this.buffers = new Map();       // sfx + jingles (victory/gameover)
    this.bgmTrackNames = ['menu', 'battle']; // streameadas, no bloquean el resto
    this.bgmElements = new Map();   // name -> { el, gain }
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.currentBgmName = null;
    this.stepSource = null;
    this.stepPlaying = false;
    this.unlocked = false;

    this.volumes = this._loadVolumes();
  }

  _loadVolumes() {
    try {
      const raw = localStorage.getItem('incaBomberman.volumes');
      if (raw) return JSON.parse(raw);
    } catch (e) { /* localStorage unavailable, use defaults */ }
    return { master: 0.8, music: 0.6, sfx: 0.9 };
  }

  _saveVolumes() {
    try {
      localStorage.setItem('incaBomberman.volumes', JSON.stringify(this.volumes));
    } catch (e) { /* ignore */ }
  }

  async init() {
    if (this.ctx) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AudioContextClass();

    this.masterGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();

    this.musicGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);

    this.setMasterVolume(this.volumes.master);
    this.setMusicVolume(this.volumes.music);
    this.setSfxVolume(this.volumes.sfx);

    // no se espera (no await): el streaming se resuelve solo, no debe
    // bloquear el resto de la carga de audio.
    this._prepareStreamedBgm();

    const bufferedEntries = [
      ...Object.entries(this.config.AUDIO.sfx),
      ...Object.entries(this.config.AUDIO.bgm).filter(([name]) => !this.bgmTrackNames.includes(name))
    ];
    await Promise.all(bufferedEntries.map(([name, url]) => this._load(name, url)));
  }

  async unlock() {
    if (this.unlocked) return;
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    this.unlocked = true;
  }

  _prepareStreamedBgm() {
    this.bgmTrackNames.forEach((name) => {
      const url = this.config.AUDIO.bgm[name];
      if (!url) return;
      const el = new Audio(url);
      el.preload = 'auto';
      el.loop = true;
      let source;
      try {
        source = this.ctx.createMediaElementSource(el);
      } catch (err) {
        console.warn(`[SoundManager] No se pudo enrutar "${name}" (${url}):`, err.message);
        return;
      }
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(this.musicGain);
      el.addEventListener('error', () => {
        console.warn(`[SoundManager] No se pudo cargar "${name}" (${url})`);
      });
      this.bgmElements.set(name, { el, gain });
    });
  }

  async _load(name, url) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
      this.buffers.set(name, audioBuffer);
    } catch (err) {
      console.warn(`[SoundManager] No se pudo cargar "${name}" (${url}):`, err.message);
    }
  }

  _makeSource(name, { loop = false, volume = 1 } = {}) {
    const buffer = this.buffers.get(name);
    if (!buffer || !this.ctx) return null;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    source.connect(gain);
    return { source, gain };
  }

  playSfx(name, opts = {}) {
    if (!this.ctx) return null;
    const built = this._makeSource(name, opts);
    if (!built) return null;
    built.gain.connect(this.sfxGain);
    built.source.start(0);
    return built.source;
  }

  playBgm(name, { fadeMs = 600 } = {}) {
    if (!this.ctx) return;
    if (this.currentBgmName === name) return;
    const track = this.bgmElements.get(name);
    this.stopBgm(fadeMs);
    if (!track) return;

    const { el, gain } = track;
    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + fadeMs / 1000);
    try { el.currentTime = 0; } catch (e) { /* aun no hay metadata cargada, no pasa nada */ }
    el.play().catch((err) => console.warn(`[SoundManager] No se pudo reproducir "${name}":`, err.message));

    this.currentBgmName = name;
  }

  stopBgm(fadeMs = 300) {
    if (!this.currentBgmName) return;
    const track = this.bgmElements.get(this.currentBgmName);
    this.currentBgmName = null;
    if (!track) return;

    const { el, gain } = track;
    const now = this.ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + fadeMs / 1000);
    setTimeout(() => { try { el.pause(); } catch (e) { /* ya pausado */ } }, fadeMs + 50);
  }

  playJingle(name) {
    this.stopBgm(200);
    this.playSfx(name, { volume: 1 });
  }

  startStepLoop() {
    if (this.stepPlaying || !this.ctx) return;
    const built = this._makeSource('step', { loop: true, volume: 0.7 });
    if (!built) return;
    built.gain.connect(this.sfxGain);
    built.source.start(0);
    this.stepSource = built.source;
    this.stepPlaying = true;
  }

  stopStepLoop() {
    if (!this.stepPlaying) return;
    try { this.stepSource.stop(); } catch (e) { /* already stopped */ }
    this.stepSource = null;
    this.stepPlaying = false;
  }

  setMasterVolume(v) {
    this.volumes.master = v;
    if (this.masterGain) this.masterGain.gain.value = v;
    this._saveVolumes();
  }

  setMusicVolume(v) {
    this.volumes.music = v;
    if (this.musicGain) this.musicGain.gain.value = v;
    this._saveVolumes();
  }

  setSfxVolume(v) {
    this.volumes.sfx = v;
    if (this.sfxGain) this.sfxGain.gain.value = v;
    this._saveVolumes();
  }
}

window.SoundManager = SoundManager;
