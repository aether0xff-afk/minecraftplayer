'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {MotorController,parseFrame,worldToKeys,aimAt,constrainFrame}=require('../src/motor');
function fakeBot(){
  const state={};const calls=[];
  return {calls,state,entity:{id:99,position:{x:0,y:64,z:0},yaw:0},food:20,heldItem:{name:'bow'},quickBarSlot:0,
    getControlState:k=>!!state[k],setControlState:(k,v)=>{state[k]=v;calls.push(['key',k,v]);},
    look:(yaw,pitch)=>{calls.push(['look',yaw,pitch]);return Promise.resolve();},
    activateItem:()=>calls.push(['activate']),deactivateItem:()=>calls.push(['deactivate']),
    entityAtCursor:()=>({id:7,name:'zombie'}),attack:e=>calls.push(['attack',e.id]),
    clearControlStates:()=>{for(const k in state)state[k]=false;calls.push(['clear']);},
    setQuickBarSlot:n=>{calls.push(['hotbar',n]);}
  };
}
test('composite frame retains movement, look, jump, and use at once',async()=>{
  const bot=fakeBot();const motor=new MotorController(bot,()=>{},{move:true,attack:false});
  motor.enable();motor.setFrame({forward:true,left:true,jump:true,use:true,lookAt:{x:10,y:65,z:10}});
  motor.tick(1000);await Promise.resolve();await Promise.resolve();
  assert.equal(bot.state.forward,true);assert.equal(bot.state.left,true);
  assert.equal(bot.state.jump,true);assert.equal(bot.calls.some(x=>x[0]==='activate'),true);
  assert.equal(bot.calls.some(x=>x[0]==='look'),true);
  assert.equal(motor.status().ticks,1);
});
test('bow charge prevents sprint but allows walking and aiming',()=>{
  const result=constrainFrame(parseFrame({forward:true,sprint:true,use:true,look:{yaw:1,pitch:0}}),{heldItemName:'bow',food:20});
  assert.equal(result.forward,true);assert.equal(result.sprint,false);
  assert.equal(result.use,true);assert.equal(result.look.yaw,1);
});
test('world movement compensates for camera heading',()=>{
  // Move east while looking north (yaw = PI): right key moves east.
  const k=worldToKeys({x:1,z:0},Math.PI);
  assert.equal(k.right,true);assert.equal(k.forward,false);
  const k2=worldToKeys({x:0,z:1},0);
  assert.equal(k2.forward,true);
});
test('use has press/hold/release transitions independent of look and movement',()=>{
  const bot=fakeBot();const m=new MotorController(bot,()=>{},{move:true,attack:false});m.enable();
  m.setFrame({use:true,forward:true});m.tick(1000);m.tick(1050);
  assert.equal(bot.calls.filter(x=>x[0]==='activate').length,1);
  m.setFrame({use:false,forward:true});m.tick(1100);
  assert.equal(bot.calls.filter(x=>x[0]==='deactivate').length,1);
  assert.equal(bot.state.forward,true);
});
test('only allow attacks against listed PvP players or hostiles',()=>{
  const bot=fakeBot();const config={move:true,attack:true,pvp:false,pvpAllow:new Set(['alice'])};
  const m=new MotorController(bot,()=>{},config);m.enable();m.setFrame({forward:true,attack:true});
  bot.entityAtCursor=()=>({id:8,username:'Alice',name:'player'});m.tick(1000);
  assert.equal(bot.calls.filter(x=>x[0]==='attack').length,0);
  config.pvp=true;m.tick(1050);
  assert.equal(bot.calls.filter(x=>x[0]==='attack').length,1);
  // No rapid second hit despite 20Hz tick.
  m.tick(1100);assert.equal(bot.calls.filter(x=>x[0]==='attack').length,1);
});
test('invalid input rejected and motor stop clears controls and held use',()=>{
  assert.throws(()=>parseFrame({forward:'yes'}),/boolean/);
  assert.throws(()=>parseFrame({look:{yaw:Infinity,pitch:0}}),/finite/);
  const bot=fakeBot();const m=new MotorController(bot,()=>{},{move:true});m.enable();
  m.setFrame({forward:true,use:true});m.tick(1000);m.disable('test');
  assert.equal(m.status().enabled,false);assert.equal(m.status().holdingUse,false);
  assert.equal(bot.state.forward,false);
});
test('a supplied fast policy may generate one composite vector per tick',()=>{
  const bot=fakeBot();const m=new MotorController(bot,()=>{},{move:true});m.enable();
  m.setPolicy((b,t)=>({forward:t<1100,left:t>=1100,look:{yaw:t/1000,pitch:0}}));
  for(let t=1000;t<=1150;t+=50)m.tick(t);
  assert.equal(m.status().ticks,4);
  assert.equal(bot.state.left,true);assert.equal(bot.state.forward,false);
});
test('eye-angle calculation is finite at target',()=>{
  const a=aimAt({x:0,y:0,z:0},{x:0,y:0,z:10});
  assert.ok(Math.abs(a.yaw)<1e-12);assert.ok(Math.abs(a.pitch)<1e-12);
});
