import {normalizeCsvPacketForColumns,finalizeCsvLogRows,DEFAULT_CSV_LOG_COLUMNS,csvRowFromPacket} from '../csvLogUtils';
import {normalizeQuaternion,computeQerrDeg} from '../telemetryNormalize';
import {makeCalibrationLock,isCommandBlockedByCalibration} from '../calibrationLockUtils';

test('existing CSV keeps independent TEL/ENC values and sorts raw event times',()=>{
  const tel=normalizeCsvPacketForColumns({sample_type:'TEL',raw:'TEL,1',q0:1,q1:0,q2:0,q3:0,plot_time_ms:20,seq:2});
  const enc=normalizeCsvPacketForColumns({sample_type:'ENC',raw:'ENC,1',enc_z_deg:30,enc_timer_z:100,plot_time_ms:10,seq:1});
  expect(tel.imu_q0).toBe(1);expect(enc.enc_z_deg).toBe(30);
  expect(enc.imu_q0==null||enc.imu_q0==='').toBe(true);
  expect(tel.enc_z_deg==null||tel.enc_z_deg==='').toBe(true);
  const rows=finalizeCsvLogRows([tel,enc]);
  expect(rows.map(r=>r.sample_type)).toEqual(['ENC','TEL']);
  expect(csvRowFromPacket(enc,DEFAULT_CSV_LOG_COLUMNS).split(',')).toHaveLength(DEFAULT_CSV_LOG_COLUMNS.length);
});
test('existing quaternion rendering convention treats q and -q as same attitude',()=>{
  expect(normalizeQuaternion([1.1,0,0,0])).toMatchObject({ok:true,q:[1,0,0,0]});
  expect(computeQerrDeg([1,0,0,0],[-1,0,0,0])).toBe(0);
});
test('existing calibration lock still blocks actuation while keeping stop available',()=>{
  const lock=makeCalibrationLock('tare','fixture',{},1000);
  expect(isCommandBlockedByCalibration(lock,'wheelRpmAll')).toBe(true);
  expect(isCommandBlockedByCalibration(lock,'stop')).toBe(false);
});
