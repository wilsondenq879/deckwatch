'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const DEFAULT_ENDPOINT = 'http://192.168.1.2:8765';
function endpoint(value) {
  const url = new URL(value.includes('://') ? value : `http://${value}`);
  if (!url.port) url.port = '8765';
  const ip = url.hostname.split('.').map(Number);
  const local = net.isIP(url.hostname) === 4 && (ip[0] === 10 || ip[0] === 127 || (ip[0] === 192 && ip[1] === 168) || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31));
  if (!local || !['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('請輸入 Deck Watch Hub 的區網 IPv4 位址，例如 192.168.1.2。');
  return url.origin;
}
class Bridge {
  constructor(directory, fetcher = fetch) {
    this.directory = directory; this.fetcher = fetcher;
    fs.mkdirSync(directory, {recursive:true, mode:0o700});
    this.settings = this.read('connection.json') || {endpoint:DEFAULT_ENDPOINT};
    try { this.settings.endpoint = endpoint(this.settings.endpoint); }
    catch { this.settings = {endpoint:DEFAULT_ENDPOINT}; }
    this.cached = this.read('snapshot.json');
    if (this.cached?.endpoint !== this.settings.endpoint) this.cached = null;
  }
  read(name) { try { return JSON.parse(fs.readFileSync(path.join(this.directory,name),'utf8')); } catch { return null; } }
  save(name,value) {
    const target = path.join(this.directory,name), temporary = `${target}.tmp`;
    fs.writeFileSync(temporary,JSON.stringify(value),{mode:0o600});
    fs.chmodSync(temporary,0o600); fs.renameSync(temporary,target);
  }
  config() { return {endpoint:this.settings.endpoint}; }
  async request(origin, route, options = {}) {
    const response = await this.fetcher(`${origin}${route}`,{...options,redirect:'error',signal:AbortSignal.timeout(10000)});
    const body = await response.text();
    if (body.length > 2_000_000) throw new Error('來源資料過大');
    return {response,data:JSON.parse(body)};
  }
  async pair(input) {
    if (!input || typeof input.endpoint !== 'string' || typeof input.code !== 'string' || !/^\d{8}$/.test(input.code)) return {status:400,data:{error:'請輸入 Hub 位址與 8 位配對碼。'}};
    let origin;
    try { origin = endpoint(input.endpoint); } catch (error) { return {status:400,data:{error:error.message}}; }
    try {
      const {response,data} = await this.request(origin,'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:input.code})});
      if (!response.ok) return {status:response.status,data};
      const token = /(?:^|;\s*)deck_session=([^;]+)/.exec(response.headers.get('set-cookie') || '')?.[1];
      if (!token || !/^\d+\.[a-f0-9]+\.[a-f0-9]+$/.test(token)) throw new Error('配對回應不完整');
      this.settings = {endpoint:origin,token};
      this.cached = null;
      this.save('connection.json',this.settings); this.save('snapshot.json',null);
      return {status:200,data:{paired:true}};
    } catch { return {status:503,data:{error:'連不到 Hub，請確認位址、看板服務與 Wi-Fi。'}}; }
  }
  async interval(seconds) {
    if (!Number.isInteger(seconds) || ![30,60,300].includes(seconds)) return {status:400,data:{error:'Invalid interval'}};
    if (!this.settings.token) return {status:401,data:{error:'Pairing required'}};
    try {
      const {response,data}=await this.request(this.settings.endpoint,'/api/settings',{method:'POST',headers:{'Content-Type':'application/json',Cookie:`deck_session=${this.settings.token}`},body:JSON.stringify({pollSeconds:seconds})});
      return {status:response.status,data};
    } catch { return {status:503,data:{error:'Hub unavailable'}}; }
  }
  async status() {
    if (!this.settings.token) return {status:401,data:{error:'請先配對'}};
    try {
      const {response,data} = await this.request(this.settings.endpoint,'/api/status',{headers:{Cookie:`deck_session=${this.settings.token}`}});
      if (!response.ok) return {status:response.status,data};
      if (!Array.isArray(data.quota) || !Array.isArray(data.threads) || !Number.isFinite(data.serverTime)) throw new Error('來源資料不完整');
      this.cached = {endpoint:this.settings.endpoint,data}; this.save('snapshot.json',this.cached);
      return {status:200,data:{...data,deckOffline:false}};
    } catch {
      if (this.cached) return {status:200,data:{...this.cached.data,serverTime:Date.now()/1000,deckOffline:true}};
      return {status:503,data:{error:'連不到 Hub'}};
    }
  }
}
module.exports = {Bridge,endpoint};
