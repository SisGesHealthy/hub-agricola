import { el, clear } from "./dom.js";
import * as store from "./store.js";
import { capturePhoto, renderPhotoRow, captureLocation, renderGpsBox, toast } from "./components.js";
import { buildSeguimientoPdf, buildSeguimientosReportePdf, downloadPdf } from "./pdf.js";

const estadoBadge = { Cumplido: "ok", "En proceso": "warn", Incumplido: "bad" };

export async function renderSeguimientoHome(root) {
  clear(root);
  root.appendChild(el("div", { class: "top-actions" }, [el("h1", {}, "Seguimiento Semanal")]));
  root.appendChild(el("button", { class: "btn", onclick: () => renderSeguimientoForm(root) }, "+ Nuevo seguimiento"));

  const list = await store.listSeguimientos();
  if (list.length === 0) {
    root.appendChild(el("div", { class: "section-title" }, "Registros recientes"));
    root.appendChild(el("div", { class: "empty-state" }, "Sin seguimientos registrados todavía."));
    return;
  }

  const proveedores = await store.listProveedores();
  const provById = Object.fromEntries(proveedores.map((p) => [p.id, p]));

  const filterCard = el("div", { class: "card" });
  const proveedorFilter = el("select", {}, [
    el("option", { value: "" }, "Todos los proveedores"),
    ...proveedores.map((p) => el("option", { value: p.id }, p.nombre)),
  ]);
  const desde = el("input", { type: "date" });
  const hasta = el("input", { type: "date" });
  filterCard.append(
    el("label", { class: "field-label", style: "margin-top:0" }, "Filtrar por proveedor"),
    proveedorFilter,
    el("div", { class: "grid-2" }, [
      el("div", {}, [el("label", { class: "field-label" }, "Desde"), desde]),
      el("div", {}, [el("label", { class: "field-label" }, "Hasta"), hasta]),
    ])
  );
  root.appendChild(filterCard);

  const resultsSection = el("div");
  root.appendChild(resultsSection);

  function applyFilters() {
    return list.filter((s) => {
      if (proveedorFilter.value && s.proveedorId !== proveedorFilter.value) return false;
      const fecha = (s.fecha || "").slice(0, 10);
      if (desde.value && fecha < desde.value) return false;
      if (hasta.value && fecha > hasta.value) return false;
      return true;
    });
  }

  function renderResults() {
    clear(resultsSection);
    const filtered = applyFilters();
    resultsSection.appendChild(el("div", { class: "section-title" }, `Registros (${filtered.length})`));

    if (filtered.length === 0) {
      resultsSection.appendChild(el("div", { class: "empty-state" }, "No hay seguimientos que coincidan con el filtro."));
      return;
    }

    resultsSection.appendChild(
      el(
        "button",
        {
          class: "btn secondary",
          onclick: async () => {
            const blob = await buildSeguimientosReportePdf({
              seguimientos: filtered,
              provById,
              desde: desde.value,
              hasta: hasta.value,
              proveedorNombre: proveedorFilter.value ? provById[proveedorFilter.value]?.nombre : null,
            });
            downloadPdf(blob, `Seguimiento_Reporte_${new Date().toISOString().slice(0, 10)}.pdf`);
          },
        },
        "Descargar PDF consolidado"
      )
    );
    resultsSection.appendChild(el("div", { style: "height:10px" }));

    const card = el("div", { class: "card" });
    filtered.forEach((s) => {
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
    resultsSection.appendChild(card);
  }

  proveedorFilter.addEventListener("change", renderResults);
  desde.addEventListener("change", renderResults);
  hasta.addEventListener("change", renderResults);
  renderResults();
}

async function renderSeguimientoForm(root, existing = null) {
  clear(root);
  root.appendChild(
    el("div", { class: "top-actions" }, [el("button", { class: "back-btn", onclick: () => renderSeguimientoHome(root) }, "‹ Volver")])
  );
  root.appendChild(el("h1", {}, existing ? "Editar seguimiento" : "Nuevo seguimiento"));

  if (existing) {
    root.appendChild(
      el(
        "button",
        {
          class: "btn secondary",
          style: "margin-bottom:10px",
          onclick: async () => {
            const blob = await buildSeguimientoPdf({ seguimiento: existing, proveedor: existing.proveedor });
            downloadPdf(blob, `Seguimiento_${existing.proveedor?.nombre || "proveedor"}_${(existing.fecha || "").slice(0, 10)}.pdf`);
          },
        },
        "Descargar PDF"
      )
    );
  }

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
