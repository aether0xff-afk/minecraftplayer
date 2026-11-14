'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {TempoDirector,preserveActivity,priorityFor}=require('../src/tempo');
function fixture(){let now=1000;const d=new TempoDirector('natural',()=>now,()=>0.5);return {d,get time(){return now;},set time(n){now=n;}};}
test('tempo defaults to balanced natural preset and supports runtime change',()=>{
  const f=fixture();assert.equal(f.d.mode,'natural');assert.ok(f.d.pauseForWaypoint()>=180);
  assert.equal(f.d.setMode('focused'),true);assert.equal(f.d.mode,'focused');
  assert.equal(f.d.setMode('invalid'),false);assert.equal(f.d.mode,'focused');
});
test('background deliberation does not interrupt mining or crafting',()=>{
  const f=fixture();f.d.request('spawn');let v=f.d.claim({asyncBusy:false},f.time);
  assert.equal(v.reason,'spawn');f.d.finish();f.time=60000;
  assert.equal(f.d.claim({asyncBusy:true},f.time),null);
  v=f.d.claim({asyncBusy:false,activeGoal:true},f.time);
  assert.equal(v.reason,'background_review');
});
test('important player chat can be considered during task, without cancelling task',()=>{
  const f=fixture();f.d.request('spawn');f.d.claim({},f.time);f.d.finish();
  f.time=5000;f.d.request('addressed_by_player');
  const v=f.d.claim({asyncBusy:true,activeGoal:true},f.time);
  assert.equal(v.reason,'addressed_by_player');
  assert.equal(preserveActivity({current:{goal:'GATHER_WOOD',target:'',since:1000},next:{goal:'TALK',target:'Alice'},priority:v.priority,now:f.time,asyncBusy:true}),true);
});
test('hurt is urgent, can preempt ongoing task for fleeing',()=>{
  const f=fixture();f.d.request('spawn');f.d.claim({},f.time);f.d.finish();
  f.time=1100;f.d.request('hurt');const v=f.d.claim({asyncBusy:true},f.time);
  assert.equal(v.reason,'hurt');assert.equal(v.priority,3);
  assert.equal(preserveActivity({current:{goal:'MINE_STONE',since:1000},next:{goal:'FLEE'},priority:3,asyncBusy:true,now:f.time}),false);
  assert.equal(preserveActivity({current:{goal:'GATHER_WOOD',since:1000},next:{goal:'FLEE'},priority:2,asyncBusy:true,now:f.time}),false);
});
test('same activity continues; low-priority goal changes honor commitment',()=>{
  const c={goal:'EXPLORE',target:'',since:1000};
  assert.equal(preserveActivity({current:c,next:{goal:'EXPLORE',target:''},priority:0,now:3000}),false);
  assert.equal(preserveActivity({current:c,next:{goal:'IDLE',target:''},priority:0,now:3000}),true);
  assert.equal(preserveActivity({current:c,next:{goal:'IDLE',target:''},priority:0,now:20000}),false);
});
test('no decision flood; noisy events are debounced',()=>{
  const f=fixture();f.d.request('spawn');f.d.claim({},f.time);f.d.finish();
  f.time=2000;assert.equal(f.d.request('players_changed'),true);
  f.time=3000;assert.equal(f.d.request('players_changed'),false);
  assert.equal(f.d.claim({},f.time).reason,'players_changed');
  assert.equal(priorityFor('players_changed'),1);
});
