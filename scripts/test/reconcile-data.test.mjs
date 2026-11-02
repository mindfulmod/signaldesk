import {test} from "node:test";
import assert from "node:assert/strict";
import {threeWay,reconcileHistory,reconcileLedger,reconcileMonitor,reconcileResearch,reconcileCoMentions,reconcileCalibration,reconcilePhrases} from "../lib/reconcile-data.mjs";
test('three-way reconciliation preserves independent changes and audits competing scalars without addition',()=>{
  const audit=[];assert.deepEqual(threeWay({x:1,y:2,z:3},{x:4,y:2,z:5},{x:1,y:6,z:7},audit),{x:4,y:6,z:5});
  assert.equal(audit.length,1);assert.equal(audit[0].path,'/z');
});
test('daily history unions dates, choosing the newer same-day collection without relabeling old observations',()=>{
  const old={date:'2026-10-01',generatedAt:'2026-10-01T01:00:00Z',signals:[{name:'old'}]};
  const updated={...old,generatedAt:'2026-10-01T02:00:00Z',signals:[{name:'new'}]};
  const result=reconcileHistory({snapshots:[old]},{snapshots:[updated,{date:'2026-10-02'}]});
  assert.deepEqual(result.snapshots,[updated,{date:'2026-10-02'}]);assert.equal(old.signals[0].name,'old');
});
test('ledger unions incoming-only dates and respects changes relative to base',()=>{
  const ledger=rows=>({tickers:{CD:{meta:{name:'same'},rows}}});
  const a=['2026-10-01',2,null,null],b=['2026-10-02',3,null,10],repair=['2026-10-01',null,null,null];
  const result=reconcileLedger(ledger([a]),ledger([repair]),ledger([a,b]));
  assert.deepEqual(result.tickers.CD.rows,[repair,b]);
  const conflict=reconcileLedger(ledger([a]),ledger([repair]),ledger([['2026-10-01',9,1,99]]));
  assert.deepEqual(conflict.tickers.CD.rows,[repair]);
  const x=ledger([a]),y=ledger([b]);x.tickers.CD.meta.issuerIdentity={cik:'1'};y.tickers.CD.meta.issuerIdentity={cik:'2'};
  assert.throws(()=>reconcileLedger(ledger([]),x,y),/issuer boundary/);
});
test('source reconciliation preserves latest failures and branch-only source receipts',()=>{
  const old={id:'a',lastAttemptAt:'2026-10-01',lastSuccessAt:'2026-10-01',status:'ok'};
  const failure={...old,lastAttemptAt:'2026-11-01',status:'error'};
  const result=reconcileMonitor({sources:{a:old,branch:{status:'ok'}},events:[{id:'one'}]},{sources:{a:failure},events:[{id:'two'}]});
  assert.deepEqual(result.sources.a,failure);assert.ok(result.sources.branch);assert.equal(result.events.length,2);
  assert.equal(result.sources.a.lastSuccessAt,'2026-10-01');
});
test('research retains all versions and incompatible history never becomes a comparable day',()=>{
  const a={generatedAt:'2026-10-01',documents:[{id:'a',detectedAt:'2026-09-01'}],reviews:[],documentIndex:{url:{firstSeenAt:'2026-09-01',latestId:'a',versions:{a:'2026-09-01'}}},discovery:{coverageKey:'new',history:[{date:'2026-10-01',sourceChecks:[]}],archive:[{id:'one'}]}};
  const b={generatedAt:'2026-11-01',documents:[{id:'b',detectedAt:'2026-10-30'}],reviews:[],documentIndex:{url:{firstSeenAt:'2026-10-30',latestId:'b',versions:{b:'2026-10-30'}}},discovery:{coverageKey:'old',history:[{date:'2026-10-30'}],archive:[{id:'two'}]}};
  const result=reconcileResearch(a,b);assert.equal(result.documents.length,2);assert.equal(result.documentIndex.url.latestId,'b');assert.equal(result.documentIndex.url.firstSeenAt,'2026-09-01');
  assert.deepEqual(result.discovery.history,a.discovery.history);assert.equal(result.discovery.legacyHistory[0].coverageKey,'old');assert.equal(result.discovery.archive.length,2);
  assert.throws(()=>reconcileResearch({...a,reviews:[{id:'x',claim:'a'}]},{...b,reviews:[{id:'x',claim:'b'}]}),/immutable review/);
});
test('legacy graph revisions remain quarantined and cannot overwrite attributed records',()=>{
  const verified={url:'https://example.org/a',observations:[]};
  const a={version:3,documents:{a:verified},legacyDocuments:{a:{pairs:{'A|B':1}}},weeks:{}};
  const b={version:2,documents:{a:{pairs:{'A|C':1}},b:{pairs:{'B|C':1}}},weeks:{}};
  const result=reconcileCoMentions(a,b);assert.deepEqual(result.documents,{a:verified});assert.equal(Object.keys(result.legacyDocuments).length,3);assert.deepEqual(result.weeks,{});
  assert.deepEqual(reconcileCoMentions(result,b),result);
});
test('reconciliation cannot create a new frozen calibration basket or renew phrase first-seen dates',()=>{
  const a={entries:[{id:'x',memberTickers:['A'],basePrice:10}]},b={entries:[{id:'x',memberTickers:['B'],basePrice:10}]};
  assert.throws(()=>reconcileCalibration({entries:[]},a,b),/frozen calibration/);
  assert.equal(reconcilePhrases({firstSeen:{}},{firstSeen:{p:'2026-10-01'}},{firstSeen:{p:'2026-10-30'}}).firstSeen.p,'2026-10-01');
});
