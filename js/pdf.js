// Generación del PDF de la inspección (Check List), usando jsPDF + autotable
// (vendored en vendor/, sin dependencia de CDN). Expuestos como window.jspdf.
import { getPhotoBlobForExport } from "./store.js";
import { fmtPct } from "./components.js";

function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

function imageFormatFromDataUrl(dataUrl) {
  const m = /^data:image\/(png|jpe?g)/i.exec(dataUrl);
  if (!m) return "JPEG";
  return m[1].toLowerCase() === "png" ? "PNG" : "JPEG";
}

export async function buildChecklistPdf({ cabecera, items, proveedor, scoring }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 40;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("INFORME DE EVALUACIÓN Y MONITOREO DE UNIDADES DE PRODUCCIÓN", margin, y);
  y += 18;
  doc.setFontSize(10.5);
  doc.setFont("helvetica", "normal");
  doc.text(`Proveedor: ${proveedor?.nombre || "-"}    Fruta: ${proveedor?.fruta || "-"}    Ubicación: ${proveedor?.ubicacion || "-"}`, margin, y);
  y += 14;
  doc.text(`Auditor: ${cabecera.auditor || "-"}    Fecha: ${cabecera.fecha || "-"}    Estado: ${cabecera.estado || "-"}`, margin, y);
  y += 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`Ponderación total: ${fmtPct(scoring.ponderacionTotal)}  —  ${scoring.accionGlobal}`, margin, y);
  y += 14;

  doc.autoTable({
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Categoría", "Requisitos", "Cumplidos", "N/A", "Ponderación", "Acción"]],
    body: scoring.categorias.map((c) => [
      c.catName,
      c.total,
      c.cumplidos,
      c.na,
      fmtPct(c.ponderacion),
      c.accion,
    ]),
    styles: { fontSize: 8.5, cellPadding: 4 },
    headStyles: { fillColor: [31, 78, 61] },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 5) {
        data.cell.styles.textColor = data.cell.raw === "OK" ? [34, 107, 62] : [138, 36, 24];
      }
    },
  });
  y = doc.lastAutoTable.finalY + 20;

  doc.setFontSize(12);
  doc.text("Detalle de requisitos", margin, y);
  y += 8;

  doc.autoTable({
    startY: y,
    margin: { left: margin, right: margin },
    head: [["#", "Requisito", "Cumple", "Observaciones"]],
    body: items.map((it) => [it.reqNum, it.text, it.cumple === "Si" ? "Sí" : it.cumple === "No" ? "No" : "N/A", it.observaciones || ""]),
    styles: { fontSize: 7.5, cellPadding: 3, overflow: "linebreak" },
    columnStyles: { 0: { cellWidth: 30 }, 1: { cellWidth: 260 }, 2: { cellWidth: 40 }, 3: { cellWidth: 180 } },
    headStyles: { fillColor: [31, 78, 61] },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 2 && data.cell.raw === "No") {
        data.cell.styles.textColor = [138, 36, 24];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  // Firmas al final
  let sigY = doc.lastAutoTable.finalY + 30;
  if (sigY > 680) {
    doc.addPage();
    sigY = margin;
  }
  doc.setFontSize(11);
  doc.text("Firma del productor", margin, sigY);
  doc.text("Firma del auditor", margin + 280, sigY);
  if (cabecera.firmaProductorPhotoId) {
    const blob = await getPhotoBlobForExport(cabecera.firmaProductorPhotoId);
    if (blob) doc.addImage(await blobToDataUrl(blob), "PNG", margin, sigY + 8, 200, 70);
  }
  if (cabecera.firmaAuditorPhotoId) {
    const blob = await getPhotoBlobForExport(cabecera.firmaAuditorPhotoId);
    if (blob) doc.addImage(await blobToDataUrl(blob), "PNG", margin + 280, sigY + 8, 200, 70);
  }

  return doc.output("blob");
}

// PDF consolidado de un viaje de Gastos de Viaje: encabezado del viaje +
// tabla de todas las líneas + totales. Pensado para imprimirse y grapar las
// facturas físicas detrás — solo tiene sentido una vez que el gasto ya fue
// aprobado (ver el botón en gastos.js, que lo restringe a ese estado).
export async function buildGastoPdf({ cabecera, lineas, provById = {}, totales }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 40;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("LIQUIDACIÓN DE GASTOS DE VIAJE", margin, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.text(`Viajero: ${cabecera.viajero || "-"}    Ciudad base: ${cabecera.ciudadBase || "-"}`, margin, y);
  y += 14;
  doc.text(`Ruta / ciudad de viaje: ${cabecera.ciudadViaje || "-"}`, margin, y);
  y += 14;
  doc.text(`Del ${(cabecera.fechaInicio || "-").slice(0, 10)} al ${(cabecera.fechaFin || "-").slice(0, 10)}    Motivo: ${cabecera.motivo || "-"}`, margin, y);
  y += 14;
  const nombresProv = (cabecera.proveedoresVisitados || []).map((id) => provById[id]?.nombre).filter(Boolean).join(", ");
  if (nombresProv) {
    doc.text(`Proveedores visitados: ${nombresProv}`, margin, y);
    y += 14;
  }
  const revisores = [...new Set(lineas.map((l) => l.revisorLinea).filter(Boolean))].join(", ");
  doc.text(`Estado: ${cabecera.estado || "-"}    Aprobado por: ${revisores || "-"}`, margin, y);
  y += 20;

  doc.autoTable({
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Fecha", "Tipo", "Lugar", "Proveedor/Servicio", "N.º factura", "Proveedor visitado", "Km", "Monto"]],
    body: lineas.map((l) => [
      (l.fecha || "").slice(0, 10),
      l.tipo || "",
      l.lugar || "",
      l.proveedorServicio || "",
      l.documento || "",
      l.proveedorId ? provById[l.proveedorId]?.nombre || "" : "",
      // "→" no existe en la fuente estándar de jsPDF (Helvetica/WinAnsi) y sale
      // corrupto en el PDF; se usa un guion simple en su lugar.
      l.tipo === "Movilización propia (Km)" ? `${l.kmInicio ?? ""} - ${l.kmFinal ?? ""}` : "",
      `$${Number(l.monto || 0).toFixed(2)}`,
    ]),
    styles: { fontSize: 7.5, cellPadding: 4, overflow: "linebreak", valign: "middle" },
    headStyles: { fillColor: [31, 78, 61], fontSize: 7.5 },
    columnStyles: {
      0: { cellWidth: 52 },
      1: { cellWidth: 78 },
      2: { cellWidth: 68 },
      3: { cellWidth: 85 },
      4: { cellWidth: 62 },
      5: { cellWidth: 80 },
      6: { cellWidth: 55 },
      7: { cellWidth: 52, halign: "right" },
    },
  });
  y = doc.lastAutoTable.finalY + 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text(`Total gastos: $${totales.total.toFixed(2)}`, margin, y);
  y += 14;
  doc.text(`Anticipo recibido: $${Number(cabecera.anticipo || 0).toFixed(2)}    Saldo anterior: $${Number(cabecera.saldoAnterior || 0).toFixed(2)}`, margin, y);
  y += 14;
  doc.text(
    totales.valorADevolver >= 0
      ? `La empresa reembolsa: $${totales.valorADevolver.toFixed(2)}`
      : `El viajero devuelve: $${Math.abs(totales.valorADevolver).toFixed(2)}`,
    margin,
    y
  );
  y += 26;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.text(
    `Firmado electrónicamente por ${cabecera.viajero || "-"} el ${cabecera.firmaFecha ? new Date(cabecera.firmaFecha).toLocaleString("es-EC") : "-"}.`,
    margin,
    y
  );
  y += 14;
  doc.text("Adjuntar a este documento las facturas físicas originales de cada línea de gasto.", margin, y);

  return doc.output("blob");
}

// Ficha individual de un Seguimiento Semanal — para imprimir/archivar esa
// visita puntual, igual que el PDF del Check List.
export async function buildSeguimientoPdf({ seguimiento, proveedor }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 40;
  const contentWidth = 612 - margin * 2;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("SEGUIMIENTO SEMANAL", margin, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.text(`Proveedor: ${proveedor?.nombre || "-"}    Fruta: ${proveedor?.fruta || "-"}    Ubicación: ${proveedor?.ubicacion || "-"}`, margin, y);
  y += 14;
  doc.text(`Fecha: ${(seguimiento.fecha || "-").slice(0, 10)}    Semana: ${seguimiento.semana ?? "-"}    Tipo de contacto: ${seguimiento.tipo || "-"}`, margin, y);
  y += 14;
  doc.text(
    `Estado de cumplimiento: ${seguimiento.estado || "-"}    Fecha máx. cumplimiento: ${(seguimiento.fechaMaxCumplimiento || "-").slice(0, 10)}`,
    margin,
    y
  );
  y += 22;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Novedades", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  const novedadesLines = doc.splitTextToSize(seguimiento.novedades || "-", contentWidth);
  doc.text(novedadesLines, margin, y);
  y += novedadesLines.length * 12 + 16;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Recomendaciones", margin, y);
  y += 14;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  const recoLines = doc.splitTextToSize(seguimiento.recomendaciones || "-", contentWidth);
  doc.text(recoLines, margin, y);
  y += recoLines.length * 12 + 16;

  if (seguimiento.coords?.lat != null && seguimiento.coords?.lng != null) {
    doc.setFontSize(9.5);
    doc.text(`Ubicación GPS: ${Number(seguimiento.coords.lat).toFixed(5)}, ${Number(seguimiento.coords.lng).toFixed(5)}`, margin, y);
    y += 18;
  }

  const photoIds = (seguimiento.photoIds || []).filter(Boolean).slice(0, 4);
  if (photoIds.length) {
    if (y > 560) {
      doc.addPage();
      y = margin;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Evidencia fotográfica", margin, y);
    y += 10;
    const size = 120;
    for (let i = 0; i < photoIds.length; i++) {
      const blob = await getPhotoBlobForExport(photoIds[i]);
      if (!blob) continue;
      try {
        const dataUrl = await blobToDataUrl(blob);
        doc.addImage(dataUrl, imageFormatFromDataUrl(dataUrl), margin + i * (size + 10), y, size, size);
      } catch {
        // Foto no disponible (ej. sin conexión); se omite en vez de romper el PDF.
      }
    }
    y += size + 10;
  }

  return doc.output("blob");
}

// Reporte consolidado de varios Seguimientos Semanales (según el filtro de
// fecha/proveedor que se haya aplicado en la pantalla) — una tabla resumen,
// no ficha por ficha.
export async function buildSeguimientosReportePdf({ seguimientos, provById = {}, desde, hasta, proveedorNombre }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const margin = 40;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("REPORTE DE SEGUIMIENTO SEMANAL", margin, y);
  y += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10.5);
  doc.text(
    `Rango de fechas: ${desde || "inicio"} a ${hasta || "hoy"}    Proveedor: ${proveedorNombre || "Todos"}    Total registros: ${seguimientos.length}`,
    margin,
    y
  );
  y += 20;

  doc.autoTable({
    startY: y,
    margin: { left: margin, right: margin },
    head: [["Fecha", "Proveedor", "Tipo", "Estado", "Novedades", "Fecha máx."]],
    body: seguimientos.map((s) => [
      (s.fecha || "").slice(0, 10),
      provById[s.proveedorId]?.nombre || "-",
      s.tipo || "-",
      s.estado || "-",
      s.novedades || "",
      (s.fechaMaxCumplimiento || "").slice(0, 10),
    ]),
    styles: { fontSize: 7.5, cellPadding: 4, overflow: "linebreak" },
    headStyles: { fillColor: [31, 78, 61] },
    columnStyles: {
      0: { cellWidth: 55 },
      1: { cellWidth: 100 },
      2: { cellWidth: 65 },
      3: { cellWidth: 65 },
      4: { cellWidth: 170 },
      5: { cellWidth: 60 },
    },
  });

  return doc.output("blob");
}

export function downloadPdf(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
