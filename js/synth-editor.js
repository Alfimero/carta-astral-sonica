// =========================================================
// synth-editor.js — ventana "Rack de sintetizadores"
// =========================================================
//
// Ventana flotante (mismo patrón que mixer.js) con una tarjeta por astro,
// reuniendo TODOS sus parámetros de timbre en un solo lugar: octava, forma
// de onda, volumen, armónicos, profundidad FM propia, filtros HPF/LPF y
// ADSR (el mismo editor del panel, con curvas). No es un tercer origen de verdad: lee y
// escribe el MISMO estado que ya editan el panel lateral (synth.js) y el
// mezclador — esta ventana es solo otro punto de entrada al timbre del
// Secuenciador 1. Los instrumentos del piano y el Secuenciador 2 tienen su
// PROPIO conjunto de timbre por astro (timbre.js, ventana "Conjuntos de
// timbre"); el ADSR de las tarjetas es el mismo crearEditorADSR del panel.
// =========================================================

const RACK_STORAGE_KEY = "cas-rack-sintetizadores-v1";

// Copia local minúscula: interaction.js define escaparHTML() pero carga
// DESPUÉS de este archivo (ver orden de <script> en index.html), mismo
// motivo por el que mixer.js duplica la suya.
function _rackEscaparHTML(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

// Sliders de frecuencia en escala logarítmica (20Hz-20kHz), como los EQs
// de un DAW: un slider lineal 0..1 da mucha más resolución en graves.
const RACK_HZ_MIN = 20, RACK_HZ_MAX = 20000;
function _rackSliderAHz(t) {
  return RACK_HZ_MIN * Math.pow(RACK_HZ_MAX / RACK_HZ_MIN, clamp(t, 0, 1));
}
function _rackHzASlider(hz) {
  return Math.log(clamp(hz, RACK_HZ_MIN, RACK_HZ_MAX) / RACK_HZ_MIN) / Math.log(RACK_HZ_MAX / RACK_HZ_MIN);
}

const rackSintetizadores = {
  abierto: false,
  pos: { x: null, y: null },
  _raf: null,
  _ordenCache: "",

  toggle() {
    if (this.abierto) this.cerrar();
    else this.abrir();
  },

  abrir() {
    synth.init();
    if (synth.ctx && synth.ctx.state === "suspended") synth.ctx.resume();
    const vent = this._construirVentana();
    vent.hidden = false;
    this.abierto = true;
    this._renderTarjetas();
    this._iniciarCiclo();
    this._guardarConfig();
  },

  cerrar() {
    const vent = document.getElementById("ventana-rack-sintetizadores");
    if (vent) vent.hidden = true;
    this.abierto = false;
    this._detenerCiclo();
    this._guardarConfig();
  },

  // -------------------- Construcción del DOM --------------------

  _construirVentana() {
    let vent = document.getElementById("ventana-rack-sintetizadores");
    if (vent) return vent;

    vent = document.createElement("div");
    vent.id = "ventana-rack-sintetizadores";
    vent.className = "ventana-flotante rack-ventana";
    vent.hidden = true;

    const guardado = this._leerConfig();
    const px = clamp((guardado && typeof guardado.x === "number") ? guardado.x : 60, 0, Math.max(0, window.innerWidth - 160));
    const py = clamp((guardado && typeof guardado.y === "number") ? guardado.y : 90, 0, Math.max(0, window.innerHeight - 120));
    vent.style.left = px + "px";
    vent.style.top = py + "px";

    vent.innerHTML = `
      <div class="ventana-titulo rack-titulo">
        <span>🎛 Rack de sintetizadores</span>
        <button type="button" class="rack-cerrar" title="Cerrar el rack de sintetizadores">✕</button>
      </div>
      <p class="rack-hint">Un sintetizador por astro: el timbre del Secuenciador 1 (y del mapeo MIDI de astros). Los instrumentos del piano y el Secuenciador 2 tienen su propio conjunto: botón 🎛 en su sección.</p>
      <div class="rack-canales"></div>
    `;
    document.body.appendChild(vent);

    vent.querySelector(".rack-cerrar").addEventListener("click", () => this.cerrar());

    // Arrastre por la barra de título (mismo patrón que mixer.js)
    const barra = vent.querySelector(".rack-titulo");
    barra.addEventListener("pointerdown", ev => {
      if (ev.target.tagName === "BUTTON") return;
      ev.preventDefault();
      const dx = ev.clientX - vent.offsetLeft;
      const dy = ev.clientY - vent.offsetTop;
      const mover = e2 => {
        vent.style.left = clamp(e2.clientX - dx, 0, window.innerWidth - 120) + "px";
        vent.style.top = clamp(e2.clientY - dy, 0, window.innerHeight - 40) + "px";
      };
      const soltar = () => {
        window.removeEventListener("pointermove", mover);
        window.removeEventListener("pointerup", soltar);
        this._guardarConfig();
      };
      window.addEventListener("pointermove", mover);
      window.addEventListener("pointerup", soltar);
    });

    return vent;
  },

  _colorAstro(k) {
    const porTema = THEME.astros && THEME.astros.coloresPorAstro && THEME.astros.coloresPorAstro[k];
    return porTema || COLORES_ASTROS_DEFAULT[k];
  },

  // Reconstruye las 10 tarjetas en el orden de synth.ordenSecuencia (mismo
  // criterio que renderFilasPlanetas): agrupa visualmente a los astros que
  // están encadenados en el algoritmo FM activo.
  _renderTarjetas() {
    const vent = document.getElementById("ventana-rack-sintetizadores");
    if (!vent) return;
    const cont = vent.querySelector(".rack-canales");
    if (!cont) return;

    this._ordenCache = synth.ordenSecuencia.join(",");
    cont.innerHTML = "";
    for (const i of synth.ordenSecuencia) {
      cont.appendChild(this._construirTarjeta(i));
    }
  },

  _filaSlider({ id, label, min, max, step, value, title }) {
    return `
      <div class="rack-fila">
        <label for="${id}" title="${_rackEscaparHTML(title || label)}">${label}</label>
        <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}">
        <span class="rack-valor" id="${id}-val"></span>
      </div>
    `;
  },

  _construirTarjeta(i) {
    const el = document.createElement("div");
    el.className = "rack-tarjeta";
    el.dataset.astro = i;
    const color = this._colorAstro(i);

    const opcionesOctava = [];
    for (let o = -4; o <= 4; o++) {
      const label = (o > 0 ? "+" + o : "" + o);
      opcionesOctava.push(`<option value="${o}"${o === synth.octavaPorPlaneta[i] ? " selected" : ""}>${label}</option>`);
    }
    const opcionesOnda = FORMAS_ONDA.map(f =>
      `<option value="${f.id}"${f.id === synth.formaOnda[i] ? " selected" : ""}>${f.nombre}</option>`
    ).join("");

    el.innerHTML = `
      <div class="rack-nombre" style="color:${color}" title="${_rackEscaparHTML(NOMBRES_ASTROS[i])}">${SIMBOLOS_ASTROS[i]} ${_rackEscaparHTML(NOMBRES_ASTROS[i])}</div>
      <div class="rack-fila">
        <label title="Octava de ${_rackEscaparHTML(NOMBRES_ASTROS[i])}">Octava</label>
        <select class="rack-octava">${opcionesOctava.join("")}</select>
        <span class="rack-valor"></span>
      </div>
      <div class="rack-fila">
        <label title="Forma de onda de ${_rackEscaparHTML(NOMBRES_ASTROS[i])}">Onda</label>
        <select class="rack-onda">${opcionesOnda}</select>
        <span class="rack-valor"></span>
      </div>
      ${this._filaSlider({ id: `rack-vol-${i}`, label: "Volumen", min: 0, max: 1, step: 0.01, value: synth.planetVolume[i] })}
      <div class="rack-adsr-mini"></div>
      ${this._filaSlider({ id: `rack-fm-${i}`, label: "Prof. FM", min: 0, max: 2, step: 0.01, value: synth.fmProfundidadAstro[i],
          title: "Cuánto modula este astro cuando actúa como modulador en la cadena FM activa" })}
      ${this._filaSlider({ id: `rack-arp-${i}`, label: "Armón. pares", min: 0, max: 1, step: 0.01, value: synth.armonicosPares[i] })}
      ${this._filaSlider({ id: `rack-ari-${i}`, label: "Armón. impares", min: 0, max: 1, step: 0.01, value: synth.armonicosImpares[i] })}
      ${this._filaSlider({ id: `rack-hpf-${i}`, label: "HPF corte", min: 0, max: 1, step: 0.001, value: _rackHzASlider(synth.planetHPF[i]) })}
      ${this._filaSlider({ id: `rack-hpfq-${i}`, label: "HPF Q", min: 0.1, max: 18, step: 0.1, value: synth.planetHPFQ[i] })}
      ${this._filaSlider({ id: `rack-lpf-${i}`, label: "LPF corte", min: 0, max: 1, step: 0.001, value: _rackHzASlider(synth.planetLPF[i]) })}
      ${this._filaSlider({ id: `rack-lpfq-${i}`, label: "LPF Q", min: 0.1, max: 18, step: 0.1, value: synth.planetLPFQ[i] })}
    `;

    // Octava — refleja el cambio en la fila equivalente del panel lateral
    el.querySelector(".rack-octava").addEventListener("change", e => {
      if (!synth.ctx) synth.init();
      synth.setOctavaPlaneta(i, parseInt(e.target.value, 10));
      const otro = document.getElementById(`synth-oct-${i}`);
      if (otro) otro.value = synth.octavaPorPlaneta[i];
    });

    // Forma de onda — ídem
    el.querySelector(".rack-onda").addEventListener("change", e => {
      if (!synth.ctx) synth.init();
      synth.setFormaOnda(i, e.target.value);
      const otro = document.getElementById(`synth-onda-${i}`);
      if (otro) otro.value = synth.formaOnda[i];
    });

    // Volumen
    el.querySelector(`#rack-vol-${i}`).addEventListener("input", e => {
      if (!synth.ctx) synth.init();
      synth.setPlanetVolume(i, parseFloat(e.target.value));
    });

    // Profundidad FM propia
    el.querySelector(`#rack-fm-${i}`).addEventListener("input", e => {
      if (!synth.ctx) synth.init();
      synth.setFmProfundidadAstro(i, parseFloat(e.target.value));
    });

    // Armónicos: al tocar cualquiera, forzar forma "custom" (igual que el
    // editor de armónicos del panel lateral) para que el cambio se escuche.
    const aplicarArmonicos = () => {
      if (!synth.ctx) synth.init();
      const pares = parseFloat(el.querySelector(`#rack-arp-${i}`).value);
      const impares = parseFloat(el.querySelector(`#rack-ari-${i}`).value);
      synth.setArmonicos(i, pares, impares);
      if (synth.formaOnda[i] !== "custom") {
        synth.setFormaOnda(i, "custom");
        el.querySelector(".rack-onda").value = "custom";
        const otro = document.getElementById(`synth-onda-${i}`);
        if (otro) otro.value = "custom";
      }
    };
    el.querySelector(`#rack-arp-${i}`).addEventListener("input", aplicarArmonicos);
    el.querySelector(`#rack-ari-${i}`).addEventListener("input", aplicarArmonicos);

    // Filtros: frecuencia de corte (escala log) + resonancia
    el.querySelector(`#rack-hpf-${i}`).addEventListener("input", e => {
      if (!synth.ctx) synth.init();
      synth.setPlanetHPF(i, _rackSliderAHz(parseFloat(e.target.value)));
    });
    el.querySelector(`#rack-hpfq-${i}`).addEventListener("input", e => {
      if (!synth.ctx) synth.init();
      synth.setPlanetHPFQ(i, parseFloat(e.target.value));
    });
    el.querySelector(`#rack-lpf-${i}`).addEventListener("input", e => {
      if (!synth.ctx) synth.init();
      synth.setPlanetLPF(i, _rackSliderAHz(parseFloat(e.target.value)));
    });
    el.querySelector(`#rack-lpfq-${i}`).addEventListener("input", e => {
      if (!synth.ctx) synth.init();
      synth.setPlanetLPFQ(i, parseFloat(e.target.value));
    });

    // ADSR: el editor completo del panel (vértices + rombos de curvatura)
    this._crearEditorADSR(el.querySelector(".rack-adsr-mini"), i);

    this._actualizarValoresTarjeta(el, i);
    return el;
  },

  // -------------------- Editor ADSR --------------------
  // El editor vive en timbre.js (crearEditorADSR): el mismo del panel del
  // sintetizador, con vértices, rombos de curvatura y valores.

  _crearEditorADSR(cont, i) {
    crearEditorADSR(cont, {
      adsr: () => synth.adsrAstro[i],
      curva: () => synth.adsrCurvaAstro[i],
      set: (param, v) => synth.setADSRAstro(i, param, v),
      setCurva: (param, v) => synth.setADSRCurva(i, param, v)
    });
  },

  // -------------------- Sincronización de controles --------------------
  // Otros paneles (filas del secuenciador, editor ADSR grande, MIDI)
  // también cambian estos mismos valores: igual que el mezclador, el rack
  // se refresca solo en cada frame de su propio ciclo.

  _actualizarValoresTarjeta(el, i) {
    const campos = [
      ["vol", synth.planetVolume[i], v => Math.round(v * 100) + "%"],
      ["fm", synth.fmProfundidadAstro[i], v => v.toFixed(2)],
      ["arp", synth.armonicosPares[i], v => Math.round(v * 100) + "%"],
      ["ari", synth.armonicosImpares[i], v => Math.round(v * 100) + "%"],
      ["hpf", _rackHzASlider(synth.planetHPF[i]), () => Math.round(synth.planetHPF[i]) + "Hz"],
      ["hpfq", synth.planetHPFQ[i], v => v.toFixed(1)],
      ["lpf", _rackHzASlider(synth.planetLPF[i]), () => Math.round(synth.planetLPF[i]) + "Hz"],
      ["lpfq", synth.planetLPFQ[i], v => v.toFixed(1)]
    ];
    for (const [clave, valor, formato] of campos) {
      const input = el.querySelector(`#rack-${clave}-${i}`);
      if (!input) continue;
      if (document.activeElement !== input) input.value = valor;
      const etiqueta = el.querySelector(`#rack-${clave}-${i}-val`);
      if (etiqueta) etiqueta.textContent = formato(valor);
    }

    const oct = el.querySelector(".rack-octava");
    if (oct && document.activeElement !== oct) oct.value = synth.octavaPorPlaneta[i];
    const onda = el.querySelector(".rack-onda");
    if (onda && document.activeElement !== onda) onda.value = synth.formaOnda[i];

    const adsrCont = el.querySelector(".rack-adsr-mini");
    if (adsrCont && adsrCont._refrescarADSR) adsrCont._refrescarADSR();
  },

  _refrescarControles() {
    const vent = document.getElementById("ventana-rack-sintetizadores");
    if (!vent || vent.hidden) return;

    // Si el orden de la secuencia cambió (drag&drop del esquema FM o de
    // las filas del panel lateral), las tarjetas se reconstruyen enteras.
    if (synth.ordenSecuencia.join(",") !== this._ordenCache) {
      this._renderTarjetas();
      return;
    }

    for (const i of synth.ordenSecuencia) {
      const el = vent.querySelector(`.rack-tarjeta[data-astro="${i}"]`);
      if (el) this._actualizarValoresTarjeta(el, i);
    }
  },

  _iniciarCiclo() {
    if (this._raf) return;
    const paso = () => {
      this._refrescarControles();
      this._raf = requestAnimationFrame(paso);
    };
    this._raf = requestAnimationFrame(paso);
  },

  _detenerCiclo() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  },

  // -------------------- Persistencia (solo la ventana) --------------------
  // Los valores de audio (volumen, filtros, ADSR, etc.) ya persisten en
  // synth.js bajo cas-synth-config-v1; aquí solo guardamos posición/abierto.

  _guardarConfig() {
    try {
      const vent = document.getElementById("ventana-rack-sintetizadores");
      localStorage.setItem(RACK_STORAGE_KEY, JSON.stringify({
        abierto: this.abierto,
        x: vent ? vent.offsetLeft : null,
        y: vent ? vent.offsetTop : null
      }));
    } catch (e) {}
  },

  _leerConfig() {
    try {
      const raw = localStorage.getItem(RACK_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
};

// Llamada desde setup() (sketch.js), igual que el resto de la UI.
function inicializarUIRackSintetizadores() {
  const btn = document.getElementById("btn-rack-sintetizadores-toggle");
  if (btn) btn.addEventListener("click", () => rackSintetizadores.toggle());

  // Reabrir automáticamente si el usuario lo dejó abierto la vez anterior.
  const guardado = rackSintetizadores._leerConfig();
  if (guardado && guardado.abierto) rackSintetizadores.abrir();
}
