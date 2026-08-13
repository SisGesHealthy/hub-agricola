// Selector de ubicación en mapa (Leaflet + OpenStreetMap, vendored localmente).
// Se usa para fijar coordenadas al planificar (proveedor nuevo, ruta) sin depender
// de escribir el nombre del sector a mano. Requiere conexión a internet para las
// teselas del mapa (se usa en oficina, al planificar — no en el punto de la visita,
// donde ya se captura GPS real sin necesitar mapa).
import { el, clear } from "./dom.js";
import { openModal, closeModal, captureLocation, toast } from "./components.js";
import { ECUADOR_CENTER } from "./ecuador.js";

export function openMapPicker({ lat, lng } = {}) {
  return new Promise((resolve) => {
    const start = lat != null && lng != null ? { lat, lng } : ECUADOR_CENTER;
    const startZoom = lat != null && lng != null ? 14 : 7;

    const mapDiv = el("div", { id: "map-picker", style: "height:320px;border-radius:12px;overflow:hidden;margin-bottom:10px" });
    const coordLabel = el("div", { class: "hint", style: "margin-bottom:10px" }, "Toca el mapa o arrastra el marcador para ajustar el punto.");
    const searchInput = el("input", { type: "text", placeholder: "Buscar dirección o lugar en Ecuador…" });
    const searchBtn = el("button", { class: "btn secondary small", style: "margin-top:8px" }, "Buscar");
    const gpsBtn = el("button", { class: "btn ghost small", style: "margin-top:8px;margin-left:8px" }, "Usar mi ubicación GPS");

    const backdrop = openModal(
      `<h3>Seleccionar ubicación en el mapa</h3>`,
      {
        onMount: (b) => {
          const sheet = b.querySelector(".modal-sheet");
          sheet.appendChild(searchInput);
          sheet.appendChild(el("div", { class: "btn-row" }, [searchBtn, gpsBtn]));
          sheet.appendChild(el("div", { style: "height:12px" }));
          sheet.appendChild(mapDiv);
          sheet.appendChild(coordLabel);
          const actions = el("div", { class: "btn-row" }, [
            el("button", { class: "btn ghost", onclick: () => { closeModal(); resolve(null); } }, "Cancelar"),
            el(
              "button",
              {
                class: "btn",
                onclick: () => {
                  const c = marker.getLatLng();
                  closeModal();
                  resolve({ lat: c.lat, lng: c.lng });
                },
              },
              "Usar esta ubicación"
            ),
          ]);
          sheet.appendChild(actions);

          // Leaflet se carga como script global (vendor/leaflet/leaflet.js)
          const map = L.map(mapDiv, { center: [start.lat, start.lng], zoom: startZoom });
          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "© OpenStreetMap",
            maxZoom: 19,
          }).addTo(map);
          const marker = L.marker([start.lat, start.lng], { draggable: true }).addTo(map);

          function updateLabel() {
            const c = marker.getLatLng();
            coordLabel.textContent = `Punto seleccionado: ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
          }
          updateLabel();
          marker.on("dragend", updateLabel);
          map.on("click", (e) => {
            marker.setLatLng(e.latlng);
            updateLabel();
          });
          setTimeout(() => map.invalidateSize(), 50);

          searchBtn.addEventListener("click", async () => {
            const q = searchInput.value.trim();
            if (!q) return;
            searchBtn.disabled = true;
            searchBtn.textContent = "Buscando…";
            try {
              const res = await fetch(
                `https://nominatim.openstreetmap.org/search?format=json&countrycodes=ec&limit=1&q=${encodeURIComponent(q)}`
              );
              const results = await res.json();
              if (!results.length) {
                toast("No se encontró esa dirección en Ecuador", "error");
                return;
              }
              const { lat: rlat, lon: rlon } = results[0];
              const ll = [Number(rlat), Number(rlon)];
              map.setView(ll, 15);
              marker.setLatLng(ll);
              updateLabel();
            } catch (e) {
              toast("No se pudo buscar (revisa tu conexión)", "error");
            } finally {
              searchBtn.disabled = false;
              searchBtn.textContent = "Buscar";
            }
          });

          gpsBtn.addEventListener("click", async () => {
            gpsBtn.disabled = true;
            gpsBtn.textContent = "Obteniendo GPS…";
            try {
              const c = await captureLocation();
              map.setView([c.lat, c.lng], 16);
              marker.setLatLng([c.lat, c.lng]);
              updateLabel();
            } catch (e) {
              toast(e.message || "No se pudo obtener el GPS", "error");
            } finally {
              gpsBtn.disabled = false;
              gpsBtn.textContent = "Usar mi ubicación GPS";
            }
          });
        },
      }
    );
  });
}
