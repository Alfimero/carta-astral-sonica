// =========================================================
// banks.js — bancos de fechas/lugares con overrides musicales
// =========================================================
//
// Cada banco guarda una fecha+ubicación que puede dispararse
// con un click o con una nota MIDI. Opcionalmente puede
// sobrescribir las octavas, el número de microtonos y/o el
// modo musical (cromático ↔ quintas).
//
// Estructura por banco:
//   {
//     id: string (uuid corto),
//     name: string,
//     fechaISO: "2024-12-21T12:00:00",
//     ubicacion: "CDMX",
//     latitud: number,
//     longitud: number,
//     zonaUTC: number,
//
//     grupo: string | null   (los bancos sin grupo se agrupan por fecha),
//     oculto: boolean,
//
//     octavasOverride: number[10] | null,
//     numMicrotonosOverride: number | null,
//     modoQuintasOverride: boolean | null,
//
//     midiNote: number | null  (0-127)
//   }
//
// El banco se "dispara" cargando su fecha en estado.fechaUTC
// y aplicando los overrides en synth, numMicrotonos y modoQuintas.
// =========================================================

const BANKS_STORAGE_KEY = "cas-banks-v1";
const BANKS_UI_STORAGE_KEY = "cas-banks-ui-v1";

const banks = {
  list: [],
  activeId: null,

  // Estado de UI: grupos compactados y si se ven los bancos ocultos
  ui: { colapsados: {}, mostrarOcultos: false },

  // ------------------ Persistencia ------------------

  cargar() {
    try {
      const raw = localStorage.getItem(BANKS_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!Array.isArray(data)) return;
      this.list = data.filter(b => b && typeof b === "object" && b.id);
    } catch (e) {
      console.warn("[banks] no se pudo cargar:", e);
    }
  },

  guardar() {
    try {
      localStorage.setItem(BANKS_STORAGE_KEY, JSON.stringify(this.list));
    } catch (e) {
      console.warn("[banks] no se pudo guardar:", e);
    }
  },

  cargarUI() {
    try {
      const raw = localStorage.getItem(BANKS_UI_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.colapsados && typeof data.colapsados === "object") this.ui.colapsados = data.colapsados;
      if (typeof data.mostrarOcultos === "boolean") this.ui.mostrarOcultos = data.mostrarOcultos;
    } catch (e) {}
  },

  guardarUI() {
    try {
      localStorage.setItem(BANKS_UI_STORAGE_KEY, JSON.stringify(this.ui));
    } catch (e) {}
  },

  // Clave de agrupación: nombre del grupo, o la fecha si no tiene grupo
  claveGrupo(b) {
    const g = (typeof b.grupo === "string") ? b.grupo.trim() : "";
    return g ? "g:" + g : "f:" + String(b.fechaISO || "").slice(0, 10);
  },

  // ------------------ CRUD ------------------

  _nuevoId() {
    return "b" + Math.random().toString(36).slice(2, 10);
  },

  crear() {
    const ahora = new Date();
    const isoLocal = this._fechaUTCAISOLocal(estado.fechaUTC, estado.zonaHoraria);

    const bank = {
      id: this._nuevoId(),
      name: "Banco " + (this.list.length + 1),
      fechaISO: isoLocal,
      ubicacion: estado.ubicacionNombre,
      latitud: estado.latitud,
      longitud: estado.longitud,
      zonaUTC: estado.zonaHoraria,
      grupo: null,
      oculto: false,
      octavasOverride: null,
      numMicrotonosOverride: null,
      modoQuintasOverride: null,
      // Overrides de reproducción
      modoReproduccionOverride: null,
      ordenSecuenciaOverride: null,
      bpmOverride: null,
      gateOverride: null,
      planetEnabledOverride: null,
      midiNote: null
    };
    this.list.push(bank);
    this.guardar();
    return bank;
  },

  // Crea un banco copiando el estado actual + config actual del synth
  crearDesdeEstadoActual() {
    const bank = this.crear();
    bank.octavasOverride = synth.octavaPorPlaneta.slice();
    bank.numMicrotonosOverride = numMicrotonos;
    bank.notaRaizOverride = notaRaiz;
    bank.intervaloOverride = intervaloOrden;
    bank.modoReproduccionOverride = synth.modoReproduccion;
    bank.ordenSecuenciaOverride = synth.ordenSecuencia.slice();
    bank.bpmOverride = synth.bpm;
    bank.gateOverride = synth.gate;
    bank.planetEnabledOverride = synth.planetEnabled.slice();
    bank.figuraPorAstroOverride = synth.figuraPorAstro.slice();
    this.guardar();
    return bank;
  },

  obtener(id) {
    return this.list.find(b => b.id === id);
  },

  borrar(id) {
    this.list = this.list.filter(b => b.id !== id);
    if (this.activeId === id) this.activeId = null;
    this.guardar();
  },

  actualizar(id, cambios) {
    const b = this.obtener(id);
    if (!b) return;
    Object.assign(b, cambios);
    this.guardar();
  },

  duplicar(id) {
    const b = this.obtener(id);
    if (!b) return null;
    const copia = JSON.parse(JSON.stringify(b));
    copia.id = this._nuevoId();
    copia.name = b.name + " (copia)";
    copia.midiNote = null;  // evitar conflicto MIDI
    this.list.push(copia);
    this.guardar();
    return copia;
  },

  // ------------------ Disparo ------------------

  disparar(id) {
    const b = this.obtener(id);
    if (!b) return;

    this.activeId = b.id;

    // Parar cualquier secuencia en curso antes de cargar el banco
    if (synth.secuenciaActiva) synth.detenerSecuencia();

    // Construir Date UTC desde fechaISO local + zonaUTC del banco
    const partes = this._parsearFechaISOLocal(b.fechaISO);
    if (partes) {
      estado.fechaUTC = fechaLocalAUTC(
        partes.year, partes.month, partes.day,
        partes.hour, partes.minute, partes.second,
        b.zonaUTC
      );
    }
    estado.ubicacionNombre = b.ubicacion;
    estado.latitud = b.latitud;
    estado.longitud = b.longitud;
    estado.zonaHoraria = b.zonaUTC;

    estado.modo = MODO_EXPLORACION;
    estado.seguirTiempoReal = false;
    estado.velocidadExploracion = 0;

    // Overrides
    if (Array.isArray(b.octavasOverride) && b.octavasOverride.length === 10) {
      for (let i = 0; i < 10; i++) {
        const v = b.octavasOverride[i];
        if (typeof v === "number") {
          synth.octavaPorPlaneta[i] = clamp(Math.round(v), -4, 4);
        }
      }
      synth._guardarConfig();
    }
    if (typeof b.numMicrotonosOverride === "number" && b.numMicrotonosOverride >= MIN_MICROTONOS) {
      setNumMicrotonos(b.numMicrotonosOverride);
    }
    if (typeof b.modoQuintasOverride === "boolean") {
      // Compatibilidad con bancos viejos: quintas = intervalo de 5J
      setIntervaloOrden(b.modoQuintasOverride ? 7 : 1);
    }
    if (typeof b.notaRaizOverride === "number") {
      setNotaRaiz(b.notaRaizOverride);
    }
    if (typeof b.intervaloOverride === "number") {
      setIntervaloOrden(b.intervaloOverride);
    }

    // Overrides de reproducción
    if (b.modoReproduccionOverride === "acorde" || b.modoReproduccionOverride === "secuencia") {
      synth.setModoReproduccion(b.modoReproduccionOverride);
    }
    if (Array.isArray(b.ordenSecuenciaOverride)) {
      synth.setOrdenSecuencia(b.ordenSecuenciaOverride);
    }
    if (typeof b.bpmOverride === "number") synth.setBPM(b.bpmOverride);
    if (typeof b.gateOverride === "number") synth.setGate(b.gateOverride);
    if (Array.isArray(b.figuraPorAstroOverride) && b.figuraPorAstroOverride.length === 10) {
      for (let i = 0; i < 10; i++) {
        synth.setFiguraAstro(i, b.figuraPorAstroOverride[i] || null);
      }
    }
    if (Array.isArray(b.planetEnabledOverride) && b.planetEnabledOverride.length === 10) {
      for (let i = 0; i < 10; i++) {
        synth.setPlanetEnabled(i, !!b.planetEnabledOverride[i]);
      }
    }

    cargarCartaExploracion();
    notificarCartaActualizada();
    if (typeof refrescarPanel === "function") refrescarPanel();
    if (typeof renderListaBancos === "function") renderListaBancos();
    if (typeof renderFilasPlanetas === "function") renderFilasPlanetas();
    if (typeof actualizarUISintetizador === "function") actualizarUISintetizador();

    // Auto-iniciar secuencia si el banco la pide y hay planetas activos
    if (synth.modoReproduccion === "secuencia" && synth.planetEnabled.some(v => v)) {
      synth.iniciarSecuencia();
    }
  },

  // Buscar banco por nota MIDI y disparar (devuelve true si hubo match)
  dispararPorNotaMIDI(nota) {
    const b = this.list.find(x => x.midiNote === nota);
    if (b) {
      this.disparar(b.id);
      return true;
    }
    return false;
  },

  // ------------------ Helpers de fecha ------------------

  _parsearFechaISOLocal(iso) {
    // "2024-12-21T12:00:00" o "2024-12-21T12:00"
    const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    return {
      year: parseInt(m[1], 10),
      month: parseInt(m[2], 10),
      day: parseInt(m[3], 10),
      hour: parseInt(m[4], 10),
      minute: parseInt(m[5], 10),
      second: m[6] ? parseInt(m[6], 10) : 0
    };
  },

  _fechaUTCAISOLocal(fechaUTC, zonaUTC) {
    const offsetMs = zonaUTC * 3600 * 1000;
    const local = new Date(fechaUTC.getTime() + offsetMs);
    return `${pad4(local.getUTCFullYear())}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}T${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:${pad2(local.getUTCSeconds())}`;
  },

  // ------------------ Importar/exportar ------------------

  exportarJSON() {
    return JSON.stringify(this.list, null, 2);
  },

  importarJSON(jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return false;
      this.list = parsed.filter(b => b && typeof b === "object" && b.id);
      this.guardar();
      return true;
    } catch (e) {
      return false;
    }
  }
};

banks.cargar();
banks.cargarUI();
