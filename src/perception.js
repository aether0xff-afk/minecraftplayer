'use strict';
const {LOG_RE,havePick}=require('./survival');
const HOSTILES = new Set(['zombie','skeleton','creeper','spider','drowned','husk','stray','witch','pillager','enderman','bogged','breeze','phantom','slime','magma_cube']);
const FOODS = new Set(['bread','apple','baked_potato','cooked_beef','cooked_chicken','cooked_porkchop','cooked_mutton','cooked_rabbit','cooked_cod','cooked_salmon','golden_carrot','melon_slice','beetroot','cookie','pumpkin_pie','mushroom_stew','rabbit_stew','carrot','potato']);
const cache=new WeakMap();
function distance(a,b){return a&&b?Math.round(a.distanceTo(b)*10)/10:Infinity;}
function sensedBlocks(bot,inv,enabled){
  if(!enabled) return {nearestWood:null,nearestStone:null,nearbyTable:false};
  const prev=cache.get(bot);
  const p=bot.entity?.position;
  if(prev && Date.now()-prev.at<3500 && prev.pos?.distanceTo(p||prev.pos)<4)return prev.value;
  const locate=(predicate,dist)=>{
    try{
      const b=bot.findBlock({matching:predicate,maxDistance:dist});
      return b?{name:b.name,position:{x:b.position.x,y:b.position.y,z:b.position.z}}:null;
    }catch{return null;}
  };
  const value={
    nearestWood:locate(b=>LOG_RE.test(b?.name||''),20),
    nearestStone:havePick(inv)?locate(b=>b?.name==='stone'&&b.position.y>=Math.floor(p?.y||0)-2,14):null,
    nearbyTable:!!locate(b=>b?.name==='crafting_table',5)
  };
  cache.set(bot,{at:Date.now(),pos:p?.clone?.(),value});
  return value;
}
function perceive(bot,config){
  if(!bot.entity?.position)return null;
  const p=bot.entity.position;
  const players=Object.entries(bot.players||{}).filter(([n,v])=>n!==bot.username&&v.entity&&v.entity.id!==bot.entity.id)
    .map(([name,v])=>({name,distance:distance(p,v.entity.position)})).filter(x=>x.distance<=24).sort((a,b)=>a.distance-b.distance).slice(0,6);
  const hostiles=Object.values(bot.entities||{}).filter(e=>HOSTILES.has(e.name)&&e.position)
    .map(e=>({name:e.name,id:e.id,distance:distance(p,e.position)})).filter(x=>x.distance<=16).sort((a,b)=>a.distance-b.distance).slice(0,6);
  const inventory=bot.inventory?.items?.().map(x=>({name:x.name,count:x.count}))||[];
  const food=inventory.filter(x=>FOODS.has(x.name));
  return {
    position:{x:Math.round(p.x),y:Math.round(p.y),z:Math.round(p.z)},health:bot.health??20,food:bot.food??20,
    dimension:bot.game?.dimension||'unknown',time:bot.time?.timeOfDay??null,
    inventory:inventory.slice(0,36),hasFood:food.length>0,players,hostiles,
    nearestPlayer:players[0]||null,nearestHostile:hostiles[0]||null,
    ...sensedBlocks(bot,inventory,config.allowDig||config.allowCraft)
  };
}
module.exports={perceive,FOODS,HOSTILES};
