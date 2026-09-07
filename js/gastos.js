import { el, clear } from "./dom.js";
import * as store from "./store.js";
import { capturePhoto, renderPhotoRow, SignaturePad, toast, fmtMoney } from "./components.js";
import { getCurrentUser } from "./auth.js";
import { CONFIG } from "./config.js";
import { buildGastoPdf, downloadPdf, sharePdf } from "./pdf.js";

const estadoBadge = { Borrador: "info", Enviado: "warn", Aprobado: "ok", Revisado: "ok", Rechazado: "bad", Pagado: "ok" };
const rutaEstadoBadge = { Planificada: "info", Realizada: "ok", Reprogramada: "warn", Cancelada: "bad" };
const TIPOS_GASTO = ["Movilización propia (Km)", "Hospedaje", "Alimentación", "Atenciones", "Peaje", "Varios"];
// Igual que ESTADOS_APROBADOS en pdf.js — solo para elegir el texto del
// aviso junto al botón de descargar/compartir (el PDF ya se puede generar
// en cualquier estado, marcado como preliminar si aún no está aprobado).
const ESTADOS_APROBADOS_HINT = ["Aprobado", "Revisado", "Pagado"];

// "2026-08-14" -> "14/08/2026" — las fechas en bruto (ISO, a veces con hora
// completa porque SharePoint las devuelve así) se prestaban a confusión.
function fmtFecha(iso) {
  if (!iso) return "-";
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

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

  const gastos = await store.listGastosConTotales();
  if (gastos.length === 0) {
    root.appendChild(el("div", { class: "section-title" }, "Viajes registrados"));
    root.appendChild(el("div", { class: "empty-state" }, "Todavía no hay gastos de viaje registrados."));
    return;
  }

  const filterCard = el("div", { class: "card" });
  const desde = el("input", { type: "date" });
  const hasta = el("input", { type: "date" });
  filterCard.append(
    el("label", { class: "field-label", style: "margin-top:0" }, "Filtrar por fecha de viaje"),
    el("div", { class: "grid-2" }, [
      el("div", {}, [el("label", { class: "field-label" }, "Desde"), desde]),
      el("div", {}, [el("label", { class: "field-label" }, "Hasta"), hasta]),
    ])
  );
  root.appendChild(filterCard);

  const resultsSection = el("div");
  root.appendChild(resultsSection);

  function renderResults() {
    clear(resultsSection);
    const filtrados = gastos.filter((g) => {
      const fecha = (g.fechaInicio || "").slice(0, 10);
      if (desde.value && fecha < desde.value) return false;
      if (hasta.value && fecha > hasta.value) return false;
      return true;
    });

    if (filtrados.length === 0) {
      resultsSection.appendChild(el("div", { class: "empty-state" }, "No hay viajes que coincidan con el filtro."));
      return;
    }

    // Así se liquidan y controlan los gastos del técnico: agrupados por
    // semana (viático fijo semanal, ver CONFIG.viaticoSemanal), no por viaje.
    const semanas = {};
    filtrados.forEach((g) => {
      const fecha = (g.fechaInicio || "").slice(0, 10);
      if (!fecha) return;
      const year = store.isoWeekYear(fecha);
      const week = store.isoWeek(fecha);
      const key = `${year}-${String(week).padStart(2, "0")}`;
      semanas[key] = semanas[key] || { year, week, gastos: [] };
      semanas[key].gastos.push(g);
    });

    Object.values(semanas)
      .sort((a, b) => b.year - a.year || b.week - a.week)
      .forEach(({ year, week, gastos: gastosSemana }) => {
        const { inicio, fin } = store.isoWeekRange(year, week);
        const totalSemana = gastosSemana.reduce((s, g) => s + g.totalLineas, 0);
        const semanaTotales = store.computeSemanaTotales(totalSemana);

        resultsSection.appendChild(el("div", { class: "section-title" }, `Semana ${week} · ${fmtFecha(inicio)} – ${fmtFecha(fin)}`));
        const semanaCard = el("div", { class: "card" }, [
          el("div", { class: "list-row" }, [el("div", {}, "Total gastos"), el("div", { class: "amt" }, fmtMoney(semanaTotales.total))]),
          el("div", { class: "list-row" }, [el("div", {}, "Viático semanal"), el("div", {}, fmtMoney(semanaTotales.anticipo))]),
          el("div", { class: "list-row" }, [
            el("div", {}, semanaTotales.valorADevolver >= 0 ? "La empresa reembolsa" : "El técnico devuelve"),
            el("div", { class: "amt" }, fmtMoney(Math.abs(semanaTotales.valorADevolver))),
          ]),
        ]);
        resultsSection.appendChild(semanaCard);

        const card = el("div", { class: "card" });
        gastosSemana.forEach((g) => {
          card.appendChild(
            el("div", { class: "list-row", onclick: () => renderGastoDetalle(root, g.id) }, [
              el("div", {}, [
                el("div", { class: "title" }, g.ciudadViaje || g.motivo || "Viaje"),
                el("div", { class: "sub" }, `${fmtFecha(g.fechaInicio)} – ${fmtFecha(g.fechaFin)}`),
              ]),
              el("div", { class: "rt" }, [
                el("span", { class: `badge ${estadoBadge[g.estado] || "info"}` }, g.estado),
                el("div", { class: "sub" }, fmtMoney(g.totalLineas)),
              ]),
            ])
          );
        });
        resultsSection.appendChild(card);
      });
  }

  desde.addEventListener("change", renderResults);
  hasta.addEventListener("change", renderResults);
  renderResults();
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
    motivo
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
          `${fmtFecha(r.fecha)} · ${r.proveedor?.nombre || r.proveedorNuevoTexto || "—"} (${r.lugar || r.estado})`,
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
  const totales = store.computeGastoTotales({ lineas });
  const readonly = cabecera.estado !== "Borrador";
  const proveedores = await store.listProveedores();
  const provById = Object.fromEntries(proveedores.map((p) => [p.id, p]));

  root.appendChild(el("div", { class: "top-actions" }, [el("button", { class: "back-btn", onclick: () => renderGastosHome(root) }, "‹ Volver")]));
  root.appendChild(el("h1", {}, cabecera.ciudadViaje));

  const summary = el("div", { class: "card" }, [
    el("div", { class: "list-row" }, [
      el("div", {}, "Fechas"),
      el("div", { class: "amt" }, `${fmtFecha(cabecera.fechaInicio)} – ${fmtFecha(cabecera.fechaFin)}`),
    ]),
    el("div", { class: "list-row" }, [
      el("div", {}, "Semana"),
      el("div", {}, cabecera.fechaInicio ? `Semana ${store.isoWeek(cabecera.fechaInicio.slice(0, 10))}` : "-"),
    ]),
    el("div", { class: "list-row" }, [el("div", {}, "Total gastos"), el("div", { class: "amt" }, fmtMoney(totales.total))]),
    el("div", { class: "list-row" }, [el("div", {}, "Estado"), el("span", { class: `badge ${estadoBadge[cabecera.estado] || "info"}` }, cabecera.estado)]),
  ]);
  if (totales.totalKm > 0) {
    summary.appendChild(el("div", { class: "list-row" }, [el("div", {}, "Km recorridos"), el("div", {}, `${totales.totalKm} km`)]));
  }
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
              el("div", { class: "sub" }, `${fmtFecha(r.fecha)} · ${r.lugar || ""}`),
            ]),
            el("span", { class: `badge ${rutaEstadoBadge[r.estado] || "info"}` }, r.estado),
          ])
        );
      });
      root.appendChild(rutasCard);
    }
  }

  {
    const pdfFilename = `Gastos_${cabecera.viajero || "viaje"}_${(cabecera.fechaInicio || "").slice(0, 10)}.pdf`;
    root.appendChild(
      el("div", { class: "btn-row" }, [
        el(
          "button",
          {
            class: "btn secondary",
            onclick: async () => {
              const blob = await buildGastoPdf({ cabecera, lineas, provById, totales });
              downloadPdf(blob, pdfFilename);
            },
          },
          "🖨 Descargar / Imprimir"
        ),
        el(
          "button",
          {
            class: "btn secondary",
            onclick: async () => {
              const blob = await buildGastoPdf({ cabecera, lineas, provById, totales });
              const compartido = await sharePdf(blob, pdfFilename);
              if (!compartido) {
                downloadPdf(blob, pdfFilename);
                toast("Este dispositivo no permite compartir directamente — se descargó el PDF", "info");
              }
            },
          },
          "📤 Compartir"
        ),
      ])
    );
    root.appendChild(
      el(
        "div",
        { class: "hint" },
        ESTADOS_APROBADOS_HINT.includes(cabecera.estado)
          ? "Imprime este PDF y adjunta detrás las facturas físicas de cada línea."
          : `El viaje todavía está en estado "${cabecera.estado}" — el PDF sale marcado como reporte preliminar, no aprobado.`
      )
    );
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
        const kmTotal = Math.max(0, Number(l.kmFinal || 0) - Number(l.kmInicio || 0));
        lineaCard.appendChild(
          el("div", { class: "hint" }, `Km inicio: ${l.kmInicio ?? "-"} · Km final: ${l.kmFinal ?? "-"} · Total: ${kmTotal} km`)
        );
      }
      if (l.comentario) {
        lineaCard.appendChild(el("div", { class: "hint" }, `Comentario: ${l.comentario}`));
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
  const isKm = l.tipo === "Movilización propia (Km)";
  const hintParts = isKm
    ? [`Km ${l.kmInicio ?? "-"} → ${l.kmFinal ?? "-"} (${Math.max(0, Number(l.kmFinal || 0) - Number(l.kmInicio || 0))} km)`]
    : [l.lugar, l.proveedorServicio, provNombre ? `Visita: ${provNombre}` : null];
  const wrap = el("div", { class: "expense-line", onclick: onClick || undefined, style: onClick ? "cursor:pointer" : "" }, [
    el("div", { class: "head" }, [el("div", {}, `${fmtFecha(l.fecha)} · ${l.tipo}`), el("div", { class: "amt" }, `$${Number(l.monto || 0).toFixed(2)}`)]),
    el("div", { class: "hint" }, hintParts.filter(Boolean).join(" · ")),
    el("span", { class: `badge ${badgeClass}`, style: "margin-top:6px" }, estadoLinea),
  ]);
  if (l.comentario) {
    wrap.appendChild(el("div", { class: "hint", style: "margin-top:4px" }, `💬 ${l.comentario}`));
  }
  return wrap;
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
  // La fecha ya viene precargada con la fecha de inicio de la orden de
  // viaje — casi siempre coincide con la línea; el viajero la ajusta si no.
  const fecha = el("input", { type: "date", value: (existing?.fecha || cabecera.fechaInicio || new Date().toISOString()).slice(0, 10) });
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
  const kmTotalHint = el("div", { class: "hint" }, "");
  function refreshKmTotal() {
    const total = Number(kmFinal.value || 0) - Number(kmInicio.value || 0);
    kmTotalHint.textContent = kmInicio.value !== "" && kmFinal.value !== "" ? `Total recorrido: ${Math.max(0, total)} km` : "";
  }
  kmInicio.addEventListener("input", refreshKmTotal);
  kmFinal.addEventListener("input", refreshKmTotal);
  const kmWrap = el("div", {}, [
    el("div", { class: "grid-2" }, [
      el("div", {}, [el("label", { class: "field-label" }, "Km inicio"), kmInicio]),
      el("div", {}, [el("label", { class: "field-label" }, "Km final"), kmFinal]),
    ]),
    kmTotalHint,
  ]);
  const montoWrap = el("div", {}, [el("label", { class: "field-label" }, "Monto ($)"), monto]);
  const comentario = el("textarea", { placeholder: "Comentario (opcional)" });
  comentario.value = existing?.comentario || "";

  function refreshTipoFields() {
    const isKm = tipoSelect.value === TIPOS_GASTO[0];
    kmWrap.style.display = isKm ? "block" : "none";
    montoWrap.style.display = isKm ? "none" : "block";
    refreshKmTotal();
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
    montoWrap,
    el("label", { class: "field-label" }, "Comentario"),
    comentario
  );
  root.appendChild(card);
  refreshTipoFields();

  // Foto de factura/recibo — aplica a todo tipo excepto kilometraje.
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

  // Fotos del odómetro — solo para kilometraje, una al inicio y otra al final.
  const kmPhotoCard = el("div", { class: "card" });
  kmPhotoCard.appendChild(el("label", { class: "field-label", style: "margin-top:0" }, "Foto Km inicio (odómetro)"));
  const photoRowKmInicio = el("div", { class: "photo-row" });
  kmPhotoCard.appendChild(photoRowKmInicio);
  kmPhotoCard.appendChild(el("label", { class: "field-label" }, "Foto Km final (odómetro)"));
  const photoRowKmFinal = el("div", { class: "photo-row" });
  kmPhotoCard.appendChild(photoRowKmFinal);
  root.appendChild(kmPhotoCard);
  let photoIdKmInicio = existing?.photoIdKmInicio || null;
  let photoIdKmFinal = existing?.photoIdKmFinal || null;
  function refreshKmPhotos() {
    renderPhotoRow(photoRowKmInicio, photoIdKmInicio ? [photoIdKmInicio] : [], {
      max: 1,
      onAdd: async () => {
        const pid = await capturePhoto();
        if (pid) {
          photoIdKmInicio = pid;
          refreshKmPhotos();
        }
      },
      onRemove: () => {
        photoIdKmInicio = null;
        refreshKmPhotos();
      },
    });
    renderPhotoRow(photoRowKmFinal, photoIdKmFinal ? [photoIdKmFinal] : [], {
      max: 1,
      onAdd: async () => {
        const pid = await capturePhoto();
        if (pid) {
          photoIdKmFinal = pid;
          refreshKmPhotos();
        }
      },
      onRemove: () => {
        photoIdKmFinal = null;
        refreshKmPhotos();
      },
    });
  }
  refreshKmPhotos();

  function refreshPhotoCards() {
    const isKm = tipoSelect.value === TIPOS_GASTO[0];
    photoCard.style.display = isKm ? "none" : "block";
    kmPhotoCard.style.display = isKm ? "block" : "none";
  }
  tipoSelect.addEventListener("change", refreshPhotoCards);
  refreshPhotoCards();

  root.appendChild(
    el(
      "button",
      {
        class: "btn",
        onclick: async () => {
          const isKm = tipoSelect.value === TIPOS_GASTO[0];
          if (!isKm && !documento.value.trim()) return toast("Ingresa el N.º de factura", "error");
          if (!isKm && !photoId) return toast("Adjunta la foto de la factura o recibo", "error");
          if (isKm) {
            if (kmInicio.value === "" || kmFinal.value === "") return toast("Ingresa el Km de inicio y el Km final", "error");
            if (Number(kmFinal.value) < Number(kmInicio.value)) return toast("El Km final no puede ser menor al Km inicial", "error");
            if (!photoIdKmInicio || !photoIdKmFinal) return toast("Adjunta la foto del odómetro al inicio y al final", "error");
          }
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
            comentario: comentario.value.trim(),
            photoId: isKm ? null : photoId,
            photoIdKmInicio: isKm ? photoIdKmInicio : null,
            photoIdKmFinal: isKm ? photoIdKmFinal : null,
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
