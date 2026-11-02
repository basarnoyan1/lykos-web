export function cronFields(expression) {
  const parts=String(expression).trim().split(/\s+/);if(parts.length!==5)throw new Error('Use five cron fields: minute hour day month weekday.');
  return parts.map((part,i)=>{const [min,max]=[[0,59],[0,23],[1,31],[1,12],[0,6]][i], values=new Set();
    for(const segment of part.split(',')){const match=segment.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);if(!match)throw new Error('Invalid cron field.');const step=Number(match[2]||1);if(step<1||step>max-min+1)throw new Error('Invalid cron step.');
      // Weekday 7 is Sunday, as in standard cron.
      const top=i===4?7:max, range=match[1]==='*'?[min,max]:match[1].split('-').map(Number);if(range.length===1)range.push(match[2]?max:range[0]);if(range[0]<min||range[1]>top||range[0]>range[1])throw new Error('Cron value is out of range.');for(let n=range[0];n<=range[1];n+=step)values.add(i===4?n%7:n);
    }return {values,any:part.startsWith('*')};
  });
}
export function cronMatches(expression,date=new Date()) {
  const f=cronFields(expression),v=[date.getMinutes(),date.getHours(),date.getDate(),date.getMonth()+1,date.getDay()];
  const day=f[2].values.has(v[2]),week=f[4].values.has(v[4]);return [0,1,3].every(i=>f[i].values.has(v[i]))&&(f[2].any||f[4].any?day&&week:day||week);
}
/** Coalesce missed occurrences into one run; never replay a backlog of writes. */
export function dueCronSlot(flow, now = new Date()) {
  const slot = Math.floor(now.getTime() / 60000), previous = Number(flow.scheduleCheckedSlot);
  if (cronMatches(flow.cron, now)) return flow.lastSlot === slot ? null : slot;
  if (flow.catchUp !== 'latest' || !Number.isInteger(previous) || previous >= slot) return null;
  const fields = cronFields(flow.cron), oldest = Math.max(previous + 1, slot - 7 * 1440);
  for (let at = slot - 1; at >= oldest; at--) {
    const d = new Date(at * 60000), day = fields[2].values.has(d.getDate()), week = fields[4].values.has(d.getDay());
    if (fields[0].values.has(d.getMinutes()) && fields[1].values.has(d.getHours()) && fields[3].values.has(d.getMonth()+1) && (fields[2].any || fields[4].any ? day && week : day || week)) return flow.lastSlot === at ? null : at;
  }
  return null;
}
// Walk matching local days, then real minutes so daylight-saving transitions agree with execution.
export function nextCronDates(expression,after=new Date(),count=3) {
  const fields=cronFields(expression), dates=[],day=new Date(after);day.setHours(0,0,0,0);
  for(let d=0;d<366*8&&dates.length<count;d++) {
    const end=new Date(day);end.setDate(end.getDate()+1);
    const dateMatches=fields[2].values.has(day.getDate()),weekMatches=fields[4].values.has(day.getDay());
    if(fields[3].values.has(day.getMonth()+1)&&(fields[2].any||fields[4].any?dateMatches&&weekMatches:dateMatches||weekMatches)) {
      for(let t=day.getTime();t<end.getTime()&&dates.length<count;t+=60000){if(t<=after.getTime())continue;const date=new Date(t);if(fields[0].values.has(date.getMinutes())&&fields[1].values.has(date.getHours()))dates.push(date);}
    }
    day.setTime(end.getTime());
  }
  return dates;
}
