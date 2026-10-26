import { CALCULATION_VERSION } from './cg';
export const SCHEMA_VERSION=3;
export function makeRecord(method,settings,raw,result,extra={}) {
  return {version:SCHEMA_VERSION,id:`mass-${Date.now()}-${Math.random().toString(36).slice(2)}`,method,
    calculationVersion:CALCULATION_VERSION,createdAt:new Date().toISOString(),
    target:settings.target||'미확인',configuration:settings.configuration||'미확인',axis:settings.axis||null,
    units:{mass:'kg',length:'m',inertia:'kg·m²',torque:'N·m',viscous:'N·m·s/rad'},
    settings:JSON.parse(JSON.stringify(settings)),raw:JSON.parse(JSON.stringify(raw)),result:JSON.parse(JSON.stringify(result)),
    resultSI:method==='three_scale_cg'?{massKg:result.massKg,xM:result.x/1000,yM:result.y/1000,dxM:result.dx/1000,dyM:result.dy/1000}:method==='falling_mass'?result.parameters:null,
    displayUnits:method==='three_scale_cg'?{coordinates:'mm',mass:'g',uncertainty:'mm'}:null,
    note:settings.note||'',excluded:false,exclusionReason:'',...extra};
}
export function previewImport(text) {
  const data=JSON.parse(text);
  if(data.version===2) return {kind:'legacy',count:(data.cgRecords?.length||0)+(data.inertiaRecords?.length||0),data,originalText:text,needsUnit:true};
  if(data.version!==3||!Array.isArray(data.records)) throw new Error('version=2 또는 version=3 질량특성 JSON이 필요합니다.');
  for(const r of data.records) {
    if(!r||typeof r!=='object'||typeof r.method!=='string'||typeof r.id!=='string') throw new Error('올바르지 않은 기록 형식입니다.');
    for(const key of ['target','configuration','axis','createdAt','quality','exclusionReason'])if(r[key]!=null&&typeof r[key]!=='string')throw new Error(`기록 ${key}는 문자열이어야 합니다.`);
  }
  return {kind:'current',count:data.records.length,data,originalText:text,needsUnit:false};
}
export function importRecords(preview,selectedUnit) {
  if(preview.kind==='current') return JSON.parse(JSON.stringify(preview.data.records));
  if(!['g','kg'].includes(selectedUnit)) throw new Error('과거 CG 원입력 단위를 g/kg 중 명시적으로 선택하세요.');
  const data=preview.data,history={at:new Date().toISOString(),selectedRawMassUnit:selectedUnit,
    rawToKg:selectedUnit==='g'?0.001:1,geometryConversion:'없음',coordinates:'xG/yG는 중심 기준 mm. 원본 필드와 판 형상 보존. plateMassG 단위는 별도 미확인'};
  const archive={version:2,originalText:preview.originalText,original:data};
  const map=(r,method)=>({version:3,id:`legacy-${r.id}`,method,createdAt:r.createdAt,target:r.name||'미확인',
    configuration:r.condition||'미확인',legacyRecord:r,legacyArchive:archive,conversionHistory:[history],
    selectedRawMassUnit:selectedUnit,normalized:method==='legacy_cg'?{
      source:'사용자가 선택한 raw/net 질량 단위만 변환, plateMassG는 미확인',
      loadsKg:(r.supports||[]).map(s=>typeof s.net==='number'?s.net*history.rawToKg:null),
      xCenterM:typeof r.xG==='number'?r.xG/1000:null,yCenterM:typeof r.yG==='number'?r.yG/1000:null,
      geometry:{widthMm:r.width,heightMm:r.height,supports:r.supports},
    }:null,quality:'과거 참고자료: 재검증 필요',excluded:false,exclusionReason:''});
  return [...(data.cgRecords||[]).map(r=>map(r,'legacy_cg')),...(data.inertiaRecords||[]).map(r=>map(r,'legacy_bifilar')),
    {version:3,id:`legacy-comparisons-${Date.now()}`,method:'legacy_comparisons',legacyArchive:archive,
      cgComparisons:data.cgComparisons||[],inertiaComparisons:data.inertiaComparisons||[],conversionHistory:[history]}];
}
export function stats(values) {
  if(!values.length)return {n:0,mean:null,sd:null,cv:null};
  const mean=values.reduce((a,b)=>a+b,0)/values.length;
  const sd=values.length>1?Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/(values.length-1)):null;
  return {n:values.length,mean,sd,cv:sd==null||mean===0?null:100*sd/Math.abs(mean)};
}
export function compareRecords(records) {
  const groups={};
  for(const r of records.filter(r=>r.method==='falling_mass'&&r.result?.parameters&&r.target&&r.target!=='미확인'&&r.configuration&&r.configuration!=='미확인')) {
    const key=JSON.stringify([r.target,r.configuration,r.axis,r.settings?.fixedAxes]);
    (groups[key]??=[]).push(r);
  }
  return Object.entries(groups).map(([key,all])=>({key,label:JSON.parse(key).filter(Boolean).join(' / '),
    all:stats(all.map(r=>r.result.parameters.I)),included:stats(all.filter(r=>!r.excluded).map(r=>r.result.parameters.I)),
    c1:stats(all.filter(r=>!r.excluded).map(r=>r.result.parameters.c1)),c2:stats(all.filter(r=>!r.excluded).map(r=>r.result.parameters.c2)),
    friction:stats(all.filter(r=>!r.excluded).map(r=>r.result.parameters.c1+r.result.parameters.c2)),ids:all.map(r=>r.id)}));
}
