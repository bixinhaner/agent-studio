import React from "react";
import ReactDOM from "react-dom/client";
import "antd/dist/reset.css";
import "@assistant-ui/react-ui/styles/index.css";
import "@assistant-ui/react-ui/styles/markdown.css";
import "katex/dist/katex.min.css";

import App from "./App";
import { isSafariBrowser } from "./lib/browser-compat";
import { installBuildVersionRefreshMonitor } from "./lib/build-version-refresh";
import { installStaleDynamicImportReloadHandler } from "./lib/stale-chunk-reload";
import "./styles.css";

document.documentElement.classList.toggle("browser-safari", isSafariBrowser());

installStaleDynamicImportReloadHandler();
installBuildVersionRefreshMonitor();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
