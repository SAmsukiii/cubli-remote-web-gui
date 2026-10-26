export const CALCULATION_VERSION = 'cubli-mass-3.0';
export const defaultCg = () => ({
  width: 200, height: 200, thickness: 1, density: 2700, mode: 'tare', unit: 'g',
  supportsConfirmed: false, errorValidated: false, target: '', configuration: '', note: '',
  cubli: { width: '', height: '', x: '', y: '', angle: '', mass: '' },
  supports: [[20,20],[180,20],[100,180]].map(([x,y],i) => ({
    x,y,id:`P${i+1}`,net:'',baseline:'',gross:'',capacityG:'',epsilonG:'',sigmaG:'',gain:1,offsetG:0,
  })),
});
export function number(value, label) {
  if (value === '' || value == null || typeof value === 'boolean' || !Number.isFinite(Number(value))) throw new Error(`${label}: 유한한 숫자를 입력하세요.`);
  return Number(value);
}
export function positive(value,label) {
  const n=number(value,label); if(n<=0) throw new Error(`${label}: 0보다 커야 합니다.`); return n;
}
export function unitFactor(unit, kind) {
  const tables={mass:{g:0.001,kg:1},length:{mm:0.001,m:1},time:{s:1,ms:0.001,us:0.000001},angle:{rad:1,deg:Math.PI/180}};
  const factor=tables[kind]?.[unit]; if(!factor) throw new Error(`지원하지 않는 ${kind} 단위: ${unit}`); return factor;
}
export const plateMassG = c => positive(c.width,'판 가로')*positive(c.height,'판 세로')*positive(c.thickness,'판 두께')*positive(c.density,'밀도')/1e6;
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
export function insideTriangle(p, points) {
  const v=points.map((a,i)=>cross(a,points[(i+1)%3],p));
  return v.every(x=>x>=-1e-8)||v.every(x=>x<=1e-8);
}
export function calculateCg(config) {
  const width=positive(config.width,'판 가로'),height=positive(config.height,'판 세로');
  if(!['tare','difference'].includes(config.mode)) throw new Error('입력 모드를 확인하세요.');
  if(config.supports?.length!==3) throw new Error('지지점은 3개여야 합니다.');
  const f=unitFactor(config.unit,'mass')*1000;
  const points=config.supports.map((s,i)=>{
    const x=number(s.x,`P${i+1} x`),y=number(s.y,`P${i+1} y`);
    if(x<0||x>width||y<0||y>height) throw new Error(`P${i+1}: 지지점이 판 밖입니다.`);
    return {x,y};
  });
  if(!Number.isFinite(cross(...points))||Math.abs(cross(...points))<1e-7) throw new Error('지지점 형상이 유효하지 않거나 일직선입니다.');
  const warnings=[];
  const loads=config.supports.map((s,i)=>{
    const a=positive(s.gain??1,`P${i+1} 보정 gain`),b=number(s.offsetG??0,`P${i+1} offset`);
    const baseline=s.baseline===''||s.baseline==null?null:number(s.baseline,'baseline')*f;
    if(baseline!=null&&baseline<0) throw new Error('baseline은 음수일 수 없습니다.');
    if(config.mode==='difference'&&baseline==null) throw new Error(`P${i+1}: baseline이 필요합니다.`);
    const grossRaw=config.mode==='difference'?number(s.gross,'gross')*f:baseline==null?null:baseline+number(s.net,'증가하중')*f;
    if(grossRaw!=null&&grossRaw<0) throw new Error('gross 하중은 음수일 수 없습니다.');
    const net=config.mode==='tare'?a*number(s.net,'증가하중')*f:a*(grossRaw-baseline);
    const gross=grossRaw==null?null:a*grossRaw+b;
    const capacity=s.capacityG===''||s.capacityG==null?null:positive(s.capacityG,'저울 용량');
    const capacityStatus=gross==null||capacity==null?'미확인':gross>capacity?'초과':'범위 내';
    if(!Number.isFinite(net)||(gross!=null&&!Number.isFinite(gross)))throw new Error('보정 후 하중이 유한하지 않습니다.');
    if(net<0) warnings.push(`P${i+1}: 음수 증가하중. 전체 gross 반력과 설치상태를 검토하세요.`);
    if(gross!=null&&gross<0)warnings.push(`P${i+1}: 보정된 gross가 음수입니다. 보정 상태를 검토하세요.`);
    if(capacityStatus==='초과') warnings.push(`P${i+1}: 실제 gross 하중이 저울 용량을 초과합니다.`);
    return {netG:net,grossG:gross,capacityStatus};
  });
  const massG=loads.reduce((s,l)=>s+l.netG,0);
  if(!Number.isFinite(massG)||massG<=0) throw new Error('총 시험체 질량은 유한하며 0보다 커야 합니다.');
  const coordinate=(r,key)=>r.reduce((s,v,i)=>s+v*points[i][key],0)/r.reduce((a,b)=>a+b,0);
  const r=loads.map(l=>l.netG),x=coordinate(r,'x'),y=coordinate(r,'y');
  const result={massKg:massG/1000,massG,x,y,dx:x-width/2,dy:y-height/2,loads,
    insidePlate:x>=0&&x<=width&&y>=0&&y<=height,insideTriangle:insideTriangle({x,y},points),
    stability:'미평가: 상판·지지물·시험체 전체 CG와 실제 반력 검토 필요',warnings,
    uncertainty:{target:'판정 불가',scope:'저울오차만 고려. 좌표·설치·TARE 안정성·편심·판 처짐 미평가'},
  };
  const nonnegative=(value,label)=>{const n=number(value,label);if(n<0)throw new Error(`${label}: 음수 불가`);return n;};
  const hasE=config.supports.every(s=>s.epsilonG!==''&&s.epsilonG!=null);
  const hasS=config.supports.every(s=>s.sigmaG!==''&&s.sigmaG!=null);
  if(hasE) {
    const e=config.supports.map(s=>nonnegative(s.epsilonG,'차동 bounded 오차'));
    result.uncertainty.linearX=e.reduce((sum,v,i)=>sum+Math.abs((points[i].x-x)/massG)*v,0);
    result.uncertainty.linearY=e.reduce((sum,v,i)=>sum+Math.abs((points[i].y-y)/massG)*v,0);
    if(massG-e.reduce((a,b)=>a+b,0)<=0) {
      warnings.push('M−Σε ≤ 0: bounded CG 분모가 비양수일 수 있어 오차 상한을 계산할 수 없습니다.');
    } else {
      const corners=Array.from({length:8},(_,k)=>{const rr=r.map((v,i)=>v+((k>>i)&1?1:-1)*e[i]);return {signs:r.map((_,i)=>(k>>i)&1?1:-1),x:coordinate(rr,'x'),y:coordinate(rr,'y')};});
      result.uncertainty.corners=corners;
      result.uncertainty.exactX=Math.max(...corners.map(p=>Math.abs(p.x-x)));
      result.uncertainty.exactY=Math.max(...corners.map(p=>Math.abs(p.y-y)));
      if(config.errorValidated&&config.supportsConfirmed) result.uncertainty.target=result.uncertainty.exactX<=1&&result.uncertainty.exactY<=1?'저울오차 예산 내 ±1mm (최종 정확도 미확정)':'저울오차 예산 ±1mm 초과';
    }
  }
  if(hasS) {
    const s=config.supports.map(v=>nonnegative(v.sigmaG,'차동 표준불확도'));
    result.uncertainty.rssX=Math.hypot(...s.map((v,i)=>(points[i].x-x)/massG*v));
    result.uncertainty.rssY=Math.hypot(...s.map((v,i)=>(points[i].y-y)/massG*v));
  }
  return result;
}
