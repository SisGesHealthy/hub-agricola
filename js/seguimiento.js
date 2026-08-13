import { el, clear } from "./dom.js";
import * as store from "./store.js";
import { capturePhoto, renderPhotoRow, captureLocation, renderGpsBox, toast } from "./components.js";

const estadoBadge = { Cumplido: "ok", "En proceso": "warn", Incumplido: "bad" };

export async function renderSeguimientoHome(root) {
  clear(root);
  root.appendChild(el("div", { class: "top-actions" }, [el("h1", {}, "Seguimiento Semanal")]));
  root.appendChild(el("button", { class: "btn", onclick: () => renderSeguimientoForm(root) }, "+ Nuevo seguimiento"));

  const list = await store.listSeguimientos();
  root.appendChild(el("div", { class: "section-title" }, "Registros recientes"));
  if (list.length === 0) {
    root.appendChild(el("div", { class: "empty-state" }, "Sin seguimientos registrados todavía."));
    return;
  }
  const card = el("div", { class: "card" });
  list.forEach((s) => {
    card.appendChild(
      el("div", { class: "list-row", onclick: () => renderSeguimientoForm(root, s) }, [
        el("div", {}, [
          el("div", { class: "title" }, s.proveedor?.nombre || "Proveedor eliminado"),
          el("div", { class: "sub" }, `Semana ${s.semana} · ${s.fecha} · ${s.tipo || ""}`),
        ]),
        el("span", { class: `badge ${estadoBadge[s.estado] || "info"}` }, s.estado || "Sin estado"),
      ])
    );
  });
  root.appendChild(card);
}

async function renderSeguimientoForm(root, existing = null) {
  clear(root);
  root.appendChild(
    el("div", { class: "top-actions" }, [el("button", { class: "back-btn", onclick: () => renderSeguimientoHome(root) }, "‹ Volver")])
  );
  root.appendChild(el("h1", {}, existing ? "Editar seguimiento" : "Nuevo seguimiento"));

  const proveedores = await store.listProveedores();
  const card = el("div", { class: "card" });

  const provSelect = el(
    "select",
    {},
    proveedores.map((p) => el("option", { value: p.id, selected: existing?.proveedorId === p.id ? "selected" : undefined }, `${p.nombre} (${p.fruta})`))
  );
  const tipoSelect = el(
    "select",
    {},
    ["Presencial", "Telefónica", "Videollamada"].map((t) => el("option", { value: t, selected: existing?.tipo === t ? "selected" : undefined }, t))
  );
  const fecha = el("input", { type: "date", value: existing?.fecha || new Date().toISOString().slice(0, 10) });
  const novedades = el("textarea", { placeholder: "Novedades observadas" });
  novedades.value = existing?.novedades || "";
  const recomendaciones = el("textarea", { placeholder: "Recomendaciones entregadas" });
  recomendaciones.value = existing?.recomendaciones || "";
  const fechaMax = el("input", { type: "date", value: existing?.fechaMaxCumplimiento || "" });
  const estadoSelect = el(
    "select",
    {},
    ["Cumplido", "En proceso", "Incumplido"].map((e) => el("option", { value: e, selected: existing?.estado === e ? "selected" : undefined }, e))
  );

  card.append(
    el("label", { class: "field-label" }, "Proveedor"),
    provSelect,
    el("label", { class: "field-label" }, "Tipo de contacto"),
    tipoSelect,
    el("label", { class: "field-label" }, "Fecha de visita"),
    fecha,
    el("label", { class: "field-label" }, "Novedades"),
    novedades,
    el("label", { class: "field-label" }, "Recomendaciones"),
    recomendaciones,
    el("label", { class: "field-label" }, "Fecha máxima de cumplimiento"),
    fechaMax,
    el("label", { class: "field-label" }, "Estado de cumplimiento"),
    estadoSelect
  );
  root.appendChild(card);

  // GPS (obligatorio si Presencial)
  const gpsCard = el("div", { class: "card" });
  gpsCard.appendChild(el("label", { class: "field-label", style: "margin-top:0" }, "Ubicación de la visita"));
  const gpsBox = el("div");
  gpsCard.appendChild(gpsBox);
  root.appendChild(gpsCard);
  let coords = existing?.coords || null;
  function refreshGps() {
    renderGpsBox(gpsBox, coords, {
      onCapture: (c) => {
        coords = c;
        refreshGps();
      },
    });
  }
  refreshGps();

  // Fotos
  const photoCard = el("div", { class: "card" });
  photoCard.appendChild(el("label", { class: "field-label", style: "margin-top:0" }, "Evidencia fotográfica"));
  const photoRow = el("div", { class: "photo-row" });
  photoCard.appendChild(photoRow);
  root.appendChild(photoCard);
  let photoIds = existing?.photoIds || [];
  function refreshPhotos() {
    renderPhotoRow(photoRow, photoIds, {
      onAdd: async () => {
        const pid = await capturePhoto();
        if (pid) {
          photoIds = [...photoIds, pid];
          refreshPhotos();
        }
      },
      onRemove: (pid) => {
        photoIds = photoIds.filter((p) => p !== pid);
        refreshPhotos();
      },
    });
  }
  refreshPhotos();

  root.appendChild(
    el(
      "button",
      {
        class: "btn",
        style: "margin-top:14px",
        onclick: async () => {
          if (tipoSelect.value === "Presencial" && !coords) {
            toast("Captura la ubicación GPS para una visita presencial", "error");
            return;
          }
          if (tipoSelect.value === "Presencial" && photoIds.length === 0) {
            toast("Adjunta al menos una foto para una visita presencial", "error");
            return;
          }
          await store.saveSeguimiento({
            id: existing?.id,
            proveedorId: provSelect.value,
            tipo: tipoSelect.value,
            fecha: fecha.value,
            novedades: novedades.value,
            recomendaciones: recomendaciones.value,
            fechaMaxCumplimiento: fechaMax.value,
            estado: estadoSelect.value,
            coords,
            photoIds,
          });
          toast("Seguimiento guardado", "success");
          renderSeguimientoHome(root);
        },
      },
      "Guardar seguimiento"
    )
  );
}
