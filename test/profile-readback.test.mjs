import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  BLUESKY_PUBLIC_PROFILE_ENDPOINT, PROFILE_READBACK_MAX_BYTES,
  profileCopyNi, admitBlueskyProfileDecision, readBlueskyProfileDecision,
} from '../src/syndication/profile-readback.mjs';

const actor='561.group';
const did='did:plc:wpmzbzu62jkeapaptmv7lr5i';
const desired='Four organizations building institutions: research, engineering, operations and public services. We publish what is done and what is only planned. Operated by Morgan Sennhauser. Posts are drafted by AI agents.';
const desiredNi='ni:///sha-256;hn4Z9c7UoLqoZQeNy9ExHLd5OYFmFPajQn1fAXr3Q-g';
const old='Old unreceived public description';
const endpoint=BLUESKY_PUBLIC_PROFILE_ENDPOINT+'?actor=561.group';
function decision(){return {id:'2026-10-25-bluesky-561-group-profile-text',kind:'public-copy',brand:'561-group',
  platform:'bluesky',field:'description (profile bio)', account:'@561.group ('+did+')',
  observed:{source:endpoint, text:old,textNi:profileCopyNi(old)},
  options:[{id:'keep-current',candidate:{type:'CopyCandidate',brand:'561-group',platform:'bluesky',field:'description',text:old},gate:{pass:false}},
    {id:'chosen',candidate:{type:'CopyCandidate',brand:'561-group',platform:'bluesky',field:'description',text:desired},gate:{pass:true,report:{textNi:desiredNi}}}],
  chosen:{id:'chosen',textNi:desiredNi}}}
const profile=(description=desired,over={})=>({did,handle:actor,description,indexedAt:'2026-10-27T18:00:00Z',...over});
const at='2026-10-27T18:10:00Z';
const serve=(data=profile(),calls=[])=>async(url,opts)=>{calls.push({url,opts});return Response.json(data)};

// Native tests need no network, secrets, paid provider or external app.
test('exact original Group bio bytes match the content address',()=>{
  assert.equal(profileCopyNi(desired),desiredNi);
  assert.equal(profileCopyNi(desired), 'ni:///sha-256;'+createHash('sha256').update(desired,'utf8').digest('base64url'));
  const input=decision(), before=structuredClone(input);
  const e=admitBlueskyProfileDecision(input);
  assert.equal(e.expectedNi,desiredNi);
  assert.equal(e.did,did);
  assert.equal(e.actor,actor);
  assert.equal(e.originalSource,endpoint);
  assert.deepEqual(input,before);
  assert.equal(Object.isFrozen(e),true);
});

test('one bounded unauthenticated original profile read compares literal text with pinned DID',async()=>{
  const calls=[];
  const result=await readBlueskyProfileDecision(decision(),{fetchImpl:serve(profile(),calls),observedAt:at});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,endpoint);
  assert.equal(calls[0].opts.method,'GET');
  assert.equal(calls[0].opts.credentials,'omit');
  assert.equal(calls[0].opts.redirect,'manual');
  assert.equal(calls[0].opts.headers.accept,'application/json');
  assert.ok(calls[0].opts.signal instanceof AbortSignal);
  assert.equal(calls[0].opts.headers.authorization,undefined);
  assert.equal(result.standing,'text-match');
  assert.equal(result.expectedNi,result.observedNi);
  assert.equal(result.publicDescription,desired);
  assert.equal(result.readOnly,true);
  assert.equal(result.verifiedCompletion,false);
  assert.equal(Object.isFrozen(result),true);
});

test('old original text still visible is not incorrectly marked updated',async()=>{
  const out=await readBlueskyProfileDecision(decision(),{fetchImpl:serve(profile(old)),observedAt:at});
  assert.equal(out.standing,'previous-text-visible');
  assert.equal(out.observedNi,out.previousNi);
  assert.notEqual(out.expectedNi,out.observedNi);
  assert.equal(out.verifiedCompletion,false);
});

test('different public text is neither prior nor chosen',async()=>{
  const out=await readBlueskyProfileDecision(decision(),{fetchImpl:serve(profile('Something else now')),observedAt:at});
  assert.equal(out.standing,'text-mismatch');
  assert.equal(out.observedNi,profileCopyNi('Something else now'));
});

test('DID drift and handle mismatch refuse attribution even for matching text',async()=>{
  for(const variant of [{did:'did:plc:invalid'}, {handle:'another.bsky.social'}]){
    const out=await readBlueskyProfileDecision(decision(),{fetchImpl:serve(profile(desired,variant)),observedAt:at});
    assert.equal(out.standing,'identity-conflict');
    assert.equal(Object.hasOwn(out,'publicDescription'),false);
    assert.equal(out.verifiedCompletion,false);
  }
});

test('absent description is observed as empty public bio rather than payment or success',async()=>{
  const out=await readBlueskyProfileDecision(decision(),{fetchImpl:serve({did,handle:actor}),observedAt:at});
  assert.equal(out.standing,'text-mismatch');
  assert.equal(out.observedNi,profileCopyNi(''));
  assert.equal(out.publicDescription,'');
});

test('forged chosen gate or candidate refuses before contacting provider',async()=>{
  const edits=[d=>{d.chosen.textNi=profileCopyNi('not desired')},
    d=>{d.options[1].gate.pass=false},d=>{d.options[1].gate.report.textNi='ni:///sha-256;'+'z'.repeat(43)},
    d=>{d.options[1].candidate.text+=' '},d=>{d.options[1].candidate.field='post'},
    d=>{d.options[1].candidate.brand='foreign'},d=>{d.options.push(structuredClone(d.options[1]))},
    d=>{d.options[1].id='different'},d=>{d.options=[]}];
  for(const change of edits){const d=decision();change(d);let calls=0;
    await assert.rejects(readBlueskyProfileDecision(d,{fetchImpl:async()=>{calls++;throw Error('never')},observedAt:at}),TypeError);
    assert.equal(calls,0);
  }
});

test('foreign account, prior observation and source address refuse before the public read',async()=>{
  const edits=[d=>{d.account='@other.example ('+did+')'},
    d=>{d.account='@561.group (did:plc:bad)'},d=>{d.observed.source='https://evil.example/xrpc'},
    d=>{d.observed.textNi=desiredNi},d=>{d.id='../../wrong'},
    d=>{d.platform='x'},d=>{d.field='secret'},d=>{d.chosen.id='missing'}];
  for(const edit of edits){const d=decision();edit(d);let calls=0;
    await assert.rejects(readBlueskyProfileDecision(d,{fetchImpl:async()=>{calls++;throw Error('never')},observedAt:at}),TypeError);
    assert.equal(calls,0);
  }
});

test('HTTP errors, redirects, non-JSON and failure details are unavailable, never healthy empty',async()=>{
  const cases=[
    async()=>new Response('<html></html>',{status:200,headers:{'content-type':'text/html'}}),
    async()=>new Response(null,{status:302,headers:{location:'https://other.example'}}),
    async()=>new Response(null,{status:429}),
    async()=>new Response(null,{status:503}),
    async()=>{throw Error('PRIVATE-PROVIDER-ERROR-TOKEN')},
  ];
  for(const fetchImpl of cases){const out=await readBlueskyProfileDecision(decision(),{fetchImpl,observedAt:at});
    assert.equal(out.standing,'unavailable');
    assert.equal(out.reason,'public-source-unavailable');
    assert.equal(JSON.stringify(out).includes('PRIVATE-PROVIDER-ERROR-TOKEN'),false);
    assert.equal(Object.hasOwn(out,'observedNi'),false);
  }
});

test('bad JSON, malformed UTF8, identity-less reading and oversized text refuse',async()=>{
  const cases=[
    async()=>new Response('{',{headers:{'content-type':'application/json'}}),
    async()=>new Response(new Uint8Array([0xc3,0x28]),{headers:{'content-type':'application/json'}}),
    serve({did}),
    serve(profile('x'.repeat(4097))),
  ];
  for(const fetchImpl of cases){const out=await readBlueskyProfileDecision(decision(),{fetchImpl,observedAt:at});
    assert.equal(out.standing,'unavailable');
    assert.equal(Object.hasOwn(out,'publicDescription'),false);
  }
});

test('oversized stream is cancelled before unbounded buffering',async()=>{
  let cancelled=false;
  const fetchImpl=async()=>new Response(new ReadableStream({
    start(controller){controller.enqueue(new Uint8Array(PROFILE_READBACK_MAX_BYTES+1));},
    cancel(){cancelled=true;}
  }),{headers:{'content-type':'application/json'}});
  const out=await readBlueskyProfileDecision(decision(),{fetchImpl,observedAt:at});
  assert.equal(out.standing,'unavailable');
  assert.equal(cancelled,true);
});

test('oversized advertised content length cancels an untouched stream',async()=>{
  let cancelled=false;
  const fetchImpl=async()=>new Response(new ReadableStream({cancel(){cancelled=true}}),
    {headers:{'content-type':'application/json','content-length':String(PROFILE_READBACK_MAX_BYTES+1)}});
  const out=await readBlueskyProfileDecision(decision(),{fetchImpl,observedAt:at});
  assert.equal(out.standing,'unavailable');
  assert.equal(cancelled,true);
});

test('invalid observation clock and absent public reader reject before network',async()=>{
  await assert.rejects(readBlueskyProfileDecision(decision(),{fetchImpl:null,observedAt:at}),TypeError);
  await assert.rejects(readBlueskyProfileDecision(decision(),{fetchImpl:serve(),observedAt:'yesterday'}),TypeError);
});

test('readout never asserts payment, authorization, Work discharge or effect acceptance',async()=>{
  const out=await readBlueskyProfileDecision(decision(),{fetchImpl:serve(),observedAt:at});
  for(const key of ['receipt','discharge','approvedBy','paymentAuthorized','workAccepted','credential'])
    assert.equal(Object.hasOwn(out,key),false);
  assert.equal(out.receivingBoundary.includes('separate'),true);
});

test('public observation projects no provider-private metadata, followers or avatar',async()=>{
  const out=await readBlueskyProfileDecision(decision(),{fetchImpl:serve({...profile(),followersCount:3,avatar:'https://images.bsky.app/avatar',privateToken:'no-leak'}),observedAt:at});
  assert.equal(out.standing,'text-match');
  assert.equal(JSON.stringify(out).includes('no-leak'),false);
  assert.equal(JSON.stringify(out).includes('avatar'),false);
});


test('unbounded or malformed provider indexedAt never becomes a trustworthy timestamp',async()=>{
  for(const indexedAt of ['2026-10-27T18:00:00Z<script>unsafe</script>',
    '2026-99-01T18:00:00Z','2026-10-27T18:00:00Z'.repeat(20)]){
    const out=await readBlueskyProfileDecision(decision(),{
      fetchImpl:serve(profile(desired,{indexedAt})),observedAt:at,
    });
    assert.equal(out.standing,'text-match');
    assert.equal(Object.hasOwn(out,'profileIndexedAt'),false);
    assert.equal(JSON.stringify(out).includes('<script>'),false);
  }
});
