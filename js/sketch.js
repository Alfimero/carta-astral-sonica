// =========================================================
// sketch.js — punto de entrada p5.js
// =========================================================

let layout = {};

// Si el contenedor reporta tamaño 0 (CSS aún no aplicado), usar fallback
function obtenerDimensionesCanvas() {
  const contenedor = document.getElementById("wheel-canvas");
  let w = 0, h = 0;

  if (contenedor) {
    const rect = contenedor.getBoundingClientRect();
    w = rect.width;
    h = rect.height;
  }

  if (w < 100 || h < 100) {
    // Fallback: usar window menos el panel derecho (500px)
    const anchoPanel = (document.body.classList.contains("dev-mode")) ? (290 + 440) : 500;
    w = Math.max(400, window.innerWidth - anchoPanel);
    h = Math.max(400, window.innerHeight);
    console.warn("[setup] El contenedor #wheel-canvas reportó tamaño insuficiente; usando fallback:", w, "×", h);
  }

  return { w, h };
}

function setup() {
  const { w, h } = obtenerDimensionesCanvas();

  console.log("[setup] Creando canvas:", w, "×", h);

  const cnv = createCanvas(w, h);
  cnv.parent("wheel-canvas");

  textAlign(CENTER, CENTER);
  textFont("system-ui");

  calcularLayout();
  actualizarModoMusical();
  inicializarEstado();
  inicializarFormulario();
  inicializarUISintetizador();
  inicializarUIBancos();
  inicializarUIMIDI();
  if (typeof inicializarUIVistas === "function") inicializarUIVistas();
  if (typeof inicializarUIGeo === "function") inicializarUIGeo();
  if (typeof inicializarUINotas === "function") inicializarUINotas();
  if (typeof inicializarUIPiano === "function") inicializarUIPiano();
  if (typeof inicializarUIMezclador === "function") inicializarUIMezclador();
  if (typeof inicializarUIRackSintetizadores === "function") inicializarUIRackSintetizadores();
  if (typeof inicializarPanelVentanas === "function") inicializarPanelVentanas();

  console.log("[setup] OK · width=", width, "height=", height, "centroX=", layout.centroX, "centroY=", layout.centroY, "escala=", layout.escala);
  console.log("[setup] astros.length=", estado.astros.length, "casas.length=", estado.casas.length);

  window.addEventListener("resize", onResize);

  if (typeof inicializarDevPanel === "function") {
    inicializarDevPanel();
  }
}

function onResize() {
  const { w, h } = obtenerDimensionesCanvas();
  resizeCanvas(w, h);
  calcularLayout();
}

function calcularLayout() {
  const w = width;
  const h = height;

  const ladoUtil = clamp(Math.min(w, h) - 80, 260, 760);
  const escala = ladoUtil / 760;

  layout = {
    canvasW: w,
    canvasH: h,
    centroX: w * 0.5,
    centroY: h * 0.5,
    escala: escala,

    radioExteriorGrande:     300 * escala,
    radioGradosExteriorA:    300 * escala,
    radioGradosExteriorB:    320 * escala,
    radioCasaExteriorA:      300 * escala,
    radioCasaExteriorB:      337 * escala,

    radioColorExterior:      235 * escala,
    radioColorInterior:      205 * escala,

    radioGradosInteriorA:    195 * escala,
    radioGradosInteriorB:    205 * escala,

    radioCasaInteriorA:      205 * escala,
    radioCasaInteriorB:      168 * escala,

    radioAstrosLinea:        168 * escala,
    radioAstrosPunto:        188 * escala,
    radioAstrosTexto:        348 * escala,

    radioNotas:              ((300 + 235) * 0.5) * escala,
    radioSignos:             ((235 + 205) * 0.5 - 1) * escala,
    radioAspectos:           165 * escala,
    radioFrecuenciaNotas:    280 * escala,
    radioFrecuenciaExterior: 400 * escala,

    radioMicrotonosA:        300 * escala,
    radioMicrotonosB:        360 * escala
  };
}

function draw() {
  try {
    actualizarEstadoPorFrame();

    if (typeof actualizarFilasSonando === "function") {
      actualizarFilasSonando();
    }

    // Eslabón de la cadena de ritmos que suena (solo repinta si cambió)
    if (typeof marcarRitmoEnCurso === "function") {
      marcarRitmoEnCurso();
    }

    if (typeof recargarImagenesAstrosSiCambian === "function") {
      recargarImagenesAstrosSiCambian();
    }

    background(THEME.background);

    const fondoActivo = estadoVistas.fondo !== "ninguno";

    if (!fondoActivo) {
      // Solo carta a pantalla completa
      if (estadoVistas.mostrarCarta) dibujarCartaCompleta(layout);
    } else {
      // Con vista de fondo: la carta se dibuja completa, se copia a un
      // buffer y luego se pega como mini ventana sobre la vista.
      if (estadoVistas.mostrarCarta) {
        dibujarCartaCompleta(layout);
        copiarCartaABuffer(layout);
      }

      if (estadoVistas.fondo === "sistema") {
        dibujarVistaSistemaSolar(layout);
      } else {
        dibujarVistaObservatorio(layout);
      }

      if (estadoVistas.mostrarCarta) dibujarMiniCarta(layout);
    }

    if (!estado.cartaValida && estado.ultimoError) {
      dibujarBannerError(layout, estado.ultimoError);
    }

    // Indicador de diagnóstico (solo primer frame y cuando aún no se sabe que funciona)
    if (frameCount === 1) {
      console.log("[draw] primer frame OK");
    }
  } catch (e) {
    // Si draw falla, mostrar el error en pantalla para diagnóstico
    if (typeof mostrarError === "function") {
      mostrarError("draw() falló: " + e.message, "sketch.js", 0, 0, e);
    }
    console.error("[draw]", e);
    noLoop();  // Evitar spam de errores
  }
}

// Dibuja la carta astral completa centrada en el canvas
function dibujarCartaCompleta(layout) {
  push();
  translate(layout.centroX, layout.centroY);

  dibujarColoresMicrotonales(layout);

  stroke(THEME.guias.colorAnillos);
  strokeWeight(1);
  noFill();
  ellipse(0, 0, layout.radioExteriorGrande * 2, layout.radioExteriorGrande * 2);
  ellipse(0, 0, layout.radioColorExterior * 2, layout.radioColorExterior * 2);

  dibujarSignos(layout);
  dibujarNotas(layout);
  dibujarFrecuenciasNotas(layout);
  dibujarFrecuenciasMicrotonales(layout);

  dibujarGradosExteriores(layout);
  dibujarGradosInteriores(layout);
  dibujarDivisionesPrincipales(layout);
  dibujarMicrotonos(layout);

  if (estado.astros.length > 0) {
    dibujarRegionesSonando(layout, estado.astros);
  }

  if (estado.casas.length > 0) {
    dibujarLineasCasas(layout, estado.casas);
  }
  if (estado.astros.length > 0) {
    dibujarAspectos(layout, estado.astros);
    dibujarAstros(layout, estado.astros);
  }

  pop();
}

// -------------- Mouse: planetas, mini carta y cámara --------------

// Arrastre en curso: {tipo: "mini-move"|"mini-resize"|"camara", dx, dy}
let _dragVista = null;

// p5 escucha el mouse en toda la ventana, no solo en el canvas: si el
// evento nace en la UI del DOM (sliders de la toolbar, panel flotante,
// ventanas), no debe mover la cámara ni la mini-carta.
function eventoSobreCanvas(event) {
  return !event || !event.target || event.target.tagName === "CANVAS";
}

function mousePressed(event) {
  if (!eventoSobreCanvas(event)) return;
  if (mouseX < 0 || mouseX > width) return;
  if (mouseY < 0 || mouseY > height) return;

  const fondoActivo = estadoVistas.fondo !== "ninguno";

  // Mini carta: mover o redimensionar
  if (fondoActivo && estadoVistas.mostrarCarta && typeof miniHit === "function") {
    const hit = miniHit(mouseX, mouseY);
    if (hit === "resize") {
      _dragVista = { tipo: "mini-resize" };
      return;
    }
    if (hit === "move") {
      _dragVista = {
        tipo: "mini-move",
        dx: mouseX - estadoVistas.mini.x,
        dy: mouseY - estadoVistas.mini.y
      };
      return;
    }
  }

  // Observatorio: arrastrar para girar la cámara
  if (fondoActivo && estadoVistas.fondo === "observatorio") {
    _dragVista = { tipo: "camara" };
    return;
  }

  // Sistema solar: arrastrar para panear la cámara
  if (fondoActivo && estadoVistas.fondo === "sistema") {
    _dragVista = {
      tipo: "sistema-pan",
      dx: mouseX - estadoVistas.sis.panX,
      dy: mouseY - estadoVistas.sis.panY
    };
    return;
  }

  // Clic en planetas: solo con la carta a pantalla completa
  if (fondoActivo || !estadoVistas.mostrarCarta) return;

  const idx = detectarPlanetaEnPosicion(mouseX, mouseY, layout, estado.astros);
  if (idx === -1) return;

  if (typeof synth !== "undefined") {
    if (!synth.ctx) synth.init();
    if (!synth.enabled) {
      synth.enable();
      synth.updateFromAstros(estado.astros);
    }

    synth.setPlanetEnabled(idx, !synth.planetEnabled[idx]);
    actualizarUISintetizador();
  }
}

function mouseDragged() {
  if (!_dragVista) return;

  if (_dragVista.tipo === "mini-move") {
    estadoVistas.mini.x = mouseX - _dragVista.dx;
    estadoVistas.mini.y = mouseY - _dragVista.dy;
  } else if (_dragVista.tipo === "mini-resize") {
    const m = estadoVistas.mini;
    const cx = m.x + m.tam / 2;
    const cy = m.y + m.tam / 2;
    const nuevoTam = clamp(2 * Math.hypot(mouseX - cx, mouseY - cy), 120, Math.min(width, height));
    // Redimensionar manteniendo el centro
    m.x = cx - nuevoTam / 2;
    m.y = cy - nuevoTam / 2;
    m.tam = nuevoTam;
  } else if (_dragVista.tipo === "camara") {
    estadoVistas.camAz = ((estadoVistas.camAz - movedX * (360 / width)) % 360 + 360) % 360;
    estadoVistas.camY = clamp(estadoVistas.camY + movedY, -height * 0.38, height * 0.26);
  } else if (_dragVista.tipo === "sistema-pan") {
    estadoVistas.sis.panX = mouseX - _dragVista.dx;
    estadoVistas.sis.panY = mouseY - _dragVista.dy;
  }
  return false;
}

function mouseReleased() {
  if (_dragVista) {
    _dragVista = null;
    if (typeof guardarVistas === "function") guardarVistas();
  }
}

function doubleClicked(event) {
  if (!eventoSobreCanvas(event)) return;
  if (mouseX < 0 || mouseX > width || mouseY < 0 || mouseY > height) return;
  // Doble clic en el observatorio (fuera de la mini carta): centrar cámara
  if (estadoVistas.fondo === "observatorio" &&
      (typeof miniHit !== "function" || !miniHit(mouseX, mouseY))) {
    estadoVistas.camAz = 180;
    estadoVistas.camY = 0;
    if (typeof guardarVistas === "function") guardarVistas();
  }
  // Doble clic en el sistema solar: restablecer zoom y paneo
  if (estadoVistas.fondo === "sistema" &&
      (typeof miniHit !== "function" || !miniHit(mouseX, mouseY)) &&
      typeof restablecerCamaraSistema === "function") {
    restablecerCamaraSistema();
  }
}
