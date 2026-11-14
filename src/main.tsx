import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// GitHub Pages replaces hashed assets on each deployment. An already-open PWA
// can therefore request a lazy chunk from its previous build and receive 404.
// Recover once by navigating to a cache-busted app URL instead of leaving a
// blank screen when a settings section is opened.
const chunkRecoveryKey = "church-finances:chunk-recovery-at";
const recoverFromStaleChunk = () => {
  const now = Date.now();
  const previousAttempt = Number(sessionStorage.getItem(chunkRecoveryKey) || 0);
  if (now - previousAttempt < 15_000) return;

  sessionStorage.setItem(chunkRecoveryKey, String(now));
  const url = new URL(window.location.href);
  url.searchParams.set("app-update", String(now));
  window.location.replace(url.toString());
};

window.addEventListener("unhandledrejection", (event) => {
  const message = String(event.reason?.message || event.reason || "");
  if (/dynamically imported module|importing a module script|loading chunk/i.test(message)) {
    event.preventDefault();
    recoverFromStaleChunk();
  }
});

window.addEventListener("error", (event) => {
  const target = event.target;
  const isMissingAsset = target instanceof HTMLScriptElement && target.src.includes("/assets/");
  if (isMissingAsset) recoverFromStaleChunk();
}, true);

// Register the worker before authentication starts. Previously the worker was
// installed only from the notifications hook, after a user session existed.
// On iOS that made an installed app behave like a regular, uncached tab until
// the user had successfully signed in once.
if ("serviceWorker" in navigator) {
  const basePath = import.meta.env.BASE_URL || "/";
  const workerUrl = new URL(`${basePath.replace(/\/$/, "")}/sw.js`, window.location.origin).toString();

  void navigator.serviceWorker
    .register(workerUrl, { scope: basePath, updateViaCache: "none" })
    // GitHub Pages sends a short HTTP cache lifetime. Asking for an update on
    // every launch keeps an installed iPhone app from staying on an old worker.
    .then((registration) => registration.update())
    // A worker is an enhancement: do not prevent the web app from opening if
    // private browsing or a browser policy blocks its registration.
    .catch(() => undefined);
}

// An earlier Workbox version cached tokenized public routes (for example
// /protocols/<token>).  Only remove its old caches: the current sw.js also
// delivers push notifications, so it must remain registered.
if ("caches" in window) {
  void caches
    .keys()
    .then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("workbox-") || key.startsWith("church-app-"))
          .map((key) => caches.delete(key)),
      ),
    );
}

createRoot(document.getElementById("root")!).render(<App />);
