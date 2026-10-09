import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import quality from "../../data-quality.js";
import model from "../../research-model.js";
import techModel from "../../technology-model.js";
import config from "../../research-config.js";
import registry from "../../technology-registry.js";
import { aggregate, parseYahooMarket, parseStooqMarket, isCompanyMatch } from "../update-data.mjs";
import { hotFlags, classifyTicker } from "../lib/coil-detector.mjs";
import { computeThemeHeat, alignedCloses, relativeReturn } from "../lib/theme-heat.mjs";
import { mergeBackfillRows } from "../lib/ledger.mjs";
import { computeCoMention } from "../lib/co-mention.mjs";
import { financialFacts } from "../lib/company-intelligence.mjs";
import { buildDocumentInventory, discoverTopics, headlineSignal } from "../lib/research-intelligence.mjs";
import { articleMetadata, collectTechnology, extractFilings } from "../lib/technology-monitor.mjs";
import { researchHealth } from "../lib/research-health.mjs";
import { buildLogEntries, updateCalibrationLog, themeRelativeReturn, findCloseNear } from "../lib/calibration.mjs";

const now = "2026-10-09T20:00:00Z", priorDay = "2026-10-08T20:00:00Z";
const src = name => ({ source: name, state: "covered" });
const signal = (ticker = "INTC", extra = {}) => ({ ticker, name: ticker, marketMetricsVersion: 2, lastPrice: 10, quoteAsOf: new Date().toISOString(), priceMove: 1, relativeVolume: 2, sources: { ApeWisdom: 1, "Price/Volume": 1 }, latest: [], ...extra });
const market = ticker => ({ ...signal(ticker), source: "Price/Volume", mentions: 34565, marketQuality: [] });

test("H01: split/extreme comparisons and invalid volume are unknown, never normal", () => {
  const base = { last: 10, previous: 9, asOf: now, previousAsOf: priorDay, volumes: [100, 200], now };
  const healthy = quality.marketComparison(base);
  assert.ok(Math.abs(healthy.priceMove - 11.111111) < .00001);
  assert.equal(healthy.relativeVolume, 2);
  for (const patch of [{ split: true }, { last: 250 }, { previousAsOf: now }, { previousAsOf: "2026-09-01" }]) assert.equal(quality.marketComparison({ ...base, ...patch }).priceMove, null);
  const flye = quality.marketComparison({ ...base, last: 18.261, previous: 10, volumes: [100, 1148432] });
  assert.equal(flye.priceMove, null); assert.equal(flye.relativeVolume, null);
  assert.equal(flye.rawRelativeVolume, 11484.32);
  assert.equal(quality.relativeVolume(26), null); assert.equal(quality.relativeVolume(null), null);
});

test("H01: Yahoo aligns timestamps, retains gaps and requests split-aware comparisons", () => {
  const data = { chart: { result: [{ meta: { symbol: "SCNX", regularMarketPrice: 25, regularMarketTime: Date.parse(now)/1000 },
    timestamp: [Date.parse(priorDay)/1000, Date.parse(now)/1000], indicators: { quote: [{ close: [1,25], volume: [100,200] }] },
    events: { splits: { s: { date: Date.parse(now)/1000, numerator: 1, denominator: 25 } } } }] } };
  assert.equal(parseYahooMarket(data, "SCNX", now).priceMove, null);
  assert.equal(parseYahooMarket(data, "OTHER", now), null);
  data.chart.result[0].indicators.quote[0].close[0] = null;
  assert.equal(parseYahooMarket(data, "SCNX", now).priceMove, null);
  const stooq = parseStooqMarket("Date,Open,High,Low,Close,Volume\n2026-10-08,1,1,1,1,100\n2026-10-09,25,25,25,25,200", "SCNX", now);
  assert.equal(stooq.priceMove, null); assert.equal(stooq.lastPrice, 25);
});

test("H01: NOK/UEC returns are market measurements, not diluted by unrelated event weights", () => {
  for (const ticker of ["NOK", "UEC", "FLYE"]) {
    const rows = aggregate([market(ticker), { ticker, name: ticker, source: "ApeWisdom", mentions: 29, sentiment: .1, priceMove: 0, relativeVolume: 1 }], {});
    assert.equal(rows[0].mentions, 29); assert.equal(rows[0].sources["Price/Volume"], 1);
    assert.equal(rows[0].priceMove, 1); assert.equal(rows[0].relativeVolume, 2);
  }
  const legacy = quality.normalizeSignal({ ...signal("SCNX"), marketMetricsVersion: undefined, sources: { "Price/Volume": 2233, ApeWisdom: 22 }, priceMove: 2211.5 });
  assert.equal(legacy.mentions, 22); assert.equal(legacy.priceMove, null);
});

test("H01: full-history keeps the latest session observation, not a weighted average", () => {
  const rows = quality.aggregateSignals([
    { date: "2026-10-08", signals: [signal("NOK", { priceMove: 20, sources: { ApeWisdom: 100 } })] },
    { date: "2026-10-09", signals: [signal("NOK", { priceMove: -2 })] },
  ]);
  assert.equal(rows[0].priceMove, -2); assert.equal(rows[0].mentions, 101);
  assert.match(rows[0].marketPeriodLabel, /latest session/);
});

function stockController(enhanced = false) {
  let downloaded;
  const input = { value: "" };
  const document = { getElementById: id => id === "tickerSearch" ? input : id === "signaldesk-enhancement-styles" ? {} : null,
    querySelector: () => null, querySelectorAll: () => [], createElement: () => ({ click() {} }) };
  const context = vm.createContext({ document, window: { SIGNALDESK_QUALITY: quality }, localStorage: { getItem: () => null },
    URL: { createObjectURL: blob => { downloaded = blob; return "blob:test"; }, revokeObjectURL() {} }, URLSearchParams, Intl, Date, Blob, console,
    location: { search: "", hash: "", pathname: "/" } });
  const script = readFileSync(new URL("../../script.js", import.meta.url), "utf8").replace(/\ninit\(\);\s*$/, "");
  vm.runInContext(script, context);
  if (enhanced) vm.runInContext(readFileSync(new URL("../../enhancements.js", import.meta.url), "utf8"), context);
  return { context, downloaded: () => downloaded };
}

for (const enhanced of [false, true]) test(`H04/H05/H08: actual ${enhanced ? "enhanced" : "fallback"} controller shares scope, score and CSV selection`, async () => {
  const { context, downloaded } = stockController(enhanced);
  const quoteAt = new Date().toISOString();
  context.current = { generatedAt: quoteAt, signals: [signal("INTC", { capTier: "small", previousSources: { ApeWisdom: 4 }, previousCoverage: ["ApeWisdom"], momentum: 162.5, sources: { ApeWisdom: 1, "Google News": 30, "Price/Volume": 5 }, latest: [{ source: "Google News", title: "Intel reports earnings", published: quoteAt }] }), signal("PEP", { capTier: "large" })] };
  vm.runInContext('snapshot=current; history={snapshots:[]}; getState=()=>({sources:["ApeWisdom"],query:"",start:"",end:""}); capFilter="small"; watchlist=new Set(["INTC"]); watchlistFilter=true;', context);
  const items = context.filteredSignals(), intel = items.find(i => i.ticker === "INTC");
  assert.equal(intel.momentum, -75); assert.equal(intel.discovery.activeSources, 1);
  assert.equal(intel.topHeadline, null); assert.equal(intel.priceMove, null);
  assert.equal(intel.sources["Google News"], 0);
  context.exportCsv();
  const csv = await downloaded().text();
  assert.match(csv, /INTC/); assert.doesNotMatch(csv, /PEP/); assert.match(csv, /attention_weights_not_posts/);
  const sample = signal("INTC", { signalScore: 30 });
  const scores = [-.01, 0, .01, 1, 10].map(momentum => context.discoveryProfile({ ...sample, momentum }).score);
  assert.ok(scores.every((score, i) => !i || score >= scores[i-1]), scores.join(","));
  assert.equal(scores[0], scores[1]); assert.equal(scores[1], scores[2]);
  vm.runInContext('getState=()=>({sources:["ApeWisdom"],query:"",start:"2000-01-01",end:"2000-01-01"})',context);
  assert.equal(context.realSignals().length, 0, "empty historical dates cannot show today's stocks");
});

test("H04: unknown prior coverage stays unknown", () => {
  const item = quality.normalizeSignal(signal("INTC", { previousSources: { ApeWisdom: 4 }, previousCoverage: [] }));
  assert.equal(quality.scopeSignal(item, ["ApeWisdom"]).momentum, null);
});

test("H01/H02: legacy market events and backfilled attention remain unknown", () => {
  const rows = aggregate([{ ...market("SCNX"), marketMetricsVersion: undefined }], {});
  assert.equal(rows[0].priceMove, null);
  const ledger = { tickers: {} };
  mergeBackfillRows(ledger, "A", [["2026-10-08", 10, 1000]]);
  assert.equal(ledger.tickers.A.rows[0][1], null);
  assert.equal(ledger.tickers.A.rows[0][6].attention, "missing");
  ledger.tickers.A.rows.push(["2026-10-09", 0, 0, 10, null, null]);
  mergeBackfillRows(ledger, "A", [["2026-10-09", 12, 1500]]);
  assert.equal(ledger.tickers.A.rows.at(-1)[3], 12, "backfill cannot legitimize an old carried-forward price by filling only volume");
  assert.equal(findCloseNear([["2026-10-08", 1, .1, 10, null]], "2026-10-08"), null);
});

test("H02: benchmark sessions join by date, never shift over missing dates", () => {
  const spy = Array.from({length: 92}, (_, i) => [String(i), 1, .1, 100, 1000]);
  const entry = { rows: spy.filter((_, i) => i !== 90) };
  const values = alignedCloses(entry, spy);
  assert.equal(values[90], null);
  assert.equal(relativeReturn(values, spy.map(r => r[3])), null);
});

test("H02: missing Wikipedia is not Cold and null-volume flat series cannot coil", () => {
  assert.equal(hotFlags([1,2,null]).at(-1), null);
  assert.equal(hotFlags([100,100,100]).at(-1), false);
  for (const missing of [44,53]) {
    const rows = Array.from({length: 300}, (_,i) => [new Date(Date.parse(now)-(299-i)*86400000).toISOString().slice(0,10),10,.1,i<240?100+Math.sin(i)*10:100,i>=300-missing?null:1000,i>200?1000:100]);
    assert.equal(classifyTicker({meta:{firstSeen:rows[0][0]},rows}), null);
  }
  const short = { rows: Array.from({length:62},(_,i)=>[String(i),1,.1,100,1000,null]) };
  const themes = computeThemeHeat({tickers:{SPY:short,A:short,B:short,C:short}}, {themes:[{id:"semis",members:[{t:"A"},{t:"B"},{t:"C"}]}]});
  assert.equal(themes.themes[0].stage,"insufficient-data"); assert.equal(themes.themes[0].heat,null);
});

test("H03: all six wrong entities are rejected; a positively matching issuer survives", () => {
  const fixtures = [
    ["Direxion Daily Semiconductor Bear 3X Shares", "SOXS", "Solar X-ray payload", "SOXS is a solar instrument."],
    ["Direxion Daily South Korea Bull 3X Shares", "KORU", "Radio station", "KORU is a radio station."],
    ["Invesco QQQ Trust", "QQQ", "Australian television station", "QQQ is a television service."],
    ["Strategy", "Strategy", "General plan to achieve goals", "Strategy is a plan."],
    ["Applied Digital Corporation", "Applied Digital Data Systems", "American computer company", "Applied Digital Data Systems was a manufacturer."],
    ["SES AI Corporation", "SES S.A.", "Satellite operator", "SES is a satellite company."],
  ];
  for (const [name,title,description,extract] of fixtures) assert.equal(isCompanyMatch(name,{type:"standard",title,description,extract}),false,name);
  assert.equal(isCompanyMatch("QuantumScape Corporation",{type:"standard",title:"QuantumScape",description:"American battery company",extract:"QuantumScape Corporation is a battery company."}),true);
});

test("H06: ASTS consolidated context and QS share class are accession/period bounded", () => {
  const point = {start:"2024-01-01",end:"2024-12-31",filed:"2025-03-03",form:"10-K",accn:"0000950170-25-030909"};
  const facts = {facts:{"us-gaap":{RevenueFromContractWithCustomerExcludingAssessedTax:{units:{USD:[{...point,val:13825000}]}},RevenueFromContractWithCustomerIncludingAssessedTax:{units:{USD:[{...point,val:4418000}]}}}}};
  const asts = financialFacts(facts,{cik:"1780312"},now).financials.revenue;
  assert.equal(asts.value,4418000); assert.equal(asts.context,"Consolidated revenue"); assert.equal(asts.stale,true);
  const uncertain = financialFacts(facts,{cik:"999"},now).financials.revenue;
  assert.equal(uncertain.value,null); assert.equal(uncertain.alternatives.length,2);
  const qs = financialFacts({facts:{dei:{EntityCommonStockSharesOutstanding:{units:{shares:[{end:"2022-02-18",filed:"2022-02-28",form:"10-K",accn:"0000950170-22-002330",val:95449946}]}}}}},{cik:"1811414"},now).financials.shares;
  assert.equal(qs.shareClass,"Class B"); assert.match(qs.context,/not total/); assert.equal(qs.end,"2022-02-18");
});

test("H07: graph refresh/replay is idempotent and actual edits replace attribution", () => {
  const events = ["NVDA","AMD"].map(ticker=>({ticker,source:"4chan",url:"https://boards.4chan.org/biz/thread/62670923",title:"NVDA AMD",published:"2026-09-10"}));
  const first = computeCoMention({weeks:{}},events,"2026-09-11").nextHistory;
  const second = computeCoMention(first,events,"2026-09-18").nextHistory;
  assert.deepEqual(second.weeks,first.weeks);
  assert.equal(Object.values(second.weeks)[0]["AMD|NVDA"],1);
  const edited = computeCoMention(second,[...events,{...events[0],ticker:"TSLA",title:"Now also TSLA"}],"2026-09-18").nextHistory;
  assert.equal(Object.values(edited.weeks)[0]["AMD|NVDA"],1);
  assert.equal(Object.values(edited.weeks)[0]["NVDA|TSLA"],1);
  const collector=readFileSync(new URL("../update-data.mjs",import.meta.url),"utf8");
  assert.match(collector,/thread\.time \? new Date\(thread\.time \* 1000\)/);
});

const viewsContext={window:{SIGNALDESK_RESEARCH_CONFIG:config,SIGNALDESK_RESEARCH_MODEL:model},URL,Intl,Date};
vm.runInNewContext(readFileSync(new URL("../../research-views.js",import.meta.url),"utf8"),viewsContext);
const views=viewsContext.window.SIGNALDESK_RESEARCH_VIEWS;
test("H16: brief excludes paused collectors from current coverage", () => {
  const monitor = {sources: Object.fromEntries(config.sources.map(s => [s.id,{status:"ok", lastSuccessAt: new Date().toISOString()}]))};
  const html = views.brief(registry.themes, {generatedAt:new Date().toISOString(), documents:[], reviews:[], coverage:{readableSources:22}}, monitor, [], "ready");
  assert.match(html, /20\/20 active sources readable · 2 paused/);
  const scope = {sources:[{id:"active"},{id:"paused",accessStatus:"permission-required"}],companies:[{ticker:"QS"}]};
  const health = researchHealth({generatedAt:now,coverage:{totalSources:2},companies:{QS:{quote:{asOf:now},factsCheckedAt:now}}},{sources:{active:{id:"active",status:"ok",lastSuccessAt:now},paused:{id:"paused",status:"paused"}}},Date.parse(now),scope);
  assert.equal(health.ok,true); assert.equal(health.sourceCoverage,"1/1 active"); assert.equal(health.pausedSources,1);
});
test("H09: real controller theme scope allows incident, holographic, Nobel and owner search", () => {
  const adoption=readFileSync(new URL("../../adoption.js",import.meta.url),"utf8");
  const fn=adoption.match(/function themeList\(\) \{[^\n]+/)[0];
  for(const query of ["incident","holographic","Nobel","Lab owner"]){
    const context={view:"inbox",model:techModel,reviewedThemes:()=>registry.themes,followedOnly:false,followed:new Set(),byId:id=>({value:id==="techSearch"?query:"all"})};
    vm.runInNewContext(fn,context);
    const themes=context.themeList();assert.equal(themes.length,registry.themes.length);
    const docs=[{id:"match",title:query+" study",owner:"Lab owner",url:"https://example.org",themes:query==="incident"?["robotaxis"]:[],detectedAt:now,changeType:"new-document"}];
    const state={query,reviewFilter:"all",drafts:[],dismissed:[],queueLimit:24};
    assert.match(views.reviewQueue(themes,{documents:docs,reviews:[]},state),/data-review="match"/);
    assert.doesNotMatch(views.reviewQueue(registry.themes.filter(t=>t.id==="solid-state-batteries"),{documents:docs,reviews:[]},{...state,restrictThemes:true}),/data-review="match"/);
    assert.match(views.reviewQueue(themes,{documents:docs,reviews:[]},{...state,query:"absent query"}),/No documents/);
  }
});

test("H10: published drafts reconcile, edits preserve content and corrections get new identity", () => {
  const published={id:"review-original",candidateId:"doc",decision:"accepted",claim:"Original"};
  assert.deepEqual(model.reconcileDrafts([published],[published]),[]);
  const [edited]=model.reconcileDrafts([{...published,claim:"Unsent edits"}],[published]);
  assert.equal(edited.id,undefined);assert.equal(edited.claim,"Unsent edits");assert.equal(edited.supersedes,published.id);
  const correction={...edited,id:"review-next"};
  const next=model.correctionDraft(correction,[published,correction]);
  assert.equal(next.id,undefined);assert.equal(next.supersedes,correction.id);
});

test("H11: capacity/age eviction cannot turn unchanged documents into new events; review refs survive", () => {
  const sources=Array.from({length:4},(_,i)=>({id:"s"+i,owner:"Lab",themes:[],mode:"links"}));
  const registry={sources,themes:[]};
  const state={sources:Object.fromEntries(sources.map(s=>[s.id,{status:"ok",lastSuccessAt:now,baselineAt:now,items:Array.from({length:201},(_,i)=>({url:`https://example.org/${s.id}/${i}`,title:"Original article "+i}))}]))};
  const first=buildDocumentInventory(registry,state,{},now);assert.equal(first.documents.length,800);assert.equal(Object.keys(first.documentIndex).length,804);
  for(const s of Object.values(state.sources))s.lastSuccessAt="2026-10-10T20:00:00Z";
  const next=buildDocumentInventory(registry,state,first,"2026-10-10T20:00:00Z");
  assert.deepEqual(next.documents,first.documents);
  const review={candidateId:first.documents[0].id};
  const aged=buildDocumentInventory(registry,state,next,"2027-10-10T20:00:00Z",[review]);
  assert.equal(aged.documents.length,1);assert.equal(aged.documents[0].id,review.candidateId);
  state.sources.s0.items[0].title="Genuine revised article";state.sources.s0.lastSuccessAt="2027-10-10T20:00:00Z";
  const revised=buildDocumentInventory(registry,state,aged,"2027-10-10T20:00:00Z",[review]);
  assert.equal(revised.documents.find(d=>d.title==="Genuine revised article").changeType,"revision");
});

test("H12/H13: same-URL title revisions count once and biological regulation is not policy", () => {
  const source={id:"nature",url:"https://example.org/feed",discovery:true};
  const docs=["Quantum error correction","Quantum error correction improved"].map((title,i)=>({id:String(i),url:"https://example.org/article",title,sourceId:"nature",discovery:true,publishedAt:"2026-10-08",detectedAt:`2026-10-0${8+i}`,owner:"Nature"}));
  const result=discoverTopics(docs,[],{},now,[source],{nature:{status:"ok",lastSuccessAt:now}});
  assert.equal(result.datedDocuments,1);
  for(const title of ["Regulatory T cells in prostate cancer","Regulation of lipopolysaccharide transport","Protein regulation in cancer"])assert.notEqual(headlineSignal(title),"Regulatory language");
  assert.equal(headlineSignal("FCC authorizes satellite service"),"Regulatory language");
});

test("H14: metadata keeps announcement and original-paper identities/dates separate", () => {
  const metadata=articleMetadata('<meta property="article:published_time" content="2026-10-07"><meta name="description" content="Incident readiness framework"><a href="https://arxiv.org/abs/2609.04777">Paper</a>',{id:"waymo"});
  assert.equal(metadata.publishedAt,"2026-10-07");assert.equal(metadata.researchPublishedAt,null);assert.equal(metadata.researchUrl,"https://arxiv.org/abs/2609.04777");
  const paper=articleMetadata('<meta name="citation_date" content="2026-09-04">',{id:"linked-research"});
  assert.equal(paper.researchPublishedAt,"2026-09-04");
});

test("H15: unrelated articles have no accept/technology/kind defaults", () => {
  const html=views.reviewEditor({id:"protein",title:"Protein regulation",url:"https://example.org",themes:[],owner:"Nature"},registry.themes,[]);
  assert.match(html,/Choose a decision/);assert.match(html,/Choose a technology/);assert.match(html,/Choose an evidence kind/);
  assert.doesNotMatch(html,/<option value="accepted" selected/);assert.match(html,/name="relevance"/);
  const toyota=registry.sources.find(s=>s.id==="sec-tm");
  const result=buildDocumentInventory(registry,{sources:{[toyota.id]:{status:"ok",lastSuccessAt:now,items:[{url:"https://example.org/buyback",title:"Toyota announces a share buyback"}]}}},{},now);
  assert.deepEqual(result.documents[0].themes,[]);
});

test("H16: permission-paused sources cannot fetch even when forced", async () => {
  let calls=0;const sources=config.sources.filter(s=>s.accessStatus==="permission-required");
  assert.equal(sources.length,2);
  const result=await collectTechnology({sources},{},{now,force:true,fetchImpl:async()=>{calls++;throw Error("must not fetch");}});
  assert.equal(calls,0);assert.ok(Object.values(result.sources).every(s=>s.status==="paused"));
});

test("H16: SEC metadata exposes report date, acceptance, items and exhibit index without adoption claims", () => {
  const source={cik:"42",owner:"Issuer",url:"https://data.sec.gov",allowedHosts:["www.sec.gov"]};
  const json={cik:42,filings:{recent:{accessionNumber:["0000000042-26-000001"],primaryDocument:["report.htm"],form:["8-K"],filingDate:["2026-10-08"],reportDate:["2026-10-07"],acceptanceDateTime:["2026-10-08T12:00:00Z"],items:["2.02,9.01"]}}};
  const [filing]=extractFilings(JSON.stringify(json),source).items;
  assert.equal(filing.reportDate,"2026-10-07");assert.deepEqual(filing.filingItems,["2.02","9.01"]);assert.match(filing.exhibitsIndexUrl,/-index.html$/);
});

test("latent calibration: freezes event basket and retries missing target prices", () => {
  const registry={themes:[{id:"theme",members:[{t:"OLD"}]}]};
  const [entry]=buildLogEntries({springEvents:[],themeEvents:[{type:"theme-stage-transition",theme:"theme",toStage:"wave"}],ledger:{tickers:{}},dateStr:"2026-01-01",registry});
  registry.themes[0].members=[{t:"NEW"}];assert.deepEqual(entry.memberTickers,["OLD"]);
  const row=(day,price)=>[day,0,0,price,100,null];
  let log=updateCalibrationLog({entries:[entry]},[],{tickers:{}},registry,"2026-02-01");assert.equal(log.entries[0].graded["30d"],null);
  log=updateCalibrationLog(log,[],{tickers:{SPY:{rows:[row("2026-01-01",100),row("2026-01-31",100)]},OLD:{rows:[row("2026-01-01",100),row("2026-01-31",120)]}}},registry,"2026-02-02");
  assert.ok(Math.abs(log.entries[0].graded["30d"]-.2)<1e-9);
});
