// Platform-aware fetch. In the packaged Tauri desktop app, route HTTP through
// the Tauri http plugin (the request runs in Rust), so calls to a local LLM
// like Ollama are not blocked by browser CORS. In a normal browser, fall back
// to window.fetch.
//
// The dynamic import is marked @vite-ignore so the plain web build never needs
// the Tauri packages installed; it is resolved at runtime only under Tauri.

let tauriFetchPromise = null;

function isTauri() {
  return typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__;
}

async function tauriFetch() {
  if (!tauriFetchPromise) {
    tauriFetchPromise = import(/* @vite-ignore */ '@tauri-apps/plugin-http').then((m) => m.fetch);
  }
  return tauriFetchPromise;
}

/**
 * fetch() with the same signature; uses the Tauri http plugin when running in
 * the desktop app, otherwise the browser fetch.
 */
export async function platformFetch(url, opts) {
  if (isTauri()) {
    const f = await tauriFetch();
    return f(url, opts);
  }
  return fetch(url, opts);
}
