// =========================================================
// geo.js — geocodificación: País / Estado / Ciudad → lat, lon, zona
// =========================================================
//
// Usa la API gratuita de Open-Meteo (sin API key, con CORS):
//   https://geocoding-api.open-meteo.com/v1/search
//
// El usuario escribe la ciudad, elige un resultado y se llenan
// automáticamente País, Estado, Ciudad, latitud, longitud y la
// zona horaria (calculada para la fecha activa con Intl).
// =========================================================

const GEO_API = "https://geocoding-api.open-meteo.com/v1/search";

async function buscarLugares(consulta) {
  const url = `${GEO_API}?name=${encodeURIComponent(consulta)}&count=8&language=es&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Respuesta " + res.status + " del servicio de geocodificación");
  const data = await res.json();
  return (data.results || []).map(r => ({
    ciudad: r.name,
    estado: r.admin1 || "",
    pais: r.country || "",
    latitud: r.latitude,
    longitud: r.longitude,
    timezone: r.timezone || ""
  }));
}

// Offset UTC (en horas) de una zona IANA para una fecha dada.
// Para fechas muy lejanas (a.C.) Intl puede fallar: usamos la fecha actual.
function offsetHorasDeTimezone(timezone, fecha) {
  if (!timezone) return 0;
  const intentar = (f) => {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset"
    });
    const parte = fmt.formatToParts(f).find(p => p.type === "timeZoneName");
    if (!parte) return null;
    // "GMT-06:00", "GMT+05:30" o "GMT"
    const m = parte.value.match(/GMT([+-])(\d{2}):(\d{2})/);
    if (!m) return 0;
    const signo = m[1] === "-" ? -1 : 1;
    return signo * (parseInt(m[2], 10) + parseInt(m[3], 10) / 60);
  };
  try {
    const v = intentar(fecha);
    if (v !== null) return v;
  } catch (e) {}
  try {
    const v = intentar(new Date());
    if (v !== null) return v;
  } catch (e) {}
  return 0;
}

// ------------------ UI ------------------

function inicializarUIGeo() {
  const input = document.getElementById("input-buscar-lugar");
  const boton = document.getElementById("btn-buscar-lugar");
  const resultados = document.getElementById("geo-resultados");
  if (!input || !boton || !resultados) return;

  const buscar = async () => {
    const q = input.value.trim();
    if (q.length < 2) return;
    resultados.innerHTML = `<p class="geo-msg">Buscando…</p>`;
    try {
      const lugares = await buscarLugares(q);
      if (lugares.length === 0) {
        resultados.innerHTML = `<p class="geo-msg">Sin resultados para "${escaparHTML(q)}".</p>`;
        return;
      }
      resultados.innerHTML = lugares.map((l, i) => `
        <button type="button" class="geo-resultado" data-idx="${i}">
          <strong>${escaparHTML(l.ciudad)}</strong>
          <span>${escaparHTML([l.estado, l.pais].filter(Boolean).join(", "))}</span>
          <small>${l.latitud.toFixed(4)}, ${l.longitud.toFixed(4)}</small>
        </button>
      `).join("");
      resultados.querySelectorAll(".geo-resultado").forEach(btn => {
        btn.addEventListener("click", () => {
          aplicarLugar(lugares[parseInt(btn.dataset.idx, 10)]);
          resultados.innerHTML = "";
        });
      });
    } catch (err) {
      resultados.innerHTML = `<p class="geo-msg geo-error">No se pudo buscar (¿sin conexión?): ${escaparHTML(err.message)}</p>`;
    }
  };

  boton.addEventListener("click", buscar);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      buscar();
    }
  });
}

function aplicarLugar(lugar) {
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = v;
  };

  setVal("input-pais", lugar.pais);
  setVal("input-estado", lugar.estado);
  setVal("input-ciudad", lugar.ciudad);
  setVal("input-latitud", lugar.latitud);
  setVal("input-longitud", lugar.longitud);
  setVal("input-ubicacion", [lugar.ciudad, lugar.estado, lugar.pais].filter(Boolean).join(", "));

  const zona = offsetHorasDeTimezone(lugar.timezone, estado.fechaUTC);
  setVal("input-zona", zona);
}
