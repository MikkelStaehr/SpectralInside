import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Inter, bundtet med applikationen og ikke hentet fra et CDN. Skærmen kører på
// en maskine i produktionen, som ikke nødvendigvis har internet, og en font,
// der ikke kommer, giver et layout, der hopper.
import "@fontsource-variable/inter";
import App from "./App";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Fandt ikke #root i index.html");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
