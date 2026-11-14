'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {CombatController,attackCooldownMs}=require('../src/combat');
function vec(x,y,z){return {x,y,z,distanceTo(other){return Math.hypot(this.x-other.x,this.y-other.y,this.z-other.z)},offset(dx,dy,dz){return vec(this.x+dx,this.y+dy,this.z+dz)}};}
function mock(){
  const target={id:8,name:'zombie',position:vec(2,64,0),height:1.9};
  const attacks=[],goals=[];
  const bot={health:20,entity:{id:1,position:vec(0,64,0)},entities:{8:target},heldItem:{name:'iron_sword'},
    pathfinder:{setGoal(goal){goals.push(goal)}},clearControlStates(){},
    lookAt(){return Promise.resolve()},attack(entity){attacks.push(entity)},entityAtCursor(){return target}};
  return {bot,target,attacks,goals};
}
test('item cooldown is weapon-sensitive',()=>{
  assert.equal(attackCooldownMs('iron_sword'),625);
  assert.equal(attackCooldownMs('diamond_axe'),1000);
});
test('combat remains disabled until explicitly enabled',()=>{
  const {bot,target,attacks}=mock();const ctl=new CombatController(bot);
  assert.equal(ctl.engage(target).status,'combat_disabled');ctl.tick(10000);assert.equal(attacks.length,0);
});
test('PvP requires independent flag',()=>{
  const {bot,target}=mock();const ctl=new CombatController(bot,()=>{},{enabled:true});
  assert.equal(ctl.engage(target,'player').status,'pvp_disabled');
});
test('physics-tick reflex attacks within range respecting cooldown',()=>{
  const {bot,target,attacks}=mock();const ctl=new CombatController(bot,()=>{},{enabled:true});
  assert.equal(ctl.engage(target).status,'combat_started');
  ctl.tick(10000);ctl.tick(10100);ctl.tick(10500);assert.equal(attacks.length,1);
  ctl.tick(10625);assert.equal(attacks.length,2);
});
test('low health interrupts combat on next tick',()=>{
  const {bot,target,attacks}=mock();const ctl=new CombatController(bot,()=>{},{enabled:true});
  ctl.engage(target);bot.health=6;ctl.tick(10000);
  assert.equal(ctl.active,false);assert.equal(attacks.length,0);
});
