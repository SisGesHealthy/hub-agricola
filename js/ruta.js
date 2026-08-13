import { el, clear } from "./dom.js";
import * as store from "./store.js";
import { capturePhoto, captureLocation, toast } from "./components.js";
import { openMapPicker } from "./mapPicker.js";
import { PROVINCIAS_ECUADOR } from "./ecuador.js";

const estadoBadge = { Planificada: "info", Realizada: "ok", Reprogramada: "warn", Cancelada: "bad" };

export async function renderRutaHome(root) {
  clear(root);
  root.appendChild(el("div", { class: "top-actions" }, [el("h1", {}, "Ruta de Visitas")]));
  root.appendChild(el("button", { class: "btn", onclick: () => renderRutaForm(root) }, "+ Agregar visita a la ruta"));

  const rutas = await store.listRutas();
  root.appendChild(el("div", { class: "section-title" }, "Próximas y recientes"));
  if (rutas.length === 0) {
    root.appendChild(el("div", { class: "empty-state" }, "Todavía no hay visitas planificadas."));
    return;
  }
  const card = el("div", { class: "card" });
  rutas.forEach((r) => {
    card.appendChild(
      el("div", { class: "list-row", onclick: () => renderRutaDetail(root, r) }, [
        el("div", {}, [
          el("div", { class: "title" }, r.proveedor?.nombre || r.proveedorNuevoTexto || "—"),
          el("div", { class: "sub" }, `Semana ${r.semana} · ${r.fecha} · ${r.lugar || ""}`),
        ]),
        el("span", { class: `badge ${estadoBadge[r.estado] || "info"}` }, r.estado),
      ])
    );
  });
  root.appendChild(card);
}

async function renderRutaForm(root) {
  clear(root);
  root.appendChild(el("div", { class: "top-actions" }, [el("button", { class: "back-btn", onclick: () => renderRutaHome(root) }, "‹ Volver")]));
  root.appendChild(el("h1", {}, "Nueva visita en la ruta"));

  const proveedores = await store.listProveedores();
  const card = el("div", { class: "card" });
  const provSelect = el("select", {}, [
    el("option", { value: "" }, "— Proveedor nuevo / prospección —"),
    ...proveedores.map((p) => el("option", { value: p.id }, `${p.nombre} (${p.fruta})`)),
  ]);
  const nuevoNombre = el("input", { type: "text", placeholder: "Nombre (si es prospección de un proveedor nuevo)" });
  const fecha = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) });
  const provinciaSelect = el("select", {}, [
    el("option", { value: "" }, "Selecciona provincia"),
    ...PROVINCIAS_ECUADOR.map((p) => el("option", { value: p }, p)),
  ]);
  const lugar = el("input", { type: "text", placeholder: "Sector / lugar específico" });
  const tipoSelect = el(
    "select",
    {},
    ["Cultivo", "Cultivo propio", "Almacenista", "Producto acopiador"].map((t) => el("option", { value: t }, t))
  );
  const motivo = el("input", { type: "text", placeholder: "Motivo de viaje" });

  card.append(
    el("label", { class: "field-label" }, "Proveedor"),
    provSelect,
    nuevoNombre,
    el("label", { class: "field-label" }, "Fecha planificada"),
    fecha,
    el("label", { class: "field-label" }, "Provincia"),
    provinciaSelect,
    el("label", { class: "field-label" }, "Sector / lugar específico"),
    lugar,
    el("label", { class: "field-label" }, "Tipo de contacto"),
    tipoSelect,
    el("label", { class: "field-label" }, "Motivo de viaje"),
    motivo
  );
  root.appendChild(card);

  const mapCard = el("div", { class: "card" });
  mapCard.appendChild(el("label", { class: "field-label", style: "margin-top:0" }, "Punto planificado en el mapa (opcional)"));
  const mapBox = el("div");
  mapCard.appendChild(mapBox);
  root.appendChild(mapCard);
  let coordsPlan = null;
  function refreshMapBox() {
    clear(mapBox);
    mapBox.appendChild(
      coordsPlan
        ? el("div", { class: "gps-box" }, `📍 ${coordsPlan.lat.toFixed(5)}, ${coordsPlan.lng.toFixed(5)}`)
        : el("div", { class: "gps-box pending" }, "Sin marcar (se puede dejar así; el GPS real se captura al momento de la visita)")
    );
    mapBox.appendChild(
      el(
        "button",
        {
          class: "btn secondary small",
          style: "margin-top:8px",
          onclick: async () => {
            const picked = await openMapPicker(coordsPlan || {});
            if (picked) {
              coordsPlan = picked;
              refreshMapBox();
            }
          },
        },
        "Seleccionar en el mapa"
      )
    );
  }
  refreshMapBox();

  root.appendChild(
    el(
      "button",
      {
        class: "btn",
        style: "margin-top:14px",
        onclick: async () => {
          if (!provSelect.value && !nuevoNombre.value.trim()) return toast("Selecciona un proveedor o ingresa el nombre del nuevo", "error");
          if (!provinciaSelect.value) return toast("Selecciona la provincia", "error");
          await store.saveRuta({
            proveedorId: provSelect.value || null,
            proveedorNuevoTexto: provSelect.value ? null : nuevoNombre.value.trim(),
            fecha: fecha.value,
            provincia: provinciaSelect.value,
            lugar: lugar.value.trim(),
            tipo: tipoSelect.value,
            motivo: motivo.value.trim(),
            coordsPlan,
            estado: "Planificada",
          });
          toast("Visita agregada a la ruta", "success");
          renderRutaHome(root);
        },
      },
      "Guardar en la ruta"
    )
  );
}

async function renderRutaDetail(root, ruta) {
  clear(root);
  root.appendChild(el("div", { class: "top-actions" }, [el("button", { class: "back-btn", onclick: () => renderRutaHome(root) }, "‹ Volver")]));
  root.appendChild(el("h1", {}, ruta.proveedor?.nombre || ruta.proveedorNuevoTexto || "Visita"));

  const card = el("div", { class: "card" }, [
    el("div", { class: "list-row" }, [el("div", {}, "Fecha"), el("div", {}, ruta.fecha)]),
    el("div", { class: "list-row" }, [el("div", {}, "Provincia"), el("div", {}, ruta.provincia || "-")]),
    el("div", { class: "list-row" }, [el("div", {}, "Lugar"), el("div", {}, ruta.lugar || "-")]),
    el("div", { class: "list-row" }, [el("div", {}, "Tipo"), el("div", {}, ruta.tipo || "-")]),
    el("div", { class: "list-row" }, [el("div", {}, "Motivo"), el("div", {}, ruta.motivo || "-")]),
    el("div", { class: "list-row" }, [el("div", {}, "Estado"), el("span", { class: `badge ${estadoBadge[ruta.estado] || "info"}` }, ruta.estado)]),
  ]);
  if (ruta.coordsPlan) {
    card.appendChild(
      el("div", { class: "list-row" }, [
        el("div", {}, "Punto planificado"),
        el("div", {}, `${ruta.coordsPlan.lat.toFixed(5)}, ${ruta.coordsPlan.lng.toFixed(5)}`),
      ])
    );
  }
  if (ruta.coordsReales) {
    card.appendChild(
      el("div", { class: "list-row" }, [
        el("div", {}, "GPS real"),
        el("div", {}, `${ruta.coordsReales.lat.toFixed(5)}, ${ruta.coordsReales.lng.toFixed(5)}`),
      ])
    );
  }
  root.appendChild(card);

  if (ruta.estado === "Planificada" || ruta.estado === "Reprogramada") {
    const btn = el(
      "button",
      {
        class: "btn",
        onclick: async () => {
          btn.disabled = true;
          btn.textContent = "Obteniendo GPS…";
          try {
            const coordsReales = await captureLocation();
            const photoId = await capturePhoto();
            await store.saveRuta({ ...ruta, estado: "Realizada", coordsReales, photoId });
            toast("Visita marcada como realizada", "success");
            renderRutaHome(root);
          } catch (e) {
            toast(e.message || "No se pudo obtener el GPS", "error");
            btn.disabled = false;
            btn.textContent = "Registrar visita ahora (captura GPS)";
          }
        },
      },
      "Registrar visita ahora (captura GPS)"
    );
    root.appendChild(btn);

    root.appendChild(
      el(
        "button",
        {
          class: "btn secondary",
          style: "margin-top:8px",
          onclick: async () => {
            await store.saveRuta({ ...ruta, estado: "Reprogramada" });
            toast("Visita reprogramada", "success");
            renderRutaHome(root);
          },
        },
        "Reprogramar"
      )
    );
    root.appendChild(
      el(
        "button",
        {
          class: "btn ghost",
          style: "margin-top:8px",
          onclick: async () => {
            await store.saveRuta({ ...ruta, estado: "Cancelada" });
            renderRutaHome(root);
          },
        },
        "Cancelar visita"
      )
    );
  }
}
