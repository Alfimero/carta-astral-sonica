// =========================================================
// sequencer2.js — Secuenciador 2 (independiente del Secuenciador 1)
// =========================================================
//
// Un segundo secuenciador que puede sonar A LA VEZ que el primero, con
// todo lo suyo: astros marcados, orden, figura rítmica global y por
// astro, BPM (o seguir el del Secuenciador 1), gate, conexión FM
// (FM_ALGORITMOS sobre su propio orden), modo de afinación y su propio
// conjunto de timbre por astro (timbre.js). Es un canal más del
// mezclador.
//
// A diferencia del Secuenciador 1 (que mueve las 10 voces fijas de
// synth.js), éste toca cada paso con el motor de voces de timbre.js:
// crea los nodos de la nota, la programa con tiempo exacto de audio y
// la libera sola. Por eso los dos pueden usar los mismos astros sin
// pisarse.
//
// El reloj es el mismo esquema de synth._programarPasos: setInterval
// de 25 ms + lookahead sobre ctx.currentTime (sin jitter). "▶▶ Ambos"
// arranca los dos secuenciadores en el mismo instante de audio.
// La cadena de ritmos (rhythms.js) sigue siendo del Secuenciador 1.
// =========================================================

const SEC2_STORAGE_KEY = "cas-secuenciador2-v1";

const secuenciador2 = {
  activa: false,

  astrosSel: new Array(10).fill(true),
  ordenSecuencia: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  bpm: 90,
  seguirBPM: false,           // usar el BPM del Secuenciador 1
  gate: 0.6,
  figuraSecuencia: "corchea",
  figuraPorAstro: new Array(10).fill(null),
  fmAlgoritmo: "paralelo",
  modo: "continuo",           // "continuo" | "region" (como synth.modo)
  velocidad: 0.8,
  timbre: null,

  // Canal del mezclador
  volumen: 1,
  pan: 0,
  muted: false,
  solo: false,
  salida: null,
  enMaster: true,
  bus: null,
  nodoPan: null,
  meter: null,
  motor: null,

  _idx: -1,
  _nextTime: 0,
  _scheduler: null,
  _pendientes: [],
  _grupoActual: null,

  // -------------------- Afinación --------------------

  bpmEfectivo() {
    return this.seguirBPM ? synth.bpm : this.bpm;
  },

  frecuenciaDe(k) {
    if (typeof estado === "undefined" || !estado.astros[k]) return 220;
    const a = estado.astros[k];
    const base = (this.modo === "region") ? synth._frecuenciaRegion(a) : synth._frecuenciaContinua(a);
    return base * Math.pow(2, this.timbre.astros[k].octava);
  },

  // -------------------- FM (mismo criterio que synth.rutasFM) --------------------

  // Grupos [carrier, mod1, mod2...] partiendo el orden propio según el
  // algoritmo: cada grupo es una cadena lista para el motor de voces.
  gruposFM() {
    const alg = FM_ALGORITMOS.find(a => a.id === this.fmAlgoritmo) || FM_ALGORITMOS[0];
    const o = this.ordenSecuencia;
    const grupos = [];
    let idx = 0;
    for (const tam of alg.cadenas) {
      grupos.push(o.slice(idx, idx + tam));
      idx += tam;
    }
    return grupos;
  },

  // Un paso por grupo FM con al menos un astro marcado, en el orden de
  // aparición (igual que synth._gruposSecuencia).
  _pasos() {
    const grupos = this.gruposFM();
    const pasos = [];
    const usados = new Set();
    for (const astro of this.ordenSecuencia) {
      if (!this.astrosSel[astro]) continue;
      const g = grupos.find(x => x.includes(astro)) || [astro];
      const clave = g[0];
      if (usados.has(clave)) continue;
      usados.add(clave);
      pasos.push({ grupo: g, representante: astro });
    }
    return pasos;
  },

  factorFiguraDe(k) {
    const id = this.figuraPorAstro[k] || this.figuraSecuencia;
    const f = FIGURAS_SECUENCIA.find(x => x.id === id);
    return f ? f.factor : 1;
  },

  // -------------------- Transporte --------------------

  _asegurarBus() {
    if (this.bus || !synth.ctx) return;
    this.bus = synth.ctx.createGain();
    this.nodoPan = synth.ctx.createStereoPanner();
    this.nodoPan.pan.value = this.pan;
    this.meter = synth.ctx.createAnalyser();
    this.meter.fftSize = 512;
    this.bus.connect(this.nodoPan);
    this._aplicarRuteoGrupo();
    this._aplicarVolumenBus();
  },

  // t0 (opcional): instante de audio del primer paso ("▶▶ Ambos")
  iniciar(t0) {
    if (this.activa) return;
    if (!synth.ctx) synth.init();
    if (!synth.ctx) return;
    if (synth.ctx.state === "suspended") synth.ctx.resume();
    if (!synth.enabled) {
      synth.enabled = true;
      synth._aplicarMaster();
    }
    this._asegurarBus();
    if (!this._pasos().length) return;

    this.activa = true;
    this._idx = -1;
    this._pendientes = [];
    this._grupoActual = null;
    this._nextTime = (typeof t0 === "number") ? Math.max(t0, synth.ctx.currentTime) : synth.ctx.currentTime + 0.05;
    this._programar();
    this._scheduler = setInterval(() => this._programar(), 25);
    this._notificarUI();
  },

  detener() {
    this.activa = false;
    if (this._scheduler) {
      clearInterval(this._scheduler);
      this._scheduler = null;
    }
    if (this.motor) this.motor.soltarTodo();
    this._pendientes = [];
    this._grupoActual = null;
    this._notificarUI();
  },

  reiniciar() {
    if (this.activa) this.detener();
    this.iniciar();
  },

  _programar() {
    if (!this.activa || !synth.ctx) return;
    const now = synth.ctx.currentTime;

    while (this._pendientes.length && this._pendientes[0].t <= now) {
      this._grupoActual = this._pendientes.shift().grupo;
    }

    const LOOKAHEAD = (typeof document !== "undefined" && document.hidden) ? 1.4 : 0.15;
    while (this._nextTime < now + LOOKAHEAD) {
      const pasos = this._pasos();
      if (!pasos.length) {
        this.detener();
        return;
      }
      this._idx = (this._idx + 1) % pasos.length;
      const paso = pasos[this._idx];
      const t = this._nextTime;
      const pasoSeg = (60 / this.bpmEfectivo()) * this.factorFiguraDe(paso.representante);
      const gateSeg = Math.max(0.02, pasoSeg * this.gate);

      this.motor.disparo([paso.grupo], k => this.frecuenciaDe(k), this.velocidad, t, gateSeg);
      this._pendientes.push({ t, grupo: paso.grupo });
      this._nextTime += pasoSeg;
    }
  },

  sonando(k) {
    return this.activa && Array.isArray(this._grupoActual) && this._grupoActual.includes(k);
  },

  // -------------------- Ajustes --------------------

  setAstroSel(k, on) {
    this.astrosSel[k] = !!on;
    this._guardarConfig();
  },

  setBPM(v) {
    this.bpm = clamp(Math.round(v), BPM_MIN, BPM_MAX);
    this._guardarConfig();
  },

  setSeguirBPM(on) {
    this.seguirBPM = !!on;
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

  setFiguraAstro(k, id) {
    if (id !== null && !FIGURAS_SECUENCIA.some(f => f.id === id)) return;
    this.figuraPorAstro[k] = id;
    this._guardarConfig();
  },

  restablecerFiguras() {
    this.figuraPorAstro = new Array(10).fill(null);
    this._guardarConfig();
  },

  // Mismos pesos que el Secuenciador 1 (chips "✦ Ritmos")
  aleatorizarFiguras() {
    const bolsa = [];
    for (const f of FIGURAS_SECUENCIA) {
      const peso = synth.pesoFigura(f.id);
      for (let k = 0; k < peso; k++) bolsa.push(f.id);
    }
    if (!bolsa.length) return false;
    for (let k = 0; k < 10; k++) this.figuraPorAstro[k] = bolsa[Math.floor(Math.random() * bolsa.length)];
    this._guardarConfig();
    return true;
  },

  // Copia figuras y orden del Secuenciador 1 (para variar desde ahí)
  copiarRitmoDeSec1() {
    this.figuraSecuencia = synth.figuraSecuencia;
    this.figuraPorAstro = synth.figuraPorAstro.slice();
    this.ordenSecuencia = synth.ordenSecuencia.slice();
    this._guardarConfig();
  },

  setFmAlgoritmo(id) {
    if (!FM_ALGORITMOS.some(a => a.id === id)) return;
    this.fmAlgoritmo = id;
    this._guardarConfig();
  },

  setModo(m) {
    if (m !== "continuo" && m !== "region") return;
    this.modo = m;
    this._guardarConfig();
  },

  setVelocidad(v) {
    this.velocidad = clamp(v, 0, 1);
    this._guardarConfig();
  },

  // ----- Orden de astros -----

  _setOrden(arr) {
    this.ordenSecuencia = arr;
    this._guardarConfig();
  },

  moverEnOrden(astro, destino) {
    const arr = this.ordenSecuencia.slice();
    const de = arr.indexOf(astro), a = arr.indexOf(destino);
    if (de === -1 || a === -1 || de === a) return false;
    arr.splice(de, 1);
    arr.splice(a, 0, astro);
    this._setOrden(arr);
    return true;
  },

  desplazar(astro, delta) {
    const arr = this.ordenSecuencia.slice();
    const idx = arr.indexOf(astro), j = idx + delta;
    if (idx === -1 || j < 0 || j > 9) return false;
    [arr[idx], arr[j]] = [arr[j], arr[idx]];
    this._setOrden(arr);
    return true;
  },

  ordenDirecto() { this._setOrden([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); },
  ordenInverso() { this._setOrden([9, 8, 7, 6, 5, 4, 3, 2, 1, 0]); },

  ordenAleatorio() {
    const arr = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    this._setOrden(arr);
  },

  ordenPorRegion() {
    if (typeof estado === "undefined" || estado.astros.length < 10) return false;
    const region = {};
    for (let i = 0; i < 10; i++) region[i] = synth.microtonoDeAstro(i, estado.astros);
    this._setOrden([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].sort((a, b) => (region[a] - region[b]) || (a - b)));
    return true;
  },

  // ----- Canal del mezclador -----

  setVolumen(v) {
    this.volumen = clamp(v, 0, 1);
    this._aplicarVolumenBus();
    this._guardarConfig();
  },

  setPan(v) {
    this.pan = clamp(v, -1, 1);
    if (this.nodoPan && synth.ctx) this.nodoPan.pan.setTargetAtTime(this.pan, synth.ctx.currentTime, 0.01);
    this._guardarConfig();
  },

  setMuted(on) {
    this.muted = !!on;
    synth.refrescarVolumenesGrupos();
    this._guardarConfig();
  },

  setSolo(on) {
    this.solo = !!on;
    synth.refrescarVolumenesGrupos();
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

  _aplicarVolumenBus() {
    if (!this.bus || !synth.ctx) return;
    const factor = this.muted ? 0 : ((synth.haySoloEnGrupos() && !this.solo) ? 0 : 1);
    this.bus.gain.setTargetAtTime(this.volumen * factor, synth.ctx.currentTime, 0.01);
  },

  _aplicarRuteoGrupo() {
    if (!this.nodoPan || !synth.ctx) return;
    if (typeof salidasAudio !== "undefined") salidasAudio._asegurarTodosLosNodos();
    try { this.nodoPan.disconnect(); } catch (e) {}
    this.nodoPan.connect(this.meter);
    if (this.enMaster) this.nodoPan.connect(synth.masterGain);
    const salida = typeof salidasAudio !== "undefined" ? salidasAudio.nodoGain(this.salida) : null;
    if (salida) this.nodoPan.connect(salida);
  },

  _notificarUI() {
    if (typeof actualizarUISecuenciador2 === "function") actualizarUISecuenciador2();
    if (typeof actualizarValoresMapeoMIDI === "function") actualizarValoresMapeoMIDI();
  },

  // -------------------- Persistencia --------------------

  _guardarConfig() {
    try {
      localStorage.setItem(SEC2_STORAGE_KEY, JSON.stringify({
        astrosSel: this.astrosSel.slice(),
        ordenSecuencia: this.ordenSecuencia.slice(),
        bpm: this.bpm,
        seguirBPM: this.seguirBPM,
        gate: this.gate,
        figuraSecuencia: this.figuraSecuencia,
        figuraPorAstro: this.figuraPorAstro.slice(),
        fmAlgoritmo: this.fmAlgoritmo,
        modo: this.modo,
        velocidad: this.velocidad,
        timbre: this.timbre,
        volumen: this.volumen,
        pan: this.pan,
        muted: this.muted,
        solo: this.solo,
        salida: this.salida,
        enMaster: this.enMaster
      }));
    } catch (e) {}
  },

  _cargarConfig() {
    let d = null;
    try {
      const raw = localStorage.getItem(SEC2_STORAGE_KEY);
      if (raw) d = JSON.parse(raw);
    } catch (e) {}

    // Primera vez: arranca con el timbre y el modo del Secuenciador 1
    this.modo = synth.modo;
    this.timbre = timbreDesdeSynth();
    if (!d || typeof d !== "object") return;

    if (Array.isArray(d.astrosSel) && d.astrosSel.length === 10) {
      for (let k = 0; k < 10; k++) this.astrosSel[k] = !!d.astrosSel[k];
    }
    if (Array.isArray(d.ordenSecuencia) && d.ordenSecuencia.length === 10) {
      const sorted = d.ordenSecuencia.map(Number).sort((a, b) => a - b);
      if (!sorted.some((v, i) => v !== i)) this.ordenSecuencia = d.ordenSecuencia.map(Number);
    }
    if (typeof d.bpm === "number") this.bpm = clamp(Math.round(d.bpm), BPM_MIN, BPM_MAX);
    if (typeof d.seguirBPM === "boolean") this.seguirBPM = d.seguirBPM;
    if (typeof d.gate === "number") this.gate = clamp(d.gate, 0.05, 1);
    if (FIGURAS_SECUENCIA.some(f => f.id === d.figuraSecuencia)) this.figuraSecuencia = d.figuraSecuencia;
    if (Array.isArray(d.figuraPorAstro) && d.figuraPorAstro.length === 10) {
      for (let k = 0; k < 10; k++) {
        const v = d.figuraPorAstro[k];
        this.figuraPorAstro[k] = FIGURAS_SECUENCIA.some(f => f.id === v) ? v : null;
      }
    }
    if (FM_ALGORITMOS.some(a => a.id === d.fmAlgoritmo)) this.fmAlgoritmo = d.fmAlgoritmo;
    if (d.modo === "continuo" || d.modo === "region") this.modo = d.modo;
    if (typeof d.velocidad === "number") this.velocidad = clamp(d.velocidad, 0, 1);
    this.timbre = sanearTimbre(d.timbre, this.timbre);
    if (typeof d.volumen === "number") this.volumen = clamp(d.volumen, 0, 1);
    if (typeof d.pan === "number") this.pan = clamp(d.pan, -1, 1);
    if (typeof d.muted === "boolean") this.muted = d.muted;
    if (typeof d.solo === "boolean") this.solo = d.solo;
    if (typeof d.salida === "string") this.salida = d.salida || null;
    if (typeof d.enMaster === "boolean") this.enMaster = d.enMaster;
  }
};

secuenciador2._cargarConfig();
secuenciador2.motor = crearMotorVoces({
  timbre: () => secuenciador2.timbre,
  destino: () => secuenciador2.bus,
  maxVoces: 32
});

// Arranca los dos secuenciadores alineados en el mismo instante de audio
function iniciarAmbosSecuenciadores() {
  if (!synth.ctx) synth.init();
  if (!synth.ctx) return;
  if (synth.secuenciaActiva) synth.detenerSecuencia();
  if (secuenciador2.activa) secuenciador2.detener();
  const t0 = synth.ctx.currentTime + 0.08;
  synth.iniciarSecuencia(t0);
  secuenciador2.iniciar(t0);
  if (typeof actualizarUISintetizador === "function") actualizarUISintetizador();
  actualizarUISecuenciador2();
}

function detenerAmbosSecuenciadores() {
  synth.detenerSecuencia();
  secuenciador2.detener();
  if (typeof actualizarUISintetizador === "function") actualizarUISintetizador();
  actualizarUISecuenciador2();
}

// =========================================================
// UI (sección "🥁 Secuenciador 2" del panel)
// =========================================================

function inicializarUISecuenciador2() {
  const s2 = secuenciador2;
  if (!document.getElementById("seccion-secuenciador2")) return;

  document.getElementById("sec2-play")?.addEventListener("click", () => { s2.iniciar(); actualizarUISecuenciador2(); });
  document.getElementById("sec2-stop")?.addEventListener("click", () => { s2.detener(); });
  document.getElementById("sec2-play-ambos")?.addEventListener("click", iniciarAmbosSecuenciadores);
  document.getElementById("sec2-stop-ambos")?.addEventListener("click", detenerAmbosSecuenciadores);

  const bpm = document.getElementById("sec2-bpm");
  const bpmNum = document.getElementById("sec2-bpm-num");
  const aplicarBPM = v => {
    s2.setBPM(v);
    actualizarUISecuenciador2();
  };
  if (bpm) {
    bpm.min = BPM_MIN; bpm.max = BPM_MAX;
    bpm.addEventListener("input", e => aplicarBPM(parseInt(e.target.value, 10)));
  }
  if (bpmNum) {
    bpmNum.min = BPM_MIN; bpmNum.max = BPM_MAX;
    bpmNum.addEventListener("change", e => aplicarBPM(parseInt(e.target.value, 10)));
  }
  document.getElementById("sec2-seguir-bpm")?.addEventListener("change", e => {
    s2.setSeguirBPM(e.target.checked);
    actualizarUISecuenciador2();
  });

  document.getElementById("sec2-gate")?.addEventListener("input", e => {
    s2.setGate(parseFloat(e.target.value));
    actualizarUISecuenciador2();
  });

  const figura = document.getElementById("sec2-figura");
  if (figura) {
    figura.innerHTML = FIGURAS_SECUENCIA.map(f => `<option value="${f.id}">${f.nombre}</option>`).join("");
    figura.addEventListener("change", e => s2.setFiguraSecuencia(e.target.value));
  }

  const fm = document.getElementById("sec2-fm");
  if (fm) {
    fm.innerHTML = FM_ALGORITMOS.map(a => `<option value="${a.id}">${a.nombre}</option>`).join("");
    fm.addEventListener("change", e => { s2.setFmAlgoritmo(e.target.value); renderFilasSecuenciador2(); });
  }

  document.getElementById("sec2-modo")?.addEventListener("change", e => s2.setModo(e.target.value));

  document.getElementById("sec2-velocidad")?.addEventListener("input", e => {
    s2.setVelocidad(parseFloat(e.target.value));
    actualizarUISecuenciador2();
  });
  document.getElementById("sec2-volumen")?.addEventListener("input", e => {
    s2.setVolumen(parseFloat(e.target.value));
    actualizarUISecuenciador2();
  });

  const orden = { "sec2-orden-directo": () => s2.ordenDirecto(), "sec2-orden-inverso": () => s2.ordenInverso(),
                  "sec2-orden-aleatorio": () => s2.ordenAleatorio(), "sec2-orden-region": () => s2.ordenPorRegion() };
  for (const [id, fn] of Object.entries(orden)) {
    document.getElementById(id)?.addEventListener("click", () => { fn(); renderFilasSecuenciador2(); });
  }

  document.getElementById("sec2-ritmos-azar")?.addEventListener("click", () => {
    if (s2.aleatorizarFiguras()) renderFilasSecuenciador2();
  });
  document.getElementById("sec2-reset-figuras")?.addEventListener("click", () => {
    s2.restablecerFiguras();
    renderFilasSecuenciador2();
  });
  document.getElementById("sec2-copiar-ritmo")?.addEventListener("click", () => {
    s2.copiarRitmoDeSec1();
    actualizarUISecuenciador2();
    renderFilasSecuenciador2();
  });
  document.getElementById("sec2-todos")?.addEventListener("click", () => {
    for (let k = 0; k < 10; k++) s2.setAstroSel(k, true);
    renderFilasSecuenciador2();
  });
  document.getElementById("sec2-ninguno")?.addEventListener("click", () => {
    for (let k = 0; k < 10; k++) s2.setAstroSel(k, false);
    renderFilasSecuenciador2();
  });
  document.getElementById("sec2-timbre")?.addEventListener("click", () => editorTimbre.abrirPara("sec2"));

  renderFilasSecuenciador2();
  actualizarUISecuenciador2();
}

// Astro cuyo conjunto se muestra debajo de las filas (null = ninguno)
let _sec2AstroConjunto = null;

function renderConjuntoSecuenciador2() {
  const cont = document.getElementById("sec2-conjunto");
  if (!cont) return;
  for (let k = 0; k < 10; k++) {
    document.getElementById(`sec2-fila-${k}`)?.classList.toggle("editando", k === _sec2AstroConjunto);
  }
  renderConjuntoAstro(cont, "sec2", _sec2AstroConjunto);
}

function renderFilasSecuenciador2() {
  const cont = document.getElementById("sec2-filas");
  if (!cont) return;
  const s2 = secuenciador2;
  const orden = s2.ordenSecuencia;

  // Marca visual de las cadenas FM: los moduladores se sangran bajo su carrier
  const esModulador = new Set();
  for (const g of s2.gruposFM()) g.slice(1).forEach(k => esModulador.add(k));

  cont.innerHTML = "";
  orden.forEach((k, pos) => {
    const fila = document.createElement("div");
    fila.className = "sec2-fila" + (esModulador.has(k) ? " sec2-modulador" : "");
    fila.id = `sec2-fila-${k}`;
    fila.dataset.astro = k;
    const opcionesFigura = `<option value="">=</option>` +
      FIGURAS_SECUENCIA.map(f => `<option value="${f.id}">${f.corto}</option>`).join("");
    fila.innerHTML = `
      <div class="synth-row-arrows">
        <button type="button" class="row-up" ${pos === 0 ? "disabled" : ""} title="Subir en orden">↑</button>
        <button type="button" class="row-down" ${pos === 9 ? "disabled" : ""} title="Bajar en orden">↓</button>
      </div>
      <label class="synth-toggle">
        <input type="checkbox"${s2.astrosSel[k] ? " checked" : ""}>
        <span class="synth-name" draggable="true" title="Arrastra para reordenar (secuencia y cadenas FM de este secuenciador)">${esModulador.has(k) ? "↳ " : ""}${SIMBOLOS_ASTROS[k]} ${NOMBRES_ASTROS[k]}</span>
      </label>
      <select class="synth-figura-astro" title="Figura rítmica de ${NOMBRES_ASTROS[k]} (= usa la global)">${opcionesFigura}</select>
    `;
    cont.appendChild(fila);
    fila.querySelector("select").value = s2.figuraPorAstro[k] || "";

    fila.querySelector('input[type="checkbox"]').addEventListener("change", e => s2.setAstroSel(k, e.target.checked));
    fila.querySelector("select").addEventListener("change", e => s2.setFiguraAstro(k, e.target.value || null));
    fila.querySelector(".row-up").addEventListener("click", () => { if (s2.desplazar(k, -1)) renderFilasSecuenciador2(); });
    fila.querySelector(".row-down").addEventListener("click", () => { if (s2.desplazar(k, 1)) renderFilasSecuenciador2(); });

    const asa = fila.querySelector(".synth-name");
    // Clic en el nombre: ver/editar el conjunto de ese astro (sin
    // alternar la casilla, que es lo que haría el <label> por defecto)
    asa.addEventListener("click", e => {
      e.preventDefault();
      _sec2AstroConjunto = (_sec2AstroConjunto === k) ? null : k;
      renderConjuntoSecuenciador2();
    });
    asa.addEventListener("dragstart", e => {
      e.dataTransfer.setData("text/plain", "sec2:" + k);
      e.dataTransfer.effectAllowed = "move";
    });
    fila.addEventListener("dragover", e => { e.preventDefault(); fila.classList.add("drop-destino"); });
    fila.addEventListener("dragleave", () => fila.classList.remove("drop-destino"));
    fila.addEventListener("drop", e => {
      e.preventDefault();
      fila.classList.remove("drop-destino");
      const dato = e.dataTransfer.getData("text/plain");
      if (!dato.startsWith("sec2:")) return;
      if (s2.moverEnOrden(parseInt(dato.slice(5), 10), k)) renderFilasSecuenciador2();
    });
  });
  renderConjuntoSecuenciador2();
}

function actualizarUISecuenciador2() {
  const s2 = secuenciador2;
  const set = (id, prop, v) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el[prop] = v;
  };
  set("sec2-bpm", "value", s2.bpmEfectivo());
  set("sec2-bpm-num", "value", s2.bpmEfectivo());
  set("sec2-seguir-bpm", "checked", s2.seguirBPM);
  const bpmVal = document.getElementById("sec2-bpm-val");
  if (bpmVal) bpmVal.textContent = s2.bpmEfectivo() + (s2.seguirBPM ? " (Sec. 1)" : "");
  ["sec2-bpm", "sec2-bpm-num"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = s2.seguirBPM;
  });
  set("sec2-gate", "value", s2.gate);
  const gateVal = document.getElementById("sec2-gate-val");
  if (gateVal) gateVal.textContent = Math.round(s2.gate * 100) + "%";
  set("sec2-figura", "value", s2.figuraSecuencia);
  set("sec2-fm", "value", s2.fmAlgoritmo);
  set("sec2-modo", "value", s2.modo);
  set("sec2-velocidad", "value", s2.velocidad);
  const velVal = document.getElementById("sec2-vel-val");
  if (velVal) velVal.textContent = Math.round(s2.velocidad * 100) + "%";
  set("sec2-volumen", "value", s2.volumen);
  const volVal = document.getElementById("sec2-vol-val");
  if (volVal) volVal.textContent = Math.round(s2.volumen * 100) + "%";

  const play = document.getElementById("sec2-play");
  if (play) play.classList.toggle("seq-running", s2.activa);
  const stop = document.getElementById("sec2-stop");
  if (stop) stop.disabled = !s2.activa;
  const sec = document.getElementById("seccion-secuenciador2");
  if (sec) sec.classList.toggle("sec2-sonando", s2.activa);
}

// Desde el draw loop: resalta la fila del paso que suena
function actualizarFilasSecuenciador2() {
  for (let k = 0; k < 10; k++) {
    const fila = document.getElementById(`sec2-fila-${k}`);
    if (fila) fila.classList.toggle("sonando", secuenciador2.sonando(k));
  }
}
