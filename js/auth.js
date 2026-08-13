// Envoltorio sobre MSAL (@azure/msal-browser, vendored en vendor/msal-browser.min.js).
// Solo se activa cuando CONFIG.useMock === false. En modo demo no se llama nunca.

import { CONFIG } from "./config.js";

let msalInstance = null;
let account = null;

const SCOPES = ["Sites.ReadWrite.All"]; // ver guía de puesta en marcha para permisos más acotados (Sites.Selected)

function getMsal() {
  if (!msalInstance) {
    // msal global viene de vendor/msal-browser.min.js
    msalInstance = new msal.PublicClientApplication({
      auth: {
        clientId: CONFIG.msal.clientId,
        authority: CONFIG.msal.authority,
        redirectUri: CONFIG.msal.redirectUri,
      },
      cache: { cacheLocation: "localStorage" },
    });
  }
  return msalInstance;
}

export async function initAuth() {
  const app = getMsal();
  await app.initialize();
  const result = await app.handleRedirectPromise().catch(() => null);
  if (result && result.account) {
    account = result.account;
  } else {
    const accounts = app.getAllAccounts();
    if (accounts.length > 0) account = accounts[0];
  }
  return account;
}

export async function login() {
  const app = getMsal();
  const result = await app.loginRedirect({ scopes: SCOPES });
  return result;
}

export function logout() {
  const app = getMsal();
  return app.logoutRedirect();
}

export function getCurrentUser() {
  return account;
}

export async function getAccessToken() {
  const app = getMsal();
  if (!account) throw new Error("No hay sesión iniciada.");
  try {
    const result = await app.acquireTokenSilent({ scopes: SCOPES, account });
    return result.accessToken;
  } catch (e) {
    const result = await app.acquireTokenRedirect({ scopes: SCOPES });
    return result?.accessToken;
  }
}
