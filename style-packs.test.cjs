const {test}=require('node:test');
const assert=require('node:assert/strict');
const {presets,parse,validate,morseDigits}=require('./static/style-packs.js');
test('Morse numerals preserve leading zeros and validate 24-hour time',()=>{
 assert.deepEqual(morseDigits('01:23'),['-----','.----','..---','...--']);
 assert.deepEqual(morseDigits('04:56'),['-----','....-','.....','-....']);
 assert.deepEqual(morseDigits('07:38'),['-----','--...','...--','---..']);
 assert.deepEqual(morseDigits('19:59'),['.----','----.','.....','----.']);
 for(const time of ['24:00','12:60','1:23','bad'])assert.throws(()=>morseDigits(time));
 assert.equal(validate({...presets[0],clock:'morse'}).clock,'morse');
});
test('built-ins and community example round-trip without executable fields',()=>{
 for(const pack of [...presets,require('./themes/amber-terminal.json')])
  assert.deepEqual(parse(JSON.stringify(pack)),pack);
});
test('untrusted packs reject injection, unknown renderers, poor contrast and oversized files',()=>{
 const base=presets[0];
 for(const bad of [
  {...base,script:'alert(1)'},{...base,layout:'url(https://example.org)'},
  {...base,clock:'custom-js'}, {...base,version:2}, {...base,name:'<script>'},
  {...base,palette:{...base.palette,accent:'url(x)'}},
  {...base,palette:{...base.palette,text:base.palette.background}},
  {...base,palette:{...base.palette,extra:'#ffffff'}},
 ])assert.throws(()=>validate(bad));
 assert.throws(()=>parse(' '.repeat(16385)));
 assert.throws(()=>parse('{"__proto__":{} }'));
 assert.throws(()=>parse('null'));
});
