const fs=require('fs'),path=require('path'),matter=require(process.argv[2]+'/node_modules/gray-matter');
const dir=process.argv[2]+'/content/blog';
const rows=[];
for(const f of fs.readdirSync(dir)){ if(!f.endsWith('.md'))continue;
 const {data,content}=matter(fs.readFileSync(path.join(dir,f),'utf8'));
 if(!data.metaTitle) continue;
 const [en,ar]=content.split('<!-- AR -->');
 rows.push({f:f.slice(0,30),date:data.date,mt:(data.metaTitle||'').length,mtAr:(data.metaTitleAr||'').length,md:(data.metaDescription||'').length,mdAr:(data.metaDescriptionAr||'').length,
 em:(content.match(/[—–]/g)||[]).length, sp:(content.match(/\S[ \t]+-[ \t]+\S/g)||[]).length, fmdash:/[—–]| - /.test(JSON.stringify(data)),
 study:/\b(a (recent )?study|research shows|studies show)\b/i.test(content), arFaq:/^## الأسئلة الشائعة/m.test(ar||''), arKt:/^## أبرز النقاط/m.test(ar||''), pct:(content.match(/\d+(\.\d+)?\s?%/g)||[]).length, links:(content.match(/\]\(/g)||[]).length});
}
rows.sort((a,b)=>a.date<b.date?1:-1);
console.table(rows.slice(0,25));
const n=rows.length;const c=(fn)=>rows.filter(fn).length;
console.log({n, mtOK:c(r=>r.mt<=60), mdOK:c(r=>r.md>=140&&r.md<=155), mdArOK:c(r=>r.mdAr>=140&&r.mdAr<=155), mtArOK:c(r=>r.mtAr<=60), noDash:c(r=>r.em==0&&r.sp==0), arHeads:c(r=>r.arFaq&&r.arKt)});
