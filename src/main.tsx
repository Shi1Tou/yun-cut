import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { getPreferredTheme } from "./lib/utils";

document.documentElement.dataset.theme = getPreferredTheme();
createRoot(document.getElementById("root")!).render(<App />);
