import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Workbox cached tokenized public routes (for example /protocols/<token>),
// which could leave the installed app without a network response.  Remove the
// legacy worker and its caches once this version is loaded.
if ("serviceWorker" in navigator) {
  void navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())));
}

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
