// =========================================================
// wheel.js — dibujo de la rueda musical
// =========================================================
// Valores visuales editables a través de THEME
//
// Orientación: Aries empieza en las "5:00" del reloj y los
// sectores avanzan CONTRA reloj (ver anguloVisualCartaDesdePosicion).
// =========================================================

// Ángulo de canvas (radianes) del CENTRO del sector i (0-11)
function anguloCentroSector(i) {
  return anguloVisualCartaDesdePosicion(i * 30 + 15) * DEG_TO_RAD;
}

// -------------- Signos (fijos: Aries en sector 0) --------------
function dibujarSignos(layout) {
  if (!THEME.signos.mostrar) return;

  fill(THEME.signos.color);
  noStroke();
  textSize(Math.max(8, THEME.signos.tamano * layout.escala));
  textAlign(CENTER, CENTER);

  for (let i = 0; i < NUM_NOTAS; i++) {
    const angle = anguloCentroSector(i);
    const p = puntoEnRadio(angle, layout.radioSignos);

    push();
    translate(p.x, p.y);
    // Rotación tangencial según el lado del círculo para legibilidad
    const cosA = Math.cos(angle);
    if (cosA > 0.35) rotate(angle + HALF_PI);
    else if (cosA < -0.35) rotate(angle - HALF_PI);
    text(SIGNOS_BASE[i], 0, 0);
    pop();
  }
}

// -------------- Notas (según ordenActual: raíz + intervalo) --------------
function dibujarNotas(layout) {
  if (!THEME.notas.mostrar) return;

  fill(THEME.notas.color);
  noStroke();
  textSize(Math.max(6, THEME.notas.tamano * layout.escala));
  textAlign(CENTER, CENTER);

  for (let i = 0; i < NUM_NOTAS; i++) {
    const idx = ordenActual[i];
    const angle = anguloCentroSector(i);
    const p = puntoEnRadio(angle, layout.radioNotas);
    text(NOTAS_BASE[idx], p.x, p.y);
  }
}

// -------------- Frecuencias de las notas --------------
function dibujarFrecuenciasNotas(layout) {
  if (!THEME.frecNotas.mostrar) return;

  fill(THEME.frecNotas.color);
  noStroke();
  textSize(Math.max(5, THEME.frecNotas.tamano * layout.escala));
  textAlign(CENTER, CENTER);

  for (let i = 0; i < NUM_NOTAS; i++) {
    const idx = ordenActual[i];
    const frec = FRECUENCIA_BASE * Math.pow(2, idx / 12);
    const angle = anguloCentroSector(i);
    const p = puntoEnRadio(angle, layout.radioFrecuenciaNotas);

    text(frec.toFixed(2), p.x, p.y);
  }
}

// -------------- Frecuencias microtonales --------------
function dibujarFrecuenciasMicrotonales(layout) {
  if (!THEME.frecMicro.mostrar) return;

  fill(THEME.frecMicro.color);
  noStroke();
  textSize(Math.max(4, THEME.frecMicro.tamano * layout.escala));
  textAlign(CENTER, CENTER);

  for (let i = 0; i < numMicrotonos; i++) {
    const frec = frecuenciaMicrotonoVisual(i);
    const angle = anguloVisualCartaDesdePosicion((i + 0.5) * gradosPorMicrotono) * DEG_TO_RAD;
    const p = puntoEnRadio(angle, layout.radioFrecuenciaExterior);

    text(frec.toFixed(4), p.x, p.y);
  }
}

// -------------- Líneas de grados externas --------------
function dibujarGradosExteriores(layout) {
  if (!THEME.guias.mostrarGradosExternos) return;

  stroke(THEME.guias.colorGrados);
  strokeWeight(THEME.guias.grosorGrados);

  for (let i = 0; i < 360; i++) {
    const angle = anguloVisualCartaDesdePosicion(i) * DEG_TO_RAD;
    lineaEntreRadios(angle, layout.radioGradosExteriorA, layout.radioGradosExteriorB);
  }
}

// -------------- Líneas de grados internas --------------
function dibujarGradosInteriores(layout) {
  if (!THEME.guias.mostrarGradosInternos) return;

  stroke(THEME.guias.colorGrados);
  strokeWeight(THEME.guias.grosorGrados);

  for (let i = 0; i < 360; i++) {
    const angle = anguloVisualCartaDesdePosicion(i) * DEG_TO_RAD;
    lineaEntreRadios(angle, layout.radioGradosInteriorA, layout.radioGradosInteriorB);
  }
}

// -------------- Divisiones principales (límites de signo, cada 30°) --------------
function dibujarDivisionesPrincipales(layout) {
  const grosor = Math.max(1, THEME.divisiones.grosor * layout.escala);

  for (let i = 0; i < 360; i += 30) {
    const angle = anguloVisualCartaDesdePosicion(i) * DEG_TO_RAD;

    stroke(THEME.divisiones.color);
    strokeWeight(grosor);
    lineaEntreRadios(angle, layout.radioCasaInteriorB, layout.radioExteriorGrande);

    stroke(colorTema(THEME.divisiones.color, 0.6));
    lineaEntreRadios(angle, layout.radioColorInterior, layout.radioExteriorGrande);
  }
}

// -------------- Margen de las notas que suenan --------------
// Al igual que los planetas se remarcan con un anillo al sonar,
// la región tonal (nota) que se está ejecutando recibe un margen:
// naranja para envelope/secuencia, verde para drone.
function dibujarRegionesSonando(layout, astros) {
  if (typeof synth === "undefined" || !synth.enabled) return;
  if (typeof astroSonando !== "function") return;

  const limite = Math.min(10, astros.length);
  const rExt = layout.radioColorExterior;
  const rInt = layout.radioColorInterior;
  const grosor = Math.max(2, 3 * layout.escala);

  noFill();
  strokeWeight(grosor);

  for (let i = 0; i < limite; i++) {
    if (!astroSonando(i)) continue;

    const region = synth.microtonoDeAstro(i, astros);
    if (region < 0) continue;

    const momentaneo = synth.envelopeActiva[i] || synth.sonandoEnSecuencia(i);
    stroke(momentaneo ? "#ffaa00" : THEME.aspectos.colorTrigono);

    // Sector de la región: bordes angulares (contra reloj, ángulo decreciente)
    const a1 = anguloVisualCartaDesdePosicion((region + 1) * gradosPorMicrotono) * DEG_TO_RAD;
    const a2 = anguloVisualCartaDesdePosicion(region * gradosPorMicrotono) * DEG_TO_RAD;

    arc(0, 0, rExt * 2, rExt * 2, a1, a2);
    arc(0, 0, rInt * 2, rInt * 2, a1, a2);
    lineaEntreRadios(a1, rInt, rExt);
    lineaEntreRadios(a2, rInt, rExt);
  }
}

// -------------- Líneas microtonales --------------
function dibujarMicrotonos(layout) {
  if (!THEME.microtonos.mostrarLineas) return;

  const grosorExt = Math.max(0.5, THEME.microtonos.grosorLineas * layout.escala);
  const grosorInt = Math.max(0.5, THEME.microtonos.grosorLineasInternas * layout.escala);

  for (let i = 0; i < numMicrotonos; i++) {
    const angle = anguloVisualCartaDesdePosicion(i * gradosPorMicrotono) * DEG_TO_RAD;

    stroke(THEME.microtonos.colorLineas);
    strokeWeight(grosorExt);
    lineaEntreRadios(angle, layout.radioMicrotonosA, layout.radioMicrotonosB);

    strokeWeight(grosorInt);
    lineaEntreRadios(angle, layout.radioCasaInteriorB, layout.radioColorInterior);
  }
}
