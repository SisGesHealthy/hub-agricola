// Service worker: cachea el shell de la app para que funcione sin conexión en campo.
// Los datos (proveedores, checklists, fotos, etc.) viven en IndexedDB, no aquí.
const CACHE_NAME = "hub-agricola-v12";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./css/styles.css",
  "./data/catalogo_requisitos.json",
  "./js/app.js",
  "./js/config.js",
  "./js/db.js",
  "./js/store.js",
  "./js/graph.js",
  "./js/auth.js",
  "./js/dom.js",
  "./js/components.js",
  "./js/pdf.js",
  "./js/checklist.js",
  "./js/seguimiento.js",
  "./js/ruta.js",
  "./js/gastos.js",
  "./vendor/jspdf.umd.min.js",
  "./vendor/jspdf.plugin.autotable.min.js",
  "./vendor/msal-browser.min.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Nunca cachear llamadas a Microsoft Graph / login — deben ir siempre a la red.
  if (url.hostname.includes("graph.microsoft.com") || url.hostname.includes("login.microsoftonline.com")) return;
  // Ignora peticiones que no sean http(s) (ej. chrome-extension://) — la Cache API las rechaza.
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  event.respondWith(
    caches.match(event.request).then(
      (cached) =>
        cached ||
        fetch(event.request)
          .then((res) => {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
            return res;
          })
          .catch(() => cached)
    )
  );
});
