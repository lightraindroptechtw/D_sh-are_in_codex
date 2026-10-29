// Ported from dsh-to-claude hooks/readme.ts. Original MIT license applies.
// 找插件的自述文件：面板（經 Claude Code 的網路功能）與瀏覽器版市場的本機伺服器（經 Node.js）共用。
// 只讀公開的檔案，不執行任何內容；讀到的文字是插件作者寫的，由呼叫的一方決定怎麼安全地顯示。
import { README_GUESSES, githubRepo, pickReadme } from './cc-market-catalog.mjs'
                                                  

/** 讀一個網址的文字；不是 2xx 就回傳 undefined。 */
                                                                    

/** 讀到的自述文件：`text` 是原文（還沒清理），`from` 寫明從哪個檔案、經哪個網站讀的，`url` 是原始檔。 */
                                                                     

/** jsDelivr 列出一個版本的所有檔案路徑（以 / 開頭）。 */
async function jsdelivrFiles(fetchText           , path        )                    {
  const text = await fetchText(`https://data.jsdelivr.com/v1/packages/${path}?structure=flat`)
  if (text === undefined) throw new Error('jsDelivr 查不到這個版本的檔案清單')
  const files = (JSON.parse(text)                       ).files
  return Array.isArray(files) ? files.flatMap(f => (typeof f?.name === 'string' ? [f.name          ] : [])) : []
}

/**
 * 讀這個版本的自述文件，沒有就回傳 undefined。npm 版本與 GitHub 固定提交先向 jsDelivr 要檔案清單再挑；
 * GitHub 預設分支沒有檔案清單可查，就依序試常見檔名。
 */
export async function readReadme(fetchText           , entry       , picked         )                                   {
  const source = picked.source
  let found                                                          
  if (source.type === 'npm') {
    let ver = picked.version
    if (picked.floating) {
      const resolved = await fetchText(`https://data.jsdelivr.com/v1/packages/npm/${entry.name}/resolved?specifier=latest`)
      const value = resolved === undefined ? undefined : (JSON.parse(resolved)                         ).version
      if (typeof value !== 'string') throw new Error('查不到最新版本號')
      ver = value
    }
    const file = pickReadme(await jsdelivrFiles(fetchText, `npm/${entry.name}@${ver}`))
    if (file) found = { url: `https://cdn.jsdelivr.net/npm/${entry.name}@${ver}${file}`, from: `npm 套件 ${entry.name}@${ver} 裡的 ${file.slice(1)}，經 jsDelivr 讀取` }
  } else {
    const repo = githubRepo(source.type === 'release' ? source.repo : source.url)
    if (!repo) throw new Error('GitHub 倉庫網址不合法')
    const dir = source.type === 'git' ? (source.path ?? '') : ''
    if (source.type === 'git' && source.commit) {
      const file = pickReadme(await jsdelivrFiles(fetchText, `gh/${repo.owner}/${repo.repo}@${source.commit}`), dir)
      if (file) found = { url: `https://cdn.jsdelivr.net/gh/${repo.owner}/${repo.repo}@${source.commit}${file}`, from: `GitHub 倉庫 ${repo.owner}/${repo.repo} 提交 ${source.commit.slice(0, 7)} 裡的 ${file.slice(1)}，經 jsDelivr 讀取` }
    } else {
      for (const guess of README_GUESSES) {
        const path = `${dir ? `${dir}/` : ''}${guess}`
        const url = `https://raw.githubusercontent.com/${repo.owner}/${repo.repo}/HEAD/${path}`
        const text = await fetchText(url)
        if (text !== undefined) {
          found = { url, from: `GitHub 倉庫 ${repo.owner}/${repo.repo} 預設分支目前的 ${path}，經 raw.githubusercontent.com 讀取`, text }
          break
        }
      }
    }
  }
  if (!found) return undefined
  const text = found.text ?? (await fetchText(found.url))
  if (text === undefined) throw new Error('自述文件讀不到')
  return { text, url: found.url, from: found.from }
}
