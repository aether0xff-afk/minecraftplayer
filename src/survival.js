'use strict';
// Real-player survival skills. Never read server files or use server commands.
const { goals: { GoalNear } } = require('mineflayer-pathfinder');
const { Vec3 } = require('vec3');
const LOG_RE = /^(?:oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/;
const PICK_RE = /^(?:wooden|stone|iron|golden|diamond|netherite)_pickaxe$/;
const NATURAL_STONE = new Set(['stone']);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const countOf = (inventory, name) => (inventory || []).filter(i => i.name === name).reduce((n,i) => n + (i.count || 0), 0);
const countWhere = (inventory, pred) => (inventory || []).filter(i => pred(i.name || '')).reduce((n,i) => n + (i.count || 0), 0);
const havePick = inv => countWhere(inv, n => PICK_RE.test(n)) > 0;
const haveStonePick = inv => countWhere(inv, n => /^(?:stone|iron|golden|diamond|netherite)_pickaxe$/.test(n)) > 0;
const isAir = b => !b || b.boundingBox === 'empty' || ['air','cave_air','void_air'].includes(b.name);
function starterRecommendation(s) {
  const inv = s.inventory || [];
  const logs = countWhere(inv, n=>LOG_RE.test(n));
  const planks = countWhere(inv, n=>/_planks$/.test(n));
  const sticks = countOf(inv,'stick');
  const table = countOf(inv,'crafting_table');
  const cobble = countOf(inv,'cobblestone');
  if (s.food < 15 && s.hasFood) return 'EAT';
  if (!havePick(inv)) {
    if (planks < 4 && logs > 0) return 'CRAFT_PLANKS';
    if (sticks < 2 && planks >= 2) return 'CRAFT_STICKS';
    if (!s.nearbyTable && table === 0 && planks >= 4) return 'CRAFT_TABLE';
    if (!s.nearbyTable && table > 0) return 'PLACE_TABLE';
    if (sticks >= 2 && planks >= 3 && s.nearbyTable) return 'CRAFT_WOODEN_PICKAXE';
    if (s.nearestWood) return 'GATHER_WOOD';
  }
  if (!haveStonePick(inv)) {
    if (cobble >= 3 && sticks >= 2 && s.nearbyTable) return 'CRAFT_STONE_PICKAXE';
    if (cobble >= 3 && sticks < 2 && planks >= 2) return 'CRAFT_STICKS';
    if (cobble >= 3 && !s.nearbyTable && table > 0) return 'PLACE_TABLE';
    if (cobble >= 3 && !s.nearbyTable && planks >= 4) return 'CRAFT_TABLE';
    if (s.nearestStone) return 'MINE_STONE';
  }
  return 'EXPLORE';
}
class SurvivalSkills {
  constructor(bot, log, cfg) {this.bot=bot;this.log=log;this.cfg=cfg;}
  item(name) {return this.bot.inventory?.items?.().find(x=>x.name===name) || null;}
  items() {return this.bot.inventory?.items?.() || [];}
  nearbyBlock(name, distance=5) {
    try {return this.bot.findBlock({matching:b=>b?.name===name,maxDistance:distance});}
    catch{return null;}
  }
  async gotoBlock(block, distance, isCurrent) {
    if(!isCurrent()) return false;
    const p=block.position;
    let timer;
    try {
      await Promise.race([
        this.bot.pathfinder.goto(new GoalNear(p.x,p.y,p.z,distance)),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('path_timeout')),18000);})
      ]);
      return isCurrent();
    } catch(e) { if(isCurrent()){try{this.bot.pathfinder.setGoal(null);}catch{}} throw e; } finally { clearTimeout(timer); }
  }
  async digOne(block, isCurrent) {
    if(!this.cfg.move || !this.cfg.allowDig || !block) return {status:'dig_not_allowed'};
    const p=block.position;
    try {
      if(!await this.gotoBlock(block,3,isCurrent)) return {status:'cancelled'};
      if(!isCurrent()) return {status:'cancelled'};
      const current=this.bot.blockAt(p);
      if(!current||current.name!==block.name) return {status:'block_changed'};
      if(!this.bot.canDigBlock(current)) return {status:'out_of_reach'};
      const oldItems=this.bot.inventory?.items?.().reduce((sum,it)=>sum+(it.count||0),0)||0;
      await this.bot.dig(current);
      await sleep(500);
      // Try picking up the item the bot just mined, without chasing arbitrary drops.
      if(isCurrent()) {
        try {
          const dropped=this.bot.nearestEntity(e=>e.name==='item'&&e.position&&e.position.distanceTo(p)<2.5);
          if(dropped?.position) {
            const d=dropped.position;
            await Promise.race([
              this.bot.pathfinder.goto(new GoalNear(d.x,d.y,d.z,1)),
              sleep(6500).then(()=>{throw new Error('pickup_timeout');})
            ]);
          }
        }catch{} // Item may already have been picked up or be unreachable.
      }
      await sleep(400);
      const newItems=this.bot.inventory?.items?.().reduce((sum,it)=>sum+(it.count||0),0)||0;
      return {status:'block_broken',pickupObserved:newItems>oldItems,block:current.name,position:{x:p.x,y:p.y,z:p.z}};
    } catch(e){return {status:'dig_failed',error:e.message};}
  }
  async gatherWood(isCurrent) {
    if(!this.cfg.allowDig)return {status:'dig_disabled'};
    let block=null;
    try {block=this.bot.findBlock({matching:b=>LOG_RE.test(b?.name||''),maxDistance:20});} catch{}
    if(!block)return {status:'no_visible_log'};
    return this.digOne(block,isCurrent);
  }
  async mineStone(isCurrent) {
    if(!this.cfg.allowDig) return {status:'dig_disabled'};
    const tool=this.items().find(i=>PICK_RE.test(i.name));
    if(!tool)return {status:'missing_pickaxe'};
    let block=null;
    try {
      const py=this.bot.entity?.position?.y||0;
      block=this.bot.findBlock({matching:b=>NATURAL_STONE.has(b?.name)&&b.position.y>=Math.floor(py)&&b.position.distanceTo(this.bot.entity.position)>1.5,maxDistance:14});
    } catch{}
    if(!block) return {status:'no_visible_stone'};
    try {await this.bot.equip(tool,'hand');}catch(e){return {status:'equip_failed',error:e.message};}
    if(!isCurrent())return {status:'cancelled'};
    return this.digOne(block,isCurrent);
  }
  async craft(name,isCurrent,tableRequired=false) {
    if(!this.cfg.allowCraft)return {status:'craft_disabled'};
    const itemDef=this.bot.registry?.itemsByName?.[name];
    if(!itemDef)return {status:'unknown_recipe',item:name};
    let table=null;
    if(tableRequired){
      table=this.nearbyBlock('crafting_table',5);
      if(!table)return {status:'no_nearby_crafting_table'};
      if(!await this.gotoBlock(table,3,isCurrent))return {status:'cancelled'};
    }
    if(!isCurrent())return {status:'cancelled'};
    const recipes=this.bot.recipesFor(itemDef.id,null,1,table)||[];
    if(!recipes.length)return {status:'insufficient_materials_or_recipe',item:name};
    try {
      const before=countOf(this.items(),name);
      await this.bot.craft(recipes[0],1,table);
      const after=countOf(this.items(),name);
      return {status:after>before?'crafted_verified':'craft_called_no_inventory_delta',item:name,before,after};
    }catch(e){return {status:'craft_failed',item:name,error:e.message};}
  }
  async planks(isCurrent) {
    const log=this.items().find(x=>LOG_RE.test(x.name));
    if(!log)return {status:'no_logs'};
    const planks=log.name.replace(/_log$/,'_planks');
    return this.craft(planks,isCurrent,false);
  }
  async placeTable(isCurrent) {
    if(!this.cfg.allowPlace)return {status:'placement_disabled'};
    if(this.nearbyBlock('crafting_table',5))return {status:'table_already_nearby'};
    const item=this.item('crafting_table');if(!item)return {status:'no_table_item'};
    const pos=this.bot.entity?.position;
    if(!pos)return {status:'not_spawned'};
    const x=Math.floor(pos.x),y=Math.floor(pos.y)-1,z=Math.floor(pos.z);
    const offsets=[[2,0],[0,2],[-2,0],[0,-2],[2,1],[1,2],[-2,-1],[-1,-2]];
    for(const [dx,dz] of offsets) {
      const base=this.bot.blockAt(new Vec3(x+dx,y,z+dz));
      const above=this.bot.blockAt(new Vec3(x+dx,y+1,z+dz));
      if(!base||base.boundingBox!=='block'||!isAir(above))continue;
      if(!isCurrent())return {status:'cancelled'};
      try {
        await this.bot.equip(item,'hand');
        if(!await this.gotoBlock(base,3,isCurrent))return {status:'cancelled'};
        if(!isCurrent())return {status:'cancelled'};
        await this.bot.placeBlock(base,new Vec3(0,1,0));
        const placed=this.bot.blockAt(base.position.offset(0,1,0));
        return {status:placed?.name==='crafting_table'?'placed_verified':'placement_unverified',position:base.position};
      }catch(e){this.log('table_place_retry',{error:e.message});}
    }
    return {status:'no_safe_table_spot'};
  }
  async run(goal,isCurrent) {
    switch(goal){
      case 'GATHER_WOOD':return this.gatherWood(isCurrent);
      case 'MINE_STONE':return this.mineStone(isCurrent);
      case 'CRAFT_PLANKS':return this.planks(isCurrent);
      case 'CRAFT_STICKS':return this.craft('stick',isCurrent);
      case 'CRAFT_TABLE':return this.craft('crafting_table',isCurrent);
      case 'PLACE_TABLE':return this.placeTable(isCurrent);
      case 'CRAFT_WOODEN_PICKAXE':return this.craft('wooden_pickaxe',isCurrent,true);
      case 'CRAFT_STONE_PICKAXE':return this.craft('stone_pickaxe',isCurrent,true);
      default:return {status:'unsupported_skill',goal};
    }
  }
}
module.exports={SurvivalSkills,starterRecommendation,LOG_RE,countOf,countWhere,havePick,haveStonePick};
