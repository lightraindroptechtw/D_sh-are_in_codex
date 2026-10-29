/** Drop only enumerable object properties whose values are undefined. All other
 * values and schema constraints remain the official validator's responsibility. */
export function normalizeOutput(value,seen=new WeakMap()) {
  if(!value||typeof value!=='object')return value;
  const proto=Object.getPrototypeOf(value);
  if(!Array.isArray(value)&&proto!==Object.prototype&&proto!==null)return value;
  if(seen.has(value))return seen.get(value);
  const copy=Array.isArray(value)?[]:Object.create(proto);seen.set(value,copy);
  for(const key of Reflect.ownKeys(value)) {
    if(Array.isArray(value)&&key==='length')continue;
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if(!Array.isArray(value)&&typeof key==='string'&&descriptor.enumerable&&'value'in descriptor&&descriptor.value===undefined)continue;
    if('value'in descriptor)descriptor.value=normalizeOutput(descriptor.value,seen);
    Object.defineProperty(copy,key,descriptor);
  }
  if(Array.isArray(value))Object.defineProperty(copy,'length',Object.getOwnPropertyDescriptor(value,'length'));
  return copy;
}
/** Opt-in legacy output policy. Preserve extra data rather than deleting it;
 * declared property types, required fields, enums and input schemas stay intact.
 * Only schema locations are visited: enum/default/example objects are data. */
export function permitExtraOutputFields(schema) {
  const copy=structuredClone(schema),seen=new WeakSet();
  const single=['additionalProperties','items','contains','not','if','then','else','propertyNames','unevaluatedProperties','unevaluatedItems'];
  const maps=['properties','patternProperties','$defs','definitions','dependentSchemas'];
  const arrays=['allOf','anyOf','oneOf','prefixItems'];
  function visit(node){
    if(!node||typeof node!=='object'||seen.has(node))return;
    seen.add(node);
    if(Array.isArray(node)){for(const child of node)visit(child);return;}
    if(node.additionalProperties===false)node.additionalProperties=true;
    for(const key of single)if(node[key]&&typeof node[key]==='object')visit(node[key]);
    for(const key of maps)if(node[key]&&typeof node[key]==='object')for(const child of Object.values(node[key]))visit(child);
    for(const key of arrays)if(Array.isArray(node[key]))for(const child of node[key])visit(child);
  }
  visit(copy);return copy;
}
export function wrapToolDefinition(definition,enabled=false,allowUndeclaredOutput=false) {
  if((!enabled&&!allowUndeclaredOutput)||!definition||typeof definition.execute!=='function')return definition;
  const descriptors=Object.getOwnPropertyDescriptors(definition),original=definition.execute;
  if(enabled)descriptors.execute={...descriptors.execute,value:async function(...args){return normalizeOutput(await Reflect.apply(original,this,args));}};
  if(allowUndeclaredOutput&&definition.output?.schema)descriptors.output={...descriptors.output,value:{...definition.output,schema:permitExtraOutputFields(definition.output.schema)}};
  return Object.create(Object.getPrototypeOf(definition),descriptors);
}
