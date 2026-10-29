import {installOfficial} from './common.mjs';
export const descriptor={id:'settings',displayName:'設定模組',services:['settings'],officialPackage:'@deepseek-ai/dsh-settings',companionBefore:['@deepseek-ai/dsh-config-editor'],requires:{minimumCodexVersion:null,capabilities:[]},methods:{describe:{support:'full',reason:'官方秘密遮蔽與欄位規格'},update:{support:'full',reason:'官方驗證、版本衝突及固定資料目錄'},nativeSettingsPage:{support:'unsupported',reason:'不修改 Codex 設定頁；原表單可由獨立網頁承載，亦可使用設定控制工具'}},requirements:[]};
export const install=environment=>installOfficial(descriptor,environment);
