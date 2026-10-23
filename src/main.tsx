import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

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
