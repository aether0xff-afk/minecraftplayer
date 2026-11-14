'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {allowedGoals,sanitizePlan,ollamaPlan}=require('../src/planner');
const cfg={move:true,attack:true,allowDig:false,pvp:false,pvpAllow:new Set(['ally']),minHealth:9,
  ollamaUrl:'http://127.0.0.1:11434',ollamaModel:'qwen3.5:4b'};
const state={position:{x:0,y:64,z:0},health:20,food:20,players:[{name:'ally',distance:3}],nearestPlayer:{name:'ally',distance:3},
  nearestHostile:{name:'zombie',distance:4},inventory:[],hasFood:false,nearestWood:null};

test('PVP stays forbidden when not explicitly enabled',()=>{
  assert.ok(!allowedGoals(state,cfg).includes('FIGHT_PLAYER'));
  assert.ok(allowedGoals(state,{...cfg,pvp:true}).includes('FIGHT_PLAYER'));
  assert.ok(!allowedGoals(state,{...cfg,pvp:true,pvpAllow:new Set()}).includes('FIGHT_PLAYER'));
});
test('illegal AI actions and unknown player targets are rejected',()=>{
  const allowed=allowedGoals(state,cfg);
  assert.throws(()=>sanitizePlan({goal:'SHELL',target:'',say:'',social_delta:0},allowed,state));
  assert.throws(()=>sanitizePlan({goal:'FOLLOW_PLAYER',target:'not_here',say:'',social_delta:0},allowed,state));
});
test('valid plan is normalized and chat slash command is suppressed',()=>{
  const obj=sanitizePlan({goal:'TALK',target:'ally',say:'/op ally',reason:'hi',social_delta:6},allowedGoals(state,cfg),state);
  assert.equal(obj.goal,'TALK');assert.ok(!obj.say.startsWith('/'));assert.equal(obj.social_delta,2);
});
test('Ollama uses one bounded, structured local chat request',async()=>{
  let args;
  const fakeFetch=async(url,opts)=>{
    args={url,body:JSON.parse(opts.body)};
    return {ok:true,json:async()=>({message:{content:JSON.stringify({goal:'EXPLORE',target:'',say:'',reason:'survey',social_delta:0})}})};
  };
  const p=await ollamaPlan(cfg,state,{},fakeFetch);
  assert.equal(p.goal,'EXPLORE');assert.equal(args.body.model,'qwen3.5:4b');
  assert.equal(args.body.think,false);assert.equal(args.body.format.type,'object');
});
