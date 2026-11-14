'use strict';
const {goals:{GoalNear,GoalFollow}}=require('mineflayer-pathfinder');
const {HOSTILES,FOODS}=require('./perception');
const {SurvivalSkills}=require('./survival');
const ASYNC_TASKS=new Set(['GATHER_WOOD','MINE_STONE','CRAFT_PLANKS','CRAFT_STICKS','CRAFT_TABLE','PLACE_TABLE','CRAFT_WOODEN_PICKAXE','CRAFT_STONE_PICKAXE']);
class GoalExecutor {
  constructor(bot,combat,log,cfg){
    this.bot=bot;this.combat=combat;this.log=log;this.cfg=cfg;
    this.skills=new SurvivalSkills(bot,log,cfg);
    this.current=null;this.sequence=0;this.waypoint=null;this.lastWaypointAt=0;
    this.emergencyUntil=0;this.lastEmergency=0;this.previousFailure=null;
    this.heading=null;this.waypointTimer=null;
  }
  stop(reason='manual'){
    if(this.waypointTimer){clearTimeout(this.waypointTimer);this.waypointTimer=null;}
    this.sequence++;this.current=null;this.waypoint=null;this.emergencyUntil=0;
    this.combat.stop(reason);
    try{this.bot.pathfinder.setGoal(null);}catch{}
    try{this.bot.stopDigging?.();}catch{}
    try{this.bot.clearControlStates();}catch{}
  }
  player(name){return Object.entries(this.bot.players||{}).find(([n])=>n.toLowerCase()===String(name).toLowerCase())?.[1]?.entity||null;}
  hostile(){const p=this.bot.entity?.position;return p&&this.bot.nearestEntity(e=>HOSTILES.has(e.name)&&e.position&&p.distanceTo(e.position)<15);}
  wander(){
    if(!this.cfg.move||!this.bot.entity?.position)return;
    const p=this.bot.entity.position;
    // Explore in locally consistent directions, not pure random zig-zags.
    this.heading=this.heading===null||Math.random()<0.18 ? Math.random()*Math.PI*2 : this.heading+(Math.random()-0.5)*1.1;
    const direction=this.heading,range=7+Math.round(Math.random()*7);
    const wp={x:Math.round(p.x+Math.cos(direction)*range),y:Math.round(p.y),z:Math.round(p.z+Math.sin(direction)*range)};
    this.waypoint=wp;this.lastWaypointAt=Date.now();
    this.bot.pathfinder.setGoal(new GoalNear(wp.x,wp.y,wp.z,2));
    this.log('waypoint',{goal:this.current?.goal,target:wp});
  }
  fleeFrom(entity,durationMs=4000){
    const pos=this.bot.entity?.position,threat=entity?.position;
    if(!this.cfg.move||!pos||!threat)return false;
    const dx=pos.x-threat.x,dz=pos.z-threat.z;const r=Math.hypot(dx,dz)||1;
    this.waypoint={x:Math.round(pos.x+dx/r*11),y:Math.round(pos.y),z:Math.round(pos.z+dz/r*11)};
    this.combat.stop('flee');
    this.bot.pathfinder.setGoal(new GoalNear(this.waypoint.x,this.waypoint.y,this.waypoint.z,2));
    this.emergencyUntil=Date.now()+durationMs;
    return true;
  }
  emergencyTick(now=Date.now()){
    if(!this.cfg.autonomy||!this.cfg.move||!this.bot.entity||now-this.lastEmergency<1200||now<this.emergencyUntil)return;
    if(this.bot.health>this.cfg.criticalHealth)return;
    const threat=this.hostile();
    if(!threat||this.bot.entity.position.distanceTo(threat.position)>5)return;
    this.lastEmergency=now;
    this.sequence++;this.current=null;try{this.bot.stopDigging?.();}catch{}
    if(this.fleeFrom(threat,4000))this.log('reflex_flee',{health:this.bot.health,mob:threat.name});
  }
  async eat(seq){
    const item=this.bot.inventory?.items?.().find(x=>FOODS.has(x.name));
    if(!item)return {status:'no_food'};
    try{await this.bot.equip(item,'hand');if(seq!==this.sequence)return {status:'cancelled'};
      const before=this.bot.food;await this.bot.consume();
      return {status:this.bot.food>before?'ate_verified':'eat_called_no_delta',item:item.name,foodBefore:before,foodAfter:this.bot.food};
    }catch(e){return {status:'eat_failed',error:e.message};}
  }
  async apply(plan){
    if(this.emergencyUntil>Date.now())return {status:'emergency_reflex_active'};
    if(this.current?.goal===plan.goal&&this.current?.target===plan.target &&
       (ASYNC_TASKS.has(plan.goal)||['EXPLORE','FOLLOW_PLAYER','FIGHT_MOB','FIGHT_PLAYER'].includes(plan.goal)))
      return {status:'continuing',goal:plan.goal};
    this.stop('new_goal');
    this.current={goal:plan.goal,target:plan.target,since:Date.now()};
    const seq=this.sequence;const move=this.cfg.move,attack=this.cfg.attack;
    let status;
    switch(plan.goal){
      case 'IDLE':case 'TALK':status={status:'idle'};break;
      case 'EXPLORE':
        if(!move)status={status:'movement_disabled'};
        else{this.wander();status={status:'exploring'};}break;
      case 'APPROACH_PLAYER':case 'FOLLOW_PLAYER':{
        const e=this.player(plan.target);
        if(!move)status={status:'movement_disabled'};
        else if(!e?.position)status={status:'player_not_visible'};
        else{this.bot.pathfinder.setGoal(new GoalFollow(e,plan.goal==='FOLLOW_PLAYER'?3:2.8),plan.goal==='FOLLOW_PLAYER');
          status={status:'following',target:plan.target};}
        break;
      }
      case 'FLEE':{
        const e=this.hostile()||this.player(plan.target);
        status=e&&this.fleeFrom(e)?{status:'fleeing'}:{status:'no_threat_or_movement_disabled'};break;
      }
      case 'FIGHT_MOB':{
        const e=this.hostile();status=attack&&move&&e?this.combat.engage(e,'mob'):{status:'combat_unavailable'};break;
      }
      case 'FIGHT_PLAYER':{
        const e=this.player(plan.target);const permitted=this.cfg.pvp&&this.cfg.pvpAllow.has(plan.target.toLowerCase());
        status=attack&&move&&permitted&&e?this.combat.engage(e,'player'):{status:'pvp_unavailable'};break;
      }
      case 'EAT':{
        status={status:'eating_started'};
        void this.eat(seq).then(result=>this.completeTask(seq,'EAT',result)).catch(e=>this.completeTask(seq,'EAT',{status:'eat_failed',error:e.message}));
        break;
      }
      default:{
        if(ASYNC_TASKS.has(plan.goal)){
          status={status:'task_started'};
          void this.skills.run(plan.goal,()=>seq===this.sequence&&this.cfg.autonomy)
            .then(result=>this.completeTask(seq,plan.goal,result))
            .catch(e=>this.completeTask(seq,plan.goal,{status:'skill_error',error:e.message}));
        }else status={status:'unknown_goal'};
      }
    }
    this.log('goal_started',{goal:plan.goal,target:plan.target,...status});
    return status;
  }
  completeTask(seq,goal,result){
    this.log('task_result',{goal,...result});
    if(seq!==this.sequence)return;
    if(/failed|unavailable|timeout|no_|missing|insufficient|disabled|error/.test(result.status||'')){
      this.previousFailure={goal,status:result.status,at:Date.now()};
    }else this.previousFailure=null;
    this.current=null;
    this.cfg.requestReplan('task_finished');
  }
  onGoalReached(){
    if(this.current?.goal==='EXPLORE'&&this.cfg.move){
      // Short observation pause only between waypoints. Never throttle combat/reflex ticks.
      const seq=this.sequence;
      if(this.waypointTimer)clearTimeout(this.waypointTimer);
      const delay=this.cfg.tempoPauseMs?.()??250;
      this.waypointTimer=setTimeout(()=>{this.waypointTimer=null;
        if(this.sequence===seq&&this.current?.goal==='EXPLORE'&&this.cfg.move)this.wander();
      },delay);
      this.waypointTimer.unref?.();
      return;
    }
    if(this.current?.goal==='APPROACH_PLAYER'||this.current?.goal==='FLEE'){
      this.log('goal_completed',{goal:this.current.goal});this.cfg.requestReplan('goal_completed');
    }
  }
  onNoPath(){
    if(this.current&&!ASYNC_TASKS.has(this.current.goal)){
      const failed=this.current;this.stop('no_path');
      this.log('goal_failed',{goal:failed.goal,reason:'no_path'});this.cfg.requestReplan('path_failed');
    }
  }
  everySecond(){
    if(this.current?.goal!=='EXPLORE'||!this.cfg.move)return;
    if(!this.waypointTimer&&Date.now()-this.lastWaypointAt>15000){this.log('waypoint_timeout',{waypoint:this.waypoint});this.wander();}
  }
}
module.exports={GoalExecutor,ASYNC_TASKS};
