// Capa única de acceso a datos usada por toda la interfaz. Internamente decide
// entre el almacenamiento local (modo demo, CONFIG.useMock = true) y Microsoft
// Graph / SharePoint (modo producción). El resto de la app nunca llama a
// db.js ni a graph.js directamente.

import { CONFIG } from "./config.js";
import { idb, newId, savePhotoBlob, getPhotoUrl, enqueueOutbox } from "./db.js";
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
    : await graph.graphGetItems("checklistItems", { filter: `fields/checklistId eq '${checklistId}'` });
  items.sort((a, b) => (a.catNum - b.catNum) || String(a.reqNum).localeCompare(String(b.reqNum), undefined, { numeric: true }));
  const proveedor = cabecera ? await getProveedor(cabecera.proveedorId) : null;
  return { cabecera, items, proveedor };
}

export async function updateChecklistItem(item) {
  if (CONFIG.useMock) {
    await idb.put("checklistItems", item);
  } else if (item._itemId) {
    await graph.graphUpdateItemById("checklistItems", item._itemId, toGraphFields(item));
  } else {
    await graph.graphUpdateItemByAppId("checklistItems", item.id, toGraphFields(item));
  }
  return item;
}

export async function updateChecklistCabecera(cabecera) {
  if (CONFIG.useMock) {
    await idb.put("checklistCab", cabecera);
  } else if (cabecera._itemId) {
    await graph.graphUpdateItemById("checklistCabecera", cabecera._itemId, toGraphFields(cabecera));
  } else {
    await graph.graphUpdateItemByAppId("checklistCabecera", cabecera.id, toGraphFields(cabecera));
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
  const all = CONFIG.useMock ? await idb.getAll("seguimientos") : await graph.graphGetItems("seguimientoSemanal");
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
    if (fields.id) await graph.graphUpdateItemByAppId("seguimientoSemanal", fields.id, toGraphFields(rec));
    else await graph.graphCreateItem("seguimientoSemanal", toGraphFields(rec));
  }
  return rec;
}

// ---------------------------------------------------------------------------
// Ruta de Visitas
// ---------------------------------------------------------------------------
export async function listRutas() {
  const all = CONFIG.useMock ? await idb.getAll("rutas") : await graph.graphGetItems("rutaVisitas");
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
    if (fields.id) await graph.graphUpdateItemByAppId("rutaVisitas", fields.id, toGraphFields(rec));
    else await graph.graphCreateItem("rutaVisitas", toGraphFields(rec));
  }
  return rec;
}

// ---------------------------------------------------------------------------
// Gastos de Viaje
// ---------------------------------------------------------------------------
export async function listGastos() {
  const all = CONFIG.useMock ? await idb.getAll("gastosCab") : await graph.graphGetItems("gastosCabecera");
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getGasto(gastoId) {
  const cabecera = CONFIG.useMock
    ? await idb.get("gastosCab", gastoId)
    : (await graph.graphGetItems("gastosCabecera", { filter: `fields/Title eq '${gastoId}'` }))[0];
  const lineas = CONFIG.useMock
    ? await idb.getAllByIndex("gastosDet", "byGasto", gastoId)
    : await graph.graphGetItems("gastosDetalle", { filter: `fields/gastoId eq '${gastoId}'` });
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
  const rec = { ...fields, id, gastoId, monto };
  if (CONFIG.useMock) await idb.put("gastosDet", rec);
  else {
    if (fields.id) await graph.graphUpdateItemByAppId("gastosDetalle", fields.id, toGraphFields(rec));
    else await graph.graphCreateItem("gastosDetalle", toGraphFields(rec));
  }
  return rec;
}

export function computeGastoTotales({ cabecera, lineas }) {
  const total = lineas.reduce((s, l) => s + Number(l.monto || 0), 0);
  const valorADevolver = Number(cabecera.anticipo || 0) + Number(cabecera.saldoAnterior || 0) - total;
  return { total, valorADevolver };
}

// ---------------------------------------------------------------------------
// Fotos y GPS (compartido por los 4 módulos)
// ---------------------------------------------------------------------------
export { savePhotoBlob, getPhotoUrl };
