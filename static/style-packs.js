'use strict';
// Declarative community packs: no markup, scripts, CSS strings, URLs or fonts.
(function () {
const KEY='deck-watch-style-v1', MAX=16384;
const layouts=['glass','terminal','lunar'], clocks=['digital','flip','analog'];
const paletteKeys=['background','surface','text','muted','accent'];
const presets=[
 {version:1,name:'Obsidian',author:'Deck Watch',layout:'glass',clock:'digital',palette:{background:'#050709',surface:'#0a1018',text:'#e5e9ef',muted:'#a3afc0',accent:'#00cde4'}},
 {version:1,name:'Terminal',author:'Deck Watch',layout:'terminal',clock:'flip',palette:{background:'#050b08',surface:'#0b1710',text:'#dcfce7',muted:'#a0bba9',accent:'#77eea2'}},
 {version:1,name:'Lunar',author:'Deck Watch',layout:'lunar',clock:'analog',palette:{background:'#090911',surface:'#161321',text:'#f5efff',muted:'#bab0cc',accent:'#c8afff'}}
];
function luminance(hex){const a=hex.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return a[0]*.2126+a[1]*.7152+a[2]*.0722;}
function contrast(a,b){const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
function validate(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('object');
 const keys=['version','name','author','layout','clock','palette'];
 if(Object.keys(input).some(k=>!keys.includes(k))||input.version!==1||!layouts.includes(input.layout)||!clocks.includes(input.clock))throw Error('schema');
 for(const k of ['name','author'])if(typeof input[k]!=='string'||!input[k].trim()||input[k].length>60||/[\x00-\x1f<>]/.test(input[k]))throw Error('label');
 const p=input.palette;if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).length!==5)throw Error('palette');
 for(const k of paletteKeys)if(!Object.hasOwn(p,k)||!/^#[0-9a-f]{6}$/i.test(p[k]))throw Error('color');
 for(const bg of [p.background,p.surface])for(const fg of [p.text,p.muted,p.accent])if(contrast(bg,fg)<4.5)throw Error('contrast');
 return {version:1,name:input.name.trim(),author:input.author.trim(),layout:input.layout,clock:input.clock,palette:Object.fromEntries(paletteKeys.map(k=>[k,p[k]]))};
}
function parse(text){if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX)throw Error('size');return validate(JSON.parse(text));}
if(typeof module!=='undefined')module.exports={validate,parse,presets,contrast};
if(typeof document==='undefined')return;
const $=id=>document.getElementById(id),root=document.documentElement;
let state={pack:presets[0],clock:'digital',custom:[]},candidate=null;
try{const s=JSON.parse(localStorage.getItem(KEY));if(s){state={pack:validate(s.pack),clock:clocks.includes(s.clock)?s.clock:'digital',custom:Array.isArray(s.custom)?s.custom.slice(0,12).map(validate):[]};}}catch{}
const words={
 en:{title:'Appearance studio',theme:'Interface',clock:'Clock face',hint:'Mix any interface with any clock. Saved on this device.',import:'Import style pack',export:'Export current style',reset:'Restore defaults',remove:'Remove imported styles',community:'Community packs',note:'Share a JSON pack through GitHub. Up to 12 imported styles; 16 KB per file.',apply:'Apply & save',cancel:'Cancel',preview:'Preview style pack',saved:'Style saved on this device.',bad:'Invalid pack. Use version 1, supported styles and readable hex colors (4.5:1 contrast).',size:'Choose a JSON file under 16 KB.',full:'Library full (12). Remove imported styles first.',storage:'Could not save. Previous style retained.',digital:'Signal · digital',flip:'Split · flip tiles',analog:'Orbit · analog',by:'By ',copy:'Copy JSON',copied:'JSON copied.',copyError:'Select and copy the JSON below.',exportTitle:'Share this style'},
 'zh-Hant':{title:'外觀工作室',theme:'介面風格',clock:'時鐘樣式',hint:'介面與時鐘可自由混搭，選擇會儲存在此裝置。',import:'匯入風格包',export:'匯出目前風格',reset:'還原預設',remove:'移除匯入風格',community:'社群風格包',note:'透過 GitHub 分享 JSON。最多收藏 12 款，每包上限 16 KB。',apply:'套用並儲存',cancel:'取消',preview:'預覽風格包',saved:'已儲存此裝置的風格。',bad:'風格包格式不符。請使用版本 1、支援的樣式與可讀的六碼色彩（對比 4.5:1）。',size:'請選擇小於 16 KB 的 JSON 檔。',full:'收藏已滿（12 款），請先移除匯入風格。',storage:'無法儲存，已保留原風格。',digital:'Signal · 數位',flip:'Split · 翻頁數字',analog:'Orbit · 指針',by:'作者：',copy:'複製 JSON',copied:'已複製 JSON。',copyError:'請選取下方 JSON 複製。',exportTitle:'分享此風格'}
};
const t=k=>(words[root.lang]||words['zh-Hant'])[k];
function el(tag,cls,text){const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;}
const section=el('section','style-studio glass');section.id='styleStudio';
const heading=el('h2'),hint=el('p','setting-hint'),themeTitle=el('h3'),themeGrid=el('div','style-grid'),clockTitle=el('h3'),clockGrid=el('div','style-grid'),communityTitle=el('h3'),note=el('p','setting-hint'),actions=el('div','style-actions'),status=el('p','setting-status');
status.setAttribute('role','status');
section.append(heading,hint,themeTitle,themeGrid,clockTitle,clockGrid,communityTitle,note,actions,status);
$('settingsPage').prepend(section);
const input=el('input');input.type='file';input.accept='.json,application/json';input.hidden=true;section.append(input);
const dialog=el('dialog','style-dialog'),dialogTitle=el('h2'),preview=el('div'),json=el('textarea'),dialogActions=el('div','style-actions'),dialogStatus=el('p','setting-status');
json.readOnly=true;json.rows=12;json.setAttribute('aria-label','Style pack JSON');dialogStatus.setAttribute('role','status');dialog.append(dialogTitle,preview,json,dialogActions,dialogStatus);document.body.append(dialog);
function button(text,fn){const b=el('button','',text);b.type='button';b.addEventListener('click',fn);return b;}
function paint(node,p){for(const [k,v]of Object.entries(p.palette))node.style.setProperty('--skin-'+k,v);node.dataset.skin=p.layout;}
function commit(next){try{const buttons=[...section.querySelectorAll('button')],index=buttons.indexOf(document.activeElement);localStorage.setItem(KEY,JSON.stringify(next));state=next;apply();render();if(index>=0)section.querySelectorAll('button')[index]?.focus();status.textContent=t('saved');return true;}catch{status.textContent=t('storage');return false;}}
function face(type,time='10:42'){
 const n=el('span','face-sample');n.dataset.face=type;
 if(type==='analog'){const c=el('canvas');c.width=120;c.height=120;c.setAttribute('aria-hidden','true');n.append(c);draw(c,'10:10','30','#c8afff','#f5efff');}
 else for(const part of time.split(':'))n.append(el('span','face-tile',part));
 return n;
}
function themeCard(pack,onClick){const b=button('',onClick);b.className='style-card';paint(b,pack);const demo=el('span','theme-sample');demo.append(el('span','theme-time','10:42'),el('span','theme-lines','━━  ━━━━━\n━━  ━━━'));b.append(demo,el('strong','',pack.name),el('small','',t('by')+pack.author));b.setAttribute('aria-pressed',String(JSON.stringify(state.pack)===JSON.stringify(pack)));return b;}
function render(){
 heading.textContent=t('title');hint.textContent=t('hint');themeTitle.textContent=t('theme');clockTitle.textContent=t('clock');communityTitle.textContent=t('community');note.textContent=t('note');
 themeGrid.replaceChildren(...[...presets,...state.custom].map(p=>themeCard(p,()=>commit({...state,pack:p}))));
 clockGrid.replaceChildren(...clocks.map(c=>{const b=button('',()=>commit({...state,clock:c}));b.className='clock-card';b.append(face(c),el('strong','',t(c)));b.setAttribute('aria-pressed',String(state.clock===c));return b;}));
 actions.replaceChildren(button(t('import'),()=>input.click()),button(t('export'),exportPack),button(t('reset'),()=>commit({...state,pack:presets[0],clock:'digital'})));
 if(state.custom.length)actions.append(button(t('remove'),()=>commit({pack:presets[0],clock:state.clock,custom:[]})));
}
const display=document.querySelector('.clock-display'),tiles=el('div','live-tiles'),dial=el('canvas','live-dial');tiles.setAttribute('aria-hidden','true');dial.setAttribute('aria-hidden','true');dial.width=480;dial.height=480;display.append(tiles,dial);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&dialog.open)event.stopImmediatePropagation();},true);
const digits=Array.from({length:4},()=>el('span','split-digit','0'));tiles.append(digits[0],digits[1],el('span','split-colon',':'),digits[2],digits[3]);
function draw(canvas,time,seconds,accent,fg){
 const c=canvas.getContext('2d');if(!c)return;const w=canvas.width;c.clearRect(0,0,w,w);c.save();c.translate(w/2,w/2);c.scale(w/240,w/240);
 c.strokeStyle=accent;c.lineWidth=1;c.beginPath();c.arc(0,0,109,0,Math.PI*2);c.stroke();
 for(let i=0;i<60;i++){c.save();c.rotate(i*Math.PI/30);c.strokeStyle=i%5?fg:accent;c.globalAlpha=i%5?.35:1;c.lineWidth=i%5?1:2;c.beginPath();c.moveTo(0,-100);c.lineTo(0,i%5?-96:-88);c.stroke();c.restore();}
 const [h,m]=time.split(':').map(Number),s=Number(seconds);
 for(const [angle,length,width,color] of [[(h%12+m/60)*Math.PI/6,53,5,fg],[(m+s/60)*Math.PI/30,77,3,fg],[s*Math.PI/30,83,1.5,accent]]){c.save();c.rotate(angle);c.strokeStyle=color;c.lineWidth=width;c.lineCap='round';c.beginPath();c.moveTo(0,8);c.lineTo(0,-length);c.stroke();c.restore();}
 c.fillStyle=accent;c.beginPath();c.arc(0,0,4,0,Math.PI*2);c.fill();c.restore();
}
function updateClock(){
 const time=$('clock').textContent;if(!/^\d{2}:\d{2}$/.test(time))return;
 const chars=time.replace(':','');digits.forEach((d,i)=>{if(d.textContent!==chars[i]){d.textContent=chars[i];if(!matchMedia('(prefers-reduced-motion: reduce)').matches&&d.animate)d.animate([{opacity:.45,transform:'rotateX(-25deg)'},{opacity:1,transform:'rotateX(0deg)'}],{duration:220});}});
 if(state.clock==='analog')draw(dial,time,$('clockSeconds').textContent,state.pack.palette.accent,state.pack.palette.text);
}
function apply(){paint(root,state.pack);root.dataset.clock=state.clock;updateClock();}
new MutationObserver(updateClock).observe($('clockSeconds'),{childList:true});
new MutationObserver(()=>{render();status.textContent='';}).observe(root,{attributes:true,attributeFilter:['lang']});
function openPreview(pack){
 candidate=pack;dialogTitle.textContent=t('preview');preview.replaceChildren(themeCard(pack,()=>{}),face(pack.clock));json.hidden=true;dialogStatus.textContent='';
 dialogActions.replaceChildren(button(t('apply'),()=>{
 const custom=state.custom.filter(p=>!(p.name===candidate.name&&p.author===candidate.author));
 if(custom.length>=12){dialogStatus.textContent=t('full');return;}
 if(commit({pack:candidate,clock:candidate.clock,custom:[...custom,candidate]}))dialog.close();
 }),button(t('cancel'),()=>dialog.close()));dialog.showModal();
}
input.addEventListener('change',async()=>{
 const file=input.files[0];input.value='';if(!file)return;
 if(file.size>MAX){status.textContent=t('size');return;}
 try{openPreview(parse(await file.text()));}catch{status.textContent=t('bad');}
});
function exportPack(){
 dialogTitle.textContent=t('exportTitle');preview.replaceChildren();json.hidden=false;
 json.value=JSON.stringify({...state.pack,clock:state.clock},null,2);dialogStatus.textContent='';
 dialogActions.replaceChildren(button(t('copy'),async()=>{try{await navigator.clipboard.writeText(json.value);dialogStatus.textContent=t('copied');}catch{json.focus();json.select();dialogStatus.textContent=t('copyError');}}),button('Download .json',()=>{
 const blob=new Blob([json.value],{type:'application/json'}),url=URL.createObjectURL(blob),a=el('a');a.href=url;a.download='deck-watch-style.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
 }),button(t('cancel'),()=>dialog.close()));dialog.showModal();
}
apply();render();
})();

