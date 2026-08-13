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

// Al crear las listas importando los Excel, SharePoint fusionó automáticamente
// la primera columna de cada tabla (nuestro campo "id") con la columna nativa
// "Title" en vez de crear una columna aparte — así que "id" en el resto de la
// app en realidad vive en Title. Esto traduce en ambas direcciones para que
// store.js pueda seguir usando "id" como si fuera una columna normal.
function toSharePointFields(fields) {
  const out = { ...fields };
  if ("id" in out) {
    out.Title = out.id;
    delete out.id;
  }
  return out;
}

function fromSharePointItem(it) {
  const fields = { ...it.fields };
  const id = fields.Title;
  delete fields.Title;
  // _itemId es el identificador numérico real de SharePoint (necesario para
  // poder actualizar el registro después); no lo usa el resto de la app.
  return { id, _itemId: it.id, ...fields };
}

export async function graphGetItems(listKey, { filter, expand = "fields" } = {}) {
  const qs = new URLSearchParams({ expand });
  if (filter) qs.set("$filter", filter);
  const data = await graphFetch(`${listPath(listKey)}/items?${qs.toString()}`);
  return (data.value || []).map(fromSharePointItem);
}

export async function graphCreateItem(listKey, fields) {
  const data = await graphFetch(`${listPath(listKey)}/items`, {
    method: "POST",
    body: JSON.stringify({ fields: toSharePointFields(fields) }),
  });
  return { ...fields, _itemId: data.id };
}

// Actualiza directamente cuando ya se conoce el identificador numérico real
// de SharePoint (viene como _itemId en cualquier registro leído con
// graphGetItems) — evita una búsqueda extra antes de cada guardado.
export async function graphUpdateItemById(listKey, itemId, fields) {
  await graphFetch(`${listPath(listKey)}/items/${itemId}/fields`, {
    method: "PATCH",
    body: JSON.stringify(toSharePointFields(fields)),
  });
  return { ...fields, _itemId: itemId };
}

// Busca el registro por nuestro "id" (guardado en Title) y lo actualiza —
// para cuando no se tiene _itemId a mano (ej. se llegó por otra vía y no se
// cargó el registro completo primero).
export async function graphUpdateItemByAppId(listKey, appId, fields) {
  const qs = new URLSearchParams({ expand: "fields", $select: "id", $filter: `fields/Title eq '${appId}'` });
  const found = await graphFetch(`${listPath(listKey)}/items?${qs.toString()}`);
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
      body: { fields: toSharePointFields(fields) },
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
