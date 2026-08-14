// Configuración del Hub Agrícola.
// En modo demo (useMock: true) todo se guarda en el celular/navegador (IndexedDB),
// sin necesidad de Azure AD ni SharePoint todavía. Para conectar a producción,
// completa los valores de abajo (ver guía de puesta en marcha) y cambia useMock a false.

export const CONFIG = {
  useMock: false,

  msal: {
    clientId: "25d916cf-7570-4dae-9f30-3d31a48b4e92",
    authority: "https://login.microsoftonline.com/8f9b210d-f5e5-404f-9fed-a0a827154105",
    redirectUri: window.location.origin + window.location.pathname,
  },

  graph: {
    siteId: "marcalman.sharepoint.com,d70b4a9a-94fd-4aa9-9e4e-3753cd9f391b,8d185884-859f-4370-9784-96b4ea886ca9",
    lists: {
      proveedores: "5866ff54-bd78-480a-9520-613c0b872ddc",
      catalogoRequisitos: "2c493dc9-d193-49d8-bdec-e9c71259ecad",
      checklistCabecera: "a393b98a-9cb5-42d1-88c5-ee186c3c5866",
      checklistItems: "4d750d88-4761-4d2d-9ba6-9d3fe40445c0",
      seguimientoSemanal: "e42a424d-71ea-4ec6-8781-fbfdde4011d8",
      rutaVisitas: "b4bba270-abc5-4824-8993-4b00d889ff27",
      gastosCabecera: "5dd1d7c9-3a83-4ef7-8334-d91b1729b1ba",
      gastosDetalle: "1749faa9-99ba-4aaa-bdd3-04db434fc915",
      // Lista "Configuracion" (tarifa por Km editable por Talento Humano) —
      // creala corriendo New-HubAgricolaLists.ps1 de nuevo (es seguro
      // reejecutarlo) y pega aquí el GUID que te imprima al final. Mientras
      // esté en null, la app usa el valor de respaldo "kmRate" de abajo.
      configuracion: null,
    },
    // Nombre exacto de la biblioteca de documentos donde se suben las fotos y firmas.
    photoLibraryName: "Evidencias",
  },

  // Valor por Km de respaldo, solo mientras "graph.lists.configuracion" esté
  // en null o la lista todavía no tenga el registro "tarifaKm" — una vez
  // configurada, store.getKmRate() lee siempre el valor real de SharePoint.
  kmRate: 0.27,

  // Debajo de esta ponderación (0-1) por categoría, el Check List se marca "Plan de Acción".
  ponderacionUmbral: 0.8,

  // Quién aprueba un viaje en Gastos de Viaje, según su contenido: si el
  // viaje es solo kilometraje (movilización propia), lo aprueba Talento
  // Humano; cualquier otro tipo de gasto (hospedaje, alimentación, etc.)
  // lo aprueba Compras. Ver store.computeAprobador().
  approvers: {
    kilometraje: "talentohumano@healthyfood.com.ec",
    general: "compras@healthyfood.com.ec",
  },
};
