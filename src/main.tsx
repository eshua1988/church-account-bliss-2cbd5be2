import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

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
