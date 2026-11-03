'use strict';
// Shared gamepad and keyboard navigation. No native input hooks or extra dependencies.
(function () {
const ACTIONS={0:'confirm',1:'back',2:'settings',3:'tasks',4:'pageUp',5:'pageDown',8:'tasks',9:'settings'};
const standardPad=pad=>pad&&pad.connected!==false&&(pad.mapping==='standard'||/xbox|xinput|steam virtual/i.test(pad.id||''));
class PadInput {
 constructor(){this.previous=null;this.direction=null;this.nextRepeat=0;this.lastTime=null;}
 reset(){this.previous=null;this.direction=null;this.lastTime=null;}
 read(pad,now){
  if(!standardPad(pad)){this.reset();return [];}
  const down=i=>Boolean(pad.buttons?.[i]?.pressed||pad.buttons?.[i]?.value>.6);
  const buttons=Array.from({length:16},(_,i)=>down(i));
  const x=Number(pad.axes?.[0])||0,y=Number(pad.axes?.[1])||0;
  const threshold=this.direction ? .38 : .55;
  let dir=down(12)?'moveUp':down(13)?'moveDown':down(14)?'moveLeft':down(15)?'moveRight':null;
  if(!dir&&Math.max(Math.abs(x),Math.abs(y))>threshold)dir=Math.abs(x)>Math.abs(y)?(x<0?'moveLeft':'moveRight'):(y<0?'moveUp':'moveDown');
  const events=[];
  // Suppress held buttons after attach/resume; release before accepting a new press.
  if(this.previous){
   for(const [index,action]of Object.entries(ACTIONS))if(buttons[index]&&!this.previous[index])events.push({action});
   if(dir&&(dir!==this.direction||now>=this.nextRepeat)){events.push({action:dir});this.nextRepeat=now+(dir===this.direction?120:400);}
   const scroll=Number(pad.axes?.[3])||0;
   if(Math.abs(scroll)>.35)events.push({action:'scroll',amount:scroll*Math.min(50,Math.max(0,now-this.lastTime))*.65});
  }
  this.previous=buttons;this.direction=dir;this.lastTime=now;
  return events;
 }
}
// Rank by distance between facing edges and alignment, so grids follow their rows.
function directionalTarget(items,current,direction){
 if(!current)return items[0]||null;
 const horizontal=direction==='left'||direction==='right',sign=['left','up'].includes(direction)?-1:1;
 const center=r=>({x:r.left+r.width/2,y:r.top+r.height/2});
 const from=center(current.rect);let best=null,score=Infinity;
 for(const item of items){
  if(item===current||item.element===current.element)continue;
  const to=center(item.rect),primary=(horizontal?to.x-from.x:to.y-from.y)*sign;
  if(primary<=2)continue;
  const cross=Math.abs(horizontal?to.y-from.y:to.x-from.x);
  const a=current.rect,b=item.rect;
  const overlap=horizontal?Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top):Math.min(a.right,b.right)-Math.max(a.left,b.left);
  const distance=primary+cross*2+(overlap>0?0:1000);
  if(distance<score){score=distance;best=item;}
 }
 return best;
}
if(typeof module!=='undefined')module.exports={PadInput,directionalTarget};
if(typeof document==='undefined')return;
const $=id=>document.getElementById(id),selector='button,input:not([type=hidden]),textarea,select,summary,a[href],[tabindex="0"]';
const root=document.documentElement,readers=new Map(),remember=new Map();
let enabled=false,editing=false,currentContext=null,refreshQueued=false,modalHints=null;
const hints=document.createElement('footer');hints.id='controllerHints';hints.className='controller-hints';hints.hidden=true;hints.setAttribute('aria-label','Controller controls');
document.querySelector('.shell').append(hints);
function topDialog(){return [...document.querySelectorAll('dialog[open]')].at(-1)||null;}
function context(){return topDialog()||(!$('settingsPage').hidden?$('settingsPage'):!$('dashboard').hidden?$('dashboard'):$('pairing'));}
function visible(el){return el instanceof HTMLElement&&!el.hidden&&!el.matches(':disabled,[aria-disabled="true"]')&&!el.closest('[hidden],[inert]')&&el.getClientRects().length>0&&getComputedStyle(el).visibility!=='hidden';}
function candidates(){return [...(topDialog()||document.body).querySelectorAll(selector)].filter(el=>visible(el)&&el.tabIndex>=0);}
function key(el){return el?.dataset.controllerKey||el?.id||null;}
function words(){return root.lang==='en'?{move:'Move',confirm:'Select / Apply',back:'Back',settings:'Settings',tasks:'Tasks',scroll:'Scroll',keyboard:'STEAM + X · Keyboard'}:{move:'移動',confirm:'確認 / 套用',back:'返回',settings:'設定',tasks:'任務',scroll:'捲動',keyboard:'STEAM + X · 鍵盤'};}
function updateHints(){
 const t=words(),parts=[['↔',t.move],['A',t.confirm],['B',t.back],['X',t.settings],['Y',t.tasks],['RS',t.scroll]];
 const label=editing?t.keyboard:parts.map(([button,text])=>`${button} ${text}`).join(' · ');
 if(hints.dataset.label===label)return;hints.dataset.label=label;hints.replaceChildren();
 if(editing){hints.textContent=label;return;}
 for(const [button,text]of parts){const span=document.createElement('span'),kbd=document.createElement('kbd');kbd.textContent=button;span.append(kbd,document.createTextNode(text));hints.append(span);}
}
function focus(el){
 if(!el||!visible(el))return;
 document.querySelector('[data-controller-focus]')?.removeAttribute('data-controller-focus');
 el.setAttribute('data-controller-focus','');el.focus({preventScroll:true});
 // Scroll only the pane containing the control; retain the fixed header and footer.
 el.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
 remember.set(context(),{element:el,key:key(el)});
}
function preferred(){const list=candidates();return topDialog()?list.find(el=>el.tagName==='BUTTON')||list[0]:!$('settingsPage').hidden?$('settingsPage').querySelector('.style-card[aria-pressed="true"]')||list[0]:visible($('settingsButton'))?$('settingsButton'):list[0];}
function syncModalHints(){
 const dialog=topDialog();
 if(modalHints&&modalHints.parentElement!==dialog){modalHints.remove();modalHints=null;}
 if(dialog&&!modalHints){modalHints=hints.cloneNode(true);modalHints.removeAttribute('id');modalHints.removeAttribute('aria-label');dialog.append(modalHints);}
 if(modalHints&&modalHints.dataset.label!==hints.dataset.label){modalHints.replaceChildren(...[...hints.childNodes].map(n=>n.cloneNode(true)));modalHints.dataset.label=hints.dataset.label;}
}
function sync(){
 if(!enabled)return;
 const next=context(),list=candidates();
 if(next!==currentContext){
  currentContext=next;editing=false;
  const saved=remember.get(next),restore=list.includes(saved?.element)?saved.element:saved?.key?list.find(el=>key(el)===saved.key):null;
  focus(restore||preferred());
 }else if(!list.includes(document.activeElement)){
  const saved=remember.get(next),nearby=saved?.element?.parentElement;focus(list.find(el=>key(el)&&key(el)===saved?.key)||list.find(el=>nearby&&nearby!==document.body&&nearby.contains(el))||preferred());
 }else if(!document.activeElement.hasAttribute('data-controller-focus'))focus(document.activeElement);
 updateHints();syncModalHints();
}
function queueSync(){if(refreshQueued)return;refreshQueued=true;queueMicrotask(()=>{refreshQueued=false;sync();});}
function enable(){if(!enabled){enabled=true;root.classList.add('controller-mode');hints.hidden=false;sync();}return enabled;}
function scroll(amount){
 let pane=document.activeElement;
 while(pane&&pane!==document.body){if(pane.scrollHeight>pane.clientHeight+2&&/auto|scroll/.test(getComputedStyle(pane).overflowY)){pane.scrollBy({top:amount,behavior:'instant'});return;}pane=pane.parentElement;}
 const modal=topDialog();if(modal){modal.scrollBy({top:amount,behavior:'instant'});return;}
 if(!$('settingsPage').hidden)$('settingsPage').scrollBy({top:amount,behavior:'instant'});else window.scrollBy({top:amount,behavior:'instant'});
}
function back(){
 if(editing){editing=false;updateHints();return;}
 const dialog=topDialog();
 if(dialog){dialog.close();queueSync();return;}
 if(!$('settingsPage').hidden)$('backSettings').click();
}
function action(name,amount){
 enable();sync();
 if(name==='back'){back();return;}
 if(name==='settings'||name==='tasks'){
  if(topDialog())return;
  const button=$(name==='settings'?'settingsButton':'tasksButton');
  if(!button.disabled&&(visible(button)||(name==='tasks'&&$('pairing').hidden)))button.click();queueSync();return;
 }
 if(name==='scroll'){scroll(amount);return;}
 if(name==='pageUp'||name==='pageDown'){scroll((name==='pageUp'?-1:1)*Math.min(480,innerHeight*.6));return;}
 if(name.startsWith('move')){
  if(editing)return;
  const list=candidates().map(element=>({element,rect:element.getBoundingClientRect()}));
  const next=directionalTarget(list,list.find(item=>item.element===document.activeElement),name.slice(4).toLowerCase());
  if(next)focus(next.element);else if(name==='moveDown'||name==='moveUp')scroll(name==='moveDown'?90:-90);
  return;
 }
 if(name==='confirm'){
  const el=document.activeElement;if(!candidates().includes(el))return;
  if(el.matches('input:not([type=checkbox]):not([type=radio]),textarea,select')){editing=!el.readOnly;el.focus();if(el.select)el.select();updateHints();return;}
  el.click();queueSync();
 }
}
document.addEventListener('focusin',event=>{
 const el=event.target;if(!visible(el)||!el.matches(selector))return;
 remember.set(context(),{element:el,key:key(el)});if(!enabled)return;
 document.querySelector('[data-controller-focus]')?.removeAttribute('data-controller-focus');el.setAttribute('data-controller-focus','');
});
document.addEventListener('keydown',event=>{
 if(event.altKey||event.ctrlKey||event.metaKey||event.isComposing)return;
 const text=event.target.matches?.('input:not([type=checkbox]):not([type=radio]),textarea,select')&&!event.target.readOnly;
 const map={ArrowUp:'moveUp',ArrowDown:'moveDown',ArrowLeft:'moveLeft',ArrowRight:'moveRight',w:'moveUp',s:'moveDown',a:'moveLeft',d:'moveRight',Enter:'confirm',' ':'confirm',Escape:'back',Backspace:'back',x:'settings',y:'tasks',PageUp:'pageUp',PageDown:'pageDown'};
 const name=map[event.key];if(!name)return;
 if(text&&event.key!=='Escape')return;
 // OS key repeat is valid for navigation, but never repeatedly applies/toggles controls.
 event.preventDefault();event.stopImmediatePropagation();if(event.repeat&&!name.startsWith('move')&&!name.startsWith('page'))return;
 action(name);
},true);
document.addEventListener('pointerdown',()=>{enabled=false;editing=false;root.classList.remove('controller-mode');hints.hidden=true;modalHints?.remove();modalHints=null;document.querySelector('[data-controller-focus]')?.removeAttribute('data-controller-focus');},{capture:true});
document.addEventListener('cancel',event=>{if(enabled){event.preventDefault();back();}},{capture:true});
new MutationObserver(queueSync).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['hidden','open','disabled']});
new MutationObserver(updateHints).observe(root,{attributes:true,attributeFilter:['lang']});
function reset(){for(const reader of readers.values())reader.reset();editing=false;}
window.addEventListener('blur',reset);document.addEventListener('visibilitychange',reset);
window.addEventListener('gamepaddisconnected',event=>readers.delete(event.gamepad.index));
let frame=null,wake=null;
function startPolling(){clearTimeout(wake);wake=null;if(frame===null)frame=requestAnimationFrame(poll);}
window.addEventListener('gamepadconnected',event=>{if(standardPad(event.gamepad))enable();startPolling();});window.addEventListener('focus',startPolling);
function poll(now){
 frame=null;let present=false;
 if(!document.hidden&&document.hasFocus()){
  let pads=[];try{pads=navigator.getGamepads?.()||[];}catch{}
  for(const pad of pads){if(!standardPad(pad))continue;present=true;if(!readers.has(pad.index)){readers.set(pad.index,new PadInput());enable();}
   const events=readers.get(pad.index).read(pad,now);for(const event of events)action(event.action,event.amount);
   if(events.length)break;
  }
 }
 // Idle views don't spend every animation frame polling for absent controllers.
 if(present)frame=requestAnimationFrame(poll);else wake=setTimeout(startPolling,1000);
}
startPolling();
})();
