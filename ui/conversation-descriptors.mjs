// Public signatures pinned to DSH 0.2.1-rc.2 dsh-api-session-controller.
const descriptor=(namespace,method,names,{stream=false,cancel=false}={})=>({id:`${namespace}/${method}`,service:namespace,namespace,method,invocation:{kind:'direct'},parameters:names.map(name=>({name,wire:name,source:'json',codec:{mode:'strict'}})),...(stream?{mode:'stream'}:{}),...(cancel?{cancellation:{parameter:'signal'}}:{}),result:{mode:'src-json'}});
export const CONVERSATION_REMOTE_CONTRIBUTIONS=[{package:'@deepseek-ai/dsh-api-session-controller',descriptors:[
  descriptor('session','list',['_request'],{cancel:true}),descriptor('session','page',['request'],{cancel:true}),descriptor('session','projections',['request'],{cancel:true}),descriptor('session','follow',['request'],{stream:true,cancel:true}),descriptor('session','control',[],{stream:true,cancel:true}),
  ...['create','fork','prompt','cancel','rename','selectModel','updateQueue','attachment','search'].map(method=>descriptor('session',method,['request'])),
  ...['initializeDefaultModel','modelCatalog'].map(method=>descriptor('session',method,[])),
]},{package:'codex-conversation-presentation',descriptors:[descriptor('codexConversation','describe',[]),descriptor('codexConversation','list',[],{cancel:true}),descriptor('codexConversation','read',['sessionId'],{cancel:true})]}];
