/** Claude model names are compatibility aliases, not additional paid providers. */
export const DEFAULT_PLUGIN_MODEL='gpt-6.1-sol';
export const DEFAULT_PLUGIN_EFFORT='medium';
export function isClaudeModelAlias(provider,model){
  return ['claude-code','anthropic','claude'].includes(provider)||typeof model==='string'&&/^(?:claude[-/]|sonnet(?:$|[-\d])|opus(?:$|[-\d])|haiku(?:$|[-\d]))/i.test(model);
}
export function codexModelRoute({provider='codex',model,modelMap={},defaultModel=DEFAULT_PLUGIN_MODEL}={}){
  const explicit=modelMap[`${provider}/${model}`];
  return {provider:'codex',model:explicit??(isClaudeModelAlias(provider,model)||!['codex','openai'].includes(provider)?defaultModel:model??defaultModel),reasoningEffort:DEFAULT_PLUGIN_EFFORT};
}
