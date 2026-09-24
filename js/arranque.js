// =========================================================
// arranque.js — encendido automático, modo ligero y respaldo
// =========================================================
//
// 1) Arranque automático: al abrir el programa queda TODO listo para
//    sonar menos los secuenciadores: audio encendido, astros marcados
//    como se dejaron (todos, la primera vez), buses del piano y del
//    Secuenciador 2 creados y MIDI activado. Se controla con dos
//    casillas de la sección "⚙ Arranque y rendimiento".
//
//    Los navegadores no dejan que un AudioContext suene antes de un
//    gesto del usuario (clic o tecla): el contexto se crea igual y
//    queda "suspended". Si pasa eso se muestra un aviso y el primer
//    clic/tecla lo reanuda. Los lanzadores (iniciar-mac.command /
//    iniciar-windows.bat) abren Chrome con
//    --autoplay-policy=no-user-gesture-required, y así suena sin tocar
//    nada.
//
// 2) Modo ligero, para equipos viejos (p. ej. una MacBook Pro 2012):
//    canvas a densidad 1× (en pantallas Retina son 4 veces menos
//    píxeles) y 30 cuadros por segundo. Se activa con la casilla o con
//    ?ligero=1 en la URL (el lanzador de Mac lo pone).
//
// 3) Exportar / importar TODA la configuración (todas las claves
//    cas-* de localStorage) en un JSON: sirve de respaldo y para pasar
//    tu configuración de una computadora a otra.
// =========================================================

const ARRANQUE_STORAGE_KEY = "cas-arranque-v1";

const arranque = {
  audio: true,     // encender el audio al abrir
  midi: true,      // activar MIDI al abrir
  ligero: false,   // modo ligero guardado
  _ligeroURL: null, // ?ligero=1 / ?ligero=0 (manda sobre lo guardado)

  cargar() {
    try {
      const raw = localStorage.getItem(ARRANQUE_STORAGE_KEY);
      const d = raw ? JSON.parse(raw) : null;
      if (d && typeof d === "object") {
        if (typeof d.audio === "boolean") this.audio = d.audio;
        if (typeof d.midi === "boolean") this.midi = d.midi;
        if (typeof d.ligero === "boolean") this.ligero = d.ligero;
      }
    } catch (e) {}
    try {
      const p = new URLSearchParams(location.search).get("ligero");
      if (p === "1" || p === "0") this._ligeroURL = (p === "1");
    } catch (e) {}
  },

  guardar() {
    try {
      localStorage.setItem(ARRANQUE_STORAGE_KEY, JSON.stringify({
        audio: this.audio, midi: this.midi, ligero: this.ligero
      }));
    } catch (e) {}
  },

  ligeroActivo() {
    return this._ligeroURL !== null ? this._ligeroURL : this.ligero;
  }
};

arranque.cargar();

// Llamada desde setup() justo después de createCanvas()
function configurarRendimiento() {
  if (typeof pixelDensity !== "function") return;
  if (arranque.ligeroActivo()) {
    pixelDensity(1);
    frameRate(30);
  } else {
    pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
    frameRate(60);
  }
  document.body.classList.toggle("modo-ligero", arranque.ligeroActivo());
}

// Llamada al final de setup(): deja todo encendido menos los secuenciadores
function iniciarArranqueAutomatico() {
  if (arranque.audio) {
    // Afinar antes de subir el volumen: sin esto los drones arrancan
    // en 440 Hz y se deslizan a su nota.
    synth.init();
    synth.updateFromAstros(estado.astros);
    synth.enable();

    // En Envelope + Acorde un astro marcado "suena" con su attack
    // sostenido: se dispara para que el estado coincida con los checks.
    // (En Drone synth.enable() ya aplicó los gains; en Secuencia los
    // astros quedan listos esperando Play o MIDI.)
    if (synth.modoTrigger === "envelope" && synth.modoReproduccion === "acorde") {
      for (let i = 0; i < 10; i++) {
        if (synth.planetEnabled[i]) synth.triggerAttack(i);
      }
    }

    piano.prepararBuses();
    secuenciador2._asegurarBus();
    if (typeof actualizarUISintetizador === "function") actualizarUISintetizador();
    _vigilarAudioSuspendido();
  }

  if (arranque.midi && typeof MIDI !== "undefined" && !MIDI.enabled) {
    MIDI.enable().then(() => {
      if (typeof renderEstadoMIDI === "function") renderEstadoMIDI();
    });
  }
}

// Si el navegador dejó el audio suspendido (falta un gesto), avisar y
// reanudar con el primer clic, toque o tecla.
function _vigilarAudioSuspendido() {
  if (!synth.ctx || synth.ctx.state === "running") return;

  let aviso = document.getElementById("aviso-audio");
  if (!aviso) {
    aviso = document.createElement("button");
    aviso.type = "button";
    aviso.id = "aviso-audio";
    aviso.className = "aviso-audio";
    aviso.textContent = "🔈 El navegador espera un clic o una tecla para encender el audio";
    document.body.appendChild(aviso);
  }
  aviso.hidden = false;

  const eventos = ["pointerdown", "keydown", "touchstart"];
  const reanudar = () => {
    if (!synth.ctx) return;
    synth.ctx.resume().then(() => {
      if (synth.ctx.state !== "running") return;
      aviso.hidden = true;
      eventos.forEach(ev => window.removeEventListener(ev, reanudar, true));
    }).catch(() => {});
  };
  eventos.forEach(ev => window.addEventListener(ev, reanudar, true));

  // Chrome con --autoplay-policy (o sitios con mucha interacción previa)
  // puede reanudar sin gesto: se ve al cambiar de estado.
  synth.ctx.addEventListener("statechange", () => {
    if (synth.ctx.state === "running") aviso.hidden = true;
  });
  synth.ctx.resume().catch(() => {});
}

// -------------------- Respaldo de la configuración --------------------

function exportarConfiguracionCompleta() {
  const datos = {};
  for (let i = 0; i < localStorage.length; i++) {
    const clave = localStorage.key(i);
    if (clave && clave.startsWith("cas-")) datos[clave] = localStorage.getItem(clave);
  }
  const json = JSON.stringify({
    formato: "carta-astral-sonica-config",
    version: 1,
    fecha: new Date().toISOString(),
    datos
  }, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `carta-sonica-config-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importarConfiguracionCompleta(texto) {
  let d;
  try {
    d = JSON.parse(texto);
  } catch (e) {
    alert("El archivo no es un JSON válido.");
    return;
  }
  if (!d || d.formato !== "carta-astral-sonica-config" || !d.datos || typeof d.datos !== "object") {
    alert("Este archivo no es un respaldo de configuración de Carta Astral Sónica.");
    return;
  }
  const claves = Object.keys(d.datos).filter(k => k.startsWith("cas-") && typeof d.datos[k] === "string");
  if (!claves.length) {
    alert("El respaldo no trae datos.");
    return;
  }
  if (!confirm(`Se reemplazará tu configuración actual con ${claves.length} bloques del respaldo y se recargará la página. ¿Continuar?`)) return;
  for (const k of claves) {
    try { localStorage.setItem(k, d.datos[k]); } catch (e) {}
  }
  location.reload();
}

// -------------------- UI (sección "⚙ Arranque y rendimiento") --------------------

function inicializarUIArranque() {
  const chkAudio = document.getElementById("arranque-audio");
  if (chkAudio) {
    chkAudio.checked = arranque.audio;
    chkAudio.addEventListener("change", e => { arranque.audio = e.target.checked; arranque.guardar(); });
  }
  const chkMidi = document.getElementById("arranque-midi");
  if (chkMidi) {
    chkMidi.checked = arranque.midi;
    chkMidi.addEventListener("change", e => { arranque.midi = e.target.checked; arranque.guardar(); });
  }
  const chkLigero = document.getElementById("arranque-ligero");
  if (chkLigero) {
    chkLigero.checked = arranque.ligeroActivo();
    chkLigero.addEventListener("change", e => {
      arranque.ligero = e.target.checked;
      arranque._ligeroURL = null;   // la casilla manda sobre la URL en esta sesión
      arranque.guardar();
      configurarRendimiento();
    });
  }

  document.getElementById("config-exportar")?.addEventListener("click", exportarConfiguracionCompleta);
  const archivo = document.getElementById("config-importar-file");
  document.getElementById("config-importar")?.addEventListener("click", () => archivo && archivo.click());
  if (archivo) {
    archivo.addEventListener("change", () => {
      const f = archivo.files && archivo.files[0];
      if (!f) return;
      const lector = new FileReader();
      lector.onload = () => importarConfiguracionCompleta(String(lector.result || ""));
      lector.readAsText(f);
      archivo.value = "";
    });
  }
}
