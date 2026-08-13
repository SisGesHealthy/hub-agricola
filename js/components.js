// Componentes de UI compartidos: cámara, GPS, firma, toasts y modales.
import { savePhotoBlob, getPhotoUrl } from "./store.js";

export function toast(message, type = "") {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = `toast ${type}`.trim();
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function openModal(innerHtml, { onMount } = {}) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><div class="modal-sheet">${innerHtml}</div></div>`;
  const backdrop = document.getElementById("modal-backdrop");
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });
  if (onMount) onMount(backdrop);
  return backdrop;
}

export function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

// ---- Cámara: usa el selector nativo de archivo/cámara del celular (más
// confiable en campo que reimplementar getUserMedia). Devuelve el photoId
// guardado localmente (ver js/db.js). ----
export function capturePhoto() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.capture = "environment";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      document.body.removeChild(input);
      if (!file) return resolve(null);
      const photoId = await savePhotoBlob(file);
      resolve(photoId);
    });
    input.click();
  });
}

export function renderPhotoRow(container, photoIds, { onAdd, onRemove, max = 6 } = {}) {
  container.innerHTML = "";
  photoIds.forEach((pid) => {
    const wrap = document.createElement("div");
    wrap.style.position = "relative";
    const img = document.createElement("img");
    img.className = "photo-thumb";
    getPhotoUrl(pid).then((url) => (img.src = url || ""));
    wrap.appendChild(img);
    if (onRemove) {
      const x = document.createElement("button");
      x.textContent = "×";
      x.style.cssText =
        "position:absolute;top:-6px;right:-6px;width:20px;height:20px;border-radius:50%;border:none;background:#b3261e;color:#fff;font-size:13px;line-height:1;cursor:pointer;";
      x.addEventListener("click", () => onRemove(pid));
      wrap.appendChild(x);
    }
    container.appendChild(wrap);
  });
  if (photoIds.length < max && onAdd) {
    const addBtn = document.createElement("button");
    addBtn.className = "photo-add";
    addBtn.type = "button";
    addBtn.textContent = "📷";
    addBtn.addEventListener("click", onAdd);
    container.appendChild(addBtn);
  }
}

// ---- GPS ----
export function captureLocation() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("GPS no disponible en este navegador."));
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

export function renderGpsBox(container, coords, { onCapture, label = "Ubicación" } = {}) {
  container.innerHTML = "";
  const box = document.createElement("div");
  if (coords && coords.lat) {
    box.className = "gps-box";
    box.innerHTML = `📍 ${label}: <b>${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}</b> (± ${Math.round(coords.accuracy || 0)} m)`;
  } else {
    box.className = "gps-box pending";
    box.innerHTML = `${label} sin capturar`;
  }
  container.appendChild(box);
  if (onCapture) {
    const btn = document.createElement("button");
    btn.className = "btn secondary small";
    btn.style.marginTop = "8px";
    btn.textContent = coords && coords.lat ? "Actualizar ubicación" : "Capturar mi ubicación";
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Obteniendo GPS…";
      try {
        const c = await captureLocation();
        onCapture(c);
      } catch (e) {
        toast(e.message || "No se pudo obtener la ubicación", "error");
      } finally {
        btn.disabled = false;
      }
    });
    container.appendChild(btn);
  }
}

// ---- Firma (canvas) ----
export class SignaturePad {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.drawing = false;
    this.hasInk = false;
    this._resize();
    this.ctx.lineWidth = 2.2;
    this.ctx.lineCap = "round";
    this.ctx.strokeStyle = "#1c211e";
    canvas.addEventListener("pointerdown", (e) => this._start(e));
    canvas.addEventListener("pointermove", (e) => this._move(e));
    window.addEventListener("pointerup", () => (this.drawing = false));
  }
  _resize() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * ratio;
    this.canvas.height = rect.height * ratio;
    this.ctx.scale(ratio, ratio);
  }
  _pos(e) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  _start(e) {
    this.drawing = true;
    this.hasInk = true;
    const p = this._pos(e);
    this.ctx.beginPath();
    this.ctx.moveTo(p.x, p.y);
  }
  _move(e) {
    if (!this.drawing) return;
    const p = this._pos(e);
    this.ctx.lineTo(p.x, p.y);
    this.ctx.stroke();
  }
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.hasInk = false;
  }
  isEmpty() {
    return !this.hasInk;
  }
  toBlob() {
    return new Promise((resolve) => this.canvas.toBlob((b) => resolve(b), "image/png"));
  }
  toDataURL() {
    return this.canvas.toDataURL("image/png");
  }
}

export function fmtMoney(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

export function fmtPct(n) {
  return `${Math.round((n || 0) * 100)}%`;
}
