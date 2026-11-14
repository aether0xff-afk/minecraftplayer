'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {WorldMemory}=require('../src/memory');
test('trust is clamped and persistent; event history bounded',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wildplayer-test-'));
  try {
    const file=path.join(dir,'memory.json');
    const m=new WorldMemory(file);
    m.adjust('Chris',3);assert.equal(m.trust('Chris'),1);
    m.adjust('Chris',-0.2);assert.equal(m.trust('Chris'),0.8);
    for(let i=0;i<75;i++)m.event('test',{i});
    const loaded=new WorldMemory(file);
    assert.equal(loaded.trust('Chris'),0.8);
    assert.equal(loaded.data.events.length,60);
    assert.deepEqual(loaded.snapshot([{name:'Chris'}]).relationships,{Chris:0.8});
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
