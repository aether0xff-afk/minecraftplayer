'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {installTickEndCompatibility,plainKickReason}=require('../src/protocol-compat');

test('pairs every position/position_look with tick_end without reordering',()=>{
  const seen=[];
  const client={write:(name,packet)=>{seen.push({name,packet});return 'ok';}};
  installTickEndCompatibility(client);
  assert.equal(client.write('position',{x:1}),'ok');
  client.write('look',{yaw:0});
  client.write('position_look',{x:2});
  assert.deepEqual(seen.map(x=>x.name),['position','tick_end','look','position_look','tick_end']);
});

test('does not recurse and does not send tick_end for keep-alive',()=>{
  const sent=[];
  const client={write:(n,p)=>sent.push(n)};
  installTickEndCompatibility(client);
  client.write('keep_alive',{id:1});
  assert.deepEqual(sent,['keep_alive']);
});

test('reveals raw disconnect components instead of object Object',()=>{
  const message={translate:'multiplayer.disconnect.invalid_player_movement'};
  assert.equal(plainKickReason(message),'multiplayer.disconnect.invalid_player_movement');
  assert.equal(plainKickReason(JSON.stringify(message)),'multiplayer.disconnect.invalid_player_movement');
  assert.equal(plainKickReason({text:'Error: ',extra:[{text:'not whitelisted'}]}),'Error:  not whitelisted');
});
