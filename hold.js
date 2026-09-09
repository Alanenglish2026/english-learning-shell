// Shared mouse/touch lifecycle, independently testable without a microphone.
export class HoldController {
  constructor(start,stop,label,mode='hold'){Object.assign(this,{start,stop,label,mode,state:'idle',down:false});}
  async press(){
    if(this.mode==='tap'&&this.state==='recording')return this.finish();
    if(this.state!=='idle')return;
    this.down=true;this.state='starting';this.label('正在准备');
    try{await this.start();this.state='recording';if(!this.down)this.mode='tap';this.label(this.mode==='tap'?'点一下结束':'松开结束');}
    catch(e){this.state='idle';this.down=false;throw e;}
  }
  async release(){this.down=false;if(this.mode==='hold'&&this.state==='recording')return this.finish();}
  async finish(){if(this.state!=='recording')return;this.state='saving';this.down=false;this.label('正在保存');await this.stop();}
  async cancel(){this.down=false;if(this.state==='recording')return this.finish();this.mode='tap';}
}
export function bindHold(button,{start,stop,onError,mode='hold',onAction=()=>{}}){
  const c=new HoldController(start,stop,t=>button.textContent=t,mode);
  const run=p=>Promise.resolve(p).catch(onError);
  button.classList.add('hold');
  button.onpointerdown=e=>{if(e.button!==0&&e.pointerType==='mouse')return;e.preventDefault();button.setPointerCapture?.(e.pointerId);if(c.state==='idle')onAction();run(c.press());};
  button.onpointerup=e=>{e.preventDefault();run(c.release());};
  button.onpointercancel=()=>run(c.cancel());
  button.onlostpointercapture=()=>{if(c.down)run(c.cancel());};
  button.oncontextmenu=e=>e.preventDefault();
  button.onkeydown=e=>{if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();c.mode='tap';if(c.state==='idle')onAction();run(c.press());}};
  if(!('PointerEvent' in window)){c.mode='tap';button.onclick=()=>{if(c.state==='idle')onAction();run(c.press())};button.textContent='点一下开始';}
  return c;
}
