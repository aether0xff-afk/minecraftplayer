'use strict';

// A motor frame is a COMPOSITE control state, not a mutually exclusive action.
// Move, look and hands are evaluated together on each Minecraft physics tick.
const KEYS = Object.freeze(['forward','back','left','right','jump','sprint','sneak']);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const finite = v => typeof v === 'number' && Number.isFinite(v);
const EMPTY = Object.freeze({forward:false, back:false, left:false, right:false,
  jump:false, sprint:false, sneak:false, use:false, attack:false});

function parseFrame(src) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) throw new TypeError('Motor frame must be a JSON object');
  const frame = {...EMPTY};
  for (const k of [...KEYS, 'use', 'attack']) {
    if (src[k] !== undefined) {
      if (typeof src[k] !== 'boolean') throw new TypeError(`${k} must be boolean`);
      frame[k] = src[k];
    }
  }
  if (src.moveWorld !== undefined) {
    const v=src.moveWorld;
    if (!v || !finite(v.x) || !finite(v.z) || Math.abs(v.x)>1 || Math.abs(v.z)>1)
      throw new TypeError('moveWorld requires finite x,z in [-1,1]');
    frame.moveWorld={x:v.x,z:v.z};
  }
  if (src.lookAt !== undefined) {
    const p=src.lookAt;
    if (!p || !finite(p.x) || !finite(p.y) || !finite(p.z)) throw new TypeError('lookAt requires finite x,y,z');
    frame.lookAt={x:p.x,y:p.y,z:p.z};
  } else if (src.look !== undefined) {
    const p=src.look;
    if (!p || !finite(p.yaw) || !finite(p.pitch)) throw new TypeError('look requires finite yaw,pitch (radians)');
    frame.look={yaw:p.yaw,pitch:clamp(p.pitch,-Math.PI/2,Math.PI/2)};
  }
  if (src.hotbar !== undefined) {
    if (!Number.isInteger(src.hotbar) || src.hotbar < 0 || src.hotbar > 8)
      throw new TypeError('hotbar must be an integer 0..8');
    frame.hotbar=src.hotbar;
  }
  return frame;
}

function aimAt(from, point) {
  const dx=point.x-from.x, dz=point.z-from.z, dy=point.y-from.y;
  return {yaw:Math.atan2(-dx,dz),pitch:-Math.atan2(dy,Math.hypot(dx,dz))};
}
function worldToKeys(v, yaw) {
  const len=Math.hypot(v.x,v.z);
  if(len<0.08)return {forward:false,back:false,left:false,right:false};
  const x=v.x/Math.max(len,1), z=v.z/Math.max(len,1);
  const f=-x*Math.sin(yaw)+z*Math.cos(yaw);
  const r=-x*Math.cos(yaw)-z*Math.sin(yaw);
  // Deadzone avoids jitter at diagonals; both axes may be held concurrently.
  return {forward:f>0.25,back:f< -0.25,left:r< -0.25,right:r>0.25};
}
function constrainFrame(raw, observed={}) {
  const f={...raw};
  if (f.forward && f.back) {f.forward=false;f.back=false;}
  if (f.left && f.right) {f.left=false;f.right=false;}
  if (f.sneak) f.sprint=false;
  // A drawn bow reduces movement speed and disallows starting a sprint.
  // Do NOT ban ordinary walking, strafing or looking while charging.
  if (f.use && /(?:^|_)bow$/.test(String(observed.heldItemName||''))) f.sprint=false;
  if (observed.food !== undefined && observed.food<=6) f.sprint=false;
  return f;
}

class MotorController {
  constructor(bot, log=()=>{}, config={}) {
    this.bot=bot;this.log=log;this.config=config;
    this.enabled=false;this.frame=parseFrame({});this.source=null;
    this.using=false;this.lastAttackAt=-Infinity;
    this.lastLookAt=0;this.lookPending=false;
    this.ticks=0;this.maxTickMs=0;this.lastFrameAt=0;
    this.frameTtlMs=Math.max(250,Number(config.motorFrameTtlMs||5000));
    this.lastApplied={};this.lastReason='not_started';
  }
  enable(){
    if (!this.config.move) return {status:'movement_disabled'};
    this.enabled=true;this.ticks=0;this.lastReason='enabled';
    return {status:'motor_enabled'};
  }
  setFrame(value) {this.frame=parseFrame(value);this.lastFrameAt=Date.now();return this.frame;}
  setPolicy(fn){if(fn!==null && typeof fn!=='function')throw new TypeError('policy must be a function');this.source=fn;}
  disable(reason='manual') {
    this.enabled=false;this.source=null;this.lastReason=reason;
    if(this.using){try{this.bot.deactivateItem?.();}catch{} this.using=false;}
    try{this.bot.clearControlStates?.();}catch{}
    this.lastApplied={};
  }
  status(){return {enabled:this.enabled,ticks:this.ticks,maxTickMs:Math.round(this.maxTickMs*100)/100,
    lastFrameAt:this.lastFrameAt,holdingUse:this.using,frame:this.frame,applied:this.lastApplied,reason:this.lastReason};}
  attackAllowed(entity) {
    if(!this.config.attack || !entity)return false;
    if(entity.id===this.bot.entity?.id)return false;
    const playerName=entity.username;
    if(playerName){return Boolean(this.config.pvp && this.config.pvpAllow?.has(playerName.toLowerCase()));}
    // Do not attack unidentified entities or other peaceful mobs by default.
    const allowed=new Set(['zombie','skeleton','spider','creeper','drowned','husk','stray','witch','pillager','endermite','silverfish']);
    return allowed.has(entity.name);
  }
  tick(now=Date.now()) {
    if(!this.enabled || !this.bot.entity?.position)return;
    const began=performance.now();
    try{
      let frame;
      try {
        frame=this.source ? parseFrame(this.source(this.bot,now)) :
          (Date.now()-this.lastFrameAt>this.frameTtlMs ? parseFrame({}) : this.frame);
      } catch(e) {
        this.log('motor_policy_error',{error:e.message});
        frame=parseFrame({}); // Fail to neutral controls instead of crashing the bot.
      }
      if(frame.moveWorld){
        // Compensate for changes in head direction so desired world travel can
        // continue while camera turns to a different target.
        frame={...frame,...worldToKeys(frame.moveWorld,this.bot.entity.yaw||0)};
      }
      frame=constrainFrame(frame,{heldItemName:this.bot.heldItem?.name,food:this.bot.food});
      for(const key of KEYS){
        const want=Boolean(frame[key]);
        if(this.bot.getControlState?.(key)!==want)this.bot.setControlState(key,want);
      }
      if(frame.hotbar!==undefined&&frame.hotbar!==this.bot.quickBarSlot){
        this.bot.setQuickBarSlot?.(frame.hotbar);
      }
      const look=frame.lookAt?aimAt(this.bot.entity.position,frame.lookAt):frame.look;
      if(look && now-this.lastLookAt>=45 && !this.lookPending){
        this.lastLookAt=now;this.lookPending=true;
        // Promise-based Mineflayer look() is dispatched without blocking ticks.
        try{Promise.resolve(this.bot.look(look.yaw,look.pitch,true))
          .catch(e=>this.log('motor_look_error',{error:e.message}))
          .finally(()=>{this.lookPending=false;});}
        catch(e){this.lookPending=false;this.log('motor_look_error',{error:e.message});}
      }
      // Held-use has rising and falling edges. Bow draw can last multiple ticks.
      if(frame.use&&!this.using){
        try{this.bot.activateItem?.();this.using=true;}
        catch(e){this.log('motor_use_error',{error:e.message});}
      }else if(!frame.use&&this.using){
        try{this.bot.deactivateItem?.();}catch(e){this.log('motor_use_error',{error:e.message});}
        this.using=false;
      }
      if(frame.attack && now-this.lastAttackAt>=650 && this.config.attack){
        let entity=null;
        try{entity=this.bot.entityAtCursor?.(3.15)||null;}catch(e){this.log('motor_target_error',{error:e.message});}
        if(this.attackAllowed(entity)){
          try{this.bot.attack(entity);this.lastAttackAt=now;}
          catch(e){this.log('motor_attack_error',{error:e.message});}
        }
      }
      this.ticks++;
      this.lastApplied={...frame};
    }finally{this.maxTickMs=Math.max(this.maxTickMs,performance.now()-began);}
  }
}
module.exports={MotorController,parseFrame,aimAt,worldToKeys,constrainFrame};
