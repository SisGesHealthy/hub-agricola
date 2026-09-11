// Catálogo de Proveedores: pantalla dedicada para crear, editar y borrar
// proveedores, con aviso de duplicados — antes solo se podían crear "al
// vuelo" desde Check List/Ruta, sin ningún control, lo que dejó varios
// nombres repetidos en el catálogo.
import { el, clear } from "./dom.js";
import * as store from "./store.js";
import { toast, fmtPct } from "./components.js";
import { isAdmin } from "./auth.js";
import { openMapPicker } from "./mapPicker.js";
import { PROVINCIAS_ECUADOR } from "./ecuador.js";

const ESTADOS_PROVEEDOR = ["Nuevo", "En evaluación", "Activo", "Inactivo", "Descartado"];

export async function renderProveedoresHome(root) {
  clear(root);
  root.appendChild(el("div", { class: "top-actions" }, [el("h1", {}, "Catálogo de Proveedores")]));
  root.appendChild(el("button", { class: "btn", onclick: () => renderProveedorForm(root) }, "+ Nuevo proveedor"));

  const proveedores = await store.listProveedores();
  const search = el("input", { type: "text", placeholder: "Buscar por nombre…", style: "margin-top:12px" });
  root.appendChild(search);

  const dupCount = countGruposDuplicados(proveedores);
  if (dupCount > 0) {
    root.appendChild(
      el(
        "div",
        { class: "hint", style: "color:#8a2418;margin-top:8px" },
        `⚠️ ${dupCount} nombre(s) repetido(s) en el catálogo — revisa y borra los que sobren.`
      )
    );
  }

  root.appendChild(el("div", { class: "section-title" }, `Proveedores (${proveedores.length})`));
  const listBox = el("div");
  root.appendChild(listBox);

  function renderList() {
    clear(listBox);
    const q = search.value.trim().toLowerCase();
    const filtrados = q ? proveedores.filter((p) => (p.nombre || "").toLowerCase().includes(q)) : proveedores;
    if (filtrados.length === 0) {
      listBox.appendChild(el("div", { class: "empty-state" }, "Sin resultados."));
      return;
    }
    const card = el("div", { class: "card" });
    filtrados.forEach((p) => {
      card.appendChild(
        el(
          "div",
          { class: "list-row", onclick: () => renderProveedorForm(root, p) },
          [
            el("div", {}, [
              el("div", { class: "title" }, p.nombre),
              el("div", { class: "sub" }, `${p.fruta || "-"} · ${p.ubicacion || "-"} · ${p.estado || "-"}`),
            ]),
            p.ultimaPonderacion != null ? el("div", { class: "badge info" }, fmtPct(p.ultimaPonderacion)) : null,
          ]
        )
      );
    });
    listBox.appendChild(card);
  }
  search.addEventListener("input", renderList);
  renderList();
}

function normalizeNombre(s) {
  return (s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function countGruposDuplicados(proveedores) {
  const counts = {};
  proveedores.forEach((p) => {
    const k = normalizeNombre(p.nombre);
    if (!k) return;
    counts[k] = (counts[k] || 0) + 1;
  });
  return Object.values(counts).filter((n) => n > 1).length;
}

async function renderProveedorForm(root, existing = null) {
  clear(root);
  root.appendChild(
    el("div", { class: "top-actions" }, [el("button", { class: "back-btn", onclick: () => renderProveedoresHome(root) }, "‹ Volver")])
  );
  root.appendChild(el("h1", {}, existing ? "Editar proveedor" : "Nuevo proveedor"));

  const card = el("div", { class: "card" });
  const nombre = el("input", { type: "text", placeholder: "Nombre del productor", value: existing?.nombre || "" });
  const fruta = el("input", { type: "text", placeholder: "Fruta principal", value: existing?.fruta || "" });
  const provinciaSelect = el(
    "select",
    {},
    [
      el("option", { value: "" }, "Selecciona provincia"),
      ...PROVINCIAS_ECUADOR.map((p) => el("option", { value: p, selected: existing?.provincia === p ? "selected" : undefined }, p)),
    ]
  );
  const ubicacion = el("input", { type: "text", placeholder: "Sector / lugar (ej. Categosín)", value: existing?.ubicacion || "" });
  const estadoSelect = el(
    "select",
    {},
    ESTADOS_PROVEEDOR.map((e) => el("option", { value: e, selected: (existing?.estado || "Nuevo") === e ? "selected" : undefined }, e))
  );
  card.append(
    el("label", { class: "field-label" }, "Nombre del productor"),
    nombre,
    el("label", { class: "field-label" }, "Fruta principal"),
    fruta,
    el("label", { class: "field-label" }, "Provincia"),
    provinciaSelect,
    el("label", { class: "field-label" }, "Sector / lugar"),
    ubicacion,
    el("label", { class: "field-label" }, "Estado"),
    estadoSelect
  );
  root.appendChild(card);

  const gpsCard = el("div", { class: "card" });
  gpsCard.appendChild(el("label", { class: "field-label", style: "margin-top:0" }, "Coordenadas del cultivo"));
  const gpsBox = el("div");
  gpsCard.appendChild(gpsBox);
  root.appendChild(gpsCard);
  let coords = existing?.lat != null && existing?.lng != null ? { lat: existing.lat, lng: existing.lng } : null;
  function refreshGps() {
    clear(gpsBox);
    gpsBox.appendChild(
      coords
        ? el("div", { class: "gps-box" }, `📍 ${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`)
        : el("div", { class: "gps-box pending" }, "Sin capturar todavía")
    );
    gpsBox.appendChild(
      el(
        "button",
        {
          class: "btn secondary small",
          style: "margin-top:8px",
          onclick: async () => {
            const picked = await openMapPicker(coords || {});
            if (picked) {
              coords = picked;
              refreshGps();
            }
          },
        },
        "Seleccionar en el mapa"
      )
    );
  }
  refreshGps();

  root.appendChild(
    el(
      "button",
      {
        class: "btn",
        style: "margin-top:14px",
        onclick: async () => {
          if (!nombre.value.trim()) return toast("Ingresa el nombre del productor", "error");
          if (!provinciaSelect.value) return toast("Selecciona la provincia", "error");
          const dup = await store.findProveedorDuplicado(nombre.value.trim(), existing?.id);
          if (dup && !confirm(`Ya existe un proveedor llamado "${dup.nombre}" (${dup.fruta || "-"}, ${dup.ubicacion || "-"}). ¿Guardar de todas formas?`)) {
            return;
          }
          await store.saveProveedor({
            id: existing?.id,
            _itemId: existing?._itemId,
            nombre: nombre.value.trim(),
            fruta: fruta.value.trim(),
            provincia: provinciaSelect.value,
            ubicacion: ubicacion.value.trim(),
            lat: coords?.lat ?? null,
            lng: coords?.lng ?? null,
            estado: estadoSelect.value,
            ultimaPonderacion: existing?.ultimaPonderacion ?? null,
          });
          toast(existing ? "Proveedor actualizado" : "Proveedor creado", "success");
          renderProveedoresHome(root);
        },
      },
      existing ? "Guardar cambios" : "Guardar proveedor"
    )
  );

  if (existing && isAdmin()) {
    root.appendChild(
      el(
        "button",
        {
          class: "btn danger",
          style: "margin-top:10px",
          onclick: async () => {
            if (!confirm(`¿Borrar el proveedor "${existing.nombre}"? Las inspecciones, seguimientos, rutas o gastos ya registrados con él quedarán como "Proveedor eliminado". Esto no se puede deshacer.`)) return;
            await store.deleteProveedor(existing.id);
            toast("Proveedor eliminado", "success");
            renderProveedoresHome(root);
          },
        },
        "🗑 Eliminar proveedor"
      )
    );
  }
}
