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
//
// INSTRUMENTOS: el piano puede tener varios. Cada uno escucha un
// controlador MIDI (y canal) propio, usa su propio grupo de astros y
// tiene su propio CONJUNTO de timbre (timbre.js): ganancia, octava,
// onda, armónicos, filtros, ADSR... por astro, independiente del
// Secuenciador 1 y de los demás instrumentos. Cada instrumento es un
// canal del mezclador.
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

// Entrada MIDI de un instrumento: "*" = cualquier controlador que NO
// tenga un instrumento propio; "" = ninguno (solo teclado en pantalla y
// teclado del ordenador); cualquier otro valor = id de un input MIDI.
const PIANO_ENTRADA_TODAS = "*";
const PIANO_ENTRADA_NINGUNA = "";

let _pianoContadorIds = 0;

// Un instrumento = un controlador (entrada + canal) + un grupo de
// astros + su propio conjunto de timbre (sintetizador independiente)
// + su propio bus en el mezclador.
function crearInstrumentoPiano(datos) {
  const d = datos || {};
  const inst = {
    id: (typeof d.id === "string" && d.id) ? d.id : "inst-" + Date.now().toString(36) + "-" + (_pianoContadorIds++),
    nombre: (typeof d.nombre === "string" && d.nombre.trim()) ? d.nombre.trim().slice(0, 40) : "Instrumento",
    entrada: (typeof d.entrada === "string") ? d.entrada : PIANO_ENTRADA_TODAS,
    entradaNombre: (typeof d.entradaNombre === "string") ? d.entradaNombre : "",
    canal: (typeof d.canal === "number") ? clamp(Math.round(d.canal), 0, 16) : 0,
    astrosSel: [true, false, false, false, false, false, false, false, false, false],
    ruteo: (d.ruteo === "serie") ? "serie" : "paralelo",
    timbre: sanearTimbre(d.timbre, timbreDesdeSynth()),
    volumen: (typeof d.volumen === "number") ? clamp(d.volumen, 0, 1) : 1,
    pan: (typeof d.pan === "number") ? clamp(d.pan, -1, 1) : 0,
    muted: !!d.muted,
    solo: !!d.solo,
    salida: (typeof d.salida === "string" && d.salida) ? d.salida : null,
    enMaster: d.enMaster !== false,

    // Runtime (no se persiste)
    bus: null,
    nodoPan: null,
    meter: null,
    motor: null,
    pendientes: new Set()   // pasos retenidos por el pedal de sostenido
  };
  if (Array.isArray(d.astrosSel) && d.astrosSel.length === 10) {
    for (let k = 0; k < 10; k++) inst.astrosSel[k] = !!d.astrosSel[k];
  }
  inst.motor = crearMotorVoces({
    timbre: () => inst.timbre,
    destino: () => inst.bus,
    maxVoces: 12
  });
  return inst;
}

const piano = {
  // Encendido de fábrica: al abrir el programa el piano ya responde
  activo: true,

  // Instrumentos (al menos uno). instSel = el que tocan el teclado en
  // pantalla y el del ordenador, y el que editan los controles de abajo.
  instrumentos: [],
  instSel: null,

  // Astro cuyo conjunto se muestra en el panel (null = ninguno)
  astroConjunto: null,

  anclaje: "escala",      // "escala" | "astro"
  astroFoco: 0,           // astro cuya afinación se marca en el teclado

  octavaBase: -1,         // primera octava dibujada (relativa a Do4)
  octavas: 2,             // cuántas octavas se dibujan
  velocidad: 0.8,

  sostener: false,        // pedal: las notas no se sueltan
  seguirNotas: true,      // desplazar el teclado para mostrar lo que se toca
  tecladoPC: false,       // tocar con el teclado del ordenador
  midiEntrada: true,      // tocar con MIDI (interruptor general)
  pasoBaseTeclado: 0,     // paso de la escala asignado a la tecla "z"

  NOTA_MIDI_BASE: 60,     // Do4 = primer paso de la escala

  _teclasPC: new Map(),   // tecla física → paso que disparó

  // -------------------- Instrumentos --------------------

  instActual() {
    return this.instrumentos.find(i => i.id === this.instSel) || this.instrumentos[0];
  },

  instrumento(id) {
    return this.instrumentos.find(i => i.id === id) || null;
  },

  seleccionarInstrumento(id) {
    if (!this.instrumento(id)) return;
    this.instSel = id;
    this._guardarConfig();
  },

  agregarInstrumento(entrada, entradaNombre) {
    // Primer "Instrumento N" libre (contar los existentes repetía nombres
    // al borrar o renombrar)
    const usados = new Set(this.instrumentos.map(i => i.nombre));
    let n = 1;
    while (usados.has("Instrumento " + n)) n++;
    const inst = crearInstrumentoPiano({
      nombre: entradaNombre ? entradaNombre : "Instrumento " + n,
      entrada: entrada || PIANO_ENTRADA_NINGUNA,
      entradaNombre: entradaNombre || ""
    });
    // Un instrumento nuevo arranca con un astro distinto al del
    // anterior, para que se distinga al tocar los dos a la vez.
    inst.astrosSel.fill(false);
    inst.astrosSel[(this.instrumentos.length) % 10] = true;
    this.instrumentos.push(inst);
    this.instSel = inst.id;
    if (synth.ctx) this._asegurarBus(inst);
    this._guardarConfig();
    this._avisarCambioInstrumentos();
    return inst;
  },

  eliminarInstrumento(id) {
    if (this.instrumentos.length <= 1) return false;
    const inst = this.instrumento(id);
    if (!inst) return false;
    inst.motor.soltarTodo();
    const bus = inst.bus, pan = inst.nodoPan;
    setTimeout(() => {
      try { if (bus) bus.disconnect(); } catch (e) {}
      try { if (pan) pan.disconnect(); } catch (e) {}
    }, 6000);
    this.instrumentos = this.instrumentos.filter(i => i.id !== id);
    if (this.instSel === id) this.instSel = this.instrumentos[0].id;
    // Si estaba soleado, los demás grupos vuelven a sonar
    synth.refrescarVolumenesGrupos();
    this._guardarConfig();
    this._avisarCambioInstrumentos();
    return true;
  },

  renombrarInstrumento(id, nombre) {
    const inst = this.instrumento(id);
    if (!inst) return;
    const limpio = String(nombre || "").trim().slice(0, 40);
    if (limpio) inst.nombre = limpio;
    this._guardarConfig();
    this._avisarCambioInstrumentos();
  },

  // entrada: "*", "" o id de input MIDI (con su nombre, para
  // reencontrarlo en otra sesión si el navegador le cambia el id)
  setEntradaInstrumento(id, entrada, entradaNombre) {
    const inst = this.instrumento(id);
    if (!inst) return;
    inst.motor.soltarTodo();
    inst.entrada = entrada;
    inst.entradaNombre = entradaNombre || "";
    this._guardarConfig();
  },

  setCanalInstrumento(id, canal) {
    const inst = this.instrumento(id);
    if (!inst) return;
    inst.canal = clamp(Math.round(canal), 0, 16);
    this._guardarConfig();
  },

  // Tras (re)conectar controladores: si el id guardado ya no existe
  // pero hay un controlador con el mismo nombre, es el mismo aparato.
  resolverEntradas(inputs) {
    let cambio = false;
    for (const inst of this.instrumentos) {
      if (inst.entrada === PIANO_ENTRADA_TODAS || inst.entrada === PIANO_ENTRADA_NINGUNA) continue;
      if (inputs.some(d => d.id === inst.entrada)) continue;
      const mismo = inst.entradaNombre && inputs.find(d => d.name === inst.entradaNombre);
      if (mismo) { inst.entrada = mismo.id; cambio = true; }
    }
    if (cambio) this._guardarConfig();
  },

  _avisarCambioInstrumentos() {
    if (typeof mezclador !== "undefined" && mezclador.reconstruir) mezclador.reconstruir();
    if (typeof renderInstrumentosPiano === "function") renderInstrumentosPiano();
  },

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

  // Astros que suenan en un instrumento, en el orden del secuenciador:
  // ese orden define quién es carrier y quién modula en el ruteo en serie.
  astrosActivos(inst) {
    const i = inst || this.instActual();
    return i ? synth.ordenSecuencia.filter(k => i.astrosSel[k]) : [];
  },

  // Octava de un astro dentro del instrumento (la de SU conjunto)
  octavaAstro(k, inst) {
    const i = inst || this.instActual();
    return i ? i.timbre.astros[k].octava : 0;
  },

  // -------------------- Ajustes --------------------

  setActivo(on) {
    this.activo = !!on;
    if (!this.activo) this.soltarTodo();
    this._guardarConfig();
  },

  setAstroSel(k, on) {
    const inst = this.instActual();
    if (!inst || k < 0 || k > 9) return;
    inst.astrosSel[k] = !!on;
    this._guardarConfig();
  },

  seleccionarTodos(on) {
    const inst = this.instActual();
    if (!inst) return;
    for (let k = 0; k < 10; k++) inst.astrosSel[k] = !!on;
    this._guardarConfig();
  },

  setRuteo(id) {
    const inst = this.instActual();
    if (!inst || (id !== "paralelo" && id !== "serie")) return;
    inst.ruteo = id;
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
  // octavaBase/octava de los astros): así el zoom con la rueda no salta.
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

  // Rango de octavas (absolutas) que abarcan los astros visibles del
  // instrumento seleccionado y las notas que estén sonando.
  rangoEnUso() {
    const inst = this.instActual();
    let min = null, max = null;
    const marcar = (oct) => {
      if (min === null || oct < min) min = oct;
      if (max === null || oct + 1 > max) max = oct + 1;
    };

    if (inst && typeof estado !== "undefined" && estado.astros && estado.astros.length >= 10) {
      for (let k = 0; k < 10; k++) {
        if (!inst.astrosSel[k] && k !== this.astroFoco) continue;
        marcar(this.octavaAstro(k, inst));
      }
    }
    if (inst) for (const paso of inst.motor.claves()) marcar(this.octavaDePaso(paso));

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

  // ----- Mezclador: cada instrumento es un canal propio -----

  setVolumenInstrumento(id, v) {
    const inst = this.instrumento(id);
    if (!inst) return;
    inst.volumen = clamp(v, 0, 1);
    this._aplicarVolumenBus(inst);
    this._guardarConfig();
  },

  setPanInstrumento(id, v) {
    const inst = this.instrumento(id);
    if (!inst) return;
    inst.pan = clamp(v, -1, 1);
    if (inst.nodoPan && synth.ctx) inst.nodoPan.pan.setTargetAtTime(inst.pan, synth.ctx.currentTime, 0.01);
    this._guardarConfig();
  },

  setMutedInstrumento(id, on) {
    const inst = this.instrumento(id);
    if (!inst) return;
    inst.muted = !!on;
    synth.refrescarVolumenesGrupos();
    this._guardarConfig();
  },

  setSoloInstrumento(id, on) {
    const inst = this.instrumento(id);
    if (!inst) return;
    inst.solo = !!on;
    synth.refrescarVolumenesGrupos();
    this._guardarConfig();
  },

  setSalidaInstrumento(id, salida) {
    const inst = this.instrumento(id);
    if (!inst) return;
    inst.salida = salida || null;
    this._aplicarRuteoGrupo(inst);
    this._guardarConfig();
  },

  setEnMasterInstrumento(id, on) {
    const inst = this.instrumento(id);
    if (!inst) return;
    inst.enMaster = !!on;
    this._aplicarRuteoGrupo(inst);
    this._guardarConfig();
  },

  // Volumen del instrumento seleccionado (el slider del panel)
  setVolumenGeneral(v) {
    const inst = this.instActual();
    if (inst) this.setVolumenInstrumento(inst.id, v);
  },

  _factorBus(inst) {
    if (inst.muted) return 0;
    return (synth.haySoloEnGrupos() && !inst.solo) ? 0 : 1;
  },

  _aplicarVolumenBus(inst) {
    if (!inst.bus || !synth.ctx) return;
    const v = inst.volumen * this._factorBus(inst);
    inst.bus.gain.setTargetAtTime(v, synth.ctx.currentTime, 0.01);
  },

  _aplicarVolumenBuses() {
    for (const inst of this.instrumentos) this._aplicarVolumenBus(inst);
  },

  // Ruteo del bus de un instrumento hacia el Maestro y/o su salida
  // virtual asignada. Separado del volumen (mute/solo son un nivel de
  // gain, esto es qué destinos reciben la señal).
  _aplicarRuteoGrupo(inst) {
    if (!inst.nodoPan || !synth.ctx) return;
    if (typeof salidasAudio !== "undefined") salidasAudio._asegurarTodosLosNodos();
    try { inst.nodoPan.disconnect(); } catch (e) {}
    inst.nodoPan.connect(inst.meter);
    if (inst.enMaster) inst.nodoPan.connect(synth.masterGain);
    const salida = typeof salidasAudio !== "undefined" ? salidasAudio.nodoGain(inst.salida) : null;
    if (salida) inst.nodoPan.connect(salida);
  },

  _aplicarRuteoGrupos() {
    for (const inst of this.instrumentos) this._aplicarRuteoGrupo(inst);
  },

  setSostener(on) {
    this.sostener = !!on;
    if (!this.sostener) {
      // Soltar el pedal libera todo lo que quedó pendiente
      for (const inst of this.instrumentos) {
        for (const paso of [...inst.pendientes]) this.notaOff(paso, true, inst);
        inst.pendientes.clear();
      }
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

  setSeguirNotas(on) {
    this.seguirNotas = !!on;
    this._guardarConfig();
  },

  // -------------------- Audio --------------------

  _asegurarBus(inst) {
    if (inst.bus || !synth.ctx) return;
    inst.bus = synth.ctx.createGain();
    inst.nodoPan = synth.ctx.createStereoPanner();
    inst.nodoPan.pan.value = inst.pan;
    inst.meter = synth.ctx.createAnalyser();
    inst.meter.fftSize = 512;
    inst.bus.connect(inst.nodoPan);
    this._aplicarRuteoGrupo(inst);
    this._aplicarVolumenBus(inst);
  },

  // Crea los buses de todos los instrumentos (al arrancar, para que el
  // mezclador tenga medidores antes de la primera nota).
  prepararBuses() {
    if (!synth.ctx) return;
    for (const inst of this.instrumentos) this._asegurarBus(inst);
  },

  _prepararAudio(inst) {
    if (!synth.ctx) synth.init();
    if (!synth.ctx) return false;
    if (synth.ctx.state === "suspended") synth.ctx.resume();
    if (!synth.enabled) {
      synth.enabled = true;
      synth._aplicarMaster();
      const chk = document.getElementById("synth-enabled");
      if (chk) chk.checked = true;
    }
    this._asegurarBus(inst);
    return true;
  },

  // Cadenas FM del instrumento: una por astro (paralelo) o una sola
  // cadena en el orden del secuenciador (serie).
  _cadenas(inst) {
    const astros = this.astrosActivos(inst);
    if (!astros.length) return [];
    return inst.ruteo === "serie" ? [astros] : astros.map(k => [k]);
  },

  notaOn(paso, velocidad, instrumento) {
    const inst = instrumento || this.instActual();
    if (!inst || !this._prepararAudio(inst)) return;

    const cadenas = this._cadenas(inst);
    if (!cadenas.length) return;

    inst.pendientes.delete(paso);
    const vel = (typeof velocidad === "number") ? velocidad : this.velocidad;
    const fBase = this.frecuenciaDePaso(paso);
    inst.motor.notaOn(paso, cadenas,
      k => fBase * Math.pow(2, inst.timbre.astros[k].octava), vel);

    if (this.seguirNotas && typeof asegurarPasoVisiblePiano === "function") asegurarPasoVisiblePiano(paso);
    if (typeof marcarTeclaPiano === "function") marcarTeclaPiano(paso, true);
  },

  // forzar = ignorar el pedal de sostenido
  notaOff(paso, forzar, instrumento) {
    const inst = instrumento || this.instActual();
    if (!inst || !inst.motor.sonando(paso)) return;

    if (this.sostener && !forzar) {
      inst.pendientes.add(paso);
      return;
    }
    inst.pendientes.delete(paso);
    inst.motor.notaOff(paso);
    if (typeof marcarTeclaPiano === "function") marcarTeclaPiano(paso, this.sonando(paso));
  },

  soltarTodo() {
    for (const inst of this.instrumentos) {
      const pasos = inst.motor.claves();
      inst.motor.soltarTodo();
      inst.pendientes.clear();
      if (typeof marcarTeclaPiano === "function") pasos.forEach(p => marcarTeclaPiano(p, false));
    }
    this._teclasPC.clear();
  },

  // ¿Algún instrumento está tocando ese paso?
  sonando(paso) {
    return this.instrumentos.some(inst => inst.motor.sonando(paso));
  },

  // Con anclaje "astro" la carta en movimiento desafina el teclado en
  // vivo: las notas que ya suenan se reafinan con una rampa corta.
  actualizarAfinacion() {
    for (const inst of this.instrumentos) {
      inst.motor.reafinar((voz, k) =>
        this.frecuenciaDePaso(voz.clave) * Math.pow(2, inst.timbre.astros[k].octava));
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
  // (Do4 = primer paso). Cada instrumento escucha SU controlador (y
  // canal); "*" recibe los controladores que no tengan instrumento
  // propio, así que con un solo instrumento todo sigue como antes.

  midiActivo() {
    return this.activo && this.midiEntrada;
  },

  _escucha(inst, entradaId, canal) {
    if (inst.canal && canal && inst.canal !== canal) return false;
    if (inst.entrada === PIANO_ENTRADA_NINGUNA) return false;
    if (inst.entrada === PIANO_ENTRADA_TODAS) {
      return !entradaId || !this.instrumentos.some(o => o.entrada === entradaId);
    }
    return inst.entrada === entradaId;
  },

  _instrumentosDeEntrada(entradaId, canal) {
    return this.instrumentos.filter(inst => this._escucha(inst, entradaId, canal));
  },

  // Devuelve true si algún instrumento se quedó con la nota
  midiNoteOn(nota, velocidad, entradaId, canal) {
    if (!this.midiActivo()) return false;
    const destinos = this._instrumentosDeEntrada(entradaId, canal);
    if (!destinos.length) return false;
    const vel = (velocidad || 100) / 127;
    for (const inst of destinos) this.notaOn(nota - this.NOTA_MIDI_BASE, vel, inst);
    return true;
  },

  midiNoteOff(nota, entradaId, canal) {
    if (!this.midiActivo()) return false;
    const destinos = this._instrumentosDeEntrada(entradaId, canal);
    if (!destinos.length) return false;
    for (const inst of destinos) this.notaOff(nota - this.NOTA_MIDI_BASE, false, inst);
    return true;
  },

  // -------------------- Persistencia --------------------

  _guardarConfig() {
    try {
      localStorage.setItem(PIANO_STORAGE_KEY, JSON.stringify({
        activo: this.activo,
        instrumentos: this.instrumentos.map(inst => ({
          id: inst.id,
          nombre: inst.nombre,
          entrada: inst.entrada,
          entradaNombre: inst.entradaNombre,
          canal: inst.canal,
          astrosSel: inst.astrosSel.slice(),
          ruteo: inst.ruteo,
          timbre: inst.timbre,
          volumen: inst.volumen,
          pan: inst.pan,
          muted: inst.muted,
          solo: inst.solo,
          salida: inst.salida,
          enMaster: inst.enMaster
        })),
        instSel: this.instSel,
        anclaje: this.anclaje,
        astroFoco: this.astroFoco,
        octavaBase: this.octavaBase,
        octavas: this.octavas,
        velocidad: this.velocidad,
        sostener: this.sostener,
        tecladoPC: this.tecladoPC,
        midiEntrada: this.midiEntrada,
        seguirNotas: this.seguirNotas,
        pasoBaseTeclado: this.pasoBaseTeclado
      }));
    } catch (e) {}
  },

  _cargarConfig() {
    let d = null;
    try {
      const raw = localStorage.getItem(PIANO_STORAGE_KEY);
      if (raw) d = JSON.parse(raw);
    } catch (e) {}

    if (d && typeof d === "object") {
      if (typeof d.activo === "boolean") this.activo = d.activo;
      if (Array.isArray(d.instrumentos) && d.instrumentos.length) {
        this.instrumentos = d.instrumentos.map(x => crearInstrumentoPiano(x));
      } else {
        // Config de antes de los instrumentos: el piano único pasa a ser
        // el instrumento 1, con el timbre actual de los astros (suena
        // igual que antes) y escuchando todos los controladores.
        this.instrumentos = [crearInstrumentoPiano({
          nombre: "Piano",
          entrada: PIANO_ENTRADA_TODAS,
          astrosSel: d.astrosSel,
          ruteo: d.ruteo,
          volumen: d.volumenGeneral,
          pan: d.panValor,
          muted: d.muted,
          solo: d.solo,
          salida: d.salida,
          enMaster: d.enMaster
        })];
      }
      if (typeof d.instSel === "string") this.instSel = d.instSel;
      if (d.anclaje === "escala" || d.anclaje === "astro") this.anclaje = d.anclaje;
      if (typeof d.astroFoco === "number") this.astroFoco = clamp(Math.round(d.astroFoco), 0, 9);
      if (typeof d.octavaBase === "number") this.octavaBase = clamp(Math.round(d.octavaBase), PIANO_OCTAVA_BASE_MIN, PIANO_OCTAVA_BASE_MAX);
      if (typeof d.octavas === "number") this.octavas = clamp(Math.round(d.octavas), 1, PIANO_OCTAVAS_MAX);
      if (typeof d.velocidad === "number") this.velocidad = clamp(d.velocidad, 0, 1);
      if (typeof d.sostener === "boolean") this.sostener = d.sostener;
      if (typeof d.tecladoPC === "boolean") this.tecladoPC = d.tecladoPC;
      if (typeof d.midiEntrada === "boolean") this.midiEntrada = d.midiEntrada;
      if (typeof d.seguirNotas === "boolean") this.seguirNotas = d.seguirNotas;
      if (typeof d.pasoBaseTeclado === "number") this.pasoBaseTeclado = Math.round(d.pasoBaseTeclado);
    }

    if (!this.instrumentos.length) {
      this.instrumentos = [crearInstrumentoPiano({ nombre: "Piano", entrada: PIANO_ENTRADA_TODAS })];
    }
    if (!this.instrumento(this.instSel)) this.instSel = this.instrumentos[0].id;
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
  svg += `<g id="piano-sonando" pointer-events="none"></g>`;
  svg += `<g id="piano-marcadores" pointer-events="none"></g>`;
  svg += `</svg>`;

  cont.innerHTML = svg;
  conectarTecladoPiano(cont);
  actualizarMarcadoresPiano();
  // El SVG se rehízo (zoom, desplazamiento): volver a marcar lo que suena
  actualizarSonandoPiano();
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

  const inst = piano.instActual();
  const visibles = [];
  for (let k = 0; k < 10; k++) {
    if (!inst.astrosSel[k] && k !== piano.astroFoco) continue;
    visibles.push(k);
  }

  // Los astros cuya octava queda fuera del rango dibujado se apilan en
  // el borde: se separan un poco para que se distingan unos de otros.
  let fueraIzq = 0, fueraDer = 0;

  let svg = "";
  for (const k of visibles) {
    const a = estado.astros[k];
    const fracRegion = posicionZodiacalVisual(a.signo, a.grado, a.minuto) / gradosPorMicrotono;
    const colAbs = (piano.octavaAstro(k, inst) - piano.octavaBase) * numMicrotonos + fracRegion;

    const fuera = (colAbs < 0) ? -1 : (colAbs > cols ? 1 : 0);
    const col = clamp(colAbs, 0, cols);
    const px = G.margen + col * wTecla;

    const color = (THEME.astros && THEME.astros.coloresPorAstro && THEME.astros.coloresPorAstro[k])
      ? THEME.astros.coloresPorAstro[k]
      : COLORES_ASTROS_DEFAULT[k];
    const foco = (k === piano.astroFoco);
    const activo = inst.astrosSel[k];
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
// Una nota empezó o terminó: se repinta todo lo que suena (es barato y
// así también vale para varios instrumentos tocando la misma tecla).
function marcarTeclaPiano() {
  actualizarSonandoPiano();
}

// Qué suena ahora, de todos los instrumentos:
//   pulsadas → pasos que se están tocando (tecla dorada)
//   sonidos  → dónde suena de verdad cada astro de cada nota: la octava
//              del conjunto desplaza la altura numMicrotonos pasos por
//              octava, así que el astro puede sonar en otra tecla.
function _pianoQueSuena() {
  const pulsadas = new Set();
  const sonidos = [];
  const n = numMicrotonos;
  for (const inst of piano.instrumentos) {
    for (const [paso, voz] of inst.motor._voces) {
      pulsadas.add(paso);
      for (const k of voz.ops.keys()) {
        sonidos.push({ paso: paso + inst.timbre.astros[k].octava * n, astro: k, origen: paso });
      }
    }
  }
  return { pulsadas, sonidos };
}

function _pianoColorAstro(k) {
  return (THEME.astros && THEME.astros.coloresPorAstro && THEME.astros.coloresPorAstro[k])
    ? THEME.astros.coloresPorAstro[k]
    : COLORES_ASTROS_DEFAULT[k];
}

// Resalta las teclas pulsadas, pone un punto del color del astro en la
// tecla donde suena cada uno, y cuenta en los bordes lo que queda fuera
// del rango dibujado («◀ 2» / «1 ▶»).
function actualizarSonandoPiano() {
  const cont = document.getElementById("piano-teclado");
  const g = document.getElementById("piano-sonando");
  if (!cont || !g) return;
  const { pulsadas, sonidos } = _pianoQueSuena();

  cont.querySelectorAll(".piano-tecla").forEach(t => {
    t.classList.toggle("piano-tecla-sonando", pulsadas.has(parseInt(t.dataset.paso, 10)));
  });

  const G = PIANO_GEOM;
  const cols = _pianoColumnas();
  const svgEl = g.ownerSVGElement;
  const w = svgEl ? parseFloat(svgEl.getAttribute("width")) : 0;
  const wTecla = (w - G.margen * 2) / cols;
  const primero = piano.octavaBase * numMicrotonos;

  // Fuera del dibujo: pasos distintos a cada lado (un astro que suena en
  // la misma tecla que se pulsó no se cuenta dos veces)
  const fueraIzq = new Set(), fueraDer = new Set();
  const pila = new Map();   // columna → puntos ya dibujados (para apilarlos)
  let svg = "";

  const contar = paso => {
    const col = paso - primero;
    if (col < 0) { fueraIzq.add(paso); return false; }
    if (col >= cols) { fueraDer.add(paso); return false; }
    return true;
  };
  for (const paso of pulsadas) contar(paso);
  // Las teclas pulsadas fuera de vista (tienen prioridad al ir hacia ellas)
  const pulsadasIzq = [...fueraIzq], pulsadasDer = [...fueraDer];

  for (const s of sonidos) {
    const col = s.paso - primero;
    if (!contar(s.paso)) continue;
    const i = pila.get(col) || 0;
    pila.set(col, i + 1);
    const cx = G.margen + (col + 0.5) * wTecla;
    const cy = G.yFranja - 6 - i * 7;
    const r = clamp(wTecla * 0.32, 2.2, 4.2);
    svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${_pianoColorAstro(s.astro)}" ` +
           `stroke="#0d0b18" stroke-width="1"/>`;
  }

  // Insignias clicables: llevan el teclado hasta esas notas
  const insignia = (x, texto, ancla, lado) =>
    `<text class="piano-insignia-fuera" data-lado="${lado}" x="${x}" y="${G.yTeclas + 14}" ` +
    `text-anchor="${ancla}" font-size="12" font-weight="700" pointer-events="all" ` +
    `fill="#ffc04d" stroke="#0d0b18" stroke-width="3" paint-order="stroke">` +
    `<title>Clic para ir a lo que suena fuera del rango dibujado</title>${texto}</text>`;
  if (fueraIzq.size) svg += insignia(4, `◀ ${fueraIzq.size}`, "start", "izq");
  if (fueraDer.size) svg += insignia((w - 4).toFixed(1), `${fueraDer.size} ▶`, "end", "der");

  g.innerHTML = svg;
  g.querySelectorAll(".piano-insignia-fuera").forEach(t => {
    t.addEventListener("pointerdown", ev => {
      ev.preventDefault();
      ev.stopPropagation();
      // Primero las teclas que se están tocando; si no hay, donde suena
      // algún astro. De ellas, la más cercana al rango visible.
      const izq = t.dataset.lado === "izq";
      const propias = izq ? pulsadasIzq : pulsadasDer;
      const pasos = propias.length ? propias : [...(izq ? fueraIzq : fueraDer)];
      const destino = izq ? Math.max(...pasos) : Math.min(...pasos);
      asegurarPasoVisiblePiano(destino);
    });
  });
}

// Lleva a la vista la tecla de un paso: primero cambia el rango de
// octavas si queda fuera del dibujo, y luego desplaza la barra
// horizontal si el teclado es más ancho que su contenedor.
function asegurarPasoVisiblePiano(paso) {
  const cont = document.getElementById("piano-teclado");
  if (!cont || !cont.offsetParent) return;   // plegado u oculto: nada que mostrar
  const n = numMicrotonos;
  const oct = piano.octavaDePaso(paso);

  let base = piano.octavaBase;
  if (oct < base) base = oct;
  else if (oct >= base + piano.octavas) base = oct - piano.octavas + 1;
  if (base !== piano.octavaBase && piano.panOctavas(base - piano.octavaBase)) {
    renderPianoTeclado(true);
    const octBase = document.getElementById("piano-octava-base");
    if (octBase) octBase.value = piano.octavaBase;
  }

  const svgEl = cont.querySelector("svg");
  if (!svgEl || cont.scrollWidth <= cont.clientWidth + 1) return;
  const wTecla = (parseFloat(svgEl.getAttribute("width")) - PIANO_GEOM.margen * 2) / _pianoColumnas();
  const x = PIANO_GEOM.margen + (paso - piano.octavaBase * n + 0.5) * wTecla;
  const margen = Math.min(80, cont.clientWidth / 4);
  if (x < cont.scrollLeft + margen || x > cont.scrollLeft + cont.clientWidth - margen) {
    cont.scrollLeft = Math.max(0, x - cont.clientWidth / 2);
  }
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

function _pianoEscaparHTML(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

// Opciones del selector de controlador de un instrumento. Si el
// controlador guardado no está conectado ahora, se conserva como opción
// "(desconectado)" para no perder la asignación.
function _opcionesEntradaPiano(inst) {
  const entradas = (typeof MIDI !== "undefined") ? MIDI.inputs : [];
  let html = `<option value="${PIANO_ENTRADA_TODAS}">Todos los controladores libres</option>` +
             `<option value="${PIANO_ENTRADA_NINGUNA}">Ninguno (teclado en pantalla / PC)</option>`;
  for (const d of entradas) {
    html += `<option value="${_pianoEscaparHTML(d.id)}">🎛 ${_pianoEscaparHTML(d.name)}</option>`;
  }
  const especial = inst.entrada === PIANO_ENTRADA_TODAS || inst.entrada === PIANO_ENTRADA_NINGUNA;
  if (!especial && !entradas.some(d => d.id === inst.entrada)) {
    html += `<option value="${_pianoEscaparHTML(inst.entrada)}">⚠ ${_pianoEscaparHTML(inst.entradaNombre || "Controlador")} (desconectado)</option>`;
  }
  return html;
}

function _opcionesCanalPiano() {
  let html = `<option value="0">Omni</option>`;
  for (let c = 1; c <= 16; c++) html += `<option value="${c}">Canal ${c}</option>`;
  return html;
}

// Lista de controladores MIDI detectados + tarjetas de instrumentos.
function renderInstrumentosPiano() {
  const disp = document.getElementById("piano-controladores");
  if (disp) {
    if (typeof MIDI === "undefined" || !MIDI.enabled) {
      disp.innerHTML = `<span class="piano-ctrl-vacio">MIDI inactivo: actívalo en la sección 🎛 MIDI para ver tus controladores.</span>`;
    } else if (!MIDI.inputs.length) {
      disp.innerHTML = `<span class="piano-ctrl-vacio">Sin controladores MIDI conectados.</span>`;
    } else {
      disp.innerHTML = MIDI.inputs.map(d => {
        const usados = piano.instrumentos.filter(i => i.entrada === d.id).map(i => i.nombre);
        return `<span class="piano-ctrl${usados.length ? " asignado" : ""}" title="${usados.length ? "Tocando: " + _pianoEscaparHTML(usados.join(", ")) : "Sin instrumento propio (lo recibe 'Todos los controladores libres')"}">` +
          `🎛 ${_pianoEscaparHTML(d.name)}` +
          (usados.length ? ` → ${_pianoEscaparHTML(usados.join(", "))}` :
            ` <button type="button" class="piano-ctrl-usar" data-id="${_pianoEscaparHTML(d.id)}" data-nombre="${_pianoEscaparHTML(d.name)}" title="Crear un instrumento para este controlador">✚ instrumento</button>`) +
          `</span>`;
      }).join("");
      disp.querySelectorAll(".piano-ctrl-usar").forEach(btn => {
        btn.addEventListener("click", () => {
          piano.agregarInstrumento(btn.dataset.id, btn.dataset.nombre);
          actualizarUIPiano();
        });
      });
    }
  }

  const cont = document.getElementById("piano-instrumentos");
  if (!cont) return;
  // No reconstruir mientras se escribe un nombre (perdería el foco)
  if (cont.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;

  const actual = piano.instActual();
  cont.innerHTML = "";
  for (const inst of piano.instrumentos) {
    const fila = document.createElement("div");
    fila.className = "piano-inst" + (inst === actual ? " seleccionado" : "");
    fila.dataset.id = inst.id;
    const simbolos = piano.astrosActivos(inst).map(k => SIMBOLOS_ASTROS[k]).join("") || "∅";
    fila.innerHTML = `
      <label class="piano-inst-sel" title="Tocar este instrumento con el teclado en pantalla / PC y editarlo abajo">
        <input type="radio" name="piano-inst-sel"${inst === actual ? " checked" : ""}>
      </label>
      <input type="text" class="piano-inst-nombre" value="${_pianoEscaparHTML(inst.nombre)}" title="Nombre del instrumento (aparece en el mezclador)">
      <span class="piano-inst-astros" title="Astros de este instrumento">${simbolos}</span>
      <select class="piano-inst-entrada" title="Controlador MIDI que toca este instrumento">${_opcionesEntradaPiano(inst)}</select>
      <select class="piano-inst-canal" title="Canal MIDI que escucha (Omni = todos)">${_opcionesCanalPiano()}</select>
      <button type="button" class="piano-inst-timbre" title="Editar el conjunto de timbre de cada astro de este instrumento">🎛</button>
      <button type="button" class="piano-inst-borrar" title="Eliminar instrumento"${piano.instrumentos.length <= 1 ? " disabled" : ""}>✕</button>
    `;
    cont.appendChild(fila);

    fila.querySelector(".piano-inst-entrada").value = inst.entrada;
    fila.querySelector(".piano-inst-canal").value = String(inst.canal);

    fila.querySelector('input[type="radio"]').addEventListener("change", () => {
      piano.seleccionarInstrumento(inst.id);
      renderInstrumentosPiano();
      actualizarUIPiano();
    });
    fila.querySelector(".piano-inst-nombre").addEventListener("change", e => {
      piano.renombrarInstrumento(inst.id, e.target.value);
      e.target.value = inst.nombre;
    });
    fila.querySelector(".piano-inst-entrada").addEventListener("change", e => {
      const id = e.target.value;
      const disp = (typeof MIDI !== "undefined") ? MIDI.inputs.find(d => d.id === id) : null;
      piano.setEntradaInstrumento(inst.id, id, disp ? disp.name : inst.entradaNombre);
      renderInstrumentosPiano();
    });
    fila.querySelector(".piano-inst-canal").addEventListener("change", e => {
      piano.setCanalInstrumento(inst.id, parseInt(e.target.value, 10));
    });
    fila.querySelector(".piano-inst-timbre").addEventListener("click", () => {
      editorTimbre.abrirPara(inst.id);
    });
    fila.querySelector(".piano-inst-borrar").addEventListener("click", () => {
      if (!confirm(`¿Eliminar el instrumento "${inst.nombre}"?`)) return;
      piano.eliminarInstrumento(inst.id);
      actualizarUIPiano();
    });
  }
}

// Chips de astros del instrumento seleccionado: la casilla dice si el
// astro toca en el instrumento; el símbolo abre su conjunto debajo.
function renderAstrosPiano() {
  const cont = document.getElementById("piano-astros");
  if (!cont) return;
  const inst = piano.instActual();
  cont.innerHTML = synth.ordenSecuencia.map(k => `
    <div class="piano-astro" id="piano-chip-${k}">
      <input type="checkbox" id="piano-astro-${k}"${inst.astrosSel[k] ? " checked" : ""}
             title="${NOMBRES_ASTROS[k]} toca en este instrumento">
      <button type="button" class="piano-astro-simbolo" data-astro="${k}" style="color:${COLORES_ASTROS_DEFAULT[k]}"
              title="Ver y editar el conjunto de ${NOMBRES_ASTROS[k]} (ganancia, octava, onda, armónicos, filtros, ADSR…)">${SIMBOLOS_ASTROS[k]}</button>
    </div>
  `).join("");

  for (let k = 0; k < 10; k++) {
    document.getElementById(`piano-astro-${k}`)?.addEventListener("change", e => {
      piano.setAstroSel(k, e.target.checked);
      // Al sumar un astro se muestra su conjunto para ajustarlo de una vez
      if (e.target.checked) piano.astroConjunto = k;
      actualizarUIPiano();
    });
  }
  cont.querySelectorAll(".piano-astro-simbolo").forEach(btn => {
    btn.addEventListener("click", () => {
      const k = parseInt(btn.dataset.astro, 10);
      piano.astroConjunto = (piano.astroConjunto === k) ? null : k;
      actualizarUIPiano();
    });
  });
}

// Conjunto del astro elegido, en línea debajo de los chips. Solo se
// reconstruye si cambió el instrumento o el astro (no en cada refresco).
let _pianoConjuntoClave = "";
function renderConjuntoPiano(forzar) {
  const cont = document.getElementById("piano-conjunto");
  if (!cont) return;
  const inst = piano.instActual();
  const clave = inst.id + "|" + piano.astroConjunto;
  for (let k = 0; k < 10; k++) {
    document.getElementById(`piano-chip-${k}`)?.classList.toggle("editando", k === piano.astroConjunto);
  }
  if (!forzar && clave === _pianoConjuntoClave) return;
  _pianoConjuntoClave = clave;
  renderConjuntoAstro(cont, inst.id, piano.astroConjunto);
}

function inicializarUIPiano() {
  const activo = document.getElementById("piano-activo");
  if (activo) {
    activo.checked = piano.activo;
    activo.addEventListener("change", e => {
      piano.setActivo(e.target.checked);
      actualizarUIPiano();
    });
  }

  document.getElementById("piano-inst-agregar")?.addEventListener("click", () => {
    piano.agregarInstrumento(PIANO_ENTRADA_NINGUNA, "");
    actualizarUIPiano();
  });
  document.getElementById("piano-inst-timbre")?.addEventListener("click", () => {
    editorTimbre.abrirPara(piano.instActual().id);
  });

  renderAstrosPiano();

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
    radio.checked = (radio.value === piano.instActual().ruteo);
    radio.addEventListener("change", e => {
      if (e.target.checked) piano.setRuteo(e.target.value);
      actualizarUIPiano();
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
    volGen.value = piano.instActual().volumen;
    volGen.addEventListener("input", e => {
      piano.setVolumenGeneral(parseFloat(e.target.value));
      const et = document.getElementById("piano-vol-general-val");
      if (et) et.textContent = Math.round(piano.instActual().volumen * 100) + "%";
    });
  }

  const checks = [
    ["piano-sostener",   v => piano.setSostener(v),   () => piano.sostener],
    ["piano-teclado-pc", v => piano.setTecladoPC(v),  () => piano.tecladoPC],
    ["piano-midi",       v => piano.setMidiEntrada(v), () => piano.midiEntrada],
    ["piano-seguir",     v => piano.setSeguirNotas(v), () => piano.seguirNotas]
  ];
  for (const [id, set, get] of checks) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.checked = get();
    el.addEventListener("change", e => set(e.target.checked));
  }

  renderInstrumentosPiano();
  renderPianoTeclado(true);
  actualizarUIPiano();

  // El ancho útil de tecla depende del ancho del contenedor, que es 0
  // mientras la sección está plegada o desprendida en una ventana.
  window.addEventListener("resize", () => renderPianoTeclado(true));
  document.getElementById("seccion-piano")?.addEventListener("toggle", () => renderPianoTeclado(true));
}

function actualizarUIPiano() {
  const inst = piano.instActual();

  const activo = document.getElementById("piano-activo");
  if (activo) activo.checked = piano.activo;

  renderInstrumentosPiano();

  for (let k = 0; k < 10; k++) {
    const chk = document.getElementById(`piano-astro-${k}`);
    if (chk) chk.checked = inst.astrosSel[k];
  }

  const titulo = document.getElementById("piano-inst-actual");
  if (titulo) titulo.textContent = inst.nombre;

  renderConjuntoPiano();

  document.querySelectorAll('input[name="piano-ruteo"]').forEach(r => {
    r.checked = (r.value === inst.ruteo);
  });

  const foco = document.getElementById("piano-astro-foco");
  if (foco) foco.value = piano.astroFoco;

  const anclaje = document.getElementById("piano-anclaje");
  if (anclaje) anclaje.value = piano.anclaje;

  const velVal = document.getElementById("piano-vel-val");
  if (velVal) velVal.textContent = Math.round(piano.velocidad * 100) + "%";

  const volGen = document.getElementById("piano-volumen-general");
  if (volGen && document.activeElement !== volGen) volGen.value = inst.volumen;
  const volGeneralVal = document.getElementById("piano-vol-general-val");
  if (volGeneralVal) volGeneralVal.textContent = Math.round(inst.volumen * 100) + "%";

  const sec = document.getElementById("seccion-piano");
  if (sec) sec.classList.toggle("piano-encendido", piano.activo);

  const estadoTxt = document.getElementById("piano-estado");
  if (estadoTxt) {
    const activos = piano.astrosActivos(inst);
    const cadena = activos.map(k => SIMBOLOS_ASTROS[k]).join(inst.ruteo === "serie" ? " → " : " + ");
    estadoTxt.textContent = activos.length
      ? `${cadena}  (${inst.ruteo === "serie" ? "el último modula al primero, que sale" : "suma aditiva"})`
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
