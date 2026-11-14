'use strict';
require('dotenv').config();
const fs=require('node:fs');
const path=require('node:path');
const readline=require('node:readline');
const mineflayer=require('mineflayer');
const {pathfinder,Movements}=require('mineflayer-pathfinder');
const {CombatController}=require('./combat');
const {MotorController}=require('./motor');
const {installTickEndCompatibility,plainKickReason}=require('./protocol-compat');
const {perceive}=require('./perception');
const {ollamaPlan}=require('./planner');
const {GoalExecutor}=require('./executor');
const {WorldMemory}=require('./memory');
const {TempoDirector,preserveActivity}=require('./tempo');
const {ASYNC_TASKS}=require('./executor');

const bool=(key,def=false)=>String(process.env[key]??def).toLowerCase()==='true';
const names=(key)=>new Set(String(process.env[key]||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean));
const config={
  host:process.env.MC_HOST||'127.0.0.1',port:Number(process.env.MC_PORT||25568),version:process.env.MC_VERSION||'26.1',
  name:process.env.MC_LOCAL_NAME||'WildPlayer',realName:process.env.MC_REAL_NAME||'',
  autonomy:bool('AUTONOMY'),move:bool('ALLOW_MOVEMENT'),attack:bool('ALLOW_ATTACK'),allowDig:bool('ALLOW_DIG'),
  allowCraft:bool('ALLOW_CRAFT'),allowPlace:bool('ALLOW_PLACE_TABLE'),
  pvp:false,pvpPermitted:bool('ALLOW_PVP'),pvpAllow:names('PVP_ALLOWED_PLAYERS'),
  ollamaUrl:process.env.OLLAMA_URL||'http://127.0.0.1:11434',ollamaModel:process.env.OLLAMA_MODEL||'qwen3.5:4b',ollamaContext:Number(process.env.OLLAMA_CONTEXT||4096),
  tempo:process.env.PLAY_TEMPO||'natural',motorFrameTtlMs:Number(process.env.MOTOR_FRAME_TTL_MS||5000),
  llmTimeoutMs:Math.max(5000,Number(process.env.LLM_TIMEOUT_MS||45000)),
  chatCooldownMs:Math.max(3000,Number(process.env.CHAT_COOLDOWN_MS||8000)),
  criticalHealth:Number(process.env.CRITICAL_HEALTH||8),minHealth:Number(process.env.MIN_COMBAT_HEALTH||9),
  owners:names('OWNER_NAMES'),viewerPort:Number(process.env.VIEWER_PORT||3007),
  viewerDistance:Math.max(2,Math.min(8,Number(process.env.VIEWER_DISTANCE||4))),requestReplan:()=>{}
};
fs.mkdirSync(path.resolve('data'),{recursive:true});
const logFile=path.resolve('data','trace.jsonl');
const log=(type,record={})=>{
  const entry={ts:new Date().toISOString(),type,...record};
  console.log(`[${entry.ts}] ${type}`,JSON.stringify(record));
  try{fs.appendFileSync(logFile,JSON.stringify(entry)+'\n');}catch(e){console.error('trace write failed',e.message);}
};
const memory=new WorldMemory(path.resolve('data','memory.json'),log);
const tempo=new TempoDirector(config.tempo);
config.tempo=tempo.mode;
config.tempoPauseMs=()=>tempo.pauseForWaypoint();
const bot=mineflayer.createBot({host:config.host,port:config.port,version:config.version,
  username:config.name,auth:'offline',hideErrors:false,checkTimeoutInterval:30000});
if(config.version==='26.1')installTickEndCompatibility(bot._client,e=>log('tick_end_warning',{error:e}));
bot.loadPlugin(pathfinder);
const combat=new CombatController(bot,log,{enabled:config.attack,pvpEnabled:false,minHealth:config.minHealth});
const executor=new GoalExecutor(bot,combat,log,config);
const motor=new MotorController(bot,log,config);
let ready=false,closed=false,viewerActive=false,planning=false;
let lastPlanAt=0,lastPlanStart=0,lastChatSent=0,lastChatContent='',lastChatReceived=null,lastPlan=null;
let lastPlayerSet='',lastHostileId='',healthBefore=20,lastReflexAt=0;
const requestReplan=(reason='event')=>tempo.request(reason);
config.requestReplan=requestReplan;

function movementSetup(){
  const m=new Movements(bot);
  // The pathfinder never digs or builds without an explicit gather task.
  m.canDig=false;m.allow1by1towers=false;m.allowParkour=false;m.allowFreeMotion=false;
  m.allowSprinting=true;
  bot.pathfinder.setMovements(m);
}
function say(text){
  const message=String(text||'').replace(/[\r\n]/g,' ').trim().slice(0,85);
  if(!ready||!message||message.startsWith('/')||Date.now()-lastChatSent<config.chatCooldownMs)return false;
  if(message===lastChatContent&&Date.now()-lastChatSent<120000)return false;
  try{bot.chat(message);lastChatSent=Date.now();lastChatContent=message;log('chat_sent',{message});return true;}
  catch(e){log('chat_error',{error:e.message});return false;}
}
function observe(){return perceive(bot,config);}
async function planOnce(claim){
  if(!ready||!config.autonomy||planning||!claim)return;
  planning=true;
  const cause=claim.reason,priority=claim.priority;
  lastPlanStart=Date.now();
  const message=lastChatReceived;
  const taskSequence=executor.sequence;
  try{
    const state=observe();if(!state)return;
    const context=memory.snapshot(state.players);
    if(message)context.latestChat=message;
    if(executor.current)context.currentActivity={goal:executor.current.goal,target:executor.current.target,
      seconds:Math.round((Date.now()-executor.current.since)/1000)};
    if(executor.previousFailure && Date.now()-executor.previousFailure.at<45000)context.lastSkillFailure=executor.previousFailure;
    const plan=await ollamaPlan(config,state,context);
    if(!config.autonomy||!ready)return;
    // Replan if the active task changed during slow inference.
    if(taskSequence!==executor.sequence && priority<3){
      log('stale_plan',{cause,reason:'activity_changed_during_inference',goal:plan.goal});
      requestReplan('task_finished');return;
    }
    if(['TALK','APPROACH_PLAYER','FOLLOW_PLAYER','FIGHT_PLAYER'].includes(plan.goal) &&
       !observe()?.players.some(p=>p.name.toLowerCase()===plan.target.toLowerCase())){
      log('stale_plan',{goal:plan.goal,target:plan.target});requestReplan('target_disappeared');return;
    }
    if(message&&message===lastChatReceived){
      if(plan.social_delta)memory.adjust(message.from,plan.social_delta*0.02);
      lastChatReceived=null;
    }
    const busy=!!executor.current&&ASYNC_TASKS.has(executor.current.goal);
    const kept=preserveActivity({current:executor.current,next:plan,priority,now:Date.now(),
      minCommitMs:tempo.settings.minCommitMs,asyncBusy:busy});
    const result=kept?{status:'activity_continues',goal:executor.current.goal}:await executor.apply(plan);
    if(plan.say)say(plan.say);
    if(!kept){lastPlan=plan;memory.goal(plan,result.status);}
    log('plan',{cause,priority,goal:plan.goal,target:plan.target,reason:plan.reason,
      decisionMs:plan.decisionMs,result,ongoing:executor.current?.goal||null,
      trust:message?memory.trust(message.from):null});
  }catch(e){
    log('plan_error',{error:e.message,elapsedMs:Date.now()-lastPlanStart});
    // Keep executing the old goal while recovering from a slow or failed LLM.
  }finally{planning=false;lastPlanAt=Date.now();tempo.finish();}
}
function viewerOn(){
  if(!ready||viewerActive)return;
  try{
    require('prismarine-viewer').mineflayer(bot,{port:config.viewerPort,firstPerson:true,viewDistance:config.viewerDistance});
    viewerActive=true;log('viewer_started',{url:`http://127.0.0.1:${config.viewerPort}`,note:'26.x rendering compatibility not guaranteed'});
  }catch(e){log('viewer_error',{error:e.message});}
}
function viewerOff(){
  if(!viewerActive)return;
  try{bot.viewer?.close?.();viewerActive=false;log('viewer_stopped');}
  catch(e){log('viewer_error',{error:e.message});}
}
function shutdown(){
  if(closed)return;closed=true;config.autonomy=false;motor.disable('shutdown');viewerOff();executor.stop('shutdown');memory.save();
  try{bot.quit('WildPlayer stopped');}catch{}
  setTimeout(()=>process.exit(0),500).unref();
}
bot.once('spawn',()=>{
  ready=true;movementSetup();healthBefore=bot.health;
  log('spawn',{username:bot.username,version:config.version,model:config.ollamaModel,autonomy:config.autonomy});
  console.log('CLI: status | start | pause | tempo natural/relaxed/focused | plan now | motor on/off | motor frame <JSON> | motor status | movement on/off | dig on/off | craft on/off | place on/off | combat on/off | pvp on/off | fight mob | fight player <name> | fight stop | viewer on/off | say <text> | quit');
  requestReplan('spawn');
});
bot.on('chat',(name,message)=>{
  if(!name||name===bot.username||name===config.name||name===config.realName)return;
  const clean=String(message||'').slice(0,160);
  log('chat_heard',{from:name,message:clean});memory.event('chat',{from:name,text:clean});
  if(clean.startsWith('!wild')&&config.owners.has(name.toLowerCase())){
    const cmd=clean.slice(5).trim();
    if(cmd==='pause'){config.autonomy=false;executor.stop('owner_pause');say('잠깐 멈출게.');return;}
    if(cmd==='start'){config.autonomy=true;requestReplan('owner_start');say('좋아, 주변 상황을 볼게.');return;}
    if(cmd==='status'){say(`체력 ${bot.health}, 식량 ${bot.food}, 목표 ${lastPlan?.goal||'없음'}`);return;}
  }
  // Incoming chat is untrusted environmental context, never a command or source code.
  if(clean.toLowerCase().includes(bot.username.toLowerCase())||
     (config.realName&&clean.toLowerCase().includes(config.realName.toLowerCase()))||
     clean.startsWith('!wild talk ')){
    lastChatReceived={from:name,text:clean,at:Date.now()};requestReplan('addressed_by_player');
  }
});
bot.on('health',()=>{
  if(bot.health<healthBefore){memory.event('hurt',{health:bot.health,position:observe()?.position});requestReplan('hurt');}
  if(bot.food<12)requestReplan('hungry');
  healthBefore=bot.health;
});
bot.on('death',()=>{memory.event('death',{position:observe()?.position});executor.stop('death');requestReplan('death');});
bot.on('respawn',()=>{log('respawn');requestReplan('respawn');});
bot.on('physicsTick',()=>{
  if(motor.enabled)motor.tick();else combat.tick();
  // Tactical event checks are cheap and NEVER call an LLM directly.
  const now=Date.now();if(now-lastReflexAt<300)return;lastReflexAt=now;
  if(!motor.enabled)executor.emergencyTick(now);
  if(!config.autonomy||motor.enabled)return;
  const s=observe();if(!s)return;
  const nearPlayers=s.players.map(p=>p.name).sort().join('|');
  const nearHostile=s.nearestHostile&&s.nearestHostile.distance<7?`${s.nearestHostile.id}`:'';
  if(nearPlayers!==lastPlayerSet){lastPlayerSet=nearPlayers;requestReplan('players_changed');}
  if(nearHostile!==lastHostileId){lastHostileId=nearHostile;requestReplan('hostile_changed');}
});
bot.on('goal_reached',()=>{log('path_reached');executor.onGoalReached();});
bot.on('path_update',r=>{if(r.status==='noPath'){log('path_no_route');executor.onNoPath();}});
bot.on('kicked',(reason,loggedIn)=>{ready=false;log('kicked',{reasonText:plainKickReason(reason),loggedIn});});
bot.on('error',e=>log('bot_error',{error:e.stack||e.message}));
bot.on('end',reason=>{
  ready=false;viewerOff();log('disconnected',{reason});memory.save();
  if(!closed){ // Exit nonzero; scripts/run-whitepc.ps1 restarts with backoff.
    try{executor.stop('disconnected');}catch{}
    setTimeout(()=>process.exit(2),1000).unref();
  }
});
setInterval(()=>{
  if(!ready)return;
  executor.everySecond();
  if(!config.autonomy||motor.enabled)return;
  // Deliberation is event-driven. Physical control continues every physicsTick.
  const activeGoal=!!executor.current;
  const asyncBusy=activeGoal&&ASYNC_TASKS.has(executor.current.goal);
  const claim=tempo.claim({planning,asyncBusy,activeGoal});
  if(claim)void planOnce(claim);
},500).unref();

const rl=readline.createInterface({input:process.stdin,output:process.stdout});
rl.on('line',raw=>{
  const cmd=raw.trim();
  if(cmd==='quit'||cmd==='exit'){shutdown();return;}
  if(cmd==='start'){if(motor.enabled){console.log('motor off before restarting autonomy');return;}config.autonomy=true;requestReplan('manual_start');log('autonomy_started');return;}
  if(cmd==='pause'){config.autonomy=false;motor.disable('pause');executor.stop('pause');log('autonomy_paused');return;}
  if(cmd==='plan now'){requestReplan('manual_plan');log('replan_requested');return;}
  if(cmd.startsWith('tempo ')){const mode=cmd.slice(6).trim();if(tempo.setMode(mode)){log('tempo_changed',{mode});}else console.log('Use: tempo relaxed | tempo natural | tempo focused');return;}
  if(cmd==='movement on'){config.move=true;requestReplan('movement_enabled');log('movement_enabled');return;}
  if(cmd==='movement off'){config.move=false;motor.disable('movement_disabled');executor.stop('movement_disabled');log('movement_disabled');return;}
  if(cmd==='combat on'){config.attack=true;combat.enabled=true;requestReplan('combat_enabled');log('combat_enabled');return;}
  if(cmd==='combat off'){config.attack=false;combat.enabled=false;motor.disable('combat_disabled');executor.stop('combat_disabled');log('combat_disabled');return;}
  if(cmd==='dig on'){if(!config.move){console.log('movement on is required before dig on');return;}config.allowDig=true;requestReplan('dig_enabled');log('dig_enabled');return;}
  if(cmd==='dig off'){config.allowDig=false;executor.stop('dig_disabled');log('dig_disabled');return;}
  if(cmd==='craft on'){config.allowCraft=true;requestReplan('craft_enabled');log('craft_enabled');return;}
  if(cmd==='craft off'){config.allowCraft=false;executor.stop('craft_disabled');log('craft_disabled');return;}
  if(cmd==='place on'){config.allowPlace=true;requestReplan('table_placement_enabled');log('place_enabled');return;}
  if(cmd==='place off'){config.allowPlace=false;log('place_disabled');return;}
  if(cmd==='pvp on'){
    if(!config.pvpPermitted||!config.pvpAllow.size){console.log('Set ALLOW_PVP=true and PVP_ALLOWED_PLAYERS=<opted-in name> in .env; restart.');return;}
    config.pvp=true;combat.pvpEnabled=true;requestReplan('pvp_enabled');log('pvp_enabled',{allowed:[...config.pvpAllow]});return;
  }
  if(cmd==='pvp off'){config.pvp=false;combat.pvpEnabled=false;if(combat.kind==='player')combat.stop('pvp_disabled');log('pvp_disabled');return;}
  if(cmd==='fight stop'){combat.stop('manual');return;}
  if(cmd==='fight mob'){
    const e=executor.hostile();console.log(JSON.stringify(e&&config.move?combat.engage(e,'mob'):{status:'no_hostile_or_movement_disabled'}));return;
  }
  if(cmd.startsWith('fight player ')){
    const n=cmd.slice('fight player '.length).trim();
    if(!config.pvp||!config.pvpAllow.has(n.toLowerCase())){console.log('PVP not explicitly allowed for this name');return;}
    const e=executor.player(n);console.log(JSON.stringify(e&&config.move?combat.engage(e,'player'):{status:'player_not_visible_or_movement_disabled'}));return;
  }
  // Raw compositional control: no mutually-exclusive MOVE/LOOK/USE actions.
  if(cmd==='motor on'){
    if(!config.move){console.log('Enable movement on first');return;}
    config.autonomy=false;executor.stop('motor_takeover');
    const result=motor.enable();log('motor_enabled',result);return;
  }
  if(cmd==='motor off'){motor.disable('console');log('motor_disabled');return;}
  if(cmd==='motor status'){console.log(JSON.stringify(motor.status(),null,2));return;}
  if(cmd.startsWith('motor frame ')){
    if(!motor.enabled){console.log('Enable motor on first');return;}
    try{const frame=motor.setFrame(JSON.parse(cmd.slice(12)));log('motor_frame_set',{frame});}
    catch(e){console.log(`Invalid motor frame: ${e.message}`);}
    return;
  }
  if(cmd==='viewer on'){viewerOn();return;}
  if(cmd==='viewer off'){viewerOff();return;}
  if(cmd==='status'){
    const cfg={autonomy:config.autonomy,move:config.move,attack:config.attack,allowDig:config.allowDig,allowCraft:config.allowCraft,allowPlace:config.allowPlace,pvp:config.pvp,
      model:config.ollamaModel,tempo:tempo.snapshot()};
    console.log(JSON.stringify({ready,config:cfg,currentGoal:executor.current,lastPlan,
      planning,combat:combat.status(),motor:motor.status(),world:observe()},null,2));return;
  }
  if(cmd.startsWith('say ')){say(cmd.slice(4));return;}
  console.log('Commands: status | start | pause | tempo relaxed/natural/focused | plan now | motor on/off | motor frame <JSON> | motor status | movement on/off | dig on/off | craft on/off | place on/off | combat on/off | pvp on/off | fight mob | fight player <name> | fight stop | viewer on/off | say <text> | quit');
});
process.once('SIGINT',shutdown);
process.once('SIGTERM',shutdown);
