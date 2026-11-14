'use strict';

// This is a low-level reflex controller, NOT another LLM. It must never await
// a network request inside the physics tick. Mineflayer normally emits one
// physicsTick every ~50 ms, as long as local simulation is running.
function attackCooldownMs(itemName='') {
  const item=String(itemName).toLowerCase();
  if (item.endsWith('_axe')) return 1000; // conservative: speed differs by material
  if (item.endsWith('_sword')) return 625; // swords have attack speed 1.6 / second
  if (item.endsWith('_trident')) return 900;
  return 700; // safe introductory rate, not an optimal PvP policy
}

class CombatController {
  constructor(bot, log=()=>{}, options={}) {
    this.bot=bot;
    this.log=log;
    this.enabled=Boolean(options.enabled);
    this.pvpEnabled=Boolean(options.pvpEnabled);
    this.minHealth=options.minHealth??7;
    this.attackRange=options.attackRange??2.9;
    this.maxRange=options.maxRange??16;
    this.target=null;
    this.kind=null;
    this.following=false;
    this.lastAttack=0;
    this.lastLook=0;
    this.aimPending=false;
  }
  get active() {return this.target!==null;}
  status() {return {enabled:this.enabled,pvpEnabled:this.pvpEnabled,active:this.active,kind:this.kind,
    target:this.target?.username??this.target?.name??null,health:this.bot.health};}
  engage(entity,kind='mob') {
    if(!this.enabled) return {status:'combat_disabled'};
    if(kind==='player'&&!this.pvpEnabled) return {status:'pvp_disabled'};
    if(!this.bot.entity?.position||!entity?.position) return {status:'target_unavailable'};
    if(this.bot.health<=this.minHealth) return {status:'health_too_low'};
    if(entity.id===this.bot.entity.id) return {status:'invalid_self_target'};
    this.stop('new_target');
    this.target=entity;this.kind=kind;
    this.lastAttack=0;this.lastLook=0;this.following=false;
    this.log('combat_started',{kind,target:entity.username||entity.name||entity.id});
    return {status:'combat_started',kind,target:entity.username||entity.name||entity.id};
  }
  stop(reason='manual') {
    const wasActive=this.active;
    this.target=null;this.kind=null;this.following=false;this.aimPending=false;
    if(wasActive){
      try{this.bot.pathfinder.setGoal(null);}catch{}
      try{this.bot.clearControlStates();}catch{}
      this.log('combat_stopped',{reason});
    }
  }
  tick(now=Date.now()) {
    if(!this.active||!this.enabled) return;
    if(this.kind==='player'&&!this.pvpEnabled){this.stop('pvp_disabled');return;}
    if(this.bot.health<=this.minHealth){this.stop('low_health');return;}
    const entity=this.bot.entities?.[this.target.id];
    if(!entity?.position||!this.bot.entity?.position){this.stop('target_lost');return;}
    const distance=this.bot.entity.position.distanceTo(entity.position);
    if(distance>this.maxRange){this.stop('too_far');return;}
    if(distance>this.attackRange){
      if(!this.following){
        try{const {goals:{GoalFollow}}=require('mineflayer-pathfinder');this.bot.pathfinder.setGoal(new GoalFollow(entity,2.3),true);this.following=true;}
        catch(error){this.log('combat_path_error',{error:error.message});this.stop('path_error');}
      }
    }else if(this.following){
      try{this.bot.pathfinder.setGoal(null);}catch{}
      this.following=false;
    }
    // Aim every ~100 ms, but never pile up asynchronous lookAt promises.
    if(now-this.lastLook>=100 && !this.aimPending){
      this.lastLook=now;this.aimPending=true;
      try{
        Promise.resolve(this.bot.lookAt(entity.position.offset(0,entity.height?entity.height*.65:1,0),true))
          .catch(e=>this.log('combat_aim_error',{error:e.message}))
          .finally(()=>{this.aimPending=false;});
      }catch(e){this.aimPending=false;this.log('combat_aim_error',{error:e.message});}
    }
    if(distance>this.attackRange)return;
    const cooldown=attackCooldownMs(this.bot.heldItem?.name);
    if(now-this.lastAttack<cooldown)return;
    // Fail closed when the raycast hits another entity (e.g., a bystander).
    if(typeof this.bot.entityAtCursor==='function'){
      try{const aimed=this.bot.entityAtCursor(3.5);if(aimed&&aimed.id!==entity.id)return;}
      catch(e){this.log('combat_ray_error',{error:e.message});return;}
    }
    try{this.bot.attack(entity);this.lastAttack=now;this.log('combat_attack',{kind:this.kind,entity:entity.id});}
    catch(e){this.log('combat_attack_error',{error:e.message});}
  }
}
module.exports={CombatController,attackCooldownMs};
