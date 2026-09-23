// =========================================================
// config.js — constantes globales
// =========================================================

// ---- Música ----
const NOTAS_BASE = [
  "C", "C#/Db", "D", "D#/Eb", "E", "F",
  "F#/Gb", "G", "G#/Ab", "A", "A#/Bb", "B"
];

const ORDEN_CROMATICO = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const ORDEN_QUINTAS   = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];

// Intervalos disponibles para ordenar las notas en las 12 regiones.
// El valor es el salto en semitonos entre regiones consecutivas.
const INTERVALOS_ORDEN = [
  { id: "2m", nombre: "Cromático asc. (2m)", semitonos: 1 },
  { id: "2M", nombre: "Segunda mayor (2M)",  semitonos: 2 },
  { id: "3m", nombre: "Tercera menor (3m)",  semitonos: 3 },
  { id: "3M", nombre: "Tercera mayor (3M)",  semitonos: 4 },
  { id: "4J", nombre: "Cuarta justa (4J)",   semitonos: 5 },
  { id: "5J", nombre: "Quinta justa (5J)",   semitonos: 7 },
  { id: "6m", nombre: "Sexta menor (6m)",    semitonos: 8 },
  { id: "6M", nombre: "Sexta mayor (6M)",    semitonos: 9 },
  { id: "7m", nombre: "Séptima menor (7m)",  semitonos: 10 },
  { id: "7M", nombre: "Séptima mayor (7M)",  semitonos: 11 }
];

// C4 como referencia
const FRECUENCIA_BASE = 261.6256;

// Rango visible idealizado como una octava (Hz)
const VISIBLE_MIN = 4.0e14;
const VISIBLE_MAX = 8.0e14;

// ---- Astrología ----
const SIGNOS_BASE = [
  "Aries", "Tauro", "Geminis", "Cancer", "Leo", "Virgo",
  "Libra", "Escorpio", "Sagitario", "Capricornio", "Acuario", "Piscis"
];

const NOMBRES_ASTROS = [
  "Sol", "Luna", "Mercurio", "Venus", "Marte",
  "Jupiter", "Saturno", "Urano", "Neptuno", "Pluton",
  "Ascendente", "Medio Cielo"
];

// Símbolos astronómicos Unicode (uno por astro, en el mismo orden)
const SIMBOLOS_ASTROS = [
  "☉", "☽", "☿", "♀", "♂",
  "♃", "♄", "♅", "♆", "♇",
  "AC", "MC"
];

// Colores por defecto para cada astro (usados en modo símbolo)
const COLORES_ASTROS_DEFAULT = [
  "#e6a200",  // Sol — dorado
  "#6e9bd8",  // Luna — azul claro
  "#a3742d",  // Mercurio — bronce
  "#2b9b4c",  // Venus — verde
  "#c43030",  // Marte — rojo
  "#7a3fb3",  // Jupiter — violeta
  "#3a3a3a",  // Saturno — gris oscuro
  "#0098a8",  // Urano — turquesa
  "#3155b5",  // Neptuno — azul mar
  "#6e2e2e",  // Pluton — granate
  "#000000",  // Ascendente
  "#000000"   // Medio Cielo
];

const NOMBRES_CASAS = [
  "Casa 1 (AC)", "Casa 2", "Casa 3", "Casa 4", "Casa 5", "Casa 6",
  "Casa 7", "Casa 8", "Casa 9", "Casa 10 (MC)", "Casa 11", "Casa 12"
];

// ---- Configuración inicial ----
const NUM_NOTAS = 12;
const GRADOS_OCTAVA = 360.0;

// Orientación de la rueda:
// Aries 0° empieza en la posición "5:00" de un reloj (60° en coords de canvas,
// medidos desde el eje +X con Y hacia abajo) y los signos avanzan CONTRA reloj.
const ANGULO_INICIO_RUEDA = 60.0;

const MAX_MICROTONOS = 96;
const MIN_MICROTONOS = 1;

// ---- Modos ----
const MODO_DEMO = "DEMO";
const MODO_AHORA = "AHORA";
const MODO_EXPLORACION = "EXPLORACION";

// ---- Pasos temporales (en segundos) ----
const PASOS_TEMPORALES = [
  { nombre: "1 minuto",   segundos: 60 },
  { nombre: "5 minutos",  segundos: 300 },
  { nombre: "15 minutos", segundos: 900 },
  { nombre: "1 hora",     segundos: 3600 },
  { nombre: "5 horas",    segundos: 18000 },
  { nombre: "1 día",      segundos: 86400 },
  { nombre: "1 semana",   segundos: 604800 },
  { nombre: "1 mes",      segundos: 2592000 }
];

// ---- Carta DEMO (4-abr-2026, CDMX, copiado del proyecto Processing) ----
const CARTA_DEMO = {
  astros: [
    { signo: "Tauro",       grado: 24, minuto: 34 },  // Sol
    { signo: "Cancer",      grado: 19, minuto: 49 },  // Luna
    { signo: "Geminis",     grado: 11, minuto: 10 },  // Mercurio
    { signo: "Geminis",     grado: 23, minuto: 30 },  // Venus
    { signo: "Aries",       grado: 23, minuto: 44 },  // Marte
    { signo: "Escorpio",    grado: 7,  minuto: 53 },  // Jupiter
    { signo: "Piscis",      grado: 11, minuto: 12 },  // Saturno
    { signo: "Capricornio", grado: 26, minuto: 15 },  // Urano
    { signo: "Capricornio", grado: 23, minuto: 14 },  // Neptuno
    { signo: "Escorpio",    grado: 26, minuto: 45 },  // Pluton
    { signo: "Cancer",      grado: 16, minuto: 49 },  // Ascendente
    { signo: "Aries",       grado: 10, minuto: 10 }   // Medio Cielo
  ],
  casas: [
    { signo: "Cancer",      grado: 16, minuto: 49 },
    { signo: "Leo",         grado: 11, minuto: 45 },
    { signo: "Virgo",       grado: 9,  minuto: 29 },
    { signo: "Libra",       grado: 11, minuto: 0  },
    { signo: "Escorpio",    grado: 14, minuto: 30 },
    { signo: "Sagitario",   grado: 16, minuto: 47 },
    { signo: "Capricornio", grado: 16, minuto: 49 },
    { signo: "Acuario",     grado: 11, minuto: 45 },
    { signo: "Piscis",      grado: 9,  minuto: 29 },
    { signo: "Aries",       grado: 11, minuto: 0  },
    { signo: "Tauro",       grado: 14, minuto: 30 },
    { signo: "Geminis",     grado: 16, minuto: 47 }
  ]
};

// ---- Figuras rítmicas del secuenciador ----
// factor = duración relativa a la negra (1 negra = 1 beat de BPM)
// corto = etiqueta compacta para el select por astro
const FIGURAS_SECUENCIA = [
  { id: "blanca",        nombre: "Blanca (𝅗𝅥)",        factor: 2,      corto: "𝅗𝅥" },
  { id: "blanca-t",      nombre: "Tresillo de blancas",      factor: 4 / 3,  corto: "𝅗𝅥³" },
  { id: "negra",         nombre: "Negra (♩)",         factor: 1,      corto: "♩" },
  { id: "negra-t",       nombre: "Tresillo de negras",       factor: 2 / 3,  corto: "♩³" },
  { id: "corchea",       nombre: "Corchea (♪)",       factor: 0.5,    corto: "♪" },
  { id: "corchea-t",     nombre: "Tresillo de corcheas",     factor: 1 / 3,  corto: "♪³" },
  { id: "semicorchea",   nombre: "Semicorchea (𝅘𝅥𝅯)",   factor: 0.25,   corto: "𝅘𝅥𝅯" },
  { id: "semicorchea-t", nombre: "Tresillo de semicorcheas", factor: 1 / 6,  corto: "𝅘𝅥𝅯³" },
  { id: "fusa",          nombre: "Fusa (𝅘𝅥𝅰)",          factor: 0.125,  corto: "𝅘𝅥𝅰" },
  { id: "fusa-t",        nombre: "Tresillo de fusas",        factor: 1 / 12, corto: "𝅘𝅥𝅰³" },
  { id: "semifusa",      nombre: "Semifusa (𝅘𝅥𝅱)",      factor: 0.0625, corto: "𝅘𝅥𝅱" },
  { id: "semifusa-t",    nombre: "Tresillo de semifusas",    factor: 1 / 24, corto: "𝅘𝅥𝅱³" }
];

const BPM_MIN = 10;
const BPM_MAX = 999;

// Peso máximo de una figura al aleatorizar ritmos (0 = excluida)
const PESO_FIGURA_MAX = 3;

// ---- Algoritmos FM (estilo Operator) ----
// Cada algoritmo define cómo se conectan los 10 astros mediante
// `cadenas`: una partición de los 10 astros en columnas. El primer
// astro de cada cadena es el carrier (suena a la salida) y los
// siguientes modulan en serie hacia abajo (FM).
// Se generan todas las combinaciones Paralelo(n) × Serie(n):
// de 2 cadenas (5+5) hasta 9 cadenas (2+1×8), más los extremos
// paralelo (10×1) y serie total (1×10).
function _particionCadenasFM(numCadenas) {
  const base = Math.floor(10 / numCadenas);
  const resto = 10 % numCadenas;
  const cadenas = [];
  for (let k = 0; k < numCadenas; k++) {
    cadenas.push(base + (k < resto ? 1 : 0));
  }
  return cadenas;
}

const FM_ALGORITMOS = (() => {
  const algoritmos = [
    { id: "paralelo", nombre: "Paralelo (10 voces aditivas)", cadenas: new Array(10).fill(1) }
  ];
  for (let n = 9; n >= 2; n--) {
    const cadenas = _particionCadenasFM(n);
    algoritmos.push({
      id: "cadenas" + n,
      nombre: `${n} cadenas en serie (${cadenas.join("+")})`,
      cadenas
    });
  }
  algoritmos.push({ id: "serie10", nombre: "Serie total (cadena de 10)", cadenas: [10] });
  return algoritmos;
})();

// Ids de configs guardadas antes de la expansión a n cadenas
const FM_ALGORITMOS_LEGADO = { pares: "cadenas5", serie2: "cadenas2" };

// ---- Formas de onda por astro ----
const FORMAS_ONDA = [
  { id: "sine",     nombre: "Senoidal" },
  { id: "triangle", nombre: "Triangular" },
  { id: "square",   nombre: "Cuadrada" },
  { id: "sawtooth", nombre: "Sierra" },
  { id: "noise",    nombre: "Ruido" },
  { id: "custom",   nombre: "Personalizada" }
];

// ---- Aspectos mayores ----
const ASPECTOS = [
  { angulo: 0,   nombre: "Conjuncion", color: [80, 80, 80] },
  { angulo: 60,  nombre: "Sextil",     color: [0, 70, 220] },
  { angulo: 90,  nombre: "Cuadratura", color: [220, 0, 0] },
  { angulo: 120, nombre: "Trigono",    color: [0, 180, 0] },
  { angulo: 150, nombre: "Quincuncio", color: [220, 190, 0] },
  { angulo: 180, nombre: "Oposicion",  color: [220, 0, 0] }
];

const ORBE_ASPECTOS = 6.0;
