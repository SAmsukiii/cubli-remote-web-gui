import {calculateCg,defaultCg,plateMassG} from './cg';
import {defaultIdentification,parseCsv,preprocess,physics,odeVelocity,fitIdentification,selectSegments,syntheticCsv} from './identification';
import {previewImport,importRecords,stats,compareRecords} from './records';
const cg=(values=[248,248,496],extra={})=>{const c={...defaultCg(),...extra};c.supports=c.supports.map((s,i)=>({...s,net:values[i]}));return c;};
const settings=()=>({...defaultIdentification(),mass:0.03,radius:0.18,timeColumn:'time',valueColumn:'omega',timeUnit:'s',angleUnit:'rad',valueKind:'velocity',split:1.5,window:5,degree:2});
function sample(p={I:0.035,c1:0.0017,c2:0.0006},opts={}) {
  const c={...settings(),...opts},ph=physics(c),split=1.5,sign=c.direction,peak=odeVelocity(split,sign*0.15,p,ph,true);
  const rows=[];let theta=0,prev=sign*0.15;
  for(let i=0;i<=4000;i++) {
    const t=i*0.005+(opts.irregular?0.0006*Math.sin(i*0.7):0);
    const w=t<=split?odeVelocity(t,sign*0.15,p,ph,true):odeVelocity(t-split,peak,p,ph,false);
    if(w===0)break;theta+=(w+prev)*0.005/2;prev=w;
    const noise=opts.noise?opts.noise*(Math.sin(i*1.7)+Math.sin(i*0.31))/2:0;
    rows.push({time:t,omega:w+noise,angle:theta});
  }
  return {c,rows,ph};
}
describe('3점 CG',()=>{
  test('200×200×1 mm aluminium is 108g theoretical',()=>expect(plateMassG(defaultCg())).toBe(108));
  test('centered 992g object',()=>{const r=calculateCg(cg());expect(r.massG).toBe(992);expect([r.x,r.y,r.dx,r.dy]).toEqual([100,100,0,0]);});
  test('offset 10,-5 is valid, not a measurement failure',()=>{const r=calculateCg(cg([201.5,325.5,465]));expect([r.x,r.y,r.dx,r.dy]).toEqual([110,95,10,-5]);expect(r.insideTriangle).toBe(true);});
  test('kg equivalence',()=>{const r=calculateCg(cg([0.2015,0.3255,0.465],{unit:'kg'}));expect(r.x).toBeCloseTo(110,10);expect(r.y).toBeCloseTo(95,10);});
  test('TARE and difference are equivalent, offset cancels, no plate subtraction',()=>{const c=cg();c.mode='difference';c.supports=c.supports.map((s,i)=>({...s,baseline:[27,27,54][i],gross:[275,275,550][i],offsetG:80}));expect(calculateCg(c).massG).toBe(992);expect(calculateCg(c).dx).toBe(0);c.mode='tare';expect(calculateCg(c).massG).toBe(992);});
  test('capacity uses gross and missing baseline is unknown',()=>{const c=cg();c.supports=c.supports.map(s=>({...s,capacityG:260}));expect(calculateCg(c).loads[0].capacityStatus).toBe('미확인');c.supports[0].baseline=27;expect(calculateCg(c).loads[0].capacityStatus).toBe('초과');});
  test.each(['',NaN,Infinity])('invalid mass %s',v=>{const c=cg();c.supports[0].net=v;expect(()=>calculateCg(c)).toThrow();});
  test.each(['lb','unknown'])('unsupported unit %s',unit=>expect(()=>calculateCg(cg(undefined,{unit}))).toThrow());
  test('nonpositive denominator',()=>expect(()=>calculateCg(cg([0,0,0]))).toThrow());
  test('negative loads retained, triangle classification distinct from tipping',()=>{const r=calculateCg(cg([-50,500,100]));expect(r.loads[0].netG).toBe(-50);expect(r.insideTriangle).toBe(false);expect(r.stability).toContain('미평가');});
  test('collinear and outside supports rejected',()=>{const c=cg();c.supports[2].y=20;expect(()=>calculateCg(c)).toThrow();c.supports[2].y=201;expect(()=>calculateCg(c)).toThrow();});
  test('editing plate changes origin center',()=>{const r=calculateCg(cg(undefined,{width:220}));expect(r.dx).toBe(-10);});
  test('8 signs exact worst case and RSS kept distinct',()=>{const c=cg();c.errorValidated=true;c.supportsConfirmed=true;c.supports=c.supports.map(s=>({...s,epsilonG:1,sigmaG:0.2}));const u=calculateCg(c).uncertainty;expect(u.corners).toHaveLength(8);expect(u.exactX).toBeGreaterThanOrEqual(u.linearX);expect(u.rssX).toBeLessThan(u.linearX);expect(u.target).toContain('예산');});
  test('unvalidated errors do not claim accuracy',()=>{const c=cg();c.supports=c.supports.map(s=>({...s,epsilonG:1}));expect(calculateCg(c).uncertainty.target).toBe('판정 불가');});
  test('bounded denominator failure and negative uncertainty rejected',()=>{const c=cg();c.supports=c.supports.map(s=>({...s,epsilonG:400}));expect(calculateCg(c).uncertainty.exactX).toBeUndefined();c.supports[0].epsilonG=-1;expect(()=>calculateCg(c)).toThrow();});
});
describe('record compatibility',()=>{
  const raw=JSON.stringify({version:2,cgRecords:[{id:'cg',width:400,height:400,plateMassG:4380,totalMassG:11.96,xG:-15,yG:8,supports:[{raw:3.38}]}],inertiaRecords:[{id:'i',inertiaKgM2:0.27}],cgComparisons:[{a:1}],inertiaComparisons:[]});
  test('explicit mass unit is mandatory; original bytes and geometry preserved',()=>{const p=previewImport(raw);expect(()=>importRecords(p)).toThrow();const r=importRecords(p,'kg');expect(r[0].legacyArchive.originalText).toBe(raw);expect(r[0].legacyRecord.width).toBe(400);expect(r[0].legacyRecord.totalMassG).toBe(11.96);expect(r[0].conversionHistory[0].rawToKg).toBe(1);expect(r[1].method).toBe('legacy_bifilar');expect(r[2].cgComparisons).toEqual([{a:1}]);});
  test('one sample has no repeatability statistic',()=>expect(stats([3])).toMatchObject({n:1,sd:null,cv:null}));
  test('comparison never merges different axis/configuration',()=>{const base={method:'falling_mass',target:'A',configuration:'B',axis:'Yaw',result:{parameters:{I:1,c1:2,c2:3}}};expect(compareRecords([base,{...base,axis:'Roll'},{...base,configuration:'C'}])).toHaveLength(3);});
});
describe('preprocessing and physics',()=>{
  test('CSV quoting and independent ENC rows',()=>{const p=parseCsv('time,angle,sample_type,note\n0,0,ENC,"a,b"\n0,,TEL,x\n');expect(p.rows[0].note).toBe('a,b');});
  test('SI conversion mR² exists only during acceleration',()=>{const c={...settings(),mass:30,massUnit:'g',radius:180,radiusUnit:'mm'};const ph=physics(c);expect(ph.m).toBeCloseTo(0.03);expect(ph.R).toBeCloseTo(0.18);const p={I:0.035,c1:0.0017,c2:0};expect(odeVelocity(0.1,1,p,ph,true)).toBeCloseTo(1+(ph.torque-p.c1)/(p.I+ph.addedInertia)*0.1,12);expect(odeVelocity(0.1,1,p,ph,false)).toBeCloseTo(1-p.c1/p.I*0.1,12);});
  test('timestamp units s/ms and angular deg/rad',()=>{const {rows,c}=sample();const a=preprocess(rows,c);const b=preprocess(rows.map(r=>({...r,time:r.time*1000,omega:r.omega*180/Math.PI})),{...c,timeUnit:'ms',angleUnit:'deg'});expect(a.points[150].omega).toBeCloseTo(b.points[150].omega,9);expect(b.diagnostics.hz).toBeCloseTo(a.diagnostics.hz);});
  test('±π unwrap and counts',()=>{const {rows,c}=sample();const wrap=x=>((x+Math.PI)%(2*Math.PI)+2*Math.PI)%(2*Math.PI)-Math.PI;const p=preprocess(rows.map(r=>({...r,angle:wrap(r.angle)})),{...c,valueKind:'angle',valueColumn:'angle',window:11});const counts=preprocess(rows.map(r=>({...r,angle:wrap(r.angle)*16384/(2*Math.PI)})),{...c,valueKind:'angle',valueColumn:'angle',angleUnit:'count',cpr:16384,window:11});expect(p.points[1000].theta).toBeCloseTo(rows[1000].angle,8);expect(counts.points[1000].omega).toBeCloseTo(p.points[1000].omega,8);});
  test('irregular timestamps use actual dt',()=>{const {rows,c}=sample(undefined,{irregular:true});const p=preprocess(rows,c);expect(p.diagnostics.dt.min).toBeLessThan(p.diagnostics.dt.max);expect(p.diagnostics.medianHz).toBeGreaterThan(150);});
  test('missing values, duplicate times, and TEL rows are not manufactured',()=>{const {rows,c}=sample();const r=[...rows.slice(0,10),rows[9],{time:1,omega:'',sample_type:'TEL'},...rows.slice(10)];const p=preprocess(r,c);expect(p.points.length).toBe(rows.length);expect(p.diagnostics.duplicates).toBe(1);expect(p.diagnostics.otherEvents).toBe(1);});
  test('timestamp reversal/publisher change rejected',()=>{const {rows,c}=sample();expect(()=>preprocess([rows[1],rows[0],...rows.slice(2)],c)).toThrow(/역전/);expect(()=>preprocess(rows.map((r,i)=>({...r,publisher_id:i<20?'A':'B'})),c)).toThrow(/publisher/);});
  test('known timer wrap is explicit',()=>{const {rows,c}=sample();const p=preprocess(rows.map(r=>({...r,time:(r.time+9)%10})),{...c,wrapPeriod:10});expect(p.diagnostics.wraps).toBeGreaterThan(0);});
  test('long gaps are detected, not interpolated',()=>{const {rows,c}=sample();const p=preprocess(rows.filter(r=>r.time<5||r.time>7),c);expect(p.diagnostics.gaps).toHaveLength(1);expect(p.points.some(p=>p.omega==null)).toBe(true);expect(()=>selectSegments(p,c)).toThrow(/결손/);});
  test('free decay alone cannot identify separate I,c1,c2',()=>{const {rows,c}=sample();const p=preprocess(rows.filter(r=>r.time>2),c);expect(()=>selectSegments(p,{...c,split:0})).toThrow(/c₁\/I/);});
  test('no common speed range blocks fitting',()=>{const {rows,c}=sample();const p=preprocess(rows,c);expect(()=>selectSegments(p,{...c,speedMin:100})).toThrow(/공통/);});
  test('separation shock is excluded',()=>{const {rows,c}=sample();const p=preprocess(rows.map(r=>Math.abs(r.time-1.5)<0.03?{...r,omega:r.omega+5}:r),c);const s=selectSegments(p,{...c,shock:0.15});expect([...s.acc,...s.dec].every(p=>Math.abs(p.t-1.5)>=0.15-1e-10)).toBe(true);});
});
describe('joint ODE response fitting',()=>{
  test.each([1,-1])('noise-free direction %s recovers parameters within 0.1%%',direction=>{const {rows,c}=sample(undefined,{direction});const r=fitIdentification(preprocess(rows,c),c);expect(r.solver.converged).toBe(true);expect(r.parameters.I/0.035).toBeCloseTo(1,3);expect(r.parameters.c1/0.0017).toBeCloseTo(1,3);expect(r.parameters.c2/0.0006).toBeCloseTo(1,3);});
  test('deterministic noise 0.002rad/s: I 2%, c1/c2 10%',()=>{const {rows,c}=sample(undefined,{noise:0.002});const p=fitIdentification(preprocess(rows,c),c).parameters;expect(Math.abs(p.I/0.035-1)).toBeLessThan(0.02);expect(Math.abs(p.c1/0.0017-1)).toBeLessThan(0.1);expect(Math.abs(p.c2/0.0006-1)).toBeLessThan(0.1);});
  test.each([0,0.000001])('c2 near zero %s is nonnegative and not forced',c2=>{const p={I:0.035,c1:0.0017,c2};const {rows,c}=sample(p);const r=fitIdentification(preprocess(rows,c),c);expect(r.parameters.c2).toBeGreaterThanOrEqual(0);expect(Math.abs(r.parameters.I/p.I-1)).toBeLessThan(0.005);expect(Math.abs(r.parameters.c2-c2)).toBeLessThan(0.000003);});
  test('synthetic angle CSV workflow recovers I within 1%',()=>{const c={...settings(),valueKind:'angle',angleUnit:'deg',valueColumn:'angle',window:11};const parsed=parseCsv(syntheticCsv());const result=fitIdentification(preprocess(parsed.rows,c),c);expect(Math.abs(result.parameters.I/0.035-1)).toBeLessThan(0.01);});
});
