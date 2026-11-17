// Railway — progetto creative-system (account T&C): server del mattino e sito cs.pngs.it.
// Le variabili (chiavi) non stanno qui: si impostano su Railway (variables: managed false).
// Programmazione in UTC alle 3 e alle 4: lo script parte solo se a Roma sono le 5 (--solo-ora 5 nel Dockerfile),
// così vale sia con l'ora solare sia con quella legale. Europa (ams): vicino a Supabase.
// Modifiche: railway config plan, poi railway config apply (da questa cartella; serve npm install).
import { defineRailway, github, project, service, volume } from "railway/iac";

export default defineRailway(() => {
  // Libreria DTF (circa 340 MB) e cartella del giorno finché non è caricata nel gestionale
  const dati = volume("mattino-dati", {
    alerts: { usage: { "80": {}, "95": {}, "100": {} } },
    allowOnlineResize: true,
    region: "ams",
    sizeMB: 5000,
  });
  const mattino = service("mattino", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    deploy: { cronSchedule: "0 3,4 * * *", restartPolicyType: "NEVER" },
    replicas: { ams: 1 },
    volumeMounts: { "/data": dati },
  });

  // Sito: dal repository (ogni push su main), solo se cambiano i file del sito (sito/Dockerfile)
  const sito = service("sito", {
    source: github("tc-system/creative-system", { branch: "main", checkSuites: false }),
    build: {
      builder: "DOCKERFILE",
      dockerfilePath: "sito/Dockerfile",
      watchPatterns: ["index.html", "dashboard.html", "privacy.html", "cliente-dtf.html", "css/**", "js/**", "img/**", "sito/**"],
    },
    deploy: { restartPolicyType: "ON_FAILURE" },
    replicas: { ams: 1 },
  });

  return project("creative-system", {
    variables: { managed: false },
    resources: [mattino, dati, sito],
  });
});
