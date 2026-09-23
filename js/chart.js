// =========================================================
// chart.js — dibujo de la carta astral
// (casas, planetas, aspectos)
// =========================================================
// Valores visuales editables a través de THEME
// =========================================================

// Cache de imágenes cargadas por astro
const astroImageCache = new Array(12).fill(null);
const astroImageUrls = new Array(12).fill("");

function recargarImagenesAstrosSiCambian() {
  if (!THEME.astros.imagenes) return;
  for (let i = 0; i < 12; i++) {
    const url = THEME.astros.imagenes[i] || "";
    if (url !== astroImageUrls[i]) {
      astroImageUrls[i] = url;
      if (url) {
        loadImage(url,
          img => { astroImageCache[i] = img; },
          err => { astroImageCache[i] = null; console.warn("[astros] no se pudo cargar imagen", i, err); }
        );
      } else {
        astroImageCache[i] = null;
      }
    }
  }
}

function radioAstrosLinea(layout) { return THEME.astros.radioLineaInicio * layout.escala; }
function radioAstrosPunto(layout) { return THEME.astros.radioPunto * layout.escala; }
function radioAstrosTexto(layout) { return THEME.astros.radioTexto * layout.escala; }

// =========================================================
// CASAS
// =========================================================

function dibujarLineasCasas(layout, casas) {
  if (!THEME.casas.mostrar) return;

  stroke(colorTema(THEME.casas.color, THEME.casas.opacidad));
  strokeWeight(Math.max(1, THEME.casas.grosor * layout.escala));

  for (let i = 0; i < casas.length; i++) {
    const c = casas[i];
    const angDeg = anguloVisualCarta(c.signo, c.grado, c.minuto);
    const ang = angDeg * DEG_TO_RAD;

    lineaEntreRadios(ang, layout.radioCasaExteriorA, layout.radioCasaExteriorB);
    lineaEntreRadios(ang, layout.radioCasaInteriorA, layout.radioCasaInteriorB);
  }
}

// =========================================================
// ASTROS
// =========================================================

function dibujarAstros(layout, astros) {
  textAlign(CENTER, CENTER);

  const tipoMostrar = THEME.astros.tipoMostrar || "texto";

  for (let i = 0; i < astros.length; i++) {
    const a = astros[i];
    const angDeg = anguloVisualCarta(a.signo, a.grado, a.minuto);
    const ang = angDeg * DEG_TO_RAD;

    const pLinea = puntoEnRadio(ang, radioAstrosLinea(layout));
    const pPunto = puntoEnRadio(ang, radioAstrosPunto(layout));
    const pTexto = puntoEnRadio(ang, radioAstrosTexto(layout));

    if (THEME.astros.mostrarLinea) {
      stroke(THEME.astros.colorLinea);
      strokeWeight(Math.max(0.5, THEME.astros.grosorLinea * layout.escala));
      line(pLinea.x, pLinea.y, pPunto.x, pPunto.y);
    }

    // Punto del planeta — color individual si hay
    const sonando = (i < 10 && typeof synth !== "undefined" && synth.planetEnabled[i]);
    const sonandoEnvelope = (i < 10 && typeof synth !== "undefined" && synth.envelopeActiva[i]);
    const tamPunto = Math.max(3, THEME.astros.tamanoPunto * layout.escala);

    if (THEME.astros.mostrarPunto) {
      const colorPunto = (THEME.astros.coloresPorAstro && THEME.astros.coloresPorAstro[i])
        ? THEME.astros.coloresPorAstro[i]
        : THEME.astros.colorPunto;
      noStroke();
      fill(colorPunto);
      ellipse(pPunto.x, pPunto.y, tamPunto, tamPunto);

      if (sonando || sonandoEnvelope) {
        noFill();
        stroke(sonandoEnvelope ? "#ffaa00" : THEME.aspectos.colorTrigono);
        strokeWeight(Math.max(1, 2 * layout.escala));
        ellipse(pPunto.x, pPunto.y, tamPunto * 2.2, tamPunto * 2.2);
      }
    }

    // Texto / símbolo / imagen
    if (THEME.astros.mostrarTexto) {
      const colorAstro = (THEME.astros.coloresPorAstro && THEME.astros.coloresPorAstro[i])
        ? THEME.astros.coloresPorAstro[i]
        : THEME.astros.colorTexto;

      if (tipoMostrar === "imagen" && astroImageCache[i]) {
        const tam = Math.max(8, THEME.astros.radioImagenTamano * layout.escala);
        imageMode(CENTER);
        image(astroImageCache[i], pTexto.x, pTexto.y, tam, tam);
      } else if (tipoMostrar === "simbolo") {
        noStroke();
        fill(colorAstro);
        textSize(Math.max(8, THEME.astros.tamanoTexto * layout.escala * 1.4));
        text(SIMBOLOS_ASTROS[i] || NOMBRES_ASTROS[i], pTexto.x, pTexto.y);
      } else {
        noStroke();
        fill(colorAstro);
        textSize(Math.max(7, THEME.astros.tamanoTexto * layout.escala));
        text(NOMBRES_ASTROS[i], pTexto.x, pTexto.y);
      }
    }
  }
}

// =========================================================
// ASPECTOS
// =========================================================

function obtenerColorAspecto(angulo) {
  if (angulo === 0)   return THEME.aspectos.colorConjuncion;
  if (angulo === 60)  return THEME.aspectos.colorSextil;
  if (angulo === 90)  return THEME.aspectos.colorCuadratura;
  if (angulo === 120) return THEME.aspectos.colorTrigono;
  if (angulo === 150) return THEME.aspectos.colorQuincuncio;
  if (angulo === 180) return THEME.aspectos.colorOposicion;
  return "#888888";
}

function detectarAspectoAngulo(distancia, orbe) {
  const candidatos = [0, 60, 90, 120, 150, 180];
  for (const a of candidatos) {
    if (Math.abs(distancia - a) <= orbe) return a;
  }
  return null;
}

// Arco distintivo para conjunciones (las cuerdas son invisibles).
// La orientación de la rueda ya está aplicada en
// anguloVisualCartaDesdePosicion, no hay que ajustar nada extra aquí.
function dibujarArcoConjuncion(layout, pos1, pos2, colorArco, grosor) {
  const angA = anguloVisualCartaDesdePosicion(pos1);

  // Extremo B en la MISMA vuelta que A: con el cruce de 0° (359° y 2°)
  // la resta cruda da 357° y el puente se dibujaría al otro lado.
  let delta = anguloVisualCartaDesdePosicion(pos2) - angA;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  const angB = angA + delta;

  // El arco va de un astro al otro (más un margen a cada lado): así se
  // lee como un puente entre los dos cuerpos y no como un tick suelto.
  const margen = Math.max(2, THEME.aspectos.arcoConjuncion || 8);
  const aIni = (Math.min(angA, angB) - margen) * DEG_TO_RAD;
  const aFin = (Math.max(angA, angB) + margen) * DEG_TO_RAD;

  // Radio configurable, pero acotado a la banda visible entre los puntos
  // de los astros y el anillo de color: fuera de ahí el puente se pierde.
  const rMin = layout.radioAstrosPunto + Math.max(4, 6 * layout.escala);
  const rMax = layout.radioColorInterior - Math.max(2, 3 * layout.escala);
  const radioArco = clamp((THEME.aspectos.radioConjuncion || 200) * layout.escala,
                          Math.min(rMin, rMax), Math.max(rMin, rMax));

  noFill();
  stroke(colorArco);
  strokeWeight(grosor * 1.4);  // un poco más grueso para destacar
  arc(0, 0, radioArco * 2, radioArco * 2, aIni, aFin);

  // Patitas del puente: bajan del arco a cada astro, que es lo que hace
  // evidente QUÉ dos astros están conectados cuando casi se superponen.
  strokeWeight(grosor);
  lineaEntreRadios(angA * DEG_TO_RAD, layout.radioAstrosPunto, radioArco);
  lineaEntreRadios(angB * DEG_TO_RAD, layout.radioAstrosPunto, radioArco);
}

function dibujarAspectos(layout, astros) {
  if (!THEME.aspectos.mostrar) return;

  const orbe = THEME.aspectos.orbe;
  const grosor = Math.max(0.5, THEME.aspectos.grosor * layout.escala);
  const limite = Math.min(10, astros.length);

  for (let i = 0; i < limite; i++) {
    const pos1 = posicionZodiacalVisual(astros[i].signo, astros[i].grado, astros[i].minuto);
    const ang1 = anguloVisualCartaDesdePosicion(pos1) * DEG_TO_RAD;
    const p1 = puntoEnRadio(ang1, layout.radioAspectos);

    for (let j = i + 1; j < limite; j++) {
      const pos2 = posicionZodiacalVisual(astros[j].signo, astros[j].grado, astros[j].minuto);
      const dist = distanciaAngular(pos1, pos2);
      const tipoAspecto = detectarAspectoAngulo(dist, orbe);

      if (tipoAspecto === null) continue;

      const colorAsp = obtenerColorAspecto(tipoAspecto);

      if (tipoAspecto === 0) {
        dibujarArcoConjuncion(layout, pos1, pos2, colorAsp, grosor);
      } else {
        const ang2 = anguloVisualCartaDesdePosicion(pos2) * DEG_TO_RAD;
        const p2 = puntoEnRadio(ang2, layout.radioAspectos);
        stroke(colorAsp);
        strokeWeight(grosor);
        line(p1.x, p1.y, p2.x, p2.y);
      }
    }
  }
}

// =========================================================
// Hit-testing para clic en planetas
// =========================================================

function detectarPlanetaEnPosicion(mx, my, layout, astros) {
  const dx = mx - layout.centroX;
  const dy = my - layout.centroY;
  const radioClic = Math.max(10, THEME.astros.tamanoPunto * layout.escala * 1.5);

  for (let i = 0; i < Math.min(10, astros.length); i++) {
    const a = astros[i];
    const angDeg = anguloVisualCarta(a.signo, a.grado, a.minuto);
    const ang = angDeg * DEG_TO_RAD;
    const p = puntoEnRadio(ang, radioAstrosPunto(layout));

    const d = Math.sqrt((dx - p.x) ** 2 + (dy - p.y) ** 2);
    if (d < radioClic) return i;
  }
  return -1;
}

function dibujarBannerError(layout, mensaje) {
  push();
  resetMatrix();

  const x = 12;
  const y = 12;
  const w = layout.canvasW - 24;
  const h = 38;

  noStroke();
  fill(220, 40, 40, 230);
  rect(x, y, w, h, 6);

  fill(255);
  textAlign(LEFT, CENTER);
  textSize(13);
  text("⚠ Error de cálculo: " + mensaje, x + 12, y + h * 0.5);
  pop();
}
