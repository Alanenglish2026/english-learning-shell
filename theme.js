(()=>{
  const KEY='english_theme_mode';
  const MODES=['system','light','dark'];
  const mq=globalThis.matchMedia?.('(prefers-color-scheme: dark)');
  const read=()=>{try{const v=localStorage.getItem(KEY);return MODES.includes(v)?v:'system';}catch{return 'system';}};
  const effective=mode=>mode==='system'?(mq?.matches?'dark':'light'):mode;
  const label={system:'跟随系统',light:'浅色',dark:'深色'};
  function apply(mode=read()){
    if(!MODES.includes(mode))mode='system';
    const html=document.documentElement;
    if(mode==='system')delete html.dataset.theme;else html.dataset.theme=mode;
    const eff=effective(mode);
    html.style.colorScheme=eff;
    const metas=[...document.querySelectorAll('meta[name="theme-color"]')];
    const light=metas.find(m=>m.dataset.themeColor==='light'),dark=metas.find(m=>m.dataset.themeColor==='dark');
    if(light||dark){
      if(mode==='system'){
        if(light)light.media='(prefers-color-scheme: light)';
        if(dark)dark.media='(prefers-color-scheme: dark)';
      }else{
        if(light)light.media=eff==='light'?'all':'not all';
        if(dark)dark.media=eff==='dark'?'all':'not all';
      }
    }else if(metas[0]){
      metas[0].setAttribute('content',eff==='dark'?'#0f1720':'#eef2f6');
    }
    html.style.backgroundColor=eff==='dark'?'#0f1720':'#eef2f6';
    const b=document.getElementById('theme-toggle');
    if(b){b.textContent='主题：'+label[mode];b.dataset.mode=mode;b.setAttribute('aria-label','主题设置，当前'+label[mode]);}
    return mode;
  }
  function set(mode){
    if(!MODES.includes(mode))mode='system';
    try{localStorage.setItem(KEY,mode);}catch{}
    return apply(mode);
  }
  function next(){const cur=read(),idx=MODES.indexOf(cur);return set(MODES[(idx+1)%MODES.length]);}
  globalThis.EnglishTheme={read,set,next,apply};
  apply();
  mq?.addEventListener?.('change',()=>{if(read()==='system')apply('system');});
  document.addEventListener('DOMContentLoaded',()=>{
    const b=document.getElementById('theme-toggle');
    if(b){apply(read());b.addEventListener('click',next);}
  },{once:true});
})();
