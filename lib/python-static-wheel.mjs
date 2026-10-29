import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

// This repacker reads literal setup metadata; it never imports setup.py,
// setuptools, a build backend, or code from the downloaded project.
const script=String.raw`import sys,pathlib,tarfile,ast,json,zipfile,hashlib,base64,csv,io,re
archive,root,wheels,expected_name,expected_version=sys.argv[1:]
root=pathlib.Path(root).resolve();root.mkdir(parents=True,exist_ok=True)
total=0
with tarfile.open(archive,'r:gz') as tar:
 members=tar.getmembers()
 if len(members)>10000:raise ValueError('too many source members')
 for member in members:
  p=pathlib.PurePosixPath(member.name)
  if p.is_absolute() or '..' in p.parts or '\\' in member.name or ':' in member.name or not(member.isdir() or member.isfile()):raise ValueError('unsafe source member')
  if member.isdir():continue
  total+=member.size
  if member.size>10*1024*1024 or total>50*1024*1024:raise ValueError('source archive too large')
  target=root.joinpath(*p.parts).resolve()
  if not target.is_relative_to(root):raise ValueError('source escape')
  target.parent.mkdir(parents=True,exist_ok=True)
  with tar.extractfile(member) as inp,target.open('xb') as out:out.write(inp.read())
setups=list(root.glob('*/setup.py'))
if len(setups)!=1:raise ValueError('needs exactly one static setup.py')
setup=setups[0];tree=ast.parse(setup.read_text(encoding='utf-8-sig'))
calls=[n for n in ast.walk(tree) if isinstance(n,ast.Call) and ((isinstance(n.func,ast.Name) and n.func.id=='setup') or (isinstance(n.func,ast.Attribute) and n.func.attr=='setup'))]
if len(calls)!=1 or calls[0].args:raise ValueError('dynamic setup call')
metadata={}
needed={'name','version','packages','py_modules','package_dir','install_requires','extras_require','python_requires','ext_modules','cmdclass','setup_requires'}
for kw in calls[0].keywords:
 if kw.arg is None:raise ValueError('dynamic setup keywords')
 if kw.arg in needed:metadata[kw.arg]=ast.literal_eval(kw.value)
normalize=lambda x:re.sub(r'[-_.]+','-',x).lower()
if normalize(metadata.get('name',''))!=normalize(expected_name) or metadata.get('version')!=expected_version:raise ValueError('metadata differs from pinned release')
if any(metadata.get(k) for k in ('ext_modules','cmdclass','setup_requires')):raise ValueError('custom build not supported')
if metadata.get('package_dir'):raise ValueError('package_dir needs an explicit adapter')
packages=metadata.get('packages',[]);modules=metadata.get('py_modules',[])
if not isinstance(packages,list) or not isinstance(modules,list) or not packages and not modules:raise ValueError('no literal module list')
if any(not isinstance(n,str) or not re.fullmatch(r'[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*',n) for n in packages+modules):raise ValueError('invalid module path')
base=setup.parent;files={}
for package in packages:
 directory=base.joinpath(*package.split('.'))
 if not directory.is_dir():raise ValueError('missing package')
 for file in directory.rglob('*'):
  if file.is_file():files[file.relative_to(base).as_posix()]=file.read_bytes()
for module in modules:
 file=base.joinpath(*module.split('.')).with_suffix('.py')
 if file.is_file():files[file.relative_to(base).as_posix()]=file.read_bytes()
 elif not base.joinpath(*module.split('.')).is_dir():raise ValueError('missing module')
if any(pathlib.Path(name).suffix.lower() in ('.pyd','.dll','.so','.dylib','.exe','.c','.cpp','.pyx') for name in files):raise ValueError('non-pure Python project')
if not any(n.endswith('.py') for n in files):raise ValueError('missing Python modules')
name=re.sub(r'[-_.]+','_',expected_name);version=expected_version;dist=name+'-'+version+'.dist-info'
lines=['Metadata-Version: 2.1','Name: '+expected_name,'Version: '+version]
for requirement in metadata.get('install_requires',[]):
 if not isinstance(requirement,str) or '\n' in requirement or '\r' in requirement:raise ValueError('invalid requirement')
 lines.append('Requires-Dist: '+requirement)
if metadata.get('extras_require'):raise ValueError('extras_require needs an explicit adapter')
if metadata.get('python_requires'):lines.append('Requires-Python: '+metadata['python_requires'])
files[dist+'/METADATA']=('\n'.join(lines)+'\n').encode()
files[dist+'/WHEEL']=b'Wheel-Version: 1.0\nGenerator: dsh-static-repack\nRoot-Is-Purelib: true\nTag: py3-none-any\n'
record=io.StringIO();writer=csv.writer(record,lineterminator='\n')
for key,data in sorted(files.items()):writer.writerow([key,'sha256='+base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip('='),len(data)])
writer.writerow([dist+'/RECORD','','']);files[dist+'/RECORD']=record.getvalue().encode()
out=pathlib.Path(wheels)/(name+'-'+version+'-py3-none-any.whl')
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for key,data in sorted(files.items()):
  info=zipfile.ZipInfo(key,date_time=(2020,1,1,0,0,0));z.writestr(info,data)
print(json.dumps({'wheel':str(out),'sourceRoot':str(root),'method':'static-literal-setup-repack'}))
`;

export async function prepareStaticSourceWheel(name,{root,python,runner,fetchImpl=fetch}={}){
  if(typeof name!=='string'||!/^[a-z0-9][a-z0-9._-]*$/i.test(name))throw Error('無效的 Python 套件名稱');
  const response=await fetchImpl(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`無法取得 ${name} 的固定來源發行資訊`);
  const release=await response.json(),source=release.urls?.find(file=>file.packagetype==='sdist'&&file.filename?.endsWith('.tar.gz'));
  const version=release.info?.version,url=new URL(source?.url??'https://invalid.invalid'),hash=source?.digests?.sha256;
  if(!/^[A-Za-z0-9][A-Za-z0-9.+!-]*$/.test(version??'')||url.protocol!=='https:'||url.hostname!=='files.pythonhosted.org'||url.search||url.hash||!/^\w{64}$/.test(hash??'')||!/^[a-f0-9]+$/i.test(hash))throw Error(`${name} 缺少可固定的純 Python 來源包`);
  const download=await fetchImpl(url.href,{redirect:'error',signal:AbortSignal.timeout(60000)});if(!download.ok)throw Error('Python 來源包下載失敗');
  const chunks=[];let size=0;for await(const chunk of download.body){size+=chunk.length;if(size>10*1024*1024)throw Error('Python 來源包過大');chunks.push(chunk);}
  const bytes=Buffer.concat(chunks);if(crypto.createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('Python 來源包 SHA256 不符');
  const sources=path.join(root,'source-distributions'),wheels=path.join(root,'static-wheels');await fs.mkdir(sources,{recursive:true});await fs.mkdir(wheels,{recursive:true});
  const archive=path.join(sources,name+'-'+version+'.tar.gz'),sourceRoot=path.join(sources,name+'-'+version);await fs.writeFile(archive,bytes,{flag:'wx'});
  const result=await runner(python,['-I','-c',script,archive,sourceRoot,wheels,name,version],{cwd:root});
  if(result.code!==0)throw Error(`${name} 的建置資訊無法靜態確認；未執行來源 setup.py 或建置後端`);
  const output=JSON.parse(result.stdout.trim()),wheelBytes=await fs.readFile(output.wheel);
  return {name,version,source:url.href,sha256:hash,archive,sourceRoot,wheel:output.wheel,wheelSha256:crypto.createHash('sha256').update(wheelBytes).digest('hex'),method:output.method};
}
