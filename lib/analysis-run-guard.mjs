// A scientific run owns its original project and exact relevant input snapshot.
// The store epoch catches imports/restores, including replacement with the same
// name. Unrelated updates (such as a rename) need not cancel a valid result.
export function analysisRunGuard(read, snapshot, generation = null) {
  const project = read().project, epoch = generation?.(), inputs = snapshot(read());
  const belongs = () => generation ? generation() === epoch : read().project === project;
  return { project, inputs, belongs, reason() {
    if (!belongs()) return 'Project replaced. This run was not saved.';
    try { if (snapshot(read()) !== inputs) return 'Inputs changed during this run. Run again; this result was not saved.'; }
    catch { return 'Inputs are no longer available. This run was not saved.'; }
    return '';
  } };
}
