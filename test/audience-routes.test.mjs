import test from "node:test";
import assert from "node:assert/strict";
import {qualifyPublicChannels,publicChannelBrief} from "../src/audience-routes.mjs";
const work=[{id:"proofs",publicUrl:"https://github.com/lenticule-science/hoare-program-carrier",topics:["formal-methods","open-science"]},{id:"commerce",publicUrl:"https://github.com/red-cup-engineering/digital-goods-storefront-services-section",topics:["open-commerce","software"]}];
const base={id:"support",name:"A public grant program",kind:"grant",status:"accepting",checkedOn:"2026-10-22",sourceUrl:"https://example.org/grants",entryUrl:"https://example.org/apply",topics:["formal-methods"],note:"A dated public call describes open methods.",nextAction:"Verify actual applicant/project criteria and draft submission."};
test("returns ranked source-backed reviewer work, never fabricated interests or payments",()=>{
 const rows=qualifyPublicChannels({work,routes:[{...base,id:"other",status:"conditional",topics:["software"]},base],asOf:"2026-10-22"}).rows;
 assert.deepEqual(rows.map(x=>x.id),["support","other"]);
 assert.deepEqual(rows[0].matchedWork.map(x=>x.id),["proofs"]);
 assert.equal(rows[0].state,"review-for-application");
 assert.equal(rows[1].state,"verify-eligibility");
 const markdown=publicChannelBrief({type:"PublicAudienceRouteReadout",asOf:"2026-10-22",rows});
 assert.match(markdown,/hoare-program-carrier/);
 assert.doesNotMatch(markdown,/paid|sent|accepted customer/);
});
test("closed, dated out and irrelevant routes do not become ready marketing",()=>{
 const routes=[{...base,id:"closed",status:"closed"},{...base,id:"expired",deadline:"2026-10-21"},{...base,id:"stale",checkedOn:"2026-05-01"},{...base,id:"unmatched",topics:["biomedical"]}];
 const out=qualifyPublicChannels({work,routes,asOf:"2026-10-22"});
 assert.deepEqual(Object.fromEntries(out.rows.map(x=>[x.id,x.state])),{stale:"recheck",unmatched:"unmatched",closed:"closed",expired:"closed"});
});
test("rejects malicious URLs, duplicate IDs, unverifiable proof and malformed status",()=>{
 const input={work,routes:[base],asOf:"2026-10-22"};
 for(const route of [{...base,sourceUrl:"http://example.org/"},{...base,entryUrl:"javascript:alert(1)"},{...base,status:"certain-winner"}])assert.throws(()=>qualifyPublicChannels({...input,routes:[route]}),TypeError);
 assert.throws(()=>qualifyPublicChannels({...input,routes:[base,base]}),TypeError);
 assert.throws(()=>qualifyPublicChannels({...input,work:[{...work[0],publicUrl:"https://example.org"}]}),TypeError);
 assert.throws(()=>qualifyPublicChannels({...input,asOf:"not-a-date"}),TypeError);
 assert.throws(()=>publicChannelBrief({}),TypeError);
});
