#!/usr/bin/env node
// Pure consumer: accepts locally authored source-qualified public program data.
// No network, contact discovery, outreach, money movement, or mutation.
import {readFile} from "node:fs/promises";
import {qualifyPublicChannels,publicChannelBrief} from "../src/audience-routes.mjs";
const file=process.argv[2],format=process.argv[3]||"--markdown";
if(!file||!["--markdown","--json"].includes(format)){
 console.error("Usage: node apps/audience-brief.mjs campaign.json [--markdown|--json]");
 process.exitCode=2;
}else{
 try{
  const input=JSON.parse(await readFile(file,"utf8"));
  const output=qualifyPublicChannels(input);
  process.stdout.write(format==="--json"?JSON.stringify(output,null,2)+"\n":publicChannelBrief(output)+"\n");
 }catch(error){
  console.error("Cannot qualify these source records: "+error.message);
  process.exitCode=2;
 }
}
