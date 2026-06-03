// Client entry point: mount the React app and pull in the global stylesheet
// (Bun bundles the CSS import at request time).
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

const el = document.getElementById("root");
if (el) createRoot(el).render(<App />);
