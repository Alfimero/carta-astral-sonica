// =========================================================
// views.js — vistas alternativas: Sistema solar y Observatorio
// =========================================================
//
// La carta astral es la vista principal. De fondo puede dibujarse:
//   - "sistema":      sistema solar heliocéntrico en tiempo real,
//                     con las líneas de conexión de cada astro a la Tierra.
//   - "observatorio": los astros vistos desde la Tierra (panorama
//                     azimut/altitud) con cámara arrastrable.
// Con una vista de fondo activa, la carta se minimiza en una ventana
// circular movible y redimensionable con opacidad ajustable.
// =========================================================

const VISTAS_STORAGE_KEY = "cas-vistas-v1";

const estadoVistas = {
  fondo: "ninguno",       // "ninguno" | "sistema" | "observatorio"
  mostrarCarta: true,

  // Cámara del observatorio (arrastrar para girar la vista)
  camAz: 180,             // azimut centrado en pantalla
  camY: 0,                // desplazamiento vertical del horizonte (px)

  // Mini ventana de la carta cuando hay vista de fondo
  mini: { x: 16, y: 64, tam: 280, opacidad: 0.92 },

  // Opacidad del panel lateral: con menos de 1 el panel flota
  // sobre el canvas (que pasa a ancho completo) con fondo translúcido
  panelOpacidad: 1,

  // Cámara del Sistema solar: zoom hacia el cursor + paneo arrastrando
  sis: { zoom: 1, panX: 0, panY: 0 },

  // Trazos persistentes del Sistema solar (los puntos no se persisten)
  trazosActivos: new Array(10).fill(false),
  trazosDuracion: 60,  // segundos; 0 = permanente
  trazosModo: "orbita" // "orbita" (estela por astro) | "vertice" (centroide de 2+ astros)
};

const TRAZOS_MAX_PUNTOS = 1500;

// Puntos de los trazos por astro: {lon, au, t} (la Luna guarda además
// la posición de la Tierra de ese instante)
const _trazosPuntos = Array.from({ length: 10 }, () => []);

// Instantáneas del modo vértice: {puntos: [{i, lon, au} | {i:1, lon, lonT, auT}], t}
// Se guardan las posiciones de los astros (no el vértice en px) para que
// el centroide se recalcule coherente con el layout y el zoom de cámara.
const _trazosVertice = [];

function guardarVistas() {
  try {
    localStorage.setItem(VISTAS_STORAGE_KEY, JSON.stringify({
      mini: estadoVistas.mini,
      camAz: estadoVistas.camAz,
      camY: estadoVistas.camY,
      panelOpacidad: estadoVistas.panelOpacidad,
      sis: estadoVistas.sis,
      trazosActivos: estadoVistas.trazosActivos,
      trazosDuracion: estadoVistas.trazosDuracion,
      trazosModo: estadoVistas.trazosModo
    }));
  } catch (e) {}
}

function cargarVistas() {
  try {
    const raw = localStorage.getItem(VISTAS_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.mini && typeof data.mini === "object") {
      const m = data.mini;
      if (typeof m.x === "number") estadoVistas.mini.x = m.x;
      if (typeof m.y === "number") estadoVistas.mini.y = m.y;
      if (typeof m.tam === "number") estadoVistas.mini.tam = clamp(m.tam, 120, 800);
      if (typeof m.opacidad === "number") estadoVistas.mini.opacidad = clamp(m.opacidad, 0.15, 1);
    }
    if (typeof data.camAz === "number") estadoVistas.camAz = ((data.camAz % 360) + 360) % 360;
    if (typeof data.camY === "number") estadoVistas.camY = data.camY;
    if (typeof data.panelOpacidad === "number") estadoVistas.panelOpacidad = clamp(data.panelOpacidad, 0.25, 1);
    if (data.sis && typeof data.sis === "object") {
      if (typeof data.sis.zoom === "number") estadoVistas.sis.zoom = clamp(data.sis.zoom, 0.4, 120);
      if (typeof data.sis.panX === "number") estadoVistas.sis.panX = data.sis.panX;
      if (typeof data.sis.panY === "number") estadoVistas.sis.panY = data.sis.panY;
    }
    if (Array.isArray(data.trazosActivos) && data.trazosActivos.length === 10) {
      estadoVistas.trazosActivos = data.trazosActivos.map(v => !!v);
    }
    if (typeof data.trazosDuracion === "number") {
      estadoVistas.trazosDuracion = clamp(Math.round(data.trazosDuracion), 0, 86400);
    }
    if (data.trazosModo === "orbita" || data.trazosModo === "vertice") {
      estadoVistas.trazosModo = data.trazosModo;
    }
  } catch (e) {}
}
cargarVistas();

// Datos precalculados (se actualizan junto con la carta, no por frame)
const datosVistas = {
  valido: false,
  helio: [],          // índices 2..9 (Mercurio..Plutón): {lon, au}
  tierra: null,       // {lon, au}
  lunaGeoLon: 0,
  solAltitud: 0,
  horizontal: [],     // índices 0..9: {az, alt}
  estrellas: []       // {az, alt, brillo, tam} para el observatorio
};

const CUERPOS_HELIO = [null, null, "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const CUERPOS_GEO   = ["Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"];
const AU_MEDIO      = [0, 0, 0.39, 0.72, 1.52, 5.20, 9.54, 19.19, 30.07, 39.48];
const AU_TIERRA     = 1.0;
const AU_MAXIMO     = 41;

// ---- Firmamento: catálogo pseudoaleatorio fijo de estrellas ----
// Cada estrella tiene RA/Dec reales, así en el observatorio rotan con
// el cielo (hora sidérea) y se mueven al girar la cámara.
const ESTRELLAS = (() => {
  const arr = [];
  let s = 987654321;
  const rnd = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  for (let i = 0; i < 340; i++) {
    arr.push({
      ra: rnd() * 360,
      dec: Math.asin(rnd() * 2 - 1) * RAD_TO_DEG,
      brillo: 0.25 + rnd() * 0.75,
      tam: 0.6 + rnd() * 1.7
    });
  }
  return arr;
})();

function calcularDatosVistas() {
  if (typeof Astronomy === "undefined") { datosVistas.valido = false; return; }
  if (estadoVistas.fondo === "ninguno") return;

  try {
    const fecha = estado.fechaUTC;

    // ---- Sistema solar (heliocéntrico) ----
    datosVistas.helio = [];
    for (let i = 2; i < 10; i++) {
      const vec = Astronomy.HelioVector(Astronomy.Body[CUERPOS_HELIO[i]], fecha);
      const ecl = Astronomy.Ecliptic(vec);
      let lon = ecl.elon;
      if (lon < 0) lon += 360;
      const au = Math.sqrt(vec.x * vec.x + vec.y * vec.y + vec.z * vec.z);
      datosVistas.helio[i] = { lon, au };
    }
    const vecT = Astronomy.HelioVector(Astronomy.Body.Earth, fecha);
    const eclT = Astronomy.Ecliptic(vecT);
    let lonT = eclT.elon;
    if (lonT < 0) lonT += 360;
    datosVistas.tierra = { lon: lonT, au: Math.sqrt(vecT.x ** 2 + vecT.y ** 2 + vecT.z ** 2) };

    if (estado.astros[1]) {
      datosVistas.lunaGeoLon = posicionZodiacal(estado.astros[1].signo, estado.astros[1].grado, estado.astros[1].minuto);
    }

    // ---- Observatorio (horizontal desde la ubicación) ----
    const observer = new Astronomy.Observer(estado.latitud, estado.longitud, 0);
    datosVistas.horizontal = [];
    for (let i = 0; i < 10; i++) {
      const eq = Astronomy.Equator(Astronomy.Body[CUERPOS_GEO[i]], fecha, observer, true, true);
      const hor = Astronomy.Horizon(fecha, observer, eq.ra, eq.dec, "normal");
      datosVistas.horizontal[i] = { az: hor.azimuth, alt: hor.altitude };
    }
    datosVistas.solAltitud = datosVistas.horizontal[0].alt;

    // ---- Estrellas: RA/Dec → alt/az con la hora sidérea local ----
    const gmst = Astronomy.SiderealTime(fecha) * 15;
    let lst = (gmst + estado.longitud) % 360;
    if (lst < 0) lst += 360;
    const lat = estado.latitud * DEG_TO_RAD;
    const sinLat = Math.sin(lat), cosLat = Math.cos(lat);

    datosVistas.estrellas = ESTRELLAS.map(e => {
      const ha = (lst - e.ra) * DEG_TO_RAD;
      const dec = e.dec * DEG_TO_RAD;
      const sinAlt = Math.sin(dec) * sinLat + Math.cos(dec) * cosLat * Math.cos(ha);
      const alt = Math.asin(clamp(sinAlt, -1, 1)) * RAD_TO_DEG;
      // Azimut desde el norte, hacia el este
      let az = Math.atan2(Math.sin(ha), Math.cos(ha) * sinLat - Math.tan(dec) * cosLat) * RAD_TO_DEG + 180;
      az = ((az % 360) + 360) % 360;
      return { az, alt, brillo: e.brillo, tam: e.tam };
    });

    datosVistas.valido = true;
    capturarTrazos();
  } catch (err) {
    console.warn("[views] no se pudieron calcular las vistas:", err);
    datosVistas.valido = false;
  }
}

// =========================================================
// Trazos persistentes: cada actualización de la carta agrega un punto
// (en coordenadas de mundo lon/au, compatibles con el zoom)
// =========================================================

function capturarTrazos() {
  if (estadoVistas.fondo !== "sistema") return;
  const t = Date.now();

  if (estadoVistas.trazosModo === "vertice") {
    capturarVertice(t);
    return;
  }

  for (let i = 1; i < 10; i++) {
    if (!estadoVistas.trazosActivos[i]) continue;

    const punto = posicionTrazoAstro(i);
    if (!punto) continue;
    punto.t = t;

    const arr = _trazosPuntos[i];
    const ult = arr[arr.length - 1];
    if (ult) {
      const dl = Math.abs(ult.lon - punto.lon);
      if (Math.min(dl, 360 - dl) < 0.05) continue;  // casi no se movió
    }
    arr.push(punto);
    if (arr.length > TRAZOS_MAX_PUNTOS) arr.splice(0, arr.length - TRAZOS_MAX_PUNTOS);
  }
}

// Posición actual del astro i en coordenadas de mundo (lon/au).
// La Luna necesita la Tierra de ese instante (su órbita es exagerada).
function posicionTrazoAstro(i) {
  if (i === 1) {
    if (!datosVistas.tierra) return null;
    return { i, lonT: datosVistas.tierra.lon, auT: datosVistas.tierra.au, lon: datosVistas.lunaGeoLon };
  }
  const d = datosVistas.helio[i];
  return d ? { i, lon: d.lon, au: d.au } : null;
}

// Modo vértice: guarda una instantánea con las posiciones de todos los
// astros marcados; el vértice (centroide) se calcula al dibujar.
function capturarVertice(t) {
  const puntos = [];
  for (let i = 1; i < 10; i++) {
    if (!estadoVistas.trazosActivos[i]) continue;
    const p = posicionTrazoAstro(i);
    if (p) puntos.push(p);
  }
  if (puntos.length < 2) return;  // el vértice necesita 2+ astros

  const ult = _trazosVertice[_trazosVertice.length - 1];
  if (ult && ult.puntos.length === puntos.length) {
    let seMovio = false;
    for (let k = 0; k < puntos.length; k++) {
      const dl = Math.abs(ult.puntos[k].lon - puntos[k].lon);
      if (ult.puntos[k].i !== puntos[k].i || Math.min(dl, 360 - dl) >= 0.05) {
        seMovio = true;
        break;
      }
    }
    if (!seMovio) return;
  }
  _trazosVertice.push({ puntos, t });
  if (_trazosVertice.length > TRAZOS_MAX_PUNTOS) {
    _trazosVertice.splice(0, _trazosVertice.length - TRAZOS_MAX_PUNTOS);
  }
}

function limpiarTrazos() {
  for (const arr of _trazosPuntos) arr.length = 0;
  _trazosVertice.length = 0;
}

// =========================================================
// Cámara del Sistema solar: zoom hacia el cursor y paneo
// =========================================================

function zoomSistemaEn(mx, my, delta) {
  const s = estadoVistas.sis;
  const nuevo = clamp(s.zoom * Math.pow(1.0015, -delta), 0.4, 120);
  const cx = width * 0.5, cy = height * 0.5;
  // Mantener fijo el punto de mundo que está bajo el cursor
  const wx = (mx - cx - s.panX) / s.zoom;
  const wy = (my - cy - s.panY) / s.zoom;
  s.zoom = nuevo;
  s.panX = mx - cx - wx * nuevo;
  s.panY = my - cy - wy * nuevo;
  guardarVistas();
}

function restablecerCamaraSistema() {
  estadoVistas.sis.zoom = 1;
  estadoVistas.sis.panX = 0;
  estadoVistas.sis.panY = 0;
  guardarVistas();
}

// ¿El astro i está sonando ahora mismo?
// soloSecuenciador1: ignora el Secuenciador 2 (las filas del panel del
// Secuenciador 1 solo deben marcar lo suyo; la rueda marca ambos).
function astroSonando(i, soloSecuenciador1) {
  if (typeof synth === "undefined" || !synth.enabled) return false;
  if (!soloSecuenciador1 && typeof secuenciador2 !== "undefined" && secuenciador2.sonando(i)) return true;
  if (synth.envelopeActiva[i]) return true;
  if (synth.secuenciaActiva) return synth.sonandoEnSecuencia(i);
  if (synth.modoReproduccion === "acorde" && synth.modoTrigger === "drone") {
    // Los astros conectados por FM suenan en grupo
    return synth.grupoDeAstro(i).some(k => synth.planetEnabled[k]);
  }
  return false;
}

function colorAstroVista(i) {
  return (THEME.astros.coloresPorAstro && THEME.astros.coloresPorAstro[i])
    ? THEME.astros.coloresPorAstro[i]
    : COLORES_ASTROS_DEFAULT[i];
}

function dibujarGlowSonando(x, y, tam) {
  noFill();
  const pulso = 1 + 0.18 * Math.sin(millis() / 140);
  stroke(255, 196, 40, 230);
  strokeWeight(2.2);
  ellipse(x, y, tam * 2.2 * pulso, tam * 2.2 * pulso);
  stroke(255, 196, 40, 90);
  ellipse(x, y, tam * 3.2 * pulso, tam * 3.2 * pulso);
}

// =========================================================
// Cuerpos celestes: esferas con gradiente (o imagen real del tema)
// =========================================================

function _mezclaHex(hex, otro, t) {
  const p = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  try {
    const a = p(hex), b = p(otro);
    const c = lerpRGB(a, b, t);
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  } catch (e) {
    return hex;
  }
}

// Esfera sombreada con luz arriba-izquierda
function dibujarEsfera(x, y, r, baseHex) {
  const dc = drawingContext;
  const g = dc.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.15, x, y, r);
  g.addColorStop(0, _mezclaHex(baseHex, "#ffffff", 0.55));
  g.addColorStop(0.55, baseHex);
  g.addColorStop(1, _mezclaHex(baseHex, "#000000", 0.45));
  dc.fillStyle = g;
  dc.beginPath();
  dc.arc(x, y, r, 0, Math.PI * 2);
  dc.fill();
}

// Dibuja el astro i: usa la imagen real del tema si está cargada
// (dev.html → Astros → imagen), si no, render procedural.
function dibujarCuerpoAstro(i, x, y, r) {
  if (typeof astroImageCache !== "undefined" && astroImageCache[i]) {
    imageMode(CENTER);
    image(astroImageCache[i], x, y, r * 2.4, r * 2.4);
    return;
  }

  const dc = drawingContext;

  if (i === 0) {
    // Sol con corona luminosa
    const halo = dc.createRadialGradient(x, y, r * 0.2, x, y, r * 2.6);
    halo.addColorStop(0, "rgba(255,220,120,0.95)");
    halo.addColorStop(0.35, "rgba(255,180,60,0.5)");
    halo.addColorStop(1, "rgba(255,160,40,0)");
    dc.fillStyle = halo;
    dc.beginPath();
    dc.arc(x, y, r * 2.6, 0, Math.PI * 2);
    dc.fill();

    const cuerpo = dc.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    cuerpo.addColorStop(0, "#fff6d8");
    cuerpo.addColorStop(0.6, "#ffd24a");
    cuerpo.addColorStop(1, "#e89b1c");
    dc.fillStyle = cuerpo;
    dc.beginPath();
    dc.arc(x, y, r, 0, Math.PI * 2);
    dc.fill();
    return;
  }

  dibujarEsfera(x, y, r, colorAstroVista(i));

  if (i === 6) {
    // Anillos de Saturno
    push();
    translate(x, y);
    rotate(-0.45);
    noFill();
    stroke(216, 196, 150, 210);
    strokeWeight(Math.max(1.5, r * 0.22));
    ellipse(0, 0, r * 3.1, r * 1.15);
    pop();
  }
}

// =========================================================
// VISTA: Sistema solar
// =========================================================

function radioOrbitaPx(au, rMax) {
  return rMax * Math.pow(au / AU_MAXIMO, 0.4);
}

function dibujarVistaSistemaSolar(layout) {
  if (!datosVistas.valido || !datosVistas.tierra) return;

  const w = layout.canvasW, h = layout.canvasH;

  // Fondo espacial con estrellas
  noStroke();
  fill(6, 9, 22);
  rect(0, 0, w, h);

  noStroke();
  for (let k = 0; k < ESTRELLAS.length; k++) {
    const e = ESTRELLAS[k];
    const x = (e.ra / 360) * w;
    const y = ((e.dec + 90) / 180) * h;
    const titileo = 0.78 + 0.22 * Math.sin(millis() / 420 + k * 1.7);
    fill(225, 232, 255, e.brillo * 215 * titileo);
    ellipse(x, y, e.tam, e.tam);
  }

  push();
  // Cámara: paneo + zoom alrededor del centro (el mundo escala, los
  // textos se compensan para no crecer más de 2× en pantalla)
  const cam = estadoVistas.sis;
  const z = cam.zoom;
  const compensa = Math.min(1, 2 / z);
  translate(w * 0.5 + cam.panX, h * 0.5 + cam.panY);
  scale(z);

  const rMax = Math.min(w, h) * 0.46;

  // Órbitas medias
  noFill();
  stroke(120, 140, 190, 50);
  strokeWeight(1 * compensa);
  for (let i = 2; i < 10; i++) {
    const r = radioOrbitaPx(AU_MEDIO[i], rMax);
    ellipse(0, 0, r * 2, r * 2);
  }
  const rOrbT = radioOrbitaPx(AU_TIERRA, rMax);
  stroke(110, 190, 255, 80);
  ellipse(0, 0, rOrbT * 2, rOrbT * 2);

  const puntoHelio = (lon, au) => {
    const ang = -lon * DEG_TO_RAD;
    const r = radioOrbitaPx(au, rMax);
    return { x: Math.cos(ang) * r, y: Math.sin(ang) * r };
  };

  // Estelas de los astros seleccionados
  dibujarTrazosSistema(puntoHelio, layout, compensa);

  const pTierra = puntoHelio(datosVistas.tierra.lon, datosVistas.tierra.au);

  // Líneas de conexión Tierra ↔ astros
  strokeWeight(1.2 * compensa);
  stroke(astroSonando(0) ? color(255, 196, 40, 220) : color(170, 180, 210, 70));
  line(pTierra.x, pTierra.y, 0, 0);
  for (let i = 2; i < 10; i++) {
    const d = datosVistas.helio[i];
    if (!d) continue;
    const p = puntoHelio(d.lon, d.au);
    stroke(astroSonando(i) ? color(255, 196, 40, 220) : color(170, 180, 210, 55));
    line(pTierra.x, pTierra.y, p.x, p.y);
  }

  textAlign(CENTER, CENTER);

  // Sol al centro (astro 0)
  const rSol = Math.max(14, 22 * layout.escala);
  dibujarCuerpoAstro(0, 0, 0, rSol);
  if (astroSonando(0)) dibujarGlowSonando(0, 0, rSol);
  fill(235);
  noStroke();
  textSize(Math.max(9, 12 * layout.escala) * compensa);
  text("☉ Sol", 0, rSol * 2.6 + 4);

  // Tierra
  const rT = Math.max(8, 12 * layout.escala);
  dibujarEsfera(pTierra.x, pTierra.y, rT, "#3f86d8");
  fill(235);
  noStroke();
  text("Tierra", pTierra.x, pTierra.y + rT + 12);

  // Luna (astro 1): órbita exagerada según su longitud geocéntrica real
  const angLuna = -datosVistas.lunaGeoLon * DEG_TO_RAD;
  const rOrbLuna = Math.max(20, 28 * layout.escala);
  const pLuna = { x: pTierra.x + Math.cos(angLuna) * rOrbLuna, y: pTierra.y + Math.sin(angLuna) * rOrbLuna };
  const rLuna = Math.max(5, 7 * layout.escala);
  dibujarCuerpoAstro(1, pLuna.x, pLuna.y, rLuna);
  if (astroSonando(1)) dibujarGlowSonando(pLuna.x, pLuna.y, rLuna);

  // Planetas
  for (let i = 2; i < 10; i++) {
    const d = datosVistas.helio[i];
    if (!d) continue;
    const p = puntoHelio(d.lon, d.au);
    const r = Math.max(7, 11 * layout.escala);
    dibujarCuerpoAstro(i, p.x, p.y, r);
    if (astroSonando(i)) dibujarGlowSonando(p.x, p.y, r);
    fill(222);
    noStroke();
    textSize(Math.max(8, 11 * layout.escala) * compensa);
    text(`${SIMBOLOS_ASTROS[i]} ${NOMBRES_ASTROS[i]}`, p.x, p.y + r + 13);
  }

  pop();
}

// Proyecta un punto de trazo (formato de posicionTrazoAstro) a px de mundo
function proyectarPuntoTrazo(pt, puntoHelio, rOrbLuna) {
  if (pt.i === 1) {
    const pT = puntoHelio(pt.lonT, pt.auT);
    const ang = -pt.lon * DEG_TO_RAD;
    return { x: pT.x + Math.cos(ang) * rOrbLuna, y: pT.y + Math.sin(ang) * rOrbLuna };
  }
  return puntoHelio(pt.lon, pt.au);
}

// Dibuja los trazos acumulados según el modo activo (dentro de la
// transformación de cámara). El alpha se desvanece con la edad del punto.
function dibujarTrazosSistema(puntoHelio, layout, compensa) {
  if (estadoVistas.trazosModo === "vertice") {
    dibujarTrazosVertice(puntoHelio, layout, compensa);
    return;
  }

  const ahora = Date.now();
  const durMs = estadoVistas.trazosDuracion * 1000;
  const rOrbLuna = Math.max(20, 28 * layout.escala);

  for (let i = 1; i < 10; i++) {
    const arr = _trazosPuntos[i];
    // Purgar puntos vencidos (con duración 0 son permanentes)
    if (durMs > 0) {
      while (arr.length && ahora - arr[0].t > durMs) arr.shift();
    }
    if (arr.length < 2) continue;

    const c = color(colorAstroVista(i));
    const cr = red(c), cg = green(c), cb = blue(c);
    strokeWeight(1.6 * compensa);
    noFill();

    let prev = null;
    for (let k = 0; k < arr.length; k++) {
      const pt = arr[k];
      const p = proyectarPuntoTrazo(pt, puntoHelio, rOrbLuna);
      if (prev) {
        const alpha = durMs > 0 ? 40 + 190 * (1 - (ahora - pt.t) / durMs) : 180;
        stroke(cr, cg, cb, alpha);
        line(prev.x, prev.y, p.x, p.y);
      }
      prev = p;
    }
  }
}

// Modo vértice: traza el recorrido del centroide de los astros marcados.
// Además dibuja el polígono actual (líneas astro → vértice) y un marcador.
function dibujarTrazosVertice(puntoHelio, layout, compensa) {
  const ahora = Date.now();
  const durMs = estadoVistas.trazosDuracion * 1000;
  const rOrbLuna = Math.max(20, 28 * layout.escala);
  const arr = _trazosVertice;

  if (durMs > 0) {
    while (arr.length && ahora - arr[0].t > durMs) arr.shift();
  }
  if (!arr.length) return;

  const verticeDe = snap => {
    let sx = 0, sy = 0;
    for (const pt of snap.puntos) {
      const p = proyectarPuntoTrazo(pt, puntoHelio, rOrbLuna);
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / snap.puntos.length, y: sy / snap.puntos.length };
  };

  // Color del vértice: mezcla de los colores de los astros participantes
  const ultimo = arr[arr.length - 1];
  let cr = 0, cg = 0, cb = 0;
  for (const pt of ultimo.puntos) {
    const c = color(colorAstroVista(pt.i));
    cr += red(c); cg += green(c); cb += blue(c);
  }
  cr /= ultimo.puntos.length;
  cg /= ultimo.puntos.length;
  cb /= ultimo.puntos.length;

  // Recorrido del vértice
  strokeWeight(1.8 * compensa);
  noFill();
  let prev = null;
  for (let k = 0; k < arr.length; k++) {
    const v = verticeDe(arr[k]);
    if (prev) {
      const alpha = durMs > 0 ? 40 + 190 * (1 - (ahora - arr[k].t) / durMs) : 180;
      stroke(cr, cg, cb, alpha);
      line(prev.x, prev.y, v.x, v.y);
    }
    prev = v;
  }

  // Polígono actual: líneas finas de cada astro al vértice + marcador ✦
  const vAct = prev;
  strokeWeight(0.9 * compensa);
  stroke(cr, cg, cb, 70);
  for (const pt of ultimo.puntos) {
    const p = proyectarPuntoTrazo(pt, puntoHelio, rOrbLuna);
    line(p.x, p.y, vAct.x, vAct.y);
  }
  push();
  translate(vAct.x, vAct.y);
  rotate(Math.PI / 4);
  noStroke();
  fill(cr, cg, cb, 230);
  const lado = 5 * compensa;
  rect(-lado / 2, -lado / 2, lado, lado);
  pop();
}

// =========================================================
// VISTA: Observatorio (panorama desde la Tierra, cámara arrastrable)
// =========================================================

// Paleta de cielo por altitud del Sol: de noche profunda a pleno día,
// con crepúsculos iridiscentes (azules → violetas → rosas → naranjas).
const PALETA_CIELO = [
  { alt: -90, arriba: [3, 5, 16],      abajo: [8, 11, 28] },
  { alt: -18, arriba: [3, 5, 16],      abajo: [8, 11, 28] },
  { alt: -12, arriba: [7, 10, 34],     abajo: [34, 28, 72] },
  { alt: -8,  arriba: [15, 19, 56],    abajo: [86, 50, 110] },
  { alt: -4,  arriba: [28, 40, 92],    abajo: [182, 88, 116] },
  { alt: 0,   arriba: [54, 80, 142],   abajo: [250, 146, 92] },
  { alt: 4,   arriba: [84, 126, 192],  abajo: [255, 192, 132] },
  { alt: 10,  arriba: [105, 162, 228], abajo: [206, 228, 248] },
  { alt: 90,  arriba: [110, 170, 235], abajo: [186, 218, 246] }
];

function coloresCielo(altSol) {
  for (let k = 0; k < PALETA_CIELO.length - 1; k++) {
    const a = PALETA_CIELO[k], b = PALETA_CIELO[k + 1];
    if (altSol >= a.alt && altSol <= b.alt) {
      const t = (altSol - a.alt) / (b.alt - a.alt);
      return {
        arriba: lerpRGB(a.arriba, b.arriba, t),
        abajo: lerpRGB(a.abajo, b.abajo, t)
      };
    }
  }
  const ultimo = PALETA_CIELO[PALETA_CIELO.length - 1];
  return { arriba: ultimo.arriba, abajo: ultimo.abajo };
}

function dibujarVistaObservatorio(layout) {
  if (!datosVistas.valido || datosVistas.horizontal.length === 0) return;

  const w = layout.canvasW, h = layout.canvasH;
  const dc = drawingContext;

  estadoVistas.camY = clamp(estadoVistas.camY, -h * 0.38, h * 0.26);
  const yHorizonte = h * 0.68 + estadoVistas.camY;

  // Proyección con cámara: camAz queda al centro de la pantalla
  const azAX = az => (((az - estadoVistas.camAz + 180) % 360 + 360) % 360) / 360 * w;
  const altAY = alt => {
    if (alt >= 0) return yHorizonte - (alt / 90) * (yHorizonte - h * 0.05);
    return yHorizonte + (-alt / 90) * (h - yHorizonte - h * 0.03);
  };

  // ---- Cielo: gradiente continuo según la altitud del Sol ----
  const altSol = datosVistas.solAltitud;
  const cielo = coloresCielo(altSol);
  const medio = lerpRGB(cielo.arriba, cielo.abajo, 0.55);

  const lg = dc.createLinearGradient(0, 0, 0, Math.max(1, yHorizonte));
  lg.addColorStop(0, `rgb(${cielo.arriba.join(",")})`);
  lg.addColorStop(0.55, `rgb(${medio.join(",")})`);
  lg.addColorStop(1, `rgb(${cielo.abajo.join(",")})`);
  dc.fillStyle = lg;
  dc.fillRect(0, 0, w, Math.max(1, yHorizonte));

  // ---- Resplandor iridiscente del amanecer/atardecer ----
  if (altSol > -10 && altSol < 12) {
    const fuerza = 1 - Math.abs(altSol - 1) / 11;  // máximo cerca del horizonte
    const sol = datosVistas.horizontal[0];
    const sx = azAX(sol.az);
    const sy = Math.min(altAY(Math.max(sol.alt, 0)), yHorizonte);
    const radio = w * 0.5;
    const glow = dc.createRadialGradient(sx, sy, 0, sx, sy, radio);
    glow.addColorStop(0,    `rgba(255,176,84,${0.55 * fuerza})`);
    glow.addColorStop(0.35, `rgba(255,120,140,${0.3 * fuerza})`);
    glow.addColorStop(0.65, `rgba(176,116,222,${0.18 * fuerza})`);
    glow.addColorStop(1,    "rgba(120,140,255,0)");
    dc.save();
    dc.globalCompositeOperation = "screen";
    dc.fillStyle = glow;
    dc.fillRect(0, 0, w, Math.max(1, yHorizonte));
    dc.restore();
  }

  // ---- Estrellas (aparecen con la noche, rotan con el cielo real) ----
  const factorNoche = clamp((-altSol - 2) / 8, 0, 1);
  if (factorNoche > 0.02) {
    noStroke();
    for (let k = 0; k < datosVistas.estrellas.length; k++) {
      const e = datosVistas.estrellas[k];
      if (e.alt < -1) continue;
      const x = azAX(e.az);
      const y = altAY(e.alt);
      if (y >= yHorizonte) continue;
      const titileo = 0.75 + 0.25 * Math.sin(millis() / 380 + k * 2.3);
      fill(228, 234, 255, e.brillo * 235 * factorNoche * titileo);
      ellipse(x, y, e.tam, e.tam);
    }
  }

  // ---- Suelo con gradiente ----
  const sueloAlto = factorNoche > 0.5 ? [16, 20, 17] : [30, 40, 30];
  const sueloBajo = factorNoche > 0.5 ? [8, 10, 9] : [16, 22, 16];
  const lgSuelo = dc.createLinearGradient(0, yHorizonte, 0, h);
  lgSuelo.addColorStop(0, `rgb(${sueloAlto.join(",")})`);
  lgSuelo.addColorStop(1, `rgb(${sueloBajo.join(",")})`);
  dc.fillStyle = lgSuelo;
  dc.fillRect(0, yHorizonte, w, h - yHorizonte);

  // ---- Horizonte y puntos cardinales ----
  stroke(200, 210, 230, 160);
  strokeWeight(1.5);
  line(0, yHorizonte, w, yHorizonte);

  textAlign(CENTER, CENTER);
  const cardinales = [["N", 0], ["NE", 45], ["E", 90], ["SE", 135], ["S", 180], ["SO", 225], ["O", 270], ["NO", 315]];
  for (const [nombre, az] of cardinales) {
    const x = azAX(az);
    noStroke();
    fill(220, 225, 240, nombre.length === 1 ? 210 : 130);
    textSize(Math.max(8, (nombre.length === 1 ? 12 : 9.5) * layout.escala));
    text(nombre, x, yHorizonte + 16);
    stroke(200, 210, 230, 90);
    line(x, yHorizonte - 6, x, yHorizonte + 4);
  }

  // Líneas de altitud cada 30°
  stroke(255, 255, 255, 26);
  strokeWeight(1);
  for (const alt of [30, 60]) {
    const y = altAY(alt);
    line(0, y, w, y);
  }

  // ---- Astros ----
  for (let i = 0; i < 10; i++) {
    const d = datosVistas.horizontal[i];
    if (!d) continue;
    const x = azAX(d.az);
    const y = altAY(d.alt);
    const visible = d.alt >= 0;
    const r = Math.max(7, (i === 0 ? 20 : i === 1 ? 14 : 11) * layout.escala);

    dc.save();
    dc.globalAlpha = visible ? 1 : 0.32;
    dibujarCuerpoAstro(i, x, y, r);
    dc.restore();

    if (astroSonando(i)) dibujarGlowSonando(x, y, r);

    noStroke();
    fill(visible ? color(238, 241, 252, 240) : color(168, 172, 192, 120));
    textSize(Math.max(8, 11 * layout.escala));
    text(`${SIMBOLOS_ASTROS[i]} ${NOMBRES_ASTROS[i]}`, x, y + r + 13);
    if (!visible) {
      textSize(Math.max(6.5, 8.5 * layout.escala));
      text("(bajo el horizonte)", x, y + r + 26);
    }
  }

  // Pista de interacción
  noStroke();
  fill(255, 255, 255, 90);
  textAlign(LEFT, BOTTOM);
  textSize(Math.max(8, 10 * layout.escala));
  text("⟷ arrastra para girar la vista · doble clic: centrar", 12, h - 10);
  textAlign(CENTER, CENTER);
}

// =========================================================
// Mini ventana de la carta (movible, redimensionable, con opacidad)
// =========================================================

let _miniBuffer = null;

// Copia la región cuadrada de la carta (ya dibujada en el canvas
// principal) a un buffer nativo para pegarla después con opacidad.
function copiarCartaABuffer(layout) {
  const dc = drawingContext;
  const d = (typeof pixelDensity === "function") ? pixelDensity() : 1;
  const lado = Math.min(layout.canvasW, layout.canvasH);
  const sx = layout.centroX - lado / 2;
  const sy = layout.centroY - lado / 2;

  if (!_miniBuffer) _miniBuffer = document.createElement("canvas");
  const ladoDev = Math.round(lado * d);
  if (_miniBuffer.width !== ladoDev || _miniBuffer.height !== ladoDev) {
    _miniBuffer.width = ladoDev;
    _miniBuffer.height = ladoDev;
  }
  const bctx = _miniBuffer.getContext("2d");
  bctx.clearRect(0, 0, ladoDev, ladoDev);
  bctx.drawImage(dc.canvas, sx * d, sy * d, ladoDev, ladoDev, 0, 0, ladoDev, ladoDev);
}

function dibujarMiniCarta(layout) {
  if (!_miniBuffer) return;
  const m = estadoVistas.mini;
  m.tam = clamp(m.tam, 120, Math.min(layout.canvasW, layout.canvasH));
  m.x = clamp(m.x, 4 - m.tam * 0.5, layout.canvasW - m.tam * 0.5);
  m.y = clamp(m.y, 4, layout.canvasH - m.tam * 0.5);

  const dc = drawingContext;
  const cx = m.x + m.tam / 2;
  const cy = m.y + m.tam / 2;

  // Carta recortada en círculo con la opacidad elegida
  dc.save();
  dc.globalAlpha = m.opacidad;
  dc.beginPath();
  dc.arc(cx, cy, m.tam / 2, 0, Math.PI * 2);
  dc.clip();
  dc.drawImage(_miniBuffer, m.x, m.y, m.tam, m.tam);
  dc.restore();

  // Borde
  noFill();
  stroke(255, 255, 255, 160);
  strokeWeight(1.5);
  ellipse(cx, cy, m.tam, m.tam);

  // Asa de redimensionar (45° abajo-derecha)
  const hx = cx + Math.SQRT1_2 * m.tam / 2;
  const hy = cy + Math.SQRT1_2 * m.tam / 2;
  fill(255, 255, 255, 235);
  stroke(70, 70, 70, 200);
  strokeWeight(1);
  ellipse(hx, hy, 13, 13);
  noStroke();
  fill(70);
  textSize(8);
  textAlign(CENTER, CENTER);
  text("⤡", hx, hy);
}

// ¿El mouse cae en la mini carta? → "resize" | "move" | null
function miniHit(mx, my) {
  if (!(estadoVistas.fondo !== "ninguno" && estadoVistas.mostrarCarta)) return null;
  const m = estadoVistas.mini;
  const cx = m.x + m.tam / 2;
  const cy = m.y + m.tam / 2;
  const hx = cx + Math.SQRT1_2 * m.tam / 2;
  const hy = cy + Math.SQRT1_2 * m.tam / 2;
  if (Math.hypot(mx - hx, my - hy) < 14) return "resize";
  if (Math.hypot(mx - cx, my - cy) <= m.tam / 2) return "move";
  return null;
}

// =========================================================
// UI de vistas
// =========================================================

function actualizarToolbarVistas() {
  const wrap = document.getElementById("mini-opacidad-wrap");
  if (wrap) {
    wrap.hidden = !(estadoVistas.fondo !== "ninguno" && estadoVistas.mostrarCarta);
  }
}

// Aplica la opacidad del panel lateral. Con opacidad < 1 el panel pasa
// a modo flotante sobre el canvas: fondos en rgba (con un mínimo para
// que las tarjetas sigan legibles) + blur de respaldo para el contraste.
function aplicarOpacidadPanel() {
  const a = clamp(estadoVistas.panelOpacidad, 0.25, 1);
  const flotante = a < 0.999;
  document.documentElement.style.setProperty("--panel-alpha", a.toFixed(2));
  document.documentElement.style.setProperty("--panel-section-alpha", (0.45 + 0.55 * a).toFixed(3));
  const cambioModo = document.body.classList.contains("panel-translucido") !== flotante;
  document.body.classList.toggle("panel-translucido", flotante);
  if (cambioModo && typeof onResize === "function") onResize();
}

function inicializarUIVistas() {
  const btnCarta = document.getElementById("btn-vista-carta");
  const selFondo = document.getElementById("select-vista-fondo");
  const btnPanel = document.getElementById("btn-panel-toggle");
  const opacidad = document.getElementById("mini-opacidad");
  const opacidadPanel = document.getElementById("panel-opacidad");

  if (btnCarta) {
    btnCarta.addEventListener("click", () => {
      estadoVistas.mostrarCarta = !estadoVistas.mostrarCarta;
      if (!estadoVistas.mostrarCarta && estadoVistas.fondo === "ninguno") {
        estadoVistas.fondo = "sistema";
        if (selFondo) selFondo.value = "sistema";
        calcularDatosVistas();
      }
      btnCarta.classList.toggle("activo", estadoVistas.mostrarCarta);
      actualizarToolbarVistas();
    });
  }

  if (selFondo) {
    selFondo.value = estadoVistas.fondo;
    selFondo.addEventListener("change", () => {
      estadoVistas.fondo = selFondo.value;
      if (estadoVistas.fondo !== "ninguno") calcularDatosVistas();
      if (estadoVistas.fondo === "ninguno" && !estadoVistas.mostrarCarta) {
        estadoVistas.mostrarCarta = true;
        if (btnCarta) btnCarta.classList.add("activo");
      }
      actualizarToolbarVistas();
    });
  }

  if (btnPanel) {
    btnPanel.addEventListener("click", () => {
      document.body.classList.toggle("panel-oculto");
      if (typeof onResize === "function") onResize();
    });
  }

  if (opacidad) {
    opacidad.value = estadoVistas.mini.opacidad;
    opacidad.addEventListener("input", e => {
      estadoVistas.mini.opacidad = clamp(parseFloat(e.target.value), 0.15, 1);
      guardarVistas();
    });
  }

  if (opacidadPanel) {
    opacidadPanel.value = estadoVistas.panelOpacidad;
    opacidadPanel.addEventListener("input", e => {
      estadoVistas.panelOpacidad = clamp(parseFloat(e.target.value), 0.25, 1);
      aplicarOpacidadPanel();
      guardarVistas();
    });
  }
  aplicarOpacidadPanel();

  inicializarUITrazos();
  actualizarToolbarVistas();
}

// Sección "Sistema solar": modo de trazo, astros, duración y limpiar
function inicializarUITrazos() {
  const cont = document.getElementById("trazos-astros");
  const dur = document.getElementById("trazos-duracion");
  const limpiar = document.getElementById("trazos-limpiar");
  if (!cont) return;

  const botonesModo = document.querySelectorAll("#trazos-modo button");
  botonesModo.forEach(btn => {
    btn.classList.toggle("activo", btn.dataset.modo === estadoVistas.trazosModo);
    btn.addEventListener("click", () => {
      estadoVistas.trazosModo = btn.dataset.modo;
      botonesModo.forEach(b => b.classList.toggle("activo", b === btn));
      guardarVistas();
    });
  });

  cont.innerHTML = "";
  for (let i = 1; i < 10; i++) {
    const lab = document.createElement("label");
    lab.className = "trazo-astro";
    lab.innerHTML = `<input type="checkbox" data-astro="${i}"${estadoVistas.trazosActivos[i] ? " checked" : ""}>
      <span style="color:${colorAstroVista(i)}">${SIMBOLOS_ASTROS[i]}</span> ${NOMBRES_ASTROS[i]}`;
    lab.querySelector("input").addEventListener("change", e => {
      estadoVistas.trazosActivos[i] = e.target.checked;
      guardarVistas();
    });
    cont.appendChild(lab);
  }

  if (dur) {
    dur.value = estadoVistas.trazosDuracion;
    dur.addEventListener("change", () => {
      const v = parseInt(dur.value, 10);
      estadoVistas.trazosDuracion = Number.isNaN(v) ? 0 : clamp(v, 0, 86400);
      dur.value = estadoVistas.trazosDuracion;
      guardarVistas();
    });
  }

  limpiar?.addEventListener("click", limpiarTrazos);
}
