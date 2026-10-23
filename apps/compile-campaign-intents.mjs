#!/usr/bin/env node
// Compile a corporate owner's editorial source into reviewable native intents.
// No account credentials, API calls, automated posting, or outbound messages.
import {readFile} from "node:fs/promises";
import {compileCampaignIntents} from "../src/campaign-intents.mjs";
const path=process.argv[2],format=process.argv[3]||"--json";
if(!path||!["--json","--markdown"].includes(format)){
 console.error("Usage: node apps/compile-campaign-intents.mjs source.json [--json|--markdown]");
 process.exitCode=2;
}else try{
 const pack=compileCampaignIntents(JSON.parse(await readFile(path,"utf8")));
 const output=format==="--json"?JSON.stringify(pack,null,2):[
  "# "+pack.campaignId+" editorial candidates","No message has been published.",
  ...pack.items.flatMap(x=>["","## "+x.id+" — "+x.channel,"Proof: "+x.proofUrl,"Canonical: "+x.intent.canonicalUrl,"",""+x.intent.text])
 ].join("\n");
 process.stdout.write(output+"\n");
}catch(error){console.error("Source or preview refused: "+error.message);process.exitCode=2;}
