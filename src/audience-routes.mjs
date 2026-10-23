// Bounded, source-backed public program discovery for editorial review only.
const kinds=new Set(["grant","sponsorship","community","fiscal-hosting"]);
const states=new Set(["accepting","conditional","closed","unknown"]);
const https=v=>{const u=new URL(v);if(u.protocol!=="https:"||u.username||u.password||u.hash)throw new TypeError("Public HTTPS source required");return u.href;};
const day=v=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||Number.isNaN(Date.parse(v+"T00:00:00Z")))throw new TypeError("ISO date required");return Date.parse(v+"T00:00:00Z");};
export function qualifyPublicChannels({work,routes,asOf,maxAgeDays=60}={}){
 const now=day(asOf);
 if(!Array.isArray(work)||!work.length||!Array.isArray(routes)||routes.length>100||!Number.isInteger(maxAgeDays)||maxAgeDays<1||maxAgeDays>365)throw new TypeError("Bounded work/routes required");
 const ids=new Set(),pids=new Set();
 for(const w of work){
  if(!w.id||ids.has(w.id)||!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(w.publicUrl)||!Array.isArray(w.topics))throw new TypeError("Published work must be distinct and publicly readable");
  ids.add(w.id);
 }
 const out=routes.map(r=>{
  if(!r.id||pids.has(r.id)||!kinds.has(r.kind)||!states.has(r.status)||!Array.isArray(r.topics)||!r.topics.length||!r.note||!r.nextAction)throw new TypeError("Source-qualified route required");
  pids.add(r.id);const sourceUrl=https(r.sourceUrl),entryUrl=https(r.entryUrl);
  const old=Math.floor((now-day(r.checkedOn))/86400000);
  const expired=r.deadline!==undefined&&now>day(r.deadline);
  const matches=work.map(w=>({id:w.id,url:w.publicUrl,topics:w.topics.filter(t=>r.topics.includes(t))})).filter(w=>w.topics.length).sort((a,b)=>b.topics.length-a.topics.length||a.id.localeCompare(b.id));
  const state=expired||r.status==="closed"?"closed":old<0||old>maxAgeDays?"recheck":!matches.length?"unmatched":r.status==="accepting"?"review-for-application":r.status==="conditional"?"verify-eligibility":"investigate";
  return Object.freeze({id:r.id,name:r.name,kind:r.kind,state,checkedOn:r.checkedOn,sourceUrl,entryUrl,note:r.note,nextAction:r.nextAction,matchedWork:matches});
 });
 const rank={"review-for-application":0,"verify-eligibility":1,investigate:2,recheck:3,unmatched:4,closed:5};
 out.sort((a,b)=>rank[a.state]-rank[b.state]||b.matchedWork.length-a.matchedWork.length||a.id.localeCompare(b.id));
 return Object.freeze({type:"PublicAudienceRouteReadout",version:1,asOf,rows:out});
}
export function publicChannelBrief(readout){
 if(readout?.type!=="PublicAudienceRouteReadout")throw new TypeError("Qualified readout required");
 return ["# Source-backed audience opportunities","As of "+readout.asOf+"; neither contact nor support is implied.",...readout.rows.flatMap(r=>["","## "+r.name+" ("+r.state+")","Source: "+r.sourceUrl,"Apply or learn: "+r.entryUrl,"Evidence: "+r.note,"Published works: "+(r.matchedWork.map(w=>w.url).join(", ")||"none"),"Next: "+r.nextAction])].join("\n");
}
