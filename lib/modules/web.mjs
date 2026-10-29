import {createNativeFetchProvider} from './native-web-fetch.mjs';

/** The official provider seam and official model-facing tools are mounted as
 * independent loader rows. No replacement schema or permissive validator exists.
 */
export const descriptor={
  id:'web',displayName:'內建網頁工具模組',services:['web'],
  officialPackage:'@deepseek-ai/dsh-web',companionPackages:['@deepseek-ai/dsh-tool-web'],configKey:'web',
  requires:{minimumCodexVersion:'0.160.0',capabilities:['mcp']},
  methods:{
    registerSearchProvider:{support:'full',reason:'沿用官方搜尋來源登記、重複識別碼檢查與清除機制'},
    registerFetchProvider:{support:'full',reason:'沿用官方抓取來源登記、重複識別碼檢查與清除機制'},
    search:{support:'full',reason:'沿用官方來源選擇、取消訊號與結果數限制；來源可能需要使用者金鑰'},
    fetch:{support:'full',reason:'沿用官方來源選擇與取消訊號；來源本身的限制仍然適用'},
    web_search:{support:'full',reason:'由官方 dsh-tool-web 掛載原工具結構與驗證'},
    web_fetch:{support:'full',reason:'由官方 dsh-tool-web 掛載原工具結構與驗證'},
  },
  requirements:['實際搜尋或抓取需要至少一個可用來源；未設定來源時工具仍列出並回傳官方錯誤','可明確設定 nativeFetch.allowedOrigins 掛載限定網站的 HTTP 文字抓取來源；不提供搜尋、登入、瀏覽器渲染或圖片下載','需要金鑰的來源僅使用轉送的環境變數或來源設定'],
};

/** Reuse the already-mounted official service. The worker owns loader lifetime.
 * A missing capability or omitted official loader row disables this module.
 */
export async function install({root,capabilities={},options={}}={}){
  const diagnostics=[];
  if(capabilities.mcp===false)return {services:{},diagnostics:[{module:'web',code:'MODULE_CAPABILITY_UNAVAILABLE',reason:'Codex 未提供 MCP 工具介面'}]};
  const service=root?.get?.('web');
  if(!service)return {services:{},diagnostics:[{module:'web',code:'MODULE_SERVICE_UNAVAILABLE',reason:'官方網頁服務尚未掛載；必須先載入 descriptor.officialPackage 與 companionPackages'}]};
  const dispose=options.nativeFetch?service.registerFetchProvider(createNativeFetchProvider(options.nativeFetch)):()=>{};
  if(options.nativeFetch)diagnostics.push({module:'web',level:'info',code:'NATIVE_HTTP_FETCH_ENABLED',provider:'codex-native-http',allowedOriginCount:options.nativeFetch.allowedOrigins.length,reason:'Explicit text-only HTTP provider; no search, browser rendering, credentials or shell'});
  return {services:{web:service},diagnostics,dispose:async()=>{dispose();}};
}

/** Profile defaults are read from the analysis result, never a hardcoded plugin
 * identity. The caller passes this to the official WebRuntime Config parser.
 */
export function webConfiguration(plan={}){
  const input=plan.serviceConfig?.web??plan.defaultConfig?.web;
  if(!input||typeof input!=='object'||Array.isArray(input))return {};
  const output={};
  for(const key of ['searchProvider','fetchProvider'])if(typeof input[key]==='string')output[key]=input[key];
  return output;
}
