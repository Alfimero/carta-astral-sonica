// =========================================================
// helpers.js — utilidades geométricas, de formato y matemáticas
// =========================================================

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

// ---- Geometría polar (port de PVector + puntoEnRadio) ----
function puntoEnRadio(angleRad, radio) {
  return {
    x: Math.cos(angleRad) * radio,
    y: Math.sin(angleRad) * radio
  };
}

function lineaEntreRadios(angleRad, radioA, radioB) {
  const p1 = puntoEnRadio(angleRad, radioA);
  const p2 = puntoEnRadio(angleRad, radioB);
  line(p1.x, p1.y, p2.x, p2.y);
}

// ---- Ángulos ----
function normalizarGrados(ang) {
  let v = ang % 360;
  if (v < 0) v += 360;
  return v;
}

function distanciaAngular(a, b) {
  let d = Math.abs(a - b);
  if (d > 180) d = 360 - d;
  return d;
}

// ---- Formato ----
function pad2(n) {
  return String(n).padStart(2, "0");
}

function pad4(n) {
  return String(n).padStart(4, "0");
}

function formatearPosicion(grado, minuto, signo) {
  return `${pad2(grado)}°${pad2(minuto)}' ${signo}`;
}

// Año astronómico → texto humano. Año 0 = 1 a.C., año -1 = 2 a.C.
function formatearAnio(anio) {
  if (anio <= 0) return `${1 - anio} a.C.`;
  return String(anio);
}

function formatearTimestamp(date) {
  return `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}/${formatearAnio(date.getUTCFullYear())} ` +
         `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`;
}

function formatearTimestampLocal(date, zonaHorariaHoras) {
  // date está en UTC, lo mostramos en la zona local del usuario
  const offsetMs = zonaHorariaHoras * 3600 * 1000;
  const local = new Date(date.getTime() + offsetMs);
  const zonaStr = formatearZonaHoraria(zonaHorariaHoras);
  return `${pad2(local.getUTCDate())}/${pad2(local.getUTCMonth() + 1)}/${formatearAnio(local.getUTCFullYear())} ` +
         `${pad2(local.getUTCHours())}:${pad2(local.getUTCMinutes())}:${pad2(local.getUTCSeconds())} UTC${zonaStr}`;
}

function formatearZonaHoraria(zona) {
  if (Math.abs(zona - Math.round(zona)) < 0.0001) {
    const z = Math.round(zona);
    return (z >= 0 ? "+" : "") + z;
  }
  const horas = Math.floor(Math.abs(zona));
  const minutos = Math.round((Math.abs(zona) - horas) * 60);
  const prefijo = zona >= 0 ? "+" : "-";
  return `${prefijo}${pad2(horas)}:${pad2(minutos)}`;
}

// ---- Conversión local → UTC ----
function fechaLocalAUTC(year, month, day, hour, minute, second, zonaHorariaHoras) {
  // En JS: Date.UTC trata los argumentos como UTC.
  // Si el usuario dice "12:00 con UTC-6", entonces UTC = 18:00.
  // Date.UTC interpreta los años 0-99 como 1900-1999, por eso construimos
  // con un año seguro y luego fijamos el año real (permite a.C. y 0-99).
  const dt = new Date(Date.UTC(2000, month - 1, day, hour, minute, second));
  dt.setUTCFullYear(year, dt.getUTCMonth(), dt.getUTCDate());
  return new Date(dt.getTime() - zonaHorariaHoras * 3600 * 1000);
}

// ---- Constrain (clamp) ----
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

// ---- Lerp de colores en RGB plano ----
function lerpRGB(c1, c2, t) {
  return [
    Math.round(c1[0] + (c2[0] - c1[0]) * t),
    Math.round(c1[1] + (c2[1] - c1[1]) * t),
    Math.round(c1[2] + (c2[2] - c1[2]) * t)
  ];
}
