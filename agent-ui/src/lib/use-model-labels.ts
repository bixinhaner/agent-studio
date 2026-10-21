import { useEffect, useState } from "react";

import { api } from "./api";
import { modelLabelFor, modelOptionsFromCatalog, type ModelOption, type RuntimeModelCatalog } from "./model-config";

// One catalog request per page load is enough: labels change only when an admin edits the provider.
let cachedOptions: Promise<ModelOption[]> | undefined;

function loadModelOptions(): Promise<ModelOption[]> {
  cachedOptions ??= api<RuntimeModelCatalog>("/api/admin/model-catalog")
    .then((catalog) => modelOptionsFromCatalog(catalog))
    .catch(() => {
      cachedOptions = undefined;
      return [];
    });
  return cachedOptions;
}

/**
 * Display names for model IDs in admin views (e.g. deepseek-flash → DeepSeek-V4.1-Flash-1017), following
 * the provider's display-name settings. Until the catalog loads, or if it cannot, the ID itself is shown.
 */
export function useModelLabel(): (model: string | null | undefined) => string {
  const [options, setOptions] = useState<ModelOption[] | undefined>();
  useEffect(() => {
    let active = true;
    void loadModelOptions().then((next) => {
      if (active) setOptions(next);
    });
    return () => {
      active = false;
    };
  }, []);
  return (model) => {
    const id = String(model ?? "").trim();
    if (!id || !options) return id;
    return modelLabelFor(id, options);
  };
}
