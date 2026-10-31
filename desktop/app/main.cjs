'use strict';
const {app,BrowserWindow,Menu,protocol,ipcMain,powerSaveBlocker} = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const {Bridge} = require('./bridge.cjs');
app.setName('Deck Watch');
app.setPath('userData',path.join(app.getPath('appData'),'deck-watch'));
app.enableSandbox();
protocol.registerSchemesAsPrivileged([{scheme:'deck',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
let window, bridge, awakeId;
const locked = app.requestSingleInstanceLock();
if (!locked) app.quit();
else {
  app.on('second-instance',()=>{ if(window) { if(window.isMinimized()) window.restore(); window.show(); window.focus(); } });
  app.whenReady().then(async()=>{
    bridge = new Bridge(app.getPath('userData'));
    const types={'/':'text/html','/index.html':'text/html','/app.js':'text/javascript','/desktop.js':'text/javascript','/app.css':'text/css','/desktop.css':'text/css','/favicon.svg':'image/svg+xml','/logo.png':'image/png'};
    types['/style-packs.js']='text/javascript';
    types['/style-packs.css']='text/css';
    protocol.handle('deck',async request=>{
      const url=new URL(request.url);
      if(url.host!=='watch' || !(url.pathname in types)) return new Response('Not found',{status:404});
      const name=url.pathname==='/'?'index.html':url.pathname.slice(1);
      return new Response(await fs.readFile(path.join(__dirname,'ui',name)),{headers:{'Content-Type':`${types[url.pathname]}; charset=utf-8`,'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'",'Cache-Control':'no-store'}});
    });
    Menu.setApplicationMenu(null);
    window = new BrowserWindow({title:'Deck Watch',width:1280,height:800,minWidth:360,minHeight:500,backgroundColor:'#050709',autoHideMenuBar:true,show:false,fullscreen:process.argv.includes('--fullscreen'),icon:path.join(__dirname,'icon.png'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true}});
    const contents=window.webContents;
    contents.setWindowOpenHandler(()=>({action:'deny'}));
    contents.on('will-navigate',(event,url)=>{if(url!=='deck://watch/') event.preventDefault();});
    contents.on('will-attach-webview',event=>event.preventDefault());
    contents.session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
    contents.session.setPermissionCheckHandler(()=>false);
    function handle(channel,fn) { ipcMain.handle(channel,(event,...args)=>{
      if(event.sender!==contents || event.senderFrame!==contents.mainFrame || event.senderFrame.url!=='deck://watch/') throw new Error('Access denied');
      return fn(...args);
    }); }
    handle('deck:config',()=>({...bridge.config(),awake:awakeId!==undefined}));
    handle('deck:interval',seconds=>bridge.interval(seconds));
    handle('deck:status',()=>bridge.status());
    handle('deck:pair',input=>bridge.pair(input));
    handle('deck:fullscreen',()=>{window.setFullScreen(!window.isFullScreen());return window.isFullScreen();});
    handle('deck:awake',enabled=>{if(typeof enabled!=='boolean') return false;
      if(enabled && awakeId===undefined) awakeId=powerSaveBlocker.start('prevent-display-sleep');
      if(!enabled && awakeId!==undefined) {powerSaveBlocker.stop(awakeId);awakeId=undefined;}
      return awakeId!==undefined;
    });
    handle('deck:quit',()=>app.quit());
    contents.on('before-input-event',(event,input)=>{
      if(input.type!=='keyDown') return;
      if(input.key==='F11') {event.preventDefault();window.setFullScreen(!window.isFullScreen());}
      if(input.key==='Escape' && window.isFullScreen()) {event.preventDefault();window.setFullScreen(false);}
    });
    window.once('ready-to-show',()=>window.show());
    await window.loadURL('deck://watch/');
    // Opt-in local support snapshot; no port, remote code, or credentials exposed.
    if (process.argv.includes('--diagnostics')) setTimeout(async()=>{
      try {
        const report=await contents.executeJavaScript(`(() => ({
          version: '0.5.2', viewport: [innerWidth,innerHeight],
          clockFace: document.documentElement.dataset.clock,
          morseGroups: document.querySelectorAll('.live-morse .morse-code').length,
          morseSymbols: [...document.querySelectorAll('.live-morse .morse-code')].map(n=>n.dataset.code),
          clockTime: document.getElementById('clock').textContent,
          appearanceReady: !!document.getElementById('styleStudio'),
          dashboardVisible: !document.getElementById('dashboard').hidden,
          settingsHidden: document.getElementById('settingsPage').hidden,
          taskRows: document.querySelectorAll('#taskList .task-row').length,
          connection: document.getElementById('connection').textContent,
          cpu: document.getElementById('cpuValue').textContent,
          ram: document.getElementById('ramValue').textContent,
          pressure: document.getElementById('memoryPressure').textContent,
          ramSamples: Number(document.getElementById('ramChart').dataset.samples || 0),
          ramChartVisible: document.getElementById('ramChart').getBoundingClientRect().height >= 16,
          remainingPercent: document.getElementById('usageTrack').getAttribute('aria-valuenow'),
          quotaLabel: document.getElementById('usageTrack').getAttribute('aria-label'),
          quotaFill: document.getElementById('usagePanel').style.getPropertyValue('--progress'),
          overflow: document.documentElement.scrollWidth > innerWidth,
          verticalOverflow: document.documentElement.scrollHeight > innerHeight,
          quotaVisible: document.getElementById('usagePanel').getBoundingClientRect().bottom <= innerHeight,
          tasksOverlapQuota: document.querySelector('.tasks-panel').getBoundingClientRect().bottom > document.getElementById('usagePanel').getBoundingClientRect().top,
          calendarOverlapsMetrics: document.querySelector('.clock-calendar').getBoundingClientRect().bottom > document.querySelector('.host-metrics').getBoundingClientRect().top
        }))()`);
        await fs.writeFile(path.join(app.getPath('userData'),'diagnostics.json'),JSON.stringify(report),{mode:0o600});
        await fs.writeFile(path.join(app.getPath('userData'),'diagnostics.png'),(await contents.capturePage()).toPNG(),{mode:0o600});
      } catch(error) {console.error('Deck Watch diagnostics failed:',error.message);}
    },5000);
  });
  app.on('window-all-closed',()=>app.quit());
}
