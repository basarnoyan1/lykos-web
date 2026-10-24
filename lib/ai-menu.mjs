// Menu requests are editable drafts; choosing one never starts an unrelated run.
export function creationRequests(context={}) {
  const focus=context.focus?.label ? ` using ${context.focus.label}` : ` using this ${context.viewTitle||'project'}`;
  return [
    {label:'Custom table…',icon:'table',text:`Create a custom table${focus}. Use actual project data and prepare a preview. The table should show: `},
    {label:'Custom graph…',icon:'curve',text:`Create a custom graph${focus}. Use actual project data and prepare a preview. Plot: `},
    {label:'Document…',icon:'manuscript',text:`Create a downloadable document${focus}. Include sources and label missing information. I need: `},
    {label:'File…',icon:'file',text:`Create a file in the project folder${focus}. Propose the file for review. File name, format and content: `},
    {label:'Workflow…',icon:'workflow',text:`Create a workflow${focus}. Configure the needed steps and models, and propose it for review. It should: `},
  ];
}
