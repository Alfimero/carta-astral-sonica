// =========================================================
// piano.js — modo piano microtonal (polifónico, independiente
//            del secuenciador)
// =========================================================
//
// Idea: los astros dejan de ser "una nota fija cada uno" y pasan a ser
// INSTRUMENTOS. El teclado aporta la altura; cada astro seleccionado
// aporta su timbre (forma de onda, armónicos), su octava, su volumen y
// su ADSR. Uno o más astros pueden sonar:
//
//   ruteo "paralelo" → cada astro es carrier (síntesis aditiva)
//   ruteo "serie"    → cadena FM: el primero es carrier y los
//                      siguientes lo modulan en cascada
//
// Las TECLAS son las regiones microtonales de la rueda: una octava del
// piano = una vuelta completa (numMicrotonos teclas). Por eso el
// teclado se redibuja al cambiar los microtonos, la nota raíz o el
// intervalo de orden, y por eso los límites de octava se marcan: con
// escalas microtonales la octava ya no cae cada 12 teclas.
//
// Es polifónico y crea sus propias voces: NO toca synth.planetEnabled
// ni el secuenciador, así que puede tocarse encima de ellos.
// =========================================================

const PIANO_STORAGE_KEY = "cas-piano-v1";

// Desviación (en cents) a partir de la cual una tecla deja de
// considerarse una nota del piano tradicional y se dibuja como
// tecla "intermedia" (microtonal).
const PIANO_UMBRAL_CENTS = 24;

// Semitonos que en el piano tradicional son teclas negras
const PIANO_ALTERADAS = [1, 3, 6, 8, 10];

// Rango de octavas dibujables: cubre de sobra el desplazamiento por
// astro (synth.octavaPorPlaneta, -4..4) para que un astro muy grave o
// muy agudo siempre quepa en el teclado sin recurrir a ‹ / ›.
const PIANO_OCTAVA_BASE_MIN = -6;
const PIANO_OCTAVA_BASE_MAX = 6;
const PIANO_OCTAVAS_MAX = 10;

// Filas del teclado del ordenador → pasos consecutivos de la escala
const PIANO_TECLAS_PC = "zxcvbnm" + "asdfghjkl" + "qwertyuiop";

const piano = {
  activo: false,

  // Astros que actúan como instrumento (uno o más)
  astrosSel: [true, false, false, false, false, false, false, false, false, false],

  ruteo: "paralelo",      // "paralelo" | "serie"
  anclaje: "escala",      // "escala" | "astro"
  astroFoco: 0,           // astro cuya afinación se marca en el teclado

  octavaBase: -1,         // primera octava dibujada (relativa a Do4)
  octavas: 2,             // cuántas octavas se dibujan
  velocidad: 0.8,
  volumenGeneral: 1,      // fader del bus del piano, para balancear contra el secuenciador
  panValor: 0,            // -1 (izq) .. 1 (der), del bus completo del piano
  muted: false,
  solo: false,            // ver synth._factorBusSecuenciador: son las dos fuentes del mezclador
  salida: null,           // id de salida virtual asignada (o null)
  enMaster: true,         // si el piano suma al grupo Maestro

  sostener: false,        // pedal: las notas no se sueltan
  tecladoPC: false,       // tocar con el teclado del ordenador
  midiEntrada: true,      // tocar con MIDI
  pasoBaseTeclado: 0,     // paso de la escala asignado a la tecla "z"

  MAX_VOCES: 12,
  NOTA_MIDI_BASE: 60,     // Do4 = primer paso de la escala

  bus: null,
  nodoPan: null,
  meterPiano: null,
  _voces: new Map(),      // paso → voz activa
  _pedalPendientes: new Set(),
  _teclasPC: new Map(),   // tecla física → paso que disparó

  // -------------------- Escala --------------------

  // Índice de región (0..numMicrotonos-1) y octava de un paso absoluto
  regionDePaso(paso) {
    const n = numMicrotonos;
    return ((paso % n) + n) % n;
  },

  octavaDePaso(paso) {
    return Math.floor(paso / numMicrotonos);
  },

  // Factor de afinación del anclaje: con "astro", todo el teclado se
  // desplaza para que la tecla de la región del astro en foco suene
  // EXACTAMENTE en su altura continua (su microtonalidad real).
  factorAnclaje() {
    if (this.anclaje !== "astro") return 1;
    if (typeof estado === "undefined" || !estado.astros[this.astroFoco]) return 1;

    const a = estado.astros[this.astroFoco];
    const lon = posicionZodiacal(a.signo, a.grado, a.minuto);
    const fContinua = FRECUENCIA_BASE * Math.pow(2, lon / 360);
    const fRegion = frecuenciaMicrotonoVisual(synth.microtonoDeAstro(this.astroFoco, estado.astros));
    if (!fRegion || !fContinua) return 1;

    // Plegar a la octava más cercana: con órdenes no cromáticos la
    // región y la altura continua pueden quedar a más de una octava.
    let r = fContinua / fRegion;
    while (r > Math.SQRT2) r /= 2;
    while (r < 1 / Math.SQRT2) r *= 2;
    return r;
  },

  centsAnclaje() {
    return Math.round(1200 * Math.log2(this.factorAnclaje()));
  },

  frecuenciaDePaso(paso) {
    const base = frecuenciaMicrotonoVisual(this.regionDePaso(paso));
    return base * Math.pow(2, this.octavaDePaso(paso)) * this.factorAnclaje();
  },

  // Astros que suenan, en el orden del secuenciador: ese orden define
  // quién es carrier y quién modula en el ruteo en serie.
  astrosActivos() {
    return synth.ordenSecuencia.filter(k => this.astrosSel[k]);
  },

  // -------------------- Ajustes --------------------

  setActivo(on) {
    this.activo = !!on;
    if (!this.activo) this.soltarTodo();
    this._guardarConfig();
  },

  setAstroSel(k, on) {
    if (k < 0 || k > 9) return;
    this.astrosSel[k] = !!on;
    this._guardarConfig();
  },

  seleccionarTodos(on) {
    for (let k = 0; k < 10; k++) this.astrosSel[k] = !!on;
    this._guardarConfig();
  },

  setRuteo(id) {
    if (id !== "paralelo" && id !== "serie") return;
    this.ruteo = id;
    this._guardarConfig();
  },

  setAnclaje(id) {
    if (id !== "escala" && id !== "astro") return;
    this.anclaje = id;
    this.actualizarAfinacion();
    this._guardarConfig();
  },

  setAstroFoco(k) {
    this.astroFoco = clamp(Math.round(k), 0, 9);
    this.actualizarAfinacion();
    this._guardarConfig();
  },

  setOctavaBase(o) {
    this.octavaBase = clamp(Math.round(o), PIANO_OCTAVA_BASE_MIN, PIANO_OCTAVA_BASE_MAX);
    this._guardarConfig();
  },

  setOctavas(n) {
    this.octavas = clamp(Math.round(n), 1, PIANO_OCTAVAS_MAX);
    this._guardarConfig();
  },

  // Amplía o reduce el rango visible manteniendo fijo el punto bajo
  // `centroOctava` (coordenada de octava absoluta, mismo espacio que
  // octavaBase/octavaPorPlaneta): así el zoom con la rueda no salta.
  zoom(factorPasos, centroOctava) {
    const centro = (typeof centroOctava === "number")
      ? centroOctava
      : this.octavaBase + this.octavas / 2;
    const nuevasOctavas = clamp(Math.round(this.octavas + factorPasos), 1, PIANO_OCTAVAS_MAX);
    if (nuevasOctavas === this.octavas) return false;
    const nuevaBase = clamp(Math.round(centro - nuevasOctavas / 2),
                             PIANO_OCTAVA_BASE_MIN, PIANO_OCTAVA_BASE_MAX);
    this.octavas = nuevasOctavas;
    this.octavaBase = nuevaBase;
    this._guardarConfig();
    return true;
  },

  panOctavas(delta) {
    const nueva = clamp(Math.round(this.octavaBase + delta),
                         PIANO_OCTAVA_BASE_MIN, PIANO_OCTAVA_BASE_MAX);
    if (nueva === this.octavaBase) return false;
    this.octavaBase = nueva;
    this._guardarConfig();
    return true;
  },

  // Rango de octavas (absolutas) que abarcan los astros visibles en el
  // teclado y las notas que estén sonando en este momento — el "extremo
  // grave" y el "extremo agudo" que se están ejecutando de verdad.
  rangoEnUso() {
    let min = null, max = null;
    const marcar = (oct) => {
      if (min === null || oct < min) min = oct;
      if (max === null || oct + 1 > max) max = oct + 1;
    };

    if (typeof estado !== "undefined" && estado.astros && estado.astros.length >= 10) {
      for (let k = 0; k < 10; k++) {
        if (!this.astrosSel[k] && k !== this.astroFoco) continue;
        marcar(synth.octavaPorPlaneta[k]);
      }
    }
    for (const paso of this._voces.keys()) marcar(this.octavaDePaso(paso));

    return min === null ? null : { min, max };
  },

  // Ajusta octavaBase/octavas para que el rango en uso quede
  // completamente visible, con un margen de una octava a cada lado.
  ajustarAlRangoEnUso() {
    const rango = this.rangoEnUso();
    if (!rango) return false;
    const base = clamp(rango.min - 1, PIANO_OCTAVA_BASE_MIN, PIANO_OCTAVA_BASE_MAX);
    const cuenta = clamp(rango.max - base + 1, 1, PIANO_OCTAVAS_MAX);
    this.octavaBase = base;
    this.octavas = cuenta;
    this._guardarConfig();
    return true;
  },

  setVelocidad(v) {
    this.velocidad = clamp(v, 0, 1);
    this._guardarConfig();
  },

  setVolumenGeneral(v) {
    this.volumenGeneral = clamp(v, 0, 1);
    this._aplicarVolumenBus();
    this._guardarConfig();
  },

  setPan(v) {
    this.panValor = clamp(v, -1, 1);
    if (this.nodoPan && synth.ctx) {
      this.nodoPan.pan.setTargetAtTime(this.panValor, synth.ctx.currentTime, 0.01);
    }
    this._guardarConfig();
  },

  setMuted(on) {
    this.muted = !!on;
    this._aplicarVolumenBus();
    synth._aplicarVolumenBusSecuenciador();
    this._guardarConfig();
  },

  setSolo(on) {
    this.solo = !!on;
    this._aplicarVolumenBus();
    synth._aplicarVolumenBusSecuenciador();
    this._guardarConfig();
  },

  setSalida(id) {
    this.salida = id || null;
    this._aplicarRuteoGrupo();
    this._guardarConfig();
  },

  setEnMaster(on) {
    this.enMaster = !!on;
    this._aplicarRuteoGrupo();
    this._guardarConfig();
  },

  // El piano se calla si el secuenciador está soleado (y viceversa,
  // ver synth._factorBusSecuenciador): son las dos fuentes del mezclador.
  _factorBus() {
    if (this.muted) return 0;
    const haySolo = this.solo || synth.secuenciadorSolo;
    return (haySolo && !this.solo) ? 0 : 1;
  },

  _aplicarVolumenBus() {
    if (!this.bus || !synth.ctx) return;
    const v = this.volumenGeneral * this._factorBus();
    this.bus.gain.setTargetAtTime(v, synth.ctx.currentTime, 0.01);
  },

  // Ruteo del bus del piano hacia el Maestro y/o su salida virtual
  // asignada. Separado del volumen (mute/solo son un nivel de gain,
  // esto es qué destinos reciben la señal).
  _aplicarRuteoGrupo() {
    if (!this.nodoPan || !synth.ctx) return;
    if (typeof salidasAudio !== "undefined") salidasAudio._asegurarTodosLosNodos();
    try { this.nodoPan.disconnect(); } catch (e) {}
    this.nodoPan.connect(this.meterPiano);
    if (this.enMaster) this.nodoPan.connect(synth.masterGain);
    const salida = typeof salidasAudio !== "undefined" ? salidasAudio.nodoGain(this.salida) : null;
    if (salida) this.nodoPan.connect(salida);
  },

  setSostener(on) {
    this.sostener = !!on;
    if (!this.sostener) {
      // Soltar el pedal libera todo lo que quedó pendiente
      for (const paso of [...this._pedalPendientes]) this.notaOff(paso, true);
      this._pedalPendientes.clear();
    }
    this._guardarConfig();
  },

  setTecladoPC(on) {
    this.tecladoPC = !!on;
    if (!this.tecladoPC) {
      for (const paso of this._teclasPC.values()) this.notaOff(paso, true);
      this._teclasPC.clear();
    }
    this._guardarConfig();
  },

  setMidiEntrada(on) {
    this.midiEntrada = !!on;
    this._guardarConfig();
  },

  // -------------------- Audio --------------------

  _prepararAudio() {
    if (!synth.ctx) synth.init();
    if (!synth.ctx) return false;
    if (synth.ctx.state === "suspended") synth.ctx.resume();
    if (!synth.enabled) {
      synth.enabled = true;
      synth._aplicarMaster();
      const chk = document.getElementById("synth-enabled");
      if (chk) chk.checked = true;
    }
    if (!this.bus) {
      this.bus = synth.ctx.createGain();
      this.nodoPan = synth.ctx.createStereoPanner();
      this.nodoPan.pan.value = this.panValor;
      this.meterPiano = synth.ctx.createAnalyser();
      this.meterPiano.fftSize = 512;
      this.bus.connect(this.nodoPan);
      this._aplicarRuteoGrupo();
      this._aplicarVolumenBus();
    }
    return true;
  },

  // Un "operador": la fuente de un astro (oscilador o ruido filtrado)
  // con su propio gain de envelope, afinado a `freq`. Clona también el
  // HPF/LPF del astro (mismo criterio que ADSR/armónicos/forma de onda:
  // se copian los valores actuales al crear la voz, sin seguir cambios
  // en vivo mientras la nota ya suena).
  _crearOperador(k, freq) {
    const ctx = synth.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;

    const hpf = ctx.createBiquadFilter();
    hpf.type = "highpass";
    hpf.frequency.value = synth.planetHPF[k];
    hpf.Q.value = synth.planetHPFQ[k];

    const lpf = ctx.createBiquadFilter();
    lpf.type = "lowpass";
    lpf.frequency.value = synth.planetLPF[k];
    lpf.Q.value = synth.planetLPFQ[k];

    gain.connect(hpf);
    hpf.connect(lpf);

    // Pan del astro (el mismo valor que usa su voz del secuenciador):
    // solo se conecta cuando el operador termina siendo audible
    // (carrier), igual que en synth.js.
    const pan = ctx.createStereoPanner();
    pan.pan.value = synth.planetPan[k];

    const op = { astro: k, osc: null, src: null, bandpass: null, modGain: null, gain, hpf, lpf, pan, freq };

    if (synth.formaOnda[k] === "noise") {
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = "bandpass";
      bandpass.frequency.value = freq;
      bandpass.Q.value = 14;

      const src = ctx.createBufferSource();
      src.buffer = synth._crearNoiseBuffer();
      src.loop = true;
      src.connect(bandpass);
      bandpass.connect(gain);
      src.start();

      op.src = src;
      op.bandpass = bandpass;
      return op;
    }

    const osc = ctx.createOscillator();
    if (synth.formaOnda[k] === "custom") {
      osc.setPeriodicWave(synth._ondaPersonalizada(k));
    } else {
      osc.type = synth.formaOnda[k];
    }
    osc.frequency.value = freq;
    osc.connect(gain);
    osc.start();

    op.osc = osc;
    return op;
  },

  notaOn(paso, velocidad) {
    if (!this._prepararAudio()) return;

    const astros = this.astrosActivos();
    if (!astros.length) return;

    // Retrigger de la misma tecla y límite de polifonía
    if (this._voces.has(paso)) this.notaOff(paso, true);
    while (this._voces.size >= this.MAX_VOCES) {
      const masVieja = this._voces.keys().next().value;
      this.notaOff(masVieja, true);
    }
    this._pedalPendientes.delete(paso);

    const ctx = synth.ctx;
    const t0 = ctx.currentTime;
    const vel = clamp((typeof velocidad === "number") ? velocidad : this.velocidad, 0.02, 1);
    const fBase = this.frecuenciaDePaso(paso);

    const ops = astros.map(k => {
      const f = Math.max(20, fBase * Math.pow(2, synth.octavaPorPlaneta[k]));
      return this._crearOperador(k, f);
    });

    // Ruteo: aditivo (todos a la salida) o cadena FM (solo el primero).
    // La salida audible de cada operador es SU lpf (fin de la cadena de
    // filtros); el tap de FM (modGain) sigue leyendo de `gain` crudo, sin
    // pasar por los filtros, igual que en synth.js.
    if (this.ruteo === "serie") {
      ops[0].lpf.connect(ops[0].pan);
      ops[0].pan.connect(this.bus);
      for (let idx = 1; idx < ops.length; idx++) {
        const mod = ops[idx];
        const destino = ops[idx - 1];
        const modGain = ctx.createGain();
        // Misma escala que el synth: el gain del modulador llega a ~0.4
        modGain.gain.value = destino.freq * synth.fmProfundidad * synth.fmProfundidadAstro[mod.astro] * 2.5;
        mod.gain.connect(modGain);
        if (destino.osc) modGain.connect(destino.osc.frequency);
        if (destino.bandpass) modGain.connect(destino.bandpass.frequency);
        mod.modGain = modGain;
      }
    } else {
      for (const op of ops) {
        op.lpf.connect(op.pan);
        op.pan.connect(this.bus);
      }
    }

    // ADSR por astro (el mismo que edita la curva del panel)
    for (const op of ops) {
      const adsr = synth._adsrDe(op.astro);
      const curva = synth._curvaDe(op.astro);
      const peak = Math.max(synth.planetVolume[op.astro] * synth._factorAstro(op.astro) * vel * 0.4, 0.0001);
      const sustain = Math.max(peak * adsr.sustain, 0.0001);
      const g = op.gain.gain;

      g.setValueAtTime(0.0001, t0);
      const puntos = [{ t: t0, v: 0.0001 }];
      synth._programarSegmento(g, puntos, 0.0001, peak, t0, adsr.attack, curva.attack);
      synth._programarSegmento(g, puntos, peak, sustain, t0 + adsr.attack, adsr.decay, curva.decay);
    }

    this._voces.set(paso, { paso, ops, inicio: t0 });
    if (typeof marcarTeclaPiano === "function") marcarTeclaPiano(paso, true);
  },

  // forzar = ignorar el pedal de sostenido
  notaOff(paso, forzar) {
    const voz = this._voces.get(paso);
    if (!voz) return;

    if (this.sostener && !forzar) {
      this._pedalPendientes.add(paso);
      return;
    }

    this._voces.delete(paso);
    this._pedalPendientes.delete(paso);
    if (typeof marcarTeclaPiano === "function") marcarTeclaPiano(paso, false);

    const ctx = synth.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    let releaseMax = 0.05;

    for (const op of voz.ops) {
      const adsr = synth._adsrDe(op.astro);
      const curva = synth._curvaDe(op.astro);
      const g = op.gain.gain;
      const ancla = Math.max(g.value, 0.0001);

      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
      else g.cancelScheduledValues(now);
      g.setValueAtTime(ancla, now);
      synth._programarSegmento(g, [], ancla, 0.0001, now, adsr.release, curva.release);
      releaseMax = Math.max(releaseMax, adsr.release);
    }

    // Apagar y liberar los nodos cuando el release ya terminó
    const fin = now + releaseMax + 0.05;
    for (const op of voz.ops) {
      try { if (op.osc) op.osc.stop(fin); } catch (e) {}
      try { if (op.src) op.src.stop(fin); } catch (e) {}
    }
    setTimeout(() => {
      for (const op of voz.ops) {
        for (const nodo of [op.osc, op.src, op.bandpass, op.modGain, op.gain, op.hpf, op.lpf, op.pan]) {
          try { if (nodo) nodo.disconnect(); } catch (e) {}
        }
      }
    }, (releaseMax + 0.2) * 1000);
  },

  soltarTodo() {
    for (const paso of [...this._voces.keys()]) this.notaOff(paso, true);
    this._pedalPendientes.clear();
    this._teclasPC.clear();
  },

  sonando(paso) {
    return this._voces.has(paso);
  },

  // Con anclaje "astro" la carta en movimiento desafina el teclado en
  // vivo: las notas que ya suenan se reafinan con una rampa corta.
  actualizarAfinacion() {
    if (!synth.ctx || this._voces.size === 0) return;
    const now = synth.ctx.currentTime;

    for (const voz of this._voces.values()) {
      const fBase = this.frecuenciaDePaso(voz.paso);
      for (const op of voz.ops) {
        const f = Math.max(20, fBase * Math.pow(2, synth.octavaPorPlaneta[op.astro]));
        op.freq = f;
        for (const param of [op.osc && op.osc.frequency, op.bandpass && op.bandpass.frequency]) {
          if (!param) continue;
          param.cancelScheduledValues(now);
          param.setValueAtTime(Math.max(param.value, 20), now);
          param.exponentialRampToValueAtTime(f, now + 0.06);
        }
        if (op.modGain) {
          op.modGain.gain.setTargetAtTime(f * synth.fmProfundidad * synth.fmProfundidadAstro[op.astro] * 2.5, now, 0.02);
        }
      }
    }
  },

  // -------------------- Teclado del ordenador --------------------

  pasoDeTeclaPC(tecla) {
    const idx = PIANO_TECLAS_PC.indexOf(String(tecla).toLowerCase());
    if (idx === -1) return null;
    return this.pasoBaseTeclado + idx;
  },

  // Devuelve true si la tecla la consumió el piano (para que no
  // dispare los atajos globales de la carta).
  manejarTeclaAbajo(tecla) {
    if (!this.activo || !this.tecladoPC) return false;

    if (tecla === ",") { this.pasoBaseTeclado -= numMicrotonos; this._guardarConfig(); return true; }
    if (tecla === ".") { this.pasoBaseTeclado += numMicrotonos; this._guardarConfig(); return true; }

    const paso = this.pasoDeTeclaPC(tecla);
    if (paso === null) return false;
    const clave = String(tecla).toLowerCase();
    if (this._teclasPC.has(clave)) return true;  // auto-repeat del SO
    this._teclasPC.set(clave, paso);
    this.notaOn(paso);
    return true;
  },

  manejarTeclaArriba(tecla) {
    if (!this.tecladoPC) return false;
    const clave = String(tecla).toLowerCase();
    if (!this._teclasPC.has(clave)) return false;
    const paso = this._teclasPC.get(clave);
    this._teclasPC.delete(clave);
    this.notaOff(paso);
    return true;
  },

  // -------------------- MIDI --------------------
  // Una tecla del controlador = un paso de la escala microtonal
  // (Do4 = primer paso). Es el mapeo estándar de un controlador
  // microtonal: la octava real llega cada numMicrotonos teclas.

  midiActivo() {
    return this.activo && this.midiEntrada;
  },

  midiNoteOn(nota, velocidad) {
    this.notaOn(nota - this.NOTA_MIDI_BASE, (velocidad || 100) / 127);
  },

  midiNoteOff(nota) {
    this.notaOff(nota - this.NOTA_MIDI_BASE);
  },

  // -------------------- Persistencia --------------------

  _guardarConfig() {
    try {
      localStorage.setItem(PIANO_STORAGE_KEY, JSON.stringify({
        activo: this.activo,
        astrosSel: this.astrosSel.slice(),
        ruteo: this.ruteo,
        anclaje: this.anclaje,
        astroFoco: this.astroFoco,
        octavaBase: this.octavaBase,
        octavas: this.octavas,
        velocidad: this.velocidad,
        volumenGeneral: this.volumenGeneral,
        panValor: this.panValor,
        muted: this.muted,
        solo: this.solo,
        salida: this.salida,
        enMaster: this.enMaster,
        sostener: this.sostener,
        tecladoPC: this.tecladoPC,
        midiEntrada: this.midiEntrada,
        pasoBaseTeclado: this.pasoBaseTeclado
      }));
    } catch (e) {}
  },

  _cargarConfig() {
    try {
      const raw = localStorage.getItem(PIANO_STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);

      if (typeof d.activo === "boolean") this.activo = d.activo;
      if (Array.isArray(d.astrosSel) && d.astrosSel.length === 10) {
        for (let k = 0; k < 10; k++) this.astrosSel[k] = !!d.astrosSel[k];
      }
      if (d.ruteo === "paralelo" || d.ruteo === "serie") this.ruteo = d.ruteo;
      if (d.anclaje === "escala" || d.anclaje === "astro") this.anclaje = d.anclaje;
      if (typeof d.astroFoco === "number") this.astroFoco = clamp(Math.round(d.astroFoco), 0, 9);
      if (typeof d.octavaBase === "number") this.octavaBase = clamp(Math.round(d.octavaBase), PIANO_OCTAVA_BASE_MIN, PIANO_OCTAVA_BASE_MAX);
      if (typeof d.octavas === "number") this.octavas = clamp(Math.round(d.octavas), 1, PIANO_OCTAVAS_MAX);
      if (typeof d.velocidad === "number") this.velocidad = clamp(d.velocidad, 0, 1);
      if (typeof d.volumenGeneral === "number") this.volumenGeneral = clamp(d.volumenGeneral, 0, 1);
      if (typeof d.panValor === "number") this.panValor = clamp(d.panValor, -1, 1);
      if (typeof d.muted === "boolean") this.muted = d.muted;
      if (typeof d.solo === "boolean") this.solo = d.solo;
      if (typeof d.salida === "string") this.salida = d.salida || null;
      if (typeof d.enMaster === "boolean") this.enMaster = d.enMaster;
      if (typeof d.sostener === "boolean") this.sostener = d.sostener;
      if (typeof d.tecladoPC === "boolean") this.tecladoPC = d.tecladoPC;
      if (typeof d.midiEntrada === "boolean") this.midiEntrada = d.midiEntrada;
      if (typeof d.pasoBaseTeclado === "number") this.pasoBaseTeclado = Math.round(d.pasoBaseTeclado);
    } catch (e) {}
  }
};

piano._cargarConfig();

// =========================================================
// Visualización: teclado microtonal
// =========================================================
//
// Filas del dibujo, de arriba abajo:
//   1) octavas    — corchete + nombre de la nota donde empieza cada
//                   vuelta de la rueda (ahí "termina" la octava)
//   2) marcadores — símbolo de cada astro sobre su región, con una
//                   aguja fina en su posición exacta dentro de ella
//   3) teclas     — naturales (claras), alteradas (oscuras, cortas) e
//                   intermedias (violeta, más cortas todavía): las que
//                   no existen en el piano de 12 notas
//   4) franja     — color de la región, el mismo de la rueda
// =========================================================

const PIANO_GEOM = {
  yOctavas: 0,  hOctavas: 15,
  yMarcas: 15,  hMarcas: 18,
  yTeclas: 33,  hTeclas: 80,
  yFranja: 113, hFranja: 10,
  alto: 123,
  margen: 1,
  anchoMin: 8,
  anchoMax: 30
};

let _pianoCacheEstructura = "";

// Nombre de nota más cercano a una frecuencia (sin cents)
function nombreNotaCercana(f) {
  if (!f || f < 1) return "—";
  const semis = Math.round(12 * Math.log2(f / FRECUENCIA_BASE));
  const pc = ((semis % 12) + 12) % 12;
  const octava = 4 + Math.floor(semis / 12);
  return NOTAS_BASE[pc].split("/")[0] + octava;
}

// Clasificación de una región dentro del piano tradicional
function infoRegionPiano(region) {
  const f = frecuenciaMicrotonoVisual(region);
  const semis = 12 * Math.log2(f / FRECUENCIA_BASE);
  const cercano = Math.round(semis);
  const cents = Math.round((semis - cercano) * 100);
  const pc = ((cercano % 12) + 12) % 12;

  let tipo = "natural";
  if (Math.abs(cents) >= PIANO_UMBRAL_CENTS) tipo = "intermedia";
  else if (PIANO_ALTERADAS.includes(pc)) tipo = "alterada";

  return { f, cents, pc, tipo, nombre: NOTAS_BASE[pc].split("/")[0] };
}

function _pianoColumnas() {
  return numMicrotonos * piano.octavas;
}

// Paso absoluto de la columna c del dibujo
function _pianoPasoDeColumna(c) {
  return piano.octavaBase * numMicrotonos + c;
}

function renderPianoTeclado(forzar) {
  const cont = document.getElementById("piano-teclado");
  if (!cont) return;

  const cols = _pianoColumnas();
  const ancho = Math.max(240, cont.clientWidth - 4);
  const wTecla = clamp(ancho / cols, PIANO_GEOM.anchoMin, PIANO_GEOM.anchoMax);

  const clave = [numMicrotonos, ordenActual.join(""), piano.octavaBase,
                 piano.octavas, Math.round(wTecla * 10)].join("|");
  if (!forzar && clave === _pianoCacheEstructura) {
    actualizarMarcadoresPiano();
    return;
  }
  _pianoCacheEstructura = clave;

  const G = PIANO_GEOM;
  const w = cols * wTecla + G.margen * 2;
  const h = G.alto;
  const x = c => G.margen + c * wTecla;

  let svg = `<svg viewBox="0 0 ${w.toFixed(1)} ${h}" width="${w.toFixed(1)}" height="${h}" ` +
            `xmlns="http://www.w3.org/2000/svg" class="piano-svg">`;

  // ---- Teclas ----
  const alturaTipo = { natural: G.hTeclas, alterada: G.hTeclas * 0.64, intermedia: G.hTeclas * 0.44 };
  const rellenoTipo = { natural: "#ece6f6", alterada: "#221c3a", intermedia: "#3a3060" };

  for (let c = 0; c < cols; c++) {
    const region = piano.regionDePaso(_pianoPasoDeColumna(c));
    const info = infoRegionPiano(region);
    const hk = alturaTipo[info.tipo];

    svg += `<rect class="piano-tecla piano-tecla-${info.tipo}" data-paso="${_pianoPasoDeColumna(c)}" ` +
           `x="${x(c).toFixed(1)}" y="${G.yTeclas}" width="${(wTecla - 0.6).toFixed(1)}" height="${hk.toFixed(1)}" ` +
           `rx="1.5" fill="${rellenoTipo[info.tipo]}"/>`;

    // Nombre de la nota solo si la tecla es lo bastante ancha
    if (wTecla >= 14 && info.tipo !== "intermedia") {
      svg += `<text class="piano-tecla-nombre" x="${(x(c) + wTecla / 2 - 0.3).toFixed(1)}" ` +
             `y="${(G.yTeclas + hk - 5).toFixed(1)}" text-anchor="middle" font-size="7.5" ` +
             `fill="${info.tipo === "natural" ? "#4a3f6b" : "#b8a8e0"}">${info.nombre}</text>`;
    }
  }

  // ---- Franja de color de región (la misma paleta de la rueda) ----
  for (let c = 0; c < cols; c++) {
    const region = piano.regionDePaso(_pianoPasoDeColumna(c));
    const [r, g, b] = colorRegionMicrotono(region);
    svg += `<rect x="${x(c).toFixed(1)}" y="${G.yFranja}" width="${(wTecla - 0.4).toFixed(1)}" ` +
           `height="${G.hFranja}" fill="rgb(${r},${g},${b})"/>`;
  }

  // ---- Límites de octava: dónde da la vuelta la rueda ----
  for (let o = 0; o <= piano.octavas; o++) {
    const c = o * numMicrotonos;
    const px = x(c);
    svg += `<line x1="${px.toFixed(1)}" y1="${G.yOctavas + 3}" x2="${px.toFixed(1)}" y2="${h}" ` +
           `stroke="#c9a45c" stroke-width="1.6"/>`;

    if (o < piano.octavas) {
      const pxFin = x(Math.min(c + numMicrotonos, cols));
      const fInicio = frecuenciaMicrotonoVisual(0) * Math.pow(2, piano.octavaBase + o);
      svg += `<line x1="${px.toFixed(1)}" y1="${(G.yOctavas + 11).toFixed(1)}" ` +
             `x2="${pxFin.toFixed(1)}" y2="${(G.yOctavas + 11).toFixed(1)}" ` +
             `stroke="#c9a45c" stroke-width="0.8" opacity="0.55"/>`;
      svg += `<text x="${(px + 4).toFixed(1)}" y="${(G.yOctavas + 8).toFixed(1)}" font-size="8.5" ` +
             `fill="#c9a45c" font-family="ui-monospace, monospace">${nombreNotaCercana(fInicio)} ` +
             `· ${numMicrotonos} teclas</text>`;
    }
  }

  // ---- Marcadores de astros (se actualizan aparte) ----
  svg += `<g id="piano-marcadores" pointer-events="none"></g>`;
  svg += `</svg>`;

  cont.innerHTML = svg;
  conectarTecladoPiano(cont);
  actualizarMarcadoresPiano();
}

// Símbolo + aguja de cada astro sobre la tecla de su región.
// La aguja va en la posición FRACCIONARIA dentro de la región, así se
// ve la afinación exacta del astro y no solo la casilla donde cae.
function actualizarMarcadoresPiano() {
  const g = document.getElementById("piano-marcadores");
  if (!g) return;
  if (typeof estado === "undefined" || estado.astros.length < 10) {
    g.innerHTML = "";
    return;
  }

  const G = PIANO_GEOM;
  const cols = _pianoColumnas();
  const svgEl = g.ownerSVGElement;
  const w = svgEl ? parseFloat(svgEl.getAttribute("width")) : 0;
  const wTecla = (w - G.margen * 2) / cols;

  const visibles = [];
  for (let k = 0; k < 10; k++) {
    if (!piano.astrosSel[k] && k !== piano.astroFoco) continue;
    visibles.push(k);
  }

  // Los astros cuya octava queda fuera del rango dibujado se apilan en
  // el borde: se separan un poco para que se distingan unos de otros.
  let fueraIzq = 0, fueraDer = 0;

  let svg = "";
  for (const k of visibles) {
    const a = estado.astros[k];
    const fracRegion = posicionZodiacalVisual(a.signo, a.grado, a.minuto) / gradosPorMicrotono;
    const colAbs = (synth.octavaPorPlaneta[k] - piano.octavaBase) * numMicrotonos + fracRegion;

    const fuera = (colAbs < 0) ? -1 : (colAbs > cols ? 1 : 0);
    const col = clamp(colAbs, 0, cols);
    const px = G.margen + col * wTecla;

    const color = (THEME.astros && THEME.astros.coloresPorAstro && THEME.astros.coloresPorAstro[k])
      ? THEME.astros.coloresPorAstro[k]
      : COLORES_ASTROS_DEFAULT[k];
    const foco = (k === piano.astroFoco);
    const activo = piano.astrosSel[k];
    const opacidad = fuera ? 0.35 : (activo ? 1 : 0.5);

    // Aguja: posición exacta de la afinación dentro de la región
    if (!fuera) {
      svg += `<line x1="${px.toFixed(1)}" y1="${G.yMarcas + 12}" x2="${px.toFixed(1)}" ` +
             `y2="${G.yFranja + G.hFranja}" stroke="${color}" stroke-width="${foco ? 1.8 : 1}" ` +
             `opacity="${foco ? 0.95 : 0.55}"/>`;
    }

    let pxTexto = clamp(px, 7, w - 7);
    if (fuera === -1) pxTexto = 8 + (fueraIzq++) * 13;
    if (fuera === 1)  pxTexto = w - 8 - (fueraDer++) * 13;

    const etiqueta = (fuera === -1 ? "‹" : "") + SIMBOLOS_ASTROS[k] + (fuera === 1 ? "›" : "");
    svg += `<text x="${pxTexto.toFixed(1)}" y="${G.yMarcas + 10}" text-anchor="middle" ` +
           `font-size="${foco ? 13 : 11}" fill="${color}" opacity="${opacidad}" ` +
           `stroke="#0d0b18" stroke-width="2.4" paint-order="stroke">${etiqueta}</text>`;
  }

  g.innerHTML = svg;
}

// Resalta / apaga una tecla que está sonando
function marcarTeclaPiano(paso, encendida) {
  const cont = document.getElementById("piano-teclado");
  if (!cont) return;
  const tecla = cont.querySelector(`.piano-tecla[data-paso="${paso}"]`);
  if (tecla) tecla.classList.toggle("piano-tecla-sonando", !!encendida);
}

// Ratón / táctil sobre el teclado: pulsar, arrastrar (glissando) y
// soltar. Con captura de puntero el target no cambia al arrastrar, así
// que la tecla bajo el cursor se busca con elementFromPoint.
function conectarTecladoPiano(cont) {
  const svgEl = cont.querySelector("svg");
  if (!svgEl) return;

  let pasoActual = null;

  const pasoEn = (clientX, clientY) => {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el || !el.classList.contains("piano-tecla")) return null;
    const v = parseInt(el.dataset.paso, 10);
    return Number.isNaN(v) ? null : v;
  };

  const info = document.getElementById("piano-info");
  const describir = paso => {
    if (!info || paso === null) return;
    const region = piano.regionDePaso(paso);
    const datos = infoRegionPiano(region);
    const f = piano.frecuenciaDePaso(paso);
    const signo = datos.cents >= 0 ? "+" : "";
    info.textContent =
      `Región ${region}/${numMicrotonos} · octava ${piano.octavaDePaso(paso)} · ` +
      `${nombreNotaCercana(f)} (${signo}${datos.cents}¢) · ${f.toFixed(2)} Hz` +
      (piano.anclaje === "astro" ? ` · anclaje ${piano.centsAnclaje()}¢` : "");
  };

  svgEl.addEventListener("pointerdown", ev => {
    const paso = pasoEn(ev.clientX, ev.clientY);
    if (paso === null) return;
    ev.preventDefault();
    pasoActual = paso;
    describir(paso);
    piano.notaOn(paso);
    // La captura permite el glissando; si el puntero ya no está activo
    // (o el navegador la rechaza) la nota igual suena.
    try { svgEl.setPointerCapture(ev.pointerId); } catch (e) {}
  });

  svgEl.addEventListener("pointermove", ev => {
    if (pasoActual === null) {
      const hover = pasoEn(ev.clientX, ev.clientY);
      if (hover !== null) describir(hover);
      return;
    }
    const paso = pasoEn(ev.clientX, ev.clientY);
    if (paso === null || paso === pasoActual) return;
    piano.notaOff(pasoActual);
    pasoActual = paso;
    describir(paso);
    piano.notaOn(paso);
  });

  const soltar = ev => {
    if (pasoActual === null) return;
    piano.notaOff(pasoActual);
    pasoActual = null;
    try {
      if (ev && svgEl.hasPointerCapture(ev.pointerId)) svgEl.releasePointerCapture(ev.pointerId);
    } catch (e) {}
  };
  svgEl.addEventListener("pointerup", soltar);
  svgEl.addEventListener("pointercancel", soltar);
  svgEl.addEventListener("pointerleave", () => { if (pasoActual !== null) soltar(null); });

  // Rueda: zoom (más/menos octavas visibles) centrado en el cursor;
  // Shift+rueda desplaza el rango sin cambiar el zoom. Reemplaza el
  // scroll nativo del contenedor (overflow-x:auto) para que ambos
  // extremos, agudo y grave, se alcancen con la misma rueda.
  svgEl.addEventListener("wheel", ev => {
    ev.preventDefault();
    const rect = svgEl.getBoundingClientRect();
    const cols = _pianoColumnas();
    const wTecla = rect.width / cols;
    const col = clamp((ev.clientX - rect.left) / wTecla, 0, cols);
    const octavaBajoCursor = piano.octavaBase + col / numMicrotonos;

    let cambio;
    if (ev.shiftKey) {
      const dir = (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY) > 0 ? 1 : -1;
      cambio = piano.panOctavas(dir);
    } else {
      const dir = ev.deltaY > 0 ? 1 : -1;
      cambio = piano.zoom(dir, octavaBajoCursor);
    }
    if (cambio) {
      renderPianoTeclado(true);
      const octBase = document.getElementById("piano-octava-base");
      const octNum = document.getElementById("piano-octavas");
      if (octBase) octBase.value = piano.octavaBase;
      if (octNum) octNum.value = piano.octavas;
    }
  }, { passive: false });
}

// =========================================================
// UI del panel
// =========================================================

function inicializarUIPiano() {
  const activo = document.getElementById("piano-activo");
  if (activo) {
    activo.checked = piano.activo;
    activo.addEventListener("change", e => {
      piano.setActivo(e.target.checked);
      actualizarUIPiano();
    });
  }

  // Astros-instrumento
  const cont = document.getElementById("piano-astros");
  if (cont) {
    cont.innerHTML = synth.ordenSecuencia.map(k => `
      <label class="piano-astro" title="${NOMBRES_ASTROS[k]} como instrumento del piano">
        <input type="checkbox" id="piano-astro-${k}"${piano.astrosSel[k] ? " checked" : ""}>
        <span style="color:${COLORES_ASTROS_DEFAULT[k]}">${SIMBOLOS_ASTROS[k]}</span>
      </label>
    `).join("");

    for (let k = 0; k < 10; k++) {
      document.getElementById(`piano-astro-${k}`)?.addEventListener("change", e => {
        piano.setAstroSel(k, e.target.checked);
        actualizarMarcadoresPiano();
      });
    }
  }

  document.getElementById("piano-sel-todos")?.addEventListener("click", () => {
    piano.seleccionarTodos(true);
    actualizarUIPiano();
  });
  document.getElementById("piano-sel-ninguno")?.addEventListener("click", () => {
    piano.seleccionarTodos(false);
    actualizarUIPiano();
  });
  document.getElementById("piano-panico")?.addEventListener("click", () => piano.soltarTodo());

  document.querySelectorAll('input[name="piano-ruteo"]').forEach(radio => {
    radio.checked = (radio.value === piano.ruteo);
    radio.addEventListener("change", e => {
      if (e.target.checked) piano.setRuteo(e.target.value);
    });
  });

  const foco = document.getElementById("piano-astro-foco");
  if (foco) {
    foco.innerHTML = NOMBRES_ASTROS.slice(0, 10).map((n, i) =>
      `<option value="${i}"${i === piano.astroFoco ? " selected" : ""}>${SIMBOLOS_ASTROS[i]} ${n}</option>`
    ).join("");
    foco.addEventListener("change", e => {
      piano.setAstroFoco(parseInt(e.target.value, 10));
      actualizarUIPiano();
    });
  }

  const anclaje = document.getElementById("piano-anclaje");
  if (anclaje) {
    anclaje.value = piano.anclaje;
    anclaje.addEventListener("change", e => {
      piano.setAnclaje(e.target.value);
      actualizarUIPiano();
    });
  }

  const octBase = document.getElementById("piano-octava-base");
  if (octBase) {
    octBase.value = piano.octavaBase;
    octBase.addEventListener("change", e => {
      piano.setOctavaBase(parseInt(e.target.value, 10));
      octBase.value = piano.octavaBase;
      renderPianoTeclado(true);
    });
  }

  const octNum = document.getElementById("piano-octavas");
  if (octNum) {
    octNum.value = piano.octavas;
    octNum.addEventListener("change", e => {
      piano.setOctavas(parseInt(e.target.value, 10));
      octNum.value = piano.octavas;
      renderPianoTeclado(true);
    });
  }

  document.getElementById("piano-ajustar-rango")?.addEventListener("click", () => {
    if (piano.ajustarAlRangoEnUso()) {
      if (octBase) octBase.value = piano.octavaBase;
      if (octNum) octNum.value = piano.octavas;
      renderPianoTeclado(true);
    }
  });

  const vel = document.getElementById("piano-velocidad");
  if (vel) {
    vel.value = piano.velocidad;
    vel.addEventListener("input", e => {
      piano.setVelocidad(parseFloat(e.target.value));
      const et = document.getElementById("piano-vel-val");
      if (et) et.textContent = Math.round(piano.velocidad * 100) + "%";
    });
  }

  const volGen = document.getElementById("piano-volumen-general");
  if (volGen) {
    volGen.value = piano.volumenGeneral;
    volGen.addEventListener("input", e => {
      piano.setVolumenGeneral(parseFloat(e.target.value));
      const et = document.getElementById("piano-vol-general-val");
      if (et) et.textContent = Math.round(piano.volumenGeneral * 100) + "%";
    });
  }

  const checks = [
    ["piano-sostener",   v => piano.setSostener(v),   () => piano.sostener],
    ["piano-teclado-pc", v => piano.setTecladoPC(v),  () => piano.tecladoPC],
    ["piano-midi",       v => piano.setMidiEntrada(v), () => piano.midiEntrada]
  ];
  for (const [id, set, get] of checks) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.checked = get();
    el.addEventListener("change", e => set(e.target.checked));
  }

  renderPianoTeclado(true);
  actualizarUIPiano();

  // El ancho útil de tecla depende del ancho del contenedor, que es 0
  // mientras la sección está plegada o desprendida en una ventana.
  window.addEventListener("resize", () => renderPianoTeclado(true));
  document.getElementById("seccion-piano")?.addEventListener("toggle", () => renderPianoTeclado(true));
}

function actualizarUIPiano() {
  const activo = document.getElementById("piano-activo");
  if (activo) activo.checked = piano.activo;

  for (let k = 0; k < 10; k++) {
    const chk = document.getElementById(`piano-astro-${k}`);
    if (chk) chk.checked = piano.astrosSel[k];
  }

  document.querySelectorAll('input[name="piano-ruteo"]').forEach(r => {
    r.checked = (r.value === piano.ruteo);
  });

  const foco = document.getElementById("piano-astro-foco");
  if (foco) foco.value = piano.astroFoco;

  const anclaje = document.getElementById("piano-anclaje");
  if (anclaje) anclaje.value = piano.anclaje;

  const velVal = document.getElementById("piano-vel-val");
  if (velVal) velVal.textContent = Math.round(piano.velocidad * 100) + "%";

  const volGeneralVal = document.getElementById("piano-vol-general-val");
  if (volGeneralVal) volGeneralVal.textContent = Math.round(piano.volumenGeneral * 100) + "%";

  const sec = document.getElementById("seccion-piano");
  if (sec) sec.classList.toggle("piano-encendido", piano.activo);

  const estadoTxt = document.getElementById("piano-estado");
  if (estadoTxt) {
    const n = piano.astrosActivos().length;
    const cadena = piano.astrosActivos().map(k => SIMBOLOS_ASTROS[k]).join(
      piano.ruteo === "serie" ? " → " : " + ");
    estadoTxt.textContent = n
      ? `${cadena}  (${piano.ruteo === "serie" ? "el último modula al primero, que sale" : "suma aditiva"})`
      : "Ningún astro seleccionado: elige al menos uno.";
  }

  actualizarMarcadoresPiano();
}

// Llamada desde refrescarPanel(): la carta se movió o cambió la escala
function actualizarPiano() {
  if (typeof document === "undefined") return;
  if (!document.getElementById("piano-teclado")) return;
  renderPianoTeclado(false);   // solo reconstruye si cambió la escala
  if (piano.anclaje === "astro") piano.actualizarAfinacion();
}

// -------------- Teclado del ordenador (hooks de p5) --------------
// keyPressed() vive en interaction.js y llama a piano.manejarTeclaAbajo
// antes que a los atajos globales; keyReleased no la usa nadie más.
function keyReleased() {
  if (typeof piano === "undefined") return;
  piano.manejarTeclaArriba(key);
}
