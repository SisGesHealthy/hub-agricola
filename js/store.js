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
  gastosCabecera: { proveedoresVisitados: "array", rutasIds: "array" },
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
  if (fields._itemId) return graph.graphUpdateItemById("proveedores", fields._itemId, toGraphFields(fields));
  if (fields.id) return graph.graphUpdateItemByAppId("proveedores", fields.id, toGraphFields(fields));
  return graph.graphCreateItem("proveedores", toGraphFields({ ...fields, id: newId("prov") }));
}

function normalizeNombre(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Busca un proveedor con el mismo nombre (sin importar mayúsculas/espacios)
// para advertir antes de crear un duplicado — origen real de varios "Carmen
// Lisintuña"/"Campovivo mora" repetidos en el catálogo. excludeId se usa al
// editar, para no compararse contra sí mismo.
export async function findProveedorDuplicado(nombre, excludeId = null) {
  const target = normalizeNombre(nombre);
  if (!target) return null;
  const all = await listProveedores();
  return all.find((p) => p.id !== excludeId && normalizeNombre(p.nombre) === target) || null;
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
    return;
  }
  // ~96 ítems por checklist: borrarlos uno por uno (secuencial) tardaba
  // decenas de segundos sin ninguna señal visual, y al primer 404 (ítem ya
  // borrado en un intento anterior) parecía "colgado". Se borran en tandas
  // en paralelo, igual que graphBatchCreateItems al crearlos.
  const CHUNK = 20;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    await Promise.all(chunk.filter((it) => it._itemId).map((it) => graph.graphDeleteItemById("checklistItems", it._itemId)));
  }
  if (cabecera?._itemId) await graph.graphDeleteItemById("checklistCabecera", cabecera._itemId);
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
function isoWeekInfo(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const target = new Date(d.valueOf());
  const dayNr = (d.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const isoYear = target.getFullYear();
  const firstThursday = new Date(isoYear, 0, 4);
  const diff = target - firstThursday;
  const week = 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
  return { week, year: isoYear };
}

export function isoWeek(dateStr) {
  return isoWeekInfo(dateStr).week;
}

export function isoWeekYear(dateStr) {
  return isoWeekInfo(dateStr).year;
}

// Rango de fechas (lunes a domingo) de una semana ISO — para mostrar
// encabezados legibles al agrupar Gastos de Viaje por semana.
export function isoWeekRange(year, week) {
  const simple = new Date(year, 0, 1 + (week - 1) * 7);
  const dow = simple.getDay() || 7;
  const monday = new Date(simple);
  monday.setDate(simple.getDate() - dow + 1);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { inicio: fmt(monday), fin: fmt(sunday) };
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
    monto = Math.max(0, kmTotal) * (await getKmRate());
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
    const graphRec = await resolvePhotoFields(rec, ["photoId", "photoIdKmInicio", "photoIdKmFinal"]);
    if (rec._itemId) await graph.graphUpdateItemById("gastosDetalle", rec._itemId, toGraphFields(graphRec));
    else if (fields.id) await graph.graphUpdateItemByAppId("gastosDetalle", fields.id, toGraphFields(graphRec));
    else await graph.graphCreateItem("gastosDetalle", toGraphFields(graphRec));
  }
  return rec;
}

// Solo se permite borrar una línea mientras el viaje sigue en Borrador (se
// valida en la UI). Usa el registro tal como lo devuelve getGasto (trae _itemId).
export async function deleteGastoLinea(linea) {
  if (CONFIG.useMock) {
    await idb.delete("gastosDet", linea.id);
    return;
  }
  if (linea._itemId) await graph.graphDeleteItemById("gastosDetalle", linea._itemId);
}

// Borra un viaje completo (cabecera + todas sus líneas) sin importar su
// estado — a diferencia de deleteGastoLinea, que solo aplica a líneas
// sueltas de un viaje en Borrador. Pensado solo para la cuenta administradora
// (ver auth.isAdmin(), gateado en la UI en gastos.js), para poder limpiar
// duplicados o pruebas aunque el viaje ya esté Enviado/Aprobado/Rechazado.
export async function deleteGasto(gastoId) {
  const { cabecera, lineas } = await getGasto(gastoId);
  if (CONFIG.useMock) {
    if (cabecera) await idb.delete("gastosCab", gastoId);
    for (const l of lineas) await idb.delete("gastosDet", l.id);
    return;
  }
  const CHUNK = 20;
  for (let i = 0; i < lineas.length; i += CHUNK) {
    const chunk = lineas.slice(i, i + CHUNK);
    await Promise.all(chunk.filter((l) => l._itemId).map((l) => graph.graphDeleteItemById("gastosDetalle", l._itemId)));
  }
  if (cabecera?._itemId) await graph.graphDeleteItemById("gastosCabecera", cabecera._itemId);
}

export function computeGastoTotales({ lineas }) {
  const total = lineas.reduce((s, l) => s + Number(l.monto || 0), 0);
  const totalKm = lineas
    .filter((l) => l.tipo === "Movilización propia (Km)")
    .reduce((s, l) => s + Math.max(0, Number(l.kmFinal || 0) - Number(l.kmInicio || 0)), 0);
  return { total, totalKm };
}

// El viático es fijo por semana (no por viaje individual) — cada técnico
// recibe un anticipo semanal y se liquida contra el total de todos sus
// viajes de esa semana (ver store.listGastosConTotales y CONFIG.viaticoSemanal).
export function computeSemanaTotales(totalGastosSemana) {
  const anticipo = CONFIG.viaticoSemanal;
  return { anticipo, total: totalGastosSemana, valorADevolver: anticipo - totalGastosSemana };
}

// Trae todos los viajes junto con el total ya gastado en cada uno (suma de
// sus líneas), en una sola pasada — para poder agruparlos por semana sin
// tener que pedir el detalle viaje por viaje.
export async function listGastosConTotales() {
  const [cabeceras, todasLineas] = await Promise.all([
    listGastos(),
    CONFIG.useMock ? idb.getAll("gastosDet") : graph.graphGetItems("gastosDetalle"),
  ]);
  const totalPorGasto = {};
  todasLineas.forEach((l) => {
    totalPorGasto[l.gastoId] = (totalPorGasto[l.gastoId] || 0) + Number(l.monto || 0);
  });
  return cabeceras.map((c) => ({ ...c, totalLineas: totalPorGasto[c.id] || 0 }));
}

// En la práctica, Compras y Talento Humano verifican el viaje contra el PDF
// impreso y las facturas físicas — no tiene sentido pedirles que aprueben
// línea por línea en la app. Cada viaje necesita hasta 2 aprobaciones (una
// por cada tipo de gasto que contenga), no una por cada línea.
export function computeAprobacionesRequeridas(lineas) {
  return {
    compras: lineas.some((l) => l.tipo !== "Movilización propia (Km)"),
    th: lineas.some((l) => l.tipo === "Movilización propia (Km)"),
  };
}

// Aprueba o rechaza la parte de Compras ("compras") o de Talento Humano
// ("th") de un viaje. Rechazar cualquiera de las dos manda todo el viaje de
// vuelta a Borrador para que el viajero corrija y reenvíe (ver submitGasto,
// que resetea ambas aprobaciones a Pendiente). El viaje queda Aprobado en
// cuanto están aprobadas todas las que le aplican según sus líneas.
export async function reviewGastoAprobacion(cabecera, lineas, aprobador, decision, { comentario = "", revisor = "" } = {}) {
  const prefix = aprobador === "compras" ? "aprobCompras" : "aprobTh";
  const merged = { ...cabecera, [`${prefix}Estado`]: decision, [`${prefix}Revisor`]: revisor };

  let estado = cabecera.estado;
  let comentarioRechazo = cabecera.comentarioRechazo || "";
  if (decision === "Rechazado") {
    estado = "Rechazado";
    comentarioRechazo = comentario;
  } else {
    const req = computeAprobacionesRequeridas(lineas);
    const comprasOk = !req.compras || merged.aprobComprasEstado === "Aprobado";
    const thOk = !req.th || merged.aprobThEstado === "Aprobado";
    if (comprasOk && thOk) estado = "Aprobado";
  }
  return updateGasto({ ...merged, estado, comentarioRechazo });
}

// Envía (o reenvía tras una corrección) el viaje completo a aprobación:
// resetea las dos aprobaciones (Compras y Talento Humano) a Pendiente,
// incluida la que ya estuviera aprobada antes, para que el viaje vuelva a
// pasar por revisión completa (se eligió mantenerlo simple en vez de
// aprobación parcial).
export async function submitGasto(cabecera) {
  return updateGasto({
    ...cabecera,
    estado: "Enviado",
    firmaFecha: new Date().toISOString(),
    comentarioRechazo: "",
    aprobComprasEstado: "Pendiente",
    aprobComprasRevisor: "",
    aprobThEstado: "Pendiente",
    aprobThRevisor: "",
  });
}

// ---------------------------------------------------------------------------
// Configuración editable desde la app (por ahora, solo la tarifa por Km)
// ---------------------------------------------------------------------------
let kmRateCache = null;

export async function getKmRate() {
  if (kmRateCache != null) return kmRateCache;
  if (CONFIG.useMock) {
    const rec = await idb.get("meta", "kmRate");
    kmRateCache = rec?.value ?? CONFIG.kmRate;
    return kmRateCache;
  }
  if (!CONFIG.graph.lists.configuracion) {
    kmRateCache = CONFIG.kmRate;
    return kmRateCache;
  }
  const [rec] = await graph.graphGetItems("configuracion", { filter: `fields/Title eq 'tarifaKm'` }).catch(() => []);
  kmRateCache = rec?.valor != null ? Number(rec.valor) : CONFIG.kmRate;
  return kmRateCache;
}

export async function setKmRate(value) {
  const rate = Number(value);
  if (CONFIG.useMock) {
    await idb.put("meta", { id: "kmRate", value: rate });
    kmRateCache = rate;
    return rate;
  }
  if (!CONFIG.graph.lists.configuracion) {
    throw new Error('Falta configurar graph.lists.configuracion en config.js (ver New-HubAgricolaLists.ps1).');
  }
  const [rec] = await graph.graphGetItems("configuracion", { filter: `fields/Title eq 'tarifaKm'` });
  if (rec?._itemId) await graph.graphUpdateItemById("configuracion", rec._itemId, { valor: rate });
  else await graph.graphCreateItem("configuracion", { id: "tarifaKm", valor: rate });
  kmRateCache = rate;
  return rate;
}

// ---------------------------------------------------------------------------
// Fotos y GPS (compartido por los 4 módulos)
// ---------------------------------------------------------------------------
export { savePhotoBlob, getPhotoUrl };

// Descarga el contenido real de una foto para incrustarla en un PDF (ver
// pdf.js). Si photoId es una referencia local (blob recién capturado,
// todavía no subido) se lee de IndexedDB; si ya es la URL real de
// SharePoint, se descarga vía Graph — un fetch directo a esa URL falla por
// CORS/autenticación desde este origen.
export async function getPhotoBlobForExport(photoId) {
  if (!photoId) return null;
  if (typeof photoId === "string" && photoId.startsWith("http")) {
    return graph.graphDownloadPhoto(photoId).catch(() => null);
  }
  return getPhotoBlob(photoId);
}
