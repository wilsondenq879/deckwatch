const {test}=require('node:test');
const assert=require('node:assert/strict');
const {PadInput,directionalTarget}=require('../../static/controller.js');
const pad=(pressed=[],axes=[0,0,0,0])=>({mapping:'standard',connected:true,id:'Xbox',axes,buttons:Array.from({length:17},(_,i)=>({pressed:pressed.includes(i),value:pressed.includes(i)?1:0}))});
test('A/B and shortcuts fire once per press, including held-button resume',()=>{
 const input=new PadInput();assert.deepEqual(input.read(pad([0]),0),[]);
 assert.deepEqual(input.read(pad([0]),16),[]);input.read(pad(),32);
 assert.deepEqual(input.read(pad([0]),48),[{action:'confirm'}]);assert.deepEqual(input.read(pad([0]),2000),[]);
 input.read(pad(),2016);assert.deepEqual(input.read(pad([1,2,3,4,5,8,9]),2032).map(x=>x.action),['back','settings','tasks','pageUp','pageDown','tasks','settings']);
 input.reset();assert.deepEqual(input.read(pad([0]),3000),[]);
});
test('D-pad repetition starts after 400 ms then repeats at 120 ms',()=>{
 const input=new PadInput();input.read(pad(),0);
 assert.deepEqual(input.read(pad([13]),10),[{action:'moveDown'}]);
 assert.deepEqual(input.read(pad([13]),409),[]);
 assert.deepEqual(input.read(pad([13]),410),[{action:'moveDown'}]);
 assert.deepEqual(input.read(pad([13]),529),[]);
 assert.deepEqual(input.read(pad([13]),530),[{action:'moveDown'}]);
 assert.deepEqual(input.read(pad([14]),540),[{action:'moveLeft'}]);
});
test('stick deadzone prevents drift, dominant axis selects one direction',()=>{
 const input=new PadInput();input.read(pad(),0);
 assert.deepEqual(input.read(pad([],[.3,.3]),20),[]);
 assert.deepEqual(input.read(pad([],[.8,.6]),40),[{action:'moveRight'}]);
 input.read(pad([],[.45,0]),60);input.read(pad(),80);
 assert.deepEqual(input.read(pad([],[.45,0]),100),[]);
 assert.deepEqual(input.read(pad([],[0,-.8]),120),[{action:'moveUp'}]);
});
test('raw unknown devices are ignored; scroll delta is bounded after a pause',()=>{
 const input=new PadInput();input.read(pad(),0);
 assert.deepEqual(input.read({...pad([0]),mapping:'',id:'Unknown device'},10),[]);
 input.read(pad(),20);
 assert.deepEqual(input.read(pad([],[0,0,0,1]),10000),[{action:'scroll',amount:32.5}]);
 assert.deepEqual(input.read({...pad([0]),connected:false},10010),[]);
});
function item(id,x,y,w=100,h=50){return {element:id,rect:{left:x,top:y,right:x+w,bottom:y+h,width:w,height:h}};}
test('spatial navigation follows card rows and can reach an offscreen control',()=>{
 const a=item('a',0,0),b=item('b',120,0),c=item('c',0,80),d=item('d',120,80),below=item('below',0,900);
 const items=[a,b,c,d,below];
 assert.equal(directionalTarget(items,a,'right'),b);
 assert.equal(directionalTarget(items,b,'down'),d);
 assert.equal(directionalTarget(items,d,'left'),c);
 assert.equal(directionalTarget(items,c,'up'),a);
 assert.equal(directionalTarget(items,c,'down'),below);
 assert.equal(directionalTarget(items,a,'left'),null);
});
