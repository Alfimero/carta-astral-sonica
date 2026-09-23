// =========================================================
// rhythms.js — ritmos guardados y cadenas de ritmos
// =========================================================
//
// Un RITMO es una foto del patrón rítmico del secuenciador: la
// figura que toca cada astro (explícita, sin "=" heredado) más la
// alineación de astros con la que se escuchó.
//
//   { id, nombre, figuras: string[10], orden: number[10], midiNote }
//
//   figuras[i] = id de FIGURAS_SECUENCIA del astro i
//   orden      = copia de synth.ordenSecuencia al capturarlo; define
//                la DIRECCIÓN en que se escucha el ritmo, y por eso
//                es el eje sobre el que trabajan las transformaciones
//                (invertir, empezar desde la mitad).
//   midiNote   = nota MIDI que lo carga en el secuenciador (o null),
//                igual que los bancos. La lee midi-map.js.
//
// Una CADENA es una lista libre de eslabones sobre esos ritmos:
//
//   [{ ritmoId, repeticiones }, ...]
//
// Puede usar cualquier número de ritmos y repetir los que quiera (el
// mismo ritmo puede aparecer en varios eslabones). Con `usarCadena`
// activo, al dar Play el secuenciador toca el ritmo del eslabón 1
// durante N vueltas completas del recorrido de astros, luego el del
// eslabón 2, y así hasta el final, donde vuelve a empezar. Al parar
// se restaura el patrón que el usuario tenía a mano antes de
// encadenar.
// =========================================================

const RITMOS_STORAGE_KEY = "cas-ritmos-v1";

const REPETICIONES_MIN = 1;
const REPETICIONES_MAX = 64;

const ritmos = {
  list: [],
  cadena: [],
  usarCadena: false,

  // Último ritmo cargado en el secuenciador (para resaltarlo en la UI
  // y para saber en qué opción está el mapeo MIDI del parámetro)
  ultimoAplicadoId: null,

  // Estado de reproducción de la cadena
  _slot: -1,        // eslabón en curso (-1 = cadena inactiva)
  _vueltas: 0,      // vueltas completas dadas dentro del eslabón
  _previo: null,    // patrón del usuario antes de encadenar

  // ------------------ Persistencia ------------------

  cargar() {
    try {
      const raw = localStorage.getItem(RITMOS_STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return;

      if (Array.isArray(data.list)) {
        this.list = data.list
          .filter(r => r && typeof r === "object" && r.id)
          .map(r => ({
            id: String(r.id),
            nombre: (typeof r.nombre === "string" && r.nombre) ? r.nombre : "Ritmo",
            figuras: this._saneaFiguras(r.figuras),
            orden: this._saneaOrden(r.orden),
            midiNote: this._saneaNota(r.midiNote)
          }));
      }
      if (Array.isArray(data.cadena)) {
        this.cadena = data.cadena
          .filter(e => e && typeof e === "object" && e.ritmoId && this.porId(e.ritmoId))
          .map(e => ({
            ritmoId: String(e.ritmoId),
            repeticiones: clamp(Math.round(e.repeticiones) || REPETICIONES_MIN,
                                REPETICIONES_MIN, REPETICIONES_MAX)
          }));
      }
      if (typeof data.usarCadena === "boolean") this.usarCadena = data.usarCadena;
    } catch (e) {
      console.warn("[ritmos] no se pudo cargar:", e);
    }
  },

  guardar() {
    try {
      localStorage.setItem(RITMOS_STORAGE_KEY, JSON.stringify({
        list: this.list,
        cadena: this.cadena,
        usarCadena: this.usarCadena
      }));
    } catch (e) {
      console.warn("[ritmos] no se pudo guardar:", e);
    }
  },

  // Compatibilidad con datos viejos: cualquier hueco cae en la figura
  // global actual y el orden ausente es el directo (Sol → Plutón).
  _saneaFiguras(arr) {
    const porDefecto = (typeof synth !== "undefined") ? synth.figuraSecuencia : "negra";
    const out = new Array(10);
    for (let i = 0; i < 10; i++) {
      const v = Array.isArray(arr) ? arr[i] : null;
      out[i] = (typeof v === "string" && FIGURAS_SECUENCIA.some(f => f.id === v)) ? v : porDefecto;
    }
    return out;
  },

  _saneaOrden(arr) {
    if (Array.isArray(arr) && arr.length === 10) {
      const nums = arr.map(Number);
      const ordenados = [...nums].sort((a, b) => a - b);
      if (!ordenados.some((v, i) => v !== i)) return nums;
    }
    return [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  },

  // Datos viejos no traen nota: se quedan sin asignar
  _saneaNota(v) {
    return (typeof v === "number" && v >= 0 && v <= 127) ? Math.round(v) : null;
  },

  _nuevoId() {
    return "r" + Math.random().toString(36).slice(2, 10);
  },

  porId(id) {
    return this.list.find(r => r.id === id) || null;
  },

  // ------------------ CRUD de ritmos ------------------

  // Foto del patrón actual: las filas en "=" se resuelven a la figura
  // global, así el ritmo guardado suena igual aunque después cambie
  // la figura de ejecución.
  capturaActual() {
    const figuras = new Array(10);
    for (let i = 0; i < 10; i++) {
      figuras[i] = synth.figuraPorAstro[i] || synth.figuraSecuencia;
    }
    return { figuras, orden: synth.ordenSecuencia.slice() };
  },

  guardarActual(nombre) {
    const foto = this.capturaActual();
    const ritmo = {
      id: this._nuevoId(),
      nombre: nombre || ("Ritmo " + (this.list.length + 1)),
      figuras: foto.figuras,
      orden: foto.orden,
      midiNote: null
    };
    this.list.push(ritmo);
    this.guardar();
    return ritmo;
  },

  actualizarDesdeActual(id) {
    const r = this.porId(id);
    if (!r) return false;
    const foto = this.capturaActual();
    r.figuras = foto.figuras;
    r.orden = foto.orden;
    this.guardar();
    return true;
  },

  renombrar(id, nombre) {
    const r = this.porId(id);
    if (!r) return false;
    r.nombre = String(nombre || "").trim() || "Ritmo";
    this.guardar();
    return true;
  },

  duplicar(id) {
    const r = this.porId(id);
    if (!r) return null;
    const copia = {
      id: this._nuevoId(),
      nombre: r.nombre + " ✧",
      figuras: r.figuras.slice(),
      orden: r.orden.slice(),
      midiNote: null   // la nota no se hereda: dos ritmos con la misma se pisarían
    };
    this.list.splice(this.list.indexOf(r) + 1, 0, copia);
    this.guardar();
    return copia;
  },

  eliminar(id) {
    const idx = this.list.findIndex(r => r.id === id);
    if (idx === -1) return false;
    this.list.splice(idx, 1);
    // Los eslabones que apuntaban al ritmo borrado se van con él
    this.cadena = this.cadena.filter(e => e.ritmoId !== id);
    if (this.ultimoAplicadoId === id) this.ultimoAplicadoId = null;
    if (this._slot >= this.cadena.length) this._slot = this.cadena.length ? 0 : -1;
    this.guardar();
    return true;
  },

  // ------------------ Nota MIDI ------------------

  // Una nota por ritmo: al asignarla se la quitamos a quien la tuviera
  // para que un mismo mensaje no dispare dos ritmos.
  asignarNota(id, nota) {
    const r = this.porId(id);
    if (!r) return false;
    const n = this._saneaNota(nota);
    if (n !== null) this.list.forEach(o => { if (o.midiNote === n) o.midiNote = null; });
    r.midiNote = n;
    this.guardar();
    return true;
  },

  porNotaMIDI(nota) {
    if (typeof nota !== "number") return null;
    return this.list.find(r => r.midiNote === nota) || null;
  },

  // ------------------ Transformaciones ------------------

  // Las tres trabajan sobre el ritmo TAL COMO SE ESCUCHA: la lista de
  // figuras recorrida en el orden de astros guardado.
  _secuenciaFiguras(r) {
    return r.orden.map(a => r.figuras[a]);
  },

  _escribirSecuencia(r, seq) {
    r.orden.forEach((a, i) => { r.figuras[a] = seq[i]; });
  },

  // Invertir la dirección: el ritmo se escucha de atrás hacia adelante
  invertir(id) {
    const r = this.porId(id);
    if (!r) return false;
    this._escribirSecuencia(r, this._secuenciaFiguras(r).reverse());
    this.guardar();
    return true;
  },

  // Empezar desde la mitad: rota el ritmo media vuelta
  desdeLaMitad(id) {
    const r = this.porId(id);
    if (!r) return false;
    const seq = this._secuenciaFiguras(r);
    const mitad = Math.floor(seq.length / 2);
    this._escribirSecuencia(r, seq.slice(mitad).concat(seq.slice(0, mitad)));
    this.guardar();
    return true;
  },

  // Reducir (dir = +1) o aumentar (dir = -1) cada figura al siguiente
  // símbolo rítmico de FIGURAS_SECUENCIA, que va de la más larga a la
  // más corta pasando por los tresillos: blanca → tresillo de blancas
  // → negra → ... Las figuras que ya tocan un extremo se quedan ahí
  // (no hay nada más largo que la blanca ni más corto que el tresillo
  // de semifusas).
  desplazarFiguras(id, dir) {
    const r = this.porId(id);
    if (!r) return false;
    const paso = (dir >= 0) ? 1 : -1;
    let cambio = false;
    for (let i = 0; i < 10; i++) {
      const idx = FIGURAS_SECUENCIA.findIndex(f => f.id === r.figuras[i]);
      if (idx === -1) continue;
      const destino = clamp(idx + paso, 0, FIGURAS_SECUENCIA.length - 1);
      if (destino !== idx) {
        r.figuras[i] = FIGURAS_SECUENCIA[destino].id;
        cambio = true;
      }
    }
    if (cambio) this.guardar();
    return cambio;
  },

  // ------------------ Aplicar al secuenciador ------------------

  // Devuelve el ritmo al secuenciador. El orden solo se toca si de
  // verdad cambió: reordenar rehace el ruteo FM y no vale la pena
  // hacerlo en cada vuelta de la cadena.
  aplicar(id) {
    const r = this.porId(id);
    if (!r) return false;
    synth.aplicarPatronFiguras(r.figuras);
    if (r.orden.some((v, i) => v !== synth.ordenSecuencia[i])) {
      synth.setOrdenSecuencia(r.orden);
    }
    this.ultimoAplicadoId = r.id;
    return true;
  },

  // ------------------ Cadena ------------------

  setUsarCadena(on) {
    this.usarCadena = !!on;
    if (!this.usarCadena) this.detenerCadena();
    else if (synth.secuenciaActiva) this.iniciarCadena();
    this.guardar();
  },

  agregarACadena(ritmoId) {
    if (!this.porId(ritmoId)) return false;
    this.cadena.push({ ritmoId, repeticiones: 1 });
    this.guardar();
    return true;
  },

  quitarDeCadena(idx) {
    if (idx < 0 || idx >= this.cadena.length) return false;
    this.cadena.splice(idx, 1);
    if (this._slot >= this.cadena.length) this._slot = this.cadena.length ? 0 : -1;
    this.guardar();
    return true;
  },

  moverEnCadena(idx, dir) {
    const destino = idx + (dir >= 0 ? 1 : -1);
    if (idx < 0 || idx >= this.cadena.length) return false;
    if (destino < 0 || destino >= this.cadena.length) return false;
    const tmp = this.cadena[destino];
    this.cadena[destino] = this.cadena[idx];
    this.cadena[idx] = tmp;
    this.guardar();
    return true;
  },

  setRepeticiones(idx, n) {
    const eslabon = this.cadena[idx];
    if (!eslabon) return false;
    eslabon.repeticiones = clamp(Math.round(n) || REPETICIONES_MIN,
                                 REPETICIONES_MIN, REPETICIONES_MAX);
    this.guardar();
    return true;
  },

  limpiarCadena() {
    this.cadena = [];
    this._slot = -1;
    this._vueltas = 0;
    this.guardar();
  },

  totalVueltasCadena() {
    return this.cadena.reduce((s, e) => s + e.repeticiones, 0);
  },

  // ------------------ Reproducción de la cadena ------------------

  cadenaActiva() {
    return this.usarCadena && this.cadena.length > 0 && this._slot >= 0;
  },

  ritmoEnCurso() {
    if (!this.cadenaActiva()) return null;
    const eslabon = this.cadena[this._slot];
    return eslabon ? this.porId(eslabon.ritmoId) : null;
  },

  // La llama synth.iniciarSecuencia()
  iniciarCadena() {
    if (!this.usarCadena || !this.cadena.length) return;
    if (!this._previo) {
      this._previo = {
        figuras: synth.figuraPorAstro.slice(),
        orden: synth.ordenSecuencia.slice()
      };
    }
    this._irASlot(0);
  },

  // La llama synth._programarPasos() al cerrar cada vuelta completa
  // del recorrido de astros.
  avanzarCiclo() {
    if (!this.cadenaActiva()) return;
    const eslabon = this.cadena[this._slot];
    if (!eslabon) return;
    this._vueltas++;
    if (this._vueltas >= eslabon.repeticiones) {
      this._irASlot((this._slot + 1) % this.cadena.length);
    } else {
      this._notificarUI();
    }
  },

  // La llama synth.detenerSecuencia(): devuelve el patrón que el
  // usuario tenía antes de encadenar.
  detenerCadena() {
    this._slot = -1;
    this._vueltas = 0;
    const previo = this._previo;
    this._previo = null;
    if (previo) {
      synth.aplicarPatronFiguras(previo.figuras);
      if (previo.orden.some((v, i) => v !== synth.ordenSecuencia[i])) {
        synth.setOrdenSecuencia(previo.orden);
      }
    }
    this._notificarUI();
  },

  _irASlot(i) {
    this._slot = i;
    this._vueltas = 0;
    const eslabon = this.cadena[i];
    if (eslabon) this.aplicar(eslabon.ritmoId);
    this._notificarUI();
  },

  // El panel también se repinta desde el draw loop, pero avisar aquí
  // mantiene las figuras y el eslabón resaltado al día aunque el canvas
  // esté detenido (pestaña oculta: el navegador congela requestAnimationFrame).
  _notificarUI() {
    if (typeof marcarRitmoEnCurso === "function") marcarRitmoEnCurso();
  },

  // Clave de estado: la UI solo se repinta cuando de verdad cambia
  claveEstado() {
    return this.cadenaActiva() ? this._slot + ":" + this._vueltas : "";
  }
};
