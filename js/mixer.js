// =========================================================
// mixer.js — ventana de Mezclador (estilo Ableton)
// =========================================================
//
// Vista + control de una consola de mezcla flotante con un canal por
// Maestro, Secuenciador, Piano y cada uno de los 10 astros. Cada canal
// es un fader vertical con medidor de pico/RMS, botones Mute/Solo y
// un pan.
//
// El ESTADO real (volumen, pan, mute, solo) vive en synth.js y
// piano.js (ver sus setters _factorAstro/_factorBus); este archivo
// es puramente UI: construye el DOM, refleja ese estado en cada
// control y llama a los setters cuando el usuario mueve algo. No
// duplica ningún valor de audio.
// =========================================================

const MIXER_STORAGE_KEY = "cas-mixer-v1";

// Copia local minúscula: interaction.js define escaparHTML() pero
// carga DESPUÉS de este archivo (ver orden de <script> en index.html).
function _mezcEscaparHTML(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

// Escala del medidor, en dB. -60dB se dibuja vacío, 0dB lleno.
const MEZC_DB_MIN = -60;

const mezclador = {
  abierto: false,
  pos: { x: null, y: null },
  _raf: null,
  _picos: {},   // id de canal → altura de peak-hold actual (0..1)
  _picosT: {},  // id de canal → timestamp del último pico nuevo

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
    this._refrescarControles();
    this._iniciarCiclo();
    this._guardarConfig();
  },

  cerrar() {
    const vent = document.getElementById("ventana-mezclador");
    if (vent) vent.hidden = true;
    this.abierto = false;
    this._detenerCiclo();
    this._guardarConfig();
  },

  // -------------------- Canales --------------------

  _colorAstro(k) {
    const porTema = THEME.astros && THEME.astros.coloresPorAstro && THEME.astros.coloresPorAstro[k];
    return porTema || COLORES_ASTROS_DEFAULT[k];
  },

  _descriptorCanales() {
    const canales = [
      {
        id: "master",
        etiqueta: "Maestro",
        color: "var(--accent)",
        panable: false,
        muteable: false,
        volumen: () => synth.masterVolume,
        setVolumen: v => synth.setMasterVolume(v),
        analyser: () => synth.meterMaster
      },
      {
        id: "secuenciador",
        etiqueta: "Secuenciador",
        color: "var(--accent-soft)",
        panable: true,
        muteable: true,
        volumen: () => synth.volumenSecuenciador,
        setVolumen: v => synth.setVolumenSecuenciador(v),
        pan: () => synth.panSecuenciadorValor,
        setPan: v => synth.setPanSecuenciador(v),
        muted: () => synth.secuenciadorMuted,
        setMuted: on => synth.setMuteSecuenciador(on),
        solo: () => synth.secuenciadorSolo,
        setSolo: on => synth.setSoloSecuenciador(on),
        analyser: () => synth.meterSecuenciador,
        enMaster: () => synth.enMasterSecuenciador,
        setEnMaster: on => synth.setEnMasterSecuenciador(on),
        salida: () => synth.salidaSecuenciador,
        setSalida: id => synth.setSalidaSecuenciador(id)
      },
      {
        id: "piano",
        etiqueta: "Piano",
        color: "var(--accent-soft)",
        panable: true,
        muteable: true,
        volumen: () => piano.volumenGeneral,
        setVolumen: v => piano.setVolumenGeneral(v),
        pan: () => piano.panValor,
        setPan: v => piano.setPan(v),
        muted: () => piano.muted,
        setMuted: on => piano.setMuted(on),
        solo: () => piano.solo,
        setSolo: on => piano.setSolo(on),
        analyser: () => piano.meterPiano,
        enMaster: () => piano.enMaster,
        setEnMaster: on => piano.setEnMaster(on),
        salida: () => piano.salida,
        setSalida: id => piano.setSalida(id)
      }
    ];
    for (let k = 0; k < 10; k++) {
      canales.push({
        id: "astro" + k,
        etiqueta: SIMBOLOS_ASTROS[k] + " " + NOMBRES_ASTROS[k],
        color: this._colorAstro(k),
        panable: true,
        muteable: true,
        volumen: () => synth.planetVolume[k],
        setVolumen: v => synth.setPlanetVolume(k, v),
        pan: () => synth.planetPan[k],
        setPan: v => synth.setPlanetPan(k, v),
        muted: () => synth.planetMuted[k],
        setMuted: on => synth.setPlanetMuted(k, on),
        solo: () => synth.planetSolo[k],
        setSolo: on => synth.setPlanetSolo(k, on),
        analyser: () => synth.voices[k] && synth.voices[k].meterNode,
        enMaster: () => synth.planetEnMaster[k],
        setEnMaster: on => synth.setPlanetEnMaster(k, on),
        salida: () => synth.planetSalida[k],
        setSalida: id => synth.setPlanetSalida(k, id)
      });
    }
    return canales;
  },

  // -------------------- Construcción del DOM --------------------

  _construirVentana() {
    let vent = document.getElementById("ventana-mezclador");
    if (vent) return vent;

    this._canales = this._descriptorCanales();

    vent = document.createElement("div");
    vent.id = "ventana-mezclador";
    vent.className = "ventana-flotante mezclador-ventana";
    vent.hidden = true;

    const guardado = this._leerConfig();
    const px = clamp((guardado && typeof guardado.x === "number") ? guardado.x : 40, 0, Math.max(0, window.innerWidth - 160));
    const py = clamp((guardado && typeof guardado.y === "number") ? guardado.y : 60, 0, Math.max(0, window.innerHeight - 120));
    vent.style.left = px + "px";
    vent.style.top = py + "px";

    vent.innerHTML = `
      <div class="ventana-titulo mezclador-titulo">
        <span>🎚 Mezclador</span>
        <button type="button" class="mezclador-cerrar" title="Cerrar el mezclador">✕</button>
      </div>
      <div class="mezc-salidas-bloque">
        <div class="mezc-salidas-header">
          <span class="seq-sub-titulo">🔌 Salidas de audio</span>
          <div class="mezc-salidas-acciones">
            <button type="button" class="mezc-salida-refrescar" title="Volver a buscar dispositivos de salida de audio">🔄 Dispositivos</button>
          </div>
        </div>
        <p class="mezc-samplerate-info" hidden></p>

        <div class="mezc-baja-latencia">
          <label>⚡ Baja latencia (todo el mezclador, un solo destino)
            <select class="mezc-baja-latencia-select">
              <option value="">— Predeterminada (bocinas) —</option>
            </select>
          </label>
          <span class="mezc-baja-latencia-estado"></span>
        </div>
        <p class="mezc-salidas-hint">
          Manda TODO el audio (Maestro incluido) directo a un dispositivo, sin el salto por
          &lt;audio&gt;/MediaStream de las salidas de abajo — por eso no agrega los ~500ms extra
          de latencia. A cambio, es un solo destino para todo: no se puede combinar con enviar
          un canal a un sitio y otro a otro distinto al mismo tiempo.
        </p>

        <div class="mezc-salidas-header" style="margin-top:10px">
          <span class="seq-sub-titulo">🔀 Salidas virtuales por canal</span>
          <div class="mezc-salidas-acciones">
            <button type="button" class="mezc-salida-nueva" title="Crear una nueva salida virtual">✚ Nueva salida</button>
          </div>
        </div>
        <div class="mezc-salidas-lista"></div>
        <p class="mezc-salidas-estado" hidden></p>
        <p class="mezc-salidas-hint">
          Cada salida es un bus propio que se puede enrutar a un dispositivo de audio del
          sistema (p. ej. un cable de audio virtual como VB-Audio Virtual Cable o
          BlackHole) para que otro DAW —como Ableton— lo reciba como entrada. Asígnale la
          salida a cada canal con su selector, y usa el botón <strong>M</strong> para
          sacarlo o meterlo del grupo Maestro (Maestro siempre suena por tus bocinas). Tiene
          más latencia que la opción de arriba — sirve para separar tracks que vas a grabar y
          alinear después en el DAW, no para tocar en vivo sincronizado.
        </p>
      </div>
      <div class="mezclador-canales"></div>
    `;
    document.body.appendChild(vent);

    const cuerpo = vent.querySelector(".mezclador-canales");
    for (const c of this._canales) {
      cuerpo.appendChild(this._construirCanal(c));
    }

    vent.querySelector(".mezclador-cerrar").addEventListener("click", () => this.cerrar());

    vent.querySelector(".mezc-salida-nueva").addEventListener("click", async () => {
      salidasAudio.crear();
      if (!salidasAudio.dispositivos.length) await this._refrescarDispositivosUI();
      this._renderSalidasLista();
    });
    vent.querySelector(".mezc-salida-refrescar").addEventListener("click", async () => {
      await this._refrescarDispositivosUI();
      this._renderSalidasLista();
    });

    const selBajaLatencia = vent.querySelector(".mezc-baja-latencia-select");
    selBajaLatencia.disabled = !synth.soportaSalidaBajaLatencia();
    selBajaLatencia.addEventListener("change", async () => {
      const estado = vent.querySelector(".mezc-baja-latencia-estado");
      estado.textContent = "⏳";
      const ok = await synth.setSalidaBajaLatencia(selBajaLatencia.value);
      estado.textContent = ok ? "🟢" : "🔴";
      estado.title = ok ? "Aplicada" : "No se pudo aplicar (revisa la consola)";
    });

    this._renderSalidasLista();
    this._refrescarSelectBajaLatencia();
    this._actualizarAvisoSalidas();
    this._actualizarInfoSampleRate();

    // Arrastre por la barra de título (mismo patrón que las ventanas
    // flotantes de secciones del panel, ver interaction.js).
    const barra = vent.querySelector(".mezclador-titulo");
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

  // -------------------- Salidas virtuales --------------------

  // Envuelve salidasAudio.refrescarDispositivos() con feedback visible:
  // deshabilita el botón mientras busca (evita el doble clic confuso) y
  // muestra el error real si algo falló, en vez de que parezca que no
  // pasó nada.
  async _refrescarDispositivosUI() {
    const vent = document.getElementById("ventana-mezclador");
    const btn = vent && vent.querySelector(".mezc-salida-refrescar");
    const textoOriginal = btn ? btn.textContent : "";
    if (btn) { btn.disabled = true; btn.textContent = "⏳ Buscando…"; }

    await salidasAudio.refrescarDispositivos();

    if (btn) { btn.disabled = false; btn.textContent = textoOriginal; }
    this._refrescarSelectBajaLatencia();
    this._actualizarAvisoSalidas();
  },

  // Un solo lugar que decide qué aviso mostrar sobre las salidas
  // virtuales, en orden de prioridad: abrir el archivo con file:// rompe
  // la API de selección de salida ANTES de siquiera intentar nada (así
  // que se avisa apenas se abre el mezclador, no solo tras un clic
  // fallido); luego el error real de la última búsqueda; luego falta de
  // soporte del navegador.
  _actualizarAvisoSalidas() {
    const vent = document.getElementById("ventana-mezclador");
    const estado = vent && vent.querySelector(".mezc-salidas-estado");
    if (!estado) return;

    if (location.protocol === "file:") {
      estado.hidden = false;
      estado.classList.add("error");
      estado.textContent = "Estás abriendo el archivo directamente (file://): el navegador no deja "
        + "elegir ni nombrar dispositivos de salida así. Corre \"python -m http.server 8123\" en la "
        + "carpeta del proyecto y abre http://localhost:8123 en vez de abrir index.html con doble clic.";
    } else if (salidasAudio._ultimoError) {
      estado.hidden = false;
      estado.classList.add("error");
      estado.textContent = "No se pudo abrir el selector de dispositivos: " + salidasAudio._ultimoError;
    } else if (!salidasAudio.soportaSelectAudioOutput() && !salidasAudio.soportaSetSinkId()) {
      estado.hidden = false;
      estado.classList.remove("error");
      estado.textContent = "Tu navegador no soporta elegir dispositivo de salida. Usa Chrome o Edge.";
    } else {
      estado.hidden = true;
      estado.classList.remove("error");
    }
  },

  // Un jitter con cambio de pitch al mandar audio a otro dispositivo casi
  // siempre es un desajuste de sample rate entre el AudioContext, el
  // dispositivo intermedio (p. ej. VB-Cable) y el proyecto del DAW.
  // Mostrarlo aquí evita tener que abrir la consola para saberlo.
  _actualizarInfoSampleRate() {
    const vent = document.getElementById("ventana-mezclador");
    const info = vent && vent.querySelector(".mezc-samplerate-info");
    if (!info) return;
    if (synth.ctx) {
      info.hidden = false;
      info.textContent = "🎚 Frecuencia de muestreo de este AudioContext: " + synth.ctx.sampleRate
        + " Hz — configura tu cable/interfaz de salida y el proyecto del DAW a este MISMO valor "
        + "(un desajuste aquí es la causa más común de jitter y cambios de pitch al enrutar audio).";
    } else {
      info.hidden = true;
    }
  },

  _refrescarSelectBajaLatencia() {
    const vent = document.getElementById("ventana-mezclador");
    const sel = vent && vent.querySelector(".mezc-baja-latencia-select");
    if (!sel) return;
    const actual = synth.salidaBajaLatenciaDeviceId || "";
    let html = `<option value="">— Predeterminada (bocinas) —</option>`;
    for (const d of salidasAudio.dispositivos) {
      const elegido = d.deviceId === actual ? " selected" : "";
      html += `<option value="${_mezcEscaparHTML(d.deviceId)}"${elegido}>${_mezcEscaparHTML(d.label)}</option>`;
    }
    sel.innerHTML = html;
  },

  _opcionesDispositivo(deviceIdActual) {
    const soportado = salidasAudio.soportaSetSinkId();
    let html = `<option value="">— Sin dispositivo (silenciada) —</option>`;
    for (const d of salidasAudio.dispositivos) {
      const sel = d.deviceId === deviceIdActual ? " selected" : "";
      html += `<option value="${_mezcEscaparHTML(d.deviceId)}"${sel}>${_mezcEscaparHTML(d.label)}</option>`;
    }
    if (!soportado) html = `<option value="">Navegador sin soporte (usa Chrome/Edge)</option>`;
    return html;
  },

  _renderSalidasLista() {
    const vent = document.getElementById("ventana-mezclador");
    if (!vent) return;
    const cont = vent.querySelector(".mezc-salidas-lista");
    if (!cont) return;

    cont.innerHTML = "";
    if (!salidasAudio.lista.length) {
      cont.innerHTML = `<p class="mezc-salidas-vacio">Sin salidas creadas todavía.</p>`;
    }
    for (const s of salidasAudio.lista) {
      const fila = document.createElement("div");
      fila.className = "mezc-salida-item";
      fila.dataset.id = s.id;
      const activa = salidasAudio.estaActiva(s.id);
      fila.innerHTML = `
        <span class="mezc-salida-estado ${activa ? "activa" : ""}" title="${activa ? "Enrutada" : "Sin enrutar"}">●</span>
        <input type="text" class="mezc-salida-nombre" value="${_mezcEscaparHTML(s.nombre)}" title="Nombre de la salida">
        <select class="mezc-salida-dispositivo" title="Dispositivo de salida del sistema">
          ${this._opcionesDispositivo(s.deviceId)}
        </select>
        <button type="button" class="mezc-salida-borrar" title="Eliminar esta salida">✕</button>
      `;
      cont.appendChild(fila);

      const nombreInput = fila.querySelector(".mezc-salida-nombre");
      nombreInput.addEventListener("change", () => {
        salidasAudio.renombrar(s.id, nombreInput.value);
        this._refrescarSelectsSalida();
      });

      const dispSelect = fila.querySelector(".mezc-salida-dispositivo");
      dispSelect.disabled = !salidasAudio.soportaSetSinkId();
      dispSelect.addEventListener("change", async () => {
        await salidasAudio.setDispositivo(s.id, dispSelect.value);
        const estado = fila.querySelector(".mezc-salida-estado");
        const act = salidasAudio.estaActiva(s.id);
        estado.classList.toggle("activa", act);
        estado.title = act ? "Enrutada" : "Sin enrutar";
      });

      fila.querySelector(".mezc-salida-borrar").addEventListener("click", () => {
        salidasAudio.eliminar(s.id);
        this._renderSalidasLista();
        this._refrescarSelectsSalida();
      });
    }
    this._refrescarSelectsSalida();
  },

  _refrescarSelectsSalida() {
    const vent = document.getElementById("ventana-mezclador");
    if (!vent) return;
    const opciones = salidasAudio.lista
      .map(s => `<option value="${_mezcEscaparHTML(s.id)}">${_mezcEscaparHTML(s.nombre)}</option>`)
      .join("");
    vent.querySelectorAll(".mezc-canal-salida").forEach(sel => {
      const actual = sel.value;
      sel.innerHTML = `<option value="">— Sin salida —</option>${opciones}`;
      if ([...sel.options].some(o => o.value === actual)) sel.value = actual;
    });
  },

  _construirCanal(c) {
    const el = document.createElement("div");
    el.className = "mezc-canal";
    el.dataset.id = c.id;

    const panHTML = c.panable
      ? `<input type="range" class="mezc-pan-input" min="-1" max="1" step="0.01" title="Pan">`
      : `<div class="mezc-pan-vacio"></div>`;

    const msHTML = c.muteable
      ? `<div class="mezc-ms">
           <button type="button" class="mezc-mute" title="Silenciar">M</button>
           <button type="button" class="mezc-solo" title="Solo">S</button>
         </div>`
      : `<div class="mezc-ms mezc-ms-vacio"></div>`;

    const ruteoHTML = c.salida
      ? `<div class="mezc-ruteo">
           <button type="button" class="mezc-canal-master" title="Incluir este canal en el grupo Maestro">Maestro</button>
           <select class="mezc-canal-salida" title="Enviar también a una salida virtual">
             <option value="">— Sin salida —</option>
           </select>
         </div>`
      : "";

    el.innerHTML = `
      <div class="mezc-nombre" style="color:${c.color}" title="${_mezcEscaparHTML(c.etiqueta)}">${_mezcEscaparHTML(c.etiqueta)}</div>
      <div class="mezc-pan">${panHTML}</div>
      <div class="mezc-cuerpo">
        <div class="mezc-medidor"><div class="mezc-medidor-fill"></div><div class="mezc-medidor-pico"></div></div>
        <input type="range" class="mezc-fader" min="0" max="1" step="0.01" title="Volumen">
      </div>
      <div class="mezc-db">—</div>
      ${msHTML}
      ${ruteoHTML}
    `;

    const fader = el.querySelector(".mezc-fader");
    fader.addEventListener("input", e => c.setVolumen(parseFloat(e.target.value)));

    const panInput = el.querySelector(".mezc-pan-input");
    if (panInput) panInput.addEventListener("input", e => c.setPan(parseFloat(e.target.value)));

    const btnMute = el.querySelector(".mezc-mute");
    if (btnMute) btnMute.addEventListener("click", () => c.setMuted(!c.muted()));

    const btnSolo = el.querySelector(".mezc-solo");
    if (btnSolo) btnSolo.addEventListener("click", () => c.setSolo(!c.solo()));

    const btnCanalMaster = el.querySelector(".mezc-canal-master");
    if (btnCanalMaster) btnCanalMaster.addEventListener("click", () => c.setEnMaster(!c.enMaster()));

    const selCanalSalida = el.querySelector(".mezc-canal-salida");
    if (selCanalSalida) selCanalSalida.addEventListener("change", e => c.setSalida(e.target.value || null));

    return el;
  },

  // -------------------- Sincronización de controles --------------------
  // Muchos otros paneles (filas de planetas, panel del piano) también
  // cambian estos mismos valores: en vez de enganchar cada uno, el
  // mezclador se refresca solo en cada frame de su propio ciclo.

  _refrescarControles() {
    if (!this._canales) return;
    const vent = document.getElementById("ventana-mezclador");
    if (!vent || vent.hidden) return;

    for (const c of this._canales) {
      const el = vent.querySelector(`.mezc-canal[data-id="${c.id}"]`);
      if (!el) continue;

      const fader = el.querySelector(".mezc-fader");
      if (document.activeElement !== fader) fader.value = c.volumen();

      if (c.panable) {
        const panInput = el.querySelector(".mezc-pan-input");
        if (panInput && document.activeElement !== panInput) panInput.value = c.pan();
      }

      if (c.muteable) {
        el.querySelector(".mezc-mute").classList.toggle("activo", !!c.muted());
        el.querySelector(".mezc-solo").classList.toggle("activo", !!c.solo());
      }

      if (c.salida) {
        const btnCanalMaster = el.querySelector(".mezc-canal-master");
        if (btnCanalMaster) btnCanalMaster.classList.toggle("activo", !!c.enMaster());
        const selCanalSalida = el.querySelector(".mezc-canal-salida");
        if (selCanalSalida && document.activeElement !== selCanalSalida) {
          const val = c.salida() || "";
          if (selCanalSalida.value !== val) selCanalSalida.value = val;
        }
      }

      const db = el.querySelector(".mezc-db");
      const v = c.volumen();
      db.textContent = v <= 0.001 ? "-inf" : Math.round(20 * Math.log10(v)) + "dB";
    }
  },

  // -------------------- Medidores --------------------

  _nivelDeAnalyser(analyser) {
    if (!analyser) return { pico: 0, rms: 0 };
    const n = analyser.fftSize;
    if (!this._bufTmp || this._bufTmp.length !== n) this._bufTmp = new Float32Array(n);
    analyser.getFloatTimeDomainData(this._bufTmp);
    let pico = 0, suma = 0;
    for (let i = 0; i < n; i++) {
      const m = Math.abs(this._bufTmp[i]);
      if (m > pico) pico = m;
      suma += this._bufTmp[i] * this._bufTmp[i];
    }
    const rms = Math.sqrt(suma / n);
    return { pico, rms };
  },

  _alturaDesdeLineal(v) {
    if (v <= 0.0005) return 0;
    const db = 20 * Math.log10(v);
    return clamp((db - MEZC_DB_MIN) / (0 - MEZC_DB_MIN), 0, 1);
  },

  _refrescarMedidores() {
    if (!this._canales) return;
    const vent = document.getElementById("ventana-mezclador");
    if (!vent || vent.hidden) return;

    const ahora = performance.now();
    for (const c of this._canales) {
      const el = vent.querySelector(`.mezc-canal[data-id="${c.id}"]`);
      if (!el) continue;
      const { pico, rms } = this._nivelDeAnalyser(c.analyser());
      const hRms = this._alturaDesdeLineal(rms);
      const hPico = this._alturaDesdeLineal(pico);

      const fill = el.querySelector(".mezc-medidor-fill");
      fill.style.height = (hRms * 100).toFixed(1) + "%";
      fill.style.background = hRms > 0.92
        ? "linear-gradient(to top, #5dbb72, #e0a23f 70%, #e06464)"
        : "linear-gradient(to top, #5dbb72, #e0a23f 85%, #e06464)";

      // Peak-hold: sube al instante, baja despacio.
      const actual = this._picos[c.id] || 0;
      if (hPico >= actual) {
        this._picos[c.id] = hPico;
        this._picosT[c.id] = ahora;
      } else if (ahora - (this._picosT[c.id] || 0) > 600) {
        this._picos[c.id] = Math.max(0, actual - 0.02);
      }
      el.querySelector(".mezc-medidor-pico").style.bottom = ((this._picos[c.id] || 0) * 100).toFixed(1) + "%";
    }
  },

  _iniciarCiclo() {
    if (this._raf) return;
    const paso = () => {
      this._refrescarControles();
      this._refrescarMedidores();
      this._raf = requestAnimationFrame(paso);
    };
    this._raf = requestAnimationFrame(paso);
  },

  _detenerCiclo() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  },

  // -------------------- Persistencia (solo la ventana) --------------------
  // El volumen/pan/mute/solo de cada canal vive en synth.js/piano.js.

  _guardarConfig() {
    try {
      const vent = document.getElementById("ventana-mezclador");
      localStorage.setItem(MIXER_STORAGE_KEY, JSON.stringify({
        abierto: this.abierto,
        x: vent ? vent.offsetLeft : null,
        y: vent ? vent.offsetTop : null
      }));
    } catch (e) {}
  },

  _leerConfig() {
    try {
      const raw = localStorage.getItem(MIXER_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
};

// Llamada desde setup() (sketch.js), igual que el resto de la UI.
function inicializarUIMezclador() {
  const btn = document.getElementById("btn-mezclador-toggle");
  if (btn) btn.addEventListener("click", () => mezclador.toggle());

  // Reabrir automáticamente si el usuario lo dejó abierto la vez anterior.
  const guardado = mezclador._leerConfig();
  if (guardado && guardado.abierto) mezclador.abrir();
}
