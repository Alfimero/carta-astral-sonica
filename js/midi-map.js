// =========================================================
// midi-map.js — mapeo de parámetros musicales a MIDI
// =========================================================
//
// Cinco parámetros del programa se pueden manejar desde el
// controlador sin tocar el panel:
//
//   transporte  → ▶ Play / ■ Detener del secuenciador
//   transporte2 → ▶ Play / ■ Detener del Secuenciador 2
//   raiz       → nota raíz en Aries (12 valores)
//   intervalo  → orden por intervalo (INTERVALOS_ORDEN, 10 valores)
//   ritmo      → cargar uno de los ritmos guardados (rhythms.js)
//
// El transporte no elige un valor: sus dos "opciones" son disparos.
// Play relanza SIEMPRE desde el primer paso (y con la cadena de ritmos
// en su primer eslabón), aunque la secuencia ya estuviera sonando.
//
// Cada parámetro se mapea de una de tres formas:
//
//   "notas" → un RANGO de notas consecutivas desde `notaBase`:
//             la primera nota selecciona la opción 1, la siguiente
//             la 2, y así hasta agotar las opciones. Es el atajo.
//   "libre" → un mensaje ELEGIDO A MANO por cada opción: tú decides
//             qué dispara Do, qué Fa#, qué la Quinta justa, etc. Las
//             opciones que dejes vacías no responden, así que sirve
//             también para mapear solo un puñado.
//   "cc"    → un control continuo: el valor 0-127 de ese CC se
//             reparte entre las opciones (perilla o fader).
//
// Una asignación del modo "libre" puede ser de dos tipos:
//
//   { tipo: "nota", nota }          → esa nota dispara la opción
//   { tipo: "cc", cc, min, max }    → ese CC la dispara cuando su
//                                     valor ENTRA en el tramo min-max
//
// El tramo es lo que permite usar un mismo control para varias
// opciones: un botón que manda CC 20 con 127 al pulsarlo y 0 al
// soltarlo puede elegir una opción con el tramo 64-127 y otra con el
// 0-63. El disparo es por FLANCO (solo al entrar en el tramo), así
// que un fader que lo recorre no reaplica en cada paso.
//
// Las asignaciones viven en `cfg[id].asignaciones` (índice de opción →
// asignación), salvo las de tipo nota del parámetro "ritmo", que
// delegan en el `midiNote` de cada ritmo guardado para no tener dos
// fuentes de verdad: la nota que pones aquí y la del botón 🎹 de su
// tarjeta son la misma. Esa nota del ritmo funciona SIEMPRE, aunque
// el parámetro esté en Off, y tiene prioridad sobre el rango.
//
// Canal: 0 = todos (omni), 1-16 = solo ese canal. Sirve para que los
// mapeos convivan con el piano y los bancos sin robarse notas: el
// piano escucha en omni, así que si comparten rango conviene dejar
// los mapeos en un canal propio.
//
// Prioridad dentro de midi.js:
//   captura → bancos → MAPEOS → piano → astros → envelope
// =========================================================

const MIDI_MAP_STORAGE_KEY = "cas-midi-map-v1";

// Definición de los parámetros mapeables. Cada uno sabe listar sus
// opciones, decir cuál está puesta y aplicarse.
const PARAMETROS_MIDI = [
  {
    id: "transporte",
    nombre: "Transporte",
    detalle: "Play relanza desde el primer paso; Detener corta",
    opciones() {
      return [
        { valor: 0, nombre: "▶ Play (desde el inicio)" },
        { valor: 1, nombre: "■ Detener" }
      ];
    },
    // No hay "valor elegido": mostramos el estado real del secuenciador
    indice() {
      return (typeof synth !== "undefined" && synth.secuenciaActiva) ? 0 : 1;
    },
    aplicar(idx) {
      if (typeof synth === "undefined") return;
      if (idx === 0) synth.reiniciarSecuencia();
      else synth.detenerSecuencia();
      if (typeof actualizarUISintetizador === "function") actualizarUISintetizador();
    }
  },
  {
    id: "transporte2",
    nombre: "Transporte Sec. 2",
    detalle: "Play / Detener del Secuenciador 2",
    opciones() {
      return [
        { valor: 0, nombre: "▶ Play Sec. 2 (desde el inicio)" },
        { valor: 1, nombre: "■ Detener Sec. 2" }
      ];
    },
    indice() {
      return (typeof secuenciador2 !== "undefined" && secuenciador2.activa) ? 0 : 1;
    },
    aplicar(idx) {
      if (typeof secuenciador2 === "undefined") return;
      if (idx === 0) secuenciador2.reiniciar();
      else secuenciador2.detener();
    }
  },
  {
    id: "raiz",
    nombre: "Nota raíz",
    detalle: "la nota que cae en Aries",
    opciones() {
      return NOTAS_BASE.map((n, i) => ({ valor: i, nombre: n }));
    },
    indice() {
      return notaRaiz;
    },
    aplicar(idx) {
      setNotaRaiz(idx);
      _refrescarTrasCambioMusical();
    }
  },
  {
    id: "intervalo",
    nombre: "Orden por intervalo",
    detalle: "el salto entre regiones",
    opciones() {
      return INTERVALOS_ORDEN.map((iv, i) => ({ valor: i, nombre: iv.nombre }));
    },
    indice() {
      const i = INTERVALOS_ORDEN.findIndex(iv => iv.semitonos === intervaloOrden);
      return i === -1 ? 0 : i;
    },
    aplicar(idx) {
      const iv = INTERVALOS_ORDEN[idx];
      if (!iv) return;
      setIntervaloOrden(iv.semitonos);
      _refrescarTrasCambioMusical();
    }
  },
  {
    id: "ritmo",
    nombre: "Ritmos guardados",
    detalle: "carga el ritmo en el secuenciador",
    opciones() {
      if (typeof ritmos === "undefined") return [];
      return ritmos.list.map((r, i) => ({ valor: i, nombre: r.nombre }));
    },
    indice() {
      if (typeof ritmos === "undefined") return -1;
      return ritmos.list.findIndex(r => r.id === ritmos.ultimoAplicadoId);
    },
    aplicar(idx) {
      if (typeof ritmos === "undefined") return;
      const r = ritmos.list[idx];
      if (!r) return;
      ritmos.aplicar(r.id);
      _refrescarTrasCambioRitmo();
    },

    // La nota "libre" de un ritmo es su propio midiNote: así el botón
    // 🎹 de la tarjeta y esta lista muestran y editan lo mismo.
    notaDeOpcion(idx) {
      if (typeof ritmos === "undefined") return null;
      const r = ritmos.list[idx];
      return (r && typeof r.midiNote === "number") ? r.midiNote : null;
    },
    setNotaOpcion(idx, nota) {
      if (typeof ritmos === "undefined") return;
      const r = ritmos.list[idx];
      if (r) ritmos.asignarNota(r.id, nota);
    }
  }
];

// Los dos parámetros musicales cambian la afinación de todas las
// regiones: hay que reafinar el synth y repintar el panel, igual que
// hacen los selects de "Notas y regiones".
function _refrescarTrasCambioMusical() {
  if (typeof synth !== "undefined" && synth.ctx) synth.updateFromAstros(estado.astros);
  if (typeof refrescarPanel === "function") refrescarPanel();
}

// Un ritmo puede traer otra alineación de astros, así que además de
// las figuras hay que reconstruir las filas de planetas.
function _refrescarTrasCambioRitmo() {
  if (typeof renderFilasPlanetas === "function") renderFilasPlanetas();
  if (typeof actualizarUISintetizador === "function") actualizarUISintetizador();
  if (typeof marcarRitmoAplicado === "function") marcarRitmoAplicado();
}

const mapeoMIDI = {
  // Config por parámetro. Todo arranca en "off": los mapeos no roban
  // notas hasta que el usuario los enciende.
  // `asignaciones` es el mapa del modo "libre": índice de opción →
  // { tipo: "nota", nota } | { tipo: "cc", cc, min, max }.
  cfg: {
    transporte: { modo: "off", notaBase: 12, cc: 23, canal: 0, asignaciones: {} },  // C0
    transporte2: { modo: "off", notaBase: 14, cc: 24, canal: 0, asignaciones: {} }, // D0
    raiz:       { modo: "off", notaBase: 36, cc: 20, canal: 0, asignaciones: {} },  // C2
    intervalo:  { modo: "off", notaBase: 48, cc: 21, canal: 0, asignaciones: {} },  // C3
    ritmo:      { modo: "off", notaBase: 24, cc: 22, canal: 0, asignaciones: {} }   // C1
  },

  // Captura de asignación: { param, tipo: "nota" | "cc" } o null.
  // Con tipo "ritmo:<id>" se asigna la nota explícita de un ritmo.
  captura: null,
  capturaRitmo: null,

  // Último índice recibido por CC en modo "cc", para no reaplicar en
  // cada paso de una perilla que se mueve dentro de la misma opción.
  _ultimoCC: {},

  // Último valor visto de cada CC ("canal:num"), para disparar las
  // asignaciones libres solo cuando el valor ENTRA en su tramo.
  _ultimoValorCC: {},

  onChange: null,   // la UI se redibuja entera (config, captura)
  onValor: null,    // solo cambió el valor en curso

  // ------------------ Persistencia ------------------

  cargar() {
    try {
      const raw = localStorage.getItem(MIDI_MAP_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return;
      PARAMETROS_MIDI.forEach(p => {
        const guardado = data[p.id];
        if (!guardado || typeof guardado !== "object") return;
        const cfg = this.cfg[p.id];
        if (["off", "notas", "libre", "cc"].includes(guardado.modo)) cfg.modo = guardado.modo;
        if (typeof guardado.notaBase === "number") cfg.notaBase = clamp(Math.round(guardado.notaBase), 0, 127);
        if (typeof guardado.cc === "number") cfg.cc = clamp(Math.round(guardado.cc), 0, 127);
        if (typeof guardado.canal === "number") cfg.canal = clamp(Math.round(guardado.canal), 0, 16);
        // Config vieja (sin modo libre) llega sin asignaciones; la de la
        // primera versión del modo libre guardaba números sueltos, que
        // _saneaAsignacion convierte en { tipo: "nota" }.
        if (guardado.asignaciones && typeof guardado.asignaciones === "object") {
          const limpio = {};
          Object.keys(guardado.asignaciones).forEach(k => {
            const idx = parseInt(k, 10);
            const asig = this._saneaAsignacion(guardado.asignaciones[k]);
            if (Number.isInteger(idx) && idx >= 0 && asig) limpio[idx] = asig;
          });
          cfg.asignaciones = limpio;
        }
      });
    } catch (e) {
      console.warn("[midi-map] no se pudo cargar:", e);
    }
  },

  guardar() {
    try {
      localStorage.setItem(MIDI_MAP_STORAGE_KEY, JSON.stringify(this.cfg));
    } catch (e) {
      console.warn("[midi-map] no se pudo guardar:", e);
    }
  },

  // ------------------ Consultas ------------------

  def(id) {
    return PARAMETROS_MIDI.find(p => p.id === id) || null;
  },

  numOpciones(id) {
    const p = this.def(id);
    return p ? p.opciones().length : 0;
  },

  nombreValorActual(id) {
    const p = this.def(id);
    if (!p) return "—";
    const ops = p.opciones();
    if (!ops.length) return "—";
    const i = p.indice();
    return (i >= 0 && ops[i]) ? ops[i].nombre : "—";
  },

  // ------------------ Asignaciones del modo "libre" ------------------

  // Normaliza cualquier cosa guardada a { tipo: "nota" | "cc", ... }.
  // Un número suelto es una nota (formato de la primera versión).
  _saneaAsignacion(a) {
    if (typeof a === "number") {
      return (a >= 0 && a <= 127) ? { tipo: "nota", nota: Math.round(a) } : null;
    }
    if (!a || typeof a !== "object") return null;
    if (a.tipo === "nota") {
      return (typeof a.nota === "number" && a.nota >= 0 && a.nota <= 127)
        ? { tipo: "nota", nota: Math.round(a.nota) } : null;
    }
    if (a.tipo === "cc") {
      if (typeof a.cc !== "number") return null;
      let min = clamp(Math.round(typeof a.min === "number" ? a.min : 0), 0, 127);
      let max = clamp(Math.round(typeof a.max === "number" ? a.max : 127), 0, 127);
      if (min > max) { const t = min; min = max; max = t; }
      return { tipo: "cc", cc: clamp(Math.round(a.cc), 0, 127), min, max };
    }
    return null;
  },

  // Asignación de una opción (o null). Las de tipo nota del parámetro
  // "ritmo" viven en su propio midiNote, así que se consultan aparte.
  asignacion(id, idx) {
    const p = this.def(id);
    if (!p) return null;
    const propia = this.cfg[id].asignaciones[idx];
    if (propia) return propia;
    if (typeof p.notaDeOpcion === "function") {
      const nota = p.notaDeOpcion(idx);
      if (nota !== null) return { tipo: "nota", nota };
    }
    return null;
  },

  // `asig` null borra. Un mismo mensaje solo puede disparar una opción
  // del parámetro: al asignarlo se lo quitamos a la que lo tuviera
  // (misma nota, o mismo CC con tramos que se solapan).
  setAsignacion(id, idx, asig) {
    const p = this.def(id);
    if (!p) return false;
    const nueva = this._saneaAsignacion(asig);
    const asigs = this.cfg[id].asignaciones;

    if (!nueva) {
      delete asigs[idx];
      if (typeof p.setNotaOpcion === "function") p.setNotaOpcion(idx, null);
      this.guardar();
      this._notificar();
      return true;
    }

    // Liberar el mensaje en las demás opciones
    const n = this.numOpciones(id);
    for (let i = 0; i < n; i++) {
      if (i === idx) continue;
      const otra = this.asignacion(id, i);
      if (!otra || otra.tipo !== nueva.tipo) continue;
      const choca = (nueva.tipo === "nota")
        ? otra.nota === nueva.nota
        : (otra.cc === nueva.cc && otra.min <= nueva.max && nueva.min <= otra.max);
      if (choca) {
        delete asigs[i];
        if (typeof p.setNotaOpcion === "function") p.setNotaOpcion(i, null);
      }
    }

    // La nota de un ritmo vive en su midiNote; el CC, en asignaciones
    if (nueva.tipo === "nota" && typeof p.setNotaOpcion === "function") {
      delete asigs[idx];
      p.setNotaOpcion(idx, nueva.nota);
    } else {
      if (typeof p.setNotaOpcion === "function") p.setNotaOpcion(idx, null);
      asigs[idx] = nueva;
    }
    this.guardar();
    this._notificar();
    return true;
  },

  // Retoque del tramo de un CC ya asignado. Avisa "en ligero" para no
  // reconstruir los inputs mientras el usuario los está tecleando.
  setTramoAsignacion(id, idx, min, max) {
    const actual = this.asignacion(id, idx);
    if (!actual || actual.tipo !== "cc") return false;
    const nueva = this._saneaAsignacion({ tipo: "cc", cc: actual.cc, min, max });
    if (!nueva) return false;
    this.cfg[id].asignaciones[idx] = nueva;
    this.guardar();
    this._notificarValor();
    return true;
  },

  // Compatibilidad: el botón 🎹 de las tarjetas de ritmo sigue hablando
  // de notas sueltas.
  notaDeOpcion(id, idx) {
    const a = this.asignacion(id, idx);
    return (a && a.tipo === "nota") ? a.nota : null;
  },

  setNotaOpcion(id, idx, nota) {
    return this.setAsignacion(id, idx, (nota === null || nota === undefined)
      ? null : { tipo: "nota", nota });
  },

  vaciarAsignaciones(id) {
    const p = this.def(id);
    const n = this.numOpciones(id);
    for (let i = 0; i < n; i++) {
      if (p && typeof p.setNotaOpcion === "function") p.setNotaOpcion(i, null);
    }
    this.cfg[id].asignaciones = {};
    this.guardar();
    this._notificar();
  },

  opcionDeNota(id, nota) {
    const n = this.numOpciones(id);
    for (let i = 0; i < n; i++) {
      const a = this.asignacion(id, i);
      if (a && a.tipo === "nota" && a.nota === nota) return i;
    }
    return -1;
  },

  numAsignadas(id) {
    const n = this.numOpciones(id);
    let total = 0;
    for (let i = 0; i < n; i++) if (this.asignacion(id, i)) total++;
    return total;
  },

  // ------------------ Consultas ------------------

  // Primera y última nota del rango, o null si el parámetro no tiene
  // opciones todavía (p. ej. ningún ritmo guardado).
  rangoNotas(id) {
    const n = this.numOpciones(id);
    if (!n) return null;
    const base = this.cfg[id].notaBase;
    return { desde: base, hasta: Math.min(127, base + n - 1), total: n };
  },

  // Notas que un parámetro se queda (rango completo o las asignadas a
  // mano). Con el parámetro en Off o en CC no reclama ninguna.
  notasReclamadas(id) {
    const cfg = this.cfg[id];
    if (cfg.modo === "notas") {
      const r = this.rangoNotas(id);
      if (!r) return [];
      const out = [];
      for (let n = r.desde; n <= r.hasta; n++) out.push(n);
      return out;
    }
    if (cfg.modo === "libre") {
      const n = this.numOpciones(id);
      const out = [];
      for (let i = 0; i < n; i++) {
        const a = this.asignacion(id, i);
        if (a && a.tipo === "nota") out.push(a.nota);
      }
      return out;
    }
    return [];
  },

  // Tramos de CC que reclama el parámetro (modo libre) o el CC entero
  // que barre en modo "cc".
  ccsReclamados(id) {
    const cfg = this.cfg[id];
    if (cfg.modo === "cc") return [{ cc: cfg.cc, min: 0, max: 127 }];
    if (cfg.modo !== "libre") return [];
    const n = this.numOpciones(id);
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = this.asignacion(id, i);
      if (a && a.tipo === "cc") out.push(a);
    }
    return out;
  },

  // Parejas de parámetros que se pelean por la misma nota en el mismo
  // canal: se la queda el primero de PARAMETROS_MIDI.
  conflictos() {
    const activos = PARAMETROS_MIDI
      .map(p => ({
        nombre: p.nombre,
        canal: this.cfg[p.id].canal,
        notas: new Set(this.notasReclamadas(p.id)),
        ccs: this.ccsReclamados(p.id)
      }))
      .filter(a => a.notas.size || a.ccs.length);
    const choques = [];
    for (let i = 0; i < activos.length; i++) {
      for (let j = i + 1; j < activos.length; j++) {
        const a = activos[i], b = activos[j];
        const mismoCanal = (a.canal === 0 || b.canal === 0 || a.canal === b.canal);
        if (!mismoCanal) continue;
        const notaRepetida = [...a.notas].some(n => b.notas.has(n));
        const ccRepetido = a.ccs.some(x => b.ccs.some(
          y => x.cc === y.cc && x.min <= y.max && y.min <= x.max));
        if (notaRepetida || ccRepetido) choques.push(`${a.nombre} ↔ ${b.nombre}`);
      }
    }
    return choques;
  },

  // ------------------ Configuración ------------------

  setModo(id, modo) {
    if (!this.cfg[id] || !["off", "notas", "libre", "cc"].includes(modo)) return;
    this.cfg[id].modo = modo;
    delete this._ultimoCC[id];
    this.guardar();
    this._notificar();
  },

  setNotaBase(id, nota) {
    if (!this.cfg[id]) return;
    this.cfg[id].notaBase = clamp(Math.round(nota), 0, 127);
    this.guardar();
    this._notificar();
  },

  setCC(id, num) {
    if (!this.cfg[id]) return;
    this.cfg[id].cc = clamp(Math.round(num), 0, 127);
    delete this._ultimoCC[id];
    this.guardar();
    this._notificar();
  },

  setCanal(id, canal) {
    if (!this.cfg[id]) return;
    this.cfg[id].canal = clamp(Math.round(canal), 0, 16);
    this.guardar();
    this._notificar();
  },

  // ------------------ Captura (aprender) ------------------

  iniciarCaptura(param, tipo) {
    if (typeof MIDI !== "undefined" && MIDI.capturaPendiente) MIDI.cancelarCaptura();
    this.capturaRitmo = null;
    this.captura = { param, tipo };
    this._notificar();
  },

  // Aprender la nota de UNA opción concreta (modo libre)
  iniciarCapturaOpcion(param, idx) {
    if (typeof MIDI !== "undefined" && MIDI.capturaPendiente) MIDI.cancelarCaptura();
    this.capturaRitmo = null;
    this.captura = { param, tipo: "opcion", idx };
    this._notificar();
  },

  iniciarCapturaRitmo(ritmoId) {
    if (typeof MIDI !== "undefined" && MIDI.capturaPendiente) MIDI.cancelarCaptura();
    this.captura = null;
    this.capturaRitmo = ritmoId;
    this._notificar();
  },

  cancelarCaptura() {
    this.captura = null;
    this.capturaRitmo = null;
    this._notificar();
  },

  capturando(param, tipo) {
    return !!this.captura && this.captura.param === param && this.captura.tipo === tipo;
  },

  capturandoOpcion(param, idx) {
    return !!this.captura && this.captura.tipo === "opcion" &&
           this.captura.param === param && this.captura.idx === idx;
  },

  // ------------------ Aplicar ------------------

  // `forzar` = aplicar aunque el índice no haya cambiado (una nota
  // pulsada dos veces sí vuelve a cargar el ritmo; una perilla que
  // tiembla dentro de la misma opción, no).
  aplicarIndice(id, idx, forzar = true) {
    const p = this.def(id);
    if (!p) return false;
    const ops = p.opciones();
    if (!ops.length) return false;
    const i = clamp(Math.round(idx), 0, ops.length - 1);
    if (!forzar && p.indice() === i) return false;
    p.aplicar(i);
    this._notificarValor();
    return true;
  },

  // ------------------ Entrada MIDI ------------------

  // Devuelve true si el mensaje fue consumido aquí.
  manejarNoteOn(nota, canal) {
    // 1) Aprender el mensaje de una opción suelta (modo libre)
    if (this.captura && this.captura.tipo === "opcion") {
      const { param, idx } = this.captura;
      this.captura = null;   // antes de asignar: el repintado ya no debe decir "esperando"
      this.setAsignacion(param, idx, { tipo: "nota", nota });
      return true;
    }

    // 2) Aprender la nota base de un parámetro (modo rango)
    if (this.captura && this.captura.tipo === "nota") {
      this.setNotaBase(this.captura.param, nota);
      this.captura = null;
      this._notificar();
      return true;
    }

    // 3) Aprender la nota explícita de un ritmo guardado
    if (this.capturaRitmo && typeof ritmos !== "undefined") {
      ritmos.asignarNota(this.capturaRitmo, nota);
      this.capturaRitmo = null;
      this._notificar();
      return true;
    }

    // 4) Nota explícita de un ritmo (funciona con el parámetro en Off)
    if (typeof ritmos !== "undefined") {
      const r = ritmos.porNotaMIDI(nota);
      if (r) {
        ritmos.aplicar(r.id);
        _refrescarTrasCambioRitmo();
        this._notificarValor();
        return true;
      }
    }

    // 5) Rangos ("notas") y notas elegidas a mano ("libre")
    for (const p of PARAMETROS_MIDI) {
      const cfg = this.cfg[p.id];
      if (!this._coincideCanal(cfg, canal)) continue;

      if (cfg.modo === "notas") {
        const rango = this.rangoNotas(p.id);
        if (!rango || nota < rango.desde || nota > rango.hasta) continue;
        this.aplicarIndice(p.id, nota - rango.desde, true);
        return true;
      }

      if (cfg.modo === "libre") {
        const idx = this.opcionDeNota(p.id, nota);
        if (idx === -1) continue;
        this.aplicarIndice(p.id, idx, true);
        return true;
      }

    }

    return false;
  },

  // ¿Esta nota pertenece a algún mapeo activo? Lo usa el note off para
  // no mandar al piano/astros el release de una nota que fue un disparo
  // de parámetro.
  notaDeMapeo(nota, canal) {
    if (typeof ritmos !== "undefined" && ritmos.porNotaMIDI(nota)) return true;
    return PARAMETROS_MIDI.some(p => {
      const cfg = this.cfg[p.id];
      if (!this._coincideCanal(cfg, canal)) return false;
      return this.notasReclamadas(p.id).includes(nota);
    });
  },

  // Devuelve true si el CC fue consumido aquí.
  manejarCC(num, valor, canal) {
    const clave = canal + ":" + num;
    const previo = this._ultimoValorCC[clave];
    this._ultimoValorCC[clave] = valor;

    // Aprender el mensaje de una opción suelta: si mueves un control en
    // vez de tocar una nota, la opción queda mapeada a ese CC. El tramo
    // sale de por dónde venía el control (un botón que manda 127 se
    // queda con 64-127; uno que manda 0, con 0-63), y se puede afinar
    // después desde el panel.
    if (this.captura && this.captura.tipo === "opcion") {
      const { param, idx } = this.captura;
      this.captura = null;
      const tramo = (valor >= 64) ? { min: 64, max: 127 } : { min: 0, max: 63 };
      this.setAsignacion(param, idx, { tipo: "cc", cc: num, min: tramo.min, max: tramo.max });
      return true;
    }

    // Aprender el CC de un parámetro entero (modo "cc")
    if (this.captura && this.captura.tipo === "cc") {
      this.setCC(this.captura.param, num);
      this.captura = null;
      this._notificar();
      return true;
    }

    let consumido = false;

    // Modo libre: asignaciones de tipo CC. Disparo por FLANCO — solo
    // cuando el valor ENTRA en el tramo — para que un fader que lo
    // recorre no reaplique en cada paso.
    for (const p of PARAMETROS_MIDI) {
      const cfg = this.cfg[p.id];
      if (cfg.modo !== "libre" || !this._coincideCanal(cfg, canal)) continue;
      const n = this.numOpciones(p.id);
      for (let i = 0; i < n; i++) {
        const a = this.asignacion(p.id, i);
        if (!a || a.tipo !== "cc" || a.cc !== num) continue;
        consumido = true;
        const dentro = valor >= a.min && valor <= a.max;
        const estaba = (typeof previo === "number") && previo >= a.min && previo <= a.max;
        if (dentro && !estaba) this.aplicarIndice(p.id, i, true);
      }
    }

    // Modo "cc": la perilla entera barre las opciones
    for (const p of PARAMETROS_MIDI) {
      const cfg = this.cfg[p.id];
      if (cfg.modo !== "cc" || cfg.cc !== num || !this._coincideCanal(cfg, canal)) continue;
      const n = this.numOpciones(p.id);
      if (!n) { consumido = true; continue; }
      // 0-127 repartido en n tramos iguales
      const idx = clamp(Math.floor((valor * n) / 128), 0, n - 1);
      if (this._ultimoCC[p.id] !== idx) {
        this._ultimoCC[p.id] = idx;
        this.aplicarIndice(p.id, idx, true);
      }
      consumido = true;
    }
    return consumido;
  },

  _coincideCanal(cfg, canal) {
    return cfg.canal === 0 || cfg.canal === canal;
  },

  _notificar() {
    if (typeof this.onChange === "function") this.onChange();
  },

  _notificarValor() {
    if (typeof this.onValor === "function") this.onValor();
  }
};
