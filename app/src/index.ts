import express from "express";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { logEvent } from "./db.js";
import { attachDeviceHub } from "./devicehub.js";
import { publicRouter } from "./routes/public.js";
import { adminRouter } from "./routes/admin.js";
import { tick } from "./sessions.js";

const here = dirname(fileURLToPath(import.meta.url));
const webDist = [resolve(here, "../web-dist"), resolve(here, "../../web-dist")].find(existsSync);

// ---- Offentlig app (Funnel /kodelader -> 8096) ----
const pub = express();
pub.use(express.json());
// Funnel kan levere forespørsler både med og uten /kodelader-prefiks — støtt begge.
pub.use((req, _res, next) => {
  if (req.url === "/kodelader") req.url = "/";
  else if (req.url.startsWith("/kodelader/")) req.url = req.url.slice("/kodelader".length);
  next();
});
pub.use(publicRouter);
if (webDist) {
  pub.use(express.static(webDist, { index: "index.html" }));
} else {
  pub.get("/", (_req, res) => res.send("kodelader: web-dist mangler (kjør npm run build)"));
}

const pubServer = createServer(pub);
// Shelly outbound WS — både med og uten /kodelader-prefiks, avhengig av Funnel-oppførsel
attachDeviceHub(pubServer, ["/ws", "/kodelader/ws"]);
pubServer.listen(config.publicPort, () => {
  logEvent("app", `Offentlig app lytter på :${config.publicPort} (${config.baseUrl})`);
});

// ---- Admin-app (kun tailnett -> 8097) ----
const admin = express();
admin.use(express.json());
admin.use(adminRouter);
if (webDist) {
  admin.use(express.static(webDist, { index: "admin.html" }));
  admin.get("/", (_req, res) => res.sendFile(resolve(webDist, "admin.html")));
}
admin.listen(config.adminPort, () => {
  logEvent("app", `Admin lytter på :${config.adminPort} (kun tailnett)`);
});

// ---- Øktovervåking ----
setInterval(() => {
  tick().catch((err) => logEvent("tick-feil", err.message));
}, 15_000);

logEvent("app", `Kodelader startet — miljø: ${config.isLive() ? "SKARP" : "SANDKASSE"}`);
