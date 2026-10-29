import semver from 'semver';
import {unavailableService} from './common.mjs';
import {isCordisContextName} from '../cordis-context.mjs';
import * as timer from './timer.mjs';
import * as fs from './fs.mjs';
import * as settings from './settings.mjs';
import * as webServer from './webserver.mjs';
import * as skills from './skills.mjs';
import * as commands from './commands.mjs';
import * as approval from './approval.mjs';
import * as web from './web.mjs';
import * as systemPrompt from './system-prompt.mjs';
import * as interception from './interception.mjs';
import * as agents from './agents.mjs';
import * as sessions from './sessions.mjs';
import * as llm from './llm.mjs';
import * as credentials from './credentials.mjs';
import * as background from './background.mjs';
import * as shell from './shell.mjs';
import * as defaultModel from './default-model.mjs';
import * as connection from './connection.mjs';
import * as typert from './typert.mjs';
import * as sandboxPolicy from './sandbox-policy.mjs';

/** Ordered by service dependency: official registries first; agents before sessions. */
export const registry=new Map([timer,fs,settings,webServer,skills,commands,approval,web,systemPrompt,interception,agents,sessions,llm,credentials,background,shell,defaultModel,connection,typert,sandboxPolicy].map(module=>[module.descriptor.id,module]));
const CORE=new Set(['tools','sessionQuery','profileContext','loader','scope','webRuntime']);
function capability(caps,name){if(caps[name]===true||caps.flags?.[name]===true)return true;return name.split('.').reduce((value,key)=>value?.[key],caps)===true;}
function availability(descriptor,caps,disabled){
  if(disabled.has(descriptor.id))return {enabled:false,reason:'This module was explicitly disabled in configuration'};
  const minimum=descriptor.requires?.minimumCodexVersion;
  if(minimum){const detected=semver.coerce(caps.codexVersion??caps.version??'');if(!detected||semver.lt(detected,minimum))return {enabled:false,reason:`Requires Codex >= ${minimum}; detected version is unavailable or older`};}
  const missing=(descriptor.requires?.capabilities??[]).filter(name=>!capability(caps,name));
  return missing.length?{enabled:false,reason:`Codex capabilities are unavailable: ${missing.join(', ')}`}:{enabled:true,reason:null};
}
function requestedServices(plan,options){return options.services??plan.capabilities?.hostRuntime?.services??plan.host?.services??plan.services??[];}

/** Pure selection/reporting. No module is installed or source code executed. */
export function selectModules(plan={},options={},capabilities={}){
  const explicit=Array.isArray(options.modules),configured=Object.keys(options.moduleOptions??options.moduleConfig??{}).filter(id=>registry.has(id));
  const requested=explicit?options.modules:[...requestedServices(plan,options),...configured,'approval','systemPrompt','background'];
  if(!explicit&&(options.interception===true||JSON.stringify(plan).match(/tools\/(?:pre-execute|post-execute|result)/)))requested.push('interception');
  const disabled=new Set(options.disabledModules??[]),ids=new Set();
  for(const name of requested){
    if(typeof name!=='string'||CORE.has(name)||isCordisContextName(name))continue;
    const found=registry.get(name)??[...registry.values()].find(module=>module.descriptor.services.includes(name));
    ids.add(found?.descriptor.id??name);
  }
  const ordered=[...registry.keys()].filter(id=>ids.has(id)).concat([...ids].filter(id=>!registry.has(id)));
  return ordered.map(id=>{
    const module=registry.get(id);
    const descriptor=module?.descriptor??{id,displayName:`未對應服務 ${id}`,services:/^[A-Za-z][A-Za-z0-9_-]*$/.test(id)?[id]:[],requires:{minimumCodexVersion:null,capabilities:[]},methods:{},requirements:[]};
    const state=module?availability(descriptor,capabilities,disabled):{enabled:false,reason:'No generic module maps this DSH service'};
    return {id,descriptor,services:descriptor.services,available:state.enabled,availability:state,status:state.enabled?'available':'disabled',reason:state.reason};
  });
}

/** Mount selected services in a real Cordis root; every failure is module-local. */
export async function installModules(context={}){
  const {root,options={},capabilities={}}=context;
  if(!root?.get||!root?.provide)throw new TypeError('installModules requires a Cordis root with get/provide');
  const selected=context.selected??selectModules(context.plan??{},{modules:context.modules,services:context.services},capabilities);
  const rows=selected.map(row=>typeof row==='string'?selectModules({},{modules:[row]},capabilities)[0]:{...row}).filter(Boolean);
  const services={},diagnostics=[],disposers=[];
  // Defend again at installation: old reports and explicitly supplied selection
  // rows can bypass selectModules. Cordis accessors are absent from root.get(),
  // so checking get() alone cannot distinguish them from missing services.
  const protectedName=name=>{
    if(typeof name!=='string'||!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)||isCordisContextName(name))return true;
    const property=Object.getOwnPropertyDescriptor(root.reflect?.props??{},name)?.value;
    if(property?.type==='accessor')return true;
    for(let current=root;current;current=Object.getPrototypeOf(current)){
      const own=Object.getOwnPropertyDescriptor(current,name);
      if(own&&(own.get||own.set))return true;
    }
    return false;
  };
  const provide=(name,value)=>{
    if(protectedName(name)){diagnostics.push({module:'registry',status:'disabled',code:'CORDIS_CONTEXT_NAME_RESERVED',reason:'A Cordis context API member cannot be provided as a service'});return;}
    try{
      const existing=root.get(name);
      if(existing!==undefined){services[name]=existing;return;}
      const dispose=root.provide(name,value);if(typeof dispose==='function')disposers.push(dispose);services[name]=value;
    }catch{
      diagnostics.push({module:'registry',status:'disabled',level:'warning',code:'SERVICE_PROVIDE_FAILED',reason:`Service ${name} could not be mounted; other services are unaffected`});
    }
  };
  for(const row of rows){
    const descriptor=row.descriptor,module=registry.get(row.id),moduleOptions=options[row.id]??{};
    if(descriptor.services.some(protectedName)){
      row.runtimeStatus='disabled';diagnostics.push({module:row.id,status:'disabled',code:'CORDIS_CONTEXT_NAME_RESERVED',reason:'A selected service conflicts with a Cordis context API member; no replacement was installed'});continue;
    }
    const enabled=row.availability?.enabled??row.available??false;
    const reason=row.reason??row.availability?.reason??'The selected Codex capability is unavailable';
    if(!module||!enabled){
      row.runtimeStatus='disabled';
      diagnostics.push({module:row.id,status:'disabled',level:'warning',reason});
      // Preserve the official registries that the low-level host already owns.
      // Only the Codex projection is disabled. Command execution still needs
      // its explicit guard even when discovery has a legacy official service.
      if(row.id==='commands'&&root.get('commands')&&module){
        try{const installed=await module.install({...context,options:moduleOptions,capabilities:{...capabilities,mcp:true,skills:true}});disposers.push(installed.dispose??(()=>{}));diagnostics.push(...(installed.diagnostics??[]));}catch{diagnostics.push({module:row.id,status:'disabled',level:'warning',reason:'The command execution guard could not be installed'});}
      }
      for(const name of descriptor.services){
        const existing=root.get(name);
        if(existing!==undefined){services[name]=existing;diagnostics.push({module:row.id,level:'info',reason:`The host-owned official ${name} registry remains available; the Codex projection is disabled`});}
        else provide(name,unavailableService(row.id,reason));
      }
      continue;
    }
    try{
      // Worker loader rows own the production official packages and companions.
      // installOfficial also supports standalone direct registry installation.
      const installed=await module.install({...context,options:moduleOptions,capabilities});
      row.runtimeStatus=installed.diagnostics?.some(item=>item.status==='disabled')?'disabled':'installed';
      if(installed.dispose)disposers.push(installed.dispose);
      diagnostics.push(...(installed.diagnostics??[]));
      for(const name of descriptor.services){
        const value=installed.services?.[name]??root.get(name);
        if(value===undefined){
          const missing='The module did not provide its declared service';row.runtimeStatus='disabled';diagnostics.push({module:row.id,status:'disabled',level:'warning',reason:missing});provide(name,unavailableService(row.id,missing));
        }else provide(name,value);
      }
    }catch(error){
      row.runtimeStatus='disabled';
      // Avoid serializing arbitrary provider/configuration error messages: they
      // may contain a secret. Codes and module identities are sufficient here.
      const failure='Module installation failed; this module is disabled';
      diagnostics.push({module:row.id,status:'disabled',level:'warning',reason:failure,...(typeof error?.code==='string'?{code:error.code}:{})});
      for(const name of descriptor.services)provide(name,unavailableService(row.id,failure));
    }
  }
  let disposed=false;
  return {services,diagnostics,modules:rows,async dispose(){if(disposed)return;disposed=true;for(const dispose of disposers.reverse()){try{await dispose();}catch{diagnostics.push({module:'registry',level:'warning',reason:'A module disposer failed; remaining module cleanup continued'});}}}};
}
