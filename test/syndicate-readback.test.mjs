import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { niDigest } from '../src/index.mjs';
import { blueskyAdapter, blueskyIntentForRendition } from '../src/syndication/adapters.mjs';
import { niOfBytes, niOfJson, sha256Hex } from '../src/syndication/canonical.mjs';
import { admitBlueskyJournalPost, readBlueskyJournalPost } from '../src/syndication/post-readback.mjs';
import { readback } from '../apps/syndicate.mjs';

const did = 'did:plc:abcdefghijklmnopqrstuvwx';
const cid = 'bafyreibjifzpqj6o6wcq3hejh7y4z4z2vmiklkvykc57tw3pcbx3kxifpm';
const uri = 'at://' + did + '/app.bsky.feed.post/3md7exact';
const canonical = 'https://science.561.group/papers/source-bound-paper';
const when = '2026-10-28T17:50:00Z';
const account = {
  id:'561-group@bluesky', brand:'561-group', platform:'bluesky',
  handle:'561-group.bsky.social', did, timezone:'America/Chicago',
  state:'active', kind:'organization', credentialRef:{scheme:'none',name:'read-only'},
  automation:{botDisclosed:true}, sections:['*'],
  approval:{firstPostApprovedAt:'2026-10-27T00:00:00Z',approvedBy:'owner'},
};
const rendition = {
  id:niOfJson({original:'exact-paper-rendition'}), accountId:account.id,
  platform:'bluesky', brand:'561-group', section:'science', kind:'paper',
  text:'Read the reproducible research and supporting evidence.',
  link:canonical, title:'The source-bound paper', language:'en',
  sourceNi:niOfBytes(Buffer.from('original scientific edition')),
  media:[],
};
const json = posts => new Response(JSON.stringify({posts}), {
  headers:{'content-type':'application/json'},
});
const publicPost = () => ({
  uri, cid, author:{did},
  record:{$type:'app.bsky.feed.post',text:rendition.text,createdAt:when,
    embed:{$type:'app.bsky.embed.external',external:{
      uri:canonical,title:'The source-bound paper',description:'',
    }},
  },
});
const publicReader = async () => json([publicPost()]);
const readFile = path => readFileSync(path,'utf8');

async function acceptedPosting() {
  let network = 0;
  const posted = await blueskyAdapter().publish(rendition, {
    account,
    authorizedFetch:async (url, options) => {
      network += 1;
      assert.match(url,/com\.atproto\.repo\.createRecord$/u);
      assert.equal(options.method,'POST');
      assert.equal(options.headers.authorization,undefined);
      const submitted=JSON.parse(options.body);
      assert.equal(submitted.repo,did);
      assert.equal(submitted.record.text,rendition.text);
      assert.equal(submitted.record.embed.external.uri,canonical);
      return new Response(JSON.stringify({uri,cid}),{
        headers:{'content-type':'application/json'},
      });
    },
  });
  assert.equal(network,1);
  const journalEntry = {
    accountId:account.id, renditionId:rendition.id, platform:'bluesky',
    status:'posted', at:when, textHash:sha256Hex(rendition.text),
    sourceNi:rendition.sourceNi,
    releaseRef:niOfBytes(Buffer.from('independently accepted release')),
    externalId:posted.externalId, externalCid:posted.cid,
    intentNi:posted.intentNi, transportReceipt:posted.transportReceipt,
    url:posted.url,
  };
  return {posted, journalEntry};
}

test('adapter retains a real content-addressed provider receipt bound to URI and CID',async()=>{
  const {posted,journalEntry}=await acceptedPosting();
  const intent=blueskyIntentForRendition(rendition);
  assert.equal(posted.intentNi,intent.id);
  assert.equal(journalEntry.transportReceipt.intent,intent.id);
  assert.equal(posted.transportReceipt.responseDigest,niDigest({uri,cid}));
  assert.equal(posted.transportReceipt.observedAt.includes('T'),true);
  assert.match(posted.transportReceipt.id,/^ni:\/\/\/sha-256;/u);
  assert.equal(admitBlueskyJournalPost({account,rendition,journalEntry}).receipt.id,
    posted.transportReceipt.id);
});

test('original journal to independent public record observation is reproducible and read-only',async()=>{
  const {journalEntry}=await acceptedPosting();
  let reads=0;
  const result=await readBlueskyJournalPost({account,rendition,journalEntry},{
    observedAt:when,fetchImpl:async (url,options)=>{
      reads++;
      assert.match(url,/app\.bsky\.feed\.getPosts\?uris=/u);
      assert.equal(options.method,'GET');
      assert.equal(options.credentials,'omit');
      assert.equal(options.redirect,'manual');
      return publicReader();
    },
  });
  assert.equal(reads,1);
  assert.equal(result.standing,'public-record-match');
  assert.equal(result.verifiedCompletion,false);
  assert.equal(result.readOnly,true);
  assert.equal(result.expectedCid,cid);
  assert.equal(result.canonicalLinkCarriedBy,'external-card');
  assert.equal(Object.hasOwn(result,'clicks'),false);
});

test('changed source, account, text, CID, intent and receipt cannot be retrospectively trusted',async()=>{
  const {journalEntry}=await acceptedPosting();
  let reads=0;
  const mustReject=async change=>{
    await assert.rejects(readBlueskyJournalPost(change,{
      observedAt:when,fetchImpl:async()=>{reads++; return publicReader();},
    }),TypeError);
  };
  const input={account,rendition,journalEntry};
  await mustReject({...input,account:{...account,id:'other'}});
  await mustReject({...input,rendition:{...rendition,text:'Changed after publishing'}});
  await mustReject({...input,rendition:{...rendition,sourceNi:niOfBytes(Buffer.from('changed source'))}});
  await mustReject({...input,journalEntry:{...journalEntry,status:'dry-run'}});
  await mustReject({...input,journalEntry:{...journalEntry,externalCid:'bafyreiwrongchangeso2mvz7zttoo3us4wdw7425odpdfs'}}); 
  await mustReject({...input,journalEntry:{...journalEntry,intentNi:niOfBytes(Buffer.from('invented intent'))}});
  await mustReject({...input,journalEntry:{...journalEntry,transportReceipt:{
    ...journalEntry.transportReceipt, id:niOfBytes(Buffer.from('invented receipt')),
  }}});
  await mustReject({...input,journalEntry:{...journalEntry,transportReceipt:undefined}});
  await mustReject({...input,journalEntry:{...journalEntry,releaseRef:undefined}});
  assert.equal(reads,0,'refuse before contacting public AppView');
});

test('the existing syndicate readback command appends a separate immutable public observation',async()=>{
  const {journalEntry}=await acceptedPosting();
  const directory=mkdtempSync(join(tmpdir(),'561-social-readback-'));
  const queue=join(directory,'queue');
  mkdirSync(queue);
  const accounts=join(directory,'accounts.json');
  const journal=join(queue,'journal.jsonl');
  const renditions=join(queue,'renditions.jsonl');
  const original=JSON.stringify(journalEntry)+'\n';
  try{
    writeFileSync(accounts,JSON.stringify({type:'AccountRegistry',version:1,accounts:[account]}));
    writeFileSync(journal,original);
    writeFileSync(renditions,JSON.stringify(rendition)+'\n');
    const opts={queue,accounts,account:account.id,rendition:rendition.id,receipt:journalEntry.transportReceipt.id};
    const first=await readback(opts,{fetchImpl:publicReader,observedAt:when});
    assert.equal(first.standing,'public-record-match');
    assert.equal(first.observation.verifiedCompletion,false);
    const history=readFile(journal).split('\n').filter(Boolean).map(JSON.parse);
    assert.equal(history.length,2);
    assert.equal(JSON.stringify(history[0])+'\n',original,'original transport receipt remains untouched');
    assert.equal(history[1].status,'public-readback');
    assert.equal(history[1].observationNi,first.observationNi);
    assert.equal(history[1].transportReceiptNi,journalEntry.transportReceipt.id);
    assert.equal(history[1].observation.source,'https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris='+encodeURIComponent(uri));
    const again=await readback(opts,{fetchImpl:publicReader,observedAt:when});
    assert.equal(again.observationNi,first.observationNi);
    assert.equal(readFile(journal).split('\n').filter(Boolean).length,2,
      'same exact observation is idempotent');
    const changed=await readback(opts,{fetchImpl:async()=>json([]),observedAt:'2026-10-28T18:00:00Z'});
    assert.equal(changed.standing,'not-observed');
    assert.equal(readFile(journal).split('\n').filter(Boolean).length,3,
      'later missing record is preserved, not silently replacing earlier evidence');
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('the operator refuses ambiguous or legacy receipts without a public request or journal write',async()=>{
  const {journalEntry}=await acceptedPosting();
  const directory=mkdtempSync(join(tmpdir(),'561-social-refusal-'));
  const queue=join(directory,'queue');
  mkdirSync(queue);
  const accounts=join(directory,'accounts.json');
  const journal=join(queue,'journal.jsonl');
  try{
    writeFileSync(accounts,JSON.stringify({type:'AccountRegistry',version:1,accounts:[account]}));
    writeFileSync(join(queue,'renditions.jsonl'),JSON.stringify(rendition)+'\n');
    const opts={queue,accounts,account:account.id,rendition:rendition.id,receipt:journalEntry.transportReceipt.id};
    let reads=0;
    const fetchImpl=async()=>{reads++; return publicReader();};
    const old=JSON.stringify({...journalEntry,transportReceipt:undefined})+'\n';
    writeFileSync(journal,old);
    await assert.rejects(readback(opts,{fetchImpl,observedAt:when}),/original bound transport receipt/u);
    assert.equal(readFile(journal),old);
    const duplicate=JSON.stringify(journalEntry)+'\n'+JSON.stringify(journalEntry)+'\n';
    writeFileSync(journal,duplicate);
    await assert.rejects(readback(opts,{fetchImpl,observedAt:when}),/Exactly one original bound/u);
    assert.equal(readFile(journal),duplicate);
    assert.equal(reads,0);
  }finally{rmSync(directory,{recursive:true,force:true});}
});

test('post readback cannot convert a provider API or AppView outage into publication success',async()=>{
  const {journalEntry}=await acceptedPosting();
  const observed=await readBlueskyJournalPost({account,rendition,journalEntry},{
    observedAt:when,fetchImpl:async()=>new Response('rate limited',{status:429}),
  });
  assert.equal(observed.standing,'unavailable');
  assert.equal(observed.verifiedCompletion,false);
  assert.equal(Object.hasOwn(observed,'deleted'),false);
  assert.equal(Object.hasOwn(observed,'views'),false);
});
