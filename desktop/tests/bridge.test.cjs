'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {Bridge,endpoint}=require('../app/bridge.cjs');
function fixture(t,fetcher) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'deck-watch-test-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 return new Bridge(dir,fetcher);
}
const token='9999999999.'+'a'.repeat(32)+'.'+'b'.repeat(64);
const snapshot={serverTime:100,quota:[{usedPercent:24}],threads:[{name:'Test task'}],quotaUpdatedAt:90};
test('connection accepts private IPs and optional port, rejects credentials/public hosts/paths',()=>{
 assert.equal(endpoint('192.168.50.166'),'http://192.168.50.166:8765');
 assert.equal(endpoint('192.168.50.166:9000'),'http://192.168.50.166:9000');
 for(const value of ['https://example.com','http://8.8.8.8','file:///etc/passwd','http://user:secret@192.168.1.2','http://192.168.1.2/private','http://192.168.1.2/?x=1']) assert.throws(()=>endpoint(value));
});
test('unpaired status never makes a network request',async t=>{
 const b=fixture(t,()=>assert.fail('unexpected request'));
 assert.equal((await b.status()).status,401);
 assert.equal((await b.pair({endpoint:'192.168.1.2',code:'abc'})).status,400);
});
test('pairing token stays in main process storage; cache survives restart and preserves source age',async t=>{
 const calls=[];
 const b=fixture(t,async(url,options)=>{
  calls.push({url,options});
  if(url.endsWith('/api/pair')) return new Response('{"paired":true}',{headers:{'Set-Cookie':`deck_session=${token}; HttpOnly; Path=/`}});
  return Response.json(snapshot);
 });
 assert.equal((await b.pair({endpoint:'192.168.50.166',code:'12345678'})).status,200);
 assert.deepEqual(b.config(),{endpoint:'http://192.168.50.166:8765'});
 assert.equal((await b.status()).data.deckOffline,false);
 assert.equal(calls[1].options.headers.Cookie,`deck_session=${token}`);
 assert.equal(calls[1].options.redirect,'error');
 assert.equal(fs.statSync(path.join(b.directory,'connection.json')).mode & 0o777,0o600);
 const offline=new Bridge(b.directory,async()=>{throw Error('offline');});
 const result=await offline.status();
 assert.equal(result.data.deckOffline,true);
 assert.deepEqual(result.data.quota,snapshot.quota);
 assert.equal(result.data.quotaUpdatedAt,90);
 assert.ok(result.data.serverTime>100);
});
test('expired pairing requires login, not a cached success',async t=>{
 const b=fixture(t,async()=>Response.json({error:'expired'},{status:401}));
 b.settings.token=token;b.cached={endpoint:b.settings.endpoint,data:snapshot};
 assert.equal((await b.status()).status,401);
});
test('switching Mac clears old snapshot, failed pairing keeps existing connection',async t=>{
 let ok=false;
 const b=fixture(t,async()=>ok?new Response('{"paired":true}',{headers:{'Set-Cookie':`deck_session=${token}`}}):Response.json({error:'wrong code'},{status:401}));
 b.cached={endpoint:b.settings.endpoint,data:snapshot};
 const originalEndpoint=b.config().endpoint;
 await b.pair({endpoint:'192.168.1.22',code:'12345678'});
 assert.equal(b.config().endpoint,originalEndpoint);assert.ok(b.cached);
 ok=true;
 await b.pair({endpoint:'192.168.1.22',code:'12345678'});
 assert.equal(b.config().endpoint,'http://192.168.1.22:8765');assert.equal(b.cached,null);
});
test('cold offline launch reports unavailable without fabricated data',async t=>{
 const b=fixture(t,async()=>{throw Error('offline');});b.settings.token=token;
 assert.equal((await b.status()).status,503);
});
test('frequency uses only the authenticated fixed route and validated intervals',async t=>{
 const calls=[];const b=fixture(t,async(url,options)=>{calls.push({url,options});return Response.json({pollSeconds:30});});
 assert.equal((await b.interval(30)).status,401);
 b.settings.token=token;
 for(const value of [true,'30',0,15,45,3600,null])assert.equal((await b.interval(value)).status,400);
 assert.equal(calls.length,0);
 assert.equal((await b.interval(30)).data.pollSeconds,30);
 assert.ok(calls[0].url.endsWith('/api/settings'));
 assert.equal(calls[0].options.headers.Cookie,`deck_session=${token}`);
 assert.deepEqual(JSON.parse(calls[0].options.body),{pollSeconds:30});
});
