'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {starterRecommendation,SurvivalSkills,countOf}=require('../src/survival');
const {allowedGoals}=require('../src/planner');
const cfg={move:true,allowDig:true,allowCraft:true,allowPlace:true,attack:false,pvp:false,pvpAllow:new Set(),minHealth:9};
const state=(inventory=[],overrides={})=>({inventory,food:20,hasFood:false,players:[],nearestWood:{name:'oak_log'},
  nearestStone:null,nearbyTable:false,nearestHostile:null,nearestPlayer:null,...overrides});
const I=(name,count)=>({name,count});
test('first join: find logs before trying to craft',()=>{
  assert.equal(starterRecommendation(state([])),'GATHER_WOOD');
  assert.ok(allowedGoals(state([]),cfg).includes('GATHER_WOOD'));
  assert.ok(!allowedGoals(state([]),cfg).includes('CRAFT_WOODEN_PICKAXE'));
});
test('tool progression recommends resource-dependent goals',()=>{
  assert.equal(starterRecommendation(state([I('oak_log',1)])),'CRAFT_PLANKS');
  assert.equal(starterRecommendation(state([I('oak_planks',4)])),'CRAFT_STICKS');
  assert.equal(starterRecommendation(state([I('oak_planks',4),I('stick',2)])),'CRAFT_TABLE');
  assert.equal(starterRecommendation(state([I('oak_planks',3),I('stick',2),I('crafting_table',1)])),'PLACE_TABLE');
  assert.equal(starterRecommendation(state([I('oak_planks',3),I('stick',2)],{nearbyTable:true})),'CRAFT_WOODEN_PICKAXE');
  assert.equal(starterRecommendation(state([I('wooden_pickaxe',1)],{nearestStone:{name:'stone'}})),'MINE_STONE');
  assert.equal(starterRecommendation(state([I('wooden_pickaxe',1),I('cobblestone',3),I('stick',2)],{nearbyTable:true})),'CRAFT_STONE_PICKAXE');
});
test('craft and PvP permissions are kept separate',()=>{
  const s=state([I('oak_log',1)]);
  assert.ok(!allowedGoals(s,{...cfg,allowCraft:false}).includes('CRAFT_PLANKS'));
  assert.ok(allowedGoals(s,cfg).includes('CRAFT_PLANKS'));
  assert.ok(!allowedGoals(s,cfg).includes('FIGHT_PLAYER'));
});
test('craft recipe API is called and inventory changes are verified',async()=>{
  let n=0;const bot={registry:{itemsByName:{stick:{id:99}}},inventory:{items:()=>[I('stick',n)]},
    recipesFor:(id)=>id===99?[{name:'stick'}]:[],craft:async()=>{n+=4;}};
  const skills=new SurvivalSkills(bot,()=>{},{allowCraft:true});
  const r=await skills.craft('stick',()=>true);
  assert.equal(r.status,'crafted_verified');assert.equal(r.after,4);
  assert.equal(countOf(bot.inventory.items(),'stick'),4);
});
test('refuses to place crafting tables without placement permission',async()=>{
  const skills=new SurvivalSkills({},()=>{},{allowPlace:false});
  assert.equal((await skills.placeTable(()=>true)).status,'placement_disabled');
});
