import React from "react";
import ReactDOM from "react-dom/client";
import "antd/dist/reset.css";
import "@assistant-ui/react-ui/styles/index.css";
import "@assistant-ui/react-ui/styles/markdown.css";
import "katex/dist/katex.min.css";

import App from "./App";
import { installBuildVersionRefreshMonitor } from "./lib/build-version-refresh";
import { installStaleDynamicImportReloadHandler } from "./lib/stale-chunk-reload";
import "./styles.css";

installStaleDynamicImportReloadHandler();
installBuildVersionRefreshMonitor();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
