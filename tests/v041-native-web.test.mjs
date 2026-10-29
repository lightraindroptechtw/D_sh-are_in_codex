import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Context} from '@deepseek-ai/cordis';
import Web from '@deepseek-ai/dsh-web';
import {install} from '../lib/modules/web.mjs';
import {createNativeFetchProvider} from '../lib/modules/native-web-fetch.mjs';
import {selectModules} from '../lib/modules/index.mjs';

test('explicit configuration selects an optional module, while an explicit module list remains authoritative',()=>{
  const options={moduleOptions:{web:{nativeFetch:{allowedOrigins:['https://example.invalid']}},unknown:{}}};
  const rows=selectModules({services:['timer']},options,{mcp:true,codexVersion:'0.160.0'});
  assert.equal(rows.find(x=>x.id==='web')?.available,true);assert.equal(rows.some(x=>x.id==='unknown'),false);
  assert.equal(selectModules({}, {...options,modules:['timer']},{mcp:true,codexVersion:'0.160.0'}).some(x=>x.id==='web'),false);
});

async function fixture(t){
  const requests=[];const server=http.createServer((req,res)=>{requests.push(req.url);res.setHeader('content-type','text/html; charset=utf-8');
    if(req.url==='/redirect'){res.writeHead(302,{location:'/page'});res.end();}
    else if(req.url==='/blocked'){res.writeHead(302,{location:'http://example.invalid/forbidden'});res.end();}
    else if(req.url==='/loop'){res.writeHead(302,{location:'/loop'});res.end();}
    else if(req.url==='/slow'){const timer=setTimeout(()=>res.end('too late'),1000);res.on('close',()=>clearTimeout(timer));}
    else if(req.url==='/binary'){res.setHeader('content-type','application/octet-stream');res.end('binary');}
    else if(req.url==='/large')res.end('x'.repeat(200));
    else if(req.url==='/missing'){res.statusCode=404;res.end('Missing fixture');}
    else res.end('<title>Fixture</title><p>ORCHARD-42</p>');
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();return new Promise(resolve=>server.close(resolve));});
  return {origin:`http://127.0.0.1:${server.address().port}`,requests};
}
test('native HTTP provider is opt-in and preserves official selection and disposal',async t=>{
  const {origin}=await fixture(t),root=new Context();t.after(()=>root.fiber.dispose());await root.plugin(Web,{}).await();
  await install({root,capabilities:{mcp:true}});await assert.rejects(root.web.fetch({url:origin}),e=>e.code==='WEB_PROVIDER_UNAVAILABLE');
  const adapter=await install({root,capabilities:{mcp:true},options:{nativeFetch:{allowedOrigins:[origin]}}});
  const result=await root.web.fetch({url:origin+'/redirect'});assert.equal(result.statusCode,200);assert.equal(result.url,origin+'/page');assert.equal(result.body.kind,'html');assert.match(result.body.content,/ORCHARD-42/);assert.equal(result.truncated,false);
  const missing=await root.web.fetch({url:origin+'/missing'});assert.equal(missing.statusCode,404);assert.match(missing.body.content,/Missing fixture/);
  await adapter.dispose();await assert.rejects(root.web.fetch({url:origin}),e=>e.code==='WEB_PROVIDER_UNAVAILABLE');
});
test('native HTTP provider checks every origin, handles limits, cancellation and content types',async t=>{
  const {origin,requests}=await fixture(t),provider=createNativeFetchProvider({allowedOrigins:[origin],maxBytes:16,maxRedirects:2,timeoutMs:300});
  await assert.rejects(provider.fetch({url:'http://example.invalid/no'}),e=>e.code==='WEB_FETCH_URL_BLOCKED');
  await assert.rejects(provider.fetch({url:origin+'/blocked'}),e=>e.code==='WEB_FETCH_URL_BLOCKED');
  await assert.rejects(provider.fetch({url:origin+'/loop'}),e=>e.code==='WEB_FETCH_REDIRECT_LIMIT');
  await assert.rejects(provider.fetch({url:origin+'/binary'}),e=>e.code==='WEB_FETCH_CONTENT_TYPE_UNSUPPORTED');
  const large=await provider.fetch({url:origin+'/large'});assert.equal(large.truncated,true);assert.equal(large.body.content,'x'.repeat(16));
  await assert.rejects(provider.fetch({url:origin+'/slow'}),e=>e.code==='WEB_FETCH_TIMEOUT');
  const controller=new AbortController();controller.abort(new Error('fixture canceled'));await assert.rejects(provider.fetch({url:origin+'/page'},controller.signal),/fixture canceled/);
  assert.equal(requests.includes('/no'),false);assert.throws(()=>createNativeFetchProvider({allowedOrigins:[]}),e=>e.code==='WEB_FETCH_CONFIG_INVALID');
});
