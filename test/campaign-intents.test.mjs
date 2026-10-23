import test from "node:test";
import assert from "node:assert/strict";
import {compileCampaignIntents} from "../src/campaign-intents.mjs";
const item={id:"science-bluesky",channel:"bluesky",proofUrl:"https://github.com/lenticule-science/hoare-program-carrier",canonicalUrl:"https://github.com/561-group/.github/blob/main/OPEN-WORK.md",title:"A proof without a pitch deck",description:"Inspectable scientific software from an independent research group.",text:"What if the proof was the pitch deck? Start with the real Lean source. You can read it without paying or owning a piece of the company."};
const source={campaignId:"open-work-curiosity",asOf:"2026-10-22T22:00:00.000Z",items:[item,{...item,id:"operators-linkedin",channel:"linkedin",text:"Inspect open-source software before deciding whether you want to support it."}]};
test("compiles source-backed native social intents without publishing",()=>{
 const pack=compileCampaignIntents(source);
 assert.equal(pack.authority,"editorial-review-required");
 assert.equal(pack.items.length,2);
 assert.equal(pack.items[0].previewRecord.$type,"app.bsky.feed.post");
 assert.equal(pack.items[0].previewRecord.embed.external.uri,item.canonicalUrl);
 assert.equal(pack.items[0].intent.type,"SocialPublicationIntent");
 assert.ok(pack.items[0].intent.id.startsWith("ni:///sha-256;"));
 assert.equal(pack.items[0].disposition,"not-published");
 assert.equal(pack.items[1].channel,"linkedin");
 assert.equal(pack.items[1].previewRecord,undefined);
 assert.deepEqual(pack,compileCampaignIntents(source));
});
test("rejects overlong Bluesky, fake proof, duplicate item, unsupported channel and unsafe canonical URL",()=>{
 const run=items=>compileCampaignIntents({...source,items});
 for(const wrong of [
  {...item,text:"a".repeat(301)},
  {...item,proofUrl:"https://example.org/unverified"},
  {...item,channel:"invented-social-network"},
  {...item,canonicalUrl:"javascript:alert(1)"}
 ])assert.throws(()=>run([wrong]));
 assert.throws(()=>run([item,item]),/Distinct/);
 assert.throws(()=>run([]),/Bounded/);
});
