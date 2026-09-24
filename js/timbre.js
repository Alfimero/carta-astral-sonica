// =========================================================
// timbre.js — "conjuntos" de timbre por astro y motor de voces
// =========================================================
//
// Un CONJUNTO (timbre) reúne, para cada uno de los 10 astros, TODO lo
// que define su sonido: ganancia, octava, forma de onda, armónicos,
// profundidad FM propia, filtros HPF/LPF, pan, desafinación, vibrato y
// ADSR (con curvas). Es el mismo juego de parámetros que el
// Secuenciador 1 guarda repartido en arrays de synth.js, pero empacado
// en un objeto independiente que puede tener cada instrumento del
// piano y el Secuenciador 2: así cada uno suena distinto aunque use los
// mismos astros.
//
//   timbre = { fmProfundidad, astros: [ cfgAstro × 10 ] }
//
// El MOTOR DE VOCES (crearMotorVoces) toca notas con un conjunto:
// crea sus propios nodos por nota (no toca las 10 voces fijas de
// synth.js), así que suena encima del secuenciador sin interferir.
// Las notas se arman como CADENAS de astros: el primero de cada cadena
// es carrier (se oye) y los siguientes lo modulan en FM en cascada.
//   paralelo → [[a], [b], [c]]      (suma aditiva)
//   serie    → [[a, b, c]]          (a suena, b modula a, c modula b)
//
// Al final viven el editor de conjuntos (ventana flotante), el conjunto
// de un astro en línea y el editor ADSR completo que comparten el panel
// del sintetizador, el rack y los conjuntos.
// =========================================================

const TIMBRE_HZ_MIN = 20, TIMBRE_HZ_MAX = 20000;

function timbreAstroDefault() {
  return {
    volumen: 0.5,
    octava: 0,
    onda: "sine",
    armPares: 0.5,
    armImpares: 0.5,
    fmProf: 1,
    hpf: 20, hpfQ: 0.707,
    lpf: 20000, lpfQ: 0.707,
    pan: 0,
    desafinacion: 0,     // cents, -100..100
    vibratoHz: 5,        // 0.1..12
    vibratoCents: 0,     // 0..100 (0 = sin vibrato)
    adsr: { attack: 0.05, decay: 0.20, sustain: 0.70, release: 0.40 },
    curva: { attack: 0, decay: 0, release: 0 }
  };
}

// Copia el timbre ACTUAL del Secuenciador 1 (los arrays de synth.js):
// punto de partida de cualquier conjunto nuevo, para que un instrumento
// recién creado suene igual que los astros que ya conoces.
function timbreDesdeSynth() {
  const astros = [];
  for (let k = 0; k < 10; k++) {
    astros.push({
      volumen: synth.planetVolume[k],
      octava: synth.octavaPorPlaneta[k],
      onda: synth.formaOnda[k],
      armPares: synth.armonicosPares[k],
      armImpares: synth.armonicosImpares[k],
      fmProf: synth.fmProfundidadAstro[k],
      hpf: synth.planetHPF[k], hpfQ: synth.planetHPFQ[k],
      lpf: synth.planetLPF[k], lpfQ: synth.planetLPFQ[k],
      pan: synth.planetPan[k],
      desafinacion: 0,
      vibratoHz: 5,
      vibratoCents: 0,
      adsr: { ...synth._adsrDe(k) },
      curva: { ...synth._curvaDe(k) }
    });
  }
  return { fmProfundidad: synth.fmProfundidad, astros };
}

function clonarTimbre(t) {
  return JSON.parse(JSON.stringify(t));
}

// Normaliza lo que venga de localStorage (o de un export) mezclándolo
// con los defaults: campos nuevos que una config vieja no traiga
// quedan en su valor por defecto.
function sanearTimbre(d, base) {
  const t = base ? clonarTimbre(base) : { fmProfundidad: 2, astros: Array.from({ length: 10 }, timbreAstroDefault) };
  if (!d || typeof d !== "object") return t;
  const num = (v, min, max, def) => (typeof v === "number" && isFinite(v)) ? clamp(v, min, max) : def;

  t.fmProfundidad = num(d.fmProfundidad, 0, 20, t.fmProfundidad);
  if (!Array.isArray(d.astros)) return t;

  for (let k = 0; k < 10; k++) {
    const s = d.astros[k];
    if (!s || typeof s !== "object") continue;
    const a = t.astros[k];
    a.volumen = num(s.volumen, 0, 1, a.volumen);
    a.octava = Math.round(num(s.octava, -4, 4, a.octava));
    if (FORMAS_ONDA.some(f => f.id === s.onda)) a.onda = s.onda;
    a.armPares = num(s.armPares, 0, 1, a.armPares);
    a.armImpares = num(s.armImpares, 0, 1, a.armImpares);
    a.fmProf = num(s.fmProf, 0, 2, a.fmProf);
    a.hpf = num(s.hpf, TIMBRE_HZ_MIN, TIMBRE_HZ_MAX, a.hpf);
    a.hpfQ = num(s.hpfQ, 0.1, 18, a.hpfQ);
    a.lpf = num(s.lpf, TIMBRE_HZ_MIN, TIMBRE_HZ_MAX, a.lpf);
    a.lpfQ = num(s.lpfQ, 0.1, 18, a.lpfQ);
    a.pan = num(s.pan, -1, 1, a.pan);
    a.desafinacion = num(s.desafinacion, -100, 100, a.desafinacion);
    a.vibratoHz = num(s.vibratoHz, 0.1, 12, a.vibratoHz);
    a.vibratoCents = num(s.vibratoCents, 0, 100, a.vibratoCents);
    if (s.adsr && typeof s.adsr === "object") {
      a.adsr.attack  = num(s.adsr.attack,  0.001, 5, a.adsr.attack);
      a.adsr.decay   = num(s.adsr.decay,   0.001, 5, a.adsr.decay);
      a.adsr.sustain = num(s.adsr.sustain, 0,     1, a.adsr.sustain);
      a.adsr.release = num(s.adsr.release, 0.001, 5, a.adsr.release);
    }
    if (s.curva && typeof s.curva === "object") {
      for (const p of ["attack", "decay", "release"]) a.curva[p] = num(s.curva[p], -1, 1, a.curva[p]);
    }
  }
  return t;
}

// Formas de onda personalizadas cacheadas por (pares, impares): crear
// un PeriodicWave por nota es caro, sobre todo en equipos viejos.
const _cacheOndasTimbre = new Map();
function ondaTimbre(pares, impares) {
  const clave = pares.toFixed(3) + "|" + impares.toFixed(3);
  let onda = _cacheOndasTimbre.get(clave);
  if (!onda) {
    onda = synth._ondaDesdeArmonicos(pares, impares);
    if (_cacheOndasTimbre.size > 200) _cacheOndasTimbre.clear();
    _cacheOndasTimbre.set(clave, onda);
  }
  return onda;
}

// =========================================================
// Motor de voces
// =========================================================
//
// opciones:
//   timbre()   → conjunto con el que suenan las notas
//   destino()  → AudioNode al que se conectan los carriers (bus)
//   maxVoces   → límite de notas sostenidas simultáneas
//
// notaOn / notaOff: notas sostenidas (piano), identificadas por clave.
// disparo:          nota de duración fija programada en el futuro
//                   (secuenciador), se libera sola.
// =========================================================

function crearMotorVoces(opciones) {
  return {
    _voces: new Map(),      // clave → voz sostenida
    _disparos: new Set(),   // voces de duración fija aún vivas
    maxVoces: opciones.maxVoces || 12,

    sonando(clave) {
      return this._voces.has(clave);
    },

    claves() {
      return [...this._voces.keys()];
    },

    // cadenas: [[carrier, mod1, mod2...], ...]; freqDe(k) → Hz del astro
    notaOn(clave, cadenas, freqDe, vel, t) {
      if (!synth.ctx) return null;
      if (this._voces.has(clave)) this.notaOff(clave);
      while (this._voces.size >= this.maxVoces) {
        this.notaOff(this._voces.keys().next().value);
      }
      const voz = this._crearVoz(cadenas, freqDe, vel, t);
      if (!voz) return null;
      voz.clave = clave;
      this._voces.set(clave, voz);
      return voz;
    },

    notaOff(clave, t) {
      const voz = this._voces.get(clave);
      if (!voz) return;
      this._voces.delete(clave);
      this._liberarVoz(voz, t);
    },

    disparo(cadenas, freqDe, vel, t, duracion) {
      if (!synth.ctx) return;
      const voz = this._crearVoz(cadenas, freqDe, vel, t);
      if (!voz) return;
      this._disparos.add(voz);
      this._liberarVoz(voz, t + Math.max(0.01, duracion));
    },

    soltarTodo() {
      for (const clave of [...this._voces.keys()]) this.notaOff(clave);
      // Los disparos ya programados (incluso los que aún no empiezan)
      // se cortan ahora con su release.
      for (const voz of [...this._disparos]) this._liberarVoz(voz);
    },

    // Reafina las notas sostenidas (anclaje del piano a un astro que se
    // mueve con la carta). freqDe(voz, k) → nueva frecuencia.
    reafinar(freqDe) {
      if (!synth.ctx || this._voces.size === 0) return;
      const tim = opciones.timbre();
      const now = synth.ctx.currentTime;
      for (const voz of this._voces.values()) {
        for (const op of voz.ops.values()) {
          const f = Math.max(20, freqDe(voz, op.astro));
          op.freq = f;
          for (const param of [op.osc && op.osc.frequency, op.bandpass && op.bandpass.frequency]) {
            if (!param) continue;
            param.cancelScheduledValues(now);
            param.setValueAtTime(Math.max(param.value, 20), now);
            param.exponentialRampToValueAtTime(f, now + 0.06);
          }
        }
        for (const m of voz.mods) {
          const prof = m.destino.freq * tim.fmProfundidad * tim.astros[m.de].fmProf * 2.5;
          m.nodo.gain.setTargetAtTime(prof, now, 0.02);
        }
      }
    },

    // -------------------- Internos --------------------

    _crearOp(k, cfg, freq, t) {
      const ctx = synth.ctx;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;

      // Filtros solo si están en uso: en neutro (20 Hz / 20 kHz) no se
      // crean, cada nodo de menos cuenta cuando hay muchas notas.
      let salida = gain;
      let hpf = null, lpf = null;
      if (cfg.hpf > TIMBRE_HZ_MIN + 0.5) {
        hpf = ctx.createBiquadFilter();
        hpf.type = "highpass";
        hpf.frequency.value = cfg.hpf;
        hpf.Q.value = cfg.hpfQ;
        salida.connect(hpf);
        salida = hpf;
      }
      if (cfg.lpf < TIMBRE_HZ_MAX - 1) {
        lpf = ctx.createBiquadFilter();
        lpf.type = "lowpass";
        lpf.frequency.value = cfg.lpf;
        lpf.Q.value = cfg.lpfQ;
        salida.connect(lpf);
        salida = lpf;
      }

      const op = { astro: k, freq, gain, hpf, lpf, salida, pan: null,
                   osc: null, src: null, bandpass: null, lfo: null, lfoGain: null, puntos: [] };

      let paramDetune;
      if (cfg.onda === "noise") {
        const bandpass = ctx.createBiquadFilter();
        bandpass.type = "bandpass";
        bandpass.frequency.value = freq;
        bandpass.Q.value = 14;
        const src = ctx.createBufferSource();
        src.buffer = synth._crearNoiseBuffer();
        src.loop = true;
        src.connect(bandpass);
        bandpass.connect(gain);
        src.start(t);
        op.src = src;
        op.bandpass = bandpass;
        paramDetune = bandpass.detune;
      } else {
        const osc = ctx.createOscillator();
        if (cfg.onda === "custom") osc.setPeriodicWave(ondaTimbre(cfg.armPares, cfg.armImpares));
        else osc.type = cfg.onda;
        osc.frequency.value = freq;
        osc.connect(gain);
        osc.start(t);
        op.osc = osc;
        paramDetune = osc.detune;
      }

      if (paramDetune) {
        paramDetune.value = cfg.desafinacion || 0;
        if (cfg.vibratoCents > 0) {
          const lfo = ctx.createOscillator();
          lfo.frequency.value = cfg.vibratoHz;
          const lfoGain = ctx.createGain();
          lfoGain.gain.value = cfg.vibratoCents;
          lfo.connect(lfoGain);
          lfoGain.connect(paramDetune);
          lfo.start(t);
          op.lfo = lfo;
          op.lfoGain = lfoGain;
        }
      }
      return op;
    },

    _crearVoz(cadenas, freqDe, vel, t) {
      const ctx = synth.ctx;
      const destino = opciones.destino();
      if (!ctx || !destino) return null;
      const tim = opciones.timbre();
      const cuando = (typeof t === "number") ? Math.max(t, ctx.currentTime) : ctx.currentTime;
      const velocidad = clamp(typeof vel === "number" ? vel : 0.8, 0.02, 1);

      const ops = new Map();
      for (const cad of cadenas) {
        for (const k of cad) {
          if (ops.has(k)) continue;
          ops.set(k, this._crearOp(k, tim.astros[k], Math.max(20, freqDe(k)), cuando));
        }
      }
      if (!ops.size) return null;

      // Carriers al bus (con su pan); moduladores a la frecuencia del
      // anterior de su cadena. El tap de FM lee el `gain` crudo, antes
      // de los filtros, igual que las voces de synth.js.
      const mods = [];
      for (const cad of cadenas) {
        if (!cad.length) continue;
        const carrier = ops.get(cad[0]);
        const pan = ctx.createStereoPanner();
        pan.pan.value = tim.astros[carrier.astro].pan;
        carrier.salida.connect(pan);
        pan.connect(destino);
        carrier.pan = pan;

        for (let i = 1; i < cad.length; i++) {
          const mod = ops.get(cad[i]);
          const dest = ops.get(cad[i - 1]);
          const nodo = ctx.createGain();
          nodo.gain.value = dest.freq * tim.fmProfundidad * tim.astros[mod.astro].fmProf * 2.5;
          mod.gain.connect(nodo);
          if (dest.osc) nodo.connect(dest.osc.frequency);
          if (dest.bandpass) nodo.connect(dest.bandpass.frequency);
          mods.push({ de: mod.astro, destino: dest, nodo });
        }
      }

      // Attack + decay de cada operador con su propio ADSR y curvas
      for (const op of ops.values()) {
        const cfg = tim.astros[op.astro];
        const peak = Math.max(cfg.volumen * velocidad * 0.4, 0.0001);
        const sustain = Math.max(peak * cfg.adsr.sustain, 0.0001);
        const g = op.gain.gain;
        g.setValueAtTime(0.0001, cuando);
        op.puntos = [{ t: cuando, v: 0.0001 }];
        synth._programarSegmento(g, op.puntos, 0.0001, peak, cuando, cfg.adsr.attack, cfg.curva.attack);
        synth._programarSegmento(g, op.puntos, peak, sustain, cuando + cfg.adsr.attack, cfg.adsr.decay, cfg.curva.decay);
      }

      return { ops, mods, inicio: cuando, liberada: false };
    },

    // Valor del envelope programado de un operador en el instante t
    // (las curvas ya están muestreadas en rampas lineales).
    _valorEn(op, t) {
      const pts = op.puntos;
      if (!pts.length) return 0.0001;
      if (t <= pts[0].t) return pts[0].v;
      for (let i = 0; i < pts.length - 1; i++) {
        if (t <= pts[i + 1].t) {
          const a = pts[i], b = pts[i + 1];
          if (b.t - a.t < 1e-6) return b.v;
          return a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t);
        }
      }
      return pts[pts.length - 1].v;
    },

    _liberarVoz(voz, t) {
      const ctx = synth.ctx;
      if (!ctx) return;
      const now = ctx.currentTime;
      // Un disparo ya liberado a futuro puede volver a liberarse antes
      // (Stop): se reprograma desde ahora.
      const cuando = (typeof t === "number") ? Math.max(t, now) : now;
      const inmediato = cuando <= now + 0.005;
      const tim = opciones.timbre();
      let releaseMax = 0.05;

      for (const op of voz.ops.values()) {
        const cfg = tim.astros[op.astro];
        const g = op.gain.gain;
        const ancla = Math.max(inmediato ? g.value : this._valorEn(op, cuando), 0.0001);
        if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(cuando);
        else g.cancelScheduledValues(cuando);
        g.setValueAtTime(ancla, cuando);
        op.puntos = [{ t: cuando, v: ancla }];
        synth._programarSegmento(g, op.puntos, ancla, 0.0001, cuando, cfg.adsr.release, cfg.curva.release);
        releaseMax = Math.max(releaseMax, cfg.adsr.release);
      }

      const fin = cuando + releaseMax + 0.05;
      for (const op of voz.ops.values()) {
        for (const fuente of [op.osc, op.src, op.lfo]) {
          try { if (fuente) fuente.stop(fin); } catch (e) {}
        }
      }

      if (voz._timer) clearTimeout(voz._timer);
      voz._timer = setTimeout(() => {
        for (const op of voz.ops.values()) {
          for (const nodo of [op.osc, op.src, op.lfo, op.lfoGain, op.bandpass, op.gain, op.hpf, op.lpf, op.pan]) {
            try { if (nodo) nodo.disconnect(); } catch (e) {}
          }
        }
        for (const m of voz.mods) {
          try { m.nodo.disconnect(); } catch (e) {}
        }
        this._disparos.delete(voz);
      }, (fin - now + 0.2) * 1000);
    }
  };
}

// =========================================================
// Editor de conjuntos (ventana flotante "Timbre")
// =========================================================
//
// Edita el conjunto de un DESTINO: cada instrumento del piano y el
// Secuenciador 2. Un selector cambia de destino sin cerrar la ventana.
// Cada destino se describe con:
//   { id, nombre, timbre() → conjunto, astros() → [k...] (los que usa),
//     guardar() }
// Los cambios se guardan al instante y aplican a las NOTAS NUEVAS (las
// que ya suenan conservan el timbre con el que empezaron).
// =========================================================

const EDITOR_TIMBRE_STORAGE_KEY = "cas-editor-timbre-v1";

function _timbreEscaparHTML(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function _timbreSliderAHz(t) {
  return TIMBRE_HZ_MIN * Math.pow(TIMBRE_HZ_MAX / TIMBRE_HZ_MIN, clamp(t, 0, 1));
}
function _timbreHzASlider(hz) {
  return Math.log(clamp(hz, TIMBRE_HZ_MIN, TIMBRE_HZ_MAX) / TIMBRE_HZ_MIN) / Math.log(TIMBRE_HZ_MAX / TIMBRE_HZ_MIN);
}

// Controles numéricos de cada tarjeta: clave del cfg, etiqueta, rango
// del slider y conversión slider ⇄ valor real.
const TIMBRE_CONTROLES = [
  { clave: "volumen", etiqueta: "Ganancia", min: 0, max: 1, paso: 0.01, fmt: v => Math.round(v * 100) + "%" },
  { clave: "armPares", etiqueta: "Armón. pares", min: 0, max: 1, paso: 0.01, fmt: v => Math.round(v * 100) + "%", armonico: true },
  { clave: "armImpares", etiqueta: "Armón. impares", min: 0, max: 1, paso: 0.01, fmt: v => Math.round(v * 100) + "%", armonico: true },
  { clave: "fmProf", etiqueta: "Prof. FM", min: 0, max: 2, paso: 0.01, fmt: v => v.toFixed(2),
    titulo: "Cuánto modula este astro cuando actúa como modulador (ruteo en serie / cadenas FM)" },
  { clave: "hpf", etiqueta: "HPF corte", min: 0, max: 1, paso: 0.001, log: true, fmt: v => Math.round(v) + "Hz" },
  { clave: "hpfQ", etiqueta: "HPF Q", min: 0.1, max: 18, paso: 0.1, fmt: v => v.toFixed(1) },
  { clave: "lpf", etiqueta: "LPF corte", min: 0, max: 1, paso: 0.001, log: true, fmt: v => Math.round(v) + "Hz" },
  { clave: "lpfQ", etiqueta: "LPF Q", min: 0.1, max: 18, paso: 0.1, fmt: v => v.toFixed(1) },
  { clave: "pan", etiqueta: "Pan", min: -1, max: 1, paso: 0.01,
    fmt: v => Math.abs(v) < 0.01 ? "C" : (v < 0 ? "I" : "D") + Math.round(Math.abs(v) * 100) },
  { clave: "desafinacion", etiqueta: "Desafinar", min: -100, max: 100, paso: 1, fmt: v => (v > 0 ? "+" : "") + Math.round(v) + "¢" },
  { clave: "vibratoCents", etiqueta: "Vibrato prof.", min: 0, max: 100, paso: 1, fmt: v => Math.round(v) + "¢" },
  { clave: "vibratoHz", etiqueta: "Vibrato vel.", min: 0.1, max: 12, paso: 0.1, fmt: v => v.toFixed(1) + "Hz" }
];

const editorTimbre = {
  abierto: false,
  destinoId: null,
  soloDelConjunto: true,   // mostrar solo los astros que usa el destino
  _raf: null,
  _cacheEstructura: "",

  // Todos los destinos editables (se piden en vivo: los instrumentos
  // del piano pueden crearse y borrarse).
  destinos() {
    const lista = [];
    if (typeof piano !== "undefined") {
      for (const inst of piano.instrumentos) {
        lista.push({
          id: inst.id,
          nombre: "🎹 " + inst.nombre,
          timbre: () => inst.timbre,
          astros: () => inst.astrosSel.map((on, k) => on ? k : -1).filter(k => k >= 0),
          guardar: () => piano._guardarConfig()
        });
      }
    }
    if (typeof secuenciador2 !== "undefined") {
      lista.push({
        id: "sec2",
        nombre: "🥁 Secuenciador 2",
        timbre: () => secuenciador2.timbre,
        astros: () => secuenciador2.astrosSel.map((on, k) => on ? k : -1).filter(k => k >= 0),
        guardar: () => secuenciador2._guardarConfig()
      });
    }
    return lista;
  },

  destino() {
    const lista = this.destinos();
    return lista.find(d => d.id === this.destinoId) || lista[0] || null;
  },

  abrirPara(id) {
    this.destinoId = id;
    this.abrir();
  },

  toggle() {
    if (this.abierto) this.cerrar();
    else this.abrir();
  },

  abrir() {
    const vent = this._construirVentana();
    vent.hidden = false;
    this.abierto = true;
    this.render();
    this._iniciarCiclo();
    this._guardarPos();
  },

  cerrar() {
    const vent = document.getElementById("ventana-timbre");
    if (vent) vent.hidden = true;
    this.abierto = false;
    this._detenerCiclo();
    this._guardarPos();
  },

  _construirVentana() {
    let vent = document.getElementById("ventana-timbre");
    if (vent) return vent;

    vent = document.createElement("div");
    vent.id = "ventana-timbre";
    vent.className = "ventana-flotante rack-ventana";
    vent.hidden = true;

    const guardado = this._leerPos();
    const px = clamp((guardado && typeof guardado.x === "number") ? guardado.x : 80, 0, Math.max(0, window.innerWidth - 160));
    const py = clamp((guardado && typeof guardado.y === "number") ? guardado.y : 110, 0, Math.max(0, window.innerHeight - 120));
    vent.style.left = px + "px";
    vent.style.top = py + "px";

    vent.innerHTML = `
      <div class="ventana-titulo timbre-titulo">
        <span>🎛 Conjuntos de timbre</span>
        <button type="button" class="timbre-cerrar" title="Cerrar">✕</button>
      </div>
      <div class="timbre-barra">
        <label>Editar
          <select class="timbre-destino"></select>
        </label>
        <label class="timbre-fm-global" title="Profundidad FM de todo el conjunto (cada astro la escala con su Prof. FM)">FM
          <input type="range" class="timbre-fm" min="0" max="20" step="0.1">
          <span class="timbre-fm-val"></span>
        </label>
        <label title="Mostrar solo los astros que usa este instrumento">
          <input type="checkbox" class="timbre-solo-conjunto"> Solo los del conjunto
        </label>
        <button type="button" class="timbre-copiar-sec1" title="Reemplazar este conjunto por el timbre actual del Secuenciador 1">⟲ Copiar del Secuenciador 1</button>
      </div>
      <p class="rack-hint">Cada astro es un conjunto: ganancia, octava, onda, armónicos, FM, filtros, pan, desafinación, vibrato y ADSR propios de este instrumento. Los cambios aplican a las notas nuevas.</p>
      <div class="rack-canales timbre-canales"></div>
    `;
    document.body.appendChild(vent);

    vent.querySelector(".timbre-cerrar").addEventListener("click", () => this.cerrar());
    vent.querySelector(".timbre-destino").addEventListener("change", e => {
      this.destinoId = e.target.value;
      this.render();
    });
    const chkSolo = vent.querySelector(".timbre-solo-conjunto");
    chkSolo.checked = this.soloDelConjunto;
    chkSolo.addEventListener("change", e => {
      this.soloDelConjunto = e.target.checked;
      this.render();
    });
    vent.querySelector(".timbre-fm").addEventListener("input", e => {
      const d = this.destino();
      if (!d) return;
      d.timbre().fmProfundidad = clamp(parseFloat(e.target.value), 0, 20);
      d.guardar();
    });
    vent.querySelector(".timbre-copiar-sec1").addEventListener("click", () => {
      const d = this.destino();
      if (!d) return;
      if (!confirm(`¿Reemplazar el conjunto de "${d.nombre}" por el timbre actual del Secuenciador 1?`)) return;
      const nuevo = timbreDesdeSynth();
      const t = d.timbre();
      t.fmProfundidad = nuevo.fmProfundidad;
      t.astros = nuevo.astros;
      d.guardar();
      this.render();
    });

    const barra = vent.querySelector(".timbre-titulo");
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
        this._guardarPos();
      };
      window.addEventListener("pointermove", mover);
      window.addEventListener("pointerup", soltar);
    });

    return vent;
  },

  _astrosVisibles(d) {
    const orden = (typeof synth !== "undefined") ? synth.ordenSecuencia : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    if (!this.soloDelConjunto) return orden.slice();
    const usados = new Set(d.astros());
    return orden.filter(k => usados.has(k));
  },

  _claveEstructura(d) {
    const lista = this.destinos().map(x => x.id + ":" + x.nombre).join(",");
    return [lista, d ? d.id : "", d ? this._astrosVisibles(d).join("") : "", this.soloDelConjunto].join("|");
  },

  render() {
    const vent = document.getElementById("ventana-timbre");
    if (!vent) return;
    const d = this.destino();
    if (d) this.destinoId = d.id;
    this._cacheEstructura = this._claveEstructura(d);

    const sel = vent.querySelector(".timbre-destino");
    sel.innerHTML = this.destinos().map(x =>
      `<option value="${_timbreEscaparHTML(x.id)}"${d && x.id === d.id ? " selected" : ""}>${_timbreEscaparHTML(x.nombre)}</option>`
    ).join("");

    const cont = vent.querySelector(".timbre-canales");
    cont.innerHTML = "";
    if (!d) {
      cont.innerHTML = `<p class="rack-hint">No hay instrumentos para editar.</p>`;
      return;
    }
    const astros = this._astrosVisibles(d);
    if (!astros.length) {
      cont.innerHTML = `<p class="rack-hint">Este instrumento no tiene astros elegidos. Márcalos en su sección o desmarca "Solo los del conjunto".</p>`;
    }
    for (const k of astros) cont.appendChild(this._construirTarjeta(d, k));
    this._refrescar();
  },

  _construirTarjeta(d, k) {
    const el = document.createElement("div");
    el.className = "rack-tarjeta";
    el.dataset.astro = k;
    const cfg = () => d.timbre().astros[k];
    const color = (THEME.astros && THEME.astros.coloresPorAstro && THEME.astros.coloresPorAstro[k]) || COLORES_ASTROS_DEFAULT[k];

    const opcionesOctava = [];
    for (let o = -4; o <= 4; o++) {
      opcionesOctava.push(`<option value="${o}">${o > 0 ? "+" + o : o}</option>`);
    }
    const opcionesOnda = FORMAS_ONDA.map(f => `<option value="${f.id}">${f.nombre}</option>`).join("");

    el.innerHTML = `
      <div class="rack-nombre" style="color:${color}">${SIMBOLOS_ASTROS[k]} ${_timbreEscaparHTML(NOMBRES_ASTROS[k])}</div>
      <div class="rack-fila">
        <label>Octava</label>
        <select data-clave="octava">${opcionesOctava.join("")}</select>
        <span class="rack-valor"></span>
      </div>
      <div class="rack-fila">
        <label>Onda</label>
        <select data-clave="onda">${opcionesOnda}</select>
        <span class="rack-valor"></span>
      </div>
      <div class="timbre-adsr"></div>
      ${TIMBRE_CONTROLES.map(c => `
        <div class="rack-fila">
          <label title="${_timbreEscaparHTML(c.titulo || c.etiqueta)}">${c.etiqueta}</label>
          <input type="range" data-clave="${c.clave}" min="${c.min}" max="${c.max}" step="${c.paso}">
          <span class="rack-valor" data-val="${c.clave}"></span>
        </div>`).join("")}
    `;

    el.querySelector('select[data-clave="octava"]').addEventListener("change", e => {
      cfg().octava = clamp(parseInt(e.target.value, 10), -4, 4);
      d.guardar();
      if (typeof actualizarMarcadoresPiano === "function") actualizarMarcadoresPiano();
    });
    el.querySelector('select[data-clave="onda"]').addEventListener("change", e => {
      if (FORMAS_ONDA.some(f => f.id === e.target.value)) cfg().onda = e.target.value;
      d.guardar();
    });

    for (const c of TIMBRE_CONTROLES) {
      el.querySelector(`input[data-clave="${c.clave}"]`).addEventListener("input", e => {
        let v = parseFloat(e.target.value);
        if (c.log) v = _timbreSliderAHz(v);
        cfg()[c.clave] = clamp(v, c.log ? TIMBRE_HZ_MIN : c.min, c.log ? TIMBRE_HZ_MAX : c.max);
        // Igual que el rack: mover los armónicos pasa la onda a "custom"
        // para que el cambio se escuche.
        if (c.armonico && cfg().onda !== "custom") {
          cfg().onda = "custom";
          el.querySelector('select[data-clave="onda"]').value = "custom";
        }
        d.guardar();
        this._actualizarTarjeta(el, cfg());
      });
    }

    // El mismo editor ADSR del Secuenciador 1: vértices + rombos de curva
    crearEditorADSR(el.querySelector(".timbre-adsr"), {
      adsr: () => cfg().adsr,
      curva: () => cfg().curva,
      set: (param, v) => {
        cfg().adsr[param] = (param === "sustain") ? clamp(v, 0, 1) : clamp(v, 0.001, 5);
        d.guardar();
      },
      setCurva: (param, v) => {
        cfg().curva[param] = clamp(v, -1, 1);
        d.guardar();
      }
    });

    this._actualizarTarjeta(el, cfg());
    return el;
  },

  _actualizarTarjeta(el, cfg) {
    for (const c of TIMBRE_CONTROLES) {
      const input = el.querySelector(`input[data-clave="${c.clave}"]`);
      const valor = cfg[c.clave];
      if (input && document.activeElement !== input) input.value = c.log ? _timbreHzASlider(valor) : valor;
      const et = el.querySelector(`[data-val="${c.clave}"]`);
      if (et) et.textContent = c.fmt(valor);
    }
    const oct = el.querySelector('select[data-clave="octava"]');
    if (oct && document.activeElement !== oct) oct.value = cfg.octava;
    const onda = el.querySelector('select[data-clave="onda"]');
    if (onda && document.activeElement !== onda) onda.value = cfg.onda;
    const adsr = el.querySelector(".timbre-adsr");
    if (adsr && adsr._refrescarADSR) adsr._refrescarADSR();
  },

  // Refresco periódico: los instrumentos pueden renombrarse, borrarse o
  // cambiar de astros desde el panel mientras la ventana está abierta.
  _refrescar() {
    const vent = document.getElementById("ventana-timbre");
    if (!vent || vent.hidden) return;
    const d = this.destino();
    if (this._claveEstructura(d) !== this._cacheEstructura) {
      this.render();
      return;
    }
    if (!d) return;
    const fm = vent.querySelector(".timbre-fm");
    if (fm && document.activeElement !== fm) fm.value = d.timbre().fmProfundidad;
    const fmVal = vent.querySelector(".timbre-fm-val");
    if (fmVal) fmVal.textContent = d.timbre().fmProfundidad.toFixed(1);
    vent.querySelectorAll(".timbre-canales .rack-tarjeta").forEach(el => {
      this._actualizarTarjeta(el, d.timbre().astros[parseInt(el.dataset.astro, 10)]);
    });
  },

  _iniciarCiclo() {
    if (this._raf) return;
    let ultimo = 0;
    const paso = (t) => {
      // 6-7 veces por segundo basta para reflejar cambios externos
      if (t - ultimo > 150) {
        ultimo = t;
        this._refrescar();
      }
      this._raf = requestAnimationFrame(paso);
    };
    this._raf = requestAnimationFrame(paso);
  },

  _detenerCiclo() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  },

  _guardarPos() {
    try {
      const vent = document.getElementById("ventana-timbre");
      localStorage.setItem(EDITOR_TIMBRE_STORAGE_KEY, JSON.stringify({
        x: vent ? vent.offsetLeft : null,
        y: vent ? vent.offsetTop : null,
        soloDelConjunto: this.soloDelConjunto
      }));
    } catch (e) {}
  },

  _leerPos() {
    try {
      const raw = localStorage.getItem(EDITOR_TIMBRE_STORAGE_KEY);
      const d = raw ? JSON.parse(raw) : null;
      if (d && typeof d.soloDelConjunto === "boolean") this.soloDelConjunto = d.soloDelConjunto;
      return d;
    } catch (e) {
      return null;
    }
  }
};

// =========================================================
// Conjunto de UN astro, en línea dentro del panel
// =========================================================
//
// Al tocar un astro en el piano (o en el Secuenciador 2) su conjunto se
// muestra ahí mismo, sin abrir la ventana: es la misma tarjeta del
// editor de conjuntos, a lo ancho. `cont` debe tener la clase
// .conjunto-astro para que el refresco periódico la mantenga al día
// cuando el mismo valor se edita desde la ventana flotante.
// =========================================================

function renderConjuntoAstro(cont, destinoId, k) {
  if (!cont) return;
  cont.innerHTML = "";
  cont._refrescar = null;
  const d = editorTimbre.destinos().find(x => x.id === destinoId);
  if (!d || typeof k !== "number" || k < 0 || k > 9) {
    cont.innerHTML = `<p class="seq-hint">Toca el símbolo de un astro para ver y editar su conjunto (sintetizador propio de este instrumento).</p>`;
    return;
  }

  const barra = document.createElement("div");
  barra.className = "conjunto-astro-barra";
  barra.innerHTML = `
    <span>Conjunto de <b>${SIMBOLOS_ASTROS[k]} ${_timbreEscaparHTML(NOMBRES_ASTROS[k])}</b> en ${_timbreEscaparHTML(d.nombre)}</span>
    <button type="button" class="conjunto-copiar" title="Reemplazar el conjunto de este astro por el que tiene en el Secuenciador 1 (rack de sintetizadores)">⟲ Del Sec. 1</button>
    <button type="button" class="conjunto-ventana" title="Abrir todos los astros de este instrumento en la ventana de conjuntos">⧉ Todos</button>
  `;
  cont.appendChild(barra);

  const tarjeta = editorTimbre._construirTarjeta(d, k);
  tarjeta.classList.add("conjunto-inline");
  cont.appendChild(tarjeta);

  barra.querySelector(".conjunto-copiar").addEventListener("click", () => {
    d.timbre().astros[k] = timbreDesdeSynth().astros[k];
    d.guardar();
    renderConjuntoAstro(cont, destinoId, k);
    if (typeof actualizarMarcadoresPiano === "function") actualizarMarcadoresPiano();
  });
  barra.querySelector(".conjunto-ventana").addEventListener("click", () => editorTimbre.abrirPara(destinoId));

  cont._refrescar = () => editorTimbre._actualizarTarjeta(tarjeta, d.timbre().astros[k]);
}

// Refresco ligero de los conjuntos visibles en el panel
setInterval(() => {
  document.querySelectorAll(".conjunto-astro").forEach(c => {
    if (c._refrescar && c.offsetParent) c._refrescar();
  });
}, 300);

// =========================================================
// Editor ADSR completo (el del Secuenciador 1)
// =========================================================
//
// Vértices A, D/S y R arrastrables + un rombo en el centro de cada tramo
// que lo curva (c ∈ [-1, 1], f(u) = u^(2^(2c)); c = 0 lineal) + la línea
// de valores. Es el editor del panel del sintetizador, extraído aquí
// para que los conjuntos de los instrumentos y del Secuenciador 2 tengan
// exactamente el mismo.
//   acceso = { adsr() → {attack,decay,sustain,release},
//              curva() → {attack,decay,release},
//              set(param, valor), setCurva(param, valor) }
// Devuelve { render }; deja en cont._refrescarADSR() un redibujo que
// solo actúa si los valores cambiaron desde fuera.
// =========================================================

function crearEditorADSR(cont, acceso) {
  if (!cont) return null;

  const fCurva = (u, c) => Math.pow(u, Math.pow(2, c * 2));

  // Geometría del gráfico (coordenadas del viewBox)
  const W = 380, H = 120, PAD = 12;
  const ZA = 90, ZD = 90, ZS = 50, ZR = 110;   // zonas A, D, plateau S, R
  const MAX_A = 3, MAX_D = 3, MAX_R = 5;
  const yTop = PAD, yBase = H - PAD;

  // Escala sqrt: da resolución a los tiempos cortos
  const xA = a => PAD + Math.sqrt(a / MAX_A) * ZA;
  const xD = (a, d) => xA(a) + Math.sqrt(d / MAX_D) * ZD;
  const xS = (a, d) => xD(a, d) + ZS;
  const xR = (a, d, r) => xS(a, d) + Math.sqrt(r / MAX_R) * ZR;
  const yS = s => yTop + (1 - s) * (yBase - yTop);

  const fmt = adsr =>
    `A ${adsr.attack.toFixed(2)}s · D ${adsr.decay.toFixed(2)}s · ` +
    `S ${Math.round(adsr.sustain * 100)}% · R ${adsr.release.toFixed(2)}s`;

  const tramoCurvo = (xDe, yDe, xHasta, yHasta, c) => {
    let s = "";
    for (let k = 1; k <= 14; k++) {
      const u = k / 14;
      const x = xDe + (xHasta - xDe) * u;
      const y = yDe + (yHasta - yDe) * fCurva(u, c);
      s += ` L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
    return s;
  };

  const clavePara = () => {
    const e = acceso.adsr(), c = acceso.curva();
    return [e.attack, e.decay, e.sustain, e.release, c.attack, c.decay, c.release].join(",");
  };
  let clave = "";

  function render() {
    const e = acceso.adsr();
    const c = acceso.curva();
    clave = clavePara();
    const x1 = xA(e.attack), x2 = xD(e.attack, e.decay);
    const x3 = xS(e.attack, e.decay), x4 = xR(e.attack, e.decay, e.release);
    const ys = yS(e.sustain);

    let d = `M ${PAD} ${yBase}`;
    d += tramoCurvo(PAD, yBase, x1, yTop, c.attack);
    d += tramoCurvo(x1, yTop, x2, ys, c.decay);
    d += ` L ${x3} ${ys}`;
    d += tramoCurvo(x3, ys, x4, yBase, c.release);

    // Handles de curvatura en el centro de cada tramo (sobre la curva)
    const ymA = yBase + (yTop - yBase) * fCurva(0.5, c.attack);
    const ymD = yTop + (ys - yTop) * fCurva(0.5, c.decay);
    const ymR = ys + (yBase - ys) * fCurva(0.5, c.release);

    cont.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="adsr-svg">
        <line x1="${PAD}" y1="${yBase}" x2="${W - PAD}" y2="${yBase}" stroke="#ccc" stroke-width="1"/>
        <path d="${d} Z" fill="rgba(60,94,158,0.14)" stroke="none"/>
        <path d="${d}" fill="none" stroke="#3c5e9e" stroke-width="2"/>
        <line x1="${x2}" y1="${ys}" x2="${x3}" y2="${ys}" stroke="#3c5e9e" stroke-width="2" stroke-dasharray="3 2"/>
        <rect class="adsr-curva-handle" data-c="attack" x="${((PAD + x1) / 2 - 4.5).toFixed(1)}" y="${(ymA - 4.5).toFixed(1)}" width="9" height="9" transform="rotate(45 ${((PAD + x1) / 2).toFixed(1)} ${ymA.toFixed(1)})"/>
        <rect class="adsr-curva-handle" data-c="decay" x="${((x1 + x2) / 2 - 4.5).toFixed(1)}" y="${(ymD - 4.5).toFixed(1)}" width="9" height="9" transform="rotate(45 ${((x1 + x2) / 2).toFixed(1)} ${ymD.toFixed(1)})"/>
        <rect class="adsr-curva-handle" data-c="release" x="${((x3 + x4) / 2 - 4.5).toFixed(1)}" y="${(ymR - 4.5).toFixed(1)}" width="9" height="9" transform="rotate(45 ${((x3 + x4) / 2).toFixed(1)} ${ymR.toFixed(1)})"/>
        <circle class="adsr-handle" data-h="a" cx="${x1}" cy="${yTop}" r="7"/>
        <circle class="adsr-handle" data-h="ds" cx="${x2}" cy="${ys}" r="7"/>
        <circle class="adsr-handle" data-h="r" cx="${x4}" cy="${yBase}" r="7"/>
        <text x="${x1}" y="${yTop - 3}" text-anchor="middle" class="adsr-etiqueta">A</text>
        <text x="${x2}" y="${ys - 10}" text-anchor="middle" class="adsr-etiqueta">D/S</text>
        <text x="${x4}" y="${yBase - 10}" text-anchor="middle" class="adsr-etiqueta">R</text>
      </svg>
      <p class="adsr-valores">${fmt(e)}</p>
    `;
    conectarHandles();
  }

  function conectarHandles() {
    const svg = cont.querySelector("svg");
    if (!svg) return;

    // render() reconstruye el SVG durante el arrastre: usar siempre el vivo
    const aViewBox = ev => {
      const svgVivo = cont.querySelector("svg") || svg;
      const rect = svgVivo.getBoundingClientRect();
      return {
        x: (ev.clientX - rect.left) * (W / rect.width),
        y: (ev.clientY - rect.top) * (H / rect.height)
      };
    };

    const arrastrar = (ev, mover) => {
      ev.preventDefault();
      ev.stopPropagation();
      const soltar = () => {
        window.removeEventListener("pointermove", mover);
        window.removeEventListener("pointerup", soltar);
      };
      window.addEventListener("pointermove", mover);
      window.addEventListener("pointerup", soltar);
    };

    svg.querySelectorAll(".adsr-handle").forEach(handle => {
      handle.addEventListener("pointerdown", ev => {
        const tipo = handle.dataset.h;
        arrastrar(ev, e2 => {
          const p = aViewBox(e2);
          const adsr = acceso.adsr();
          if (tipo === "a") {
            const t = clamp((p.x - PAD) / ZA, 0, 1);
            acceso.set("attack", Math.max(0.001, t * t * MAX_A));
          } else if (tipo === "ds") {
            const t = clamp((p.x - xA(adsr.attack)) / ZD, 0, 1);
            acceso.set("decay", Math.max(0.001, t * t * MAX_D));
            acceso.set("sustain", clamp(1 - (p.y - yTop) / (yBase - yTop), 0, 1));
          } else if (tipo === "r") {
            const t = clamp((p.x - xS(adsr.attack, adsr.decay)) / ZR, 0, 1);
            acceso.set("release", Math.max(0.001, t * t * MAX_R));
          }
          render();
        });
      });
    });

    // Rombos: arrastrar verticalmente desde el centro del tramo lo curva
    // como un arco (c = 0 vuelve a lineal)
    svg.querySelectorAll(".adsr-curva-handle").forEach(handle => {
      handle.addEventListener("pointerdown", ev => {
        const param = handle.dataset.c;
        arrastrar(ev, e2 => {
          const p = aViewBox(e2);
          const adsr = acceso.adsr();
          const ys = yS(adsr.sustain);
          let yDe, yHasta;
          if (param === "attack")     { yDe = yBase; yHasta = yTop; }
          else if (param === "decay") { yDe = yTop;  yHasta = ys; }
          else                        { yDe = ys;    yHasta = yBase; }
          if (Math.abs(yHasta - yDe) < 3) return;  // tramo plano: nada que curvar
          // Curvatura cuya f(0.5) hace pasar el tramo por el puntero
          const f = clamp((p.y - yDe) / (yHasta - yDe), 0.04, 0.96);
          const gamma = Math.log(f) / Math.log(0.5);
          acceso.setCurva(param, clamp(Math.log2(gamma) / 2, -1, 1));
          render();
        });
      });
    });
  }

  cont._refrescarADSR = () => {
    if (clavePara() !== clave) render();
  };

  render();
  return { render };
}
