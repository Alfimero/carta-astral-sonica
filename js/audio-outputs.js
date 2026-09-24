// =========================================================
// audio-outputs.js — salidas de audio virtuales
// =========================================================
//
// Deja enrutar canales del mezclador hacia OTRO dispositivo de salida
// del sistema (p. ej. un cable de audio virtual como VB-Audio Virtual
// Cable o BlackHole), para que un DAW externo (Ableton) los reciba
// como una entrada de audio independiente.
//
// Cómo funciona: cada "salida" es un bus propio dentro del MISMO
// AudioContext compartido (synth.ctx) — un GainNode que desemboca en
// un MediaStreamAudioDestinationNode. Ese stream se reproduce con un
// <audio> oculto, y es AHÍ donde se elige el dispositivo físico con
// HTMLMediaElement.setSinkId(deviceId). Así, un solo AudioContext
// puede alimentar varios dispositivos de salida a la vez sin crear
// más contextos (los AudioNode no se pueden conectar entre contextos
// distintos).
//
// El <audio> se mantiene pausado mientras la salida no tenga un
// dispositivo asignado, para no duplicar el sonido en las bocinas
// del sistema (que es adonde iría igualmente un <audio> sin sinkId
// propio).
//
// synth.js y piano.js conectan sus propios nodos de grupo/astro a
// salidasAudio.nodoGain(id) además de (o en vez de) sumar al Maestro;
// ver synth._aplicarRuteo / synth._aplicarRuteoGrupos / piano._aplicarRuteoGrupo /
// secuenciador2._aplicarRuteoGrupo.
// =========================================================

const SALIDAS_STORAGE_KEY = "cas-salidas-v1";

const salidasAudio = {
  lista: [],          // [{id, nombre, deviceId}] — persistido
  dispositivos: [],   // [{deviceId, label}] — cache de enumerateDevices()
  _nodos: {},          // id → {gainNode, streamDest, audioEl, activa}
  _permisoMicPedido: false,

  soportaSetSinkId() {
    return typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
  },

  soportaSelectAudioOutput() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.selectAudioOutput);
  },

  crear(nombre) {
    const id = "salida-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    this.lista.push({ id, nombre: (nombre || "").trim() || ("Salida " + (this.lista.length + 1)), deviceId: null });
    this._guardarConfig();
    if (typeof synth !== "undefined" && synth.ctx) this._asegurarNodo(id);
    return id;
  },

  eliminar(id) {
    const nodo = this._nodos[id];
    if (nodo) {
      try { nodo.gainNode.disconnect(); } catch (e) {}
      try { nodo.audioEl.pause(); } catch (e) {}
      try { nodo.audioEl.srcObject = null; } catch (e) {}
      delete this._nodos[id];
    }
    this.lista = this.lista.filter(s => s.id !== id);
    this._guardarConfig();

    // Cualquier canal que enviaba a esta salida vuelve a "sin salida"
    // y se re-aplica el ruteo para soltar la conexión huérfana.
    if (typeof synth !== "undefined") {
      let tocado = false;
      for (let i = 0; i < 10; i++) {
        if (synth.planetSalida[i] === id) { synth.planetSalida[i] = null; tocado = true; }
      }
      if (synth.salidaSecuenciador === id) { synth.salidaSecuenciador = null; tocado = true; }
      if (tocado && synth.ctx) { synth._aplicarRuteo(); synth._guardarConfig(); }
    }
    if (typeof piano !== "undefined") {
      let tocado = false;
      for (const inst of piano.instrumentos) {
        if (inst.salida === id) { inst.salida = null; tocado = true; }
      }
      if (tocado) {
        if (synth.ctx) piano._aplicarRuteoGrupos();
        piano._guardarConfig();
      }
    }
    if (typeof secuenciador2 !== "undefined" && secuenciador2.salida === id) {
      secuenciador2.salida = null;
      if (synth.ctx) secuenciador2._aplicarRuteoGrupo();
      secuenciador2._guardarConfig();
    }
  },

  renombrar(id, nombre) {
    const s = this.lista.find(s => s.id === id);
    if (!s) return;
    s.nombre = (nombre || "").trim() || s.nombre;
    this._guardarConfig();
  },

  async setDispositivo(id, deviceId) {
    const s = this.lista.find(s => s.id === id);
    if (!s) return;
    s.deviceId = deviceId || null;
    this._guardarConfig();
    if (typeof synth !== "undefined" && synth.ctx) this._asegurarNodo(id);
    await this._aplicarDispositivo(id);
  },

  async _aplicarDispositivo(id) {
    const s = this.lista.find(s => s.id === id);
    const nodo = this._nodos[id];
    if (!s || !nodo) return;
    try { nodo.audioEl.pause(); } catch (e) {}
    nodo.activa = false;
    if (!s.deviceId || !this.soportaSetSinkId()) return;
    try {
      await nodo.audioEl.setSinkId(s.deviceId);
      await nodo.audioEl.play();
      nodo.activa = true;
    } catch (e) {
      console.warn("[salidasAudio] no se pudo enrutar la salida \"" + s.nombre + "\"", e);
    }
  },

  estaActiva(id) {
    const nodo = this._nodos[id];
    return !!(nodo && nodo.activa);
  },

  nodoGain(id) {
    if (!id) return null;
    const nodo = this._nodos[id];
    return nodo ? nodo.gainNode : null;
  },

  _asegurarTodosLosNodos() {
    for (const s of this.lista) this._asegurarNodo(s.id);
  },

  _asegurarNodo(id) {
    if (this._nodos[id] || typeof synth === "undefined" || !synth.ctx) return;
    const gainNode = synth.ctx.createGain();
    const streamDest = synth.ctx.createMediaStreamDestination();
    gainNode.connect(streamDest);
    const audioEl = new Audio();
    audioEl.srcObject = streamDest.stream;
    this._nodos[id] = { gainNode, streamDest, audioEl, activa: false };
    this._aplicarDispositivo(id);
  },

  // Lista de dispositivos de salida del sistema. Chrome/Edge necesitan
  // el permiso "speaker-selection" para devolver `label` (nombre real)
  // de las salidas — el permiso de MICRÓFONO (getUserMedia) NO alcanza
  // por sí solo en versiones recientes, aunque durante un tiempo sí
  // bastaba. La forma correcta de pedirlo es `selectAudioOutput()`: abre
  // un selector nativo del sistema, y de paso desbloquea `label` para
  // TODAS las salidas en enumerateDevices(), no solo la elegida.
  //
  // IMPORTANTE: `selectAudioOutput()` exige "activación transitoria"
  // reciente del usuario (haberse llamado muy cerca de un clic real). Por
  // eso va ANTES que cualquier otro await en este método — si primero
  // esperamos a enumerateDevices() (un viaje de ida y vuelta al proceso
  // del navegador), el navegador puede considerar que la activación del
  // clic ya expiró y rechazar la llamada EN SILENCIO (parece que "no hace
  // nada"). También se guarda `_ultimoError` para que la UI pueda mostrar
  // qué pasó, en vez de tragárnoslo sin dejar rastro.
  async refrescarDispositivos() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return [];

    // El navegador solo permite una solicitud de selectAudioOutput() a la
    // vez; si la anterior quedó pendiente (p. ej. por el problema de la
    // activación expirada), una segunda llamada choca contra esa y da la
    // sensación de que el botón "se bloqueó". Este candado evita disparar
    // una segunda solicitud mientras la primera sigue en curso.
    if (this._refrescando) return this.dispositivos;
    this._refrescando = true;
    this._ultimoError = null;

    try {
      if (this.soportaSelectAudioOutput()) {
        try {
          await navigator.mediaDevices.selectAudioOutput();
        } catch (e) {
          // NotFoundError = el usuario cerró el selector sin elegir nada:
          // no es un error real, solo no ganamos etiquetas nuevas por acá.
          if (e && e.name !== "NotFoundError") {
            this._ultimoError = (e && e.name) ? `${e.name}: ${e.message || ""}` : String(e);
          }
        }
      }

      let devs = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      let sinEtiquetas = devs.some(d => d.kind === "audiooutput" && !d.label);

      // Respaldo para navegadores sin `selectAudioOutput` pero con
      // `setSinkId`: el permiso de MICRÓFONO también desbloquea `label`
      // en versiones más viejas (no se graba ni se usa para nada más).
      // Una sola vez por sesión para no insistir si el usuario lo negó.
      if (sinEtiquetas && !this._permisoMicPedido) {
        this._permisoMicPedido = true;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(t => t.stop());
          devs = await navigator.mediaDevices.enumerateDevices();
        } catch (e) {
          // El usuario negó el permiso: seguimos con los deviceId sin nombre.
        }
      }

      this.dispositivos = devs
        .filter(d => d.kind === "audiooutput")
        .map(d => ({ deviceId: d.deviceId, label: d.label || ("Salida " + d.deviceId.slice(0, 6)) }));
      return this.dispositivos;
    } finally {
      this._refrescando = false;
    }
  },

  _guardarConfig() {
    try {
      localStorage.setItem(SALIDAS_STORAGE_KEY, JSON.stringify({
        lista: this.lista.map(s => ({ id: s.id, nombre: s.nombre, deviceId: s.deviceId }))
      }));
    } catch (e) {}
  },

  _cargarConfig() {
    try {
      const raw = localStorage.getItem(SALIDAS_STORAGE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (Array.isArray(d.lista)) {
        this.lista = d.lista
          .filter(s => s && typeof s.id === "string" && typeof s.nombre === "string")
          .map(s => ({ id: s.id, nombre: s.nombre, deviceId: typeof s.deviceId === "string" ? s.deviceId : null }));
      }
    } catch (e) {}
  }
};

salidasAudio._cargarConfig();
