// =========================================================
// interaction.js — teclado, ratón, formulario, panel, synth, bancos, MIDI
// =========================================================

// -------------- Teclado (p5 hook) --------------
function keyPressed() {
  if (document.activeElement && (
      document.activeElement.tagName === "INPUT" ||
      document.activeElement.tagName === "TEXTAREA"
  )) {
    return;
  }

  // El piano tiene prioridad: con su teclado de ordenador activo, las
  // letras tocan notas en vez de disparar los atajos de la carta.
  if (typeof piano !== "undefined" && piano.manejarTeclaAbajo(key)) return;

  if (key === "m" || key === "M") {
    // Alterna cromático ↔ círculo de quintas (intervalo 2m ↔ 5J)
    setIntervaloOrden(intervaloOrden === 7 ? 1 : 7);
    if (typeof synth !== "undefined" && synth.ctx) synth.updateFromAstros(estado.astros);
    sincronizarUINotas();
    refrescarPanel();
  }

  if (key === "+" || key === "=") {
    setNumMicrotonos(numMicrotonos + 1);
    if (typeof synth !== "undefined" && synth.ctx) synth.updateFromAstros(estado.astros);
    refrescarPanel();
  }
  if (key === "-") {
    setNumMicrotonos(numMicrotonos - 1);
    if (typeof synth !== "undefined" && synth.ctx) synth.updateFromAstros(estado.astros);
    refrescarPanel();
  }

  if (key === "d" || key === "D") cambiarAModoDemo();
  if (key === "a" || key === "A") cambiarAModoAhora();
  if (key === "e" || key === "E") cambiarAModoExploracion();
  if (key === " ") alternarTiempoReal();
  if (key === "0") volverAlPresente();
  if (key === "[") decrementarPasoTemporal();
  if (key === "]") incrementarPasoTemporal();
}

function mouseWheel(event) {
  // Solo actuar si la rueda gira sobre el canvas (no sobre el panel/UI)
  if (typeof eventoSobreCanvas === "function" && !eventoSobreCanvas(event)) return;
  if (document.activeElement && document.activeElement.tagName === "INPUT") return;

  // Con el Sistema solar de fondo, la rueda hace zoom hacia el cursor;
  // Shift+rueda conserva el desplazamiento temporal (ver los astros orbitar)
  if (typeof estadoVistas !== "undefined" && estadoVistas.fondo === "sistema" &&
      typeof zoomSistemaEn === "function" && !event.shiftKey) {
    zoomSistemaEn(mouseX, mouseY, event.delta);
    return false;
  }

  if (estado.modo !== MODO_EXPLORACION) return;
  // Con Shift, varios navegadores reportan el desplazamiento en deltaX
  const delta = event.delta || event.deltaX || 0;
  if (!delta) return false;
  aplicarImpulsoExploracion(delta > 0 ? 1 : -1);
  return false;
}

// -------------- Formulario manual --------------
function inicializarFormulario() {
  const form = document.getElementById("form-manual");
  form.addEventListener("submit", e => { e.preventDefault(); aplicarFormulario(); });
}

function aplicarFormulario() {
  // Fecha sin límites: año + era (d.C. / a.C.), mes y día numéricos.
  // Año astronómico: 1 a.C. = año 0, 2 a.C. = año -1, etc.
  const anioInput = parseInt(document.getElementById("input-anio").value, 10);
  const era = document.getElementById("select-era").value;
  const mes = parseInt(document.getElementById("input-mes").value, 10);
  const dia = parseInt(document.getElementById("input-dia").value, 10);
  const hora = document.getElementById("input-hora").value;
  const ubicacion = document.getElementById("input-ubicacion").value.trim();
  const lat = parseFloat(document.getElementById("input-latitud").value);
  const lon = parseFloat(document.getElementById("input-longitud").value);
  const zona = parseFloat(document.getElementById("input-zona").value);

  if (Number.isNaN(anioInput) || anioInput < 1) return;
  if (Number.isNaN(mes) || mes < 1 || mes > 12) return;
  if (Number.isNaN(dia) || dia < 1 || dia > 31) return;
  if (!hora) return;
  if (Number.isNaN(lat) || lat < -90 || lat > 90) return;
  if (Number.isNaN(lon) || lon < -180 || lon > 180) return;
  if (Number.isNaN(zona) || zona < -14 || zona > 14) return;

  const year = (era === "ac") ? (1 - anioInput) : anioInput;
  const partesHora = hora.split(":").map(Number);
  estado.fechaUTC = fechaLocalAUTC(year, mes, dia, partesHora[0], partesHora[1], partesHora[2] || 0, zona);
  estado.ubicacionNombre = ubicacion;
  estado.latitud = lat;
  estado.longitud = lon;
  estado.zonaHoraria = zona;

  estado.modo = MODO_EXPLORACION;
  estado.seguirTiempoReal = false;
  cargarCartaExploracion();
  notificarCartaActualizada();
}

function sincronizarFormularioConEstado() {
  const offsetMs = estado.zonaHoraria * 3600 * 1000;
  const local = new Date(estado.fechaUTC.getTime() + offsetMs);

  const anioAstronomico = local.getUTCFullYear();
  const esAC = anioAstronomico <= 0;
  document.getElementById("input-anio").value = esAC ? (1 - anioAstronomico) : anioAstronomico;
  document.getElementById("select-era").value = esAC ? "ac" : "dc";
  document.getElementById("input-mes").value = local.getUTCMonth() + 1;
  document.getElementById("input-dia").value = local.getUTCDate();
  document.getElementById("input-hora").value =
    `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:${pad2(local.getUTCSeconds())}`;
  document.getElementById("input-ubicacion").value = estado.ubicacionNombre;
  document.getElementById("input-latitud").value = estado.latitud;
  document.getElementById("input-longitud").value = estado.longitud;
  document.getElementById("input-zona").value = estado.zonaHoraria;
}

// =========================================================
// UI del sintetizador
// =========================================================

function inicializarUISintetizador() {
  // Toggle audio
  const toggle = document.getElementById("synth-enabled");
  if (toggle) {
    toggle.addEventListener("change", e => {
      if (e.target.checked) {
        synth.enable();
        synth.updateFromAstros(estado.astros);
      } else {
        synth.disable();
      }
      actualizarUISintetizador();
    });
  }

  // Volumen maestro
  const vol = document.getElementById("synth-master-volume");
  if (vol) {
    vol.value = Math.round(synth.masterVolume * 100);
    vol.addEventListener("input", e => {
      synth.setMasterVolume(parseFloat(e.target.value) / 100);
    });
  }

  // Modo de mapeo: continuo / región
  document.querySelectorAll('input[name="synth-mode"]').forEach(radio => {
    radio.checked = (radio.value === synth.modo);
    radio.addEventListener("change", e => {
      if (!e.target.checked) return;
      if (!synth.ctx) synth.init();
      synth.setModo(e.target.value);
      actualizarUISintetizador();
    });
  });

  // Modo de disparo: drone / envelope
  document.querySelectorAll('input[name="synth-trigger-mode"]').forEach(radio => {
    radio.checked = (radio.value === synth.modoTrigger);
    radio.addEventListener("change", e => {
      if (!e.target.checked) return;
      synth.setModoTrigger(e.target.value);
      document.body.classList.toggle("synth-envelope-mode", synth.modoTrigger === "envelope");
      actualizarUISintetizador();
    });
  });
  document.body.classList.toggle("synth-envelope-mode", synth.modoTrigger === "envelope");

  // Modo de reproducción: acorde / secuencia
  document.querySelectorAll('input[name="synth-playback-mode"]').forEach(radio => {
    radio.checked = (radio.value === synth.modoReproduccion);
    radio.addEventListener("change", e => {
      if (!e.target.checked) return;
      synth.setModoReproduccion(e.target.value);
      document.body.classList.toggle("synth-secuencia-mode", synth.modoReproduccion === "secuencia");
      renderFilasPlanetas();
      actualizarUISintetizador();
    });
  });
  document.body.classList.toggle("synth-secuencia-mode", synth.modoReproduccion === "secuencia");

  // Editor gráfico de ADSR (por astro o todos)
  inicializarEditorADSR();

  // Secuenciador (BPM, gate, figura, play/stop, restablecer orden)
  inicializarSecuenciador();

  // FM estilo Operator (algoritmo + profundidad + esquema)
  inicializarFM();

  // Editor de armónicos pares/impares (forma personalizada)
  inicializarArmonicos();

  renderFilasPlanetas();

  document.getElementById("synth-play-all")?.addEventListener("click", () => {
    if (!synth.ctx) synth.init();
    synth.enable();
    synth.updateFromAstros(estado.astros);
    document.getElementById("synth-enabled").checked = true;
    for (let i = 0; i < 10; i++) synth.setPlanetEnabled(i, true);
    actualizarUISintetizador();
  });

  document.getElementById("synth-stop-all")?.addEventListener("click", () => {
    if (synth.secuenciaActiva) synth.detenerSecuencia();
    for (let i = 0; i < 10; i++) synth.setPlanetEnabled(i, false);
    actualizarUISintetizador();
  });
}

// =========================================================
// Editor gráfico de ADSR (arrastra los puntos; por astro o todos)
// =========================================================

function inicializarEditorADSR() {
  const sel = document.getElementById("adsr-astro");
  const cont = document.getElementById("adsr-grafico");
  const valores = document.getElementById("adsr-valores");
  if (!sel || !cont) return;

  sel.innerHTML = `<option value="-1">Todos los astros</option>` +
    NOMBRES_ASTROS.slice(0, 10).map((n, i) =>
      `<option value="${i}">${SIMBOLOS_ASTROS[i]} ${n}</option>`
    ).join("");

  let objetivo = -1;
  const adsrActual = () => (objetivo === -1) ? synth.adsr : synth.adsrAstro[objetivo];
  const curvaActual = () => (objetivo === -1) ? synth.adsrCurva : synth.adsrCurvaAstro[objetivo];

  // Forma del tramo con curvatura c ∈ [-1, 1]: f(u) = u^(2^(2c))
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

  // Tramo muestreado con curvatura: de (xDe,yDe) a (xHasta,yHasta)
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

  function render() {
    const e = adsrActual();
    const c = curvaActual();
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
    `;
    if (valores) valores.textContent = fmt(e);
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

    svg.querySelectorAll(".adsr-handle").forEach(handle => {
      handle.addEventListener("pointerdown", ev => {
        ev.preventDefault();
        const tipo = handle.dataset.h;

        const mover = e2 => {
          const p = aViewBox(e2);
          const adsr = adsrActual();
          if (tipo === "a") {
            const t = clamp((p.x - PAD) / ZA, 0, 1);
            synth.setADSRAstro(objetivo, "attack", Math.max(0.001, t * t * MAX_A));
          } else if (tipo === "ds") {
            const t = clamp((p.x - xA(adsr.attack)) / ZD, 0, 1);
            synth.setADSRAstro(objetivo, "decay", Math.max(0.001, t * t * MAX_D));
            const s = clamp(1 - (p.y - yTop) / (yBase - yTop), 0, 1);
            synth.setADSRAstro(objetivo, "sustain", s);
          } else if (tipo === "r") {
            const t = clamp((p.x - xS(adsr.attack, adsr.decay)) / ZR, 0, 1);
            synth.setADSRAstro(objetivo, "release", Math.max(0.001, t * t * MAX_R));
          }
          render();
        };

        const soltar = () => {
          window.removeEventListener("pointermove", mover);
          window.removeEventListener("pointerup", soltar);
        };
        window.addEventListener("pointermove", mover);
        window.addEventListener("pointerup", soltar);
      });
    });

    // Handles de curvatura (rombos): arrastrar verticalmente desde el
    // centro del tramo lo curva como un arco (c = 0 vuelve a lineal)
    svg.querySelectorAll(".adsr-curva-handle").forEach(handle => {
      handle.addEventListener("pointerdown", ev => {
        ev.preventDefault();
        const param = handle.dataset.c;

        const mover = e2 => {
          const p = aViewBox(e2);
          const adsr = adsrActual();
          const ys = yS(adsr.sustain);
          // Extremos verticales del tramo (valor inicial → final)
          let yDe, yHasta;
          if (param === "attack")     { yDe = yBase; yHasta = yTop; }
          else if (param === "decay") { yDe = yTop;  yHasta = ys; }
          else                        { yDe = ys;    yHasta = yBase; }
          if (Math.abs(yHasta - yDe) < 3) return;  // tramo plano: nada que curvar
          // Curvatura cuya f(0.5) hace pasar el tramo por el puntero
          const f = clamp((p.y - yDe) / (yHasta - yDe), 0.04, 0.96);
          const gamma = Math.log(f) / Math.log(0.5);
          synth.setADSRCurva(objetivo, param, clamp(Math.log2(gamma) / 2, -1, 1));
          render();
        };

        const soltar = () => {
          window.removeEventListener("pointermove", mover);
          window.removeEventListener("pointerup", soltar);
        };
        window.addEventListener("pointermove", mover);
        window.addEventListener("pointerup", soltar);
      });
    });
  }

  sel.addEventListener("change", () => {
    objetivo = parseInt(sel.value, 10);
    render();
  });

  render();
}

function inicializarSecuenciador() {
  // BPM: slider + entrada numérica sincronizados
  const bpm = document.getElementById("synth-bpm");
  const bpmNum = document.getElementById("synth-bpm-num");
  const bpmVal = document.getElementById("synth-bpm-val");

  const aplicarBPM = (v) => {
    synth.setBPM(v);
    if (bpm) bpm.value = synth.bpm;
    if (bpmNum) bpmNum.value = synth.bpm;
    if (bpmVal) bpmVal.textContent = synth.bpm;
  };

  if (bpm) {
    bpm.min = BPM_MIN;
    bpm.max = BPM_MAX;
    bpm.value = synth.bpm;
    if (bpmVal) bpmVal.textContent = synth.bpm;
    bpm.addEventListener("input", e => aplicarBPM(parseInt(e.target.value, 10)));
  }
  if (bpmNum) {
    bpmNum.min = BPM_MIN;
    bpmNum.max = BPM_MAX;
    bpmNum.value = synth.bpm;
    bpmNum.addEventListener("change", e => aplicarBPM(parseInt(e.target.value, 10)));
  }

  // Figura rítmica (blancas ... semifusas y sus tresillos)
  const figura = document.getElementById("synth-figura");
  if (figura) {
    figura.innerHTML = FIGURAS_SECUENCIA.map(f =>
      `<option value="${f.id}"${f.id === synth.figuraSecuencia ? " selected" : ""}>${f.nombre}</option>`
    ).join("");
    figura.addEventListener("change", e => synth.setFiguraSecuencia(e.target.value));
  }

  // Gate
  const gate = document.getElementById("synth-gate");
  const gateVal = document.getElementById("synth-gate-val");
  if (gate) {
    gate.value = synth.gate;
    if (gateVal) gateVal.textContent = Math.round(synth.gate * 100) + "%";
    gate.addEventListener("input", e => {
      const v = parseFloat(e.target.value);
      synth.setGate(v);
      if (gateVal) gateVal.textContent = Math.round(v * 100) + "%";
    });
  }

  // Play / Stop
  document.getElementById("seq-play")?.addEventListener("click", () => {
    if (!synth.ctx) synth.init();
    synth.iniciarSecuencia();
    actualizarUISintetizador();
  });
  document.getElementById("seq-stop")?.addEventListener("click", () => {
    synth.detenerSecuencia();
    actualizarUISintetizador();
  });

  // Alineamiento de astros: directo, inverso, aleatorio o por región tonal
  document.getElementById("seq-orden-directo")?.addEventListener("click", () => {
    synth.restablecerOrden();
    renderFilasPlanetas();
  });
  document.getElementById("seq-orden-inverso")?.addEventListener("click", () => {
    synth.ordenInverso();
    renderFilasPlanetas();
  });
  document.getElementById("seq-orden-aleatorio")?.addEventListener("click", () => {
    synth.ordenAleatorio();
    renderFilasPlanetas();
  });
  document.getElementById("seq-orden-region")?.addEventListener("click", () => {
    if (synth.ordenPorRegion(estado.astros)) renderFilasPlanetas();
  });

  // Ritmos: aleatorizar según pesos y unificar en la figura global
  document.getElementById("seq-ritmos-azar")?.addEventListener("click", () => {
    if (synth.aleatorizarFiguras()) actualizarUISintetizador();
  });
  document.getElementById("seq-reset-figuras")?.addEventListener("click", () => {
    synth.restablecerFiguras();
    actualizarUISintetizador();
  });

  renderPesosFiguras();
  inicializarUIRitmos();
}

// Chips de pesos para los ritmos aleatorios: clic cicla el peso de la
// figura (×0..×PESO_FIGURA_MAX). El peso es su frecuencia relativa al
// sortear; ×0 la excluye del sorteo.
function renderPesosFiguras() {
  const cont = document.getElementById("seq-pesos");
  if (!cont) return;
  cont.innerHTML = "";

  FIGURAS_SECUENCIA.forEach(f => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "seq-peso-chip";
    btn.title = `${f.nombre} — clic para cambiar cuánto aparece al aleatorizar`;

    const pintar = () => {
      const peso = synth.pesoFigura(f.id);
      btn.innerHTML = `<span class="seq-peso-fig">${f.corto}</span><span class="seq-peso-num">×${peso}</span>`;
      btn.classList.toggle("peso-cero", peso === 0);
    };

    btn.addEventListener("click", () => {
      synth.setPesoFigura(f.id, (synth.pesoFigura(f.id) + 1) % (PESO_FIGURA_MAX + 1));
      pintar();
    });

    pintar();
    cont.appendChild(btn);
  });
}

// =========================================================
// Ritmos guardados y cadena de ritmos (rhythms.js)
// =========================================================

function inicializarUIRitmos() {
  if (typeof ritmos === "undefined") return;
  ritmos.cargar();

  document.getElementById("ritmo-guardar")?.addEventListener("click", () => {
    ritmos.guardarActual();
    renderRitmosGuardados();
  });

  const usar = document.getElementById("ritmos-usar-cadena");
  if (usar) {
    usar.checked = ritmos.usarCadena;
    usar.addEventListener("change", e => {
      ritmos.setUsarCadena(e.target.checked);
      renderCadenaRitmos();
      actualizarUISintetizador();
    });
  }

  document.getElementById("ritmos-cadena-limpiar")?.addEventListener("click", () => {
    ritmos.limpiarCadena();
    renderCadenaRitmos();
  });

  renderRitmosGuardados();
}

function _figuraCorta(id) {
  const f = FIGURAS_SECUENCIA.find(x => x.id === id);
  return f ? f.corto : "·";
}

function _figuraNombre(id) {
  const f = FIGURAS_SECUENCIA.find(x => x.id === id);
  return f ? f.nombre : "—";
}

// Lista de ritmos guardados: nombre editable, vista previa de las
// figuras en el orden en que se escuchan y las transformaciones
// (invertir, desde la mitad, reducir/aumentar).
function renderRitmosGuardados() {
  const cont = document.getElementById("ritmos-lista");
  if (!cont || typeof ritmos === "undefined") return;
  cont.innerHTML = "";

  if (!ritmos.list.length) {
    cont.innerHTML = `<p class="ritmos-vacio">Sin ritmos guardados. Aleatoriza uno que te guste y púlsale "Guardar ritmo actual".</p>`;
    renderCadenaRitmos();
    return;
  }

  ritmos.list.forEach(r => {
    const item = document.createElement("div");
    item.className = "ritmo-item";
    item.dataset.id = r.id;

    // Las figuras se muestran en el orden guardado: así se lee el
    // ritmo tal como suena (y como lo transforman ↔ y ◑).
    const chips = r.orden.map(a =>
      `<span class="ritmo-fig" title="${NOMBRES_ASTROS[a]}: ${_figuraNombre(r.figuras[a])}">
         <span class="ritmo-fig-astro">${SIMBOLOS_ASTROS[a]}</span>
         <span class="ritmo-fig-simbolo">${_figuraCorta(r.figuras[a])}</span>
       </span>`
    ).join("");

    // Nota MIDI propia del ritmo (como los bancos): funciona aunque el
    // mapeo por rango del parámetro "ritmo" esté en Off.
    const notaTxt = (typeof r.midiNote === "number") ? _notaCortaMIDI(r.midiNote) : "—";
    const esperandoNota = (typeof mapeoMIDI !== "undefined") && mapeoMIDI.capturaRitmo === r.id;

    item.innerHTML = `
      <div class="ritmo-row1">
        <input type="text" class="ritmo-nombre" value="${escaparHTML(r.nombre)}" title="Nombre del ritmo">
        <span class="ritmo-midi-nota" title="Nota MIDI que carga este ritmo">${esperandoNota ? "…" : notaTxt}</span>
        <button type="button" class="ritmo-midi${esperandoNota ? " mapeo-esperando" : ""}" title="Asignar una nota MIDI que cargue este ritmo">🎹</button>
        <button type="button" class="ritmo-midi-quitar" title="Quitar la nota MIDI">✕</button>
        <button type="button" class="ritmo-aplicar" title="Cargar este ritmo en el secuenciador">▸</button>
        <button type="button" class="ritmo-add" title="Añadir un eslabón con este ritmo a la cadena">⊕</button>
      </div>
      <div class="ritmo-figs">${chips}</div>
      <div class="ritmo-row2">
        <button type="button" class="ritmo-invertir" title="Invertir la dirección del ritmo">↔</button>
        <button type="button" class="ritmo-mitad" title="Empezar desde la mitad">◑</button>
        <button type="button" class="ritmo-reducir" title="Reducir: cada figura pasa al siguiente símbolo (más corto)">−</button>
        <button type="button" class="ritmo-aumentar" title="Aumentar: cada figura pasa al símbolo anterior (más largo)">＋</button>
        <button type="button" class="ritmo-duplicar" title="Duplicar (para transformar la copia sin perder el original)">⧉</button>
        <button type="button" class="ritmo-recapturar" title="Reemplazar por el patrón que hay ahora en el secuenciador">📸</button>
        <button type="button" class="ritmo-borrar" title="Eliminar el ritmo (y sus eslabones en la cadena)">🗑</button>
      </div>`;

    const repintar = () => {
      renderRitmosGuardados();
      actualizarUISintetizador();
    };

    item.querySelector(".ritmo-nombre").addEventListener("change", e => {
      ritmos.renombrar(r.id, e.target.value);
      renderCadenaRitmos();
    });
    item.querySelector(".ritmo-aplicar").addEventListener("click", () => {
      ritmos.aplicar(r.id);
      renderFilasPlanetas();  // el orden guardado puede cambiar las filas
      marcarRitmoAplicado();
    });
    item.querySelector(".ritmo-midi").addEventListener("click", async () => {
      if (typeof mapeoMIDI === "undefined") return;
      if (!await asegurarMIDIActivo()) return;
      if (mapeoMIDI.capturaRitmo === r.id) mapeoMIDI.cancelarCaptura();
      else mapeoMIDI.iniciarCapturaRitmo(r.id);
    });
    item.querySelector(".ritmo-midi-quitar").addEventListener("click", () => {
      ritmos.asignarNota(r.id, null);
      renderRitmosGuardados();
    });
    item.querySelector(".ritmo-add").addEventListener("click", () => {
      ritmos.agregarACadena(r.id);
      renderCadenaRitmos();
    });
    item.querySelector(".ritmo-invertir").addEventListener("click", () => {
      ritmos.invertir(r.id);
      repintar();
    });
    item.querySelector(".ritmo-mitad").addEventListener("click", () => {
      ritmos.desdeLaMitad(r.id);
      repintar();
    });
    item.querySelector(".ritmo-reducir").addEventListener("click", () => {
      ritmos.desplazarFiguras(r.id, 1);
      repintar();
    });
    item.querySelector(".ritmo-aumentar").addEventListener("click", () => {
      ritmos.desplazarFiguras(r.id, -1);
      repintar();
    });
    item.querySelector(".ritmo-duplicar").addEventListener("click", () => {
      ritmos.duplicar(r.id);
      renderRitmosGuardados();
    });
    item.querySelector(".ritmo-recapturar").addEventListener("click", () => {
      ritmos.actualizarDesdeActual(r.id);
      renderRitmosGuardados();
    });
    item.querySelector(".ritmo-borrar").addEventListener("click", () => {
      ritmos.eliminar(r.id);
      renderRitmosGuardados();
    });

    cont.appendChild(item);
  });

  marcarRitmoAplicado();
  renderCadenaRitmos();
}

// Cadena: lista libre de eslabones sobre los ritmos guardados. Cada
// eslabón repite su ritmo N vueltas antes de pasar al siguiente.
function renderCadenaRitmos() {
  const cont = document.getElementById("ritmos-cadena");
  if (!cont || typeof ritmos === "undefined") return;
  cont.innerHTML = "";

  const usar = document.getElementById("ritmos-usar-cadena");
  if (usar) usar.checked = ritmos.usarCadena;

  if (!ritmos.cadena.length) {
    cont.innerHTML = `<p class="ritmos-vacio">Cadena vacía: pulsa ⊕ en los ritmos para encadenarlos en el orden que quieras.</p>`;
    return;
  }

  ritmos.cadena.forEach((eslabon, idx) => {
    const r = ritmos.porId(eslabon.ritmoId);
    const fila = document.createElement("div");
    fila.className = "ritmo-eslabon";
    fila.dataset.idx = idx;
    fila.innerHTML = `
      <span class="ritmo-eslabon-num">${idx + 1}</span>
      <span class="ritmo-eslabon-nombre" title="${escaparHTML(r ? r.nombre : "")}">${escaparHTML(r ? r.nombre : "—")}</span>
      <span class="ritmo-vuelta"></span>
      <label class="ritmo-reps-label" title="Vueltas completas del recorrido de astros antes de pasar al siguiente eslabón">×
        <input type="number" class="ritmo-reps" min="${REPETICIONES_MIN}" max="${REPETICIONES_MAX}" step="1" value="${eslabon.repeticiones}">
      </label>
      <button type="button" class="ritmo-eslabon-sube" ${idx === 0 ? "disabled" : ""} title="Subir">↑</button>
      <button type="button" class="ritmo-eslabon-baja" ${idx === ritmos.cadena.length - 1 ? "disabled" : ""} title="Bajar">↓</button>
      <button type="button" class="ritmo-eslabon-quita" title="Quitar de la cadena">✕</button>`;

    fila.querySelector(".ritmo-reps").addEventListener("change", e => {
      ritmos.setRepeticiones(idx, parseInt(e.target.value, 10));
      renderCadenaRitmos();
    });
    fila.querySelector(".ritmo-eslabon-sube").addEventListener("click", () => {
      if (ritmos.moverEnCadena(idx, -1)) renderCadenaRitmos();
    });
    fila.querySelector(".ritmo-eslabon-baja").addEventListener("click", () => {
      if (ritmos.moverEnCadena(idx, 1)) renderCadenaRitmos();
    });
    fila.querySelector(".ritmo-eslabon-quita").addEventListener("click", () => {
      ritmos.quitarDeCadena(idx);
      renderCadenaRitmos();
    });

    cont.appendChild(fila);
  });

  const total = document.createElement("p");
  total.className = "ritmos-total";
  total.textContent = `${ritmos.cadena.length} eslabón(es) · ${ritmos.totalVueltasCadena()} vueltas por ciclo completo`;
  cont.appendChild(total);

  _ritmoSlotUI = -2;  // forzar el repintado del eslabón en curso
  marcarRitmoEnCurso();
}

// Resalta el ritmo que está cargado en el secuenciador: el del eslabón
// en curso si la cadena manda, o el último aplicado a mano (o por MIDI).
function marcarRitmoAplicado() {
  if (typeof ritmos === "undefined") return;
  const actual = ritmos.ritmoEnCurso() || ritmos.porId(ritmos.ultimoAplicadoId);
  document.querySelectorAll(".ritmo-item").forEach(el => {
    el.classList.toggle("ritmo-activo", !!actual && el.dataset.id === actual.id);
  });
}

// Resalta el eslabón que suena y su cuenta de vueltas. Se llama desde
// el draw loop, así que solo toca el DOM cuando algo cambió.
let _ritmoSlotUI = -1;
let _ritmoVueltasUI = -1;

function marcarRitmoEnCurso() {
  if (typeof ritmos === "undefined") return;
  const activa = ritmos.cadenaActiva();
  const slot = activa ? ritmos._slot : -1;
  const vueltas = activa ? ritmos._vueltas : -1;
  if (slot === _ritmoSlotUI && vueltas === _ritmoVueltasUI) return;
  const cambioDeRitmo = slot !== _ritmoSlotUI;
  _ritmoSlotUI = slot;
  _ritmoVueltasUI = vueltas;

  document.querySelectorAll(".ritmo-eslabon").forEach(el => {
    const idx = Number(el.dataset.idx);
    const activo = idx === slot;
    el.classList.toggle("eslabon-activo", activo);
    const badge = el.querySelector(".ritmo-vuelta");
    if (badge) {
      const eslabon = ritmos.cadena[idx];
      badge.textContent = (activo && eslabon) ? `${vueltas + 1}/${eslabon.repeticiones}` : "";
    }
  });

  marcarRitmoAplicado();

  // Al cambiar de eslabón cambian las figuras de todas las filas; si el
  // ritmo trae además otra alineación de astros hay que reconstruirlas.
  if (cambioDeRitmo) {
    const filas = [...document.querySelectorAll(".synth-row")].map(el => Number(el.dataset.planeta));
    if (filas.length === 10 && filas.some((v, i) => v !== synth.ordenSecuencia[i])) {
      renderFilasPlanetas();
    } else {
      actualizarUISintetizador();
    }
  }
}

// =========================================================
// FM estilo Operator: algoritmo, profundidad y esquema de conexión
// =========================================================

function inicializarFM() {
  const sel = document.getElementById("synth-fm-algoritmo");
  if (sel) {
    sel.innerHTML = FM_ALGORITMOS.map(a =>
      `<option value="${a.id}"${a.id === synth.fmAlgoritmo ? " selected" : ""}>${a.nombre}</option>`
    ).join("");
    sel.addEventListener("change", e => {
      if (!synth.ctx) synth.init();
      synth.setFmAlgoritmo(e.target.value);
      actualizarGaleriaFM();
      renderEsquemaFM();
    });
  }

  renderGaleriaFM();

  const prof = document.getElementById("synth-fm-profundidad");
  const profVal = document.getElementById("synth-fm-profundidad-val");
  if (prof) {
    prof.value = synth.fmProfundidad;
    if (profVal) profVal.textContent = synth.fmProfundidad.toFixed(1);
    prof.addEventListener("input", e => {
      const v = parseFloat(e.target.value);
      synth.setFmProfundidad(v);
      if (profVal) profVal.textContent = v.toFixed(1);
    });
  }

  renderEsquemaFM();
}

// =========================================================
// Galería de algoritmos FM: un mini esquemático por combinación
// Paralelo(n) × Serie(n), clic para elegir.
// =========================================================

// Mini esquemático genérico de una partición en cadenas: columnas de
// cuadritos apilados (carrier abajo) sobre la barra de salida.
function miniEsquemaFM(cadenas) {
  const W = 64, H = 72;
  const celda = 6, paso = 6.4;
  const nCols = cadenas.length;
  const x0 = (W - nCols * paso) / 2;
  const yBase = H - 12;

  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect x="${x0}" y="${yBase + 3}" width="${nCols * paso}" height="4" rx="1.5" class="fm-mini-salida"/>`;
  cadenas.forEach((tam, col) => {
    const x = x0 + col * paso + (paso - celda) / 2;
    for (let f = 0; f < tam; f++) {
      const y = yBase - celda - f * paso;
      svg += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${celda}" height="${celda}" rx="1"
        class="${f === 0 ? "fm-mini-carrier" : "fm-mini-mod"}"/>`;
    }
  });
  svg += `</svg>`;
  return svg;
}

function renderGaleriaFM() {
  const cont = document.getElementById("fm-galeria");
  if (!cont) return;

  cont.innerHTML = FM_ALGORITMOS.map(a => `
    <button type="button" class="fm-mini${a.id === synth.fmAlgoritmo ? " activo" : ""}"
            data-id="${a.id}" title="${a.nombre}">
      ${miniEsquemaFM(a.cadenas)}
      <span class="fm-mini-nombre">${a.cadenas.length === 10 ? "∥ 10" : (a.cadenas.length === 1 ? "serie" : a.cadenas.join("+"))}</span>
    </button>
  `).join("");

  cont.querySelectorAll(".fm-mini").forEach(btn => {
    btn.addEventListener("click", () => {
      if (!synth.ctx) synth.init();
      synth.setFmAlgoritmo(btn.dataset.id);
      const sel = document.getElementById("synth-fm-algoritmo");
      if (sel) sel.value = synth.fmAlgoritmo;
      actualizarGaleriaFM();
      renderEsquemaFM();
    });
  });
}

// Solo refresca el resaltado del algoritmo activo
function actualizarGaleriaFM() {
  document.querySelectorAll("#fm-galeria .fm-mini").forEach(btn => {
    btn.classList.toggle("activo", btn.dataset.id === synth.fmAlgoritmo);
  });
}

// Cache para no reconstruir el SVG si nada cambió
let _esquemaFMCache = "";

// Dibuja el esquema de conexión del algoritmo FM activo:
// los moduladores apilados arriba de su carrier, los carriers
// conectados a la barra de salida (como el Operator de Ableton).
function renderEsquemaFM() {
  const cont = document.getElementById("fm-esquema");
  if (!cont) return;

  const clave = synth.fmAlgoritmo + "|" + synth.planetEnabled.join(",") +
    "|" + synth.ordenSecuencia.join(",");
  if (clave === _esquemaFMCache) return;
  _esquemaFMCache = clave;

  const { carriers, mods } = synth.rutasFM();

  // Construir cadenas: para cada carrier, la pila de moduladores encima
  const moduladorDe = {};  // a → de (quién modula a quién)
  mods.forEach(m => { moduladorDe[m.a] = m.de; });

  const cadenas = [...carriers].sort((a, b) => a - b).map(c => {
    const cadena = [c];
    let actual = c;
    while (moduladorDe[actual] !== undefined) {
      actual = moduladorDe[actual];
      cadena.push(actual);
    }
    return cadena;  // [carrier, mod1, mod2, ...] de abajo hacia arriba
  });

  const numCols = cadenas.length;
  const maxAltura = Math.max(...cadenas.map(c => c.length));
  const nodo = 30, gapX = 10, gapY = 14;
  const w = numCols * (nodo + gapX) + gapX;
  const filaSalida = 26;
  const h = maxAltura * (nodo + gapY) + gapY + filaSalida;

  const xCol = c => gapX + c * (nodo + gapX) + nodo / 2;
  const yFila = f => h - filaSalida - gapY - nodo / 2 - f * (nodo + gapY);

  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" class="fm-svg">`;

  // Barra de salida
  svg += `<rect x="${gapX}" y="${h - filaSalida + 6}" width="${w - gapX * 2}" height="14" rx="3" fill="#3c5e9e" opacity="0.85"/>`;
  svg += `<text x="${w / 2}" y="${h - filaSalida + 16}" text-anchor="middle" font-size="9" fill="#fff">SALIDA</text>`;

  // Posiciones de cada nodo (para dibujarlos encima y para el drag&drop)
  const posiciones = [];

  cadenas.forEach((cadena, col) => {
    const x = xCol(col);

    // Línea del carrier a la salida
    svg += `<line x1="${x}" y1="${yFila(0) + nodo / 2}" x2="${x}" y2="${h - filaSalida + 6}" stroke="#888" stroke-width="1.5"/>`;

    cadena.forEach((astro, fila) => {
      const y = yFila(fila);

      // Flecha modulador → modulado
      if (fila > 0) {
        const yDestino = yFila(fila - 1);
        svg += `<line x1="${x}" y1="${y + nodo / 2}" x2="${x}" y2="${yDestino - nodo / 2}" stroke="#c08a2e" stroke-width="1.5" marker-end="url(#flecha)"/>`;
      }

      posiciones.push({ astro, x, y });
    });
  });

  // Nodos al final para que queden encima de líneas y flechas
  posiciones.forEach(({ astro, x, y }) => {
    const activo = synth.planetEnabled[astro];
    const colorAstro = (THEME.astros && THEME.astros.coloresPorAstro && THEME.astros.coloresPorAstro[astro])
      ? THEME.astros.coloresPorAstro[astro]
      : COLORES_ASTROS_DEFAULT[astro];

    svg += `<g class="fm-nodo" data-astro="${astro}" transform="translate(${x},${y})">
      <rect x="${-nodo / 2}" y="${-nodo / 2}" width="${nodo}" height="${nodo}" rx="5"
            fill="${colorAstro}" opacity="${activo ? 0.95 : 0.28}" stroke="${activo ? "#222" : "none"}" stroke-width="1"/>
      <text x="0" y="4" text-anchor="middle" font-size="13" fill="#fff">${SIMBOLOS_ASTROS[astro]}</text>
    </g>`;
  });

  svg += `<defs><marker id="flecha" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6 z" fill="#c08a2e"/>
          </marker></defs>`;
  svg += `</svg>`;

  const esParalelo = synth.fmAlgoritmo === "paralelo";
  cont.innerHTML = svg + `<p class="fm-leyenda">${
    esParalelo
      ? "Todos los astros suenan en paralelo (síntesis aditiva)."
      : "Los astros superiores modulan (FM) a los de abajo; solo los carriers llegan a la salida."
  } Arrastra un símbolo sobre otro astro para reubicarlo en las cadenas.</p>`;

  conectarDragEsquemaFM(cont, posiciones, w, h, nodo);
}

// Drag & drop en el esquema FM: arrastrar un astro y soltarlo sobre
// otro lo mueve a esa posición de las cadenas (mismo efecto que
// arrastrar su fila: cambia ordenSecuencia y por tanto el ruteo).
function conectarDragEsquemaFM(cont, posiciones, w, h, nodo) {
  const svgEl = cont.querySelector("svg");
  if (!svgEl) return;

  const aViewBox = ev => {
    const rect = svgEl.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (w / rect.width),
      y: (ev.clientY - rect.top) * (h / rect.height)
    };
  };

  // Astro cuyo nodo está más cerca del puntero (dentro de un radio)
  const destinoEn = (p, excepto) => {
    let mejor = null;
    let mejorDist = nodo * 1.1;
    for (const pos of posiciones) {
      if (pos.astro === excepto) continue;
      const d = Math.hypot(p.x - pos.x, p.y - pos.y);
      if (d < mejorDist) { mejorDist = d; mejor = pos.astro; }
    }
    return mejor;
  };

  const marcarDestino = dest => {
    svgEl.querySelectorAll(".fm-nodo").forEach(n =>
      n.classList.toggle("fm-nodo-destino", dest !== null && parseInt(n.dataset.astro, 10) === dest));
  };

  svgEl.querySelectorAll(".fm-nodo").forEach(nodoEl => {
    nodoEl.addEventListener("pointerdown", ev => {
      ev.preventDefault();
      const astroDe = parseInt(nodoEl.dataset.astro, 10);
      const orig = posiciones.find(p => p.astro === astroDe);
      svgEl.appendChild(nodoEl);  // encima de todo durante el arrastre
      nodoEl.classList.add("fm-nodo-arrastrando");

      const mover = e2 => {
        const p = aViewBox(e2);
        nodoEl.setAttribute("transform", `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`);
        marcarDestino(destinoEn(p, astroDe));
      };
      const soltar = e2 => {
        window.removeEventListener("pointermove", mover);
        window.removeEventListener("pointerup", soltar);
        const dest = destinoEn(aViewBox(e2), astroDe);
        nodoEl.setAttribute("transform", `translate(${orig.x},${orig.y})`);
        nodoEl.classList.remove("fm-nodo-arrastrando");
        marcarDestino(null);
        if (dest !== null && synth.moverEnOrden(astroDe, dest)) {
          renderFilasPlanetas();  // el orden cambió: filas + esquema
        }
      };
      window.addEventListener("pointermove", mover);
      window.addEventListener("pointerup", soltar);
    });
  });
}

// =========================================================
// Armónicos pares/impares (forma de onda personalizada)
// =========================================================

function inicializarArmonicos() {
  const sel = document.getElementById("arm-astro");
  const pares = document.getElementById("arm-pares");
  const impares = document.getElementById("arm-impares");
  const paresVal = document.getElementById("arm-pares-val");
  const imparesVal = document.getElementById("arm-impares-val");
  const grafica = document.getElementById("arm-grafica");
  if (!sel || !pares || !impares) return;

  sel.innerHTML = NOMBRES_ASTROS.slice(0, 10).map((n, i) =>
    `<option value="${i}">${SIMBOLOS_ASTROS[i]} ${n}</option>`
  ).join("");

  // Geometría de la gráfica (coordenadas del viewBox)
  const W = 380, H = 100, PAD = 10, BASE = H - 16;
  const anchoSlot = (W - PAD * 2) / NUM_ARMONICOS;
  const COLOR_FUND = "#888888", COLOR_PAR = "#3c5e9e", COLOR_IMPAR = "#2b8a3e";

  // Amplitud del armónico n como la usa el synth: fundamental = 1,
  // n >= 2 → peso/n. Escala sqrt para que los agudos sean visibles.
  const amplitudDe = (i, n) => {
    if (n === 1) return 1;
    const peso = (n % 2 === 0) ? synth.armonicosPares[i] : synth.armonicosImpares[i];
    return peso / n;
  };

  function renderGrafica() {
    if (!grafica) return;
    const i = parseInt(sel.value, 10);
    let barras = "";
    for (let n = 1; n <= NUM_ARMONICOS; n++) {
      const alto = Math.sqrt(amplitudDe(i, n)) * (BASE - PAD);
      const x = PAD + (n - 1) * anchoSlot;
      const color = (n === 1) ? COLOR_FUND : (n % 2 === 0 ? COLOR_PAR : COLOR_IMPAR);
      barras += `<rect class="arm-barra" data-n="${n}" x="${(x + anchoSlot * 0.12).toFixed(1)}" y="${(BASE - alto).toFixed(1)}"
        width="${(anchoSlot * 0.76).toFixed(1)}" height="${Math.max(alto, 1.5).toFixed(1)}" rx="1.5" fill="${color}"/>`;
      if (n === 1 || n % 4 === 0) {
        barras += `<text x="${(x + anchoSlot / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" class="arm-eje">${n}</text>`;
      }
    }
    grafica.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" class="arm-svg">
        <line x1="${PAD}" y1="${BASE}" x2="${W - PAD}" y2="${BASE}" stroke="#ccc" stroke-width="1"/>
        ${barras}
        <g class="arm-leyenda-svg">
          <rect x="${W - 118}" y="${PAD - 4}" width="8" height="8" fill="${COLOR_PAR}"/>
          <text x="${W - 106}" y="${PAD + 3}" class="arm-eje">pares</text>
          <rect x="${W - 64}" y="${PAD - 4}" width="8" height="8" fill="${COLOR_IMPAR}"/>
          <text x="${W - 52}" y="${PAD + 3}" class="arm-eje">impares</text>
        </g>
      </svg>`;
  }

  const sincronizar = () => {
    const i = parseInt(sel.value, 10);
    pares.value = synth.armonicosPares[i];
    impares.value = synth.armonicosImpares[i];
    if (paresVal) paresVal.textContent = Math.round(synth.armonicosPares[i] * 100) + "%";
    if (imparesVal) imparesVal.textContent = Math.round(synth.armonicosImpares[i] * 100) + "%";
    renderGrafica();
  };

  const aplicar = () => {
    const i = parseInt(sel.value, 10);
    if (!synth.ctx) synth.init();
    synth.setArmonicos(i, parseFloat(pares.value), parseFloat(impares.value));
    // Editar armónicos cambia la forma del astro a "Personalizada"
    if (synth.formaOnda[i] !== "custom") {
      synth.setFormaOnda(i, "custom");
      const selOnda = document.getElementById(`synth-onda-${i}`);
      if (selOnda) selOnda.value = "custom";
    }
    if (paresVal) paresVal.textContent = Math.round(parseFloat(pares.value) * 100) + "%";
    if (imparesVal) imparesVal.textContent = Math.round(parseFloat(impares.value) * 100) + "%";
    renderGrafica();
  };

  // Arrastrar una barra ajusta el peso de su grupo (par o impar);
  // la fundamental (n=1) es fija.
  if (grafica) {
    const aplicarDesdePuntero = ev => {
      const svg = grafica.querySelector("svg");
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const px = (ev.clientX - rect.left) * (W / rect.width);
      const py = (ev.clientY - rect.top) * (H / rect.height);
      const n = clamp(Math.floor((px - PAD) / anchoSlot) + 1, 1, NUM_ARMONICOS);
      if (n === 1) return;
      // Invertir la escala: altura → amplitud (sqrt) → peso = amp × n
      const frac = clamp((BASE - py) / (BASE - PAD), 0, 1);
      const peso = clamp(frac * frac * n, 0, 1);
      if (n % 2 === 0) pares.value = peso;
      else impares.value = peso;
      aplicar();
    };
    grafica.addEventListener("pointerdown", ev => {
      ev.preventDefault();
      grafica.setPointerCapture(ev.pointerId);
      aplicarDesdePuntero(ev);
      const mover = e2 => aplicarDesdePuntero(e2);
      const soltar = () => {
        grafica.removeEventListener("pointermove", mover);
        grafica.removeEventListener("pointerup", soltar);
      };
      grafica.addEventListener("pointermove", mover);
      grafica.addEventListener("pointerup", soltar);
    });
  }

  sel.addEventListener("change", sincronizar);
  pares.addEventListener("input", aplicar);
  impares.addEventListener("input", aplicar);
  sincronizar();
}

function renderFilasPlanetas() {
  const cont = document.getElementById("synth-planets");
  if (!cont) return;

  // Las filas siempre siguen el orden de los astros: ese orden define
  // la secuencia, el mapeo MIDI (C4 = primera fila) y las cadenas FM.
  const orden = synth.ordenSecuencia.slice();

  cont.innerHTML = "";

  orden.forEach((i, pos) => {
    const fila = document.createElement("div");
    fila.className = "synth-row";
    fila.dataset.planeta = i;

    const opcionesOctava = [];
    for (let o = -4; o <= 4; o++) {
      const label = (o > 0 ? "+" + o : "" + o);
      const sel = (o === synth.octavaPorPlaneta[i]) ? " selected" : "";
      opcionesOctava.push(`<option value="${o}"${sel}>${label}</option>`);
    }

    const esPrimero = pos === 0;
    const esUltimo = pos === orden.length - 1;

    const opcionesOnda = FORMAS_ONDA.map(f =>
      `<option value="${f.id}"${f.id === synth.formaOnda[i] ? " selected" : ""}>${f.nombre}</option>`
    ).join("");

    // Figura rítmica propia (solo modo secuencia); vacío = figura global
    const opcionesFigura = `<option value=""${!synth.figuraPorAstro[i] ? " selected" : ""}>=</option>` +
      FIGURAS_SECUENCIA.map(f =>
        `<option value="${f.id}"${f.id === synth.figuraPorAstro[i] ? " selected" : ""}>${f.corto}</option>`
      ).join("");

    fila.id = `synth-row-${i}`;
    fila.innerHTML = `
      <div class="synth-row-arrows">
        <button type="button" class="row-up" ${esPrimero ? "disabled" : ""} title="Subir en orden">↑</button>
        <button type="button" class="row-down" ${esUltimo ? "disabled" : ""} title="Bajar en orden">↓</button>
      </div>
      <label class="synth-toggle">
        <input type="checkbox" id="synth-pl-${i}">
        <span class="synth-name" draggable="true" title="Arrastra para reordenar (secuencia, MIDI y cadena FM)">${SIMBOLOS_ASTROS[i]} ${NOMBRES_ASTROS[i]}</span>
      </label>
      <select class="synth-octave" id="synth-oct-${i}" title="Octava de ${NOMBRES_ASTROS[i]}">
        ${opcionesOctava.join("")}
      </select>
      <select class="synth-onda" id="synth-onda-${i}" title="Forma de onda de ${NOMBRES_ASTROS[i]}">
        ${opcionesOnda}
      </select>
      <input type="range" class="synth-vol" id="synth-vol-${i}" min="0" max="1" step="0.01"
             value="${synth.planetVolume[i]}" title="Volumen de ${NOMBRES_ASTROS[i]}">
      <button type="button" class="synth-trigger-btn" id="synth-trig-${i}" title="Mantener para tocar (envelope)">▶</button>
      <select class="synth-fig-col synth-figura-astro" id="synth-fig-${i}"
              title="Figura rítmica de ${NOMBRES_ASTROS[i]} en la secuencia (= usa la figura global)">
        ${opcionesFigura}
      </select>
      <span class="synth-note" id="synth-note-${i}">—</span>
    `;
    cont.appendChild(fila);

    // Checkbox de activación
    fila.querySelector(`#synth-pl-${i}`).addEventListener("change", e => {
      if (!synth.ctx) synth.init();
      if (!synth.enabled) {
        synth.enable();
        synth.updateFromAstros(estado.astros);
      }
      synth.setPlanetEnabled(i, e.target.checked);
      document.getElementById("synth-enabled").checked = synth.enabled;
      actualizarUISintetizador();
    });

    // Selector de octava
    fila.querySelector(`#synth-oct-${i}`).addEventListener("change", e => {
      if (!synth.ctx) synth.init();
      synth.setOctavaPlaneta(i, parseInt(e.target.value, 10));
      actualizarUISintetizador();
    });

    // Selector de forma de onda
    fila.querySelector(`#synth-onda-${i}`).addEventListener("change", e => {
      if (!synth.ctx) synth.init();
      synth.setFormaOnda(i, e.target.value);
    });

    // Volumen individual
    fila.querySelector(`#synth-vol-${i}`).addEventListener("input", e => {
      if (!synth.ctx) synth.init();
      synth.setPlanetVolume(i, parseFloat(e.target.value));
    });

    // Figura rítmica propia en la secuencia
    fila.querySelector(`#synth-fig-${i}`).addEventListener("change", e => {
      synth.setFiguraAstro(i, e.target.value || null);
    });

    // Botón de trigger momentáneo (dispara el grupo FM completo)
    const btn = fila.querySelector(`#synth-trig-${i}`);
    const onPress = (ev) => {
      ev.preventDefault();
      if (!synth.ctx) synth.init();
      if (!synth.enabled) { synth.enable(); synth.updateFromAstros(estado.astros); }
      document.getElementById("synth-enabled").checked = true;
      synth.triggerAttackGrupo(i);
      btn.classList.add("active");
    };
    const onRelease = (ev) => {
      ev.preventDefault();
      synth.triggerReleaseGrupo(i);
      btn.classList.remove("active");
    };
    btn.addEventListener("mousedown",  onPress);
    btn.addEventListener("mouseup",    onRelease);
    btn.addEventListener("mouseleave", onRelease);
    btn.addEventListener("touchstart", onPress, { passive: false });
    btn.addEventListener("touchend",   onRelease);

    // Botones ↑ ↓
    fila.querySelector(".row-up")?.addEventListener("click", () => {
      if (synth.subirEnOrden(i)) renderFilasPlanetas();
    });
    fila.querySelector(".row-down")?.addEventListener("click", () => {
      if (synth.bajarEnOrden(i)) renderFilasPlanetas();
    });

    // Drag & drop para reordenar (el nombre del astro es el asa)
    const asa = fila.querySelector(".synth-name");
    asa.addEventListener("dragstart", e => {
      e.dataTransfer.setData("text/plain", String(i));
      e.dataTransfer.effectAllowed = "move";
      fila.classList.add("arrastrando");
    });
    asa.addEventListener("dragend", () => fila.classList.remove("arrastrando"));
    fila.addEventListener("dragover", e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      fila.classList.add("drop-destino");
    });
    fila.addEventListener("dragleave", () => fila.classList.remove("drop-destino"));
    fila.addEventListener("drop", e => {
      e.preventDefault();
      fila.classList.remove("drop-destino");
      const astroDe = parseInt(e.dataTransfer.getData("text/plain"), 10);
      if (Number.isNaN(astroDe)) return;
      if (synth.moverEnOrden(astroDe, i)) renderFilasPlanetas();
    });
  });

  actualizarUISintetizador();
}

// Anima las filas del synth: la fila del astro que está sonando se
// remarca (naranja en secuencia/envelope, verde en drone). Se llama
// desde el draw loop para que el resaltado siga la secuencia en vivo.
function actualizarFilasSonando() {
  if (typeof astroSonando !== "function" || typeof synth === "undefined") return;
  for (let i = 0; i < 10; i++) {
    const fila = document.getElementById(`synth-row-${i}`);
    if (!fila) continue;
    const suena = astroSonando(i);
    const momentaneo = suena && (synth.envelopeActiva[i] || synth.sonandoEnSecuencia(i));
    fila.classList.toggle("sonando", momentaneo);
    fila.classList.toggle("sonando-drone", suena && !momentaneo);
  }
}

function actualizarUISintetizador() {
  // Región tonal de cada astro: los que comparten región se pintan
  // con el color de esa región (los demás solo llevan la franja lateral)
  const regiones = new Array(10).fill(-1);
  const conteoRegion = {};
  if (typeof estado !== "undefined" && estado.astros.length >= 10) {
    for (let i = 0; i < 10; i++) {
      regiones[i] = synth.microtonoDeAstro(i, estado.astros);
      if (regiones[i] >= 0) conteoRegion[regiones[i]] = (conteoRegion[regiones[i]] || 0) + 1;
    }
  }

  for (let i = 0; i < 10; i++) {
    const chk = document.getElementById(`synth-pl-${i}`);
    if (chk) chk.checked = synth.planetEnabled[i];

    const oct = document.getElementById(`synth-oct-${i}`);
    if (oct) oct.value = synth.octavaPorPlaneta[i];

    const onda = document.getElementById(`synth-onda-${i}`);
    if (onda) onda.value = synth.formaOnda[i];

    const vol = document.getElementById(`synth-vol-${i}`);
    if (vol && document.activeElement !== vol) vol.value = synth.planetVolume[i];

    const fig = document.getElementById(`synth-fig-${i}`);
    if (fig) fig.value = synth.figuraPorAstro[i] || "";

    const nota = document.getElementById(`synth-note-${i}`);
    if (nota) nota.textContent = synth.nombreNota(i);

    const fila = document.getElementById(`synth-row-${i}`);
    if (fila && regiones[i] >= 0 && typeof colorRegionMicrotono === "function") {
      const [r, g, b] = colorRegionMicrotono(regiones[i]);
      fila.style.borderLeft = `5px solid rgb(${r},${g},${b})`;
      // Astros cercanos (misma región tonal) toman el color de la región
      fila.style.background = (conteoRegion[regiones[i]] > 1)
        ? `rgba(${r},${g},${b},0.22)`
        : "";
    }
  }

  // Esquema FM (solo se reconstruye si cambió algo)
  if (typeof renderEsquemaFM === "function") renderEsquemaFM();

  const t = document.getElementById("synth-enabled");
  if (t) t.checked = synth.enabled;

  document.querySelectorAll('input[name="synth-mode"]').forEach(r => {
    r.checked = (r.value === synth.modo);
  });
  document.querySelectorAll('input[name="synth-trigger-mode"]').forEach(r => {
    r.checked = (r.value === synth.modoTrigger);
  });
  document.querySelectorAll('input[name="synth-playback-mode"]').forEach(r => {
    r.checked = (r.value === synth.modoReproduccion);
  });

  // Botones del secuenciador
  const btnPlay = document.getElementById("seq-play");
  const btnStop = document.getElementById("seq-stop");
  if (btnPlay) btnPlay.classList.toggle("seq-running", synth.secuenciaActiva);
  if (btnStop) btnStop.disabled = !synth.secuenciaActiva;

  // El chip del mapeo de Transporte muestra el estado real del
  // secuenciador, así que también se mueve al dar Play desde el panel
  if (typeof actualizarValoresMapeoMIDI === "function") actualizarValoresMapeoMIDI();
}

// =========================================================
// UI de bancos de fechas
// =========================================================

function inicializarUIBancos() {
  document.getElementById("bank-add")?.addEventListener("click", () => {
    banks.crearDesdeEstadoActual();
    renderListaBancos();
  });
  document.getElementById("bank-export")?.addEventListener("click", () => {
    const json = banks.exportarJSON();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const fecha = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `cas-banks-${fecha}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  document.getElementById("bank-toggle-ocultos")?.addEventListener("click", () => {
    banks.ui.mostrarOcultos = !banks.ui.mostrarOcultos;
    banks.guardarUI();
    renderListaBancos();
  });
  const inputImport = document.getElementById("bank-import-file");
  document.getElementById("bank-import")?.addEventListener("click", () => inputImport?.click());
  inputImport?.addEventListener("change", e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      if (banks.importarJSON(ev.target.result)) {
        renderListaBancos();
      } else {
        alert("Archivo de bancos inválido.");
      }
    };
    reader.readAsText(file);
  });

  renderListaBancos();
}

function renderListaBancos() {
  const cont = document.getElementById("bank-list");
  if (!cont) return;

  // El botón del toolbar refleja si se están mostrando los ocultos
  const btnOcultos = document.getElementById("bank-toggle-ocultos");
  if (btnOcultos) {
    btnOcultos.classList.toggle("activo", banks.ui.mostrarOcultos);
    const numOcultos = banks.list.filter(b => b.oculto).length;
    btnOcultos.textContent = banks.ui.mostrarOcultos ? "👁 Ocultos ✓" : `👁 Ocultos${numOcultos ? ` (${numOcultos})` : ""}`;
  }

  if (banks.list.length === 0) {
    cont.innerHTML = `<p class="bank-empty">Sin bancos. Crea uno con el botón <strong>+</strong>.</p>`;
    return;
  }

  const tarjetaBanco = b => {
    const activo = (banks.activeId === b.id) ? " bank-active" : "";
    const capturando = (MIDI.capturaPendiente === b.id) ? " bank-capturing" : "";
    const midiTxt = (typeof b.midiNote === "number") ? MIDI.nombreNotaMIDI(b.midiNote) : "—";

    const overrides = [];
    if (Array.isArray(b.octavasOverride)) overrides.push("oct");
    if (typeof b.numMicrotonosOverride === "number") overrides.push("μ" + b.numMicrotonosOverride);
    if (typeof b.modoQuintasOverride === "boolean") overrides.push(b.modoQuintasOverride ? "5tas" : "crom");
    if (typeof b.notaRaizOverride === "number") overrides.push("raíz " + NOTAS_BASE[b.notaRaizOverride]);
    if (typeof b.intervaloOverride === "number") {
      const iv = INTERVALOS_ORDEN.find(x => x.semitonos === b.intervaloOverride);
      if (iv) overrides.push(iv.id);
    }
    if (b.modoReproduccionOverride === "secuencia") overrides.push("sec");
    else if (b.modoReproduccionOverride === "acorde") overrides.push("acord");
    if (typeof b.bpmOverride === "number" && b.modoReproduccionOverride === "secuencia") {
      overrides.push(b.bpmOverride + "bpm");
    }
    if (Array.isArray(b.figuraPorAstroOverride) && b.figuraPorAstroOverride.some(v => v)) {
      overrides.push("fig");
    }

    return `
      <div class="bank-item${activo}${capturando}${b.oculto ? " bank-oculto" : ""}" data-id="${b.id}">
        <div class="bank-row1">
          <input type="text" class="bank-name" value="${escaparHTML(b.name)}" data-id="${b.id}">
          <input type="text" class="bank-grupo-input" placeholder="grupo" value="${escaparHTML(b.grupo || "")}"
                 data-id="${b.id}" title="Grupo del banco (vacío = agrupar por fecha)">
          <button type="button" class="bank-fire" data-id="${b.id}" title="Disparar banco">▶</button>
        </div>
        <div class="bank-row2">
          <input type="datetime-local" class="bank-fecha" value="${b.fechaISO.slice(0, 16)}" step="60" data-id="${b.id}">
        </div>
        <div class="bank-row3">
          <input type="text" class="bank-ubic" placeholder="ubicación" value="${escaparHTML(b.ubicacion || "")}" data-id="${b.id}">
          <input type="number" class="bank-lat" step="0.0001" value="${b.latitud}" data-id="${b.id}" title="Latitud">
          <input type="number" class="bank-lon" step="0.0001" value="${b.longitud}" data-id="${b.id}" title="Longitud">
          <input type="number" class="bank-zona" step="0.5" value="${b.zonaUTC}" data-id="${b.id}" title="Zona UTC">
        </div>
        <div class="bank-row4">
          <span class="bank-tag">MIDI: ${midiTxt}</span>
          <button type="button" class="bank-midi-assign" data-id="${b.id}">${MIDI.capturaPendiente === b.id ? "Esperando..." : "Asignar"}</button>
          <button type="button" class="bank-midi-clear" data-id="${b.id}" title="Quitar nota MIDI">✕</button>
          ${overrides.length ? `<span class="bank-tag bank-tag-override">${overrides.join(" · ")}</span>` : ""}
          <button type="button" class="bank-snap" data-id="${b.id}" title="Capturar config actual (octavas, microtonos, modo, secuenciador) como override de este banco">📸</button>
          <button type="button" class="bank-clear-override" data-id="${b.id}" title="Quitar overrides">∅</button>
          <button type="button" class="bank-dup" data-id="${b.id}" title="Duplicar">⎘</button>
          <button type="button" class="bank-hide" data-id="${b.id}" title="${b.oculto ? "Mostrar banco" : "Ocultar banco"}">${b.oculto ? "👁" : "🙈"}</button>
          <button type="button" class="bank-del" data-id="${b.id}" title="Borrar">🗑</button>
        </div>
      </div>
    `;
  };

  // Agrupar: por nombre de grupo, o por fecha los que no tienen grupo.
  // Los grupos aparecen en el orden de su primer banco en la lista.
  const grupos = [];
  const porClave = {};
  for (const b of banks.list) {
    if (b.oculto && !banks.ui.mostrarOcultos) continue;
    const clave = banks.claveGrupo(b);
    if (!porClave[clave]) {
      porClave[clave] = { clave, items: [] };
      grupos.push(porClave[clave]);
    }
    porClave[clave].items.push(b);
  }

  if (grupos.length === 0) {
    cont.innerHTML = `<p class="bank-empty">Todos los bancos están ocultos (${banks.list.length}). Usa <strong>👁 Ocultos</strong> para verlos.</p>`;
    return;
  }

  cont.innerHTML = grupos.map(g => {
    const esFecha = g.clave.startsWith("f:");
    const etiqueta = esFecha ? "📅 " + g.clave.slice(2) : "🗂 " + escaparHTML(g.clave.slice(2));
    const abierto = !banks.ui.colapsados[g.clave];
    return `
      <details class="bank-grupo" data-clave="${escaparHTML(g.clave)}"${abierto ? " open" : ""}>
        <summary class="bank-grupo-titulo">${etiqueta} <span class="bank-grupo-num">${g.items.length}</span></summary>
        <div class="bank-grupo-items">${g.items.map(tarjetaBanco).join("")}</div>
      </details>
    `;
  }).join("");

  // Compactar/expandir grupos (estado persistido)
  cont.querySelectorAll(".bank-grupo").forEach(el => {
    el.addEventListener("toggle", () => {
      banks.ui.colapsados[el.dataset.clave] = !el.open;
      banks.guardarUI();
    });
  });
  cont.querySelectorAll(".bank-grupo-input").forEach(el => {
    el.addEventListener("change", () => {
      banks.actualizar(el.dataset.id, { grupo: el.value.trim() || null });
      renderListaBancos();
    });
  });
  cont.querySelectorAll(".bank-hide").forEach(el => {
    el.addEventListener("click", () => {
      const b = banks.obtener(el.dataset.id);
      if (!b) return;
      banks.actualizar(b.id, { oculto: !b.oculto });
      renderListaBancos();
    });
  });

  cont.querySelectorAll(".bank-fire").forEach(el => {
    el.addEventListener("click", () => banks.disparar(el.dataset.id));
  });
  cont.querySelectorAll(".bank-del").forEach(el => {
    el.addEventListener("click", () => {
      if (confirm("¿Borrar este banco?")) {
        banks.borrar(el.dataset.id);
        renderListaBancos();
      }
    });
  });
  cont.querySelectorAll(".bank-dup").forEach(el => {
    el.addEventListener("click", () => {
      banks.duplicar(el.dataset.id);
      renderListaBancos();
    });
  });
  cont.querySelectorAll(".bank-name").forEach(el => {
    el.addEventListener("change", () => banks.actualizar(el.dataset.id, { name: el.value }));
  });
  cont.querySelectorAll(".bank-fecha").forEach(el => {
    el.addEventListener("change", () => {
      const v = el.value.length === 16 ? el.value + ":00" : el.value;
      banks.actualizar(el.dataset.id, { fechaISO: v });
    });
  });
  cont.querySelectorAll(".bank-ubic").forEach(el => {
    el.addEventListener("change", () => banks.actualizar(el.dataset.id, { ubicacion: el.value }));
  });
  cont.querySelectorAll(".bank-lat").forEach(el => {
    el.addEventListener("change", () => banks.actualizar(el.dataset.id, { latitud: parseFloat(el.value) }));
  });
  cont.querySelectorAll(".bank-lon").forEach(el => {
    el.addEventListener("change", () => banks.actualizar(el.dataset.id, { longitud: parseFloat(el.value) }));
  });
  cont.querySelectorAll(".bank-zona").forEach(el => {
    el.addEventListener("change", () => banks.actualizar(el.dataset.id, { zonaUTC: parseFloat(el.value) }));
  });
  cont.querySelectorAll(".bank-midi-assign").forEach(el => {
    el.addEventListener("click", async () => {
      if (!MIDI.enabled) {
        const ok = await MIDI.enable();
        if (!ok) {
          alert("No se pudo activar MIDI. Necesitas un navegador compatible (Chrome/Edge/Opera) y MIDI permitido.");
          return;
        }
      }
      if (MIDI.capturaPendiente === el.dataset.id) {
        MIDI.cancelarCaptura();
      } else {
        MIDI.iniciarCapturaParaBanco(el.dataset.id);
      }
      renderListaBancos();
    });
  });
  cont.querySelectorAll(".bank-midi-clear").forEach(el => {
    el.addEventListener("click", () => {
      banks.actualizar(el.dataset.id, { midiNote: null });
      renderListaBancos();
    });
  });
  cont.querySelectorAll(".bank-snap").forEach(el => {
    el.addEventListener("click", () => {
      banks.actualizar(el.dataset.id, {
        octavasOverride: synth.octavaPorPlaneta.slice(),
        numMicrotonosOverride: numMicrotonos,
        notaRaizOverride: notaRaiz,
        intervaloOverride: intervaloOrden,
        modoReproduccionOverride: synth.modoReproduccion,
        ordenSecuenciaOverride: synth.ordenSecuencia.slice(),
        bpmOverride: synth.bpm,
        gateOverride: synth.gate,
        planetEnabledOverride: synth.planetEnabled.slice(),
        figuraPorAstroOverride: synth.figuraPorAstro.slice()
      });
      renderListaBancos();
    });
  });
  cont.querySelectorAll(".bank-clear-override").forEach(el => {
    el.addEventListener("click", () => {
      banks.actualizar(el.dataset.id, {
        octavasOverride: null,
        numMicrotonosOverride: null,
        modoQuintasOverride: null,
        notaRaizOverride: null,
        intervaloOverride: null,
        modoReproduccionOverride: null,
        ordenSecuenciaOverride: null,
        bpmOverride: null,
        gateOverride: null,
        planetEnabledOverride: null,
        figuraPorAstroOverride: null
      });
      renderListaBancos();
    });
  });
}

// =========================================================
// UI de MIDI
// =========================================================

function inicializarUIMIDI() {
  const btn = document.getElementById("midi-enable");
  if (btn) {
    btn.addEventListener("click", async () => {
      if (MIDI.enabled) {
        MIDI.disable();
      } else {
        const ok = await MIDI.enable();
        if (!ok) alert("No se pudo activar MIDI. Verifica que el navegador soporte Web MIDI y que haya dispositivos conectados.");
      }
      renderEstadoMIDI();
    });
  }
  // Mapeo de astros a C4-A4 (notas MIDI 60-69)
  const chkAstros = document.getElementById("midi-astros");
  if (chkAstros) {
    chkAstros.checked = synth.midiAstros;
    chkAstros.addEventListener("change", e => synth.setMidiAstros(e.target.checked));
  }

  MIDI.onChange = () => { renderEstadoMIDI(); renderMapeosMIDI(); };
  renderEstadoMIDI();
  inicializarUIMapeosMIDI();
}

function renderEstadoMIDI() {
  const status = document.getElementById("midi-status");
  const btn = document.getElementById("midi-enable");
  const lista = document.getElementById("midi-devices");

  if (status) {
    status.textContent = MIDI.enabled ? "Activo" : "Inactivo";
    status.className = "midi-status " + (MIDI.enabled ? "midi-on" : "midi-off");
  }
  if (btn) btn.textContent = MIDI.enabled ? "Desactivar MIDI" : "Activar MIDI";
  if (lista) {
    if (!MIDI.enabled) {
      lista.innerHTML = "";
    } else if (MIDI.inputs.length === 0) {
      lista.innerHTML = `<p class="midi-empty">Sin dispositivos detectados.</p>`;
    } else {
      lista.innerHTML = MIDI.inputs.map(d =>
        `<div class="midi-device">• ${escaparHTML(d.name)}${d.manufacturer ? ` <small>(${escaparHTML(d.manufacturer)})</small>` : ""}</div>`
      ).join("");
    }
  }
}

// =========================================================
// UI de mapeos MIDI de parámetros (midi-map.js)
// =========================================================
//
// Una tarjeta por parámetro mapeable (nota raíz, orden por intervalo,
// ritmos guardados) con su modo (Off / rango de notas / CC), el botón
// "aprender" para asignarle la nota base o el CC moviendo el
// controlador, y el canal en el que escucha.
// =========================================================

const CANALES_MIDI_OPCIONES = [{ v: 0, t: "Todos" }].concat(
  Array.from({ length: 16 }, (_, i) => ({ v: i + 1, t: "Canal " + (i + 1) }))
);

function _notaCortaMIDI(n) {
  if (typeof n !== "number" || n < 0 || n > 127) return "—";
  const nombres = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${nombres[n % 12]}${Math.floor(n / 12) - 1}`;
}

function inicializarUIMapeosMIDI() {
  if (typeof mapeoMIDI === "undefined") return;
  mapeoMIDI.cargar();
  mapeoMIDI.onChange = () => { renderMapeosMIDI(); sincronizarCapturaRitmoUI(); };
  mapeoMIDI.onValor = actualizarValoresMapeoMIDI;
  renderMapeosMIDI();
}

// Texto corto de una asignación libre: la nota, o el CC con su tramo.
function _textoAsignacionMapeo(a) {
  if (!a) return "—";
  if (a.tipo === "nota") return _notaCortaMIDI(a.nota);
  return `CC${a.cc}`;
}

// Modo libre: la lista de opciones del parámetro, cada una con el
// mensaje que le hayas puesto. Clic en la pastilla y toca una nota o
// mueve un control: lo que llegue queda asignado. Si es un CC aparecen
// además los dos campos del tramo de valores, que es lo que permite
// usar el mismo control para varias opciones (0-63 una, 64-127 otra).
// Las opciones vacías no responden a MIDI.
function renderOpcionesMapeo(p) {
  const ops = p.opciones();
  if (!ops.length) {
    return `<p class="mapeo-ops-vacio">Este parámetro todavía no tiene opciones.</p>`;
  }
  const filas = ops.map((op, i) => {
    const a = mapeoMIDI.asignacion(p.id, i);
    const esperando = mapeoMIDI.capturandoOpcion(p.id, i);
    const txt = esperando ? "…" : _textoAsignacionMapeo(a);
    const esCC = !!a && a.tipo === "cc";
    const tramo = esCC ? `
      <div class="mapeo-op-tramo">
        <span>valor</span>
        <input type="number" class="mapeo-op-min" min="0" max="127" step="1" value="${a.min}"
               title="Valor mínimo del tramo que dispara esta opción">
        <span>–</span>
        <input type="number" class="mapeo-op-max" min="0" max="127" step="1" value="${a.max}"
               title="Valor máximo del tramo que dispara esta opción">
      </div>` : "";
    return `
      <div class="mapeo-op${a ? " mapeo-op-on" : ""}${esCC ? " mapeo-op-cc" : ""}" data-idx="${i}">
        <div class="mapeo-op-fila">
          <button type="button" class="mapeo-op-learn${esperando ? " mapeo-esperando" : ""}"
                  title="Toca una nota o mueve un control para asignárselo a ${escaparHTML(op.nombre)}">
            <span class="mapeo-op-nombre">${escaparHTML(op.nombre)}</span>
            <span class="mapeo-op-nota">${txt}</span>
          </button>
          ${a ? `<button type="button" class="mapeo-op-clear" title="Quitar la asignación">✕</button>` : ""}
        </div>
        ${tramo}
      </div>`;
  }).join("");
  return `<div class="mapeo-ops">${filas}</div>`;
}

function renderMapeosMIDI() {
  const cont = document.getElementById("midi-mapeos");
  if (!cont || typeof mapeoMIDI === "undefined") return;
  cont.innerHTML = "";

  PARAMETROS_MIDI.forEach(p => {
    const cfg = mapeoMIDI.cfg[p.id];
    const rango = mapeoMIDI.rangoNotas(p.id);
    const n = mapeoMIDI.numOpciones(p.id);

    const item = document.createElement("div");
    item.className = "mapeo-item" + (cfg.modo === "off" ? " mapeo-off" : "");
    item.dataset.id = p.id;

    // Qué se ve a la derecha del modo: el rango, cuántas notas llevas
    // puestas a mano, o el número de CC
    let destino = "";
    if (cfg.modo === "notas") {
      destino = rango
        ? `${_notaCortaMIDI(rango.desde)} – ${_notaCortaMIDI(rango.hasta)} · ${rango.total} valores`
        : "sin opciones todavía";
    } else if (cfg.modo === "libre") {
      destino = n ? `${mapeoMIDI.numAsignadas(p.id)} de ${n} mapeadas` : "sin opciones todavía";
    } else if (cfg.modo === "cc") {
      destino = `CC ${cfg.cc} · ${n} tramos`;
    }

    // En modo libre no hay una nota base que aprender: cada opción
    // tiene la suya y se aprende desde su propia pastilla.
    const esperando = mapeoMIDI.capturando(p.id, cfg.modo === "cc" ? "cc" : "nota");
    const btnAprender = (cfg.modo === "off" || cfg.modo === "libre") ? "" :
      `<button type="button" class="mapeo-aprender${esperando ? " mapeo-esperando" : ""}"
               title="${cfg.modo === "cc" ? "Mueve la perilla o fader que quieras usar" : "Toca la nota que arranca el rango"}">
         ${esperando ? "Esperando…" : "Aprender"}
       </button>`;
    const btnVaciar = (cfg.modo === "libre" && mapeoMIDI.numAsignadas(p.id)) ?
      `<button type="button" class="mapeo-vaciar" title="Quitar todas las notas de este parámetro">✕ Vaciar</button>` : "";

    item.innerHTML = `
      <div class="mapeo-row1">
        <span class="mapeo-nombre" title="${escaparHTML(p.detalle)}">${escaparHTML(p.nombre)}</span>
        <span class="mapeo-valor">${escaparHTML(mapeoMIDI.nombreValorActual(p.id))}</span>
      </div>
      <div class="mapeo-row2">
        <select class="mapeo-modo" title="Cómo se controla este parámetro">
          <option value="off"${cfg.modo === "off" ? " selected" : ""}>Off</option>
          <option value="notas"${cfg.modo === "notas" ? " selected" : ""}>Rango</option>
          <option value="libre"${cfg.modo === "libre" ? " selected" : ""}>Libre</option>
          <option value="cc"${cfg.modo === "cc" ? " selected" : ""}>CC</option>
        </select>
        ${btnAprender}${btnVaciar}
        <span class="mapeo-destino">${escaparHTML(destino)}</span>
        <select class="mapeo-canal" title="Canal MIDI en el que escucha">
          ${CANALES_MIDI_OPCIONES.map(c =>
            `<option value="${c.v}"${c.v === cfg.canal ? " selected" : ""}>${c.t}</option>`
          ).join("")}
        </select>
      </div>
      ${cfg.modo === "libre" ? renderOpcionesMapeo(p) : ""}`;

    item.querySelector(".mapeo-modo").addEventListener("change", e => {
      mapeoMIDI.setModo(p.id, e.target.value);
    });
    item.querySelector(".mapeo-canal").addEventListener("change", e => {
      mapeoMIDI.setCanal(p.id, parseInt(e.target.value, 10));
    });
    item.querySelector(".mapeo-aprender")?.addEventListener("click", async () => {
      if (!await asegurarMIDIActivo()) return;
      const tipo = (cfg.modo === "cc") ? "cc" : "nota";
      if (mapeoMIDI.capturando(p.id, tipo)) mapeoMIDI.cancelarCaptura();
      else mapeoMIDI.iniciarCaptura(p.id, tipo);
    });
    item.querySelector(".mapeo-vaciar")?.addEventListener("click", () => {
      mapeoMIDI.vaciarAsignaciones(p.id);
    });

    // Modo libre: una pastilla por opción, cada una con su nota
    item.querySelectorAll(".mapeo-op-learn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.closest(".mapeo-op").dataset.idx);
        if (!await asegurarMIDIActivo()) return;
        if (mapeoMIDI.capturandoOpcion(p.id, idx)) mapeoMIDI.cancelarCaptura();
        else mapeoMIDI.iniciarCapturaOpcion(p.id, idx);
      });
    });
    item.querySelectorAll(".mapeo-op-clear").forEach(btn => {
      btn.addEventListener("click", () => {
        mapeoMIDI.setAsignacion(p.id, Number(btn.closest(".mapeo-op").dataset.idx), null);
      });
    });

    // Tramo de valores de una asignación por CC. Se guarda sin
    // reconstruir la lista para no perder el foco mientras se teclea.
    item.querySelectorAll(".mapeo-op-tramo").forEach(tramo => {
      const idx = Number(tramo.closest(".mapeo-op").dataset.idx);
      const min = tramo.querySelector(".mapeo-op-min");
      const max = tramo.querySelector(".mapeo-op-max");
      const guardar = () => {
        mapeoMIDI.setTramoAsignacion(p.id, idx, parseInt(min.value, 10), parseInt(max.value, 10));
        const a = mapeoMIDI.asignacion(p.id, idx);
        if (a && a.tipo === "cc") { min.value = a.min; max.value = a.max; }
      };
      min.addEventListener("change", guardar);
      max.addEventListener("change", guardar);
    });

    cont.appendChild(item);
  });

  const aviso = document.getElementById("midi-mapeos-aviso");
  if (aviso) {
    const choques = mapeoMIDI.conflictos();
    aviso.textContent = choques.length
      ? "⚠ Rangos de notas encimados: " + choques.join(", ") + ". La nota se la queda el primero de la lista; sepáralos o dales canales distintos."
      : "";
    aviso.style.display = choques.length ? "" : "none";
  }
}

// Estado del botón 🎹 de cada ritmo: qué tarjeta espera nota y qué nota
// tiene asignada. Se actualiza sin reconstruir la lista para no cortar
// una edición de nombre en curso.
function sincronizarCapturaRitmoUI() {
  if (typeof ritmos === "undefined" || typeof mapeoMIDI === "undefined") return;
  const esperandoId = mapeoMIDI.capturaRitmo;
  document.querySelectorAll(".ritmo-item").forEach(el => {
    const btn = el.querySelector(".ritmo-midi");
    const tag = el.querySelector(".ritmo-midi-nota");
    if (!btn || !tag) return;
    const esperando = el.dataset.id === esperandoId;
    btn.classList.toggle("mapeo-esperando", esperando);
    const r = ritmos.porId(el.dataset.id);
    tag.textContent = esperando ? "…"
      : ((r && typeof r.midiNote === "number") ? _notaCortaMIDI(r.midiNote) : "—");
  });
}

// Repintado ligero: solo el valor en curso. Lo llama midi-map.js cada
// vez que un mensaje MIDI cambia un parámetro, así que no puede
// reconstruir los selects (robaría el foco).
function actualizarValoresMapeoMIDI() {
  if (typeof mapeoMIDI === "undefined") return;
  document.querySelectorAll("#midi-mapeos .mapeo-item").forEach(el => {
    const val = el.querySelector(".mapeo-valor");
    if (val) val.textContent = mapeoMIDI.nombreValorActual(el.dataset.id);
  });
  document.querySelectorAll(".ritmo-midi-nota").forEach(el => {
    const r = ritmos.porId(el.closest(".ritmo-item")?.dataset.id);
    if (r) el.textContent = (typeof r.midiNote === "number") ? _notaCortaMIDI(r.midiNote) : "—";
  });
}

// Los botones de asignación necesitan MIDI encendido para escuchar
async function asegurarMIDIActivo() {
  if (MIDI.enabled) return true;
  const ok = await MIDI.enable();
  if (!ok) {
    alert("No se pudo activar MIDI. Necesitas un navegador compatible (Chrome/Edge/Opera) y MIDI permitido.");
    return false;
  }
  renderEstadoMIDI();
  return true;
}

// =========================================================
// UI de notas: raíz, orden por intervalos y microtonos escribibles
// =========================================================

function inicializarUINotas() {
  const selRaiz = document.getElementById("select-nota-raiz");
  const selIntervalo = document.getElementById("select-intervalo");
  const inputMicro = document.getElementById("input-microtonos");

  if (selRaiz) {
    selRaiz.innerHTML = NOTAS_BASE.map((n, i) =>
      `<option value="${i}"${i === notaRaiz ? " selected" : ""}>${n}</option>`
    ).join("");
    selRaiz.addEventListener("change", e => {
      setNotaRaiz(parseInt(e.target.value, 10));
      if (typeof synth !== "undefined" && synth.ctx) synth.updateFromAstros(estado.astros);
      refrescarPanel();
    });
  }

  if (selIntervalo) {
    selIntervalo.innerHTML = INTERVALOS_ORDEN.map(iv =>
      `<option value="${iv.semitonos}"${iv.semitonos === intervaloOrden ? " selected" : ""}>${iv.nombre}</option>`
    ).join("");
    selIntervalo.addEventListener("change", e => {
      setIntervaloOrden(parseInt(e.target.value, 10));
      if (typeof synth !== "undefined" && synth.ctx) synth.updateFromAstros(estado.astros);
      refrescarPanel();
    });
  }

  if (inputMicro) {
    inputMicro.min = MIN_MICROTONOS;
    inputMicro.max = MAX_MICROTONOS;
    inputMicro.value = numMicrotonos;
    inputMicro.addEventListener("change", e => {
      const v = parseInt(e.target.value, 10);
      if (Number.isNaN(v)) return;
      setNumMicrotonos(v);
      inputMicro.value = numMicrotonos;  // refleja el clamp (máx. 96)
      if (typeof synth !== "undefined" && synth.ctx) synth.updateFromAstros(estado.astros);
      refrescarPanel();
    });
  }
}

function sincronizarUINotas() {
  const selRaiz = document.getElementById("select-nota-raiz");
  const selIntervalo = document.getElementById("select-intervalo");
  const inputMicro = document.getElementById("input-microtonos");
  if (selRaiz) selRaiz.value = notaRaiz;
  if (selIntervalo) selIntervalo.value = intervaloOrden;
  if (inputMicro && document.activeElement !== inputMicro) inputMicro.value = numMicrotonos;
}

// =========================================================
// Panel: refresco de DOM
// =========================================================

function refrescarPanel() {
  document.getElementById("modo-actual").textContent =
    estado.modo + (estado.modo === MODO_AHORA && !estado.seguirTiempoReal ? " (pausado)" : "");
  document.getElementById("fecha-hora-actual").textContent =
    formatearTimestampLocal(estado.fechaUTC, estado.zonaHoraria);
  document.getElementById("paso-temporal").textContent = pasoTemporalActualNombre();
  document.getElementById("modo-musical").textContent = nombreOrdenActual();
  document.getElementById("numero-microtonos").textContent = numMicrotonos;
  sincronizarUINotas();

  const tblAstros = document.getElementById("tabla-astros");
  tblAstros.innerHTML = estado.astros.map((a, i) => `
    <tr>
      <td>${NOMBRES_ASTROS[i]}</td>
      <td>${formatearPosicion(a.grado, a.minuto, a.signo)}</td>
    </tr>
  `).join("");

  const tblCasas = document.getElementById("tabla-casas");
  tblCasas.innerHTML = estado.casas.map((c, i) => `
    <tr>
      <td>${NOMBRES_CASAS[i]}</td>
      <td>${formatearPosicion(c.grado, c.minuto, c.signo)}</td>
    </tr>
  `).join("");

  const errEl = document.getElementById("mensaje-error");
  if (!estado.cartaValida && estado.ultimoError) {
    errEl.textContent = "⚠ " + estado.ultimoError;
    errEl.hidden = false;
  } else {
    errEl.hidden = true;
  }

  if (!document.activeElement || document.activeElement.tagName !== "INPUT") {
    sincronizarFormularioConEstado();
  }

  actualizarUISintetizador();

  if (typeof actualizarPiano === "function") actualizarPiano();
}

// =========================================================
// Panel: secciones compactables, desprendibles en ventanas
// y enviables a la bandeja inferior
// =========================================================
//
// Cada sección del panel puede:
//   - compactarse (clic en su título h2; las <details> ya lo hacen)
//   - desprenderse (botón ⧉) como ventana flotante arrastrable
//     sobre el canvas; ⏎ la ancla de vuelta en su lugar original.
//   - enviarse (botón ⤓) a una bandeja fija en la parte inferior de
//     la pantalla, redimensionable en alto y con un selector para
//     cambiar qué sección se muestra ahí sin tener que desplazar el
//     panel lateral (p. ej. tener el piano a la vista mientras se
//     ajusta el sintetizador).
// El estado se persiste en cas-panel-v1.

const PANEL_VENTANAS_KEY = "cas-panel-v1";
const _panelVentanas = { compactas: {}, ventanas: {}, dock: { slug: null, alto: 260 } };

const DOCK_ALTO_MIN = 140;
const DOCK_ALTO_DEFAULT = 260;

function _guardarPanelVentanas() {
  try {
    localStorage.setItem(PANEL_VENTANAS_KEY, JSON.stringify(_panelVentanas));
  } catch (e) {}
}

function _cargarPanelVentanas() {
  try {
    const raw = localStorage.getItem(PANEL_VENTANAS_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.compactas && typeof data.compactas === "object") _panelVentanas.compactas = data.compactas;
    if (data.ventanas && typeof data.ventanas === "object") _panelVentanas.ventanas = data.ventanas;
    if (data.dock && typeof data.dock === "object") {
      if (typeof data.dock.slug === "string") _panelVentanas.dock.slug = data.dock.slug;
      if (Number.isFinite(data.dock.alto)) _panelVentanas.dock.alto = data.dock.alto;
    }
  } catch (e) {}
}

function _slugSeccion(sec) {
  const titulo = sec.querySelector("h2, summary");
  return (titulo ? titulo.textContent : "seccion").trim().toLowerCase()
    .replace(/[^a-z0-9áéíóúñ]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function _tituloSeccion(sec) {
  const titulo = sec.querySelector("h2, summary");
  return titulo ? titulo.textContent.replace(/\(clic para .*?\)/, "").trim() : (sec.dataset.slug || "Sección");
}

function _buscarSeccion(slug) {
  return document.querySelector(`.panel-section[data-slug="${slug}"], details.panel-colapsable[data-slug="${slug}"]`);
}

// Marca el lugar original de una sección con un placeholder oculto,
// para poder devolverla ahí (desde ventana flotante o bandeja). Si ya
// tiene uno (porque ya se había desprendido antes) no crea otro.
function _destacarSeccion(sec) {
  const slug = sec.dataset.slug;
  if (document.querySelector(`.seccion-ancla[data-slug="${slug}"]`)) return;
  const ancla = document.createElement("div");
  ancla.className = "seccion-ancla";
  ancla.hidden = true;
  ancla.dataset.slug = slug;
  sec.parentNode.insertBefore(ancla, sec);
}

// Devuelve una sección a su placeholder original (o al final del panel
// si por alguna razón no existe ya).
function _reanclarSeccion(sec) {
  const slug = sec.dataset.slug;
  const ancla = document.querySelector(`.seccion-ancla[data-slug="${slug}"]`);
  if (ancla) {
    ancla.parentNode.replaceChild(sec, ancla);
  } else {
    document.querySelector(".panel")?.appendChild(sec);
  }
}

function inicializarPanelVentanas() {
  _cargarPanelVentanas();

  document.querySelectorAll(".panel > .panel-section, .panel > details.panel-colapsable").forEach(sec => {
    const slug = _slugSeccion(sec);
    sec.dataset.slug = slug;

    // Botón desprender (en el summary si es <details>, para que se vea cerrada)
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "seccion-desprender";
    btn.title = "Desprender en ventana flotante";
    btn.textContent = "⧉";
    btn.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      desprenderSeccion(sec);
    });

    // Botón enviar a la bandeja inferior
    const btnDock = document.createElement("button");
    btnDock.type = "button";
    btnDock.className = "seccion-enviar-dock";
    btnDock.title = "Enviar a la bandeja inferior";
    btnDock.textContent = "⤓";
    btnDock.addEventListener("click", e => {
      e.preventDefault();
      e.stopPropagation();
      enviarADock(sec);
    });

    const host = (sec.tagName === "DETAILS") ? sec.querySelector("summary") : sec;
    (host || sec).appendChild(btn);
    (host || sec).appendChild(btnDock);

    // Compactar con clic en el título (las <details> usan su summary)
    const h2 = sec.querySelector("h2");
    if (h2) {
      h2.classList.add("seccion-toggle");
      h2.title = "Clic para compactar / expandir";
      h2.addEventListener("click", () => {
        sec.classList.toggle("compacta");
        _panelVentanas.compactas[slug] = sec.classList.contains("compacta");
        _guardarPanelVentanas();
      });
      if (_panelVentanas.compactas[slug]) sec.classList.add("compacta");
    }
  });

  // Restaurar las ventanas desprendidas de la sesión anterior
  for (const [slug, pos] of Object.entries(_panelVentanas.ventanas)) {
    const sec = document.querySelector(`.panel [data-slug="${slug}"]`);
    if (sec && pos) desprenderSeccion(sec, pos.x, pos.y);
  }

  // Restaurar la sección de la bandeja inferior de la sesión anterior
  if (_panelVentanas.dock.slug) {
    const sec = _buscarSeccion(_panelVentanas.dock.slug);
    if (sec) enviarADock(sec);
  }
}

function desprenderSeccion(sec, x, y) {
  const slug = sec.dataset.slug;
  if (document.querySelector(`.ventana-flotante[data-slug="${slug}"]`)) return;

  // Placeholder para devolver la sección a su lugar exacto
  const ancla = document.createElement("div");
  ancla.className = "seccion-ancla";
  ancla.hidden = true;
  ancla.dataset.slug = slug;
  sec.parentNode.insertBefore(ancla, sec);

  const nVentanas = document.querySelectorAll(".ventana-flotante").length;
  const px = clamp((typeof x === "number") ? x : 24 + nVentanas * 28, 0, window.innerWidth - 120);
  const py = clamp((typeof y === "number") ? y : 70 + nVentanas * 28, 0, window.innerHeight - 60);

  const vent = document.createElement("div");
  vent.className = "ventana-flotante";
  vent.dataset.slug = slug;
  vent.style.left = px + "px";
  vent.style.top = py + "px";
  vent.innerHTML = `
    <div class="ventana-titulo">
      <span>${escaparHTML(_tituloSeccion(sec))}</span>
      <button type="button" class="ventana-anclar" title="Devolver al panel">⏎</button>
    </div>
  `;
  vent.appendChild(sec);
  document.body.appendChild(vent);
  sec.classList.remove("compacta");
  if (sec.tagName === "DETAILS") sec.open = true;

  vent.querySelector(".ventana-anclar").addEventListener("click", () => anclarSeccion(slug));

  // Arrastre por la barra de título
  const barra = vent.querySelector(".ventana-titulo");
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
      _panelVentanas.ventanas[slug] = { x: vent.offsetLeft, y: vent.offsetTop };
      _guardarPanelVentanas();
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  });

  _panelVentanas.ventanas[slug] = { x: px, y: py };
  _guardarPanelVentanas();
}

function anclarSeccion(slug) {
  const vent = document.querySelector(`.ventana-flotante[data-slug="${slug}"]`);
  if (!vent) return;
  const sec = vent.querySelector(".panel-section, details.panel-colapsable");
  if (sec) _reanclarSeccion(sec);
  vent.remove();
  delete _panelVentanas.ventanas[slug];
  _guardarPanelVentanas();
}

function escaparHTML(s) {
  return String(s || "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

// =========================================================
// Bandeja inferior: contenedor fijo, redimensionable en alto,
// que muestra UNA sección elegida por un <select>.
// =========================================================

function _aplicarAltoDock(alto) {
  const dock = document.getElementById("panel-dock");
  if (!dock) return alto;
  const max = Math.max(DOCK_ALTO_MIN, Math.round(window.innerHeight * 0.82));
  const h = clamp(alto, DOCK_ALTO_MIN, max);
  dock.style.height = h + "px";
  return h;
}

function _construirDockPanel() {
  let dock = document.getElementById("panel-dock");
  if (dock) return dock;

  dock = document.createElement("div");
  dock.id = "panel-dock";
  dock.className = "panel-dock";
  dock.hidden = true;
  dock.innerHTML = `
    <div class="dock-resize" title="Arrastrar para cambiar el alto"></div>
    <div class="dock-barra">
      <span class="dock-titulo">▤ Bandeja</span>
      <select class="dock-select"></select>
      <button type="button" class="dock-cerrar" title="Cerrar bandeja">✕</button>
    </div>
    <div class="dock-contenido"></div>
  `;
  document.body.appendChild(dock);

  const sel = dock.querySelector(".dock-select");
  document.querySelectorAll(".panel-section[data-slug], details.panel-colapsable[data-slug]").forEach(sec => {
    const opt = document.createElement("option");
    opt.value = sec.dataset.slug;
    opt.textContent = _tituloSeccion(sec);
    sel.appendChild(opt);
  });
  sel.addEventListener("change", () => {
    const destino = _buscarSeccion(sel.value);
    if (destino) enviarADock(destino);
  });

  dock.querySelector(".dock-cerrar").addEventListener("click", cerrarDock);

  const resize = dock.querySelector(".dock-resize");
  resize.addEventListener("pointerdown", ev => {
    ev.preventDefault();
    const altoInicial = dock.getBoundingClientRect().height;
    const yInicial = ev.clientY;
    const mover = e2 => {
      _panelVentanas.dock.alto = _aplicarAltoDock(altoInicial - (e2.clientY - yInicial));
    };
    const soltar = () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
      _guardarPanelVentanas();
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
  });

  return dock;
}

function enviarADock(sec) {
  const slug = sec.dataset.slug;
  if (!slug) return;
  _destacarSeccion(sec);

  // Si estaba en una ventana flotante, se cierra esa ventana
  const vent = sec.closest(".ventana-flotante");
  if (vent) {
    vent.remove();
    delete _panelVentanas.ventanas[slug];
  }

  const dock = _construirDockPanel();
  const contenido = dock.querySelector(".dock-contenido");

  // Si ya había otra sección en la bandeja, devolverla a su lugar
  const actual = contenido.querySelector(".panel-section, details.panel-colapsable");
  if (actual && actual !== sec) _reanclarSeccion(actual);

  contenido.appendChild(sec);
  sec.classList.remove("compacta");
  if (sec.tagName === "DETAILS") sec.open = true;

  dock.hidden = false;
  _panelVentanas.dock.alto = _aplicarAltoDock(_panelVentanas.dock.alto || DOCK_ALTO_DEFAULT);

  const sel = dock.querySelector(".dock-select");
  if (sel) sel.value = slug;

  _panelVentanas.dock.slug = slug;
  _guardarPanelVentanas();

  // El teclado del piano cachea su ancho; al cambiar de contenedor
  // hay que forzar el redibujo para que no quede con el ancho viejo.
  if (sec.id === "seccion-piano" && typeof renderPianoTeclado === "function") {
    renderPianoTeclado(true);
  }
}

function cerrarDock() {
  const dock = document.getElementById("panel-dock");
  if (!dock) return;
  const actual = dock.querySelector(".panel-section, details.panel-colapsable");
  if (actual) _reanclarSeccion(actual);
  dock.hidden = true;
  _panelVentanas.dock.slug = null;
  _guardarPanelVentanas();
}
