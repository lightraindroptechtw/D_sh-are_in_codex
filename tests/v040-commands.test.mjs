import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import Commands from '@deepseek-ai/dsh-commands';
import {inspectJs} from '../lib/inspect.mjs';
import {descriptor,install,unsupported,generateCommandSkills} from '../lib/modules/commands.mjs';

test('commands preserve official registration/list/find and explicitly reject DSH-agent execution',async t=>{
  const root=new Context();t.after(()=>root.fiber.dispose());await root.plugin(Commands).await();
  const result=await install({root,capabilities:{mcp:true,skills:true}});t.after(()=>result.dispose());
  let executions=0;const remove=root.commands.register({name:'synthetic',description:'Synthetic command',handler:()=>{executions++;return {kind:'success',text:'should not execute'};}});
  assert.equal(root.commands.list(undefined)[0].name,'synthetic');assert.equal(root.commands.find(undefined,'synthetic').name,'synthetic');assert.equal(descriptor.methods.execute.support,'unsupported');
  assert.throws(()=>root.commands.execute(undefined,'/synthetic',[],new AbortController().signal),e=>e.code==='DSH_MODULE_METHOD_UNSUPPORTED'&&e.module==='commands'&&e.method==='execute');assert.equal(executions,0);
  assert.throws(()=>root.commands.registerFileReceiptResolver(()=>undefined),e=>e.method==='registerFileReceiptResolver');remove();assert.equal(root.commands.list(undefined).length,0);
});

test('commands collect static names via apply aliases and report dynamic names without executing source',()=>{
  const r=inspectJs(`export function apply(host){const {commands:registry}=host;const name='synthetic';registry.register({name,description:'Sample',handler(){throw Error('MUST NOT EXECUTE')}});host.commands.register(makeCommand());function shadow(host){host.commands.register({name:'unrelated'});}}`);
  assert.deepEqual(r.commands.map(x=>x.name),['synthetic']);assert.equal(r.dynamicCommands.length,1);
  const generated=generateCommandSkills({capabilities:{commands:{definitions:r.commands,dynamicRegistrations:r.dynamicCommands}}});assert.equal(generated.skills.length,1);assert.match(generated.skills[0].content,/dsh_host_commands/);assert.match(generated.skills[0].content,/dsh_host_command_run/);assert.equal(generated.skills[0].execution,'direct-global-handler');assert.equal(generated.diagnostics[0].code,'COMMAND_DYNAMIC_NAME');
});

test('commands disable on absent capabilities/service and unknown methods fail explicitly',async()=>{
  assert.equal((await install({capabilities:{skills:false}})).diagnostics[0].code,'MODULE_CAPABILITY_UNAVAILABLE');assert.equal((await install({root:{get:()=>undefined}})).diagnostics[0].code,'MODULE_SERVICE_UNAVAILABLE');assert.equal(unsupported('unknown').module,'commands');assert.equal(unsupported('unknown').method,'unknown');
});
