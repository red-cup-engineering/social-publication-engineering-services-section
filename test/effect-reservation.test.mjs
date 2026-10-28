import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, closeSync, openSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { niOfBytes, niOfJson } from '../src/syndication/canonical.mjs';
import {
  admitSocialEffectReservation, hasSocialEffectAttempt, prepareSocialEffect, unresolvedSocialEffects,
} from '../src/syndication/effect-attempt.mjs';
import { reserveSocialEffectInJournal } from '../src/syndication/journal-reservation.mjs';
import { runDue } from '../src/syndication/publish.mjs';
import { admitAccountRegistry } from '../src/syndication/accounts.mjs';
import { admitPlatformRuleSet } from '../src/syndication/platform-rules.mjs';
import { admitContentItem, renditionsFor } from '../src/syndication/rendition.mjs';
import { planSchedule } from '../src/syndication/schedule.mjs';
import { readFileSync as load } from 'node:fs';

const nowMs = Date.parse('2026-10-27T15:30:00Z');
const acct = id => ({
  id, brand:'561-group', platform:'bluesky', handle:'561-group.bsky.social',
  did:'did:plc:abcdefghijklmnopqrstuvwx', timezone:'America/Chicago',
  state:'active', kind:'organization', sections:['*'],
  credentialRef:{scheme:'env',name:'TEST_ONLY_AUTHORIZED_FETCH'},
  automation:{botDisclosed:true},
  approval:{firstPostApprovedAt:'2026-10-26T00:00:00Z',approvedBy:'original-owner'},
});
const ruleSet=admitPlatformRuleSet(JSON.parse(load(new URL('../content/platform-rules.seed.json',import.meta.url),'utf8')));
const sourceNi=niOfBytes(Buffer.from('exact received research edition'));
const releaseRef=niOfBytes(Buffer.from('original publisher independently accepted release'));
const content=admitContentItem({
  id:niOfJson({original:'source-work'}), brand:'561-group',section:'science',
  kind:'paper', title:'Reproducible paper',summary:'Read the source and its evidence.',
  canonicalUrl:'https://science.561.group/papers/received/', source:{ni:sourceNi},
});
const source=(request)=>({
  type:'SocialSourceReadback',version:1,canonicalUrl:request.canonicalUrl,
  itemNi:request.itemNi,sourceNi:request.sourceNi,
  publicationStatus:'stable',publiclyReadable:true,releaseRef,
  observedAt:new Date(request.nowMs).toISOString(),claims:[],
});
function fixture(id='one@bluesky'){
  const registry=admitAccountRegistry({type:'AccountRegistry',version:1,accounts:[acct(id)]});
  const [rendition]=renditionsFor(content,{accounts:registry.accounts,ruleSet});
  const schedule=planSchedule({renditions:[rendition],registry,ruleSet,
    startMs:Date.parse('2026-10-26T00:00:00Z'),days:2});
  const entry=schedule.entries.find(row=>row.status==='scheduled');
  assert.ok(entry,'source-owned test fixture must have a scheduled post');
  const sourceWitness={allowed:true,sourceNi,releaseRef};
  const attempt=prepareSocialEffect({entry,account:registry.accounts[0],rendition,sourceWitness});
  return {registry,rendition,entry,attempt};
}
const rows=path=>readFileSync(path,'utf8').split('\n').filter(Boolean).map(JSON.parse);
const inTemp=async testFn=>{
  const root=mkdtempSync(join(tmpdir(),'561-preeffect-'));
  try{return await testFn(join(root,'original-journal.jsonl'));}
  finally{rmSync(root,{recursive:true,force:true});}
};

test('pre-effect NI binds exact account, slot, rendition, bytes and source-received release',()=>{
  const f=fixture();
  const again=fixture();
  assert.deepEqual(f.attempt,again.attempt);
  assert.match(f.attempt.id,/^ni:\/\/\/sha-256;/u);
  assert.notEqual(f.attempt.id,prepareSocialEffect({
    entry:{...f.entry,at:'2026-10-27T16:30:00Z'},
    account:f.registry.accounts[0],rendition:f.rendition,
    sourceWitness:{allowed:true,sourceNi,releaseRef},
  }).id);
  assert.throws(()=>prepareSocialEffect({
    entry:f.entry,account:{...f.registry.accounts[0],id:'other'},
    rendition:f.rendition,sourceWitness:{allowed:true,sourceNi,releaseRef},
  }),/Exact scheduled effect/u);
  assert.throws(()=>prepareSocialEffect({
    entry:f.entry,account:f.registry.accounts[0],rendition:f.rendition,
    sourceWitness:{allowed:false,sourceNi,releaseRef},
  }),/Exact scheduled effect/u);
  assert.throws(()=>admitSocialEffectReservation({reserved:true,effectId:niOfBytes(Buffer.from('wrong'))},f.attempt),/matching durable/u);
});

test('original journal reserve is durable, exact, unique and has no second ledger',async()=>inTemp(async journal=>{
  const {attempt}=fixture();
  const reserve=reserveSocialEffectInJournal(journal);
  const acknowledged=await reserve(attempt);
  assert.deepEqual(acknowledged,{reserved:true,effectId:attempt.id});
  const [event]=rows(journal);
  assert.equal(event.status,'effect-reserved');
  assert.equal(event.effectId,attempt.id);
  assert.equal(event.sourceNi,sourceNi);
  assert.equal(event.releaseRef,releaseRef);
  assert.equal(event.textHash,attempt.textHash);
  assert.ok(hasSocialEffectAttempt(rows(journal),attempt));
  assert.equal(unresolvedSocialEffects(rows(journal),attempt).length,1);
  const unchanged=readFileSync(journal,'utf8');
  await assert.rejects(reserve(attempt),/already reserved/u);
  assert.equal(readFileSync(journal,'utf8'),unchanged);
  assert.equal(rows(journal).length,1);
}));

test('unresolved earlier attempt blocks new schedule; accepted receipt allows distinct later slot',async()=>inTemp(async journal=>{
  const {attempt}=fixture();
  const reserve=reserveSocialEffectInJournal(journal);
  await reserve(attempt);
  const next={...attempt,scheduledAt:'2026-10-28T16:30:00Z'};
  delete next.id;
  next.id=niOfJson(next);
  await assert.rejects(reserve(next),/unresolved remote outcome/u);
  writeFileSync(journal,JSON.stringify({status:'posted',effectId:attempt.id,
    renditionId:attempt.renditionId,accountId:attempt.accountId,at:'2026-10-27T15:30:00Z'})+'\n',{flag:'a'});
  assert.equal(unresolvedSocialEffects(rows(journal),attempt).length,0);
  assert.deepEqual(await reserve(next),{reserved:true,effectId:next.id});
  assert.equal(rows(journal).length,3);
}));

test('legacy retry, malformed JSONL, exact duplicate and tampered content all fail closed',async()=>inTemp(async journal=>{
  const {attempt}=fixture();
  const reserve=reserveSocialEffectInJournal(journal);
  const altered={...attempt,textHash:'a'.repeat(64)};
  await assert.rejects(reserve(altered),/does not match its address/u);
  assert.equal(rowsSafe(journal),null,'no file was made for invalid effect');
  const older=JSON.stringify({status:'retry',accountId:attempt.accountId,
    renditionId:attempt.renditionId,at:'2026-10-26T15:00:00Z'})+'\n';
  writeFileSync(journal,older);
  await assert.rejects(reserve(attempt),/unresolved remote outcome/u);
  assert.equal(readFileSync(journal,'utf8'),older);
  writeFileSync(journal,'{"broken":\n');
  await assert.rejects(reserve(attempt),/malformed line/u);
  assert.equal(readFileSync(journal,'utf8'),'{"broken":\n');
}));
function rowsSafe(path){try{return rows(path);}catch{return null;}}

test('a crashed writer lock blocks subsequent attempts rather than guessing that a write failed',async()=>inTemp(async journal=>{
  const {attempt}=fixture();
  const lock=journal+'.preeffect.lock';
  closeSync(openSync(lock,'wx',0o600));
  await assert.rejects(reserveSocialEffectInJournal(journal)(attempt),/EEXIST/u);
  assert.equal(rowsSafe(journal),null);
}));

test('runDue holds missing durable reservation BEFORE reading credentials or publishing',async()=>{
  const {registry,rendition,entry}=fixture();
  let credentials=0,effects=0,sourceReads=0;
  const result=await runDue({
    entries:[entry],renditions:new Map([[rendition.id,rendition]]),registry,ruleSet,
    adapters:{bluesky:{platform:'bluesky',live:true,validate:()=>({ok:true,problems:[]}),
      publish:async()=>{effects++;return {externalId:'should-not-exist'};}}},
    resolvers:{env:()=>{credentials++;return async()=>{};}},
    readCurrentSource:request=>{sourceReads++;return source(request);},
    nowMs,live:true,
  });
  assert.deepEqual(result.results.map(x=>x.status),['held']);
  assert.match(result.results[0].reason,/durable-pre-effect/u);
  assert.equal(credentials,0);
  assert.equal(sourceReads,0);
  assert.equal(effects,0);
});

test('API ambiguity after one effect cannot duplicate on subsequent run after simulated crash',async()=>inTemp(async journal=>{
  const {registry,rendition,entry}=fixture();
  let publishes=0,credentials=0;
  const adapters={bluesky:{platform:'bluesky',live:true,
    validate:()=>({ok:true,problems:[]}),
    publish:async()=>{publishes++;throw Object.assign(new Error('connection dropped after remote write'),
      {status:503});},
  }};
  const args={entries:[entry],renditions:new Map([[rendition.id,rendition]]),
    registry,ruleSet,adapters,nowMs,live:true,
    resolvers:{env:()=>{credentials++;return async()=>{};}},
    readCurrentSource:source,reserveEffect:reserveSocialEffectInJournal(journal)};
  const first=await runDue({...args,journal:[]});
  assert.equal(first.results[0].status,'outcome-unknown');
  assert.equal(first.results[0].providerStatusClass,'5xx');
  assert.equal(publishes,1);
  assert.equal(rows(journal)[0].status,'effect-reserved');
  // Simulate process death before returning its "outcome-unknown" event:
  // the only surviving evidence is the fsynced pre-effect journal entry.
  const second=await runDue({...args,journal:rows(journal)});
  assert.equal(second.results[0].status,'held');
  assert.equal(publishes,1);
  assert.equal(credentials,1,'no secret lookup for already attempted effect');
  assert.equal(rows(journal).length,1,'refusal never forges a second reservation');
}));

test('parallel accounts remain independent; one unknown receipt does not freeze another',async()=>inTemp(async journal=>{
  const first=fixture('a@bluesky'),second=fixture('b@bluesky');
  const registry=admitAccountRegistry({type:'AccountRegistry',version:1,
    accounts:[...first.registry.accounts,...second.registry.accounts]});
  const renditions=new Map([first.rendition,second.rendition].map(x=>[x.id,x]));
  const entries=[first.entry,second.entry];
  let good=0,bad=0;
  const result=await runDue({entries,renditions,registry,ruleSet,nowMs,live:true,
    readCurrentSource:source,reserveEffect:reserveSocialEffectInJournal(journal),
    resolvers:{env:()=>async()=>{}},
    adapters:{bluesky:{platform:'bluesky',live:true,validate:()=>({ok:true,problems:[]}),
      publish:async (rendition)=>{
        if(rendition.accountId==='a@bluesky'){
          bad++;throw Object.assign(new Error('network gone'),{status:0});
        }
        good++;return {externalId:'at://valid/record'};
      },
    }},
  });
  assert.deepEqual(result.results.map(x=>[x.accountId,x.status]).sort((a,b)=>a[0].localeCompare(b[0])),
    [['a@bluesky','outcome-unknown'],['b@bluesky','posted']]);
  assert.equal(bad,1);
  assert.equal(good,1);
  assert.equal(rows(journal).length,2);
  assert.equal(new Set(rows(journal).map(x=>x.effectId)).size,2);
});
