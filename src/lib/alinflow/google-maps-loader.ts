type GoogleMapsLoadState = { promise: Promise<any> };
type GoogleMapsAuthFailureListener = (error: Error) => void;

declare global {
  interface Window {
    google?: any;
    gm_authFailure?: () => void;
    __alinflowGoogleMapsLoader?: GoogleMapsLoadState;
    __alinflowGoogleMapsAttempt?: number;
    __alinflowGoogleMapsFailedNamespace?: any;
    __alinflowGoogleMapsAuthListeners?: Set<GoogleMapsAuthFailureListener>;
  }
}

const SCRIPT_ID = "alinflow-google-maps-script";
const LOAD_TIMEOUT_MS = 25_000;
const ignoreLateCallback = () => {};

// The API-ready callback can run before Google validates a map's credentials.
// Mounted canvases keep this subscription after their load promise resolves.
export function subscribeGoogleMapsAuthFailure(listener: GoogleMapsAuthFailureListener): () => void {
  if (typeof window === "undefined") return () => {};
  const listeners = window.__alinflowGoogleMapsAuthListeners ||= new Set();
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notifyAuthFailure(error: Error) {
  // A listener may unsubscribe or initiate a retry while handling the error.
  for (const listener of [...(window.__alinflowGoogleMapsAuthListeners || [])]) {
    try { listener(error); } catch { /* One canvas must not prevent another from receiving the error. */ }
  }
}

// Google requires callback readiness for loading=async; script.onload alone
// does not mean the Maps API is usable. Both app maps share this one loader.
// https://developers.google.com/maps/documentation/javascript/load-maps-js-api
export function loadGoogleMaps(apiKey: string): Promise<any> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("A térkép csak böngészőben tölthető be."));
  }
  if (typeof apiKey !== "string" || !apiKey.trim()) {
    return Promise.reject(new Error("A Google térkép beállítása hiányzik."));
  }
  if (window.__alinflowGoogleMapsLoader) return window.__alinflowGoogleMapsLoader.promise;
  if (typeof window.google?.maps?.Map === "function"
    && window.google.maps !== window.__alinflowGoogleMapsFailedNamespace) return Promise.resolve(window.google.maps);

  let resolve!: (maps: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((accept, decline) => { resolve = accept; reject = decline; });
  const state: GoogleMapsLoadState = { promise };
  window.__alinflowGoogleMapsLoader = state;
  const globals = window as unknown as Record<string, unknown>;
  let callbackName: string;
  do {
    window.__alinflowGoogleMapsAttempt = (window.__alinflowGoogleMapsAttempt || 0) + 1;
    callbackName = `__alinflowGoogleMapsReady_${window.__alinflowGoogleMapsAttempt}`;
  } while (Object.prototype.hasOwnProperty.call(globals, callbackName));

  let script: HTMLScriptElement | undefined;
  let timer: number | undefined;
  let settled = false;
  const previousAuthFailure = window.gm_authFailure;

  function finish(error?: Error) {
    if (settled || window.__alinflowGoogleMapsLoader !== state) return;
    settled = true;
    if (timer !== undefined) window.clearTimeout(timer);
    if (script) script.onerror = null;
    // Keep a harmless function under this attempt's unique name: a response
    // arriving after timeout must neither throw nor complete a later attempt.
    if (globals[callbackName] === ready) globals[callbackName] = ignoreLateCallback;
    // Keep the hook after readiness: authentication can fail asynchronously
    // when a map is constructed. Failed attempts restore the original hook.
    if (error && window.gm_authFailure === authFailure) {
      if (previousAuthFailure) window.gm_authFailure = previousAuthFailure;
      else delete window.gm_authFailure;
    }
    if (error) {
      // Authentication can fail after Google has created constructors. Their
      // mere presence must not turn Retry into a false successful cache hit.
      window.__alinflowGoogleMapsFailedNamespace = window.google?.maps;
      script?.remove();
      delete window.__alinflowGoogleMapsLoader;
      reject(error);
    } else {
      delete window.__alinflowGoogleMapsFailedNamespace;
      resolve(window.google.maps);
    }
  }

  function ready() {
    if (settled || window.__alinflowGoogleMapsLoader !== state) return;
    if (typeof window.google?.maps?.Map !== "function") {
      finish(new Error("A Google térkép nem áll készen. Próbáld újra."));
      return;
    }
    finish();
  }

  function authFailure() {
    if (window.__alinflowGoogleMapsLoader !== state) return;
    const error = new Error("A Google térkép hozzáférése nem engedélyezett. Ellenőrizd a térkép beállítását.");
    if (!settled) finish(error);
    else {
      // A resolved promise cannot be rejected. Invalidate the shared success
      // and notify mounted canvases instead; retry must fetch a new script.
      window.__alinflowGoogleMapsFailedNamespace = window.google?.maps;
      delete window.__alinflowGoogleMapsLoader;
      script?.remove();
      if (window.gm_authFailure === authFailure) {
        if (previousAuthFailure) window.gm_authFailure = previousAuthFailure;
        else delete window.gm_authFailure;
      }
    }
    notifyAuthFailure(error);
    // Preserve an existing app-level error listener without allowing a second
    // listener's exception (or provider message containing the key) to escape.
    try { previousAuthFailure?.call(window); } catch { /* The promise carries our own safe error. */ }
  }

  globals[callbackName] = ready;
  window.gm_authFailure = authFailure;
  timer = window.setTimeout(() => finish(new Error("A Google térkép betöltése túl sokáig tartott. Próbáld újra.")), LOAD_TIMEOUT_MS);
  try {
    // This id belongs to AlinFlow. With no live loader state and no ready API,
    // an old element is orphaned/failed and must not prevent a fresh attempt.
    document.getElementById(SCRIPT_ID)?.remove();
    script = document.createElement("script");
    script.id = SCRIPT_ID;
    script.async = true;
    script.defer = true;
    const url = new URL("https://maps.googleapis.com/maps/api/js");
    url.searchParams.set("key", apiKey.trim());
    url.searchParams.set("loading", "async");
    url.searchParams.set("callback", callbackName);
    url.searchParams.set("language", "hu");
    url.searchParams.set("region", "HU");
    url.searchParams.set("v", "weekly");
    script.src = url.toString();
    script.onerror = () => finish(new Error("Nem sikerült betölteni a Google térképet. Próbáld újra."));
    document.head.appendChild(script);
  } catch {
    finish(new Error("Nem sikerült betölteni a Google térképet. Próbáld újra."));
  }
  return promise;
}
