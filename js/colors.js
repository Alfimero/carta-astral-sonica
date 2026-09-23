// =========================================================
// colors.js — mapeo frecuencia musical → frecuencia visible → RGB
// =========================================================
// Valores visuales editables a través de THEME.microtonos.*
// =========================================================

let numMicrotonos = 24;
let gradosPorMicrotono = GRADOS_OCTAVA / numMicrotonos;

function setNumMicrotonos(n) {
  numMicrotonos = clamp(n, MIN_MICROTONOS, MAX_MICROTONOS);
  gradosPorMicrotono = GRADOS_OCTAVA / numMicrotonos;
}

// Frecuencia musical asociada a un microtono visual i
function frecuenciaMicrotonoVisual(i) {
  const notasContinuas = (i / numMicrotonos) * NUM_NOTAS;
  let sectorVisual = Math.floor(notasContinuas);
  if (sectorVisual >= NUM_NOTAS) sectorVisual = NUM_NOTAS - 1;

  const fraccionDentroDelSector = notasContinuas - Math.floor(notasContinuas);
  const idxBase = ordenActual[sectorVisual];
  const semitonoContinuo = idxBase + fraccionDentroDelSector;

  return FRECUENCIA_BASE * Math.pow(2, semitonoContinuo / 12.0);
}

function frecuenciaVisibleMusical(f) {
  while (f < VISIBLE_MIN) f *= 2.0;
  while (f >= VISIBLE_MAX) f /= 2.0;
  return f;
}

function colorDesdeGradienteVisible(t) {
  t = clamp(t, 0, 1);

  const tramos = [
    [255, 0, 0],
    [255, 127, 0],
    [255, 255, 0],
    [0, 255, 0],
    [0, 255, 255],
    [0, 0, 255],
    [148, 0, 211]
  ];

  for (let i = 0; i < 6; i++) {
    const limSup = (i + 1) / 6;
    if (t < limSup) {
      const localT = (t - i / 6) * 6;
      return lerpRGB(tramos[i], tramos[i + 1], localT);
    }
  }
  return tramos[6];
}

// Color RGB de la región (microtono) i — usado también en el panel del synth
function colorRegionMicrotono(i) {
  return colorVisibleDesdeFrecuencia(frecuenciaMicrotonoVisual(i));
}

function colorVisibleDesdeFrecuencia(f) {
  const fNorm = frecuenciaVisibleMusical(f);
  const t = (fNorm - VISIBLE_MIN) / (VISIBLE_MAX - VISIBLE_MIN);
  return colorDesdeGradienteVisible(t);
}

function dibujarColoresMicrotonales(layout) {
  noStroke();

  const diametroExt = layout.radioColorExterior * 2;
  const diametroInt = layout.radioColorInterior * 2;

  const alpha = THEME.microtonos.opacidad * 255;

  for (let i = 0; i < numMicrotonos; i++) {
    const frec = frecuenciaMicrotonoVisual(i);
    const [r, g, b] = colorVisibleDesdeFrecuencia(frec);

    // Sector i en posiciones [i·g, (i+1)·g] → ángulos de canvas decrecientes
    const ang1 = anguloVisualCartaDesdePosicion((i + 1) * gradosPorMicrotono) * DEG_TO_RAD;
    const ang2 = anguloVisualCartaDesdePosicion(i * gradosPorMicrotono) * DEG_TO_RAD;

    fill(r, g, b, alpha);
    arc(0, 0, diametroExt, diametroExt, ang1, ang2, PIE);
  }

  // Tapa central usa el color de fondo del tema
  fill(THEME.background);
  ellipse(0, 0, diametroInt, diametroInt);
}
