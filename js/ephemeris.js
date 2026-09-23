// =========================================================
// ephemeris.js — wrapper de astronomy-engine
// =========================================================
//
// astronomy-engine devuelve coordenadas geocéntricas con precisión
// sub-arcsec, sin necesidad de archivos de efemérides externos.
//
// Para casas usamos:
//   - ASC y MC calculados directamente desde LST + oblicuidad
//   - Sistema EQUAL (cada 30° desde ASC) como esqueleto
//   - TODO: Placidus, Koch, Whole Sign, etc.
// =========================================================

const PLANETAS_ASTRONOMY = [
  "Sun", "Moon", "Mercury", "Venus", "Mars",
  "Jupiter", "Saturn", "Uranus", "Neptune", "Pluto"
];

// Oblicuidad media de la eclíptica (puede mejorarse con valor de fecha)
const OBLICUIDAD_GRADOS = 23.4393;

/**
 * Calcula la longitud eclíptica geocéntrica (tropical, of-date)
 * de los 10 planetas para una fecha dada.
 *
 * @param {Date} fechaUTC — fecha en UTC
 * @returns {Array<number>} 10 longitudes en grados [0, 360)
 */
function calcularLongitudesPlanetas(fechaUTC) {
  if (typeof Astronomy === "undefined") {
    console.error("astronomy-engine no está cargado");
    return new Array(10).fill(0);
  }

  return PLANETAS_ASTRONOMY.map(body => {
    try {
      const vec = Astronomy.GeoVector(Astronomy.Body[body], fechaUTC, true);
      const ecl = Astronomy.Ecliptic(vec);
      let lon = ecl.elon;
      if (lon < 0) lon += 360;
      return lon;
    } catch (err) {
      console.error(`Error calculando ${body}:`, err);
      return 0;
    }
  });
}

/**
 * Calcula Ascendente y Medio Cielo.
 *
 * @param {Date} fechaUTC
 * @param {number} latitudGrados
 * @param {number} longitudGrados — este positivo
 * @returns {{asc: number, mc: number, lst: number}}
 */
function calcularAscMC(fechaUTC, latitudGrados, longitudGrados) {
  // GMST en horas → grados
  const gmstHoras = Astronomy.SiderealTime(fechaUTC);
  const gmstGrados = gmstHoras * 15;

  // LST = GMST + longitud (positivo este)
  let lstGrados = (gmstGrados + longitudGrados) % 360;
  if (lstGrados < 0) lstGrados += 360;

  const lst = lstGrados * DEG_TO_RAD;
  const obl = OBLICUIDAD_GRADOS * DEG_TO_RAD;
  const lat = latitudGrados * DEG_TO_RAD;

  // MC
  let mc = Math.atan2(Math.sin(lst), Math.cos(lst) * Math.cos(obl)) * RAD_TO_DEG;
  if (mc < 0) mc += 360;

  // ASC con fórmula estándar
  let asc = Math.atan2(
    Math.cos(lst),
    -(Math.sin(lst) * Math.cos(obl) + Math.tan(lat) * Math.sin(obl))
  ) * RAD_TO_DEG;
  if (asc < 0) asc += 360;

  // Corrección de cuadrante: el ASC debe estar "delante" del MC
  // entre 90° y 270° en el sentido del movimiento aparente.
  const diff = ((asc - mc) % 360 + 360) % 360;
  if (diff < 90 || diff > 270) {
    asc = (asc + 180) % 360;
  }

  return { asc, mc, lst: lstGrados };
}

/**
 * Calcula las 12 cúspides de casas.
 * Por ahora usamos sistema EQUAL: cada 30° desde el ASC.
 * TODO: implementar Placidus.
 *
 * @param {number} ascGrados
 * @param {number} mcGrados (no usado en EQUAL)
 * @returns {Array<number>} 12 cúspides en grados (índice 0 = casa 1)
 */
function calcularCasasEqual(ascGrados, mcGrados) {
  const casas = new Array(12);
  for (let i = 0; i < 12; i++) {
    casas[i] = (ascGrados + i * 30) % 360;
  }
  return casas;
}

/**
 * Función de alto nivel: devuelve una carta completa.
 *
 * @param {Date} fechaUTC
 * @param {number} lat
 * @param {number} lon — este positivo
 * @returns {{valido: boolean, longitudes: number[], casas: number[], asc: number, mc: number, error: string}}
 */
function calcularCartaReal(fechaUTC, lat, lon) {
  try {
    const longitudes = calcularLongitudesPlanetas(fechaUTC);
    const { asc, mc } = calcularAscMC(fechaUTC, lat, lon);
    const casas = calcularCasasEqual(asc, mc);

    return {
      valido: true,
      longitudes,
      casas,
      asc,
      mc,
      error: ""
    };
  } catch (err) {
    console.error("Error calculando carta:", err);
    return {
      valido: false,
      longitudes: new Array(10).fill(0),
      casas: new Array(12).fill(0),
      asc: 0,
      mc: 0,
      error: err.message || "Error desconocido"
    };
  }
}
