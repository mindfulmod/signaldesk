import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGicsWikitext, buildThemeRegistry, refreshThemeRegistry, GICS_SECTORS, fetchGicsBaseline } from "../lib/theme-registry.mjs";
const header = '![[Ticker symbol|Symbol]]\n! Security !! [[Global Industry Classification Standard|GICS]] Sector !! GICS Sub-Industry !! Headquarters Location !! Date added !! [[Central Index Key|CIK]] !! Founded';
const table = rows => `{| class="wikitable sortable" id="constituents"\n|-\n${header}\n|-\n${rows.join('\n|-\n')}\n|}`;
const row = (delimiter = '\n|| ') => ['{{NyseSymbol|MMM}}', '[[3M]]', 'Industrials', 'Industrial Conglomerates', '[[Saint Paul, Minnesota]]', '1957-03-04', '0000066740', '1902'].join(delimiter);
test('GICS parses newline and same-line cells without shifting security into sector', () => {
  for (const data of ['|| '+row(), '| '+row(' || '), '| '+row('\n| ')]) {
    assert.deepEqual(parseGicsWikitext(table([data])).get('MMM'), {name:'3M',sector:'Industrials',sub:'Industrial Conglomerates',cik:'0000066740'});
  }
  const cboe=table(['|| '+row().replace('{{NyseSymbol|MMM}}','{{BZX link|CBOE}}')]);
  assert.ok(parseGicsWikitext(cboe).has('CBOE'));
});
test('GICS rejects changed headers, unknown symbols, invalid sectors and duplicate rows', () => {
  for(const text of [table(['|| '+row()]).replace('GICS Sub-Industry','Unknown column'), table(['|| '+row().replace('Industrials','3M')]), table(['|| '+row().replace('NyseSymbol','Unknown')]),table(['|| '+row(),'|| '+row()])]) assert.throws(()=>parseGicsWikitext(text));
  assert.equal(buildThemeRegistry(new Map([['MMM',{sector:'3M',sub:'Industrials'}]]),[{id:'x',gicsSubs:['Industrials'],manual:['AMD']}]).themes[0].members.length,1);
});
const baseline = () => new Map(Array.from({length:500},(_,i)=>['T'+i,{sector:[...GICS_SECTORS][i%11],sub:'Test subindustry'}]));
test('GICS failed refresh retains valid dates but does not renew them or reuse corrupt cache', async()=>{
  for(const valid of [true,false]) {
    const failures=[]; const old={gicsRefreshedAt:'2026-09-01T12:00:00Z',gicsParserVersion:2,gics:valid?Object.fromEntries(baseline()):{MMM:{sector:'3M',sub:'Industrials'}}};
    const result=await refreshThemeRegistry({failures,now:'2026-11-02T12:00:00Z',loadRegistry:async()=>old,loadOverrides:async()=>[{id:'x',manual:['AMD']}],fetchBaseline:async()=>{throw Error('HTTP 503');}});
    assert.equal(result.gicsRefreshedAt,valid?old.gicsRefreshedAt:null);
    assert.equal(result.gicsStatus,valid?'retained':'unavailable');
    assert.equal(Object.keys(result.gics).length,valid?500:0);assert.equal(failures.length,1);
    assert.deepEqual(result.themes[0].members,[{t:'AMD',src:['manual']}]);
  }
});
test('GICS protocol migration forces a validated refresh even with a recent cache',async()=>{
  let calls=0;
  const result=await refreshThemeRegistry({now:'2026-11-02T12:00:00Z',loadRegistry:async()=>({gicsRefreshedAt:'2026-11-01',gics:Object.fromEntries(baseline())}),loadOverrides:async()=>[],fetchBaseline:async()=>{calls++;return baseline();}});
  assert.equal(calls,1);assert.equal(result.gicsParserVersion,2);assert.equal(result.gicsStatus,'current');assert.equal(result.gicsRefreshedAt,'2026-11-02T12:00:00Z');
});
test('GICS fetch rejects incomplete or oversized successful responses',async()=>{
  for(const text of [table(['|| '+row()]),'x'.repeat(2000001)]) await assert.rejects(fetchGicsBaseline({fetchImpl:async()=>new Response(text)}));
});
