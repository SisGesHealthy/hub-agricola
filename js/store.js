// Capa única de acceso a datos usada por toda la interfaz. Internamente decide
// entre el almacenamiento local (modo demo, CONFIG.useMock = true) y Microsoft
// Graph / SharePoint (modo producción). El resto de la app nunca llama a
// db.js ni a graph.js directamente.

import { CONFIG } from "./config.js";
import { idb, newId, savePhotoBlob, getPhotoUrl, getPhotoBlob, enqueueOutbox } from "./db.js";
import * as graph from "./graph.js";

// Las columnas de SharePoint solo aceptan valores planos (texto, número, fecha).
// La UI a veces arma arreglos (fotos múltiples, proveedores marcados) u objetos
// anidados (coordenadas GPS con lat/lng/accuracy) para su propio uso interno;
// esto los aplana justo antes de escribir en Graph, sin tocar el resto del código.
function toGraphFields(fields) {
  const out = {};
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      out[key] = value.join(",");
    } else if (value !== null && typeof value === "object" && !(value instanceof Date)) {
      out[key] = JSON.stringify(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

// Contraparte de toGraphFields: SharePoint solo guarda texto plano, así que
// hay que reconstruir los arreglos y objetos que espera la UI (coordenadas
// GPS, listas de fotos, proveedores marcados) al leer los registros de vuelta.
// No aplica en modo demo — IndexedDB ya guarda los valores con su forma real.
const GRAPH_FIELD_SHAPES = {
  rutaVisitas: { coordsPlan: "json", coordsReales: "json" },
  seguimientoSemanal: { coords: "json", photoIds: "array" },
  gastosCabecera: { proveedoresVisitados: "array" },
};

function fromGraphFields(listKey, rec) {
  const shape = GRAPH_FIELD_SHAPES[listKey];
  if (!rec || !shape) return rec;
  const out = { ...rec };
  for (const [key, kind] of Object.entries(shape)) {
    const value = out[key];
    if (typeof value !== "string") continue; // ya viene con su forma real, o es null/undefined
    if (kind === "array") {
      out[key] = value ? value.split(",") : [];
    } else if (kind === "json") {
      try {
        out[key] = value ? JSON.parse(value) : null;
      } catch {
        out[key] = null;
      }
    }
  }
  return out;
}

// Sube a la biblioteca "Evidencias" cualquier foto que todavía sea una
// referencia local (blob guardado en IndexedDB por capturePhoto/SignaturePad)
// y no una URL real de SharePoint, justo antes de escribir el registro en
// Graph. En modo demo no hace nada — las fotos se quedan solo en el celular.
// El objeto que ve el resto de la app conserva la referencia local (para
// poder mostrar la miniatura al instante, incluso sin conexión); solo la
// copia que se manda a Graph lleva la URL real.
async function resolvePhotoField(value) {
  if (CONFIG.useMock || !value || typeof value !== "string" || value.startsWith("http")) return value;
  const blob = await getPhotoBlob(value);
  if (!blob) return value; // no se encontró el blob local; se deja como está
  return graph.graphUploadPhoto(blob, `${value}.jpg`);
}

async function resolvePhotoFields(rec, keys) {
  const out = { ...rec };
  for (const key of keys) {
    if (Array.isArray(out[key])) {
      out[key] = await Promise.all(out[key].map((v) => resolvePhotoField(v)));
    } else if (out[key]) {
      out[key] = await resolvePhotoField(out[key]);
    }
  }
  return out;
}

let catalogoCache = null;

async function loadCatalogoRequisitos() {
  if (catalogoCache) return catalogoCache;
  if (!CONFIG.useMock) {
    const remote = await graph.graphGetItems("catalogoRequisitos").catch(() => []);
    if (remote.length) {
      // catNum era la primera columna del Excel de importación, así que quedó
      // fusionada con Título — graph.js la expone como "id" (texto); aquí se
      // reconstruye como número real para que el cálculo de ponderación funcione.
      catalogoCache = remote.map((r) => ({ ...r, catNum: Number(r.id) }));
      return catalogoCache;
    }
  }
  const res = await fetch("data/catalogo_requisitos.json");
  catalogoCache = await res.json();
  return catalogoCache;
}

// ---------------------------------------------------------------------------
// Semilla de datos de demostración (solo modo mock, solo si la base está vacía)
// ---------------------------------------------------------------------------
async function seedMockDataIfEmpty() {
  const existing = await idb.getAll("proveedores");
  if (existing.length > 0) return;

  const demoProveedores = [
    { fruta: "Mora", nombre: "Carmen Lisintuña", ubicacion: "Categosín", estado: "Activo" },
    { fruta: "Mora", nombre: "Cesar Lisintuña", ubicacion: "Categosín", estado: "Activo" },
    { fruta: "Frutilla", nombre: "Laura Enríquez", ubicacion: "El Quinche", estado: "Activo" },
    { fruta: "Naranjilla", nombre: "Edwin Gallardo", ubicacion: "Puerto Quito", estado: "Activo" },
    { fruta: "Maracuyá", nombre: "Indecaucho", ubicacion: "Los Ángeles", estado: "Nuevo" },
  ];
  for (const p of demoProveedores) {
    const id = newId("prov");
    await idb.put("proveedores", { id, ...p, lat: null, lng: null, ultimaPonderacion: null, createdAt: Date.now() });
  }
}

export async function initStore() {
  if (CONFIG.useMock) await seedMockDataIfEmpty();
  await loadCatalogoRequisitos();
}

// ---------------------------------------------------------------------------
// Proveedores
// ---------------------------------------------------------------------------
export async function listProveedores() {
  if (CONFIG.useMock) {
    const all = await idb.getAll("proveedores");
    return all.sort((a, b) => a.nombre.localeCompare(b.nombre));
  }
  return graph.graphGetItems("proveedores");
}

export async function getProveedor(id) {
  if (CONFIG.useMock) return idb.get("proveedores", id);
  const all = await graph.graphGetItems("proveedores", { filter: `fields/Title eq '${id}'` });
  return all[0] || null;
}

export async function saveProveedor(fields) {
  if (CONFIG.useMock) {
    const id = fields.id || newId("prov");
    const rec = { ...fields, id, createdAt: fields.createdAt || Date.now() };
    await idb.put("proveedores", rec);
    return rec;
  }
  if (fields.id) return graph.graphUpdateItemByAppId("proveedores", fields.id, toGraphFields(fields));
  return graph.graphCreateItem("proveedores", toGraphFields({ ...fields, id: newId("prov") }));
}

// Borra un proveedor (p.ej. un duplicado de prueba). Los checklists,
// seguimientos, rutas y gastos que ya lo referenciaban no se tocan — cada
// pantalla ya muestra "Proveedor eliminado" cuando no lo encuentra, así que
// no queda ningún dato roto.
export async function deleteProveedor(id) {
  if (CONFIG.useMock) {
    await idb.delete("proveedores", id);
    return;
  }
  const [rec] = await graph.graphGetItems("proveedores", { filter: `fields/Title eq '${id}'` });
  if (rec?._itemId) await graph.graphDeleteItemById("proveedores", rec._itemId);
}

// ---------------------------------------------------------------------------
// Check List (cabecera + 96 ítems)
// ---------------------------------------------------------------------------
export async function createChecklist({ proveedorId, auditor }) {
  const catalogo = await loadCatalogoRequisitos();
  const checklistId = newId("chk");
  const cabecera = {
    id: checklistId,
    proveedorId,
    auditor,
    fecha: new Date().toISOString().slice(0, 10),
    estado: "Borrador",
    ponderacionTotal: null,
    accionGlobal: null,
    firmaProductorPhotoId: null,
    firmaAuditorPhotoId: null,
    createdAt: Date.now(),
  };

  const items = catalogo.map((req) => ({
    id: newId("chkitem"),
    checklistId,
    catNum: req.catNum,
    catName: req.catName,
    reqNum: req.reqNum,
    text: req.text,
    cumple: null, // "Si" | "No" | "NA"
    observaciones: "",
    photoId: null,
  }));

  if (CONFIG.useMock) {
    await idb.put("checklistCab", cabecera);
    for (const it of items) await idb.put("checklistItems", it);
  } else {
    await graph.graphCreateItem("checklistCabecera", toGraphFields(cabecera));
    await graph.graphBatchCreateItems("checklistItems", items.map((it) => toGraphFields(it)));
  }
  return { cabecera, items };
}

export async function listChecklists() {
  const cabeceras = CONFIG.useMock
    ? await idb.getAll("checklistCab")
    : await graph.graphGetItems("checklistCabecera");
  const proveedores = await listProveedores();
  const byId = Object.fromEntries(proveedores.map((p) => [p.id, p]));
  return cabeceras
    .map((c) => ({ ...c, proveedor: byId[c.proveedorId] || null }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function getChecklist(checklistId) {
  const cabecera = CONFIG.useMock
    ? await idb.get("checklistCab", checklistId)
    : (await graph.graphGetItems("checklistCabecera", { filter: `fields/Title eq '${checklistId}'` }))[0];
  const items = CONFIG.useMock
    ? await idb.getAllByIndex("checklistItems", "byChecklist", checklistId)
    : await graph.graphGetItems("checklistItems", { filter: `fields/${graph.spFieldName("checklistItems", "checklistId")} eq '${checklistId}'` });
  items.sort((a, b) => (a.catNum - b.catNum) || String(a.reqNum).localeCompare(String(b.reqNum), undefined, { numeric: true }));
  const proveedor = cabecera ? await getProveedor(cabecera.proveedorId) : null;
  return { cabecera, items, proveedor };
}

// Solo se permite borrar inspecciones en Borrador (nunca las ya enviadas/OK) —
// eso se valida en la UI antes de llamar a esto. Borra la cabecera y sus
// ~96 ítems asociados.
export async function deleteChecklist(checklistId) {
  const { cabecera, items } = await getChecklist(checklistId);
  if (CONFIG.useMock) {
    if (cabecera) await idb.delete("checklistCab", checklistId);
    for (const it of items) await idb.delete("checklistItems", it.id);
  } else {
    for (const it of items) {
      if (it._itemId) await graph.graphDeleteItemById("checklistItems", it._itemId);
    }
    if (cabecera?._itemId) await graph.graphDeleteItemById("checklistCabecera", cabecera._itemId);
  }
}

export async function updateChecklistItem(item) {
  if (CONFIG.useMock) {
    await idb.put("checklistItems", item);
  } else {
    const graphItem = await resolvePhotoFields(item, ["photoId"]);
    if (item._itemId) await graph.graphUpdateItemById("checklistItems", item._itemId, toGraphFields(graphItem));
    else await graph.graphUpdateItemByAppId("checklistItems", item.id, toGraphFields(graphItem));
  }
  return item;
}

export async function updateChecklistCabecera(cabecera) {
  if (CONFIG.useMock) {
    await idb.put("checklistCab", cabecera);
  } else {
    const graphCabecera = await resolvePhotoFields(cabecera, ["firmaProductorPhotoId", "firmaAuditorPhotoId"]);
    if (cabecera._itemId) await graph.graphUpdateItemById("checklistCabecera", cabecera._itemId, toGraphFields(graphCabecera));
    else await graph.graphUpdateItemByAppId("checklistCabecera", cabecera.id, toGraphFields(graphCabecera));
  }
  return cabecera;
}

// Cálculo de ponderación: por categoría = cumplidos / (total - N/A);
// total = cumplidos totales / (ítems totales - N/A totales). Reemplaza el
// cálculo manual de la hoja RESUMEN del Excel original.
export function computeScoring(items, umbral = CONFIG.ponderacionUmbral) {
  const byCat = {};
  for (const it of items) {
    const key = it.catNum;
    byCat[key] = byCat[key] || { catNum: it.catNum, catName: it.catName, total: 0, cumplidos: 0, na: 0 };
    byCat[key].total += 1;
    if (it.cumple === "Si") byCat[key].cumplidos += 1;
    if (it.cumple === "NA") byCat[key].na += 1;
  }
  const categorias = Object.values(byCat)
    .sort((a, b) => a.catNum - b.catNum)
    .map((c) => {
      const base = c.total - c.na;
      const ponderacion = base > 0 ? c.cumplidos / base : 1;
      return { ...c, ponderacion, accion: ponderacion >= umbral ? "OK" : "Plan de Acción" };
    });

  const totalCumplidos = categorias.reduce((s, c) => s + c.cumplidos, 0);
  const totalBase = categorias.reduce((s, c) => s + (c.total - c.na), 0);
  const ponderacionTotal = totalBase > 0 ? totalCumplidos / totalBase : 1;
  const respondidos = items.filter((it) => it.cumple !== null).length;

  return {
    categorias,
    ponderacionTotal,
    accionGlobal: ponderacionTotal >= umbral ? "OK" : "Plan de Acción",
    respondidos,
    totalItems: items.length,
  };
}

export async function submitChecklist(checklistId, { firmaProductorBlob, firmaAuditorBlob }) {
  const { cabecera, items } = await getChecklist(checklistId);
  const scoring = computeScoring(items);

  const firmaProductorPhotoId = firmaProductorBlob ? await savePhotoBlob(firmaProductorBlob) : null;
  const firmaAuditorPhotoId = firmaAuditorBlob ? await savePhotoBlob(firmaAuditorBlob) : null;

  const updated = {
    ...cabecera,
    estado: scoring.accionGlobal === "OK" ? "Aprobado" : "Con Plan de Acción",
    ponderacionTotal: scoring.ponderacionTotal,
    accionGlobal: scoring.accionGlobal,
    firmaProductorPhotoId,
    firmaAuditorPhotoId,
    submittedAt: Date.now(),
  };
  await updateChecklistCabecera(updated);

  // Actualiza la ponderación más reciente en la ficha del proveedor (flujo 6.6 del diseño).
  const prov = await getProveedor(cabecera.proveedorId);
  if (prov) await saveProveedor({ ...prov, ultimaPonderacion: scoring.ponderacionTotal });

  if (!CONFIG.useMock) {
    await enqueueOutbox({ kind: "checklist-submit", refId: checklistId });
  }
  return { cabecera: updated, items, scoring };
}

// ---------------------------------------------------------------------------
// Seguimiento Semanal
// ---------------------------------------------------------------------------
function isoWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const diff = target - firstThursday;
  return 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
}

export async function listSeguimientos() {
  const all = CONFIG.useMock
    ? await idb.getAll("seguimientos")
    : (await graph.graphGetItems("seguimientoSemanal")).map((r) => fromGraphFields("seguimientoSemanal", r));
  const proveedores = await listProveedores();
  const byId = Object.fromEntries(proveedores.map((p) => [p.id, p]));
  return all
    .map((s) => ({ ...s, proveedor: byId[s.proveedorId] || null }))
    .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || ""));
}

export async function saveSeguimiento(fields) {
  const id = fields.id || newId("seg");
  const rec = {
    ...fields,
    id,
    semana: fields.fecha ? isoWeek(fields.fecha) : null,
    createdAt: fields.createdAt || Date.now(),
  };
  if (CONFIG.useMock) {
    await idb.put("seguimientos", rec);
  } else {
    const graphRec = await resolvePhotoFields(rec, ["photoIds"]);
    if (rec._itemId) await graph.graphUpdateItemById("seguimientoSemanal", rec._itemId, toGraphFields(graphRec));
    else if (fields.id) await graph.graphUpdateItemByAppId("seguimientoSemanal", fields.id, toGraphFields(graphRec));
    else await graph.graphCreateItem("seguimientoSemanal", toGraphFields(graphRec));
  }
  return rec;
}

// ---------------------------------------------------------------------------
// Ruta de Visitas
// ---------------------------------------------------------------------------
export async function listRutas() {
  const all = CONFIG.useMock
    ? await idb.getAll("rutas")
    : (await graph.graphGetItems("rutaVisitas")).map((r) => fromGraphFields("rutaVisitas", r));
  const proveedores = await listProveedores();
  const byId = Object.fromEntries(proveedores.map((p) => [p.id, p]));
  return all
    .map((r) => ({ ...r, proveedor: byId[r.proveedorId] || null }))
    .sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
}

export async function saveRuta(fields) {
  const id = fields.id || newId("ruta");
  const rec = {
    estado: "Planificada",
    ...fields,
    id,
    semana: fields.fecha ? isoWeek(fields.fecha) : null,
    createdAt: fields.createdAt || Date.now(),
  };
  if (CONFIG.useMock) {
    await idb.put("rutas", rec);
  } else {
    const graphRec = await resolvePhotoFields(rec, ["photoId"]);
    if (rec._itemId) await graph.graphUpdateItemById("rutaVisitas", rec._itemId, toGraphFields(graphRec));
    else if (fields.id) await graph.graphUpdateItemByAppId("rutaVisitas", fields.id, toGraphFields(graphRec));
    else await graph.graphCreateItem("rutaVisitas", toGraphFields(graphRec));
  }
  return rec;
}

// ---------------------------------------------------------------------------
// Gastos de Viaje
// ---------------------------------------------------------------------------
export async function listGastos() {
  const all = CONFIG.useMock
    ? await idb.getAll("gastosCab")
    : (await graph.graphGetItems("gastosCabecera")).map((r) => fromGraphFields("gastosCabecera", r));
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getGasto(gastoId) {
  const cabecera = CONFIG.useMock
    ? await idb.get("gastosCab", gastoId)
    : fromGraphFields("gastosCabecera", (await graph.graphGetItems("gastosCabecera", { filter: `fields/Title eq '${gastoId}'` }))[0]);
  const lineas = CONFIG.useMock
    ? await idb.getAllByIndex("gastosDet", "byGasto", gastoId)
    : await graph.graphGetItems("gastosDetalle", { filter: `fields/${graph.spFieldName("gastosDetalle", "gastoId")} eq '${gastoId}'` });
  return { cabecera, lineas: lineas.sort((a, b) => (a.fecha || "").localeCompare(b.fecha || "")) };
}

export async function createGasto(fields) {
  const id = newId("gas");
  const rec = {
    id,
    estado: "Borrador",
    anticipo: 0,
    saldoAnterior: 0,
    ...fields,
    createdAt: Date.now(),
  };
  if (CONFIG.useMock) await idb.put("gastosCab", rec);
  else await graph.graphCreateItem("gastosCabecera", toGraphFields(rec));
  return rec;
}

export async function updateGasto(rec) {
  if (CONFIG.useMock) await idb.put("gastosCab", rec);
  else if (rec._itemId) await graph.graphUpdateItemById("gastosCabecera", rec._itemId, toGraphFields(rec));
  else await graph.graphUpdateItemByAppId("gastosCabecera", rec.id, toGraphFields(rec));
  return rec;
}

export async function addGastoLinea(gastoId, fields) {
  const id = fields.id || newId("gasl");
  let monto = Number(fields.monto || 0);
  if (fields.tipo === "Movilización propia (Km)") {
    const kmTotal = Number(fields.kmFinal || 0) - Number(fields.kmInicio || 0);
    monto = Math.max(0, kmTotal) * CONFIG.kmRate;
  }
  const rec = {
    ...fields,
    id,
    gastoId,
    monto,
    // Columna Number en SharePoint: "" (línea sin kilometraje) la rechaza
    // con 400 badArgument; hay que mandar null, no texto vacío.
    kmInicio: fields.kmInicio === "" || fields.kmInicio == null ? null : Number(fields.kmInicio),
    kmFinal: fields.kmFinal === "" || fields.kmFinal == null ? null : Number(fields.kmFinal),
  };
  if (CONFIG.useMock) {
    await idb.put("gastosDet", rec);
  } else {
    const graphRec = await resolvePhotoFields(rec, ["photoId"]);
    if (rec._itemId) await graph.graphUpdateItemById("gastosDetalle", rec._itemId, toGraphFields(graphRec));
    else if (fields.id) await graph.graphUpdateItemByAppId("gastosDetalle", fields.id, toGraphFields(graphRec));
    else await graph.graphCreateItem("gastosDetalle", toGraphFields(graphRec));
  }
  return rec;
}

export function computeGastoTotales({ cabecera, lineas }) {
  const total = lineas.reduce((s, l) => s + Number(l.monto || 0), 0);
  const valorADevolver = Number(cabecera.anticipo || 0) + Number(cabecera.saldoAnterior || 0) - total;
  return { total, valorADevolver };
}

// Decide quién debe aprobar el viaje según lo que contiene: si TODAS las
// líneas son "Movilización propia (Km)" lo aprueba Talento Humano; si hay
// cualquier otro tipo de gasto (hospedaje, alimentación, etc.) lo aprueba
// Compras. Se recalcula cada vez que se envía a aprobación, por si las
// líneas cambiaron desde el último envío.
export function computeAprobador(lineas) {
  const soloKm = lineas.length > 0 && lineas.every((l) => l.tipo === "Movilización propia (Km)");
  return soloKm ? CONFIG.approvers.kilometraje : CONFIG.approvers.general;
}

// ---------------------------------------------------------------------------
// Fotos y GPS (compartido por los 4 módulos)
// ---------------------------------------------------------------------------
export { savePhotoBlob, getPhotoUrl };
