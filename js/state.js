// =========================================================
// state.js — estado global de la carta y modos temporales
// =========================================================

const estado = {
  modo: MODO_DEMO,
  pasoTemporalIdx: 3,

  fechaUTC: new Date(),

  ubicacionNombre: "CDMX",
  latitud: 19.4326,
  longitud: -99.1332,
  zonaHoraria: -6,

  astros: [],
  casas: [],

  seguirTiempoReal: true,
  ultimaActualizacionMs: 0,
  intervaloActualizacionMs: 1000,

  velocidadExploracion: 0,
  friccionExploracion: 0.82,

  cartaValida: true,
  ultimoError: ""
};

function inicializarEstado() {
  estado.fechaUTC = new Date();
  cargarCartaSegunModo();
  sincronizarFormularioConEstado();
}

function cargarCartaSegunModo() {
  if (estado.modo === MODO_DEMO) {
    cargarCartaDemo();
  } else if (estado.modo === MODO_AHORA) {
    cargarCartaAhora();
  } else {
    cargarCartaExploracion();
  }
  notificarCartaActualizada();
}

function notificarCartaActualizada() {
  if (typeof synth !== "undefined" && synth.ctx) {
    synth.updateFromAstros(estado.astros);
  }
  if (typeof calcularDatosVistas === "function") {
    calcularDatosVistas();
  }
  refrescarPanel();
}

function cargarCartaDemo() {
  estado.astros = CARTA_DEMO.astros.map(a => ({...a}));
  estado.casas = CARTA_DEMO.casas.map(c => ({...c}));
  estado.cartaValida = true;
  estado.ultimoError = "";
}

function cargarCartaAhora() {
  if (estado.seguirTiempoReal) {
    estado.fechaUTC = new Date();
  }
  calcularYAsignarCarta();
}

function cargarCartaExploracion() {
  calcularYAsignarCarta();
}

function calcularYAsignarCarta() {
  const carta = calcularCartaReal(
    estado.fechaUTC,
    estado.latitud,
    estado.longitud
  );

  if (!carta.valido) {
    estado.cartaValida = false;
    estado.ultimoError = carta.error;
    return;
  }

  estado.cartaValida = true;
  estado.ultimoError = "";

  estado.astros = carta.longitudes.map(lon => longitudASignoGradoMinuto(lon));
  estado.astros.push(longitudASignoGradoMinuto(carta.asc));
  estado.astros.push(longitudASignoGradoMinuto(carta.mc));

  estado.casas = carta.casas.map(lon => longitudASignoGradoMinuto(lon));

  estado.ultimaActualizacionMs = millis();
}

function actualizarEstadoPorFrame() {
  if (estado.modo === MODO_AHORA && estado.seguirTiempoReal) {
    if (millis() - estado.ultimaActualizacionMs >= estado.intervaloActualizacionMs) {
      cargarCartaAhora();
      notificarCartaActualizada();
    }
  } else if (estado.modo === MODO_EXPLORACION) {
    if (Math.abs(estado.velocidadExploracion) > 0.01) {
      const pasoSeg = pasoTemporalActualSegundos();
      const deltaSeg = estado.velocidadExploracion * pasoSeg;
      estado.fechaUTC = new Date(estado.fechaUTC.getTime() + deltaSeg * 1000);
      estado.velocidadExploracion *= estado.friccionExploracion;
      if (Math.abs(estado.velocidadExploracion) < 0.05) {
        estado.velocidadExploracion = 0;
      }
      cargarCartaExploracion();
      notificarCartaActualizada();
    }
  }
}

function cambiarAModoDemo() {
  estado.modo = MODO_DEMO;
  cargarCartaDemo();
  notificarCartaActualizada();
}

function cambiarAModoAhora() {
  estado.modo = MODO_AHORA;
  estado.seguirTiempoReal = true;
  cargarCartaAhora();
  notificarCartaActualizada();
}

function cambiarAModoExploracion() {
  estado.modo = MODO_EXPLORACION;
  estado.seguirTiempoReal = false;
  estado.velocidadExploracion = 0;
  cargarCartaExploracion();
  notificarCartaActualizada();
}

function pasoTemporalActualSegundos() {
  return PASOS_TEMPORALES[estado.pasoTemporalIdx].segundos;
}

function pasoTemporalActualNombre() {
  return PASOS_TEMPORALES[estado.pasoTemporalIdx].nombre;
}

function incrementarPasoTemporal() {
  estado.pasoTemporalIdx = clamp(
    estado.pasoTemporalIdx + 1, 0, PASOS_TEMPORALES.length - 1
  );
  refrescarPanel();
}

function decrementarPasoTemporal() {
  estado.pasoTemporalIdx = clamp(
    estado.pasoTemporalIdx - 1, 0, PASOS_TEMPORALES.length - 1
  );
  refrescarPanel();
}

function aplicarImpulsoExploracion(direccion) {
  estado.velocidadExploracion = clamp(
    estado.velocidadExploracion + direccion * 1.0,
    -6, 6
  );
}

function volverAlPresente() {
  estado.fechaUTC = new Date();
  estado.velocidadExploracion = 0;
  if (estado.modo === MODO_AHORA) {
    cargarCartaAhora();
  } else if (estado.modo === MODO_EXPLORACION) {
    cargarCartaExploracion();
  }
  notificarCartaActualizada();
}

function alternarTiempoReal() {
  if (estado.modo === MODO_AHORA) {
    estado.seguirTiempoReal = !estado.seguirTiempoReal;
    refrescarPanel();
  }
}
