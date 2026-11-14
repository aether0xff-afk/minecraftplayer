'use strict';

// Event-driven deliberation; physical movement and combat are NOT paced by this.
// The clock and random generator are injectable so scheduling can be tested.
const PRESETS = Object.freeze({
  relaxed: Object.freeze({backgroundMinMs:32000,backgroundMaxMs:52000,minCommitMs:18000,minPlanGapMs:2000,waypointPauseMinMs:350,waypointPauseMaxMs:850}),
  natural: Object.freeze({backgroundMinMs:20000,backgroundMaxMs:35000,minCommitMs:11000,minPlanGapMs:1200,waypointPauseMinMs:180,waypointPauseMaxMs:550}),
  focused: Object.freeze({backgroundMinMs:14000,backgroundMaxMs:24000,minCommitMs:6500,minPlanGapMs:800,waypointPauseMinMs:80,waypointPauseMaxMs:250})
});
const EVENT_PRIORITY=Object.freeze({
  hurt:3, death:3, respawn:3, low_health:3,
  addressed_by_player:2,hostile_changed:2,task_finished:2,goal_completed:2,path_failed:2,
  manual_plan:2,manual_start:2,spawn:2,
  players_changed:1,hungry:1,movement_enabled:1,dig_enabled:1,craft_enabled:1,
  combat_enabled:1,pvp_enabled:1,table_placement_enabled:1,
});
function priorityFor(reason) {return EVENT_PRIORITY[reason]??1;}
class TempoDirector {
  constructor(mode='natural',clock=Date.now,random=Math.random){
    this.clock=clock;this.random=random;this.mode=PRESETS[mode]?mode:'natural';
    this.lastPlanStart=-Infinity;this.lastPlanEnd=-Infinity;this.nextBackgroundAt=0;
    this.pending=null;this.eventTimes=new Map();
  }
  get settings(){return PRESETS[this.mode];}
  between(a,b){return Math.round(a+this.random()*(b-a));}
  setMode(mode){
    if(!PRESETS[mode])return false;
    this.mode=mode;
    // Do not drop safety events; make changed cadence effective immediately.
    this.nextBackgroundAt=Math.min(this.nextBackgroundAt,this.clock()+this.settings.backgroundMaxMs);
    return true;
  }
  request(reason='event',now=this.clock()){
    const priority=priorityFor(reason);
    const last=this.eventTimes.get(reason)??-Infinity;
    // Debounce noisy entity-change/hunger signals. Never debounce critical events.
    if(priority<3&&now-last<(priority===1?4500:750))return false;
    this.eventTimes.set(reason,now);
    if(!this.pending||priority>=this.pending.priority) this.pending={reason,priority,at:now};
    return true;
  }
  claim({planning=false,asyncBusy=false,activeGoal=false}={},now=this.clock()){
    if(planning)return null;
    const pending=this.pending;
    const minGap=this.settings.minPlanGapMs;
    if(pending){
      // Never cancel ongoing mining/crafting for idle background reconsideration.
      // Important events (chat, danger, completion) can still be considered.
      if(pending.priority<=1&&asyncBusy)return null;
      if(now-this.lastPlanStart<minGap&&pending.priority<3)return null;
      this.pending=null;this.lastPlanStart=now;
      return {...pending};
    }
    if(asyncBusy||now<this.nextBackgroundAt||now-this.lastPlanStart<this.settings.minCommitMs)return null;
    this.lastPlanStart=now;
    return {reason:activeGoal?'background_review':'goal_needed',priority:0,at:now};
  }
  finish(now=this.clock()){
    this.lastPlanEnd=now;
    this.nextBackgroundAt=now+this.between(this.settings.backgroundMinMs,this.settings.backgroundMaxMs);
  }
  pauseForWaypoint(){return this.between(this.settings.waypointPauseMinMs,this.settings.waypointPauseMaxMs);}
  snapshot(){return {mode:this.mode,pending:this.pending,nextBackgroundInMs:Math.max(0,this.nextBackgroundAt-this.clock()),...this.settings};}
}
function preserveActivity({current,next,priority=0,now=Date.now(),minCommitMs=11000,asyncBusy=false}){
  if(!current||!next||current.goal===next.goal&&current.target===next.target)return false;
  // A safety decision can interrupt a task only for an actual evasive or combat goal.
  if(next.goal==='FLEE'&&priority>=2)return false;
  if(priority>=3&&['FIGHT_MOB','FIGHT_PLAYER'].includes(next.goal))return false;
  if(asyncBusy)return true;
  // Conversation may occur alongside an existing activity (say is independent).
  if(next.goal==='TALK'&&priority>=2)return true;
  if(['FIGHT_MOB','FIGHT_PLAYER','FLEE'].includes(current.goal) && priority<3)return true;
  return priority<=1 && now-current.since<minCommitMs;
}
module.exports={PRESETS,TempoDirector,preserveActivity,priorityFor};
