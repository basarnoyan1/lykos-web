// The model that reads a note for tasks. The Overview shows it in its setup rows, so it lives apart from the Tasks page, which loads on first use.
import { modelFor } from '../lib/model-settings.mjs';
import { configured, isJev } from '../lib/ai.mjs';

export const readModel = () => {
  const j = modelFor('decide'); if (j && isJev(j) && configured(j)) return j;
  const a = modelFor('tasks'); return configured(a) ? a : null;
};
