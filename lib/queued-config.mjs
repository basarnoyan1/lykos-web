// Serialize independent patches against the most recently committed config.
// A failed write does not poison the queue or make subsequent edits disappear.
export function configQueue(read, write) {
  let tail = Promise.resolve();
  return patch => {
    const frozen = structuredClone(patch);
    const next = tail.catch(() => {}).then(async () => {
      const config = { ...await read(), ...frozen };
      await write(config); return config;
    });
    tail = next; return next;
  };
}
