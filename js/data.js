// =========================================================
// data.js — modelo de signos, notas y posiciones zodiacales
// =========================================================
//
// Los signos están FIJOS en la rueda (Aries en sector 0, contra
// reloj desde las 5:00). Lo que cambia es el orden de las NOTAS
// asignadas a las 12 regiones:
//   - notaRaiz: qué nota cae en Aries (0 = C ... 11 = B)
//   - intervaloOrden: salto en semitonos entre regiones (1 = cromático)
// =========================================================

let notaRaiz = 0;        // C en Aries por defecto
let intervaloOrden = 1;  // cromático ascendente por defecto

// Estado vivo del orden actual de notas (índices 0-11 sobre NOTAS_BASE)
let ordenActual = ORDEN_CROMATICO.slice();
let signosActual = SIGNOS_BASE.slice();

// Compatibilidad con el modo "círculo de quintas" (tecla M, bancos)
let modoQuintas = false;

// Genera las 12 notas partiendo de `raiz` con saltos de `intervalo`
// semitonos. Si el intervalo no es coprimo con 12 (2M, 3m, 3M, 6m...),
// al chocar con una nota ya usada se toma la siguiente libre cromática
// (técnica estándar de escalas de tonos enteros / simétricas).
function generarOrdenNotas(raiz, intervalo) {
  const orden = [];
  const usadas = new Array(12).fill(false);
  let actual = ((raiz % 12) + 12) % 12;

  for (let n = 0; n < 12; n++) {
    while (usadas[actual]) actual = (actual + 1) % 12;
    orden.push(actual);
    usadas[actual] = true;
    actual = (actual + intervalo) % 12;
  }
  return orden;
}

function actualizarModoMusical() {
  ordenActual = generarOrdenNotas(notaRaiz, intervaloOrden);
  signosActual = SIGNOS_BASE.slice();
  modoQuintas = (intervaloOrden === 7);
}

function setNotaRaiz(idx) {
  notaRaiz = clamp(Math.round(idx), 0, 11);
  actualizarModoMusical();
}

function setIntervaloOrden(semitonos) {
  const valido = INTERVALOS_ORDEN.some(iv => iv.semitonos === semitonos);
  intervaloOrden = valido ? semitonos : 1;
  actualizarModoMusical();
}

function nombreOrdenActual() {
  const iv = INTERVALOS_ORDEN.find(x => x.semitonos === intervaloOrden);
  const raizNombre = NOTAS_BASE[notaRaiz];
  const ivNombre = iv ? iv.nombre : "Cromático";
  return `${raizNombre} · ${ivNombre}`;
}

function indiceSigno(signo) {
  return SIGNOS_BASE.findIndex(
    s => s.toLowerCase() === signo.toLowerCase()
  );
}

// Posición lineal "cromática" 0-360 a partir de signo/grado/minuto
function posicionZodiacal(signo, grado, minuto) {
  const idx = indiceSigno(signo);
  if (idx === -1) return 0;
  return idx * 30.0 + grado + (minuto / 60.0);
}

// Posición VISUAL. Los signos ya no se reordenan, así que coincide
// con la posición zodiacal. Se mantiene la función por compatibilidad.
function posicionZodiacalVisual(signo, grado, minuto) {
  return posicionZodiacal(signo, grado, minuto);
}

// Convierte una longitud eclíptica 0-360 a {signo, grado, minuto}
function longitudASignoGradoMinuto(longitud) {
  let pos = longitud % 360;
  if (pos < 0) pos += 360;

  let idxSigno = Math.floor(pos / 30);
  const dentroDelSigno = pos - idxSigno * 30;

  let grado = Math.floor(dentroDelSigno);
  let minuto = Math.round((dentroDelSigno - grado) * 60);

  if (minuto >= 60) {
    minuto = 0;
    grado++;
  }
  if (grado >= 30) {
    grado = 0;
    idxSigno = (idxSigno + 1) % 12;
  }

  return {
    signo: SIGNOS_BASE[idxSigno],
    grado: grado,
    minuto: minuto
  };
}

// Para vista carta: convierte posición zodiacal a ángulo de pantalla.
// Aries 0° queda en las "5:00" del reloj (60° canvas) y las posiciones
// crecientes avanzan CONTRA reloj (ángulo de canvas decreciente).
function anguloVisualCartaDesdePosicion(posicion) {
  return ANGULO_INICIO_RUEDA - posicion;
}

function anguloVisualCarta(signo, grado, minuto) {
  return anguloVisualCartaDesdePosicion(posicionZodiacalVisual(signo, grado, minuto));
}
