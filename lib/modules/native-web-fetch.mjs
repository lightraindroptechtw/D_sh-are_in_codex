/** Explicitly configured HTTP backend for the official DSH web service.
 * It fetches text only; no login cookies, scripts, shell or browser execution. */
export function createNativeFetchProvider(options={}) {
  const failure=(message,code)=>Object.assign(new Error(message),{code});
  if(!Array.isArray(options.allowedOrigins)||!options.allowedOrigins.length)throw failure('nativeFetch requires allowedOrigins','WEB_FETCH_CONFIG_INVALID');
  const allowed=new Set(options.allowedOrigins.map(value=>{const url=new URL(value);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw failure('Expected an HTTP origin','WEB_FETCH_CONFIG_INVALID');return url.origin;}));
  const integer=(key,fallback,max)=>{const value=options[key]??fallback;if(!Number.isSafeInteger(value)||value<1||value>max)throw failure('Invalid fetch limit','WEB_FETCH_CONFIG_INVALID');return value;};
  const maxBytes=integer('maxBytes',1500000,10000000),timeoutMs=integer('timeoutMs',30000,120000),maxRedirects=integer('maxRedirects',5,20);
  const check=value=>{let url;try{url=new URL(value);}catch{throw failure('Invalid fetch URL','WEB_FETCH_URL_INVALID');}if(url.username||url.password||!allowed.has(url.origin))throw failure('URL origin is not allowed','WEB_FETCH_URL_BLOCKED');return url;};
  return {id:'codex-native-http',available:()=>true,async fetch(request,signal){
    let url=check(request.url);const controller=new AbortController();
    const abort=()=>controller.abort(signal.reason);if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>controller.abort(failure('HTTP fetch timed out','WEB_FETCH_TIMEOUT')),timeoutMs);timer.unref?.();
    try{
      for(let redirects=0;;redirects++){
        const response=await fetch(url,{signal:controller.signal,redirect:'manual',credentials:'omit',headers:{accept:'text/html, text/plain, application/json, application/xml;q=0.9'}});
        if([301,302,303,307,308].includes(response.status)&&response.headers.has('location')){
          await response.body?.cancel();if(redirects>=maxRedirects)throw failure('Too many redirects','WEB_FETCH_REDIRECT_LIMIT');url=check(new URL(response.headers.get('location'),url).href);continue;
        }
        const type=(response.headers.get('content-type')??'').split(';')[0].trim().toLowerCase();
        if(!type.startsWith('text/')&&!/^application\/(?:json|xml|xhtml\+xml|[a-z0-9.+-]+\+(?:json|xml))$/.test(type)){
          await response.body?.cancel();throw failure('Only declared text content is supported','WEB_FETCH_CONTENT_TYPE_UNSUPPORTED');
        }
        const chunks=[];let bytes=0,truncated=false;const reader=response.body?.getReader();
        if(reader)try{while(true){const {value,done}=await reader.read();if(done)break;const remaining=maxBytes-bytes;if(value.length>remaining){chunks.push(value.subarray(0,remaining));truncated=true;await reader.cancel();break;}chunks.push(value);bytes+=value.length;}}finally{reader.releaseLock();}
        return {url:url.href,statusCode:response.status,body:{kind:type.includes('html')?'html':'text',content:Buffer.concat(chunks).toString('utf8')},truncated};
      }
    }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }};
}
