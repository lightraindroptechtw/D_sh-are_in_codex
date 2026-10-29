import { mkdir, readFile, writeFile, readdir, stat, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const META_FIELDS = ['author', 'homepage', 'repository', 'license', 'keywords'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const json = value => JSON.stringify(value, null, 2) + '\n';
const inside = (root, file) => { const rel = path.relative(root, file); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); };
const named = value => typeof value === 'string' && value.length <= 64 && NAME.test(value);
const envNames = value => Array.isArray(value) && value.every(name => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) && new Set(value).size === value.length;

function field(text, key) {
  const header = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const value = header?.match(new RegExp('^' + key + ':\\s*(.+?)\\s*$', 'm'))?.[1];
  if (!value) return undefined;
  if (value.startsWith('"')) { try { return JSON.parse(value); } catch { return undefined; } }
  if (value.startsWith("'")) return value.endsWith("'") ? value.slice(1, -1).replaceAll("''", "'") : undefined;
  return value;
}

// Codex CLI 0.160.0 resolves relative cwd against the installed plugin root,
// but does not expand CODEX_PLUGIN_ROOT in arguments. Use cwd "." and relative
// argument paths, preserving cache relocation and spaces without shell quoting.
function resolveLocal(value, root, relative = false) {
  if (typeof value !== 'string') return value;
  const marker = '${CODEX_PLUGIN_ROOT}';
  if (value.includes(marker)) {
    if (!value.startsWith(marker) || value.indexOf(marker, marker.length) !== -1) throw new Error('CODEX_PLUGIN_ROOT must be at the beginning of a local path');
    const suffix = value.slice(marker.length).replace(/^[\\/]+/, '');
    const result = path.resolve(root, suffix);
    if (!inside(root, result)) throw new Error('CODEX_PLUGIN_ROOT path escapes the package');
    return './' + path.relative(root, result).replaceAll('\\', '/');
  }
  if (relative && /^\.\//.test(value)) {
    const result = path.resolve(root, value);
    if (!inside(root, result)) throw new Error('Relative MCP path escapes the package');
    return value;
  }
  return value;
}

/** Write the Codex compatibility layout; never installs or changes user config. */
export async function writeCodexPackage({ outputDir, name, description, skillText, mcpServers = {}, version = '0.1.0', metadata = {}, additionalSkillPaths = [] }) {
  if (!named(name)) throw new Error('Plugin name must be lowercase kebab-case and at most 64 characters');
  if (typeof description !== 'string' || !description.trim()) throw new Error('Plugin description is required');
  if (typeof skillText !== 'string' || !skillText.trim()) throw new Error('skillText is required');
  if (!object(mcpServers) || !object(metadata)) throw new Error('mcpServers and metadata must be objects');
  const root = path.resolve(outputDir);
  const skillName = field(skillText, 'name') || name;
  if (!named(skillName)) throw new Error('Skill name must be lowercase kebab-case and at most 64 characters');
  const text = skillText.startsWith('---') ? skillText : `---\nname: ${skillName}\ndescription: ${JSON.stringify(description)}\n---\n\n${skillText}`;
  const servers = {};
  for (const [key, source] of Object.entries(mcpServers)) {
    if (!object(source)) throw new Error(`MCP server ${key} must be an object`);
    const server = structuredClone(source);
    if (server.env_vars !== undefined && !envNames(server.env_vars)) throw new Error(`MCP server ${key}: env_vars must contain unique environment variable names`);
    if (server.command !== undefined) server.command = resolveLocal(server.command, root, true);
    if (server.command && server.cwd === undefined) server.cwd = '.';
    if (Array.isArray(server.args)) server.args = server.args.map(arg => resolveLocal(arg, root, true));
    if (server.cwd !== undefined) server.cwd = resolveLocal(server.cwd, root, true);
    if (object(server.env)) for (const [env, value] of Object.entries(server.env)) server.env[env] = resolveLocal(value, root);
    servers[key] = server;
  }
  const manifest = { name, version, description, skills: './skills/', interface: { displayName: name, shortDescription: description, ...(object(metadata.interface) ? metadata.interface : {}) } };
  if (additionalSkillPaths.length) manifest.skills = ['./skills/', ...additionalSkillPaths.map(p => resolveLocal(p, root, true))];
  for (const key of META_FIELDS) if (metadata[key] !== undefined) manifest[key] = structuredClone(metadata[key]);
  if (Object.keys(servers).length) manifest.mcpServers = './.mcp.json';
  const manifestPath = path.join(root, '.codex-plugin', 'plugin.json');
  const skillPath = path.join(root, 'skills', skillName, 'SKILL.md');
  const mcpPath = Object.keys(servers).length ? path.join(root, '.mcp.json') : null;
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await mkdir(path.dirname(skillPath), { recursive: true });
  await writeFile(manifestPath, json(manifest), 'utf8');
  await writeFile(skillPath, text.trimEnd() + '\n', 'utf8');
  if (mcpPath) await writeFile(mcpPath, json({ mcpServers: servers }), 'utf8');
  else await rm(path.join(root, '.mcp.json'), { force: true });
  return { outputDir: root, manifestPath, skillPath, mcpPath, manifest };
}

/** Structural/file checks only. A valid result is not a Codex load/launch test. */
export async function validateCodexPackage(dir) {
  const root = path.resolve(dir), errors = [], warnings = [];
  const readJson = async file => { try { const data = JSON.parse(await readFile(file, 'utf8')); if (!object(data)) throw new Error('must contain a JSON object'); return data; } catch (error) { errors.push(`${path.relative(root, file)}: ${error.message}`); return null; } };
  const local = async (value, label, kind) => {
    if (typeof value !== 'string' || !value.startsWith('./') || value.replaceAll('\\', '/').split('/').includes('..')) { errors.push(`${label} must be a ./ path inside the package`); return null; }
    const target = path.resolve(root, value);
    try {
      if (!inside(await realpath(root), await realpath(target))) throw new Error('symbolic link escapes the package');
      const s = await stat(target);
      if (kind === 'directory' ? !s.isDirectory() : !s.isFile()) throw new Error(`must be a ${kind}`);
      return target;
    } catch (error) { errors.push(`${label}: ${error.message}`); return null; }
  };
  const manifest = await readJson(path.join(root, '.codex-plugin', 'plugin.json'));
  if (!manifest) return { valid: false, errors, warnings };
  if (!named(manifest.name)) errors.push('manifest.name must be lowercase kebab-case and at most 64 characters');
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(manifest.version)) errors.push('manifest.version must be a semantic version');
  if (typeof manifest.description !== 'string' || !manifest.description.trim()) errors.push('manifest.description is required');
  if (!object(manifest.interface) || !manifest.interface.displayName || !manifest.interface.shortDescription) errors.push('manifest.interface requires displayName and shortDescription');
  if (manifest.skills) {
    for (const skillRoot of Array.isArray(manifest.skills) ? manifest.skills : [manifest.skills]) {
    const skills = await local(skillRoot, 'manifest.skills', 'directory');
    if (skills) {
      let count = 0;
      let direct = false; try { direct = (await stat(path.join(skills, 'SKILL.md'))).isFile(); } catch {}
      const entries = direct ? [{name:path.basename(skills),isDirectory:()=>true}] : await readdir(skills, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const file = await local('./' + path.relative(root, path.join(direct ? skills : path.join(skills, entry.name), 'SKILL.md')).replaceAll('\\', '/'), `skill ${entry.name}`, 'file');
        if (!file) continue;
        count++;
        const text = await readFile(file, 'utf8');
        const declaredName=field(text,'name');
        if(!named(declaredName))errors.push(`skill ${entry.name}: frontmatter name must be lowercase kebab-case and at most 64 characters`);
        else if(declaredName!==entry.name)warnings.push(`skill ${entry.name}: declared name ${declaredName} differs from its resource directory; Codex reads the declared name and the original resource path is preserved`);
        if (!field(text, 'description')) errors.push(`skill ${entry.name}: frontmatter description is required`);
      }
      if (!count) errors.push('No readable skills found under manifest.skills');
    }
    }
  }
  if (manifest.mcpServers) {
    const file = await local(manifest.mcpServers, 'manifest.mcpServers', 'file');
    const data = file && await readJson(file);
    if (data && !object(data.mcpServers)) errors.push('.mcp.json requires an mcpServers object');
    for (const [name, server] of Object.entries(data?.mcpServers || {})) {
      if (!object(server)) { errors.push(`MCP ${name}: configuration must be an object`); continue; }
      if (server.env_vars !== undefined && !envNames(server.env_vars)) errors.push(`MCP ${name}: env_vars must contain unique environment variable names`);
      if (server.type !== undefined && !['stdio', 'http', 'streamable_http', 'streamable-http'].includes(server.type)) errors.push(`MCP ${name}: unsupported transport type`);
      if (server.command) {
        if (server.url) errors.push(`MCP ${name}: command and url cannot both be set`);
        if (typeof server.command !== 'string') errors.push(`MCP ${name}: command must be a string`);
        if (server.args !== undefined && (!Array.isArray(server.args) || server.args.some(x => typeof x !== 'string'))) errors.push(`MCP ${name}: args must be a string array`);
        if (server.env !== undefined && (!object(server.env) || Object.values(server.env).some(x => typeof x !== 'string'))) errors.push(`MCP ${name}: env must contain string values`);
        const strings = [server.command, ...(Array.isArray(server.args) ? server.args : []), ...Object.values(server.env || {})];
        if (strings.some(x => typeof x === 'string' && x.includes('${CODEX_PLUGIN_ROOT}'))) errors.push(`MCP ${name}: unresolved CODEX_PLUGIN_ROOT`);
        if (strings.some(x => typeof x === 'string' && (path.isAbsolute(x) || path.win32.isAbsolute(x)))) warnings.push(`MCP ${name}: absolute local paths bind this package to the generation location; regenerate after moving it`);
        for (const candidate of [server.command, Array.isArray(server.args) ? server.args[0] : undefined]) {
          if (typeof candidate !== 'string' || !(candidate.startsWith('./') || path.isAbsolute(candidate) || path.win32.isAbsolute(candidate))) continue;
          const resolved = path.resolve(root, typeof server.cwd === 'string' ? server.cwd : '.', candidate);
          try { await stat(resolved); } catch { errors.push(`MCP ${name}: local executable or entry point does not exist: ${candidate}`); }
        }
      } else if (server.url) {
        try { const url = new URL(server.url); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); } catch { errors.push(`MCP ${name}: url must be HTTP(S)`); }
      } else errors.push(`MCP ${name}: command or url is required`);
    }
  }
  if (!manifest.skills && !manifest.mcpServers) errors.push('Package must declare skills or MCP servers');
  warnings.push('These are structural checks only; Codex parser loading and MCP initialization must be tested separately.');
  return { valid: errors.length === 0, errors, warnings };
}
