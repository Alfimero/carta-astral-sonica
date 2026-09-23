// =========================================================
// theme.js — sistema de tema visual editable
// =========================================================
//
// Todos los valores visuales (colores, grosores, tamaños)
// viven en THEME. El editor de dev.html los modifica en vivo;
// los cambios se guardan en localStorage y se aplican
// automáticamente en index.html.
// =========================================================

const THEME_STORAGE_KEY = "cas-theme-v1";

const THEME_DEFAULTS = {
  background: "#ffffff",

  microtonos: {
    opacidad: 1.0,
    mostrarLineas: true,
    colorLineas: "#0000c8",
    grosorLineas: 3,
    grosorLineasInternas: 2
  },

  guias: {
    mostrarGradosExternos: true,
    mostrarGradosInternos: true,
    colorGrados: "#969696",
    grosorGrados: 1,
    colorAnillos: "#000000"
  },

  divisiones: {
    color: "#000000",
    grosor: 4
  },

  signos: {
    mostrar: true,
    color: "#000000",
    tamano: 18
  },

  notas: {
    mostrar: true,
    color: "#000000",
    tamano: 12
  },

  frecNotas: {
    mostrar: true,
    color: "#000000",
    tamano: 9
  },

  frecMicro: {
    mostrar: true,
    color: "#000000",
    tamano: 8
  },

  casas: {
    mostrar: true,
    color: "#b40000",
    opacidad: 0.78,
    grosor: 4
  },

  astros: {
    // Modo de visualización: "texto" | "simbolo" | "imagen"
    tipoMostrar: "simbolo",

    // Colores por astro (en modo símbolo). Array de 12 hex.
    coloresPorAstro: [
      "#e6a200", "#6e9bd8", "#a3742d", "#2b9b4c", "#c43030",
      "#7a3fb3", "#3a3a3a", "#0098a8", "#3155b5", "#6e2e2e",
      "#000000", "#000000"
    ],

    // Imágenes por astro (data URLs). Array de 12 strings (vacíos por defecto).
    imagenes: ["", "", "", "", "", "", "", "", "", "", "", ""],

    // Radios (en unidades base, multiplicados por escala en runtime)
    radioLineaInicio: 168,
    radioPunto: 188,
    radioTexto: 348,
    radioImagenTamano: 24,  // tamaño del símbolo/imagen en px base

    mostrarLinea: true,
    colorLinea: "#505050",
    grosorLinea: 3,

    mostrarPunto: true,
    colorPunto: "#141414",
    tamanoPunto: 8,

    mostrarTexto: true,
    colorTexto: "#000000",
    tamanoTexto: 14
  },

  aspectos: {
    mostrar: true,
    grosor: 2,
    orbe: 6,
    // Tamaño del arco de conjunción (semi-anchura en grados)
    arcoConjuncion: 8,
    // Radio donde se dibuja el arco de conjunción (unidades base)
    radioConjuncion: 200,
    colorConjuncion: "#505050",
    colorSextil:     "#0046dc",
    colorCuadratura: "#dc0000",
    colorTrigono:    "#00b400",
    colorQuincuncio: "#dcbe00",
    colorOposicion:  "#dc0000"
  }
};

// Instancia viva del tema (mutable)
let THEME = clonarProfundo(THEME_DEFAULTS);

// ---- Helpers ----

function clonarProfundo(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function mezclarConDefaults(defaults, custom) {
  const out = clonarProfundo(defaults);
  if (!custom || typeof custom !== "object") return out;

  for (const k of Object.keys(custom)) {
    if (custom[k] !== null && typeof custom[k] === "object" && !Array.isArray(custom[k])) {
      out[k] = mezclarConDefaults(defaults[k] || {}, custom[k]);
    } else {
      out[k] = custom[k];
    }
  }
  return out;
}

function debounce(fn, ms) {
  let id;
  return (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
}

// ---- API pública ----

function cargarThemeDesdeStorage() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      THEME = mezclarConDefaults(THEME_DEFAULTS, parsed);
    }
  } catch (e) {
    console.warn("[theme] No se pudo cargar:", e);
  }
}

function guardarThemeEnStorage() {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(THEME));
  } catch (e) {
    console.warn("[theme] No se pudo guardar:", e);
  }
}

const guardarThemeDebounced = debounce(guardarThemeEnStorage, 400);

function resetearTheme() {
  THEME = clonarProfundo(THEME_DEFAULTS);
  guardarThemeEnStorage();
}

function exportarThemeJSON() {
  return JSON.stringify(THEME, null, 2);
}

function importarThemeJSON(jsonStr) {
  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed || typeof parsed !== "object") return false;
    THEME = mezclarConDefaults(THEME_DEFAULTS, parsed);
    guardarThemeEnStorage();
    return true;
  } catch (e) {
    return false;
  }
}

// Acceso por path tipo "casas.color"
function getThemePath(path) {
  return path.split(".").reduce((o, k) => (o == null ? o : o[k]), THEME);
}

function setThemePath(path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  const target = parts.reduce((o, k) => o[k], THEME);
  target[last] = value;
  guardarThemeDebounced();
}

// Color con opacidad como objeto p5
function colorTema(hex, opacidad = 1) {
  const c = color(hex);
  c.setAlpha(opacidad * 255);
  return c;
}

// Auto-carga al ejecutar el script
cargarThemeDesdeStorage();
