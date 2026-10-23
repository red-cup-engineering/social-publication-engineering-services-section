import {publicationIntent,blueskyPostRecord} from "./index.mjs";
const channels=new Set(["bluesky","linkedin","facebook-page","fediverse"]);
const https=v=>{const u=new URL(v);if(u.protocol!=="https:"||u.username||u.password||u.hash)throw new TypeError("Canonical public HTTPS link required");return u.href;};
/** Prepare channel-specific editorial publication candidates. Never sends. */
export function compileCampaignIntents({campaignId,asOf,items}={}){
 if(typeof campaignId!=="string"||!/^[a-z0-9-]+$/.test(campaignId)||typeof asOf!=="string"||!Array.isArray(items)||!items.length||items.length>40)throw new TypeError("Bounded source-owned campaign required");
 const seen=new Set();
 return {type:"CampaignPublicationCandidates",version:1,campaignId,asOf,authority:"editorial-review-required",items:items.map(item=>{
  if(!item||!item.id||seen.has(item.id)||!channels.has(item.channel)||typeof item.proofUrl!=="string")throw new TypeError("Distinct channel/source-qualified item required");
  seen.add(item.id);
  const proof=https(item.proofUrl),canonical=https(item.canonicalUrl);
  if(!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(proof))throw new TypeError("Public GitHub proof required");
  const intent=publicationIntent({canonicalUrl:canonical,text:item.text,title:item.title,description:item.description,kind:item.kind||"article",languages:["en"]});
  const base={id:item.id,channel:item.channel,proofUrl:proof,intent,disposition:"not-published",requires:"original publisher editorial approval and authorized transport"};
  if(item.channel==="bluesky")return {...base,previewRecord:blueskyPostRecord({intent,createdAt:asOf,externalCard:{uri:canonical,title:item.title,description:item.description}})};
  return base;
 })};
}
