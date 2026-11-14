'use strict';
require('dotenv').config();
const {ollamaPlan}=require('../src/planner');
const config={ollamaUrl:process.env.OLLAMA_URL||'http://127.0.0.1:11434',
  ollamaModel:process.env.OLLAMA_MODEL||'qwen3.5:4b',llmTimeoutMs:Number(process.env.LLM_TIMEOUT_MS)||25000,
  move:true,attack:false,allowDig:false,pvp:false,pvpAllow:new Set(),minHealth:9};
const state={position:{x:119,y:70,z:-140},health:20,food:20,dimension:'overworld',time:12000,
  players:[{name:'Visitor',distance:4}],nearestPlayer:{name:'Visitor',distance:4},hostiles:[],nearestHostile:null,
  inventory:[],hasFood:false,nearestWood:null};
(async()=>{
  const values=[];
  for(let i=1;i<=3;i++){
    try{
      const response=await ollamaPlan(config,state,{latestChat:{from:'Visitor',text:'WildPlayer 같이 탐험할래?'}});
      values.push(response.decisionMs);
      console.log(`run ${i}: ${response.decisionMs} ms | goal=${response.goal} | say=${response.say}`);
    }catch(e){console.error(`run ${i}: ${e.message}`);process.exitCode=1;}
  }
  if(values.length){const sorted=values.slice().sort((a,b)=>a-b);console.log(`median: ${sorted[Math.floor(sorted.length/2)]} ms | model=${config.ollamaModel}`);}
})();
