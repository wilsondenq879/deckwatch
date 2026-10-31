const {test}=require('node:test');
const assert=require('node:assert/strict');
const {quotaUsage,countdown,clockParts,trendPoints}=require('../static/app.js');
test('remaining allowance decreases as usage grows, independently of reset timing',()=>{
 for(const used of [0,20,50,80,95,100]) {
  assert.deepEqual(quotaUsage({usedPercent:used}),{used,remaining:100-used});
  assert.deepEqual(quotaUsage({usedPercent:used,resetsAt:0,windowDurationMins:10080}),{used,remaining:100-used});
 }
});
test('trend rejects missing, old and future samples without inventing zeroes',()=>{
 const history=[{at:99,value:40},{at:130,value:52},{at:90,value:0},null,{at:200,value:null},{at:221,value:75},{at:220,value:101},{at:200,value:-1}];
 const before=JSON.stringify(history);
 assert.deepEqual(trendPoints(history,220),[{at:130,value:52},{at:200,value:0},{at:220,value:100}]);
 assert.equal(JSON.stringify(history),before);
 for(const absent of [undefined,null,{},'invalid'])assert.deepEqual(trendPoints(absent,220),[]);
 assert.deepEqual(trendPoints([{at:200,value:50}],321),[]);
});
test('trend preserves a constant real RAM reading and caps history at 24 samples',()=>{
 const points=trendPoints(Array.from({length:30},(_,i)=>({at:200+i,value:62.5})),230);
 assert.equal(points.length,24);
 assert.equal(points[0].at,206);
 assert.ok(points.every(p=>p.value===62.5));
});
test('missing allowance stays unknown, numeric outliers clamp',()=>{
 for(const quota of [null,{}, {usedPercent:null},{usedPercent:'24'},{usedPercent:NaN},{usedPercent:Infinity}]) assert.equal(quotaUsage(quota),null);
 assert.deepEqual(quotaUsage({usedPercent:-1}),{used:0,remaining:100});
 assert.deepEqual(quotaUsage({usedPercent:101}),{used:100,remaining:0});
});
test('Taipei clock rolls date and weekday together at midnight',()=>{
 assert.deepEqual(clockParts(new Date('2026-10-30T15:59:59Z')),{time:'23:59',second:'59',date:'2026.10.30',dateTime:'2026-10-30',weekday:'星期五'});
 assert.deepEqual(clockParts(new Date('2026-10-30T16:00:00Z')),{time:'00:00',second:'00',date:'2026.10.31',dateTime:'2026-10-31',weekday:'星期六'});
});
test('countdown shows days and hours, including sub-hour and expired cases',()=>{
 assert.equal(countdown(4*86400+22*3600),'4 天 22 小時');
 assert.equal(countdown(25*60),'0 小時 25 分');assert.equal(countdown(0),'等待來源更新');
});
