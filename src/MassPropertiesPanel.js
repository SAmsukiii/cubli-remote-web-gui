import React,{useEffect,useRef,useState} from 'react';
import {Alert,Button,ButtonGroup,Form,ProgressBar,Table} from 'react-bootstrap';
import {LineChart,Line,XAxis,YAxis,Tooltip,CartesianGrid,ResponsiveContainer,ReferenceArea,ReferenceLine} from 'recharts';
import {calculateCg,defaultCg,plateMassG,number} from './massProperties/cg';
import {defaultIdentification,parseCsv,suggestColumns,syntheticCsv} from './massProperties/identification';
import {makeRecord,previewImport,importRecords,compareRecords,stats} from './massProperties/records';
import {createAnalysisWorker} from './massProperties/workerFactory';
import './MassPropertiesPanel.css';

const STORAGE='cubli.mass-properties.v3';
const fmt=(v,d=4)=>v==null||!Number.isFinite(v)?'미확인':Number(v).toLocaleString('ko-KR',{maximumFractionDigits:d});
function download(name,text,type='application/json') {
  const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function Field({label,value,onChange,type='number',...props}) {
  return <label className="mass-field"><span>{label}</span><Form.Control size="sm" type={type} value={value??''} onChange={e=>onChange(e.target.value)} step="any" {...props}/></label>;
}
function Choice({label,value,onChange,options}) {
  return <label className="mass-field"><span>{label}</span><Form.Select size="sm" value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={Array.isArray(o)?o[0]:o} value={Array.isArray(o)?o[0]:o}>{Array.isArray(o)?o[1]:o}</option>)}</Form.Select></label>;
}
function Warnings({items}) {return items?.length?<Alert variant="warning" className="mt-2 small"><ul className="mb-0">{items.map((w,i)=><li key={i}>{w}</li>)}</ul></Alert>:null;}
function Diagram({config,result}) {
  const W=Number(config.width),H=Number(config.height),s=240/Math.max(W,H,1),ox=35,oy=275;
  if(!(W>0&&H>0))return null;
  const xy=(x,y)=>[ox+x*s,oy-y*s];
  const points=config.supports.map(p=>xy(Number(p.x),Number(p.y)));
  const cubli=config.cubli,validCubli=['width','height','x','y','angle'].every(k=>cubli[k]!==''&&Number.isFinite(Number(cubli[k])))&&Number(cubli.width)>0&&Number(cubli.height)>0;
  const cp=xy(Number(cubli.x),Number(cubli.y));
  return <svg viewBox="0 0 320 310" className="mass-diagram" role="img" aria-label="CG 상면도: 왼쪽 아래 원점, 오른쪽 +x, 위쪽 +y, 동일 mm 축척">
    <rect x={ox} y={oy-H*s} width={W*s} height={H*s} fill="#aab4c120" stroke="#b8c5d3"/>
    <polygon points={points.map(p=>p.join(',')).join(' ')} fill="#38bdf818" stroke="#38bdf8" strokeDasharray="5 3"/>
    <path d={`M ${ox-10} ${oy} H ${ox+W*s+15} M ${ox} ${oy+10} V ${oy-H*s-15}`} stroke="#dbeafe"/>
    <text x={ox+W*s+5} y={oy+20}>+x</text><text x={ox-24} y={oy-H*s-8}>+y</text>
    <text x={ox-10} y={oy+23}>0</text><text x={ox+W*s/2} y={oy+23}>{W} mm</text><text x={ox+5} y={oy-H*s+16}>{H} mm</text>
    {points.map((p,i)=><g key={i}><circle cx={p[0]} cy={p[1]} r="4" fill="#38bdf8"/><text x={p[0]+6} y={p[1]-7}>P{i+1}</text></g>)}
    <g transform={`translate(${xy(W/2,H/2).join(' ')})`}><path d="M -6 0 H 6 M 0 -6 V 6" stroke="#fff"/><text x="8" y="16">O</text></g>
    {validCubli&&<g transform={`translate(${cp.join(' ')}) rotate(${-Number(cubli.angle)})`}><rect x={-Number(cubli.width)*s/2} y={-Number(cubli.height)*s/2} width={Number(cubli.width)*s} height={Number(cubli.height)*s} fill="#c084fc18" stroke="#c084fc"/><circle r="3" fill="#c084fc"/><path d="M 0 0 H 18" stroke="#c084fc"/></g>}
    {result&&<g transform={`translate(${xy(result.x,result.y).join(' ')})`}><circle r="6" fill="#fbbf24"/><text x="9" y="-7">CG</text></g>}
  </svg>;
}
function CgPanel({save}) {
  const [config,setConfig]=useState(defaultCg),[result,setResult]=useState(null),[error,setError]=useState('');
  const [cal,setCal]=useState({scaleId:'',preloadG:'',referenceG:'',referenceUncertaintyG:'',repeats:'',loading:'상승/하강',zeroReturnG:'',driftG:'',elapsedMin:'',position:'중앙/편심',trueX:'',trueY:'',note:''});
  const update=(key,value)=>{setConfig(c=>({...c,[key]:value}));setResult(null);setError('');};
  const support=(i,key,value)=>update('supports',config.supports.map((s,j)=>j===i?{...s,[key]:value}:s));
  let plate=null;try{plate=plateMassG(config);}catch{}
  const changeUnit=unit=>{
    const f=config.unit==='g'?0.001:1000;
    setConfig(c=>({...c,unit,supports:c.supports.map(s=>({
      ...s,...Object.fromEntries(['net','baseline','gross'].map(k=>[k,s[k]===''?'':Number(s[k])*f])),
    }))}));
    setResult(null);
  };
  const calculate=()=>{try{setResult(calculateCg(config));setError('');}catch(e){setResult(null);setError(e.message);}};
  const calibrationSave=()=>{try{
    if(!cal.scaleId.trim())throw new Error('저울 ID를 입력하세요.');
    const validation=result&&cal.trueX!==''&&cal.trueY!==''?{errorXmm:result.x-number(cal.trueX,'참값 x'),errorYmm:result.y-number(cal.trueY,'참값 y')}:null;
    save(makeRecord('cg_calibration',config,cal,{validation}, {calibration:cal}));
  }catch(e){setError(e.message);}};
  return <>
    <p className="mass-muted">설치·수평 확인 → 상판+지지발 TARE → Cubli 배치 → 안정값 입력 → 계산·기록. 수동 저울 판독입니다.</p>
    <div className="mass-grid"><Choice label="입력 모드" value={config.mode} onChange={v=>update('mode',v)} options={[["tare","A · 저울에서 이미 TARE한 증가하중"],["difference","B · gross − baseline"]]}/><Choice label="입력 질량 단위" value={config.unit} onChange={changeUnit} options={['g','kg']}/></div>
    <div className="mass-grid mass-three">{config.supports.map((s,i)=><Field key={i} label={`P${i+1} ${config.mode==='tare'?'증가하중 R':'gross G'} [${config.unit}]`} value={s[config.mode==='tare'?'net':'gross']} onChange={v=>support(i,config.mode==='tare'?'net':'gross',v)}/>)}</div>
    {config.mode==='difference'&&<div className="mass-grid mass-three">{config.supports.map((s,i)=><Field key={i} label={`P${i+1} baseline B [${config.unit}]`} value={s.baseline} onChange={v=>support(i,'baseline',v)}/>)}</div>}
    <div className="mass-actions"><Button size="sm" onClick={calculate}>CG 계산</Button><Button size="sm" variant="outline-info" disabled={!result} onClick={()=>save(makeRecord('three_scale_cg',config,config.supports,result))}>CG 기록 저장</Button></div>
    {error&&<Alert variant="danger" role="alert">{error}</Alert>}
    {result&&<div className="mass-result" data-testid="cg-result"><strong>dx {fmt(result.dx)} mm · dy {fmt(result.dy)} mm</strong><p>시험체 {fmt(result.massG)} g ({fmt(result.massKg,6)} kg)<br/>판 원점 기준 x {fmt(result.x)} · y {fmt(result.y)} mm</p>
      <p>판 내부: {result.insidePlate?'예':'아니오'} · 시험체 CG의 지지 삼각형 내부: {result.insideTriangle?'예':'아니오'}</p>
      <p>전체 하중 지지 안정성: {result.stability}</p>
      <p>±1mm 목표: {result.uncertainty.target}<br/>{result.uncertainty.scope}</p>
      {result.uncertainty.linearX!=null&&<p>1차 bounded Ux/Uy: {fmt(result.uncertainty.linearX)} / {fmt(result.uncertainty.linearY)} mm<br/>8조합 정확 bounded: {fmt(result.uncertainty.exactX)} / {fmt(result.uncertainty.exactY)} mm</p>}
      {result.uncertainty.rssX!=null&&<p>독립 표준불확도 RSS ux/uy: {fmt(result.uncertainty.rssX)} / {fmt(result.uncertainty.rssY)} mm</p>}
      {result.loads.map((l,i)=><div key={i}>P{i+1} gross {fmt(l.grossG)} g · 용량 {l.capacityStatus}</div>)}
      <Warnings items={result.warnings}/></div>}
    <Diagram config={config} result={result}/>
    <p className="mass-muted">판 좌측 하단 (0,0), +y는 위쪽. 노랑 CG, 흰색 O, 보라색은 설정한 Cubli 기준점과 외형입니다. 단일 수평 측정은 2D CG만 제공합니다.</p>
    <details><summary>상판·지지점·Cubli 상세 설정</summary>
      <div className="mass-grid">{[['width','판 가로 [mm]'],['height','판 세로 [mm]'],['thickness','판 두께 [mm]'],['density','밀도 [kg/m³]']].map(([k,l])=><Field key={k} label={l} value={config[k]} onChange={v=>update(k,v)}/>)}</div>
      <p>은색 통알루미늄 판 · 이론 질량 {fmt(plate)} g. 지지발·테이프를 포함한 TARE는 별도 실측하세요.</p>
      <p className="mass-muted">지지점 기본값은 미실측 제안입니다. 접촉 중심을 실측하세요. 양면테이프 고정 시 크리프·이동, 1mm 판의 처짐과 바닥 간격을 하중 상태에서 점검하세요. 저울 외형·방향을 확인하여 서로 겹치거나 주변에 닿지 않게 배치하세요.</p>
      {config.supports.map((s,i)=><fieldset key={i}><legend>P{i+1}</legend><div className="mass-grid"><Field label="접촉 중심 x [mm]" value={s.x} onChange={v=>support(i,'x',v)}/><Field label="접촉 중심 y [mm]" value={s.y} onChange={v=>support(i,'y',v)}/></div></fieldset>)}
      <Form.Check id="mass-cg-supports-confirmed" label="실제 접촉 중심 좌표 확인 완료" checked={config.supportsConfirmed} onChange={e=>update('supportsConfirmed',e.target.checked)}/>
      <p className="mt-2">Cubli 최신 질량·치수는 미확인입니다. 아래 실측 설정을 입력하면 외형을 표시합니다. 기준점은 외형 중심, 방향은 판 +x에서 반시계 각도입니다.</p>
      <div className="mass-grid">{[['width','Cubli 폭 [mm]'],['height','Cubli 깊이 [mm]'],['x','기준점 x [mm]'],['y','기준점 y [mm]'],['angle','설치 방향 [deg]'],['mass','별도 실측 Cubli 질량 [g]']].map(([k,l])=><Field key={k} label={l} value={config.cubli[k]} onChange={v=>update('cubli',{...config.cubli,[k]:v})}/>)}</div>
      <Button variant="outline-secondary" size="sm" onClick={()=>{update('cubli',{width:161,height:161,x:100,y:100,angle:0,mass:992});}}>과거 발표 예시 161mm / 992g 불러오기</Button>
    </details>
    <details><summary>저울 용량·보정·오차 예산</summary>
      <p className="mass-muted">모든 오차·용량·offset 필드는 g 단위입니다. ε는 보정 후 증가하중의 검증된 차동 bounded 한계, σ는 별도 독립 표준불확도입니다. baseline/gross 두 번 판독은 bounded 합, 독립 σ 제곱합을 고려하고 공통 offset·상관은 따로 평가하세요. 분해능은 accuracy가 아니며 평균으로 드리프트·스케일오차가 사라지지 않습니다.</p>
      {config.supports.map((s,i)=><fieldset key={i}><legend>P{i+1} {s.id}</legend><div className="mass-grid">
        <Field label="저울 ID" type="text" value={s.id} onChange={v=>support(i,'id',v)}/>
        <Field label="용량 [g, 실제 gross 기준]" value={s.capacityG} onChange={v=>support(i,'capacityG',v)}/>
        {config.mode==='tare'&&<Field label={`실측 baseline [${config.unit}, 용량 확인용]`} value={s.baseline} onChange={v=>support(i,'baseline',v)}/>}
        <Field label="보정 a (양수)" value={s.gain} onChange={v=>support(i,'gain',v)}/><Field label="절대 offset b [g]" value={s.offsetG} onChange={v=>support(i,'offsetG',v)}/>
        <Field label="차동 ε [g, bounded ±한계]" value={s.epsilonG} onChange={v=>support(i,'epsilonG',v)}/><Field label="차동 σ [g, 표준불확도]" value={s.sigmaG} onChange={v=>support(i,'sigmaG',v)}/>
      </div></fieldset>)}
      <p className="mass-muted">f(m)=a·m+b. B모드는 f(G)−f(B)=a(G−B), A모드는 aR입니다. 증가하중에 절대 offset을 다시 더하지 않습니다.</p>
      <Form.Check id="mass-cg-error-validated" label="실제 preload·운용 증가하중 범위에서 오차 예산을 검증함" checked={config.errorValidated} onChange={e=>update('errorValidated',e.target.checked)}/>
    </details>
    <details><summary>교정·기준물체 검증 기록</summary><div className="mass-grid">
      {Object.entries({scaleId:'저울 ID',preloadG:'설치 preload [g]',referenceG:'기준추 [g]',referenceUncertaintyG:'기준추 불확도 [g]',repeats:'반복값 [g, 쉼표 구분]',loading:'상승/하강 하중 조건',zeroReturnG:'영점 복귀 [g]',driftG:'시간 드리프트 [g]',elapsedMin:'경과시간 [min]',position:'계량판 중앙/편심 위치',trueX:'기준물체 참 x [mm]',trueY:'기준물체 참 y [mm]',note:'교정 메모'}).map(([k,l])=><Field key={k} label={l} type={['scaleId','repeats','loading','position','note'].includes(k)?'text':'number'} value={cal[k]} onChange={v=>setCal(c=>({...c,[k]:v}))}/>)}</div><Button size="sm" onClick={calibrationSave}>현재 CG와 교정·참값 오차 저장</Button></details>
    <details><summary>대상·구성·메모와 계산식</summary><div className="mass-grid"><Field label="대상" type="text" value={config.target} onChange={v=>update('target',v)}/><Field label="설치 구성" type="text" value={config.configuration} onChange={v=>update('configuration',v)}/></div><Field label="메모" type="text" value={config.note} onChange={v=>update('note',v)}/>
      <p>M=ΣRᵢ, x=ΣRᵢxᵢ/M, y=ΣRᵢyᵢ/M, dx=x−W/2, dy=y−H/2. 중심 편차와 측정오차는 별개입니다. 108g 판 + 992g 중앙 물체 예시는 gross=(275,275,550)g, net=(248,248,496)g이며 지지발·테이프는 포함하지 않습니다.</p></details>
  </>;
}
function SignalChart({title,points,keys,split,shock,onSplit}) {
  const stride=Math.max(1,Math.ceil(points.length/900)),data=points.filter((_,i)=>i%stride===0||i===points.length-1);
  return <div className="mass-chart"><p>{title}</p><ResponsiveContainer width="100%" height={190}><LineChart data={data} onClick={e=>{if(onSplit&&Number.isFinite(Number(e?.activeLabel)))onSplit(Number(e.activeLabel));}} margin={{right:15,left:0,top:8,bottom:5}}>
    <CartesianGrid stroke="#334155" strokeDasharray="3 3"/><XAxis type="number" dataKey="t" domain={['dataMin','dataMax']} tick={{fill:'#cbd5e1',fontSize:10}}/><YAxis width={52} tick={{fill:'#cbd5e1',fontSize:10}} domain={['auto','auto']}/><Tooltip contentStyle={{background:'#111827',borderColor:'#475569',fontSize:11}} labelFormatter={v=>`${fmt(v)} s`}/>
    {split!=null&&<ReferenceLine x={split} stroke="#fbbf24"/>}{split!=null&&<ReferenceArea x1={split-shock} x2={split+shock} fill="#fbbf24" fillOpacity={0.14}/>}
    {keys.map(([key,color,name])=><Line key={key} dataKey={key} name={name} stroke={color} type="linear" dot={false} isAnimationActive={false} connectNulls={false}/>)}
  </LineChart></ResponsiveContainer>{stride>1&&<small>표시만 {stride}개 중 1개. 분석은 원 표본을 사용합니다.</small>}</div>;
}
function IdentificationPanel({save}) {
  const [settings,setSettings]=useState(defaultIdentification),[csv,setCsv]=useState(null),[prepared,setPrepared]=useState(null),[result,setResult]=useState(null);
  const [confirmed,setConfirmed]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState(null),[clickSplit,setClickSplit]=useState(false);
  const worker=useRef(null),busy=progress!=null;
  useEffect(()=>()=>worker.current?.terminate(),[]);
  const update=(k,v)=>{
    if(worker.current){worker.current.terminate();worker.current=null;setProgress(null);}
    if(['timeColumn','valueColumn','timeUnit','valueKind','angleUnit','cpr','sign','wrapPeriod','window','degree','gapSeconds'].includes(k))setPrepared(null);
    if(['timeColumn','valueColumn','timeUnit','valueKind','angleUnit','cpr','sign','wrapPeriod'].includes(k))setConfirmed(false);
    setSettings(c=>({...c,[k]:v}));setResult(null);
  };
  const load=(text,name)=>{try{const parsed=parseCsv(text);setCsv({...parsed,text,name});setSettings(c=>({...c,...suggestColumns(parsed.headers,c.axis)}));setConfirmed(false);setPrepared(null);setResult(null);setError('');}catch(e){setError(e.message);}};
  const run=preview=>{if(!csv||!confirmed){setError('CSV 열·단위·시간축 미리보기를 확인하고 확인란을 선택하세요.');return;}
    setError('');setResult(null);setProgress(0);
    try{worker.current?.terminate();const w=createAnalysisWorker();worker.current=w;
      w.onmessage=({data})=>{if(data.type==='progress')setProgress(data.progress);else{setProgress(null);w.terminate();worker.current=null;
        if(data.type==='error')setError(data.error);else {setPrepared(data.prepared);if(data.result)setResult(data.result);}}};
      w.onerror=()=>{setError('분석 Worker를 실행하지 못했습니다. 새로고침 후 다시 시도하세요.');setProgress(null);w.terminate();worker.current=null;};
      w.postMessage({rows:csv.rows,settings,preview});
    }catch(e){setError(e.message);setProgress(null);}
  };
  const split=Number(settings.split===''?prepared?.peakTime:settings.split);
  return <>
    <p className="mass-muted">Yaw 한 축 자유, 다른 축 고정 → 접선 줄의 낙하추로 가속 → 추 분리 → 자유감속. 이 화면은 분석 전용입니다.</p>
    <div className="mass-grid"><Field label="대상 이름" type="text" value={settings.target} onChange={v=>update('target',v)}/><Field label="함께 회전한 전체 구성 / 원점" type="text" value={settings.configuration} onChange={v=>update('configuration',v)}/>
      <Choice label="식별축" value={settings.axis} onChange={v=>{update('axis',v);update('fixedAxes',v==='Yaw'?'Roll/Pitch 고정':v==='Roll'?'Pitch/Yaw 고정':'Roll/Yaw 고정');}} options={['Yaw','Roll','Pitch']}/><Field label="고정한 축 및 고정 방법" type="text" value={settings.fixedAxes} onChange={v=>update('fixedAxes',v)}/>
      <Field label={`낙하추 질량 [${settings.massUnit}]`} value={settings.mass} onChange={v=>update('mass',v)}/><Choice label="낙하추 질량 단위" value={settings.massUnit} onChange={v=>update('massUnit',v)} options={['kg','g']}/>
      <Field label={`축 기준 유효 반경 R [${settings.radiusUnit}]`} value={settings.radius} onChange={v=>update('radius',v)}/><Choice label="유효 반경 단위" value={settings.radiusUnit} onChange={v=>update('radiusUnit',v)} options={['m','mm']}/>
      <Field label="중력가속도 [m/s²]" value={settings.gravity} onChange={v=>update('gravity',v)}/><Choice label="입력 토크 방향 s" value={settings.direction} onChange={v=>update('direction',Number(v))} options={[[1,'+1'],[-1,'−1']]}/></div>
    {settings.axis!=='Yaw'&&<Alert variant="warning">Roll/Pitch는 중력 복원토크·축 결합 때문에 모델이 부적합할 수 있습니다. 특히 Roll의 CoM–CoR 불일치를 확인하세요. 탐색 결과로만 저장합니다.</Alert>}
    <label className="mass-field"><span>원 CSV 가져오기 (기존 Server/Web Serial의 Encoder CSV 사용 가능)</span><Form.Control size="sm" type="file" accept=".csv,text/csv" disabled={busy} onChange={async e=>{const f=e.target.files?.[0];if(f)load(await f.text(),f.name);e.target.value='';}}/></label>
    <div className="mass-actions"><Button size="sm" variant="outline-secondary" disabled={busy} onClick={()=>{const text=syntheticCsv();load(text,'합성_200Hz_검증.csv');setSettings(c=>({...c,mass:0.03,radius:0.18,massUnit:'kg',radiusUnit:'m',target:'합성 검증',configuration:'I=0.035, c1=0.0017, c2=0.0006',timeUnit:'s',valueKind:'angle',angleUnit:'deg',timeColumn:'time',valueColumn:'angle',split:1.5,window:11,degree:2}));}}>합성 검증 데이터 불러오기</Button>{csv&&<Button size="sm" variant="outline-secondary" onClick={()=>download(csv.name,csv.text,'text/csv')}>원 CSV 내려받기</Button>}</div>
    {csv&&<>
      <p>{csv.name} · {csv.rows.length}행. TEL/IMU와 ENC는 독립 이벤트이며 분석은 ENC 행만 사용합니다.</p>
      <div className="mass-grid"><Choice label="시간 열 (장치 timestamp 우선)" value={settings.timeColumn} onChange={v=>{update('timeColumn',v);setConfirmed(false);}} options={csv.headers}/><Choice label="시간 단위 (직접 확인)" value={settings.timeUnit} onChange={v=>{update('timeUnit',v);setConfirmed(false);}} options={['s','ms','us']}/>
        <Choice label="원 관절 엔코더 각도 / 속도 열" value={settings.valueColumn} onChange={v=>{update('valueColumn',v);setConfirmed(false);}} options={['',...csv.headers]}/><Choice label="값 형식" value={settings.valueKind} onChange={v=>{update('valueKind',v);setConfirmed(false);}} options={[["angle","각도"],["velocity","각속도 (각도단위/s)"]]}/>
        <Choice label="각도 단위 / 속도 분자 단위" value={settings.angleUnit} onChange={v=>{update('angleUnit',v);setConfirmed(false);}} options={['deg','rad','count']}/><Choice label="측정 부호" value={settings.sign} onChange={v=>update('sign',Number(v))} options={[[1,'+1'],[-1,'−1']]}/>
        {settings.angleUnit==='count'&&<Field label="counts/revolution" value={settings.cpr} onChange={v=>update('cpr',v)}/>}
        <Field label="timer wrap 주기 (시간 열 단위, 선택)" value={settings.wrapPeriod} onChange={v=>update('wrapPeriod',v)}/></div>
      <div className="mass-table"><Table size="sm" variant="dark"><thead><tr><th>시간 원값</th><th>측정 원값</th><th>유형</th></tr></thead><tbody>{csv.rows.slice(0,5).map((r,i)=><tr key={i}><td>{r[settings.timeColumn]}</td><td>{r[settings.valueColumn]}</td><td>{r.sample_type||'각도/속도 CSV'}</td></tr>)}</tbody></Table></div>
      <Form.Check id="mass-csv-confirmed" label="선택 축의 실제 관절 원자료, 시간 단위·timer 의미·각도 부호를 확인했습니다" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
      <p className="mass-muted">표시용 Euler·visual flip, IMU body ω를 관절 원자료로 대체하지 마세요. quaternion만 있다면 선택축 각도 CSV를 추가 기록하세요. 장치 재시작·publisher 변경은 파일의 연속 구간을 나누어 분석하세요.</p>
    </>}
    <details open><summary>전처리·가속/감속 구간 설정</summary><div className="mass-grid">
      {Object.entries({window:'평활 창 [표본, 홀수 5~101]',degree:'국소 다항 차수 [2/3]',gapSeconds:'긴 결손 기준 [s]',split:'추 분리시각 [s, 빈칸=최대 |ω| 후보]',shock:'분리 양쪽 충격 제외 폭 [s]',lowSpeed:'저속 제외 |ω| [rad/s]',speedMin:'공통 |ω| 최소 [rad/s, 선택]',speedMax:'공통 |ω| 최대 [rad/s, 선택]',accStart:'가속 시작 [s, 선택]',accEnd:'가속 끝 [s, 선택]',decStart:'감속 시작 [s, 선택]',decEnd:'감속 끝 [s, 선택]'}).map(([k,l])=><Field key={k} label={l} value={settings[k]} disabled={busy} onChange={v=>update(k,v)}/>)}</div>
      <p className="mass-muted">unwrap → 불규칙 시각의 국소 다항 평활·미분 → 구간 분리 → 충격 제외 → 공통 |ω| 선택. 평활 창이 충격을 포함하지 않게 제외 폭을 정하세요.</p></details>
    <div className="mass-actions"><Button size="sm" disabled={busy||!csv||!confirmed} variant="outline-info" onClick={()=>run(true)}>전처리·구간 미리보기</Button><Button size="sm" disabled={busy||!csv||!confirmed} onClick={()=>run(false)}>관성·마찰 동시 피팅</Button>{busy&&<Button size="sm" variant="outline-warning" onClick={()=>{worker.current?.terminate();worker.current=null;setProgress(null);setError('분석을 취소했습니다.');}}>분석 취소</Button>}</div>
    {busy&&<ProgressBar now={progress} label={`${progress}%`} animated className="mb-2"/>}{error&&<Alert variant="danger" role="alert">{error}</Alert>}
    {prepared&&<>
      <p>실제 유효 {fmt(prepared.diagnostics.hz,2)} Hz · median {fmt(prepared.diagnostics.medianHz,2)} Hz<br/>dt 최소/중앙/최대 {fmt(prepared.diagnostics.dt.min,6)} / {fmt(prepared.diagnostics.dt.median,6)} / {fmt(prepared.diagnostics.dt.max,6)} s<br/>최대 |ω| 후보 {fmt(prepared.peakTime)} s · 결손 {prepared.diagnostics.gaps.length}개</p>
      <Warnings items={prepared.warnings}/>
      <Form.Check id="mass-click-split" label="속도 그래프 클릭으로 분리시각 지정" checked={clickSplit} onChange={e=>setClickSplit(e.target.checked)}/>
      {settings.valueKind==='angle'&&<SignalChart title="θ(t) [rad] · 원각도 unwrap / 평활" points={prepared.points} keys={[["theta","#94a3b8","unwrap θ"],["smooth","#38bdf8","평활 θ"]]} split={split} shock={Number(settings.shock)}/>}
      <SignalChart title="전처리 ω(t) [rad/s] · 노랑: 분리 후보와 충격 제외" points={prepared.points} keys={[["omega","#38bdf8","실측 ω"]]} split={split} shock={Number(settings.shock)} onSplit={clickSplit?v=>update('split',v):null}/>
    </>}
    {result&&<><div className="mass-result" data-testid="identification-result"><strong>{result.status}</strong><p>전체 회전 구성의 I = {fmt(result.parameters.I,8)} kg·m²<br/>c₁ = {fmt(result.parameters.c1,8)} N·m<br/>c₂ = {fmt(result.parameters.c2,8)} N·m·s/rad<br/>Tf(1 rad/s) = {fmt(result.frictionAt1*1000,6)} mN·m</p>
      <p>RMSE 가속/감속 {fmt(result.rmse.acc,7)} / {fmt(result.rmse.dec,7)} rad/s<br/>사용 표본 {result.counts.acc} / {result.counts.dec}<br/>공통 |ω| {result.speedRange.map(v=>fmt(v)).join(' ~ ')} rad/s<br/>최적화 수렴: 예 · 목적함수 ½(MSE가속+MSE감속)</p>
      {result.cadDifference!=null&&<p>CAD 대비 {fmt(result.cadDifference,3)}% (동일 축·원점·회전 구성 확인 기준)</p>}<Warnings items={result.warnings}/></div>
      <SignalChart title="선택된 가속·감속 실측 / 피팅 ω(t) [rad/s]" points={result.curve.map((p,i,a)=>({...p,fitAcc:p.phase==='acc'?p.fit:null,fitDec:p.phase==='dec'?p.fit:null,omegaAcc:p.phase==='acc'?p.omega:null,omegaDec:p.phase==='dec'?p.omega:null}))} keys={[["omegaAcc","#60a5fa","가속 실측"],["omegaDec","#c084fc","감속 실측"],["fitAcc","#34d399","가속 fit"],["fitDec","#fb923c","감속 fit"]]} split={result.segments.split} shock={result.segments.shock}/>
      <SignalChart title="실측 − 피팅 잔차 [rad/s] · 울렁임·각도 의존성 검토" points={result.curve} keys={[["residual","#f472b6","잔차"]]} split={result.segments.split} shock={result.segments.shock}/>
      <Button size="sm" variant="outline-info" onClick={()=>save(makeRecord('falling_mass',settings,{csv:csv.text,fileName:csv.name},result,{processing:settings}))}>원 CSV·설정·결과 함께 저장</Button>
    </>}
    <details><summary>CAD 비교·메모</summary><Field label="CAD 관성 [kg·m², 선택]" value={settings.cad} onChange={v=>update('cad',v)}/><Form.Check id="mass-cad-confirmed" label="CAD와 측정의 축·원점·함께 회전한 부품 구성이 일치함" checked={settings.cadConfirmed} onChange={e=>update('cadConfirmed',e.target.checked)}/><Field label="메모" type="text" value={settings.note} onChange={v=>update('note',v)}/><p className="mass-muted">측정 I는 전체 회전 구성의 관성입니다. 2D CG만으로 임의 축 평행축 보정을 할 수 없습니다.</p></details>
    <details><summary>모델·수치해법·과거 참고자료</summary>
      <p>τf=c₁sgn(ω)+c₂ω<br/>가속: (I+mR²)ω̇=s·mgR−c₁sgn(ω)−c₂ω<br/>자유감속: Iω̇=−c₁sgn(ω)−c₂ω</p>
      <p>I&gt;0, c₁,c₂≥0. 부호가 일정한 구간에서 ODE 해석해를 직접 피팅합니다. 구간별 초기속도는 독립적으로 variable projection으로 추정합니다. I는 log scale, 마찰은 mgR로 스케일링한 5개 초기값의 bounded Nelder–Mead를 사용합니다. 최대 600회/초기값, simplex 상대폭 1e−7 및 목적함수 폭 1e−12에서 수렴을 판정합니다. 전역 최적해·최종 정확도는 보장하지 않습니다.</p>
      <p className="mass-muted">과거 참고: 김형민 2026-06-08 PPT IYaw≈0.03547, Tf≈1.645mN·m. PPT 도표 CAD 0.02562와 본문 CAD 0.02899가 다릅니다. 논문 경진대회 발표는 IYaw=0.025652, CAD=0.02942입니다. 서로 다른 구성·출처이며 현재 정답으로 고정하지 않습니다. PPT 원시 시계열 재현 검증은 수행하지 않았습니다.</p>
    </details>
  </>;
}

function RecordsPanel({records,setRecords,saveError}) {
  const [preview,setPreview]=useState(null),[unit,setUnit]=useState(''),[error,setError]=useState(''),[selected,setSelected]=useState(null),[reason,setReason]=useState('');
  const groups=compareRecords(records);
  const updateExclusion=(record)=>{if(!record.excluded&&!reason.trim()){setError('제외 근거를 입력하세요.');return;}setRecords(records.map(r=>r.id===record.id?{...r,excluded:!r.excluded,exclusionReason:!r.excluded?reason:'',exclusionHistory:[...(r.exclusionHistory||[]),{at:new Date().toISOString(),excluded:!r.excluded,reason}]}:r));setError('');};
  const cgGroups={};records.filter(r=>r.method==='three_scale_cg'&&r.result&&r.target!=='미확인'&&r.configuration!=='미확인').forEach(r=>{const key=JSON.stringify([r.target,r.configuration,r.settings.width,r.settings.height,r.settings.supports.map(s=>[s.x,s.y])]);(cgGroups[key]??=[]).push(r);});
  return <>
    <p className="mass-muted">이 브라우저의 로컬 저장소에만 보관합니다. 원 CSV·설정·제외 이력을 JSON으로 백업하세요. 서버 공개 목록에 업로드하지 않습니다.</p>
    <Button size="sm" onClick={()=>download('cubli-mass-properties-v3.json',JSON.stringify({version:3,exportedAt:new Date().toISOString(),records},null,2))}>전체 JSON 내보내기 ({records.length})</Button>
    <label className="mass-field mt-3"><span>질량특성 JSON 가져오기</span><Form.Control size="sm" type="file" accept=".json,application/json" onChange={async e=>{try{const f=e.target.files?.[0];if(f){setPreview(previewImport(await f.text()));setUnit('');setError('');}}catch(e){setError(e.message);}e.target.value='';}}/></label>
    {preview&&<div className="mass-result"><strong>가져오기 미리보기 · {preview.count}개</strong>{preview.needsUnit&&<><p>version=2 원본·400mm 형상을 보존합니다. xG/yG는 중심 기준 mm입니다. 이름이 G인 필드도 단위를 추측하지 않습니다. 선택 단위는 원 증가하중에만 기록되며 plateMassG=4380 등은 별도 미확인으로 남습니다.</p><Choice label="과거 CG raw/net 질량 단위를 직접 확인" value={unit} onChange={setUnit} options={[["","단위 선택 필요"],["g","g로 확인"],["kg","kg로 확인"]]}/></>}
      <details><summary>원본 내용 확인</summary><pre>{preview.originalText}</pre></details><Button size="sm" disabled={preview.needsUnit&&!unit} onClick={()=>{try{const imported=importRecords(preview,unit);setRecords([...records,...imported.filter(r=>!records.some(old=>old.id===r.id))]);setPreview(null);setError('');}catch(e){setError(e.message);}}}>확인한 단위로 원본 보존 가져오기</Button></div>}
    {(error||saveError)&&<Alert variant="danger">{error||saveError}</Alert>}
    {groups.map(g=><div className="mass-result" key={g.key}><strong>{g.label}</strong><p>I 전체 n={g.all.n}, 평균 {fmt(g.all.mean,8)} → 포함 n={g.included.n}, 평균 {fmt(g.included.mean,8)} kg·m²<br/>포함 표본 SD {fmt(g.included.sd,8)} · CV {fmt(g.included.cv,3)}%<br/>c₁ 평균 {fmt(g.c1.mean,8)} N·m, c₂ 평균 {fmt(g.c2.mean,8)} N·m·s/rad<br/>Tf(1rad/s) 평균 {fmt(g.friction.mean,8)} N·m</p><small>n=1의 SD/CV는 미평가. CV는 반복성 지표이며 정확도·모델 타당성 증명이 아닙니다.</small></div>)}
    {Object.entries(cgGroups).map(([key,rs])=>{const x=stats(rs.filter(r=>!r.excluded).map(r=>r.result.dx)),y=stats(rs.filter(r=>!r.excluded).map(r=>r.result.dy));return <div className="mass-result" key={key}>CG {rs[0].target} / {rs[0].configuration} · n={x.n}<br/>dx 평균 {fmt(x.mean)} · SD {fmt(x.sd)} mm<br/>dy 평균 {fmt(y.mean)} · SD {fmt(y.sd)} mm</div>;})}
    <Field label="선택 기록을 통계에서 제외하는 근거 (자동 삭제 없음)" type="text" value={reason} onChange={setReason}/>
    <div className="mass-table"><Table size="sm" variant="dark"><thead><tr><th>기록</th><th>방법 / 품질</th><th>선택</th></tr></thead><tbody>{records.map((r,i)=><tr key={`${r.id}-${i}`}><td>{r.target||r.legacyRecord?.name||'과거 비교'}<br/><small>{r.createdAt}</small></td><td>{r.method}<br/>{r.excluded?'제외: '+r.exclusionReason:r.result?.status||r.quality||'보관됨'}</td><td><Button size="sm" variant="outline-info" onClick={()=>setSelected(r)}>열람</Button>{['falling_mass','three_scale_cg'].includes(r.method)&&<Button size="sm" variant="outline-secondary" onClick={()=>updateExclusion(r)}>{r.excluded?'다시 포함':'통계 제외'}</Button>}</td></tr>)}</tbody></Table></div>
    {selected&&<details open><summary>선택 기록 전체 (원자료·설정·품질 포함)</summary><div className="mass-actions"><Button size="sm" onClick={()=>download(`${selected.id}.json`,JSON.stringify({version:3,records:[selected]},null,2))}>선택 JSON</Button>{selected.raw?.csv&&<Button size="sm" onClick={()=>download(selected.raw.fileName||'raw.csv',selected.raw.csv,'text/csv')}>원 CSV</Button>}{selected.legacyArchive&&<Button size="sm" onClick={()=>download('legacy-original-v2.json',selected.legacyArchive.originalText)}>version=2 원본 재내보내기</Button>}</div><pre>{JSON.stringify(selected,null,2)}</pre></details>}
  </>;
}
export default function MassPropertiesPanel() {
  const [tab,setTab]=useState('cg'),[message,setMessage]=useState(''),[saveError,setSaveError]=useState('');
  const [records,setRecordState]=useState(()=>{try{const value=JSON.parse(localStorage.getItem(STORAGE)||'[]');return Array.isArray(value)?value:[];}catch{return [];}});
  const setRecords=value=>{try{localStorage.setItem(STORAGE,JSON.stringify(value));setRecordState(value);setSaveError('');return true;}catch{setSaveError('로컬 저장 용량이 부족하거나 저장이 차단되었습니다. 전체 JSON을 내려받아 백업하세요.');setRecordState(value);return false;}};
  const save=record=>{const ok=setRecords([...records,record]);setMessage(ok?'로컬 기록에 저장했습니다.':'메모리에만 보관 중입니다. 기록·비교에서 JSON을 내려받으세요.');};
  return <section className="mass-panel" aria-label="질량특성 분석"><ButtonGroup size="sm" className="mass-subnav">{[['cg','CG 측정'],['inertia','관성·마찰 식별'],['records','기록·비교']].map(([k,l])=><Button key={k} variant={tab===k?'info':'outline-info'} onClick={()=>{setTab(k);setMessage('');}}>{l}</Button>)}</ButtonGroup>
    {message&&<Alert variant="info" dismissible onClose={()=>setMessage('')}>{message}</Alert>}
    {saveError&&tab!=='records'&&<Alert variant="danger">{saveError}</Alert>}
    <div hidden={tab!=='cg'}><CgPanel save={save}/></div><div hidden={tab!=='inertia'}><IdentificationPanel save={save}/></div>{tab==='records'&&<RecordsPanel records={records} setRecords={setRecords} saveError={saveError}/>}
  </section>;
}
