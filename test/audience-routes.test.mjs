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

test("funding opportunities do not become a single buyer/application funnel",()=>{
 const choices=[
  {...base,id:"grant",kind:"grant"},
  {...base,id:"patron",kind:"patronage",name:"Open project patronage"},
  {...base,id:"community",kind:"community",name:"Public technical discussion"},
  {...base,id:"sponsor",kind:"sponsorship",name:"Corporate sponsorship"},
  {...base,id:"host",kind:"fiscal-hosting",name:"Fiscal service"}
 ];
 const r=qualifyPublicChannels({work,routes:choices,asOf:"2026-10-23"});
 assert.deepEqual(Object.fromEntries(r.rows.map(x=>[x.id,x.state])),{
   community:"participate-if-allowed",grant:"review-for-application",host:"verify-hosting-fit",patron:"prepare-public-work-invitation",sponsor:"qualify-sponsorship-terms"
 });
 for(const row of r.rows){
  assert.equal(row.qualifiedInterest,"not-observed");
  assert.equal(row.externalReceiving,"not-observed");
 }
 assert.match(publicChannelBrief(r),/Outside interest: not-observed/u);
});
test("topic overlap cannot outrank actual mechanism rights or source freshness",()=>{
 const broad={...base,id:"broad",kind:"patronage",topics:["formal-methods","open-science","open-commerce","software"]};
 const precise={...base,id:"precise",kind:"community",topics:["formal-methods"]};
 const closed={...base,id:"closed",kind:"patronage",topics:broad.topics,status:"closed"};
 const stale={...base,id:"stale",kind:"patronage",topics:broad.topics,checkedOn:"2026-01-01"};
 const readout=qualifyPublicChannels({work,routes:[broad,precise,closed,stale],asOf:"2026-10-23"});
 assert.deepEqual(readout.rows.map(r=>r.id),["broad","precise","stale","closed"]);
 assert.deepEqual(readout.rows.map(r=>r.state),["prepare-public-work-invitation","participate-if-allowed","recheck","closed"]);
 assert.throws(()=>qualifyPublicChannels({work,routes:[{...base,checkedOn:"2026-02-31"}],asOf:"2026-10-23"}),/ISO date/);
});
