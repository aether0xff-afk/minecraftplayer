'use strict';
const fs=require('node:fs');
class WorldMemory {
  constructor(file,log=()=>{}){
    this.file=file;this.log=log;this.data={trust:{},events:[],goals:[],home:null};
    try{
      const parsed=JSON.parse(fs.readFileSync(file,'utf8'));
      if(parsed&&typeof parsed==='object'){
        this.data.trust=parsed.trust&&typeof parsed.trust==='object'?parsed.trust:{};
        this.data.events=Array.isArray(parsed.events)?parsed.events.slice(-60):[];
        this.data.goals=Array.isArray(parsed.goals)?parsed.goals.slice(-30):[];
        this.data.home=parsed.home||null;
      }
    }catch(e){if(e.code!=='ENOENT') log('memory_warning',{error:e.message});}
  }
  save(){
    this.data.events=this.data.events.slice(-60);this.data.goals=this.data.goals.slice(-30);
    const tmp=this.file+'.tmp';fs.writeFileSync(tmp,JSON.stringify(this.data,null,2),'utf8');fs.renameSync(tmp,this.file);
  }
  event(type,details={}){this.data.events.push({at:Date.now(),type,...details});this.save();}
  trust(name){return Math.max(-1,Math.min(1,Number(this.data.trust[name]||0)));}
  adjust(name,delta){
    if(!name||!Number.isFinite(delta))return;
    this.data.trust[name]=Math.round(Math.max(-1,Math.min(1,this.trust(name)+delta))*100)/100;
    this.save();
  }
  snapshot(players=[]){return {
    relationships:Object.fromEntries(players.map(p=>[p.name,this.trust(p.name)])),
    recentEvents:this.data.events.slice(-12),
    previousGoals:this.data.goals.slice(-5),
    home:this.data.home
  };}
  goal(plan,status){this.data.goals.push({at:Date.now(),goal:plan.goal,target:plan.target||'',status});this.save();}
}
module.exports={WorldMemory};
