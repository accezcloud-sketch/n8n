const fs=require('fs'),path=require('path'),matter=require(process.argv[2]+'/node_modules/gray-matter');
const dir=process.argv[2]+'/content/blog';
function trim(s,max){ s=s.trim(); while(s.length>max){ const m=s.match(/^([\s\S]*[.!?؟])\s+[^.!?؟]+[.!?؟]?$/); if(!m) break; s=m[1].trim(); } return s; }
const res={en:[],ar:[]};
for(const f of fs.readdirSync(dir)){ const {data}=matter(fs.readFileSync(path.join(dir,f),'utf8')); if(!data.metaDescription) continue;
 res.en.push([data.metaDescription.length, trim(data.metaDescription,155).length]); res.ar.push([data.metaDescriptionAr.length, trim(data.metaDescriptionAr,155).length]); }
for(const k of ['en','ar']){ const a=res[k]; const ok=(lo,hi)=>a.filter(([o,t])=>t>=lo&&t<=hi).length;
 console.log(k, a.length, 'raw140-155', a.filter(([o])=>o>=140&&o<=155).length, 'trim140-155', ok(140,155), 'trim120-155', ok(120,155), 'trim110-160',ok(110,160), JSON.stringify(a.map(x=>x[1]).sort((x,y)=>x-y)));}
