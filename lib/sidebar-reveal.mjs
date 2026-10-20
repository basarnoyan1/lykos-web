// Hover intent and dismissal stay separate from the shell's layout updates.
export function createSidebarReveal({eligible,held,onChange,reducedMotion=()=>false,openDelay=180,closeDelay=220,motionMs=160,setTimer=setTimeout,clearTimer=clearTimeout,frame=requestAnimationFrame,cancelFrame=cancelAnimationFrame}) {
  let phase='closed',openTimer=null,closeTimer=null,frames=[];
  const timers=()=>{clearTimer(openTimer);clearTimer(closeTimer);openTimer=closeTimer=null;};
  const cancelFrames=()=>{frames.forEach(cancelFrame);frames=[];};
  const change=next=>{if(phase!==next){phase=next;onChange(next);}};
  const open=()=>{
    timers();if(!eligible()){cancelFrames();change('closed');return;}
    // Keyboard focus can arrive while pointer intent is still animating.
    // Preserve those frames or the reveal remains clipped at its first frame.
    if(phase==='open'||phase==='opening')return;
    cancelFrames();
    if(phase==='closing'||reducedMotion()){change('open');return;}
    change('opening');
    frames.push(frame(()=>{frames.push(frame(()=>{frames=[];if(phase==='opening'&&eligible())change('open');else if(!eligible())change('closed');}));}));
  };
  const close=()=>{timers();cancelFrames();change('closed');};
  const enter=(pointerType='mouse')=>{timers();if(pointerType==='touch'||!eligible())return;if(phase!=='closed'){if(phase==='closing')open();return;}openTimer=setTimer(open,openDelay);};
  const leave=()=>{timers();if(phase==='closed')return;closeTimer=setTimer(()=>{closeTimer=null;if(held())return;cancelFrames();if(reducedMotion()){change('closed');return;}change('closing');closeTimer=setTimer(()=>{closeTimer=null;change('closed');},motionMs);},closeDelay);};
  return {enter,leave,focus:open,close,phase:()=>phase,dispose:close};
}
