import { el, clear } from "./dom.js";
import * as store from "./store.js";
import { capturePhoto, renderPhotoRow, SignaturePad, toast, fmtMoney } from "./components.js";
import { getCurrentUser } from "./auth.js";
import { CONFIG } from "./config.js";

const estadoBadge = { Borrador: "info", Enviado: "warn", Aprobado: "ok", Revisado: "ok", Rechazado: "bad", Pagado: "ok" };
const TIPOS_GASTO = ["Movilización propia (Km)", "Hospedaje", "Alimentación", "Atenciones", "Peaje", "Varios"];

export async function renderGastosHome(root) {
  clear(root);
  root.appendChild(el("div", { class: "top-actions" }, [el("h1", {}, "Gastos de Viaje")]));
  root.appendChild(el("button", { class: "btn", onclick: () => renderGastoNuevo(root) }, "+ Nuevo viaje"));

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

  // Viajes mixtos: un mismo viaje puede cubrir varios proveedores/puntos de visita
  // (ver cada línea de gasto para el detalle de fecha/lugar de cada parada).
  const proveedores = await store.listProveedores();
  const provCard = el("div", { class: "card" });
  provCard.appendChild(el("label", { class: "field-label", style: "margin-top:0" }, "Proveedores visitados en este viaje"));
  provCard.appendChild(el("div", { class: "hint" }, "Marca todos los que apliquen — un viaje puede cubrir varios puntos."));
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
          const proveedoresVisitados = checks.filter((c) => c.checked).map((c) => c.value);
          const g = await store.createGasto({
            viajero: viajero.value.trim(),
            ciudadBase: ciudadBase.value.trim(),
            ciudadViaje: ciudadViaje.value.trim(),
            fechaInicio: fechaInicio.value,
            fechaFin: fechaFin.value,
            motivo: motivo.value.trim(),
            anticipo: Number(anticipo.value || 0),
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

  root.appendChild(el("div", { class: "section-title" }, "Líneas de gasto"));
  lineas.forEach((l) => root.appendChild(renderLineaCard(l, provById)));

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
            const jefeInmediato = store.computeAprobador(lineas);
            await store.updateGasto({ ...cabecera, estado: "Enviado", firmaFecha: new Date().toISOString(), jefeInmediato });
            toast(`Gasto enviado a ${jefeInmediato} para aprobación`, "success");
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
    const asignadoA = (cabecera.jefeInmediato || "").toLowerCase();
    // En modo demo no hay sesión real de Microsoft, así que no se puede
    // comparar cuenta contra cuenta — se deja pasar para poder probar.
    const puedeAprobar = CONFIG.useMock || !asignadoA || currentEmail === asignadoA;

    root.appendChild(el("div", { class: "section-title" }, "Aprobación"));
    root.appendChild(
      el("div", { class: "hint" }, `Asignado a: ${cabecera.jefeInmediato || "sin asignar"}. En producción esto también podría llegar como aprobación de Microsoft Approvals (Teams/correo); por ahora, la persona asignada lo resuelve desde este mismo celular.`)
    );

    if (puedeAprobar) {
      root.appendChild(
        el(
          "button",
          {
            class: "btn",
            onclick: async () => {
              await store.updateGasto({ ...cabecera, estado: "Aprobado", revisor: currentUser?.username || currentUser?.name || "" });
              toast("Gasto aprobado", "success");
              renderGastosHome(root);
            },
          },
          "Aprobar"
        )
      );
      root.appendChild(
        el(
          "button",
          {
            class: "btn danger",
            style: "margin-top:8px",
            onclick: async () => {
              const motivo = prompt("Motivo del rechazo:");
              if (!motivo) return;
              await store.updateGasto({ ...cabecera, estado: "Rechazado", comentarioRechazo: motivo, revisor: currentUser?.username || currentUser?.name || "" });
              toast("Gasto rechazado", "success");
              renderGastosHome(root);
            },
          },
          "Rechazar"
        )
      );
    } else {
      root.appendChild(
        el("div", { class: "hint" }, `Este gasto está asignado a ${cabecera.jefeInmediato} para aprobar. Tu cuenta (${currentUser?.username || "sin sesión"}) no coincide, así que no puedes aprobarlo o rechazarlo desde aquí.`)
      );
    }
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

function renderLineaCard(l, provById = {}) {
  const provNombre = l.proveedorId ? provById[l.proveedorId]?.nombre : null;
  return el("div", { class: "expense-line" }, [
    el("div", { class: "head" }, [el("div", {}, `${l.fecha || ""} · ${l.tipo}`), el("div", { class: "amt" }, `$${Number(l.monto || 0).toFixed(2)}`)]),
    el("div", { class: "hint" }, [l.lugar, l.proveedorServicio, provNombre ? `Visita: ${provNombre}` : null].filter(Boolean).join(" · ")),
  ]);
}

async function renderLineaForm(root, cabecera) {
  clear(root);
  root.appendChild(el("div", { class: "top-actions" }, [el("button", { class: "back-btn", onclick: () => renderGastoDetalle(root, cabecera.id) }, "‹ Volver")]));
  root.appendChild(el("h1", {}, "Nueva línea de gasto"));

  const card = el("div", { class: "card" });
  const tipoSelect = el("select", {}, TIPOS_GASTO.map((t) => el("option", { value: t }, t)));
  const fecha = el("input", { type: "date", value: new Date().toISOString().slice(0, 10) });
  const lugar = el("input", { type: "text", placeholder: "Lugar" });
  const proveedorServicio = el("input", { type: "text", placeholder: "Proveedor de servicio (ej. hotel, restaurante)" });
  const documento = el("input", { type: "text", placeholder: "N.º de documento / RUC" });
  const todosProveedores = await store.listProveedores();
  const opcionesProveedor = cabecera.proveedoresVisitados?.length
    ? todosProveedores.filter((p) => cabecera.proveedoresVisitados.includes(p.id))
    : todosProveedores;
  const proveedorSelect = el("select", {}, [
    el("option", { value: "" }, "— No aplica (peaje, alimentación, etc.) —"),
    ...opcionesProveedor.map((p) => el("option", { value: p.id }, `${p.nombre} (${p.fruta})`)),
  ]);
  const monto = el("input", { type: "number", placeholder: "0.00", step: "0.01" });
  const kmInicio = el("input", { type: "number" });
  const kmFinal = el("input", { type: "number" });
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
    el("label", { class: "field-label" }, "N.º documento / RUC"),
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
  let photoId = null;
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
          if (!isKm && !photoId) return toast("Adjunta la foto de la factura o recibo", "error");
          await store.addGastoLinea(cabecera.id, {
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
          toast("Línea de gasto agregada", "success");
          renderGastoDetalle(root, cabecera.id);
        },
      },
      "Guardar línea"
    )
  );
}
