// Offline preparation only: no Git mutation, network collection or deployment.
// Use before a merge, inspect the report, then regenerate through the collectors.
import { execFileSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { threeWay, union, reconcileHistory, reconcileLedger, reconcileMonitor, reconcileResearch, reconcileCoMentions, reconcileCalibration, reconcilePhrases } from "./lib/reconcile-data.mjs";
import registry from "../technology-registry.js";
import { publicMonitor } from "./lib/technology-monitor.mjs";
import { buildDocumentInventory, discoverTopics } from "./lib/research-intelligence.mjs";
import loader from "../research-loader.js";

const git=(...args)=>execFileSync("git",args,{encoding:"utf8",maxBuffer:150000000});
const json=(ref,path)=>JSON.parse(git("show",`${ref}:${path}`));
const newest=(a,b)=>String(a.generatedAt||a.updatedAt||"")>String(b.generatedAt||b.updatedAt||"")?a:b;
export async function main(args=process.argv.slice(2)) {
  const arg=name=>{const i=args.indexOf(name);if(i<0||!args[i+1]||args[i+1].startsWith("--"))throw Error(`${name} required`);return args[i+1];};
  const ours=git("rev-parse",`${arg("--ours")}^{commit}`).trim(),theirs=git("rev-parse",`${arg("--theirs")}^{commit}`).trim();
  const base=git("merge-base",ours,theirs).trim(),output=resolve(arg("--output"));
  const tracked=new Set(git("ls-tree","-r","--name-only",ours).trim().split("\n"));
  const changed=union(git("diff","--name-only",base,ours).trim().split("\n"),git("diff","--name-only",base,theirs).trim().split("\n"),x=>x).filter(p=>p.startsWith("data/")&&p.endsWith(".json"));
  const audit=[],files={};
  for(const path of changed) {
    let a,b,c;try{a=json(ours,path);b=json(theirs,path);c=json(base,path);}catch{throw Error(`Missing or malformed merge input: ${path}`);}
    const name=path.slice(5);
    if(name==="history.json")files[name]=reconcileHistory(a,b);
    else if(name==="ledger.json")files[name]=reconcileLedger(c,a,b,audit);
    else if(name==="technology-monitor-state.json")files[name]=reconcileMonitor(a,b);
    else if(name==="research.json")files[name]=reconcileResearch(a,b);
    else if(name==="co-mention-history.json")files[name]=reconcileCoMentions(a,b);
    else if(name==="alerts-log.json")files[name]={...newest(a,b),entries:union(a.entries,b.entries).sort((x,y)=>y.date.localeCompare(x.date))};
    else if(name==="calibration-log.json")files[name]=reconcileCalibration(c,a,b,audit);
    else if(name==="phrase-history.json")files[name]=reconcilePhrases(c,a,b,audit);
    else if(["alerts-state.json","diffusion-state.json"].includes(name))files[name]=threeWay(c,a,b,audit,name,"theirs");
    else files[name]=newest(a,b);
  }
  // Assemble a coherent publication using the actual retained check timestamps.
  // This is a rebuild, not a new successful source collection.
  const now=new Date().toISOString();
  const state=files["technology-monitor-state.json"];
  const research=files["research.json"];
  if(!state||!research)throw Error("Research and monitor inputs required together");
  const inventory=buildDocumentInventory(registry,state,research,now,research.reviews);
  // Merge must not apply collection retention to records the user just preserved.
  const reclassified=new Map(inventory.documents.map(d=>[d.id,d]));
  const documents=research.documents.map(d=>reclassified.get(d.id)||d);
  for(const d of inventory.documents)if(!documents.some(x=>x.id===d.id))documents.push(d);
  files["technology-monitor.json"]=publicMonitor(state);
  files["research.json"]={...research,collectionId:randomUUID(),generatedAt:now,sourceCheckedAt:state.generatedAt,runUrl:null,
    documents,documentIndex:inventory.documentIndex,companies:files["company-intelligence.json"]?.companies||research.companies,
    discovery:discoverTopics(documents,registry.themes,research.discovery,now,registry.sources.filter(s=>s.discovery),state.sources,{discoveryTruncated:inventory.discoveryTruncated}),
    reconciliation:{ours,theirs,base,assembledAt:now,collectionPerformed:false}};
  const pairError=loader.validatePair(files["research.json"],files["technology-monitor.json"],Date.parse(now));
  if(pairError)throw Error(pairError);
  // Build every file in memory first. A missing bundle binding is a hard error.
  const contents={};
  for(const[name,value]of Object.entries(files)) {
    const data=JSON.stringify(value);contents[name]=data+"\n";
    const bundle=name.replace(/\.json$/,".js");
    if(!tracked.has(`data/${bundle}`))continue;
    const source=git("show",`${ours}:data/${bundle}`);
    const global=source.match(/^window\.(SIGNALDESK_[A-Z_]+)\s*=/)?.[1];
    if(!global)throw Error(`Unknown browser bundle: ${bundle}`);
    contents[bundle]=`window.${global} = ${data};\n`;
  }
  await mkdir(output,{recursive:true});
  for(const[name,content]of Object.entries(contents))await writeFile(resolve(output,name),content);
  const report={ours,theirs,base,output,files:Object.keys(contents),conflicts:audit,
    historyDates:files["history.json"].snapshots.length,ledgerTickers:Object.keys(files["ledger.json"].tickers).length,
    documents:documents.length,documentIdentities:Object.keys(inventory.documentIndex).length,legacyGraphRecords:Object.keys(files["co-mention-history.json"].legacyDocuments).length};
  console.log(JSON.stringify(report,null,2));return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{console.error(e.message);process.exitCode=1;});
