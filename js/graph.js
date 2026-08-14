// Llamadas reales a Microsoft Graph API contra las listas de SharePoint.
// Solo se usan cuando CONFIG.useMock === false (ver js/auth.js para el token).
// No se ejecutan en modo demo; están escritas y listas para cuando el sitio,
// las listas y el registro de aplicación en Microsoft Entra ID existan.

import { CONFIG } from "./config.js";
import { getAccessToken } from "./auth.js";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function graphFetch(path, options = {}) {
  const token = await getAccessToken();
  const res = await fetch(`${GRAPH_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph ${options.method || "GET"} ${path} -> ${res.status}: ${body}`);
  }
  if (res.status === 204) return null;
  return res.json();
}

function listPath(listKey) {
  const listId = CONFIG.graph.lists[listKey];
  return `/sites/${CONFIG.graph.siteId}/lists/${listId}`;
}

// Al crear las 8 listas importando los Excel, SharePoint NO usó el texto de
// cada encabezado como nombre interno de columna (salvo "activo", por algún
// motivo) — les asignó nombres genéricos field_1, field_2... en el mismo
// orden en que aparecían las columnas en el Excel (ver build_excel_imports.py).
// La primera columna de cada Excel ("id") sí se fusionó con la columna nativa
// "Title". Este mapa traduce el nombre de campo que usa el resto de la app
// (p.ej. "estado") al nombre interno real en SharePoint (p.ej. "field_11"),
// en ambas direcciones, para cada lista.
const FIELD_MAPS = {
  proveedores: {
    nombre: "field_1", fruta: "field_2", provincia: "field_3", ubicacion: "field_4",
    lat: "field_5", lng: "field_6", estado: "field_7", ultimaPonderacion: "field_8", createdAt: "field_9",
  },
  catalogoRequisitos: {
    catName: "field_1", reqNum: "field_2", text: "field_3", activo: "activo",
  },
  checklistCabecera: {
    proveedorId: "field_1", auditor: "field_2", fecha: "field_3", estado: "field_4",
    ponderacionTotal: "field_5", accionGlobal: "field_6", firmaProductorPhotoId: "field_7",
    firmaAuditorPhotoId: "field_8", createdAt: "field_9", submittedAt: "field_10",
  },
  checklistItems: {
    checklistId: "field_1", catNum: "field_2", catName: "field_3", reqNum: "field_4",
    text: "field_5", cumple: "field_6", observaciones: "field_7", photoId: "field_8",
  },
  seguimientoSemanal: {
    proveedorId: "field_1", tipo: "field_2", fecha: "field_3", novedades: "field_4",
    recomendaciones: "field_5", fechaMaxCumplimiento: "field_6", coords: "field_7",
    photoIds: "field_8", estado: "field_9", semana: "field_10", createdAt: "field_11",
  },
  rutaVisitas: {
    semana: "field_1", fecha: "field_2", proveedorId: "field_3", proveedorNuevoTexto: "field_4",
    provincia: "field_5", lugar: "field_6", coordsPlan: "field_7", coordsReales: "field_8",
    photoId: "field_9", tipo: "field_10", estado: "field_11", motivo: "field_12", createdAt: "field_13",
  },
  gastosCabecera: {
    viajero: "field_1", ciudadBase: "field_2", ciudadViaje: "field_3", fechaInicio: "field_4",
    fechaFin: "field_5", motivo: "field_6", proveedoresVisitados: "field_7", anticipo: "field_8",
    saldoAnterior: "field_9", estado: "field_10", jefeInmediato: "field_11", revisor: "field_12",
    firmaFecha: "field_13", comentarioRechazo: "field_14", createdAt: "field_15",
  },
  gastosDetalle: {
    gastoId: "field_1", fecha: "field_2", lugar: "field_3", proveedorServicio: "field_4",
    proveedorId: "field_5", documento: "field_6", tipo: "field_7", kmInicio: "field_8",
    kmFinal: "field_9", monto: "field_10", photoId: "field_11",
  },
};

const REVERSE_FIELD_MAPS = {};
for (const [listKey, map] of Object.entries(FIELD_MAPS)) {
  REVERSE_FIELD_MAPS[listKey] = Object.fromEntries(Object.entries(map).map(([app, sp]) => [sp, app]));
}

function toSharePointFields(listKey, fields) {
  const out = { ...fields };
  if ("id" in out) {
    out.Title = out.id;
    delete out.id;
  }
  delete out._itemId;
  const map = FIELD_MAPS[listKey] || {};
  const mapped = {};
  for (const [key, value] of Object.entries(out)) {
    mapped[map[key] || key] = value;
  }
  return mapped;
}

// Traduce un nombre de campo de la app (p.ej. "checklistId") al nombre
// interno real de SharePoint (p.ej. "field_1") para usarlo dentro de un
// $filter de Graph — los nombres de la app no existen como columnas reales.
export function spFieldName(listKey, appKey) {
  if (appKey === "id") return "Title";
  return (FIELD_MAPS[listKey] || {})[appKey] || appKey;
}

function fromSharePointItem(listKey, it) {
  const rawFields = { ...it.fields };
  const id = rawFields.Title;
  const reverseMap = REVERSE_FIELD_MAPS[listKey] || {};
  // Graph siempre devuelve también decenas de columnas internas de SharePoint
  // (LinkTitle, ContentType, Modified, Author, _ModerationStatus, etc.) junto
  // con las de la app. Si se reenviaran tal cual en una escritura posterior,
  // SharePoint las rechaza (varias son de solo lectura). Por eso aquí solo se
  // conservan las columnas que están en el mapeo de esta lista — todo lo demás
  // se descarta y nunca vuelve a formar parte de los datos de la app.
  const fields = {};
  for (const [spKey, appKey] of Object.entries(reverseMap)) {
    if (spKey in rawFields) fields[appKey] = rawFields[spKey];
  }
  // _itemId es el identificador numérico real de SharePoint (necesario para
  // poder actualizar el registro después); no lo usa el resto de la app.
  return { id, _itemId: it.id, ...fields };
}

export async function graphGetItems(listKey, { filter, expand = "fields" } = {}) {
  const qs = new URLSearchParams({ expand });
  const options = {};
  if (filter) {
    qs.set("$filter", filter);
    // Las columnas de estas listas (incluida "Title") no están indexadas —
    // Graph rechaza filtrar por ellas a menos que se pida explícitamente con
    // este header. Las listas son chicas, así que el riesgo de lentitud que
    // advierte Graph no aplica aquí.
    options.headers = { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" };
  }
  const data = await graphFetch(`${listPath(listKey)}/items?${qs.toString()}`, options);
  return (data.value || []).map((it) => fromSharePointItem(listKey, it));
}

export async function graphCreateItem(listKey, fields) {
  const data = await graphFetch(`${listPath(listKey)}/items`, {
    method: "POST",
    body: JSON.stringify({ fields: toSharePointFields(listKey, fields) }),
  });
  return { ...fields, _itemId: data.id };
}

// Actualiza directamente cuando ya se conoce el identificador numérico real
// de SharePoint (viene como _itemId en cualquier registro leído con
// graphGetItems) — evita una búsqueda extra antes de cada guardado.
export async function graphUpdateItemById(listKey, itemId, fields) {
  await graphFetch(`${listPath(listKey)}/items/${itemId}/fields`, {
    method: "PATCH",
    body: JSON.stringify(toSharePointFields(listKey, fields)),
  });
  return { ...fields, _itemId: itemId };
}

// Busca el registro por nuestro "id" (guardado en Title) y lo actualiza —
// para cuando no se tiene _itemId a mano (ej. se llegó por otra vía y no se
// cargó el registro completo primero).
export async function graphUpdateItemByAppId(listKey, appId, fields) {
  const qs = new URLSearchParams({ expand: "fields", $select: "id", $filter: `fields/Title eq '${appId}'` });
  const found = await graphFetch(`${listPath(listKey)}/items?${qs.toString()}`, {
    headers: { Prefer: "HonorNonIndexedQueriesWarningMayFailRandomly" },
  });
  const itemId = found.value && found.value[0] && found.value[0].id;
  if (!itemId) throw new Error(`No se encontró en "${listKey}" el registro con id "${appId}" para actualizar.`);
  return graphUpdateItemById(listKey, itemId, { ...fields, id: appId });
}

// Crea varios ítems de una sola vez usando $batch (ej. los 96 ítems del Check List
// al abrir una inspección nueva), en tandas de 20 (límite de Graph por batch).
export async function graphBatchCreateItems(listKey, fieldsArray) {
  const listId = CONFIG.graph.lists[listKey];
  const chunks = [];
  for (let i = 0; i < fieldsArray.length; i += 20) chunks.push(fieldsArray.slice(i, i + 20));

  for (const chunk of chunks) {
    const requests = chunk.map((fields, i) => ({
      id: String(i),
      method: "POST",
      url: `/sites/${CONFIG.graph.siteId}/lists/${listId}/items`,
      headers: { "Content-Type": "application/json" },
      body: { fields: toSharePointFields(listKey, fields) },
    }));
    await graphFetch(`/$batch`, { method: "POST", body: JSON.stringify({ requests }) });
  }
}

// "Evidencias" es su propia biblioteca de documentos (no una carpeta dentro
// de la biblioteca por defecto del sitio), así que hay que resolver su
// drive real por nombre — /sites/{id}/drive apunta solo a la biblioteca
// por defecto ("Documentos compartidos"), no a esta.
let evidenciasDriveIdCache = null;
async function getEvidenciasDriveId() {
  if (evidenciasDriveIdCache) return evidenciasDriveIdCache;
  const data = await graphFetch(`/sites/${CONFIG.graph.siteId}/drives`);
  const drive = (data.value || []).find((d) => d.name === CONFIG.graph.photoLibraryName);
  if (!drive) {
    throw new Error(`No se encontró la biblioteca de documentos "${CONFIG.graph.photoLibraryName}" en el sitio.`);
  }
  evidenciasDriveIdCache = drive.id;
  return evidenciasDriveIdCache;
}

// Sube una foto (Blob) a la biblioteca "Evidencias" y devuelve su URL pública.
export async function graphUploadPhoto(blob, filename) {
  const token = await getAccessToken();
  const driveId = await getEvidenciasDriveId();
  const res = await fetch(`${GRAPH_BASE}/drives/${driveId}/root:/${encodeURIComponent(filename)}:/content`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": blob.type || "application/octet-stream" },
    body: blob,
  });
  if (!res.ok) throw new Error(`Error subiendo foto: ${res.status}`);
  const data = await res.json();
  return data.webUrl;
}
