const $ = (id) => document.getElementById(id);
const accessFromLink = new URLSearchParams(location.hash.slice(1)).get('access');
if (accessFromLink && /^[a-f0-9]{64}$/.test(accessFromLink)) { sessionStorage.setItem('market-access', accessFromLink); history.replaceState(null, '', location.pathname); }
const marketAccess = sessionStorage.getItem('market-access') || '';
const state = { config: null, reviewSettings: null, source: '', category: '', query: '', page: 1, pageSize: 24, total: 0, view: 'browse', installed: [], request: 0, detailRequest: 0, current: null, job: null };
const dialog = $('plugin-dialog');
const jobReopen = document.createElement('button');
jobReopen.type = 'button';
jobReopen.className = 'reopen-job';
jobReopen.hidden = true;
$('catalog').before(jobReopen);
let searchTimer, toastTimer;

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = String(text);
  return el;
}
function safeText(value, fallback = '') { return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback; }
function title(item) { return safeText(item.title || item.name, '未命名插件'); }
function version(item) { return safeText(item.version, '未提供版本'); }
function sourceName(source) { return safeText(source.title || source.url, '社群來源'); }
function samePlugin(a, b) { return a && b && a.name === b.name && (a.sourceUrl || state.source) === (b.sourceUrl || state.source); }
function toast(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5200);
}
function notice(message = '', error = false, retry) {
  const box = $('notice');
  box.replaceChildren();
  box.hidden = !message;
  box.classList.toggle('error', error);
  if (message) box.append(node('span', '', message));
  if (retry) {
    const button = node('button', 'inline-retry', '重試');
    button.type = 'button';
    button.addEventListener('click', retry);
    box.append(button);
  }
}
async function api(path, options = {}) {
  const headers = { Accept: 'application/json', Authorization: `Bearer ${marketAccess}`, ...options.headers };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = state.config?.csrfToken || '';
  }
  const response = await fetch(path, { ...options, headers, credentials: 'same-origin', cache: 'no-store' });
  let data;
  try { data = await response.json(); } catch { throw new Error('本機服務沒有傳回可讀取的資料。'); }
  if (!response.ok) throw new Error(safeText(data.error?.message || data.error || data.message, `讀取失敗（${response.status}）`));
  return data;
}
function endpoint(path, params) {
  const url = new URL(path, location.origin);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
  return url.pathname + url.search;
}
function loading() {
  $('catalog').replaceChildren(...Array.from({ length: 6 }, () => {
    const skeleton = node('div', 'skeleton');
    skeleton.setAttribute('aria-hidden', 'true');
    return skeleton;
  }));
  $('catalog').setAttribute('aria-busy', 'true');
  $('empty-state').hidden = true;
  $('pagination').hidden = true;
  $('result-count').textContent = '讀取中…';
}
function labelsOf(item) {
  return (Array.isArray(item.labels) ? item.labels : []).map((label) => typeof label === 'string' ? label : label && typeof label === 'object' ? safeText(label.title || label.label || label.name || label.id) : '').filter(Boolean);
}
function badges(item) {
  const result = [];
  const testedCount = Number(item.testedFunctions?.count);
  if (Number.isFinite(testedCount) && testedCount > 0) result.push(['已測部分功能', 'tested']);
  else result.push(['未實測', '']);
  const setup = item.setupRequired === true;
  const nativeUi = item.nativeUi === true;
  if (setup) result.push(['需設定', 'warning']);
  if (nativeUi) result.push(['含原生畫面功能', 'warning']);
  if (item.installed) result.push(['已安裝', 'installed']);
  const el = node('div', 'badges');
  for (const [text, kind] of result) el.append(node('span', `badge ${kind}`, text));
  return el;
}
function icon(item) {
  const text = title(item).trim();
  const el = node('span', 'plugin-icon', Array.from(text)[0]?.toUpperCase() || '◇');
  let sum = 0;
  for (const char of text) sum += char.codePointAt(0);
  el.dataset.tone = String(sum % 4);
  el.setAttribute('aria-hidden', 'true');
  return el;
}
function card(item) {
  const el = node('article', 'plugin-card');
  const top = node('div', 'card-top');
  const identity = node('div', 'card-title-block');
  identity.append(node('h3', 'card-title', title(item)), node('div', 'card-author', safeText(item.author, '社群作者')));
  top.append(icon(item), identity);
  const bottom = node('div', 'card-bottom');
  const button = node('button', 'detail-button', '了解插件');
  button.type = 'button';
  button.setAttribute('aria-label', `了解 ${title(item)}`);
  button.addEventListener('click', () => showDetail(item));
  bottom.append(node('span', 'card-category', safeText(item.categoryTitle || item.category, '其他工具')), button);
  el.append(top, node('p', 'card-description', safeText(item.description, '作者尚未提供用途介紹。')), badges(item), bottom);
  return el;
}
function renderCategories(categories = []) {
  const nav = $('category-nav');
  nav.replaceChildren();
  const all = [{ id: '', title: '所有插件' }, ...categories.filter((c) => c.id)];
  for (const category of all) {
    const id = safeText(category.id);
    const button = node('button', `category-button${state.category === id ? ' active' : ''}`);
    button.type = 'button';
    button.append(node('span', '', safeText(category.title, id)));
    if (Number.isFinite(Number(category.count))) button.append(node('span', 'category-count', category.count));
    if (state.category === id) button.setAttribute('aria-current', 'true');
    button.addEventListener('click', () => {
      state.category = id;
      state.page = 1;
      loadCatalog();
    });
    nav.append(button);
  }
}
function renderItems(items, total) {
  $('catalog').replaceChildren(...items.map(card));
  $('catalog').setAttribute('aria-busy', 'false');
  $('result-count').textContent = `${total} 個插件`;
  $('empty-state').hidden = items.length > 0;
  $('empty-title').textContent = state.view === 'installed' && !state.query ? '還沒有安裝插件' : '沒有找到符合的插件';
  $('empty-description').textContent = state.view === 'installed' && !state.query ? '到探索頁找個適合的工具，先了解，再決定是否安裝。' : '換個關鍵字，或試試其他分類。';
  $('empty-action').textContent = state.view === 'installed' && !state.query ? '探索社群插件' : '清除搜尋條件';
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  $('pagination').hidden = state.view !== 'browse' || pages <= 1;
  $('page-info').textContent = `第 ${state.page} / ${pages} 頁`;
  $('prev-page').disabled = state.page <= 1;
  $('next-page').disabled = state.page >= pages;
}
function formatDate(value) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}
async function loadCatalog(refresh = false) {
  if (state.view !== 'browse') return loadInstalled();
  const request = ++state.request;
  loading();
  notice();
  $('refresh-button').disabled = true;
  try {
    const data = await api(endpoint('/api/catalog', { sourceUrl: state.source, q: state.query, category: state.category, page: state.page, pageSize: state.pageSize, ...(refresh ? { refresh: '1' } : {}) }));
    if (request !== state.request) return;
    const items = (Array.isArray(data.items) ? data.items : []).map((item) => ({ ...item, sourceUrl: state.source }));
    state.total = Number.isFinite(Number(data.total)) ? Number(data.total) : items.length;
    state.page = Number(data.page) || state.page;
    renderCategories(data.categories);
    $('results-title').textContent = state.query ? '搜尋結果' : safeText(data.categories?.find((c) => c.id === state.category)?.title, '所有插件');
    const time = formatDate(data.fetchedAt);
    $('updated-at').textContent = time ? `${data.stale ? '暫存資料' : '更新於'} ${time}` : '';
    renderItems(items, state.total);
    if (data.error || data.stale) notice(data.error ? `市場來源暫時無法更新：${safeText(data.error?.message || data.error, '來源沒有回應')}。${items.length ? '目前顯示已取得的資料。' : ''}` : '目前顯示暫存資料，可以稍後重新更新。');
  } catch (error) {
    if (request !== state.request) return;
    renderItems([], 0);
    $('empty-state').hidden = true;
    $('updated-at').textContent = '';
    notice(error.message, true, () => loadCatalog(refresh));
  } finally {
    if (request === state.request) $('refresh-button').disabled = false;
  }
}
async function refreshInstalledCount() {
  try {
    const data = await api('/api/installed');
    state.installed = Array.isArray(data.items) ? data.items.map((item) => ({ ...item, installed: true })) : [];
    $('installed-count').textContent = String(state.installed.length);
    $('installed-count').hidden = state.installed.length === 0;
  } catch { /* Installed inventory is independent from market availability. */ }
}
async function restorePreparedPackages(){
  const prior=document.getElementById('prepared-packages');prior?.remove();
  const data=await api('/api/prepared');if(!data.items?.length&&!data.notices?.length)return;
  const section=node('section','detail-section');section.id='prepared-packages';section.append(node('h3','','已準備，可繼續安裝'));
  for(const result of data.items??[]){
    const button=node('button','button secondary',`查看 ${result.packageName} ${result.version}`);button.type='button';
    button.addEventListener('click',()=>{if(state.job?.running)return;const item={name:result.packageName,title:result.packageName,version:result.version,sourceUrl:state.source,versions:[{version:result.version}]};state.job={id:'restored-'+result.packageRoot,kind:'prepare',item,selectedVersion:result.version,state:'completed',running:false,result};showJob();});section.append(button);
  }
  for(const message of data.notices??[])section.append(node('p','fine-print',message));
  $('catalog').before(section);
}
async function loadInstalled() {
  const request = ++state.request;
  loading();
  notice();
  try {
    const data = await api('/api/installed');
    if (request !== state.request) return;
    state.installed = Array.isArray(data.items) ? data.items.map((item) => ({ ...item, installed: true })) : [];
    $('installed-count').textContent = String(state.installed.length);
    $('installed-count').hidden = !state.installed.length;
    renderInstalled();
  } catch (error) {
    if (request !== state.request) return;
    renderItems([], 0);
    $('empty-state').hidden = true;
    notice(error.message, true, loadInstalled);
  }
}
function renderInstalled() {
  const query = state.query.toLocaleLowerCase();
  const items = state.installed.filter((item) => [item.title, item.name, item.description, item.author].some((s) => safeText(s).toLocaleLowerCase().includes(query)));
  $('results-title').textContent = state.query ? '搜尋結果' : '你的插件';
  $('updated-at').textContent = '';
  renderItems(items, items.length);
}
function setView(view) {
  state.view = view;
  state.query = '';
  state.page = 1;
  $('search').value = '';
  $('browse-nav').classList.toggle('active', view === 'browse');
  $('installed-nav').classList.toggle('active', view === 'installed');
  $('browse-nav').setAttribute('aria-current', view === 'browse' ? 'page' : 'false');
  $('installed-nav').setAttribute('aria-current', view === 'installed' ? 'page' : 'false');
  $('category-section').hidden = view !== 'browse';
  $('source-controls').hidden = view !== 'browse';
  $('journey').hidden = view !== 'browse';
  $('page-eyebrow').textContent = view === 'browse' ? '為你的工作找幫手' : '留在這台電腦的工具';
  $('page-title').textContent = view === 'browse' ? '探索社群插件' : '已安裝的插件';
  $('page-description').textContent = view === 'browse' ? '找到想用的功能，了解它，再帶進 Codex。' : '安裝後，請新開 Codex 聊天載入。個別功能仍可能需要設定或尚未實測。';
  $('breadcrumb-current').textContent = view === 'browse' ? '探索' : '已安裝';
  view === 'browse' ? loadCatalog() : loadInstalled();
}
function externalLink(text, value) {
  if (typeof value !== 'string') return null;
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!['http:', 'https:'].includes(url.protocol)) return null;
  const a = node('a', '', text);
  a.href = url.href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}
function fact(label, value) {
  const el = node('div');
  el.append(node('span', 'fact-label', label), node('span', 'fact-value', value));
  return el;
}
function showDialog() {
  if (!dialog.open) dialog.showModal();
}
async function showDetail(item, fromJob = false) {
  if (state.job?.running && !fromJob) {
    showJob();
    toast('目前有一項工作正在進行，完成後可以準備其他插件。');
    return;
  }
  const request = ++state.detailRequest;
  state.current = { ...item };
  renderDetail(state.current);
  showDialog();
  if (fromJob || item.installed && !item.sourceUrl) return;
  try {
    const data = await api(endpoint('/api/plugin', { sourceUrl: item.sourceUrl || state.source, name: item.name }));
    if (request !== state.detailRequest) return;
    state.current = { ...item, ...data, sourceUrl: item.sourceUrl || state.source };
    renderDetail(state.current);
  } catch (error) {
    if (request !== state.detailRequest) return;
    const message = node('p', 'fine-print error-text', `完整介紹暫時無法讀取：${error.message}`);
    $('detail-content').append(message);
  }
}
function renderDetail(item) {
  const container = $('detail-content');
  container.replaceChildren();
  const identity = node('div', 'detail-identity');
  const text = node('div');
  const heading = node('h2', '', title(item));
  heading.id = 'detail-title';
  text.append(heading, node('div', 'card-author', safeText(item.author, '社群作者')));
  identity.append(icon(item), text);
  container.append(identity, badges(item), node('p', 'detail-description', safeText(item.descriptionFull || item.description, '作者尚未提供用途介紹。')));
  const facts = node('div', 'detail-facts');
  facts.append(fact('分類', safeText(item.categoryTitle || item.category, '其他工具')), fact('版本', version(item)));
  container.append(facts);
  const usage = node('section', 'detail-section');
  usage.append(node('h3', '', '使用前先了解'));
  const count = Number(item.testedFunctions?.count);
  usage.append(node('p', '', count > 0 ? `已有 ${count} 項功能的測試紀錄${item.testedFunctions.version ? `（插件 ${safeText(item.testedFunctions.version)}；轉換器 ${safeText(item.testedFunctions.converterVersion)}）` : ''}。這是歷史紀錄，不代表這次安裝或其他版本已驗證。` : '目前沒有這個插件的功能實測紀錄。審查與轉換完成後，會列出保留、受限及需要設定的內容。'));
  if (item.nativeUi) usage.append(node('p', '', '含原生畫面功能，原始介面可能無法在 Codex 呈現，請查看轉換檢查結果。'));
  if (item.setupRequired) usage.append(node('p', '', '部分功能需要額外設定，請先確認作者說明與檢查結果。'));
  for (const limitation of Array.isArray(item.limitations) ? item.limitations : []) usage.append(node('p', '', safeText(limitation)));
  container.append(usage);
  const links = node('div', 'external-links');
  for (const link of [externalLink('作者網站', item.homepage), externalLink('查看原始專案', item.repository)]) if (link) links.append(link);
  if (links.childElementCount) container.append(links);
  const install = node('section', 'detail-section');
  if (item.installed) {
    install.append(node('p', 'installed-date', `✓ 已安裝${formatDate(item.installedAt) ? ` · ${formatDate(item.installedAt)}` : ''}`), node('p', '', '請新開 Codex 聊天載入。已安裝只表示插件已加入這台電腦，個別功能是否可用仍依設定與實測而定。'));
  } else {
    const picker = node('label', 'version-picker');
    picker.append(node('span', '', '審查與安裝的版本'));
    const select = node('select');
    select.id = 'detail-version';
    select.setAttribute('aria-label', '選擇要審查與安裝的插件版本');
    const values = [...new Set([item.version, ...(Array.isArray(item.versions) ? item.versions.map((v) => typeof v === 'string' ? v : v?.version) : [])].filter((v) => typeof v === 'string' && v))];
    for (const value of values) { const option = node('option', '', value); option.value = value; select.append(option); }
    if (!values.length) { const option = node('option', '', '來源預設版本'); option.value = ''; select.append(option); }
    picker.append(select);
    const prepare = node('button', 'button wide', '交給 Codex 審查');
    prepare.id = 'prepare-button';
    prepare.type = 'button';
    prepare.disabled = state.job?.running === true;
    prepare.addEventListener('click', () => startReview(item, select.value));
    const scanOnly=node('button','button secondary wide','只看固定規則掃描，不用 AI');scanOnly.type='button';scanOnly.disabled=state.job?.running===true;scanOnly.addEventListener('click',()=>startReview(item,select.value,{aiScope:'none'}));
    const steps = node('ol', 'install-steps');
    for (const step of ['下載指定版本的原始碼，尚不執行插件。', '交給 Codex 審查來源，使用現有 Codex 額度。', '看完原樣掃描明細與 AI 意見，由你同意後才轉換。', '轉換插件；有取得第三方依賴時，另交 Codex 審查。', '檢查執行限制，列出保留與受限的內容。', '由你確認後，才安裝到 Codex。']) steps.append(node('li', '', step));
    install.append(picker, reviewSettingsPanel(), steps, prepare, scanOnly, node('p', 'fine-print', '兩種方式都能繼續轉換與安裝；AI 只是協助判斷，不是必經門檻。'));
  }
  if (item.securityUrl) {
    try { const url = new URL(item.securityUrl); if (url.protocol === 'http:' && url.hostname === '127.0.0.1') {
      const settings = node('a', 'button secondary', '開啟安全設定、通知與發文紀錄'); settings.href=url.href;settings.target='_blank';settings.rel='noopener noreferrer';install.append(settings);
    }} catch {}
  }
  if (Array.isArray(item.restrictedFeatures)) resultList(install, '受限功能與原因', item.restrictedFeatures);
  container.append(install);
  const panel = node('section');
  panel.id = 'job-area';
  panel.setAttribute('aria-live', 'polite');
  container.append(panel);
  const technical = node('details', 'technical-details');
  technical.append(node('summary', '', '插件識別與其他資訊'), node('p', '', `插件名稱：${safeText(item.name, '未提供')}\n版本：${version(item)}${item.pluginId ? `\n本機識別碼：${safeText(item.pluginId)}` : ''}`));
  const labels = labelsOf(item);
  if (labels.length) technical.append(node('p', '', `來源標籤：${labels.join('、')}`));
  technical.append(node('p', '', '用途介紹與來源標籤由社群提供；實際轉換與安裝結果以檢查內容為準。'));
  container.append(technical);
  if (samePlugin(state.job?.item, item)) renderJob();
}
const phaseNames = { scan: '固定規則掃描', queued: '等待處理', download: '下載指定版本', review: 'Codex 來源審查', convert: '轉換與取得依賴', 'dependency-review': 'Codex 依賴審查', sandbox: '執行限制與套件檢查', prepared: '安裝前檢查完成', 'install-check': '安裝前重新核對', install: '安裝到 Codex', installed: '安裝完成' };
function phaseName(job) { return phaseNames[job.failedPhase || job.phase] || (job.kind === 'install' ? '安裝' : '審查與安裝前檢查'); }
function jobMessage(job) {
  return safeText(job.message, job.kind === 'install' ? '正在安裝到這台電腦…' : '正在準備來源審查…');
}
function preparationSteps(job) {
  const list = node('ol', 'install-steps progress-steps');
  for (const phase of (job.kind === 'review' ? ['download', 'scan', 'review'] : ['convert', 'dependency-review', 'sandbox'])) {
    const active = job.phase === phase;
    const step = node('li', active ? 'current-step' : '', `${phaseNames[phase]}${phase === 'dependency-review' ? '（有取得第三方依賴時）' : ''}${active ? ' · 進行中' : ''}`);
    if (active) step.setAttribute('aria-current', 'step');
    list.append(step);
  }
  return list;
}
function updateJobReopen() {
  const job = state.job;
  $('shutdown-button').disabled = job?.running === true;
  jobReopen.hidden = !job;
  if (!job) return;
  jobReopen.textContent = `${job.running ? phaseName(job) : job.failed ? '工作需要處理' : job.kind === 'install' ? '查看安裝結果' : '查看審查與檢查結果'} · ${title(job.item)} →`;
}
function showJob() {
  if (!state.job) return;
  ++state.detailRequest;
  state.current = state.job.item;
  renderDetail(state.job.item);
  showDialog();
  $('job-area')?.scrollIntoView({ block: 'nearest' });
}
function componentText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const kindNames = { 'dsh-host': '插件工具：已產生連線設定，尚未啟動', 'dsh-tools': '插件工具：已完成程式轉換，尚未啟動', 'declared-mcp': '工具連線設定：已保留，尚未連線', 'python-mcp': 'Python 工具連線：已保留，仍需準備執行環境', 'command-skill': '指令說明：已保留，原始指令不能直接執行' };
  if (kindNames[value.kind]) return kindNames[value.kind];
  if (value.kind === 'skill') return `技能說明：${safeText(value.name, '已保留')}`;
  if (value.code === 'HOST_BOUNDARIES') return 'DSH 原生聊天畫面與模型流程無法搬進 Codex；需要這些功能的工具仍須另外驗證。';
  const name = safeText(value.title || value.name || value.type || value.id || value.path, '項目');
  const detail = safeText(value.description || value.reason || value.message || value.status);
  return detail ? `${name}：${detail}` : name;
}
function resultList(parent, heading, values) {
  if (!Array.isArray(values) || !values.length) return;
  parent.append(node('h3', '', heading));
  const list = node('ul');
  for (const value of values) { const text = componentText(value); if (text) list.append(node('li', '', text)); }
  parent.append(list);
}
function reviewSettingsPanel() {
  const settings = {model:'gpt-6.1-sol',reasoningEffort:'medium',maxInputChars:60000,representativePerCategory:3,...state.reviewSettings};
  const panel = node('details', 'technical-details'); panel.append(node('summary', '', 'AI 審查用量設定'));
  const add = (label, input) => { const row = node('label', 'version-picker'); row.append(node('span', '', label), input); panel.append(row); };
  const model = node('input'); model.id = 'review-model'; model.type = 'text'; model.value = settings.model || ''; model.placeholder = '留空，沿用 Codex 預設模型'; add('審查模型（可留空）', model);
  const effort = node('select'); effort.id = 'review-effort';
  for (const [value,label] of [['none','無'],['minimal','最低'],['low','低'],['medium','中'],['high','高'],['xhigh','很高'],['max','最高']]) { const option = node('option','',label); option.value=value; effort.append(option); } effort.value=settings.reasoningEffort; add('思考強度',effort);
  const limit = node('input'); limit.id='review-limit'; limit.type='number'; limit.min='1'; limit.step='1'; limit.value=settings.maxInputChars; add('用量建議上限（輸入字元數）',limit);
  const representatives = node('input'); representatives.id='review-representatives'; representatives.type='number'; representatives.min='1'; representatives.step='1'; representatives.value=settings.representativePerCategory; add('每類代表片段數',representatives);
  panel.append(node('p','fine-print','先合併重複位置，再估計輸入量；超過建議上限時由你選擇範圍。這項設定不增加轉換或安裝門檻，不會自動拆成多次 AI 呼叫。'));
  const save=node('button','button secondary','儲存審查設定'); save.type='button';
  save.addEventListener('click',async()=>{try { save.disabled=true; state.reviewSettings=await api('/api/review-settings',{method:'POST',body:JSON.stringify(currentReviewSettings())}); toast('已儲存審查設定'); } catch(error) { toast(error.message); } finally { save.disabled=false; }}); panel.append(save); return panel;
}
function currentReviewSettings() {
  if (!$('review-model')) return state.reviewSettings || undefined;
  const maxInputChars=Number($('review-limit').value), representativePerCategory=Number($('review-representatives').value);
  if(!Number.isSafeInteger(maxInputChars)||maxInputChars<1||!Number.isSafeInteger(representativePerCategory)||representativePerCategory<1)throw new Error('用量建議上限與代表片段數必須是正整數。');
  return {model:$('review-model').value.trim()||null,reasoningEffort:$('review-effort').value,maxInputChars,representativePerCategory};
}
function reviewPlan(parent,plan) {
  if(!plan)return;
  parent.append(node('h4','','AI 用量估計'),node('p','',`掃描標記 ${safeText(plan.findingCount,'未知')} 處，合併為 ${safeText(plan.groupCount,'未知')} 組；本次選 ${safeText(plan.selectedGroups,'未知')} 組，略過 ${safeText(plan.omittedFindings,'未知')} 處。`));
  parent.append(node('p','',`預計輸入 ${safeText(plan.inputChars,'未知')} 字元，約 ${safeText(plan.estimatedTokens?.min,'未知')}–${safeText(plan.estimatedTokens?.max,'未知')} 個 token（文字單位）；建議上限 ${safeText(plan.softLimitChars,'未知')} 字元。`));
  parent.append(node('p','',`模型：${safeText(plan.model,'沿用 Codex 預設')}；思考強度：${({none:'無',minimal:'最低',low:'低',medium:'中',high:'高',xhigh:'很高',max:'最高'})[plan.reasoningEffort]||safeText(plan.reasoningEffort,'沿用預設')}。`));
  parent.append(node('p','fine-print','輸入估計無法可靠換算成帳號額度百分比；實際用量也受模型、輸出與思考量影響。'));
  if(plan.quota) {
    const quota=plan.quota,windows=[quota.primary?{...quota.primary,label:'主要時段'}:null,quota.secondary?{...quota.secondary,label:'次要時段'}:null].filter(Boolean);
    const details=windows.map(window=>typeof window.remainingPercent==='number'?`${safeText(window.label,'目前視窗')}剩餘 ${window.remainingPercent}%`:typeof window.usedPercent==='number'?`${safeText(window.label,'目前視窗')}已用 ${window.usedPercent}%`:null).filter(Boolean);
    parent.append(node('p','fine-print',quota.available?`目前帳號額度狀態可讀取${details.length?'：'+details.join('；'):'，但沒有可顯示的百分比'}。這不是本次審查會消耗的比例。`:'目前無法讀取帳號額度狀態。'));
    if(quota.notice)parent.append(node('p','fine-print',safeText(quota.notice)));
  }
  if(plan.notice)parent.append(node('p','fine-print',safeText(plan.notice)));
}
function reviewResult(parent, heading, review) {
  parent.append(node('h3', '', `${heading}：${({approved:'AI 已提出通過意見','needs-choice':'超過用量建議上限，尚未呼叫 AI','quota-paused':'目前額度不足，已暫停 AI；仍可繼續轉換',skipped:'已選擇只看固定規則掃描',not_needed:'固定規則沒有標記需 AI 複查的程式碼','not-needed':'固定規則沒有標記需 AI 複查的程式碼',unavailable:'AI 審查未完成',manual_review:'AI 建議人工確認',rejected:'AI 提出不建議使用的意見'})[review?.status] || '沒有完整 AI 意見'}`));
  if (review?.summary) parent.append(node('p', '', safeText(review.summary)));
  if(review?.modelUsage?.available)parent.append(node('p','fine-print',`Codex 回報的實際詞元：輸入 ${safeText(review.modelUsage.inputTokens,'未提供')}，其中快取 ${safeText(review.modelUsage.cachedInputTokens,'未提供')}；輸出 ${safeText(review.modelUsage.outputTokens,'未提供')}。詞元數不等於額度百分比。`));
  reviewPlan(parent,review?.aiPlan);
  const findings = (Array.isArray(review?.findings) ? review.findings : []).map(f => `${safeText(f.file, '審查提醒')}：${safeText(f.reason)}`);
  resultList(parent, '審查提醒', findings);
}
function renderJob() {
  updateJobReopen();
  const job = state.job;
  if (!job || !samePlugin(job.item, state.current)) return;
  const area = $('job-area');
  if (!area) return;
  area.replaceChildren();
  const prepare = $('prepare-button');
  if (prepare) prepare.disabled = job.running || !!job.result;
  const panel = node('div', 'job-panel');
  area.append(panel);
  if (job.running) {
    const heading = node('p', 'job-heading');
    const spinner = node('span', 'spinner');
    spinner.setAttribute('aria-hidden', 'true');
    heading.append(spinner, node('span', '', phaseName(job)));
    panel.append(heading, node('p', 'job-message', jobMessage(job)));
    if(job.aiPlan)reviewPlan(panel,job.aiPlan);
    if(job.aiProgress)panel.append(node('p','fine-print',`AI 已送出 ${safeText(job.aiProgress.sentChars,0)} 字元，已完成 ${safeText(job.aiProgress.completedChars,0)} 字元，尚未送出 ${safeText(job.aiProgress.remainingChars,0)} 字元；模型呼叫已完成 ${safeText(job.aiProgress.completedCalls,0)} / 已送出 ${safeText(job.aiProgress.submittedCalls,0)} 次。`));
    if (job.kind !== 'install') panel.append(preparationSteps(job), node('p', 'fine-print', '目前只做審查與安裝前檢查，完成後仍由你確認安裝。'));
    return;
  }
  if (job.failed) {
    panel.append(node('p', 'job-heading error-text', job.pollError ? '暫時無法取得進度' : `${phaseName(job)}未完成`), node('p', 'job-message error-text', safeText(job.error, '服務沒有提供錯誤資訊。')));
    if (!job.pollError) {
      const phase = job.failedPhase || job.phase;
      const help = phase === 'review' || phase === 'dependency-review' ? '請依上方原因處理來源問題，或確認 Codex 登入與額度後，再重新審查。' : phase === 'sandbox' ? '請依上方原因修正執行環境，再重新檢查；尚不能確認安裝。' : job.kind === 'install' ? '尚未確認安裝完成。重試時會重新核對來源、依賴與安裝內容。' : '請依上方原因處理後，再重新審查與檢查。';
      panel.append(node('p', 'fine-print', help));
    }
    if (job.kind === 'install' && job.prepared && !job.pollError) {
      const retry = node('button', 'button secondary', '重試安裝');
      retry.type = 'button';
      retry.addEventListener('click', () => startInstall(job.prepared));
      panel.append(retry);
    }
    if (job.pollError && job.id) {
      const retry = node('button', 'button secondary', '重新查詢進度');
      retry.type = 'button';
      retry.addEventListener('click', () => { job.running = true; job.failed = false; renderJob(); pollJob(job); });
      panel.append(retry);
    }
    if (job.kind !== 'install' && !job.pollError) {
      const retry = node('button', 'button secondary', '重新審查與檢查');
      retry.type = 'button';
      retry.addEventListener('click', () => startReview(job.item, job.selectedVersion));
      panel.append(retry);
    }
    return;
  }
  const result = job.result || {};
  panel.classList.add('job-result');
  if (job.kind === 'install') {
    panel.append(node('span', 'success-icon', '✓'), node('h3', '', result.installed === true ? '插件已安裝' : '請確認安裝結果'), node('p', '', safeText(result.message, result.installed === true ? '已安裝，請新開 Codex 聊天載入。' : '服務尚未確認插件已安裝。')), node('p', 'fine-print', '已安裝不代表全部功能都已驗證，仍可能需要額外設定。'));
    return;
  }
  if (job.kind === 'review') {
    panel.append(node('h3', '', '來源審查結果 · 尚未轉換與安裝'));
    reviewResult(panel, 'AI 對固定規則標記位置的複查', result.sourceReview);
    if(result.sourceReview?.status==='needs-choice') {
      panel.append(node('p','','內容超過用量建議上限，尚未呼叫 AI。可選擇以下範圍，也可看完掃描後直接繼續轉換。'));
      const choices=node('div','review-choices');
      for(const [scope,label] of [['code','只審程式檔'],['all','照樣全部審查（合併後內容）'],['none','不用 AI，只看掃描']]) { const choice=node('button','button secondary',label);choice.type='button';choice.addEventListener('click',()=>startReview(job.item,job.selectedVersion,{reviewId:result.reviewId,aiScope:scope}));choices.append(choice); } panel.append(choices);
    }
    panel.append(node('p', 'fine-print', 'AI 意見只涵蓋固定規則標記的位置；並非逐行讀完整份來源碼。AI 未完成、拒絕或建議人工確認，均可由你判斷後繼續。'));
    panel.append(node('p', 'fine-print', '轉換時會配置 Node.js（JavaScript 執行環境）的自訂資料夾限制；主平台的原生權限能否同步會另行列出。原生偵測未完成會說明差異，仍由你決定是否安裝。'));
    panel.append(node('h3', '', '固定規則掃描原樣明細'));
    const scan = node('pre', 'scan-details', JSON.stringify(result.scan ?? result.sourceReview?.scan ?? {}, null, 2));
    panel.append(scan);
    const forceLabel = node('label', 'consent-label');
    const force = node('input'); force.type = 'checkbox'; force.id = 'force-obfuscated';
    forceLabel.append(force, node('span', '', '我仍要強制轉換無法判讀的混淆程式碼（預設不轉換；無法確認其實際行為）。'));
    const obfuscated = result.scan?.obfuscated === true;
    if (obfuscated) panel.append(forceLabel);
    const consentLabel = node('label', 'consent-label');
    const consent = node('input'); consent.type = 'checkbox'; consent.id = 'review-consent';
    consentLabel.append(consent, node('span', '', '我已看過掃描明細與 AI 意見，同意繼續轉換與安裝前檢查。'));
    panel.append(consentLabel);
    const proceed = node('button', 'button wide', '同意後繼續轉換'); proceed.type = 'button'; proceed.disabled = true;
    const updateConsent = () => { proceed.disabled = !consent.checked || obfuscated && !force.checked; };
    consent.addEventListener('change', updateConsent); force.addEventListener('change', updateConsent);
    proceed.addEventListener('click', () => startConversion(job, force.checked)); panel.append(proceed);
    return;
  }
  const status = result.status;
  const unsupported = status === 'unsupported';
  panel.append(node('h3', '', unsupported ? '目前無法安裝此插件' : '安裝前檢查結果 · 尚未安裝'), node('span', 'result-status', status === 'ready' ? '已產生套件，請確認下方審查與權限結果' : status === 'partial' ? '部分內容已轉換，請確認保留與受限項目' : unsupported ? '來源內容尚無法轉換為可安裝套件' : '請核對下方差異與已保留的套件內容，再決定是否安裝'));
  if (result.packageName || result.version) panel.append(node('p', '', `${safeText(result.packageName, title(job.item))} · ${safeText(result.version, version(job.item))}`));
  resultList(panel, '本次準備提醒', result.preparationNotices);
  if (result.security) {
    reviewResult(panel, '固定規則與 AI 來源審查', result.security.sourceReview);
    if (result.security.dependencyReview) reviewResult(panel, '第三方依賴審查', result.security.dependencyReview);
    else panel.append(node('h3', '', '第三方依賴審查'), node('p', '', result.security.dependencyStatus === 'not-needed' ? '本次沒有新增需要另外審查的第三方依賴。' : result.security.dependencyStatus === 'disabled' ? '本次停用依賴取得，沒有依賴審查紀錄；相關功能仍需確認。' : '沒有另行依賴審查紀錄，不標示為已通過。'));
    if (result.security.pythonDependencyReview) reviewResult(panel, 'Python 依賴審查', result.security.pythonDependencyReview);
    const sandbox = result.security.sandbox;
    const executionStatus = sandbox?.codeExecution === false ? '沒有自動啟動的工具程序；技能指令沿用一般 Codex 執行限制。' : sandbox ? '套件已配置 Node.js（JavaScript 執行環境）的自訂資料夾限制，可在插件安全設定調整；主平台原生權限的同步狀態另行說明。' : '服務沒有提供執行限制的檢測紀錄；請查看保留內容與設定，由你決定是否安裝。';
    panel.append(node('h3', '', '執行權限'), node('p', '', executionStatus));
    if (sandbox?.codeExecution !== false && sandbox?.enforced !== true) panel.append(node('p', 'fine-print', `主平台原生權限的同步尚未確認。${safeText(sandbox?.message)} 這項差異不會阻擋安裝；你仍可看完說明後決定。`));
    else if (sandbox?.codeExecution !== false && sandbox?.enforced === true) panel.append(node('p', 'fine-print', '主平台原生限制的安裝前檢測已完成；實際工具執行時，仍依當次 Codex 傳入的權限資料決定。'));
    panel.append(node('p', 'fine-print', '審查與權限檢查不能保證安全，也不代表插件功能已實測。'));
  }
  resultList(panel, '已保留的內容', result.components);
  resultList(panel, '程式中找到的工具（尚未啟動）', result.sourceTools);
  resultList(panel, '略過或受限的內容', result.omitted);
  panel.append(node('h3', '', '使用前的設定'), node('p', '', job.item.setupRequired ? '來源標示需要額外設定，請查看作者說明及上方受限內容。金鑰設定不代表允許插件取得其他憑證。' : '本次檢查未逐項驗證登入、金鑰及其他設定需求；請依作者說明與受限內容確認。'));
  if (result.appliedOutputCompatibility?.lenientOutput || result.appliedOutputCompatibility?.allowUndeclaredOutput) panel.append(node('p', 'fine-print', '使用此版本已驗證的輸出相容設定；輸入與已宣告欄位的型別仍會檢查。'));
  if (!Array.isArray(result.components) || !result.components.length) panel.append(node('p', 'fine-print', '服務沒有列出保留內容，請展開其他資訊查看。'));
  panel.append(node('p', 'fine-print', '轉換檢查只確認套件內容，尚未代表這些功能能在 Codex 正常執行。'));
  const technical = node('details', 'technical-details');
  technical.append(node('summary', '', '查看轉換細節'));
  if (result.sourceToolCount !== undefined) technical.append(node('p', '', `來源工具數量：${safeText(result.sourceToolCount)}`));
  resultList(technical, '來源工具', result.sourceTools);
  if (result.license) technical.append(node('p', '', `授權：${safeText(result.license)}`));
  if (result.packageRoot) technical.append(node('p', '', `套件位置：${safeText(result.packageRoot)}`));
  panel.append(technical);
  const install = node('button', 'button wide', '確認安裝到這台電腦');
  install.type = 'button';
  install.disabled = unsupported || !result.components?.length;
  install.addEventListener('click', () => startInstall(job));
  panel.append(install);
  if (!install.disabled) panel.append(node('p', 'fine-print', '按下後會重新核對審查紀錄與內容，再交由 Codex 安裝。完成後，請新開聊天載入；這一步不會執行插件功能測試。'));
}
async function startReview(item, selectedVersion, options = {}) {
  if (state.job?.running) return;
  let reviewSettings;try {reviewSettings=currentReviewSettings();}catch(error){toast(error.message);return;}
  // Only this human click handler can create a preparation job.
  const job = { kind: 'review', item: { ...item }, selectedVersion, running: true, phase: 'queued', message: '正在建立審查與安裝前檢查工作…' };
  state.job = job;
  ++state.detailRequest;
  renderJob();
  $('job-area')?.scrollIntoView({ block: 'start' });
  await submitJob(job, { sourceUrl: item.sourceUrl || state.source, name: item.name, version: selectedVersion,reviewSettings,...options }, '/api/review');
}
async function startConversion(reviewed, forceObfuscated = false) {
  if (state.job?.running || !reviewed.result?.reviewId) return;
  const job = {kind:'prepare',item:reviewed.item,selectedVersion:reviewed.selectedVersion,reviewed,running:true,phase:'queued',message:'你已同意，正在轉換與檢查執行權限…'};
  state.job=job;renderJob();
  await submitJob(job,{sourceUrl:job.item.sourceUrl||state.source,name:job.item.name,version:job.selectedVersion,reviewId:reviewed.result.reviewId,consent:true,forceObfuscated},'/api/prepare');
}
async function startInstall(prepared) {
  if (state.job?.running || !prepared.id || prepared.result?.status === 'unsupported' || !prepared.result?.components?.length) return;
  // Installation requires its own explicit human click after the inspection result.
  const job = { kind: 'install', item: prepared.item, prepared, running: true, message: '正在建立安裝工作…' };
  state.job = job;
  renderJob();
  $('job-area')?.scrollIntoView({ block: 'start' });
  await submitJob(job, { action: 'install', preparedJobId: prepared.id, packageRoot: prepared.result.packageRoot });
}
async function submitJob(job, body, route = '/api/jobs') {
  try {
    const data = await api(route, { method: 'POST', body: JSON.stringify(body) });
    if (!data.id) throw new Error('服務沒有提供工作識別碼，無法追蹤結果。請先檢查本機服務狀態。');
    Object.assign(job, data, { kind: job.kind, item: job.item });
    if (finishJobIfNeeded(job)) return;
    renderJob();
    await pollJob(job);
  } catch (error) {
    job.running = false;
    job.failed = true;
    job.error = error.message;
    renderJob();
  }
}
function finishJobIfNeeded(job) {
  if (job.state !== 'completed' && job.state !== 'failed') return false;
  job.running = false;
  job.failed = job.state === 'failed';
  if (job.failed) job.error = safeText(job.error?.message || job.error || job.message, '工作執行失敗。');
  if (!job.failed && job.kind === 'install' && job.result?.installed === true) {
    job.item.installed = true;
    job.item.pluginId = job.result.pluginId;
    if (samePlugin(job.item, state.current)) { state.current = job.item; renderDetail(job.item); }
    refreshInstalledCount().then(() => { if (state.view === 'installed') renderInstalled(); else loadCatalog(); });
    toast('插件已安裝，請新開 Codex 聊天載入。');
    restorePreparedPackages().catch(()=>{});
  }
  renderJob();
  return true;
}
async function pollJob(job) {
  try {
    while (state.job === job && job.running) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const data = await api(`/api/jobs/${encodeURIComponent(job.id)}`);
      Object.assign(job, data);
      if (finishJobIfNeeded(job)) return;
      renderJob();
    }
  } catch (error) {
    job.running = false;
    job.failed = true;
    job.pollError = true;
    job.error = `暫時無法取得工作進度，工作可能仍在執行。${error.message}`;
    renderJob();
  }
}
async function init() {
  loading();
  try {
    state.config = await api('/api/config');
    try {state.reviewSettings=await api('/api/review-settings');}catch(error){toast(`目前無法讀取審查設定：${error.message}`);}
    $('app-version').textContent = state.config.version ? `版本 ${safeText(state.config.version)}` : '';
    const sources = Array.isArray(state.config.sources) ? state.config.sources : [];
    $('source-select').replaceChildren();
    for (const source of sources) {
      const option = node('option', '', sourceName(source));
      option.value = safeText(source.url);
      $('source-select').append(option);
    }
    if (!sources.length) throw new Error('尚未設定市場來源，請先在本機服務中加入來源。');
    state.source = safeText(sources[0].url);
    await Promise.allSettled([loadCatalog(), refreshInstalledCount(), restorePreparedPackages()]);
  } catch (error) {
    $('catalog').replaceChildren();
    $('catalog').setAttribute('aria-busy', 'false');
    $('result-count').textContent = '';
    notice(`市場尚未就緒：${error.message}`, true, init);
  }
}
$('browse-nav').addEventListener('click', () => setView('browse'));
$('installed-nav').addEventListener('click', () => setView('installed'));
$('source-select').addEventListener('change', () => { state.source = $('source-select').value; state.category = ''; state.page = 1; loadCatalog(); });
$('refresh-button').addEventListener('click', () => loadCatalog(true));
$('search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { state.query = $('search').value.trim(); state.page = 1; state.view === 'browse' ? loadCatalog() : renderInstalled(); }, 260);
});
$('empty-action').addEventListener('click', () => {
  if (state.view === 'installed' && !state.query) return setView('browse');
  state.query = ''; state.category = ''; state.page = 1; $('search').value = '';
  state.view === 'browse' ? loadCatalog() : renderInstalled();
});
$('prev-page').addEventListener('click', () => { state.page--; loadCatalog(); });
$('next-page').addEventListener('click', () => { state.page++; loadCatalog(); });
$('close-detail').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog && event.clientX < dialog.getBoundingClientRect().left) dialog.close(); });
jobReopen.addEventListener('click', showJob);
$('shutdown-button').addEventListener('click', async () => {
  const button = $('shutdown-button');
  button.disabled = true;
  button.textContent = '正在關閉…';
  try {
    await api('/api/shutdown', { method: 'POST', body: '{}' });
    if (dialog.open) dialog.close();
    ++state.request;
    ++state.detailRequest;
    clearTimeout(searchTimer);
    const closed = node('section', 'empty-state');
    closed.append(node('span', 'success-icon', '✓'), node('h1', '', '市場已關閉'), node('p', '', '本機市場服務已停止。現在可以關閉這個分頁。'));
    $('main-content').replaceChildren(closed);
    $('shutdown-button').textContent = '已關閉';
    for (const control of document.querySelectorAll('.sidebar button')) control.disabled = true;
    $('toast').hidden = true;
  } catch (error) {
    button.disabled = false;
    button.textContent = '關閉市場';
    toast(`無法確認市場已關閉：${error.message}`);
  }
});
document.addEventListener('keydown', (event) => { if (event.key === '/' && !dialog.open && $('search') && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { event.preventDefault(); $('search').focus(); } });
init();
