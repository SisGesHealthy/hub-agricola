import { el, clear } from "./dom.js";
import { CONFIG } from "./config.js";
import * as store from "./store.js";
import { renderChecklistHome } from "./checklist.js";
import { renderSeguimientoHome } from "./seguimiento.js";
import { renderRutaHome } from "./ruta.js";
import { renderGastosHome } from "./gastos.js";

const root = document.getElementById("view-root");
const navButtons = [...document.querySelectorAll(".nav-btn")];

const ROUTES = {
  inicio: renderInicio,
  checklist: renderChecklistHome,
  seguimiento: renderSeguimientoHome,
  ruta: renderRutaHome,
  gastos: renderGastosHome,
};

function setActiveNav(route) {
  navButtons.forEach((b) => b.classList.toggle("active", b.dataset.route === route));
}

async function goTo(route) {
  setActiveNav(route);
  const fn = ROUTES[route] || renderInicio;
  await fn(root);
}

navButtons.forEach((btn) => btn.addEventListener("click", () => goTo(btn.dataset.route)));

async function renderInicio(container) {
  clear(container);
  container.appendChild(el("h1", {}, "Buenos días 👋"));
  container.appendChild(el("div", { class: "hint" }, "Resumen de pendientes del día"));

  const [checklists, seguimientos, gastos, rutas] = await Promise.all([
    store.listChecklists(),
    store.listSeguimientos(),
    store.listGastos(),
    store.listRutas(),
  ]);

  const hoy = new Date().toISOString().slice(0, 10);
  const planAccion = checklists.filter((c) => c.accionGlobal === "Plan de Acción").length;
  const vencidos = seguimientos.filter((s) => s.fechaMaxCumplimiento && s.fechaMaxCumplimiento < hoy && s.estado !== "Cumplido").length;
  const gastosPendientes = gastos.filter((g) => g.estado === "Enviado").length;
  const visitasHoy = rutas.filter((r) => r.fecha === hoy && (r.estado === "Planificada" || r.estado === "Reprogramada")).length;

  const grid = el("div", { class: "home-grid" }, [
    tile("Check List", "Con plan de acción", planAccion, planAccion > 0 ? "bad" : "ok", () => goTo("checklist")),
    tile("Seguimiento", "Vencidos", vencidos, vencidos > 0 ? "warn" : "ok", () => goTo("seguimiento")),
    tile("Ruta", "Visitas hoy", visitasHoy, visitasHoy > 0 ? "info" : "", () => goTo("ruta")),
    tile("Gastos", "Por aprobar", gastosPendientes, gastosPendientes > 0 ? "warn" : "ok", () => goTo("gastos")),
  ]);
  container.appendChild(grid);

  container.appendChild(el("div", { class: "section-title" }, "Accesos rápidos"));
  const quick = el("div", { class: "card" });
  quick.append(
    el("button", { class: "btn secondary", style: "margin-bottom:8px", onclick: () => goTo("checklist") }, "📋 Nueva inspección"),
    el("button", { class: "btn secondary", style: "margin-bottom:8px", onclick: () => goTo("seguimiento") }, "🌱 Registrar seguimiento"),
    el("button", { class: "btn secondary", style: "margin-bottom:8px", onclick: () => goTo("ruta") }, "📍 Registrar visita de ruta"),
    el("button", { class: "btn secondary", onclick: () => goTo("gastos") }, "💵 Registrar gasto de viaje")
  );
  container.appendChild(quick);

  if (CONFIG.useMock) {
    container.appendChild(
      el("div", { class: "hint", style: "text-align:center;margin-top:18px" }, "Modo demostración — los datos se guardan solo en este navegador.")
    );
  }
}

function tile(label, sub, count, tone, onClick) {
  return el("button", { class: `home-tile ${tone}`, onclick: onClick }, [
    el("div", { class: "tile-count" }, String(count)),
    el("div", { class: "tile-label" }, `${label} · ${sub}`),
  ]);
}

// ---- Indicador de conexión / sincronización ----
function updateSyncIndicator() {
  const dot = document.getElementById("sync-indicator");
  const banner = document.getElementById("offline-banner");
  if (!navigator.onLine) {
    dot.className = "sync-indicator offline";
    banner.classList.remove("hidden");
  } else {
    dot.className = "sync-indicator";
    banner.classList.add("hidden");
  }
}
window.addEventListener("online", updateSyncIndicator);
window.addEventListener("offline", updateSyncIndicator);

// ---- Arranque ----
(async function bootstrap() {
  document.getElementById("user-chip").textContent = CONFIG.useMock ? "Modo demo" : "Conectando…";
  updateSyncIndicator();
  await store.initStore();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  await goTo("inicio");
})();
