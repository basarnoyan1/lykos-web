// The model that reads a note for tasks. The Overview shows it in its setup rows, so it lives apart from the Tasks page, which loads on first use.
import { lib_model_settings$modelFor as modelFor } from "../boot.mjs";
import { lib_ai_profile$configured as configured, lib_ai_profile$isJev as isJev } from "../boot.mjs";

export const readModel = () => {
  const j = modelFor('decide'); if (j && isJev(j) && configured(j)) return j;
  const a = modelFor('tasks'); return configured(a) ? a : null;
};
