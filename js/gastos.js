import { el, clear } from "./dom.js";
import * as store from "./store.js";
import { capturePhoto, renderPhotoRow, SignaturePad, toast, fmtMoney } from "./components.js";
import { getCurrentUser } from "./auth.js";
import { CONFIG } from "./config.js";
import { buildGastoPdf, downloadPdf } from "./pdf.js";

const estadoBadge = { Borrador: "info", Enviado: "warn", Aprobado: "ok", Revisado: "ok", Rechazado: "bad", Pagado: "ok" };
const rutaEstadoBadge = { Planificada: "info", Realizada: "ok", Reprogramada: "warn", Cancelada: "bad" };
// El PDF consolidado (para grapar facturas físicas) solo tiene sentido una
// vez que el gasto ya pasó la aprobación — antes podría seguir cambiando.
const ESTADOS_EXPORTABLES = ["Aprobado", "Revisado", "Pagado"];
const TIPOS_GASTO = ["Movilización propia (Km)", "Hospedaje", "Alimentación", "Atenciones", "Peaje", "Varios"];

export async function renderGastosHome(root) {
  clear(root);
  root.appendChild(el("div", { class: "top-actions" }, [el("h1", {}, "Gastos de Viaje")]));
  root.appendChild(el("button", { class: "btn", onclick: () => renderGastoNuevo(root) }, "+ Nuevo viaje"));

  const currentUser = getCurrentUser();
  const esTalentoHumano = CONFIG.useMock || (currentUser?.username || "").toLowerCase() === CONFIG.approvers.kilometraje.toLowerCase();
  if (esTalentoHumano) {
    root.appendChild(
      el("button", { class: "btn secondary", style: "margin-top:8px", onclick: () => renderConfigTarifa(root) }, "⚙️ Configurar tarifa por Km")
    );
  }

  const gastos = await store.listGastos();
  root.appendChild(el("div", { class: "section-title" }, "Viajes registrados"));
  if (gastos.length === 0) {
    root.appendChild(el("div", { class: "empty-state" }, "Todavía no hay gastos de viaje registrados."));
    return;
  }
  const card = el("div", { class: "card" });
  gastos.forEach((g) => {
    card.appendChild(
      el("div", { class: "list-row", onclick: () => renderGastoDetalle(root, g.id) }, [
        el("div", {}, [el("div", { class: "title" }, g.ciudadViaje || g.motivo || "Viaje"), el("div", { class: "sub" }, `${g.fechaInicio} → ${g.fechaFin}`)]),
        el("span", { class: `badge ${estadoBadge[g.estado] || "info"}` }, g.estado),
      ])
    );
  });
  root.appendChild(card);
}

async function renderConfigTarifa(root) {
  clear(root);
  root.appendChild(el("div", { class: "top-actions" }, [el("button", { class: "back-btn", onclick: () => renderGastosHome(root) }, "‹ Volver")]));
  root.appendChild(el("h1", {}, "Tarifa por Km"));

  const rate = await store.getKmRate();
  const card = el("div", { class: "card" });
  const input = el("input", { type: "number", step: "0.01", min: "0", value: rate });
  card.append(
    el("label", { class: "field-label" }, "Valor por kilómetro ($)"),
    input,
    el("div", { class: "hint" }, "Se aplica a toda línea de \"Movilización propia (Km)\" que se cree a partir de ahora. Las líneas ya registradas conservan el monto con el que se calcularon.")
  );
  root.appendChild(card);

  root.appendChild(
    el(
      "button",
      {
        class: "btn",
        style: "margin-top:14px",
        onclick: async () => {
          const value = Number(input.value);
          if (!(value > 0)) return toast("Ingresa un valor válido", "error");
          try {
            await store.setKmRate(value);
          } catch (e) {
            return toast(e.message, "error");
          }
          toast("Tarifa actualizada", "success");
          renderGastosHome(root);
        },
      },
      "Guardar"
    )
  );
}

async function renderGastoNuevo(root) {
  clear(root);
  root.appendChild(el("div", { class: "top-actions" }, [el("button", { class: "back-btn", onclick: () => renderGastosHome(root) }, "‹ Volver")]));
  root.appendChild(el("h1", {}, "Nuevo viaje"));

  const card = el("div", { class: "card" });
  const currentUser = getCurrentUser();
  const viajero = el("input", { type: "text", placeholder: "Nombre del viajero", value: currentUser?.name || currentUser?.username || "" });
  const ciudadBase = el("input", { type: "text", placeholder: "Ej. Machachi", value: "Machachi" });
  const ciudadViaje = el("input", { type: "text", placeholder: "Ej. Los Ángeles - Categosín - Km 18" });
  const fechaInicio = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) });
  const fechaFin = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) });
  const motivo = el("input", { type: "text", placeholder: "Ej. Visita proveedores de mora" });
  const anticipo = el("input", { type: "number", placeholder: "0.00", step: "0.01" });

  card.append(
    el("label", { class: "field-label" }, "Viajero"),
    viajero,
    el("label", { class: "field-label" }, "Ciudad base"),
    ciudadBase,
    el("label", { class: "field-label" }, "Ciudad / ruta de viaje"),
    ciudadViaje,
    el("div", { class: "grid-2" }, [
      el("div", {}, [el("label", { class: "field-label" }, "Fecha inicio"), fechaInicio]),
      el("div", {}, [el("label", { class: "field-label" }, "Fecha fin"), fechaFin]),
    ]),
    el("label", { class: "field-label" }, "Motivo del viaje"),
    motivo,
    el("label", { class: "field-label" }, "Anticipo recibido ($)"),
    anticipo
  );
  root.appendChild(card);

  // Un viaje puede cubrir varias visitas de Ruta (varios proveedores/días).
  // En vez de volver a marcar a mano qué proveedores se visitaron, se ligan
  // las visitas de Ruta ya registradas — así Gastos deja de ser un silo
  // aparte y el proveedor de cada parada se toma directo de ahí.
  const todasRutas = await store.listRutas();
  const rutaCard = el("div", { class: "card" });
  rutaCard.appendChild(el("label", { class: "field-label", style: "margin-top:0" }, "Rutas de este viaje"));
  rutaCard.appendChild(el("div", { class: "hint" }, "Marca las visitas de Ruta que corresponden a este viaje (filtradas por las fechas de arriba)."));
  const rutaListBox = el("div");
  rutaCard.appendChild(rutaListBox);
  root.appendChild(rutaCard);

  const rutaChecks = [];
  function refreshRutaList() {
    clear(rutaListBox);
    rutaChecks.length = 0;
    const desde = fechaInicio.value;
    const hasta = fechaFin.value;
    const enRango = todasRutas.filter((r) => (!desde || r.fecha >= desde) && (!hasta || r.fecha <= hasta));
    if (enRango.length === 0) {
      rutaListBox.appendChild(el("div", { class: "hint" }, "No hay rutas registradas en estas fechas."));
      return;
    }
    enRango.forEach((r) => {
      const cb = el("input", { type: "checkbox", value: r.id, style: "width:auto;margin-right:8px" });
      rutaChecks.push({ cb, ruta: r });
      rutaListBox.appendChild(
        el("label", { style: "display:flex;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:14px" }, [
          cb,
          `${r.fecha} · ${r.proveedor?.nombre || r.proveedorNuevoTexto || "—"} (${r.lugar || r.estado})`,
        ])
      );
    });
  }
  refreshRutaList();
  fechaInicio.addEventListener("change", refreshRutaList);
  fechaFin.addEventListener("change", refreshRutaList);

  // Respaldo para viajes sin visita de Ruta formal (ej. reuniones administrativas).
  const proveedores = await store.listProveedores();
  const provCard = el("div", { class: "card" });
  provCard.appendChild(el("label", { class: "field-label", style: "margin-top:0" }, "Otros proveedores (sin ruta registrada)"));
  const checks = [];
  proveedores.forEach((p) => {
    const cb = el("input", { type: "checkbox", value: p.id, style: "width:auto;margin-right:8px" });
    checks.push(cb);
    provCard.appendChild(
      el("label", { style: "display:flex;align-items:center;padding:8px 0;border-bottom:1px solid var(--border);font-size:14px" }, [
        cb,
        `${p.nombre} (${p.fruta})`,
      ])
    );
  });
  root.appendChild(provCard);

  root.appendChild(
    el(
      "button",
      {
        class: "btn",
        style: "margin-top:14px",
        onclick: async () => {
          if (!ciudadViaje.value.trim()) return toast("Ingresa la ciudad o ruta de viaje", "error");
          const rutasSeleccionadas = rutaChecks.filter((x) => x.cb.checked).map((x) => x.ruta);
          const rutasIds = rutasSeleccionadas.map((r) => r.id);
          const proveedoresDeRutas = rutasSeleccionadas.map((r) => r.proveedorId).filter(Boolean);
          const proveedoresManual = checks.filter((c) => c.checked).map((c) => c.value);
          const proveedoresVisitados = [...new Set([...proveedoresDeRutas, ...proveedoresManual])];
          const g = await store.createGasto({
            viajero: viajero.value.trim(),
            ciudadBase: ciudadBase.value.trim(),
            ciudadViaje: ciudadViaje.value.trim(),
            fechaInicio: fechaInicio.value,
            fechaFin: fechaFin.value,
            motivo: motivo.value.trim(),
            anticipo: Number(anticipo.value || 0),
            rutasIds,
            proveedoresVisitados,
          });
          renderGastoDetalle(root, g.id);
        },
      },
      "Crear viaje y agregar gastos"
    )
  );
}

async function renderGastoDetalle(root, gastoId) {
  clear(root);
  const { cabecera, lineas } = await store.getGasto(gastoId);
  const totales = store.computeGastoTotales({ cabecera, lineas });
  const readonly = cabecera.estado !== "Borrador";
  const proveedores = await store.listProveedores();
  const provById = Object.fromEntries(proveedores.map((p) => [p.id, p]));

  root.appendChild(el("div", { class: "top-actions" }, [el("button", { class: "back-btn", onclick: () => renderGastosHome(root) }, "‹ Volver")]));
  root.appendChild(el("h1", {}, cabecera.ciudadViaje));

  const summary = el("div", { class: "card" }, [
    el("div", { class: "list-row" }, [el("div", {}, "Total gastos"), el("div", { class: "amt" }, fmtMoney(totales.total))]),
    el("div", { class: "list-row" }, [el("div", {}, "Anticipo"), el("div", {}, fmtMoney(cabecera.anticipo))]),
    el("div", { class: "list-row" }, [
      el("div", {}, totales.valorADevolver >= 0 ? "La empresa reembolsa" : "El viajero devuelve"),
      el("div", { class: "amt" }, fmtMoney(Math.abs(totales.valorADevolver))),
    ]),
    el("div", { class: "list-row" }, [el("div", {}, "Estado"), el("span", { class: `badge ${estadoBadge[cabecera.estado] || "info"}` }, cabecera.estado)]),
  ]);
  if (cabecera.proveedoresVisitados?.length) {
    const nombres = cabecera.proveedoresVisitados.map((id) => provById[id]?.nombre).filter(Boolean).join(", ");
    summary.appendChild(el("div", { class: "list-row" }, [el("div", {}, "Proveedores visitados"), el("div", { style: "text-align:right;max-width:60%" }, nombres || "-")]));
  }
  root.appendChild(summary);

  if (cabecera.rutasIds?.length) {
    const todasRutas = await store.listRutas();
    const rutasDelViaje = todasRutas.filter((r) => cabecera.rutasIds.includes(r.id));
    if (rutasDelViaje.length) {
      const rutasCard = el("div", { class: "card" });
      rutasCard.appendChild(el("div", { class: "section-title", style: "margin-top:0" }, "Rutas de este viaje"));
      rutasDelViaje.forEach((r) => {
        rutasCard.appendChild(
          el("div", { class: "list-row" }, [
            el("div", {}, [
              el("div", { class: "title" }, r.proveedor?.nombre || r.proveedorNuevoTexto || "—"),
              el("div", { class: "sub" }, `${r.fecha} · ${r.lugar || ""}`),
            ]),
            el("span", { class: `badge ${rutaEstadoBadge[r.estado] || "info"}` }, r.estado),
          ])
        );
      });
      root.appendChild(rutasCard);
    }
  }

  if (ESTADOS_EXPORTABLES.includes(cabecera.estado)) {
    root.appendChild(
      el(
        "button",
        {
          class: "btn secondary",
          onclick: async () => {
            const blob = await buildGastoPdf({ cabecera, lineas, provById, totales });
            downloadPdf(blob, `Gastos_${cabecera.viajero || "viaje"}_${cabecera.fechaInicio}.pdf`);
          },
        },
        "Descargar PDF consolidado"
      )
    );
    root.appendChild(el("div", { class: "hint" }, "Imprime este PDF y adjunta detrás las facturas físicas de cada línea."));
    root.appendChild(el("div", { style: "height:10px" }));
  }

  root.appendChild(el("div", { class: "section-title" }, "Líneas de gasto"));
  lineas.forEach((l) => root.appendChild(renderLineaCard(l, provById, { onClick: !readonly ? () => renderLineaForm(root, cabecera, l) : null })));

  if (!readonly) {
    root.appendChild(el("button", { class: "btn secondary", onclick: () => renderLineaForm(root, cabecera) }, "+ Agregar línea de gasto"));
    root.appendChild(el("div", { style: "height:10px" }));
    root.appendChild(el("div", { class: "section-title" }, "Firma y envío"));
    const canvas = el("canvas", { class: "sig-canvas" });
    root.appendChild(canvas);
    const pad = new SignaturePad(canvas);
    root.appendChild(el("button", { class: "btn ghost small", style: "margin-top:6px", onclick: () => pad.clear() }, "Borrar firma"));

    root.appendChild(
      el(
        "button",
        {
          class: "btn",
          style: "margin-top:14px",
          onclick: async () => {
            if (lineas.length === 0) return toast("Agrega al menos una línea de gasto", "error");
            if (pad.isEmpty()) return toast("Firma antes de enviar", "error");
            await store.submitGasto(cabecera, lineas);
            toast("Gasto enviado a aprobación", "success");
            renderGastosHome(root);
          },
        },
        "Enviar a aprobación"
      )
    );
  } else if (cabecera.estado === "Rechazado" && cabecera.comentarioRechazo) {
    root.appendChild(el("div", { class: "card" }, [el("div", { class: "section-title" }, "Motivo de rechazo"), el("div", {}, cabecera.comentarioRechazo)]));
  }

  if (cabecera.estado === "Enviado") {
    const currentUser = getCurrentUser();
    const currentEmail = (currentUser?.username || "").toLowerCase();

    root.appendChild(el("div", { class: "section-title" }, "Aprobación por línea"));
    root.appendChild(
      el("div", { class: "hint" }, "El kilometraje lo aprueba Talento Humano; el resto (hospedaje, alimentación, etc.) lo aprueba Compras. Cada línea se aprueba por separado; si rechazas cualquiera, todo el viaje vuelve al viajero para corregir y reenviar.")
    );

    lineas.forEach((l) => {
      const aprobador = store.computeAprobadorLinea(l.tipo);
      const estadoLinea = l.estadoLinea || "Pendiente";
      // En modo demo no hay sesión real de Microsoft, así que no se puede
      // comparar cuenta contra cuenta — se deja pasar para poder probar.
      const puedeRevisar = estadoLinea === "Pendiente" && (CONFIG.useMock || currentEmail === aprobador.toLowerCase());

      const lineaCard = el("div", { class: "card" }, [
        el("div", { class: "list-row" }, [
          el("div", {}, [
            el("div", { class: "title" }, `${l.tipo} — $${Number(l.monto || 0).toFixed(2)}`),
            el("div", { class: "sub" }, `Asignado a: ${aprobador}`),
          ]),
          el("span", { class: `badge ${estadoLinea === "Aprobado" ? "ok" : estadoLinea === "Rechazado" ? "bad" : "warn"}` }, estadoLinea),
        ]),
      ]);
      if (l.tipo === "Movilización propia (Km)") {
        const kmTotal = Number(l.kmFinal || 0) - Number(l.kmInicio || 0);
        lineaCard.appendChild(
          el("div", { class: "hint" }, `Km inicio: ${l.kmInicio ?? "-"} · Km final: ${l.kmFinal ?? "-"} · Total: ${kmTotal} km`)
        );
      }

      if (puedeRevisar) {
        const btnRow = el("div", { class: "btn-row", style: "margin-top:8px" });
        btnRow.append(
          el(
            "button",
            {
              class: "btn small",
              onclick: async () => {
                await store.reviewGastoLinea(cabecera.id, l, "Aprobado", { revisor: currentUser?.username || currentUser?.name || "" });
                toast("Línea aprobada", "success");
                renderGastoDetalle(root, cabecera.id);
              },
            },
            "Aprobar"
          ),
          el(
            "button",
            {
              class: "btn danger small",
              onclick: async () => {
                const motivo = prompt("Motivo del rechazo:");
                if (!motivo) return;
                await store.reviewGastoLinea(cabecera.id, l, "Rechazado", { comentario: motivo, revisor: currentUser?.username || currentUser?.name || "" });
                toast("Línea rechazada", "success");
                renderGastoDetalle(root, cabecera.id);
              },
            },
            "Rechazar"
          )
        );
        lineaCard.appendChild(btnRow);
      } else if (estadoLinea === "Pendiente") {
        lineaCard.appendChild(el("div", { class: "hint" }, `Pendiente de ${aprobador} — tu cuenta (${currentUser?.username || "sin sesión"}) no la puede revisar.`));
      }
      root.appendChild(lineaCard);
    });
  }

  if (cabecera.estado === "Rechazado") {
    root.appendChild(
      el(
        "button",
        {
          class: "btn secondary",
          style: "margin-top:10px",
          onclick: async () => {
            await store.updateGasto({ ...cabecera, estado: "Borrador" });
            renderGastoDetalle(root, cabecera.id);
          },
        },
        "Editar y reenviar"
      )
    );
  }
}

function renderLineaCard(l, provById = {}, { onClick } = {}) {
  const provNombre = l.proveedorId ? provById[l.proveedorId]?.nombre : null;
  const estadoLinea = l.estadoLinea || "Pendiente";
  const badgeClass = estadoLinea === "Aprobado" ? "ok" : estadoLinea === "Rechazado" ? "bad" : "info";
  return el("div", { class: "expense-line", onclick: onClick || undefined, style: onClick ? "cursor:pointer" : "" }, [
    el("div", { class: "head" }, [el("div", {}, `${l.fecha || ""} · ${l.tipo}`), el("div", { class: "amt" }, `$${Number(l.monto || 0).toFixed(2)}`)]),
    el("div", { class: "hint" }, [l.lugar, l.proveedorServicio, provNombre ? `Visita: ${provNombre}` : null].filter(Boolean).join(" · ")),
    el("span", { class: `badge ${badgeClass}`, style: "margin-top:6px" }, estadoLinea),
  ]);
}

async function renderLineaForm(root, cabecera, existing = null) {
  clear(root);
  root.appendChild(el("div", { class: "top-actions" }, [el("button", { class: "back-btn", onclick: () => renderGastoDetalle(root, cabecera.id) }, "‹ Volver")]));
  root.appendChild(el("h1", {}, existing ? "Editar línea de gasto" : "Nueva línea de gasto"));

  const card = el("div", { class: "card" });
  const tipoSelect = el(
    "select",
    {},
    TIPOS_GASTO.map((t) => el("option", { value: t, selected: existing?.tipo === t ? "selected" : undefined }, t))
  );
  const fecha = el("input", { type: "date", value: (existing?.fecha || new Date().toISOString()).slice(0, 10) });
  const lugar = el("input", { type: "text", placeholder: "Lugar", value: existing?.lugar || "" });
  const proveedorServicio = el("input", { type: "text", placeholder: "Proveedor de servicio (ej. hotel, restaurante)", value: existing?.proveedorServicio || "" });
  const documento = el("input", { type: "text", placeholder: "N.º de factura", value: existing?.documento || "" });
  const todosProveedores = await store.listProveedores();
  const opcionesProveedor = cabecera.proveedoresVisitados?.length
    ? todosProveedores.filter((p) => cabecera.proveedoresVisitados.includes(p.id))
    : todosProveedores;
  const proveedorSelect = el("select", {}, [
    el("option", { value: "" }, "— No aplica (peaje, alimentación, etc.) —"),
    ...opcionesProveedor.map((p) => el("option", { value: p.id, selected: existing?.proveedorId === p.id ? "selected" : undefined }, `${p.nombre} (${p.fruta})`)),
  ]);
  const monto = el("input", { type: "number", placeholder: "0.00", step: "0.01", value: existing?.monto ?? "" });
  const kmInicio = el("input", { type: "number", value: existing?.kmInicio ?? "" });
  const kmFinal = el("input", { type: "number", value: existing?.kmFinal ?? "" });
  const kmWrap = el("div", { class: "grid-2" }, [
    el("div", {}, [el("label", { class: "field-label" }, "Km inicio"), kmInicio]),
    el("div", {}, [el("label", { class: "field-label" }, "Km final"), kmFinal]),
  ]);
  const montoWrap = el("div", {}, [el("label", { class: "field-label" }, "Monto ($)"), monto]);

  function refreshTipoFields() {
    kmWrap.style.display = tipoSelect.value === TIPOS_GASTO[0] ? "grid" : "none";
    montoWrap.style.display = tipoSelect.value === TIPOS_GASTO[0] ? "none" : "block";
  }
  tipoSelect.addEventListener("change", refreshTipoFields);

  card.append(
    el("label", { class: "field-label" }, "Tipo de gasto"),
    tipoSelect,
    el("label", { class: "field-label" }, "Fecha"),
    fecha,
    el("label", { class: "field-label" }, "Lugar"),
    lugar,
    el("label", { class: "field-label" }, "Proveedor de servicio"),
    proveedorServicio,
    el("label", { class: "field-label" }, "N.º de factura"),
    documento,
    el("label", { class: "field-label" }, "Proveedor visitado en esta parada (opcional)"),
    proveedorSelect,
    kmWrap,
    montoWrap
  );
  root.appendChild(card);
  refreshTipoFields();

  const photoCard = el("div", { class: "card" });
  photoCard.appendChild(el("label", { class: "field-label", style: "margin-top:0" }, "Foto de factura / recibo"));
  const photoRow = el("div", { class: "photo-row" });
  photoCard.appendChild(photoRow);
  root.appendChild(photoCard);
  let photoId = existing?.photoId || null;
  function refreshPhoto() {
    renderPhotoRow(photoRow, photoId ? [photoId] : [], {
      max: 1,
      onAdd: async () => {
        const pid = await capturePhoto();
        if (pid) {
          photoId = pid;
          refreshPhoto();
        }
      },
      onRemove: () => {
        photoId = null;
        refreshPhoto();
      },
    });
  }
  refreshPhoto();

  root.appendChild(
    el(
      "button",
      {
        class: "btn",
        onclick: async () => {
          const isKm = tipoSelect.value === TIPOS_GASTO[0];
          if (!isKm && !documento.value.trim()) return toast("Ingresa el N.º de factura", "error");
          if (!isKm && !photoId) return toast("Adjunta la foto de la factura o recibo", "error");
          await store.addGastoLinea(cabecera.id, {
            id: existing?.id,
            _itemId: existing?._itemId,
            tipo: tipoSelect.value,
            fecha: fecha.value,
            lugar: lugar.value.trim(),
            proveedorServicio: proveedorServicio.value.trim(),
            proveedorId: proveedorSelect.value || null,
            documento: documento.value.trim(),
            monto: monto.value,
            kmInicio: kmInicio.value,
            kmFinal: kmFinal.value,
            photoId,
          });
          toast(existing ? "Línea actualizada" : "Línea de gasto agregada", "success");
          renderGastoDetalle(root, cabecera.id);
        },
      },
      "Guardar línea"
    )
  );

  if (existing) {
    root.appendChild(
      el(
        "button",
        {
          class: "btn danger",
          style: "margin-top:10px",
          onclick: async () => {
            if (!confirm("¿Eliminar esta línea de gasto?")) return;
            await store.deleteGastoLinea(existing);
            toast("Línea eliminada", "success");
            renderGastoDetalle(root, cabecera.id);
          },
        },
        "🗑 Eliminar línea"
      )
    );
  }
}
