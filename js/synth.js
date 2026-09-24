// =========================================================
// synth.js — sintetizador por astro (estilo Operator)
// =========================================================
//
// Dimensiones de comportamiento:
//
//   modo:              "continuo" | "region"
//      Cómo se mapea la posición zodiacal a frecuencia.
//
//   modoTrigger:       "drone" | "envelope"
//      Cómo se sostiene cada voz cuando está activa.
//
//   modoReproduccion:  "acorde" | "secuencia"
//      Cuántas voces suenan a la vez.
//
//   fmAlgoritmo:       id de FM_ALGORITMOS ("paralelo", "cadenas2".."cadenas9", "serie10")
//      Ruteo entre astros (clon del Operator de Ableton): cada
//      algoritmo parte los 10 astros en cadenas; en paralelo todos
//      son carriers (síntesis aditiva) y en las cadenas los astros
//      superiores MODULAN la frecuencia de los de abajo (FM).
//
// Cada astro tiene además forma de onda propia (senoidal, triangular,
// cuadrada, sierra, ruido o personalizada por armónicos pares/impares)
// y volumen individual.
// =========================================================

const SYNTH_STORAGE_KEY = "cas-synth-config-v1";
const NUM_ARMONICOS = 24;

const synth = {
  ctx: null,
  masterGain: null,
  voices: [],
  enabled: false,
  masterVolume: 0.12,

  modo: "continuo",
  modoTrigger: "drone",
  modoReproduccion: "acorde",

  // Todos marcados de inicio: al abrir el programa por primera vez ya
  // hay astros listos para sonar (luego se recuerda la selección).
  planetEnabled: new Array(10).fill(true),
  planetVolume: new Array(10).fill(0.5),
  planetPan: new Array(10).fill(0),        // -1 (izq) .. 1 (der), por astro
  planetMuted: new Array(10).fill(false),
  planetSolo: new Array(10).fill(false),
  planetSalida: new Array(10).fill(null),    // id de salida virtual asignada (o null)
  planetEnMaster: new Array(10).fill(true),  // si el astro suma al grupo Maestro
  planetFreq: new Array(10).fill(0),

  // ----- Salida de baja latencia: TODO el contexto (Maestro incluido)
  // apuntado a un dispositivo real vía AudioContext.setSinkId(), sin el
  // salto por MediaStreamDestination/<audio> que usan las salidas
  // virtuales por canal (ese salto agrega cientos de ms de buffer del
  // pipeline de medios). Por eso es "todo o nada": un solo destino para
  // el mezclador completo, no por canal -----
  salidaBajaLatenciaDeviceId: null,

  // ----- Bus del secuenciador (mezclador): todas las voces-astro
  // (carriers) pasan por aquí antes del master, así se puede bajar/
  // silenciar/solear/panear el secuenciador entero sin tocar el piano -----
  volumenSecuenciador: 1,
  panSecuenciadorValor: 0,
  secuenciadorMuted: false,
  secuenciadorSolo: false,
  salidaSecuenciador: null,     // id de salida virtual asignada al grupo del secuenciador
  enMasterSecuenciador: true,   // si el secuenciador suma al grupo Maestro
  busSecuenciador: null,
  nodoPanSecuenciador: null,
  meterMaster: null,
  meterSecuenciador: null,

  octavaPorPlaneta: [0, 1, 0, 0, -1, -1, -2, 1, 0, -2],

  // ----- Forma de onda por astro -----
  formaOnda: new Array(10).fill("sine"),
  armonicosPares: new Array(10).fill(0.5),    // 0..1
  armonicosImpares: new Array(10).fill(0.5),  // 0..1

  // ----- FM (estilo Operator) -----
  fmAlgoritmo: "paralelo",
  fmProfundidad: 2.0,  // índice de modulación 0..20
  // Multiplicador por astro (0..2, default 1) sobre fmProfundidad: solo
  // pesa cuando ESE astro actúa como MODULADOR en la cadena activa.
  fmProfundidadAstro: new Array(10).fill(1),

  // ----- Filtros por astro (post-gain, no afectan el tap de FM) -----
  planetHPF: new Array(10).fill(20),      // Hz — 20 ≈ filtro apagado
  planetHPFQ: new Array(10).fill(0.707),
  planetLPF: new Array(10).fill(20000),   // Hz — 20000 ≈ filtro apagado
  planetLPFQ: new Array(10).fill(0.707),

  // ADSR global (el que edita "Todos los astros") y ADSR individual
  adsr: { attack: 0.05, decay: 0.20, sustain: 0.70, release: 0.40 },
  adsrAstro: Array.from({ length: 10 }, () =>
    ({ attack: 0.05, decay: 0.20, sustain: 0.70, release: 0.40 })),

  // Curvatura de cada tramo del envelope, en [-1, 1] (0 = lineal).
  // El tramo sigue f(u) = u^(2^(2c)): c < 0 arranca rápido (convexo),
  // c > 0 arranca lento (cóncavo). Global + por astro, como el ADSR.
  adsrCurva: { attack: 0, decay: 0, release: 0 },
  adsrCurvaAstro: Array.from({ length: 10 }, () =>
    ({ attack: 0, decay: 0, release: 0 })),

  envelopeActiva: new Array(10).fill(false),

  // Libro de registro del envelope programado por voz (puntos {t, v}).
  // Permite anclar las rampas con setValueAtTime en el valor correcto:
  // sin ancla, linearRamp parte del ÚLTIMO evento (puede ser de hace
  // segundos) y la voz sube de volumen antes de tiempo → notas pegadas,
  // clics al disparar y attacks sin pendiente audible.
  _envPuntos: Array.from({ length: 10 }, () => []),

  // ----- MIDI: mapear astros a C4..A4 (60..69) -----
  midiAstros: true,

  // ----- Secuenciador (reloj de audio con lookahead, sin jitter) -----
  ordenSecuencia: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  bpm: 120,
  gate: 0.7,
  figuraSecuencia: "negra",
  // Figura propia por astro (null = usa la figura global)
  figuraPorAstro: new Array(10).fill(null),
  // Peso de cada figura al aleatorizar ritmos (id → 0..PESO_FIGURA_MAX,
  // ausente = 1). Cuanto mayor, más probable; 0 la excluye.
  pesosFiguras: {},
  secuenciaActiva: false,
  _secStepActual: -1,
  _secGrupoActual: null,
  _secIdx: -1,
  _secNextTime: 0,
  _secScheduler: null,
  _secPendientes: [],

  _noiseBuffer: null,

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) {
      console.warn("[synth] Web Audio API no disponible");
      return;
    }
    // latencyHint interactive: buffers cortos para respuesta MIDI inmediata
    this.ctx = new AC({ latencyHint: "interactive" });
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.0001;

    // Limitador: evita el clipping (clics/distorsión) cuando suenan
    // muchas voces a la vez, sin añadir latencia perceptible.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -12;
    this.limiter.knee.value = 10;
    this.limiter.ratio.value = 12;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.25;

    this.masterGain.connect(this.limiter);
    this.limiter.connect(this.ctx.destination);

    // Medidor del maestro: toma del limitador, sin afectar la señal.
    this.meterMaster = this.ctx.createAnalyser();
    this.meterMaster.fftSize = 512;
    this.limiter.connect(this.meterMaster);

    // Bus del secuenciador: todas las voces-astro (carriers) confluyen
    // aquí antes del master (ver _aplicarRuteo). Permite fader/pan/
    // mute/solo del secuenciador entero, independiente del piano.
    this.busSecuenciador = this.ctx.createGain();
    this.busSecuenciador.gain.value = this.volumenSecuenciador * this._factorBusSecuenciador();
    this.nodoPanSecuenciador = this.ctx.createStereoPanner();
    this.nodoPanSecuenciador.pan.value = this.panSecuenciadorValor;
    this.meterSecuenciador = this.ctx.createAnalyser();
    this.meterSecuenciador.fftSize = 512;
    this.busSecuenciador.connect(this.nodoPanSecuenciador);
    // El resto del ruteo de nodoPanSecuenciador (Maestro + salida virtual)
    // lo arma _aplicarRuteoGrupos(), llamado desde _aplicarRuteo() al final.

    for (let i = 0; i < 10; i++) {
      const osc = this.ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = 440;
      osc.start();

      const bandpass = this.ctx.createBiquadFilter();
      bandpass.type = "bandpass";
      bandpass.frequency.value = 440;
      bandpass.Q.value = 14;

      const gain = this.ctx.createGain();
      gain.gain.value = 0.0001;

      // modGain: salida de esta voz cuando actúa como MODULADOR FM
      const modGain = this.ctx.createGain();
      modGain.gain.value = 0;

      // hpf/lpf: filtros de tono por astro, en cadena fija gain→hpf→lpf.
      // El tap de FM (modGain) lee de `gain` ANTES de estos filtros, así
      // no se recalibra la profundidad de modulación existente.
      const hpf = this.ctx.createBiquadFilter();
      hpf.type = "highpass";
      hpf.frequency.value = this.planetHPF[i];
      hpf.Q.value = this.planetHPFQ[i];

      const lpf = this.ctx.createBiquadFilter();
      lpf.type = "lowpass";
      lpf.frequency.value = this.planetLPF[i];
      lpf.Q.value = this.planetLPFQ[i];

      // panNode: solo se usa cuando la voz es carrier (ver _aplicarRuteo)
      const panNode = this.ctx.createStereoPanner();
      panNode.pan.value = this.planetPan[i];

      // meterNode: medidor por astro, siempre alimentado desde el final
      // de la cadena de filtros (aunque el astro actúe como modulador y
      // no suene directo).
      const meterNode = this.ctx.createAnalyser();
      meterNode.fftSize = 512;

      this.voices.push({ osc, bandpass, gain, modGain, hpf, lpf, panNode, meterNode, noiseSrc: null, esRuido: false });
    }

    for (let i = 0; i < 10; i++) {
      this._aplicarFormaOnda(i);
    }
    this._aplicarRuteo();

    // Si el usuario ya había elegido una salida de baja latencia en una
    // sesión anterior, re-aplicarla ahora que el contexto existe.
    if (this.salidaBajaLatenciaDeviceId) this._aplicarSalidaBajaLatencia();
  },

  enable() {
    if (!this.ctx) this.init();
    if (!this.ctx) return;
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.enabled = true;
    this._aplicarMaster();
    if (this.modoReproduccion === "acorde" && this.modoTrigger === "drone") {
      for (let i = 0; i < 10; i++) this._aplicarGainDrone(i);
    }
  },

  disable() {
    this.enabled = false;
    if (this.secuenciaActiva) this.detenerSecuencia();
    this._aplicarMaster();
  },

  toggle() {
    if (this.enabled) this.disable();
    else this.enable();
  },

  setMasterVolume(v) {
    this.masterVolume = clamp(v, 0, 1);
    this._aplicarMaster();
    this._guardarConfig();
  },

  soportaSalidaBajaLatencia() {
    return typeof AudioContext !== "undefined" && "setSinkId" in AudioContext.prototype;
  },

  async setSalidaBajaLatencia(deviceId) {
    this.salidaBajaLatenciaDeviceId = deviceId || null;
    this._guardarConfig();
    return this._aplicarSalidaBajaLatencia();
  },

  async _aplicarSalidaBajaLatencia() {
    if (!this.ctx || !this.soportaSalidaBajaLatencia()) return false;
    try {
      // "" = dispositivo predeterminado del sistema (mismo convenio que
      // HTMLMediaElement.setSinkId).
      await this.ctx.setSinkId(this.salidaBajaLatenciaDeviceId || "");
      return true;
    } catch (e) {
      console.warn("[synth] no se pudo cambiar la salida de baja latencia", e);
      return false;
    }
  },

  setPlanetEnabled(i, on) {
    this.planetEnabled[i] = on;
    // Se persiste: al abrir el programa los astros vuelven marcados
    this._guardarConfig();

    if (this.modoReproduccion === "secuencia") {
      if (!on && this._secStepActual === i) {
        this.triggerRelease(i);
        this._secStepActual = -1;
      }
      return;
    }

    if (this.modoTrigger === "drone") {
      // Los astros conectados (grupo FM) se encienden/apagan juntos
      if (this.ctx) {
        for (const k of this.grupoDeAstro(i)) this._aplicarGainDrone(k);
      }
    } else {
      if (on) this.triggerAttackGrupo(i);
      else this.triggerReleaseGrupo(i);
    }
  },

  setPlanetVolume(i, v) {
    this.planetVolume[i] = clamp(v, 0, 1);
    if (this.modoReproduccion === "acorde" && this.modoTrigger === "drone") {
      this._aplicarGainDrone(i);
    }
    this._guardarConfig();
  },

  setPlanetPan(i, v) {
    this.planetPan[i] = clamp(v, -1, 1);
    const voz = this.voices[i];
    if (voz && voz.panNode) {
      voz.panNode.pan.setTargetAtTime(this.planetPan[i], this.ctx.currentTime, 0.01);
    }
    this._guardarConfig();
  },

  setPlanetMuted(i, on) {
    this.planetMuted[i] = !!on;
    this._refrescarAudibleAstros();
    this._guardarConfig();
  },

  setPlanetSolo(i, on) {
    this.planetSolo[i] = !!on;
    this._refrescarAudibleAstros();
    this._guardarConfig();
  },

  setPlanetSalida(i, id) {
    this.planetSalida[i] = id || null;
    this._aplicarRuteo();
    this._guardarConfig();
  },

  setPlanetEnMaster(i, on) {
    this.planetEnMaster[i] = !!on;
    this._aplicarRuteo();
    this._guardarConfig();
  },

  // Factor 0/1 de mute+solo de un astro: se multiplica al volumen en
  // cada cálculo de gain (drone y envelope), igual que planetVolume.
  // Las notas del piano lo consultan también (mismo astro = mismo
  // instrumento, sin importar quién lo dispare).
  _factorAstro(i) {
    if (this.planetMuted[i]) return 0;
    const haySolo = this.planetSolo.some(s => s);
    return (haySolo && !this.planetSolo[i]) ? 0 : 1;
  },

  _refrescarAudibleAstros() {
    if (this.ctx && this.modoReproduccion === "acorde" && this.modoTrigger === "drone") {
      for (let i = 0; i < 10; i++) this._aplicarGainDrone(i);
    }
  },

  // -------------------- Bus del secuenciador --------------------

  setVolumenSecuenciador(v) {
    this.volumenSecuenciador = clamp(v, 0, 1);
    this._aplicarVolumenBusSecuenciador();
    this._guardarConfig();
  },

  setPanSecuenciador(v) {
    this.panSecuenciadorValor = clamp(v, -1, 1);
    if (this.nodoPanSecuenciador) {
      this.nodoPanSecuenciador.pan.setTargetAtTime(this.panSecuenciadorValor, this.ctx.currentTime, 0.01);
    }
    this._guardarConfig();
  },

  setMuteSecuenciador(on) {
    this.secuenciadorMuted = !!on;
    this.refrescarVolumenesGrupos();
    this._guardarConfig();
  },

  setSoloSecuenciador(on) {
    this.secuenciadorSolo = !!on;
    this.refrescarVolumenesGrupos();
    this._guardarConfig();
  },

  setSalidaSecuenciador(id) {
    this.salidaSecuenciador = id || null;
    this._aplicarRuteoGrupos();
    this._guardarConfig();
  },

  setEnMasterSecuenciador(on) {
    this.enMasterSecuenciador = !!on;
    this._aplicarRuteoGrupos();
    this._guardarConfig();
  },

  // Solo entre las FUENTES del mezclador (Secuenciador 1, Secuenciador 2
  // y cada instrumento del piano): si alguna está soleada, las demás se
  // callan. Cada fuente calcula su factor con esto.
  haySoloEnGrupos() {
    if (this.secuenciadorSolo) return true;
    if (typeof secuenciador2 !== "undefined" && secuenciador2.solo) return true;
    if (typeof piano !== "undefined" && piano.instrumentos.some(inst => inst.solo)) return true;
    return false;
  },

  // Tras cambiar un mute/solo de grupo hay que recalcular TODOS los buses
  refrescarVolumenesGrupos() {
    this._aplicarVolumenBusSecuenciador();
    if (typeof secuenciador2 !== "undefined") secuenciador2._aplicarVolumenBus();
    if (typeof piano !== "undefined") piano._aplicarVolumenBuses();
  },

  _factorBusSecuenciador() {
    if (this.secuenciadorMuted) return 0;
    return (this.haySoloEnGrupos() && !this.secuenciadorSolo) ? 0 : 1;
  },

  _aplicarVolumenBusSecuenciador() {
    if (!this.busSecuenciador || !this.ctx) return;
    const v = this.volumenSecuenciador * this._factorBusSecuenciador();
    this.busSecuenciador.gain.setTargetAtTime(v, this.ctx.currentTime, 0.01);
  },

  setModo(modo) {
    if (modo !== "continuo" && modo !== "region") return;
    this.modo = modo;
    if (typeof estado !== "undefined") this.updateFromAstros(estado.astros);
    this._guardarConfig();
  },

  setModoTrigger(modo) {
    if (modo !== "drone" && modo !== "envelope") return;
    if (this.ctx) {
      for (let i = 0; i < 10; i++) this._silenciarInmediato(i);
    }
    this.modoTrigger = modo;
    for (let i = 0; i < 10; i++) {
      this.planetEnabled[i] = false;
      this.envelopeActiva[i] = false;
    }
    this._guardarConfig();
  },

  setModoReproduccion(modo) {
    if (modo !== "acorde" && modo !== "secuencia") return;
    if (this.modoReproduccion === modo) return;

    if (this.secuenciaActiva) this.detenerSecuencia();
    if (this.ctx) {
      for (let i = 0; i < 10; i++) {
        this._silenciarInmediato(i);
        this.envelopeActiva[i] = false;
      }
    }

    this.modoReproduccion = modo;

    if (modo === "acorde" && this.modoTrigger === "drone") {
      for (let i = 0; i < 10; i++) this._aplicarGainDrone(i);
    }
    this._guardarConfig();
  },

  setOctavaPlaneta(i, octava) {
    octava = clamp(Math.round(octava), -4, 4);
    this.octavaPorPlaneta[i] = octava;
    if (typeof estado !== "undefined") {
      this._aplicarFrecuenciaPlaneta(i, estado.astros);
    }
    this._guardarConfig();
  },

  setADSR(param, value) {
    if (!["attack", "decay", "sustain", "release"].includes(param)) return;
    this.adsr[param] = (param === "sustain") ? clamp(value, 0, 1) : clamp(value, 0.001, 5);
    this._guardarConfig();
  },

  // ADSR por astro. target = -1 aplica a "Todos" (global + cada astro).
  setADSRAstro(target, param, value) {
    if (!["attack", "decay", "sustain", "release"].includes(param)) return;
    const v = (param === "sustain") ? clamp(value, 0, 1) : clamp(value, 0.001, 5);
    if (target === -1) {
      this.adsr[param] = v;
      for (let i = 0; i < 10; i++) this.adsrAstro[i][param] = v;
    } else if (target >= 0 && target < 10) {
      this.adsrAstro[target][param] = v;
    }
    this._guardarConfig();
  },

  _adsrDe(i) {
    return this.adsrAstro[i] || this.adsr;
  },

  // Curvatura por tramo. target = -1 aplica a "Todos" (global + cada astro).
  setADSRCurva(target, param, value) {
    if (!["attack", "decay", "release"].includes(param)) return;
    const v = clamp(value, -1, 1);
    if (target === -1) {
      this.adsrCurva[param] = v;
      for (let i = 0; i < 10; i++) this.adsrCurvaAstro[i][param] = v;
    } else if (target >= 0 && target < 10) {
      this.adsrCurvaAstro[target][param] = v;
    }
    this._guardarConfig();
  },

  _curvaDe(i) {
    return this.adsrCurvaAstro[i] || this.adsrCurva;
  },

  // Programa un tramo del envelope de v0 a v1 con curvatura. Las curvas
  // se aproximan con rampas lineales muestreadas: así el libro de
  // registro (_envPuntos) sigue siendo lineal a trozos y el anclaje de
  // triggerAttack/Release no cambia.
  _programarSegmento(param, puntos, v0, v1, t0, dur, curva) {
    if (Math.abs(curva) < 0.01) {
      const v = Math.max(v1, 0.0001);
      param.linearRampToValueAtTime(v, t0 + dur);
      puntos.push({ t: t0 + dur, v });
      return;
    }
    const gamma = Math.pow(2, curva * 2);
    const N = 6;
    for (let k = 1; k <= N; k++) {
      const u = k / N;
      const v = Math.max(v0 + (v1 - v0) * Math.pow(u, gamma), 0.0001);
      param.linearRampToValueAtTime(v, t0 + dur * u);
      puntos.push({ t: t0 + dur * u, v });
    }
  },

  // Valor del envelope de la voz i en el tiempo t según lo programado
  _valorEnvelopeEn(i, t) {
    const pts = this._envPuntos[i];
    if (!pts || pts.length === 0) return 0.0001;
    if (t <= pts[0].t) return pts[0].v;
    for (let k = 0; k < pts.length - 1; k++) {
      if (t <= pts[k + 1].t) {
        const a = pts[k], b = pts[k + 1];
        if (b.t - a.t < 1e-6) return b.v;
        return a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t);
      }
    }
    return pts[pts.length - 1].v;
  },

  setMidiAstros(on) {
    this.midiAstros = !!on;
    this._guardarConfig();
  },

  // -------------------- Forma de onda --------------------

  setFormaOnda(i, id) {
    if (!FORMAS_ONDA.some(f => f.id === id)) return;
    this.formaOnda[i] = id;
    this._aplicarFormaOnda(i);
    this._guardarConfig();
  },

  setArmonicos(i, pares, impares) {
    this.armonicosPares[i] = clamp(pares, 0, 1);
    this.armonicosImpares[i] = clamp(impares, 0, 1);
    if (this.formaOnda[i] === "custom") this._aplicarFormaOnda(i);
    this._guardarConfig();
  },

  _crearNoiseBuffer() {
    if (this._noiseBuffer) return this._noiseBuffer;
    const sr = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, sr * 2, sr);
    const data = buffer.getChannelData(0);
    for (let n = 0; n < data.length; n++) data[n] = Math.random() * 2 - 1;
    this._noiseBuffer = buffer;
    return buffer;
  },

  // Onda personalizada del astro i a partir de sus armónicos pares e
  // impares. También la usa el modo piano para clonar el timbre.
  _ondaPersonalizada(i) {
    return this._ondaDesdeArmonicos(this.armonicosPares[i], this.armonicosImpares[i]);
  },

  // Misma onda a partir de pesos sueltos: la usan los conjuntos de
  // timbre (timbre.js), que guardan sus propios armónicos.
  _ondaDesdeArmonicos(pares, impares) {
    const real = new Float32Array(NUM_ARMONICOS + 1);
    const imag = new Float32Array(NUM_ARMONICOS + 1);
    imag[1] = 1;  // fundamental siempre presente
    for (let n = 2; n <= NUM_ARMONICOS; n++) {
      const peso = (n % 2 === 0) ? pares : impares;
      imag[n] = peso / n;
    }
    return this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  },

  // Conecta la fuente correcta (osc o ruido filtrado) al gain de la voz
  _aplicarFormaOnda(i) {
    if (!this.ctx) return;
    const v = this.voices[i];
    const forma = this.formaOnda[i];

    // Desconectar fuentes actuales del gain
    try { v.osc.disconnect(); } catch (e) {}
    try { v.bandpass.disconnect(); } catch (e) {}

    if (forma === "noise") {
      if (!v.noiseSrc) {
        const src = this.ctx.createBufferSource();
        src.buffer = this._crearNoiseBuffer();
        src.loop = true;
        src.start();
        src.connect(v.bandpass);
        v.noiseSrc = src;
      }
      // Ruido filtrado por pasa-banda centrado en la frecuencia del astro
      v.bandpass.connect(v.gain);
      v.esRuido = true;
      return;
    }

    v.esRuido = false;

    if (forma === "custom") {
      v.osc.setPeriodicWave(this._ondaPersonalizada(i));
    } else {
      v.osc.type = forma;  // sine | triangle | square | sawtooth
    }

    v.osc.connect(v.gain);
  },

  // -------------------- FM: ruteo estilo Operator --------------------

  // Devuelve { carriers: Set<number>, mods: [{de, a}] }.
  // Las cadenas se construyen sobre el ORDEN actual de los astros
  // (ordenSecuencia): reordenar con drag&drop o ↑↓ cambia quién
  // modula a quién. La partición en cadenas viene del algoritmo:
  // el primer astro de cada tramo es el carrier y los siguientes
  // modulan en serie al anterior.
  rutasFM() {
    const alg = FM_ALGORITMOS.find(a => a.id === this.fmAlgoritmo) || FM_ALGORITMOS[0];
    const o = this.ordenSecuencia;
    const mods = [];
    const carriers = new Set();

    let idx = 0;
    for (const tam of alg.cadenas) {
      carriers.add(o[idx]);
      for (let k = 1; k < tam; k++) {
        mods.push({ de: o[idx + k], a: o[idx + k - 1] });
      }
      idx += tam;
    }
    return { carriers, mods };
  },

  // Grupos de astros conectados (carrier + su cadena de moduladores).
  // Un astro solo cumple su función si suena junto con su grupo.
  gruposFM() {
    const { carriers, mods } = this.rutasFM();
    const moduladorDe = {};
    mods.forEach(m => { moduladorDe[m.a] = m.de; });
    return [...carriers].map(c => {
      const grupo = [c];
      let actual = c;
      while (moduladorDe[actual] !== undefined) {
        actual = moduladorDe[actual];
        grupo.push(actual);
      }
      return grupo;
    });
  },

  grupoDeAstro(i) {
    return this.gruposFM().find(g => g.includes(i)) || [i];
  },

  // Disparar/soltar el grupo completo de un astro (los conectados
  // suenan al mismo tiempo para que la modulación FM se escuche).
  triggerAttackGrupo(i, t) {
    for (const k of this.grupoDeAstro(i)) this.triggerAttack(k, t);
  },

  triggerReleaseGrupo(i, t) {
    for (const k of this.grupoDeAstro(i)) this.triggerRelease(k, t);
  },

  setFmAlgoritmo(id) {
    if (!FM_ALGORITMOS.some(a => a.id === id)) return;
    this.fmAlgoritmo = id;
    this._aplicarRuteo();
    this._guardarConfig();
  },

  setFmProfundidad(v) {
    this.fmProfundidad = clamp(v, 0, 20);
    this._actualizarProfundidadesFM();
    this._guardarConfig();
  },

  setFmProfundidadAstro(i, v) {
    this.fmProfundidadAstro[i] = clamp(v, 0, 2);
    this._actualizarProfundidadesFM();
    this._guardarConfig();
  },

  // -------------------- Filtros por astro (HPF/LPF) --------------------

  setPlanetHPF(i, hz) {
    this.planetHPF[i] = clamp(hz, 20, 20000);
    const v = this.voices[i];
    if (v) v.hpf.frequency.setTargetAtTime(this.planetHPF[i], this.ctx.currentTime, 0.01);
    this._guardarConfig();
  },

  setPlanetHPFQ(i, q) {
    this.planetHPFQ[i] = clamp(q, 0.1, 18);
    const v = this.voices[i];
    if (v) v.hpf.Q.setTargetAtTime(this.planetHPFQ[i], this.ctx.currentTime, 0.01);
    this._guardarConfig();
  },

  setPlanetLPF(i, hz) {
    this.planetLPF[i] = clamp(hz, 20, 20000);
    const v = this.voices[i];
    if (v) v.lpf.frequency.setTargetAtTime(this.planetLPF[i], this.ctx.currentTime, 0.01);
    this._guardarConfig();
  },

  setPlanetLPFQ(i, q) {
    this.planetLPFQ[i] = clamp(q, 0.1, 18);
    const v = this.voices[i];
    if (v) v.lpf.Q.setTargetAtTime(this.planetLPFQ[i], this.ctx.currentTime, 0.01);
    this._guardarConfig();
  },

  _aplicarRuteo() {
    if (!this.ctx) return;
    if (typeof salidasAudio !== "undefined") salidasAudio._asegurarTodosLosNodos();
    const { carriers, mods } = this.rutasFM();

    for (let i = 0; i < 10; i++) {
      const v = this.voices[i];
      try { v.gain.disconnect(); } catch (e) {}
      try { v.modGain.disconnect(); } catch (e) {}
      try { v.hpf.disconnect(); } catch (e) {}
      try { v.lpf.disconnect(); } catch (e) {}
      try { v.panNode.disconnect(); } catch (e) {}
    }

    for (let i = 0; i < 10; i++) {
      const v = this.voices[i];
      // Cadena de filtros fija: gain→hpf→lpf. El medidor por astro cuelga
      // del final de la cadena, siempre activo sin importar el rol
      // (carrier o modulador), para que el mezclador refleje su envelope.
      v.gain.connect(v.hpf);
      v.hpf.connect(v.lpf);
      v.lpf.connect(v.meterNode);
      if (carriers.has(i)) {
        v.lpf.connect(v.panNode);
        // "En Master" decide si suma al grupo del secuenciador (y de ahí
        // al Maestro); la salida virtual es un envío aparte, independiente.
        if (this.planetEnMaster[i]) v.panNode.connect(this.busSecuenciador);
        const salida = typeof salidasAudio !== "undefined" ? salidasAudio.nodoGain(this.planetSalida[i]) : null;
        if (salida) v.panNode.connect(salida);
      }
    }

    for (const m of mods) {
      const vDe = this.voices[m.de];
      const vA = this.voices[m.a];
      // La voz moduladora entra (vía modGain como profundidad) a la
      // frecuencia del oscilador destino y de su filtro de ruido.
      vDe.gain.connect(vDe.modGain);
      vDe.modGain.connect(vA.osc.frequency);
      vDe.modGain.connect(vA.bandpass.frequency);
    }

    this._actualizarProfundidadesFM();
    this._aplicarRuteoGrupos();

    // Los grupos cambiaron: re-aplicar los gains de drone
    if (this.modoReproduccion === "acorde" && this.modoTrigger === "drone") {
      for (let i = 0; i < 10; i++) this._aplicarGainDrone(i);
    }
  },

  // Ruteo de los buses de GRUPO (secuenciador completo y piano) hacia
  // el Maestro y/o su salida virtual asignada. Separado de _aplicarRuteo
  // (que es por astro) porque cambia con setters propios de cada grupo,
  // sin tocar el FM.
  _aplicarRuteoGrupos() {
    if (!this.ctx) return;
    if (typeof salidasAudio !== "undefined") salidasAudio._asegurarTodosLosNodos();
    if (this.nodoPanSecuenciador) {
      try { this.nodoPanSecuenciador.disconnect(); } catch (e) {}
      this.nodoPanSecuenciador.connect(this.meterSecuenciador);
      if (this.enMasterSecuenciador) this.nodoPanSecuenciador.connect(this.masterGain);
      const salida = typeof salidasAudio !== "undefined" ? salidasAudio.nodoGain(this.salidaSecuenciador) : null;
      if (salida) this.nodoPanSecuenciador.connect(salida);
    }
    if (typeof piano !== "undefined") piano._aplicarRuteoGrupos();
    if (typeof secuenciador2 !== "undefined") secuenciador2._aplicarRuteoGrupo();
  },

  // La profundidad escala con la frecuencia del astro DESTINO
  // (como el índice de modulación de un FM clásico).
  _actualizarProfundidadesFM() {
    if (!this.ctx) return;
    const { mods } = this.rutasFM();
    const now = this.ctx.currentTime;
    for (const m of mods) {
      const freqDestino = Math.max(20, this.planetFreq[m.a] || 220);
      // El gain de la voz moduladora llega como máx. ~0.4, compensamos ×2.5.
      // fmProfundidadAstro[m.de] es el multiplicador propio del astro que
      // está modulando (0..2, default 1).
      const profundidad = freqDestino * this.fmProfundidad * this.fmProfundidadAstro[m.de] * 2.5;
      this.voices[m.de].modGain.gain.setTargetAtTime(profundidad, now, 0.02);
    }
  },

  // -------------------- Secuenciador --------------------

  setBPM(v) {
    this.bpm = clamp(Math.round(v), BPM_MIN, BPM_MAX);
    this._guardarConfig();
  },

  setGate(v) {
    this.gate = clamp(v, 0.05, 1);
    this._guardarConfig();
  },

  setFiguraSecuencia(id) {
    if (!FIGURAS_SECUENCIA.some(f => f.id === id)) return;
    this.figuraSecuencia = id;
    this._guardarConfig();
  },

  factorFiguraActual() {
    const f = FIGURAS_SECUENCIA.find(x => x.id === this.figuraSecuencia);
    return f ? f.factor : 1;
  },

  setFiguraAstro(i, id) {
    if (id !== null && !FIGURAS_SECUENCIA.some(f => f.id === id)) return;
    this.figuraPorAstro[i] = id;
    this._guardarConfig();
  },

  // Reset de ritmos: todas las filas vuelven a la figura global ("=")
  restablecerFiguras() {
    this.figuraPorAstro = new Array(10).fill(null);
    this._guardarConfig();
  },

  // Aplica un patrón completo de figuras (lo usa rhythms.js al
  // recuperar un ritmo guardado o al encadenarlos). Los valores que no
  // sean una figura válida caen en "=" (figura global).
  aplicarPatronFiguras(arr) {
    if (!Array.isArray(arr) || arr.length !== 10) return false;
    for (let i = 0; i < 10; i++) {
      const v = arr[i];
      this.figuraPorAstro[i] =
        (typeof v === "string" && FIGURAS_SECUENCIA.some(f => f.id === v)) ? v : null;
    }
    this._guardarConfig();
    return true;
  },

  pesoFigura(id) {
    const v = this.pesosFiguras[id];
    return (typeof v === "number") ? clamp(Math.round(v), 0, PESO_FIGURA_MAX) : 1;
  },

  setPesoFigura(id, peso) {
    if (!FIGURAS_SECUENCIA.some(f => f.id === id)) return;
    this.pesosFiguras[id] = clamp(Math.round(peso), 0, PESO_FIGURA_MAX);
    this._guardarConfig();
  },

  // Ritmos aleatorios: asigna a cada astro una figura sorteada según
  // los pesos. Devuelve false si todos los pesos están en 0.
  aleatorizarFiguras() {
    const bolsa = [];
    for (const f of FIGURAS_SECUENCIA) {
      const peso = this.pesoFigura(f.id);
      for (let k = 0; k < peso; k++) bolsa.push(f.id);
    }
    if (!bolsa.length) return false;
    for (let i = 0; i < 10; i++) {
      this.figuraPorAstro[i] = bolsa[Math.floor(Math.random() * bolsa.length)];
    }
    this._guardarConfig();
    return true;
  },

  // Duración del paso de un astro: su figura propia o la global
  factorFiguraDe(i) {
    const id = this.figuraPorAstro[i];
    const f = id ? FIGURAS_SECUENCIA.find(x => x.id === id) : null;
    return f ? f.factor : this.factorFiguraActual();
  },

  setOrdenSecuencia(arr) {
    if (!Array.isArray(arr) || arr.length !== 10) return;
    const sorted = [...arr].map(Number).sort((a, b) => a - b);
    if (sorted.some((v, i) => v !== i)) return;
    this.ordenSecuencia = arr.map(Number);
    this._ordenCambiado();
  },

  subirEnOrden(planeta) {
    const idx = this.ordenSecuencia.indexOf(planeta);
    if (idx <= 0) return false;
    const tmp = this.ordenSecuencia[idx - 1];
    this.ordenSecuencia[idx - 1] = this.ordenSecuencia[idx];
    this.ordenSecuencia[idx] = tmp;
    this._ordenCambiado();
    return true;
  },

  bajarEnOrden(planeta) {
    const idx = this.ordenSecuencia.indexOf(planeta);
    if (idx === -1 || idx >= 9) return false;
    const tmp = this.ordenSecuencia[idx + 1];
    this.ordenSecuencia[idx + 1] = this.ordenSecuencia[idx];
    this.ordenSecuencia[idx] = tmp;
    this._ordenCambiado();
    return true;
  },

  // Drag & drop: mueve `astro` a la posición que ocupa `destino`
  moverEnOrden(astro, destino) {
    const arr = this.ordenSecuencia;
    const de = arr.indexOf(astro);
    const a = arr.indexOf(destino);
    if (de === -1 || a === -1 || de === a) return false;
    arr.splice(de, 1);
    arr.splice(a, 0, astro);
    this._ordenCambiado();
    return true;
  },

  restablecerOrden() {
    this.ordenSecuencia = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    this._ordenCambiado();
  },

  // Alineamiento inverso: Plutón → Sol
  ordenInverso() {
    this.ordenSecuencia = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
    this._ordenCambiado();
  },

  // Alineamiento aleatorio (Fisher-Yates)
  ordenAleatorio() {
    const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    this.ordenSecuencia = arr;
    this._ordenCambiado();
  },

  // Alineamiento por región tonal: ordena por índice de microtono, así
  // los astros con notas cercanas (o en la misma región) quedan juntos
  ordenPorRegion(astros) {
    if (!astros || astros.length < 10) return false;
    const region = {};
    for (let i = 0; i < 10; i++) region[i] = this.microtonoDeAstro(i, astros);
    this.ordenSecuencia = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].sort((a, b) => {
      if (region[a] === region[b]) return a - b;
      if (region[a] < 0) return 1;   // sin datos: al final
      if (region[b] < 0) return -1;
      return region[a] - region[b];
    });
    this._ordenCambiado();
    return true;
  },

  // El orden define secuencia, mapeo MIDI y cadenas FM
  _ordenCambiado() {
    this._guardarConfig();
    if (this.ctx) this._aplicarRuteo();
  },

  // t0 (opcional): instante del AudioContext del primer paso. Lo usa
  // "▶▶ Ambos" para arrancar los dos secuenciadores alineados.
  iniciarSecuencia(t0) {
    if (this.secuenciaActiva) return;
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    if (!this.enabled) {
      this.enabled = true;
      this._aplicarMaster();
    }
    if (this.modoReproduccion !== "secuencia") {
      this.setModoReproduccion("secuencia");
    }
    this.secuenciaActiva = true;
    this._secIdx = -1;
    this._secStepActual = -1;
    this._secGrupoActual = null;
    this._secPendientes = [];
    this._secNextTime = (typeof t0 === "number") ? Math.max(t0, this.ctx.currentTime) : this.ctx.currentTime + 0.05;
    // La cadena de ritmos (rhythms.js) manda el patrón del primer
    // eslabón antes de programar el primer paso.
    if (typeof ritmos !== "undefined") ritmos.iniciarCadena();
    this._programarPasos();
    this._secScheduler = setInterval(() => this._programarPasos(), 25);
  },

  // Play "de ejecución libre": arranca la secuencia y, si ya estaba
  // sonando, la corta y la relanza desde el primer paso. Como pasa por
  // detenerSecuencia() + iniciarSecuencia(), la cadena de ritmos también
  // vuelve a su primer eslabón: el disparo siempre deja todo en el
  // punto inicial, suene lo que suene en ese momento.
  reiniciarSecuencia() {
    if (this.secuenciaActiva) this.detenerSecuencia();
    this.iniciarSecuencia();
  },

  detenerSecuencia() {
    this.secuenciaActiva = false;
    if (this._secScheduler) {
      clearInterval(this._secScheduler);
      this._secScheduler = null;
    }
    // Cortar lo ya programado y soltar todas las voces con su release
    if (this.ctx) {
      const now = this.ctx.currentTime;
      for (let i = 0; i < 10; i++) {
        const g = this.voices[i].gain.gain;
        const release = this._adsrDe(i).release;
        const ancla = Math.max(g.value, 0.0001);
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
        else g.cancelScheduledValues(now);
        g.setValueAtTime(ancla, now);
        g.linearRampToValueAtTime(0.0001, now + release);
        this._envPuntos[i] = [{ t: now, v: ancla }, { t: now + release, v: 0.0001 }];
        this.envelopeActiva[i] = false;
      }
    }
    this._secStepActual = -1;
    this._secGrupoActual = null;
    this._secPendientes = [];
    // Devolver el patrón de figuras que había antes de encadenar
    if (typeof ritmos !== "undefined") ritmos.detenerCadena();
  },

  // Pasos de la secuencia: un paso por GRUPO FM con al menos un astro
  // habilitado, en el orden de aparición dentro de ordenSecuencia.
  // En paralelo cada astro es su propio grupo (comportamiento clásico).
  _gruposSecuencia() {
    const grupos = this.gruposFM();
    const pasos = [];
    const usados = new Set();
    for (const astro of this.ordenSecuencia) {
      if (!this.planetEnabled[astro]) continue;
      const g = grupos.find(x => x.includes(astro)) || [astro];
      const clave = Math.min(...g);
      if (usados.has(clave)) continue;
      usados.add(clave);
      pasos.push({ grupo: g, representante: astro });
    }
    return pasos;
  },

  // Scheduler con lookahead sobre el reloj del AudioContext:
  // los envelopes se programan con tiempo exacto de audio, así el
  // tempo no depende del jitter de setTimeout/setInterval.
  _programarPasos() {
    if (!this.secuenciaActiva || !this.ctx) return;
    const now = this.ctx.currentTime;

    // Actualizar el paso "visible" para UI y animaciones
    while (this._secPendientes.length && this._secPendientes[0].t <= now) {
      const p = this._secPendientes.shift();
      this._secStepActual = p.representante;
      this._secGrupoActual = p.grupo;
    }

    // Con la pestaña oculta el navegador limita los timers a ~1 Hz:
    // ampliar el lookahead para que la secuencia no tenga huecos.
    const LOOKAHEAD = (typeof document !== "undefined" && document.hidden) ? 1.4 : 0.15;
    while (this._secNextTime < now + LOOKAHEAD) {
      let pasos = this._gruposSecuencia();
      if (pasos.length === 0) {
        this.detenerSecuencia();
        return;
      }
      const siguiente = (this._secIdx + 1) % pasos.length;
      // Volver al primer paso cierra una vuelta completa: es donde la
      // cadena de ritmos (rhythms.js) puede cambiar el patrón, así que
      // hay que recalcular los pasos con las figuras nuevas.
      if (siguiente === 0 && this._secIdx >= 0 && typeof ritmos !== "undefined") {
        ritmos.avanzarCiclo();
        pasos = this._gruposSecuencia();
        if (pasos.length === 0) {
          this.detenerSecuencia();
          return;
        }
      }
      this._secIdx = siguiente;
      const paso = pasos[this._secIdx];
      const t = this._secNextTime;
      // La duración del paso la marca la figura del astro representante
      const pasoSeg = (60 / this.bpm) * this.factorFiguraDe(paso.representante);
      const gateSeg = Math.max(0.02, pasoSeg * this.gate);

      for (const k of paso.grupo) {
        this.triggerAttack(k, t);
        this.triggerRelease(k, t + gateSeg);
      }
      this._secPendientes.push({ t, grupo: paso.grupo, representante: paso.representante });
      this._secNextTime += pasoSeg;
    }
  },

  sonandoEnSecuencia(i) {
    return this.secuenciaActiva &&
      Array.isArray(this._secGrupoActual) &&
      this._secGrupoActual.includes(i);
  },

  // -------------------- Disparos ADSR --------------------

  // t (opcional): tiempo del AudioContext en que debe ocurrir el evento.
  // Cada rampa se ANCLA con setValueAtTime en el valor real del
  // envelope en ese instante: sin esto, la rampa parte del último
  // evento programado (quizá de hace segundos) y la voz empieza a
  // subir antes de tiempo (notas pegadas, clics, attack sin pendiente).
  triggerAttack(i, t) {
    if (!this.ctx) this.init();
    if (!this.ctx) return;
    if (!this.enabled) {
      this.enabled = true;
      this._aplicarMaster();
    }

    if (typeof estado !== "undefined") {
      this._aplicarFrecuenciaPlaneta(i, estado.astros);
    }

    const now = this.ctx.currentTime;
    const when = (typeof t === "number") ? Math.max(t, now) : now;
    const inmediato = when <= now + 0.005;
    const adsr = this._adsrDe(i);
    const peak = Math.max(this.planetVolume[i] * this._factorAstro(i) * 0.4, 0.0001);
    const sustain = Math.max(peak * adsr.sustain, 0.0001);
    const g = this.voices[i].gain.gain;

    // Para eventos inmediatos el valor real del nodo es el más exacto;
    // para los programados usamos el libro de registro del envelope.
    const ancla = inmediato
      ? Math.max(g.value, 0.0001)
      : Math.max(this._valorEnvelopeEn(i, when), 0.0001);

    const curva = this._curvaDe(i);
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(when);
    else g.cancelScheduledValues(when);
    g.setValueAtTime(ancla, when);
    const puntos = [{ t: when, v: ancla }];
    this._programarSegmento(g, puntos, ancla, peak, when, adsr.attack, curva.attack);
    this._programarSegmento(g, puntos, peak, sustain, when + adsr.attack, adsr.decay, curva.decay);
    this._envPuntos[i] = puntos;

    // Solo los disparos inmediatos (UI/MIDI) marcan el flag; los pasos
    // programados de la secuencia se visualizan con _secGrupoActual.
    if (inmediato) this.envelopeActiva[i] = true;
  },

  triggerRelease(i, t) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const when = (typeof t === "number") ? Math.max(t, now) : now;
    const inmediato = when <= now + 0.005;
    const release = this._adsrDe(i).release;
    const g = this.voices[i].gain.gain;

    const ancla = inmediato
      ? Math.max(g.value, 0.0001)
      : Math.max(this._valorEnvelopeEn(i, when), 0.0001);

    const curva = this._curvaDe(i);
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(when);
    else g.cancelScheduledValues(when);
    g.setValueAtTime(ancla, when);
    const puntos = [{ t: when, v: ancla }];
    this._programarSegmento(g, puntos, ancla, 0.0001, when, release, curva.release);
    this._envPuntos[i] = puntos;

    if (inmediato) this.envelopeActiva[i] = false;
  },

  triggerOneShot(i) {
    this.triggerAttack(i);
    const dur = (this.adsr.attack + this.adsr.decay + 0.05) * 1000;
    setTimeout(() => this.triggerRelease(i), dur);
  },

  _silenciarInmediato(i) {
    if (!this.ctx) return;
    const v = this.voices[i];
    const now = this.ctx.currentTime;
    v.gain.gain.cancelScheduledValues(now);
    v.gain.gain.setValueAtTime(0.0001, now);
    this._envPuntos[i] = [{ t: now, v: 0.0001 }];
  },

  // -------------------- Frecuencia --------------------

  _frecuenciaContinua(astro) {
    const longitud = posicionZodiacal(astro.signo, astro.grado, astro.minuto);
    return FRECUENCIA_BASE * Math.pow(2, longitud / 360);
  },

  _frecuenciaRegion(astro) {
    const posVisual = posicionZodiacalVisual(astro.signo, astro.grado, astro.minuto);
    let idx = Math.floor(posVisual / gradosPorMicrotono);
    if (idx < 0) idx = 0;
    if (idx >= numMicrotonos) idx = numMicrotonos - 1;
    return frecuenciaMicrotonoVisual(idx);
  },

  _frecuenciaPara(i, astro) {
    const base = (this.modo === "region")
      ? this._frecuenciaRegion(astro)
      : this._frecuenciaContinua(astro);
    return base * Math.pow(2, this.octavaPorPlaneta[i]);
  },

  microtonoDeAstro(i, astros) {
    if (!astros || !astros[i]) return -1;
    const a = astros[i];
    const posVisual = posicionZodiacalVisual(a.signo, a.grado, a.minuto);
    let idx = Math.floor(posVisual / gradosPorMicrotono);
    if (idx < 0) idx = 0;
    if (idx >= numMicrotonos) idx = numMicrotonos - 1;
    return idx;
  },

  _aplicarMaster() {
    if (!this.ctx) return;
    const target = this.enabled ? Math.max(this.masterVolume, 0.0001) : 0.0001;
    const now = this.ctx.currentTime;
    const g = this.masterGain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(Math.max(g.value, 0.0001), now);
    g.exponentialRampToValueAtTime(target, now + 0.08);
  },

  _aplicarGainDrone(i) {
    if (!this.ctx) return;
    const v = this.voices[i];
    // Un astro suena si su grupo FM tiene algún miembro habilitado:
    // así los moduladores acompañan a su carrier automáticamente.
    const grupoActivo = this.grupoDeAstro(i).some(k => this.planetEnabled[k]);
    const target = (this.enabled && grupoActivo)
      ? Math.max(this.planetVolume[i] * this._factorAstro(i) * 0.4, 0.0001)
      : 0.0001;
    const now = this.ctx.currentTime;
    const g = v.gain.gain;
    const ancla = Math.max(g.value, 0.0001);
    g.cancelScheduledValues(now);
    g.setValueAtTime(ancla, now);
    g.exponentialRampToValueAtTime(target, now + 0.05);
    this._envPuntos[i] = [{ t: now, v: ancla }, { t: now + 0.05, v: target }];
  },

  _aplicarFrecuenciaPlaneta(i, astros) {
    if (!this.ctx) return;
    if (!astros || !astros[i]) return;
    const freq = this._frecuenciaPara(i, astros[i]);
    this.planetFreq[i] = freq;
    const rampa = (this.modo === "region") ? 0.02 : 0.08;
    const v = this.voices[i];
    const now = this.ctx.currentTime;
    for (const param of [v.osc.frequency, v.bandpass.frequency]) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(Math.max(param.value, 20), now);
      param.exponentialRampToValueAtTime(Math.max(20, freq), now + rampa);
    }
  },

  updateFromAstros(astros) {
    if (!this.ctx) return;
    const limite = Math.min(10, astros.length);
    for (let i = 0; i < limite; i++) {
      this._aplicarFrecuenciaPlaneta(i, astros);
    }
    this._actualizarProfundidadesFM();
  },

  nombreNota(i) {
    const freq = this.planetFreq[i];
    if (!freq || freq < 1) return "—";
    const semitonesDesdeBase = 12 * Math.log2(freq / FRECUENCIA_BASE);
    const nearest = Math.round(semitonesDesdeBase);
    const cents = (semitonesDesdeBase - nearest) * 100;
    const idxNota = ((nearest % 12) + 12) % 12;
    const octava = 4 + Math.floor(nearest / 12);
    const sign = cents >= 0 ? "+" : "";
    return `${NOTAS_BASE[idxNota]}${octava} (${sign}${cents.toFixed(0)}¢)`;
  },

  // -------------------- Persistencia --------------------

  _guardarConfig() {
    try {
      const data = {
        modo: this.modo,
        modoTrigger: this.modoTrigger,
        modoReproduccion: this.modoReproduccion,
        masterVolume: this.masterVolume,
        octavaPorPlaneta: this.octavaPorPlaneta.slice(),
        planetVolume: this.planetVolume.slice(),
        planetEnabled: this.planetEnabled.slice(),
        planetPan: this.planetPan.slice(),
        planetMuted: this.planetMuted.slice(),
        planetSolo: this.planetSolo.slice(),
        planetSalida: this.planetSalida.slice(),
        planetEnMaster: this.planetEnMaster.slice(),
        volumenSecuenciador: this.volumenSecuenciador,
        panSecuenciadorValor: this.panSecuenciadorValor,
        secuenciadorMuted: this.secuenciadorMuted,
        secuenciadorSolo: this.secuenciadorSolo,
        salidaSecuenciador: this.salidaSecuenciador,
        enMasterSecuenciador: this.enMasterSecuenciador,
        salidaBajaLatenciaDeviceId: this.salidaBajaLatenciaDeviceId,
        formaOnda: this.formaOnda.slice(),
        armonicosPares: this.armonicosPares.slice(),
        armonicosImpares: this.armonicosImpares.slice(),
        fmAlgoritmo: this.fmAlgoritmo,
        fmProfundidad: this.fmProfundidad,
        fmProfundidadAstro: this.fmProfundidadAstro.slice(),
        planetHPF: this.planetHPF.slice(),
        planetHPFQ: this.planetHPFQ.slice(),
        planetLPF: this.planetLPF.slice(),
        planetLPFQ: this.planetLPFQ.slice(),
        midiAstros: this.midiAstros,
        adsr: { ...this.adsr },
        adsrAstro: this.adsrAstro.map(a => ({ ...a })),
        adsrCurva: { ...this.adsrCurva },
        adsrCurvaAstro: this.adsrCurvaAstro.map(c => ({ ...c })),
        ordenSecuencia: this.ordenSecuencia.slice(),
        bpm: this.bpm,
        gate: this.gate,
        figuraSecuencia: this.figuraSecuencia,
        figuraPorAstro: this.figuraPorAstro.slice(),
        pesosFiguras: { ...this.pesosFiguras }
      };
      localStorage.setItem(SYNTH_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
  },

  _cargarConfig() {
    try {
      const raw = localStorage.getItem(SYNTH_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);

      if (data.modo === "continuo" || data.modo === "region") this.modo = data.modo;
      if (data.modoTrigger === "drone" || data.modoTrigger === "envelope") this.modoTrigger = data.modoTrigger;
      if (data.modoReproduccion === "acorde" || data.modoReproduccion === "secuencia") this.modoReproduccion = data.modoReproduccion;
      if (typeof data.masterVolume === "number") this.masterVolume = clamp(data.masterVolume, 0, 1);

      if (Array.isArray(data.octavaPorPlaneta) && data.octavaPorPlaneta.length === 10) {
        for (let i = 0; i < 10; i++) {
          const v = data.octavaPorPlaneta[i];
          if (typeof v === "number") this.octavaPorPlaneta[i] = clamp(Math.round(v), -4, 4);
        }
      }

      if (Array.isArray(data.planetVolume) && data.planetVolume.length === 10) {
        for (let i = 0; i < 10; i++) {
          const v = data.planetVolume[i];
          if (typeof v === "number") this.planetVolume[i] = clamp(v, 0, 1);
        }
      }
      // Astros marcados (antes no se guardaban: configs viejas → todos)
      if (Array.isArray(data.planetEnabled) && data.planetEnabled.length === 10) {
        for (let i = 0; i < 10; i++) this.planetEnabled[i] = !!data.planetEnabled[i];
      }
      if (Array.isArray(data.planetPan) && data.planetPan.length === 10) {
        for (let i = 0; i < 10; i++) {
          const v = data.planetPan[i];
          if (typeof v === "number") this.planetPan[i] = clamp(v, -1, 1);
        }
      }
      if (Array.isArray(data.planetMuted) && data.planetMuted.length === 10) {
        for (let i = 0; i < 10; i++) this.planetMuted[i] = !!data.planetMuted[i];
      }
      if (Array.isArray(data.planetSolo) && data.planetSolo.length === 10) {
        for (let i = 0; i < 10; i++) this.planetSolo[i] = !!data.planetSolo[i];
      }
      if (Array.isArray(data.planetSalida) && data.planetSalida.length === 10) {
        for (let i = 0; i < 10; i++) {
          const v = data.planetSalida[i];
          this.planetSalida[i] = (typeof v === "string" && v) ? v : null;
        }
      }
      if (Array.isArray(data.planetEnMaster) && data.planetEnMaster.length === 10) {
        for (let i = 0; i < 10; i++) this.planetEnMaster[i] = data.planetEnMaster[i] !== false;
      }
      if (typeof data.volumenSecuenciador === "number") this.volumenSecuenciador = clamp(data.volumenSecuenciador, 0, 1);
      if (typeof data.panSecuenciadorValor === "number") this.panSecuenciadorValor = clamp(data.panSecuenciadorValor, -1, 1);
      if (typeof data.secuenciadorMuted === "boolean") this.secuenciadorMuted = data.secuenciadorMuted;
      if (typeof data.secuenciadorSolo === "boolean") this.secuenciadorSolo = data.secuenciadorSolo;
      if (typeof data.salidaSecuenciador === "string") this.salidaSecuenciador = data.salidaSecuenciador || null;
      if (typeof data.enMasterSecuenciador === "boolean") this.enMasterSecuenciador = data.enMasterSecuenciador;
      if (typeof data.salidaBajaLatenciaDeviceId === "string") this.salidaBajaLatenciaDeviceId = data.salidaBajaLatenciaDeviceId || null;

      if (Array.isArray(data.formaOnda) && data.formaOnda.length === 10) {
        for (let i = 0; i < 10; i++) {
          if (FORMAS_ONDA.some(f => f.id === data.formaOnda[i])) this.formaOnda[i] = data.formaOnda[i];
        }
      }
      if (Array.isArray(data.armonicosPares) && data.armonicosPares.length === 10) {
        for (let i = 0; i < 10; i++) {
          if (typeof data.armonicosPares[i] === "number") this.armonicosPares[i] = clamp(data.armonicosPares[i], 0, 1);
        }
      }
      if (Array.isArray(data.armonicosImpares) && data.armonicosImpares.length === 10) {
        for (let i = 0; i < 10; i++) {
          if (typeof data.armonicosImpares[i] === "number") this.armonicosImpares[i] = clamp(data.armonicosImpares[i], 0, 1);
        }
      }

      if (typeof data.fmAlgoritmo === "string") {
        // Ids previos a la expansión: pares → cadenas5, serie2 → cadenas2
        const id = FM_ALGORITMOS_LEGADO[data.fmAlgoritmo] || data.fmAlgoritmo;
        if (FM_ALGORITMOS.some(a => a.id === id)) this.fmAlgoritmo = id;
      }
      if (typeof data.fmProfundidad === "number") this.fmProfundidad = clamp(data.fmProfundidad, 0, 20);
      if (Array.isArray(data.fmProfundidadAstro) && data.fmProfundidadAstro.length === 10) {
        for (let i = 0; i < 10; i++) {
          const v = data.fmProfundidadAstro[i];
          if (typeof v === "number") this.fmProfundidadAstro[i] = clamp(v, 0, 2);
        }
      }
      if (Array.isArray(data.planetHPF) && data.planetHPF.length === 10) {
        for (let i = 0; i < 10; i++) {
          const v = data.planetHPF[i];
          if (typeof v === "number") this.planetHPF[i] = clamp(v, 20, 20000);
        }
      }
      if (Array.isArray(data.planetHPFQ) && data.planetHPFQ.length === 10) {
        for (let i = 0; i < 10; i++) {
          const v = data.planetHPFQ[i];
          if (typeof v === "number") this.planetHPFQ[i] = clamp(v, 0.1, 18);
        }
      }
      if (Array.isArray(data.planetLPF) && data.planetLPF.length === 10) {
        for (let i = 0; i < 10; i++) {
          const v = data.planetLPF[i];
          if (typeof v === "number") this.planetLPF[i] = clamp(v, 20, 20000);
        }
      }
      if (Array.isArray(data.planetLPFQ) && data.planetLPFQ.length === 10) {
        for (let i = 0; i < 10; i++) {
          const v = data.planetLPFQ[i];
          if (typeof v === "number") this.planetLPFQ[i] = clamp(v, 0.1, 18);
        }
      }
      if (typeof data.midiAstros === "boolean") this.midiAstros = data.midiAstros;

      const cargarADSR = (destino, fuente) => {
        if (!fuente || typeof fuente !== "object") return;
        if (typeof fuente.attack  === "number") destino.attack  = clamp(fuente.attack,  0.001, 5);
        if (typeof fuente.decay   === "number") destino.decay   = clamp(fuente.decay,   0.001, 5);
        if (typeof fuente.sustain === "number") destino.sustain = clamp(fuente.sustain, 0,     1);
        if (typeof fuente.release === "number") destino.release = clamp(fuente.release, 0.001, 5);
      };
      cargarADSR(this.adsr, data.adsr);
      if (Array.isArray(data.adsrAstro) && data.adsrAstro.length === 10) {
        for (let i = 0; i < 10; i++) cargarADSR(this.adsrAstro[i], data.adsrAstro[i]);
      } else {
        // Configs viejas sin ADSR por astro: heredar el global
        for (let i = 0; i < 10; i++) cargarADSR(this.adsrAstro[i], data.adsr);
      }

      const cargarCurva = (destino, fuente) => {
        if (!fuente || typeof fuente !== "object") return;
        for (const p of ["attack", "decay", "release"]) {
          if (typeof fuente[p] === "number") destino[p] = clamp(fuente[p], -1, 1);
        }
      };
      cargarCurva(this.adsrCurva, data.adsrCurva);
      if (Array.isArray(data.adsrCurvaAstro) && data.adsrCurvaAstro.length === 10) {
        for (let i = 0; i < 10; i++) cargarCurva(this.adsrCurvaAstro[i], data.adsrCurvaAstro[i]);
      } else {
        for (let i = 0; i < 10; i++) cargarCurva(this.adsrCurvaAstro[i], data.adsrCurva);
      }

      if (Array.isArray(data.ordenSecuencia) && data.ordenSecuencia.length === 10) {
        const sorted = [...data.ordenSecuencia].map(Number).sort((a, b) => a - b);
        if (!sorted.some((v, i) => v !== i)) {
          this.ordenSecuencia = data.ordenSecuencia.map(Number);
        }
      }
      if (typeof data.bpm === "number") this.bpm = clamp(Math.round(data.bpm), BPM_MIN, BPM_MAX);
      if (typeof data.gate === "number") this.gate = clamp(data.gate, 0.05, 1);
      if (typeof data.figuraSecuencia === "string" && FIGURAS_SECUENCIA.some(f => f.id === data.figuraSecuencia)) {
        this.figuraSecuencia = data.figuraSecuencia;
      }
      if (Array.isArray(data.figuraPorAstro) && data.figuraPorAstro.length === 10) {
        for (let i = 0; i < 10; i++) {
          const v = data.figuraPorAstro[i];
          this.figuraPorAstro[i] = (typeof v === "string" && FIGURAS_SECUENCIA.some(f => f.id === v)) ? v : null;
        }
      }
      // Configs viejas sin pesos: cada figura conserva su default (1)
      if (data.pesosFiguras && typeof data.pesosFiguras === "object") {
        for (const f of FIGURAS_SECUENCIA) {
          const v = data.pesosFiguras[f.id];
          if (typeof v === "number") this.pesosFiguras[f.id] = clamp(Math.round(v), 0, PESO_FIGURA_MAX);
        }
      }
    } catch (e) {}
  }
};

synth._cargarConfig();
