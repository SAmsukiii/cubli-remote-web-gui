import {number,positive,unitFactor} from './cg';

export const defaultIdentification=()=>({target:'',configuration:'',axis:'Yaw',fixedAxes:'Roll/Pitch 고정',mass:'',massUnit:'kg',radius:'',radiusUnit:'m',gravity:9.80665,direction:1,
  timeColumn:'',valueColumn:'',timeUnit:'s',valueKind:'angle',angleUnit:'deg',cpr:'',sign:1,wrapPeriod:'',
  window:11,degree:2,gapSeconds:0.25,split:'',shock:0.1,lowSpeed:0.05,speedMin:'',speedMax:'',
  accStart:'',accEnd:'',decStart:'',decEnd:'',cad:'',cadConfirmed:false,note:''});

export function parseCsv(text) {
  const rows=[];let row=[],cell='',quoted=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') {if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw new Error('CSV 따옴표가 닫히지 않았습니다.');
  if(cell||row.length){row.push(cell);rows.push(row);}
  if(rows.length<2)throw new Error('CSV 헤더와 데이터가 필요합니다.');
  if(rows.length>100001)throw new Error('한 번에 100,000행까지 분석할 수 있습니다. 연속 실험 구간으로 파일을 나누세요.');
  const headers=rows.shift().map(h=>h.trim());
  if(new Set(headers).size!==headers.length)throw new Error('중복 CSV 열 이름을 확인하세요.');
  return {headers,rows:rows.map((r,i)=>{if(r.length!==headers.length)throw new Error(`CSV ${i+2}행 열 개수가 다릅니다.`);return Object.fromEntries(headers.map((h,j)=>[h,r[j]]));})};
}
export function suggestColumns(headers,axis='Yaw') {
  const a={Roll:'x',Pitch:'y',Yaw:'z'}[axis];
  return {timeColumn:[`enc_timer_${a}`,'remote_timestamp_us','remote_timestamp','time','t','plot_time_ms'].find(h=>headers.includes(h))||headers[0],
    valueColumn:[`enc_${a}_deg`,'angle','theta','omega'].find(h=>headers.includes(h))||'',
  };
}
function solve(matrix,rhs) {
  const n=rhs.length,a=matrix.map((r,i)=>[...r,rhs[i]]);
  for(let j=0;j<n;j++) {
    let pivot=j;for(let i=j+1;i<n;i++)if(Math.abs(a[i][j])>Math.abs(a[pivot][j]))pivot=i;
    if(Math.abs(a[pivot][j])<1e-13)throw new Error('회귀 행렬이 특이합니다. 속도 범위와 표본을 확인하세요.');
    [a[j],a[pivot]]=[a[pivot],a[j]];const d=a[j][j];for(let k=j;k<=n;k++)a[j][k]/=d;
    for(let i=0;i<n;i++)if(i!==j){const f=a[i][j];for(let k=j;k<=n;k++)a[i][k]-=f*a[j][k];}
  }
  return a.map(r=>r[n]);
}
const median=v=>{const a=[...v].sort((a,b)=>a-b);return a[Math.floor(a.length/2)];};
const optional=(v,fallback,label)=>v===''||v==null?fallback:number(v,label);
export function preprocess(rows,cfg) {
  const tf=unitFactor(cfg.timeUnit,'time');
  const vf=cfg.angleUnit==='count'?2*Math.PI/positive(cfg.cpr,'counts/revolution'):unitFactor(cfg.angleUnit,'angle');
  const sign=number(cfg.sign,'각도 부호');if(![1,-1].includes(sign))throw new Error('각도 부호는 ±1입니다.');
  if(!['angle','velocity'].includes(cfg.valueKind))throw new Error('각도/각속도 형식을 확인하세요.');
  const diagnostics={inputRows:rows.length,otherEvents:0,missing:0,duplicates:0,wraps:0,gaps:[],clock:cfg.timeColumn};
  let shift=0,previousRaw=null,previousTime=null,source=null;
  const wrap=optional(cfg.wrapPeriod,0,'timer wrap 주기')*tf;
  const points=[];
  for(let i=0;i<rows.length;i++) {
    const r=rows[i];
    if(r.sample_type&&r.sample_type.toUpperCase()!=='ENC'){diagnostics.otherEvents++;continue;}
    if(r[cfg.timeColumn]===''||r[cfg.valueColumn]===''||r[cfg.timeColumn]==null||r[cfg.valueColumn]==null){diagnostics.missing++;continue;}
    const raw=number(r[cfg.timeColumn],`${i+2}행 시간`)*tf;
    const value=number(r[cfg.valueColumn],`${i+2}행 각도/속도`)*vf*sign;
    const identity=[r.publisher_id||r.publisherId||'',r.source||''].join('/');
    if(source!=null&&source!==identity)throw new Error('publisher/source 변경이 있습니다. 같은 장치의 연속 기록만 선택하세요.');source=identity;
    if(previousRaw!=null&&raw<previousRaw){
      if(wrap>0&&previousRaw>wrap*0.75&&raw<wrap*0.25){shift+=wrap;diagnostics.wraps++;}
      else throw new Error(`${i+2}행: timestamp 역전/장치 재시작. 연속 구간 CSV로 분리하세요.`);
    }
    const t=raw+shift;
    if(previousTime===t){diagnostics.duplicates++;continue;}
    points.push({t,value,row:i+2});previousTime=t;previousRaw=raw;
  }
  if(points.length<12)throw new Error('유효 ENC 표본이 12개 미만입니다. 기존 Encoder CSV 원자료를 가져오세요.');
  const origin=points[0].t;points.forEach(p=>{p.t-=origin;});
  const dt=points.slice(1).map((p,i)=>p.t-points[i].t),med=median(dt);
  const gap=positive(cfg.gapSeconds,'결손 한계');
  const gapLimit=Math.max(gap,med*5);
  dt.forEach((d,i)=>{if(d>gapLimit)diagnostics.gaps.push({start:points[i].t,end:points[i+1].t,seconds:d});});
  diagnostics.hz=(points.length-1)/(points[points.length-1].t-points[0].t);diagnostics.medianHz=1/med;
  diagnostics.dt={min:Math.min(...dt),median:med,max:Math.max(...dt)};
  let unwrap=0;
  points.forEach((p,i)=>{if(cfg.valueKind==='angle'&&i){const d=p.value-points[i-1].value;
    if(!Number.isFinite(d))throw new Error('각도 변화량이 유한하지 않습니다. 단위와 범위를 확인하세요.');
    if(d>Math.PI)unwrap-=Math.ceil((d-Math.PI)/(2*Math.PI))*2*Math.PI;
    else if(d< -Math.PI)unwrap+=Math.ceil((-Math.PI-d)/(2*Math.PI))*2*Math.PI;
  }
    p.theta=cfg.valueKind==='angle'?p.value+unwrap:null;
  });
  const window=number(cfg.window,'평활 창'),degree=number(cfg.degree,'다항 차수');
  if(!Number.isInteger(window)||window<5||window>101||window%2!==1||![2,3].includes(degree)||window<=degree)throw new Error('평활 창은 5~101의 홀수, 차수는 2 또는 3을 사용하세요.');
  const half=(window-1)/2;
  const processed=points.map((p,i)=>{
    const local=points.slice(Math.max(0,i-half),Math.min(points.length,i+half+1));
    const crosses=diagnostics.gaps.some(g=>local[0].t<g.end&&local[local.length-1].t>g.start);
    if(crosses||local.length<=degree)return {...p,omega:null};
    const scale=Math.max(med,local[local.length-1].t-local[0].t);
    const A=Array.from({length:degree+1},()=>Array(degree+1).fill(0)),b=Array(degree+1).fill(0);
    local.forEach(q=>{const u=(q.t-p.t)/scale,y=cfg.valueKind==='angle'?q.theta:q.value;
      for(let j=0;j<=degree;j++){b[j]+=u**j*y;for(let k=0;k<=degree;k++)A[j][k]+=u**(j+k);}});
    const beta=solve(A,b);
    return {...p,smooth:beta[0],omega:cfg.valueKind==='angle'?beta[1]/scale:beta[0]};
  });
  const finite=processed.filter(p=>p.omega!=null);
  const peak=finite.reduce((a,b)=>Math.abs(a.omega)>Math.abs(b.omega)?a:b);
  const warnings=[];
  if(diagnostics.hz<150)warnings.push(`실제 유효 취득률 ${diagnostics.hz.toFixed(1)}Hz. PPT 약 200Hz보다 낮아 분해능·시간상수·대역 검토 필요.`);
  if(diagnostics.gaps.length)warnings.push(`긴 결손 ${diagnostics.gaps.length}개. 해당 구간과 평활 창을 보간하지 않고 제외했습니다.`);
  if(diagnostics.missing||diagnostics.duplicates)warnings.push(`빈 표본 ${diagnostics.missing}, 중복 timestamp ${diagnostics.duplicates}개 제외. 원 CSV는 보존됩니다.`);
  if(cfg.timeColumn==='plot_time_ms')warnings.push('브라우저 plot 시간축입니다. 장치 취득시각과 실제 취득률을 별도 검증하세요.');
  if(!rows.some(r=>r.publisher_id||r.publisherId))warnings.push('CSV에 publisher ID가 없습니다. source 변화만 검사하며 같은 장치·publisher의 연속 실험인지 직접 확인해야 합니다.');
  return {points:processed,diagnostics,warnings,peakTime:peak.t};
}

export function selectSegments(prepared,cfg) {
  const split=optional(cfg.split,prepared.peakTime,'분리시각'),shock=number(cfg.shock,'충격 제외 폭'),low=number(cfg.lowSpeed,'저속 한계');
  if(shock<0||low<0)throw new Error('제외 폭과 저속 한계는 음수일 수 없습니다.');
  const end=prepared.points[prepared.points.length-1].t;
  const ranges={acc:[optional(cfg.accStart,0,'가속 시작'),Math.min(optional(cfg.accEnd,split-shock,'가속 끝'),split-shock)],
    dec:[Math.max(optional(cfg.decStart,split+shock,'감속 시작'),split+shock),optional(cfg.decEnd,end,'감속 끝')]};
  let acc=prepared.points.filter(p=>p.omega!=null&&p.t>=ranges.acc[0]&&p.t<=ranges.acc[1]&&Math.abs(p.omega)>low);
  let dec=prepared.points.filter(p=>p.omega!=null&&p.t>=ranges.dec[0]&&p.t<=ranges.dec[1]&&Math.abs(p.omega)>low);
  if(acc.length<6||dec.length<6)throw new Error('가속·자유감속 각각 6개 이상 표본이 필요합니다. 자유감속만으로는 c₁/I, c₂/I만 식별 가능합니다.');
  const signs=new Set([...acc,...dec].map(p=>Math.sign(p.omega)));
  if(signs.size!==1)throw new Error('정지/역회전으로 마찰부호가 바뀝니다. 단일 방향 구간을 선택하세요.');
  const q=Math.sign(acc[0].omega);
  const min=Math.max(low,Math.min(...acc.map(p=>Math.abs(p.omega))),Math.min(...dec.map(p=>Math.abs(p.omega))),optional(cfg.speedMin,0,'최소 속도'));
  const max=Math.min(Math.max(...acc.map(p=>Math.abs(p.omega))),Math.max(...dec.map(p=>Math.abs(p.omega))),optional(cfg.speedMax,Infinity,'최대 속도'));
  if(max<=min)throw new Error('가속/감속의 공통 |ω| 범위가 없습니다.');
  const inRange=p=>Math.abs(p.omega)>=min&&Math.abs(p.omega)<=max;
  acc=acc.filter(inRange);dec=dec.filter(inRange);
  for(const [label,ps] of [['가속',acc],['감속',dec]]) {
    if(ps.length<6)throw new Error(`${label}: 공통속도 선택 후 표본이 6개 미만입니다.`);
    if(prepared.diagnostics.gaps.some(g=>ps[0].t<g.start&&ps[ps.length-1].t>g.end))throw new Error(`${label} 구간이 긴 결손을 가로지릅니다. 구간 시작/끝을 수정하세요.`);
    if(ps[ps.length-1].t-ps[0].t<=0)throw new Error('구간 길이가 0입니다.');
  }
  if(q*(acc[acc.length-1].omega-acc[0].omega)<=0||q*(dec[dec.length-1].omega-dec[0].omega)>=0)throw new Error('가속 증가·감속 감소 조건을 확인하세요. 분리 후보와 구간을 수정하세요.');
  return {acc,dec,q,min,max,split,shock,ranges};
}
export function physics(cfg) {
  const m=positive(cfg.mass,'낙하추 질량')*unitFactor(cfg.massUnit,'mass');
  const R=positive(cfg.radius,'유효 반경')*unitFactor(cfg.radiusUnit,'length');
  const g=positive(cfg.gravity,'중력가속도'),s=number(cfg.direction,'토크 부호');
  if(![1,-1].includes(s))throw new Error('토크 부호는 ±1입니다.');
  if(!Number.isFinite(m*g*R)||!Number.isFinite(m*R*R))throw new Error('질량·반경 범위를 확인하세요.');
  return {m,R,g,s,torque:m*g*R,addedInertia:m*R*R};
}
export function odeVelocity(t,w0,p,physical,accelerating) {
  const q=Math.sign(w0)||physical.s,J=p.I+(accelerating?physical.addedInertia:0);
  const A=((accelerating?physical.s*q*physical.torque:0)-p.c1)/J,B=p.c2/J;
  const v=B<1e-12?Math.abs(w0)+A*t:Math.abs(w0)*Math.exp(-B*t)+A*(-Math.expm1(-B*t))/B;
  return q*Math.max(0,v);
}
function segmentFit(points,p,ph,acc,q) {
  const J=p.I+(acc?ph.addedInertia:0),A=((acc?ph.s*q*ph.torque:0)-p.c1)/J,B=p.c2/J,t0=points[0].t;
  let numerator=0,denominator=0;
  const basis=points.map(pt=>{const t=pt.t-t0,e=Math.exp(-B*t),b=B<1e-12?A*t:A*(-Math.expm1(-B*t))/B;
    numerator+=e*(q*pt.omega-b);denominator+=e*e;return {e,b};});
  const v0=Math.max(0,numerator/denominator);
  const fitted=basis.map(b=>q*Math.max(0,v0*b.e+b.b));
  return {fitted,w0:q*v0,mse:fitted.reduce((sum,v,i)=>sum+(v-points[i].omega)**2,0)/points.length};
}
function nm(fn,start,maxIter=600) {
  const bound=v=>[Math.max(-14,Math.min(7,v[0])),Math.max(0,Math.min(1e5,v[1])),Math.max(0,Math.min(1e5,v[2]))];
  let simplex=[start,...start.map((_,j)=>start.map((v,k)=>k===j?v+(j===0?0.25:Math.max(0.1,Math.abs(v)*0.25)):v))].map(x=>({x:bound(x),f:fn(bound(x))}));
  let iterations=0,converged=false;
  for(;iterations<maxIter;iterations++) {
    simplex.sort((a,b)=>a.f-b.f);
    const ranked=simplex,bestX=[...ranked[0].x],worstX=[...ranked[3].x];
    const spread=Math.max(...ranked.slice(1).map(p=>Math.max(...p.x.map((v,j)=>Math.abs(v-bestX[j])/(1+Math.abs(v))))));
    if(spread<1e-7&&Math.abs(simplex[3].f-simplex[0].f)<1e-12){converged=true;break;}
    const c=[0,1,2].map(j=>(ranked[0].x[j]+ranked[1].x[j]+ranked[2].x[j])/3);
    const test=f=>{const x=bound(c.map((v,j)=>v+f*(c[j]-worstX[j])));return {x,f:fn(x)};};
    const r=test(1);
    if(r.f<simplex[0].f){const e=test(2);simplex[3]=e.f<r.f?e:r;}
    else if(r.f<simplex[2].f)simplex[3]=r;
    else {const k=test(r.f<simplex[3].f?0.5:-0.5);if(k.f<Math.min(r.f,simplex[3].f))simplex[3]=k;
      else simplex=ranked.map((p,i)=>{if(i===0)return p;const x=bound(p.x.map((v,j)=>(v+bestX[j])/2));return {x,f:fn(x)};});}
  }
  simplex.sort((a,b)=>a.f-b.f);return {...simplex[0],iterations,converged};
}
export function fitIdentification(prepared,cfg,onProgress=()=>{}) {
  const segments=selectSegments(prepared,cfg),ph=physics(cfg),{acc,dec,q}=segments;
  const da=q*(acc[acc.length-1].omega-acc[0].omega)/(acc[acc.length-1].t-acc[0].t);
  const dd=-q*(dec[dec.length-1].omega-dec[0].omega)/(dec[dec.length-1].t-dec[0].t);
  const I0=Math.max(1e-7,(q*ph.s*ph.torque-ph.addedInertia*da)/(da+dd));
  const torqueScale=ph.torque;
  const decode=x=>({I:I0*Math.exp(x[0]),c1:x[1]*torqueScale,c2:x[2]*torqueScale});
  const fn=x=>{const p=decode(x);return (segmentFit(acc,p,ph,true,q).mse+segmentFit(dec,p,ph,false,q).mse)/2;};
  const starts=[[0,Math.max(0,I0*dd/torqueScale),0.01],[Math.log(0.3),0.03,0.1],[Math.log(3),0.3,0],[0,0,0.5],[0,0.8,0.001]];
  const candidates=starts.map((start,i)=>{onProgress({stage:'fit',progress:15+Math.round(i/starts.length*75)});return nm(fn,start);}).sort((a,b)=>a.f-b.f);
  const best=candidates.find(c=>c.converged)||candidates[0],parameters=decode(best.x);
  if(!best.converged||!Number.isFinite(best.f))throw new Error('최적화 수렴 실패. 입력·구간·모델 적합성을 확인하세요.');
  const af=segmentFit(acc,parameters,ph,true,q),df=segmentFit(dec,parameters,ph,false,q);
  const warnings=[...prepared.warnings];
  if(cfg.axis!=='Yaw')warnings.push('Roll/Pitch: 중력 복원토크·축 결합을 포함하지 않은 탐색 결과입니다. 신뢰 결과로 확정할 수 없습니다.');
  if(segments.max-segments.min<Math.max(0.1,0.2*segments.max))warnings.push('공통속도 범위가 좁습니다. c₁/c₂ 분리와 식별성이 약할 수 있습니다.');
  if(parameters.c2<1e-5*torqueScale)warnings.push('c₂가 비음수 경계 근처입니다. 0 고정 결과가 아니며 작은 점성항의 분리 한계를 검토하세요.');
  if(parameters.c1<1e-5*torqueScale)warnings.push('c₁이 비음수 경계 근처입니다.');
  const comparable=candidates.filter(c=>c.converged&&c.f<=best.f*1.01+1e-10);
  const sensitivity=comparable.map(c=>decode(c.x));
  if(sensitivity.some(p=>Math.abs(p.I/parameters.I-1)>0.1))warnings.push('초기값별 유사 목적함수에서 I가 달라 식별성이 약합니다.');
  const rmse={acc:Math.sqrt(af.mse),dec:Math.sqrt(df.mse)};
  if(Math.max(rmse.acc,rmse.dec)>0.1*(segments.max-segments.min))warnings.push('잔차가 공통속도 폭의 10%를 넘습니다. 중력·베어링·케이블 외란과 정렬을 확인하세요.');
  // Finite-difference curvature after projecting independent initial conditions.
  const eps=1e-3,derivatives=[0,1,2].map(j=>{const hi=[...best.x],lo=[...best.x];hi[j]+=eps;lo[j]=j===0?lo[j]-eps:Math.max(0,lo[j]-eps);
    const response=x=>{const p=decode(x);return [...segmentFit(acc,p,ph,true,q).fitted.map(v=>v/Math.sqrt(acc.length)),...segmentFit(dec,p,ph,false,q).fitted.map(v=>v/Math.sqrt(dec.length))];};
    const h=response(hi),l=response(lo);return h.map((v,i)=>(v-l[i])/(hi[j]-lo[j]));});
  const correlations=[];
  for(let j=0;j<3;j++)for(let k=j+1;k<3;k++){
    const norm=Math.hypot(...derivatives[j])*Math.hypot(...derivatives[k]);
    correlations.push(norm?Math.abs(derivatives[j].reduce((s,v,i)=>s+v*derivatives[k][i],0)/norm):1);
  }
  if(Math.max(...correlations)>0.995)warnings.push('파라미터 민감도가 강하게 상관되어 식별성이 약합니다. 더 넓은 속도 범위와 반복 실험이 필요합니다.');
  const curve=[...acc.map((p,i)=>({...p,phase:'acc',fit:af.fitted[i],residual:p.omega-af.fitted[i]})),...dec.map((p,i)=>({...p,phase:'dec',fit:df.fitted[i],residual:p.omega-df.fitted[i]}))];
  return {parameters,frictionAt1:parameters.c1+parameters.c2,rmse,counts:{acc:acc.length,dec:dec.length},
    speedRange:[segments.min,segments.max],diagnostics:prepared.diagnostics,segments:{split:segments.split,shock:segments.shock,ranges:segments.ranges},
    curve,warnings,status:cfg.axis==='Yaw'?(warnings.length?'검토 필요':'수렴 · 실험 검증 필요'):'모델 미검증 (Roll/Pitch)',
    solver:{method:'scaled bounded Nelder-Mead, 5 starts',objective:'0.5 × (MSE_acc + MSE_dec)',iterations:best.iterations,converged:true,
      maxIterationsPerStart:600,tolerance:{simplex:1e-7,objectiveSpread:1e-12},initialConditions:{method:'segment-wise variable projection',acc:af.w0,dec:df.w0},
      candidates:candidates.map(c=>({objective:c.f,converged:c.converged,parameters:decode(c.x)})),sensitivityCorrelations:correlations},
    physical:ph,cadDifference:cfg.cadConfirmed&&cfg.cad!==''?(parameters.I-positive(cfg.cad,'CAD 관성'))/Number(cfg.cad)*100:null};
}
export function syntheticCsv(direction=1) {
  const physical={m:0.03,R:0.18,g:9.80665,s:direction,torque:0.03*9.80665*0.18,addedInertia:0.03*0.18**2};
  const parameters={I:0.035,c1:0.0017,c2:0.0006},split=1.5,dt=0.005;
  const peak=odeVelocity(split,direction*0.15,parameters,physical,true);
  let theta=0,prev=direction*0.15;const rows=['time,angle,omega'];
  for(let i=0;i<=6000;i++){const t=i*dt,w=t<=split?odeVelocity(t,direction*0.15,parameters,physical,true):odeVelocity(t-split,peak,parameters,physical,false);if(w===0)break;theta+=(prev+w)*dt/2;prev=w;rows.push(`${t},${theta*180/Math.PI},${w}`);}
  return rows.join('\n');
}
