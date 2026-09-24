// =========================================================
// midi.js — entrada MIDI (Web MIDI API)
// =========================================================
//
// Política:
//   - Web MIDI requiere HTTPS o localhost para que el browser
//     permita el acceso. En localhost funciona sin pedir permisos
//     adicionales en Chrome; en Firefox puede pedir confirmación.
//   - requestMIDIAccess() se llama al abrir el programa si el arranque
//     automático lo tiene activado (arranque.js), o desde el botón.
//
// Mensajes que escuchamos:
//   Note On  (0x90, nota, vel>0)  → dispara banco con esa nota
//   Note Off (0x80, nota, _)      → release de envelope (planetas activos)
//   Note On con vel=0             → equivale a note off
//   CC       (0xB0, num, val)     → mapeos de parámetros (midi-map.js)
//
// Orden de prioridad de una nota entrante:
//   captura → bancos → mapeos de parámetros → piano → astros → envelope
//
// Cada mensaje llega con el id del controlador que lo mandó: el piano
// lo usa para repartir las notas entre sus instrumentos (cada
// instrumento puede escuchar un controlador distinto).
//
// Modo "captura": cuando el usuario quiere asignar una nota MIDI
// a un banco, ponemos capturaPendiente al ID del banco y la
// próxima noteOn que llegue se asigna ahí.
// =========================================================

const MIDI = {
  access: null,
  inputs: [],
  enabled: false,

  // ID de banco esperando captura de nota MIDI
  capturaPendiente: null,

  // Callback opcional para que la UI se entere
  onChange: null,

  async enable() {
    if (!navigator.requestMIDIAccess) {
      console.warn("[midi] Web MIDI API no disponible en este navegador");
      return false;
    }
    try {
      this.access = await navigator.requestMIDIAccess();
      this.enabled = true;
      this.refreshInputs();
      this.access.onstatechange = () => this.refreshInputs();
      this._notifyChange();
      return true;
    } catch (e) {
      console.error("[midi] acceso denegado:", e);
      return false;
    }
  },

  disable() {
    if (this.access) {
      this.access.inputs.forEach(input => { input.onmidimessage = null; });
    }
    this.enabled = false;
    this.inputs = [];
    this._notifyChange();
  },

  refreshInputs() {
    if (!this.access) return;
    this.inputs = [];
    this.access.inputs.forEach(input => {
      input.onmidimessage = (msg) => this._onMessage(msg, input.id);
      this.inputs.push({ id: input.id, name: input.name, manufacturer: input.manufacturer });
    });
    if (typeof piano !== "undefined") piano.resolverEntradas(this.inputs);
    this._notifyChange();
  },

  iniciarCapturaParaBanco(bankId) {
    // Las capturas son excluyentes: solo una espera nota a la vez
    if (typeof mapeoMIDI !== "undefined") mapeoMIDI.cancelarCaptura();
    this.capturaPendiente = bankId;
    this._notifyChange();
  },

  cancelarCaptura() {
    this.capturaPendiente = null;
    this._notifyChange();
  },

  _notifyChange() {
    if (typeof this.onChange === "function") this.onChange();
  },

  _onMessage(msg, entradaId) {
    // Si el audio sigue suspendido (el navegador espera un gesto), lo
    // intentamos reanudar: en Chrome con --autoplay-policy funciona.
    if (typeof synth !== "undefined" && synth.ctx && synth.ctx.state === "suspended") {
      synth.ctx.resume().catch(() => {});
    }
    const data = msg.data;
    if (!data || data.length < 2) return;
    const status = data[0];
    const d1 = data[1];
    const d2 = data.length > 2 ? data[2] : 0;
    const type = status & 0xF0;
    const canal = (status & 0x0F) + 1;   // 1-16, como lo numeran los aparatos

    if (type === 0x90 && d2 > 0) {
      // Note On
      this._onNoteOn(d1, d2, canal, entradaId);
    } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
      // Note Off
      this._onNoteOff(d1, canal, entradaId);
    } else if (type === 0xB0) {
      this._onCC(d1, d2, canal);
    }
  },

  // Mapeo de astros a partir de Do4 (C4 = nota MIDI 60).
  // Sigue el ORDEN del secuenciador: por default 60=Sol ... 69=Plutón,
  // pero al reordenar los astros (drag&drop o ↑↓) el mapeo cambia con
  // ellos: C4 siempre dispara al primer astro de la lista, C#4 al
  // segundo, etc.
  NOTA_BASE_ASTROS: 60,

  astroDeNotaMIDI(nota) {
    const idx = nota - this.NOTA_BASE_ASTROS;
    if (idx < 0 || idx >= 10) return -1;
    const astro = synth.ordenSecuencia[idx];
    return (typeof astro === "number") ? astro : -1;
  },

  _onNoteOn(nota, velocidad, canal, entradaId) {
    // 1) Si hay captura pendiente, asignar la nota
    if (this.capturaPendiente) {
      const id = this.capturaPendiente;
      this.capturaPendiente = null;
      banks.actualizar(id, { midiNote: nota });
      if (typeof renderListaBancos === "function") renderListaBancos();
      this._notifyChange();
      return;
    }

    // 2) Disparar banco si hay match (la asignación explícita tiene prioridad)
    if (banks.dispararPorNotaMIDI(nota)) return;

    // 3) Mapeos de parámetros (nota raíz, orden por intervalo, ritmos).
    //    Van ANTES del piano: el piano escucha en omni y se quedaría
    //    con todo el teclado.
    if (typeof mapeoMIDI !== "undefined" && mapeoMIDI.manejarNoteOn(nota, canal)) return;

    // 4) Modo piano: el controlador toca la escala microtonal completa
    //    (una tecla = un microtono) con el instrumento que lo escucha,
    //    independiente del secuenciador
    if (typeof piano !== "undefined" && piano.midiNoteOn(nota, velocidad, entradaId, canal)) return;

    // 5) Mapeo de astros C4-A4: tocar ese astro junto con su grupo FM
    //    (los conectados deben sonar a la vez para que la FM funcione)
    if (synth.midiAstros) {
      const astro = this.astroDeNotaMIDI(nota);
      if (astro !== -1) {
        synth.triggerAttackGrupo(astro);
        if (typeof actualizarUISintetizador === "function") actualizarUISintetizador();
        return;
      }
    }

    // 6) Si el synth está en modo envelope, disparar attack en planetas activos
    //    (interpretamos: noteOn MIDI = "tocar" lo que esté seleccionado)
    if (synth.modoTrigger === "envelope") {
      for (let i = 0; i < 10; i++) {
        if (synth.planetEnabled[i]) {
          synth.triggerAttack(i);
        }
      }
    }
  },

  _onNoteOff(nota, canal, entradaId) {
    // Los mapeos de parámetros son disparos puntuales: el note off no
    // deshace nada, pero tampoco debe llegar al piano ni a los astros
    // si la nota pertenece a un mapeo.
    if (typeof mapeoMIDI !== "undefined" && mapeoMIDI.notaDeMapeo(nota, canal)) return;

    // Modo piano: soltar la tecla de la escala microtonal
    if (typeof piano !== "undefined" && piano.midiNoteOff(nota, entradaId, canal)) return;

    // Mapeo de astros C4-A4: soltar ese astro y su grupo FM
    if (synth.midiAstros) {
      const astro = this.astroDeNotaMIDI(nota);
      if (astro !== -1) {
        synth.triggerReleaseGrupo(astro);
        if (typeof actualizarUISintetizador === "function") actualizarUISintetizador();
        return;
      }
    }

    // En modo envelope, soltar la nota MIDI dispara release
    if (synth.modoTrigger === "envelope") {
      for (let i = 0; i < 10; i++) {
        if (synth.envelopeActiva[i]) {
          synth.triggerRelease(i);
        }
      }
    }
  },

  _onCC(num, val, canal) {
    if (typeof mapeoMIDI !== "undefined") mapeoMIDI.manejarCC(num, val, canal);
  },

  nombreNotaMIDI(n) {
    if (typeof n !== "number" || n < 0 || n > 127) return "—";
    const nombres = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
    const oct = Math.floor(n / 12) - 1;
    return `${nombres[n % 12]}${oct} (${n})`;
  }
};
