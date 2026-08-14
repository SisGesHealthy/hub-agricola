import { el, clear } from "./dom.js";
import * as store from "./store.js";
import { capturePhoto, renderPhotoRow, renderGpsBox, SignaturePad, toast, fmtPct } from "./components.js";
import { buildChecklistPdf, downloadPdf } from "./pdf.js";
import { openMapPicker } from "./mapPicker.js";
import { PROVINCIAS_ECUADOR } from "./ecuador.js";

export async function renderChecklistHome(root) {
  clear(root);
  root.appendChild(el("div", { class: "top-actions" }, [el("h1", {}, "Check List de Inspección")]));
  root.appendChild(
    el("button", { class: "btn", onclick: () => renderNewChecklistPicker(root) }, "+ Nueva inspección")
  );

  const checklists = await store.listChecklists();
  root.appendChild(el("div", { class: "section-title" }, "Historial"));
  if (checklists.length === 0) {
    root.appendChild(el("div", { class: "empty-state" }, "Todavía no hay inspecciones registradas."));
    return;
  }
  const card = el("div", { class: "card" });
  checklists.forEach((c) => {
    const badge =
      c.estado === "Borrador"
        ? el("span", { class: "badge info" }, "Borrador")
        : c.accionGlobal === "OK"
        ? el("span", { class: "badge ok" }, "OK")
        : el("span", { class: "badge bad" }, "Plan de acción");
    const rt = el("div", { class: "rt" }, [
      badge,
      c.ponderacionTotal != null ? el("div", { class: "sub" }, fmtPct(c.ponderacionTotal)) : null,
    ]);
    if (c.estado === "Borrador") {
      rt.appendChild(
        el(
          "button",
          {
            class: "btn ghost small",
            style: "margin-top:6px",
            onclick: async (ev) => {
              ev.stopPropagation();
              if (!confirm(`¿Borrar el borrador de "${c.proveedor?.nombre || "este proveedor"}"? Esto no se puede deshacer.`)) return;
              await store.deleteChecklist(c.id);
              toast("Borrador eliminado", "success");
              renderChecklistHome(root);
            },
          },
          "🗑 Borrar"
        )
      );
    }
    const row = el(
      "div",
      { class: "list-row", onclick: () => (c.estado === "Borrador" ? renderWizard(root, c.id) : renderSummary(root, c.id, { readonly: true })) },
      [
        el("div", {}, [
          el("div", { class: "title" }, c.proveedor?.nombre || "Proveedor eliminado"),
          el("div", { class: "sub" }, `${c.fecha}  ·  ${c.auditor || ""}`),
        ]),
        rt,
      ]
    );
    card.appendChild(row);
  });
  root.appendChild(card);
}

async function renderNewChecklistPicker(root) {
  clear(root);
  root.appendChild(
    el("div", { class: "top-actions" }, [
      el("button", { class: "back-btn", onclick: () => renderChecklistHome(root) }, "‹ Volver"),
    ])
  );
  root.appendChild(el("h1", {}, "Seleccionar proveedor"));

  const proveedores = await store.listProveedores();
  const card = el("div", { class: "card" });
  proveedores.forEach((p) => {
    card.appendChild(
      el(
        "div",
        {
          class: "list-row",
          onclick: async () => {
            const { cabecera } = await store.createChecklist({ proveedorId: p.id, auditor: "Responsable agrícola" });
            renderWizard(root, cabecera.id);
          },
        },
        [
          el("div", {}, [el("div", { class: "title" }, p.nombre), el("div", { class: "sub" }, `${p.fruta} · ${p.ubicacion}`)]),
          p.ultimaPonderacion != null ? el("div", { class: "badge info" }, fmtPct(p.ultimaPonderacion)) : null,
        ]
      )
    );
  });
  root.appendChild(card);

  root.appendChild(el("div", { class: "section-title" }, "¿No está en la lista?"));
  root.appendChild(el("button", { class: "btn secondary", onclick: () => renderQuickAddProveedor(root) }, "+ Registrar nuevo proveedor"));
}

function renderQuickAddProveedor(root) {
  clear(root);
  root.appendChild(
    el("div", { class: "top-actions" }, [
      el("button", { class: "back-btn", onclick: () => renderNewChecklistPicker(root) }, "‹ Volver"),
    ])
  );
  root.appendChild(el("h1", {}, "Nuevo proveedor"));
  const card = el("div", { class: "card" });
  const nombre = el("input", { type: "text", placeholder: "Nombre del productor" });
  const fruta = el("input", { type: "text", placeholder: "Fruta principal" });
  const provinciaSelect = el("select", {}, [
    el("option", { value: "" }, "Selecciona provincia"),
    ...PROVINCIAS_ECUADOR.map((p) => el("option", { value: p }, p)),
  ]);
  const ubicacion = el("input", { type: "text", placeholder: "Sector / lugar (ej. Categosín)" });
  card.append(
    el("label", { class: "field-label" }, "Nombre del productor"),
    nombre,
    el("label", { class: "field-label" }, "Fruta principal"),
    fruta,
    el("label", { class: "field-label" }, "Provincia"),
    provinciaSelect,
    el("label", { class: "field-label" }, "Sector / lugar"),
    ubicacion
  );
  root.appendChild(card);

  const gpsCard = el("div", { class: "card" });
  gpsCard.appendChild(el("label", { class: "field-label", style: "margin-top:0" }, "Coordenadas del cultivo"));
  const gpsBox = el("div");
  gpsCard.appendChild(gpsBox);
  root.appendChild(gpsCard);
  let coords = null;
  function refreshGps() {
    clear(gpsBox);
    if (coords) {
      gpsBox.appendChild(el("div", { class: "gps-box" }, `📍 ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`));
    } else {
      gpsBox.appendChild(el("div", { class: "gps-box pending" }, "Sin capturar todavía"));
    }
    const mapBtn = el(
      "button",
      {
        class: "btn secondary small",
        style: "margin-top:8px",
        onclick: async () => {
          const picked = await openMapPicker(coords || {});
          if (picked) {
            coords = picked;
            refreshGps();
          }
        },
      },
      "Seleccionar en el mapa"
    );
    gpsBox.appendChild(mapBtn);
  }
  refreshGps();

  root.appendChild(
    el(
      "button",
      {
        class: "btn",
        style: "margin-top:14px",
        onclick: async () => {
          if (!nombre.value.trim()) return toast("Ingresa el nombre del productor", "error");
          if (!provinciaSelect.value) return toast("Selecciona la provincia", "error");
          const p = await store.saveProveedor({
            nombre: nombre.value.trim(),
            fruta: fruta.value.trim(),
            provincia: provinciaSelect.value,
            ubicacion: ubicacion.value.trim(),
            lat: coords?.lat ?? null,
            lng: coords?.lng ?? null,
            estado: "Nuevo",
          });
          const { cabecera } = await store.createChecklist({ proveedorId: p.id, auditor: "Responsable agrícola" });
          renderWizard(root, cabecera.id);
        },
      },
      "Guardar y empezar inspección"
    )
  );
}

async function renderWizard(root, checklistId, catIndex = 0) {
  clear(root);
  const { cabecera, items, proveedor } = await store.getChecklist(checklistId);
  const categorias = [...new Map(items.map((i) => [i.catNum, i.catName])).entries()].sort((a, b) => a[0] - b[0]);
  const [catNum, catName] = categorias[catIndex];
  const catItems = items.filter((i) => i.catNum === catNum);
  const scoring = store.computeScoring(items);

  root.appendChild(
    el("div", { class: "top-actions" }, [
      el("button", { class: "back-btn", onclick: () => renderChecklistHome(root) }, "‹ Guardar y salir"),
    ])
  );
  root.appendChild(el("h1", {}, `Inspección · ${proveedor?.nombre || ""}`));

  const progress = el("div", { class: "progress" }, [el("div", { style: `width:${((catIndex + 1) / categorias.length) * 100}%` })]);
  const counterEl = el("div", { class: "cat-idx" }, `Categoría ${catIndex + 1} de ${categorias.length} · ${scoring.respondidos}/${scoring.totalItems} respondidos`);
  root.appendChild(
    el("div", { class: "wizard-header" }, [
      el("div", {}, [el("div", { style: "font-weight:700" }, `${catNum}. ${catName}`), counterEl]),
    ])
  );
  root.appendChild(progress);
  root.appendChild(el("div", { style: "height:12px" }));

  function refreshCounter() {
    const s = store.computeScoring(items);
    counterEl.textContent = `Categoría ${catIndex + 1} de ${categorias.length} · ${s.respondidos}/${s.totalItems} respondidos`;
  }

  catItems.forEach((item) => root.appendChild(renderReqItem(item, refreshCounter)));

  const nav = el("div", { class: "btn-row", style: "margin-top:14px" });
  if (catIndex > 0) nav.appendChild(el("button", { class: "btn secondary", onclick: () => renderWizard(root, checklistId, catIndex - 1) }, "‹ Anterior"));
  if (catIndex < categorias.length - 1) {
    nav.appendChild(el("button", { class: "btn", onclick: () => renderWizard(root, checklistId, catIndex + 1) }, "Siguiente ›"));
  } else {
    nav.appendChild(el("button", { class: "btn", onclick: () => renderSummary(root, checklistId) }, "Ver resumen y firmar"));
  }
  root.appendChild(nav);
}

function renderReqItem(item, onChange) {
  const wrap = el("div", { class: "req-item" });
  wrap.append(el("div", { class: "req-num" }, item.reqNum), el("div", { class: "req-text" }, item.text));

  const tri = el("div", { class: "tri-toggle" });
  const options = [
    ["Si", "Sí cumple"],
    ["No", "No cumple"],
    ["NA", "N/A"],
  ];
  const extra = el("div", {});
  let obsInput, photoRow, photoIds;

  function renderExtra() {
    clear(extra);
    if (item.cumple !== "No") return;
    obsInput = el("textarea", { placeholder: "Observación (obligatoria si no cumple)" });
    obsInput.value = item.observaciones || "";
    obsInput.addEventListener("input", () => {
      item.observaciones = obsInput.value;
      store.updateChecklistItem(item);
    });
    photoIds = item.photoId ? [item.photoId] : [];
    photoRow = el("div", { class: "photo-row" });
    extra.append(el("label", { class: "field-label" }, "Observación"), obsInput, el("label", { class: "field-label" }, "Evidencia fotográfica (respaldo)"), photoRow);
    renderPhotoRow(photoRow, photoIds, {
      onAdd: async () => {
        const pid = await capturePhoto();
        if (pid) {
          item.photoId = pid;
          await store.updateChecklistItem(item);
          renderExtra();
        }
      },
      onRemove: async (pid) => {
        item.photoId = null;
        await store.updateChecklistItem(item);
        renderExtra();
      },
    });
  }

  options.forEach(([val, label]) => {
    const btn = el(
      "button",
      {
        class: item.cumple === val ? `sel-${val.toLowerCase()}` : "",
        onclick: async () => {
          item.cumple = val;
          if (val !== "No") item.observaciones = "";
          await store.updateChecklistItem(item);
          [...tri.children].forEach((b) => (b.className = ""));
          btn.className = `sel-${val.toLowerCase()}`;
          renderExtra();
          onChange();
        },
      },
      label
    );
    tri.appendChild(btn);
  });

  wrap.append(tri, extra);
  renderExtra();
  return wrap;
}

export async function renderSummary(root, checklistId, { readonly = false } = {}) {
  clear(root);
  const { cabecera, items, proveedor } = await store.getChecklist(checklistId);
  const scoring = store.computeScoring(items);

  root.appendChild(
    el("div", { class: "top-actions" }, [
      el("button", { class: "back-btn", onclick: () => renderChecklistHome(root) }, "‹ Volver"),
    ])
  );
  root.appendChild(el("h1", {}, `Resumen · ${proveedor?.nombre || ""}`));

  const totalCard = el("div", { class: "card" }, [
    el("div", { class: "total-score" }, [
      el("div", { class: "num", style: scoring.accionGlobal === "OK" ? "color:#226b3e" : "color:#b3261e" }, fmtPct(scoring.ponderacionTotal)),
      el("div", { class: "lab" }, scoring.accionGlobal === "OK" ? "OK — cumple los lineamientos" : "Plan de Acción requerido"),
    ]),
  ]);
  scoring.categorias.forEach((c) => {
    totalCard.appendChild(
      el("div", { class: "summary-cat-row" }, [
        el("div", { style: "flex:1.4" }, c.catName),
        el("div", { class: "bar" }, [
          el("div", { class: "progress" }, [el("div", { style: `width:${c.ponderacion * 100}%;${c.accion === "OK" ? "" : "background:#b3261e"}` })]),
        ]),
        el("div", { style: "width:42px;text-align:right" }, fmtPct(c.ponderacion)),
      ])
    );
  });
  root.appendChild(totalCard);

  if (readonly) {
    root.appendChild(
      el(
        "button",
        {
          class: "btn secondary",
          onclick: async () => {
            const blob = await buildChecklistPdf({ cabecera, items, proveedor, scoring });
            downloadPdf(blob, `CheckList_${proveedor?.nombre || "proveedor"}_${cabecera.fecha}.pdf`);
          },
        },
        "Descargar PDF"
      )
    );
    return;
  }

  root.appendChild(el("div", { class: "section-title" }, "Firma del productor"));
  const canvasProd = el("canvas", { class: "sig-canvas" });
  root.appendChild(canvasProd);
  const padProd = new SignaturePad(canvasProd);
  root.appendChild(el("button", { class: "btn ghost small", style: "margin-top:6px", onclick: () => padProd.clear() }, "Borrar firma"));

  root.appendChild(el("div", { class: "section-title" }, "Firma del auditor"));
  const canvasAud = el("canvas", { class: "sig-canvas" });
  root.appendChild(canvasAud);
  root.appendChild(el("button", { class: "btn ghost small", style: "margin-top:6px", onclick: () => padAud.clear() }, "Borrar firma"));
  const padAud = new SignaturePad(canvasAud);

  const submitBtn = el(
    "button",
    {
      class: "btn",
      style: "margin-top:18px",
      onclick: async () => {
        if (padProd.isEmpty() || padAud.isEmpty()) {
          toast("Se requieren ambas firmas antes de enviar", "error");
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = "Enviando…";
        const firmaProductorBlob = await padProd.toBlob();
        const firmaAuditorBlob = await padAud.toBlob();
        const result = await store.submitChecklist(checklistId, { firmaProductorBlob, firmaAuditorBlob });
        const blob = await buildChecklistPdf({ ...result, proveedor });
        downloadPdf(blob, `CheckList_${proveedor?.nombre || "proveedor"}_${cabecera.fecha}.pdf`);
        toast("Inspección enviada y PDF generado", "success");
        renderChecklistHome(root);
      },
    },
    "Enviar inspección y generar PDF"
  );
  root.appendChild(submitBtn);
}
