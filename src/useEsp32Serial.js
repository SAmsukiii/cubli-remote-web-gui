import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeLivePacket } from './telemetryNormalize';

const MAX_BUFFER_LENGTH = 262144;
const MAX_RECENT_PACKETS = 10;
const MAX_CHART_POINTS = 90;
const BAUD_RATE = 115200;
const UI_FLUSH_INTERVAL_MS = 100;
const READ_BUFFER_SIZE = 1024 * 1024;

const DEFAULT_PACKET = {
  source: 'none',
  pc_time_ms: 0,
  q0: 1,
  q1: 0,
  q2: 0,
  q3: 0,
  q: [1, 0, 0, 0],
  norm: 1,
  roll_deg: 0,
  pitch_deg: 0,
  yaw_deg: 0,
  ebimu_timestamp_ms: 0,
  seq: 0,
  rxCount: 0,
  enc_x_deg: null,
  enc_y_deg: null,
  enc_z_deg: null,
  encoderXDeg: null,
  encoderYDeg: null,
  encoderZDeg: null,
  enc_q0: null,
  enc_q1: null,
  enc_q2: null,
  enc_q3: null,
  encoderQ0: null,
  encoderQ1: null,
  encoderQ2: null,
  encoderQ3: null,
  enc_timer_x: null,
  enc_timer_y: null,
  enc_timer_z: null,
  encoderTimerX: null,
  encoderTimerY: null,
  encoderTimerZ: null,
  encoderUpdatedAt: null,
  encoderSource: '',
  encoder: {
    x: null,
    y: null,
    z: null,
    q0: null,
    q1: null,
    q2: null,
    q3: null,
    timerX: null,
    timerY: null,
    timerZ: null,
    updatedAt: null,
    source: '',
  },
  raw: '',
  updatedAt: 0,
};

function cleanLine(line) {
  return String(line || '')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '')
    .trim();
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFiniteValue(values, fallback = null) {
  for (const value of values) {
    const number = finiteOrNull(value);
    if (number !== null) return number;
  }
  return fallback;
}

function hasEncoderAngles(encoder = {}) {
  return ['enc_x_deg', 'enc_y_deg', 'enc_z_deg']
    .some((key) => finiteOrNull(encoder?.[key]) !== null);
}

function makeEncoderFields(input = {}, fallback = {}) {
  const encX = firstFiniteValue([input.enc_x_deg, input.encoderXDeg, input.encoder?.x], fallback.enc_x_deg ?? fallback.encoderXDeg ?? fallback.encoder?.x ?? null);
  const encY = firstFiniteValue([input.enc_y_deg, input.encoderYDeg, input.encoder?.y], fallback.enc_y_deg ?? fallback.encoderYDeg ?? fallback.encoder?.y ?? null);
  const encZ = firstFiniteValue([input.enc_z_deg, input.encoderZDeg, input.encoder?.z], fallback.enc_z_deg ?? fallback.encoderZDeg ?? fallback.encoder?.z ?? null);
  const encQ0 = firstFiniteValue([input.enc_q0, input.encoderQ0, input.encoder?.q0], fallback.enc_q0 ?? fallback.encoderQ0 ?? fallback.encoder?.q0 ?? null);
  const encQ1 = firstFiniteValue([input.enc_q1, input.encoderQ1, input.encoder?.q1], fallback.enc_q1 ?? fallback.encoderQ1 ?? fallback.encoder?.q1 ?? null);
  const encQ2 = firstFiniteValue([input.enc_q2, input.encoderQ2, input.encoder?.q2], fallback.enc_q2 ?? fallback.encoderQ2 ?? fallback.encoder?.q2 ?? null);
  const encQ3 = firstFiniteValue([input.enc_q3, input.encoderQ3, input.encoder?.q3], fallback.enc_q3 ?? fallback.encoderQ3 ?? fallback.encoder?.q3 ?? null);
  const timerX = firstFiniteValue([input.enc_timer_x, input.encoderTimerX, input.encoder?.timerX, input.encoder?.timer_x], fallback.enc_timer_x ?? fallback.encoderTimerX ?? fallback.encoder?.timerX ?? fallback.encoder?.timer_x ?? null);
  const timerY = firstFiniteValue([input.enc_timer_y, input.encoderTimerY, input.encoder?.timerY, input.encoder?.timer_y], fallback.enc_timer_y ?? fallback.encoderTimerY ?? fallback.encoder?.timerY ?? fallback.encoder?.timer_y ?? null);
  const timerZ = firstFiniteValue([input.enc_timer_z, input.encoderTimerZ, input.encoder?.timerZ, input.encoder?.timer_z], fallback.enc_timer_z ?? fallback.encoderTimerZ ?? fallback.encoder?.timerZ ?? fallback.encoder?.timer_z ?? null);
  const updatedAt = firstFiniteValue([input.encoderUpdatedAt, input.encoder?.updatedAt], fallback.encoderUpdatedAt ?? fallback.encoder?.updatedAt ?? null);
  const source = input.encoderSource || input.encoder?.source || fallback.encoderSource || fallback.encoder?.source || '';

  return {
    enc_x_deg: encX,
    enc_y_deg: encY,
    enc_z_deg: encZ,
    encoderXDeg: encX,
    encoderYDeg: encY,
    encoderZDeg: encZ,
    enc_q0: encQ0,
    enc_q1: encQ1,
    enc_q2: encQ2,
    enc_q3: encQ3,
    encoderQ0: encQ0,
    encoderQ1: encQ1,
    encoderQ2: encQ2,
    encoderQ3: encQ3,
    enc_timer_x: timerX,
    enc_timer_y: timerY,
    enc_timer_z: timerZ,
    encoderTimerX: timerX,
    encoderTimerY: timerY,
    encoderTimerZ: timerZ,
    encoderUpdatedAt: updatedAt,
    encoderSource: source,
    encoder: {
      x: encX,
      y: encY,
      z: encZ,
      q0: encQ0,
      q1: encQ1,
      q2: encQ2,
      q3: encQ3,
      timerX,
      timerY,
      timerZ,
      updatedAt,
      source,
    },
  };
}

function mergeEncoderIntoPacket(packet = {}, encoder = {}) {
  const fields = makeEncoderFields(encoder, packet);
  return {
    ...packet,
    ...fields,
    encoder: {
      ...(packet.encoder || {}),
      ...fields.encoder,
    },
  };
}

function normalizeQuaternion(values) {
  let [q0, q1, q2, q3] = values.map(Number);
  const norm = Math.sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);

  if (!Number.isFinite(norm) || norm < 0.5 || norm > 1.5) {
    return { ok: false, reason: `bad quaternion norm ${Number.isFinite(norm) ? norm.toFixed(4) : norm}` };
  }

  if (norm > 1e-9) {
    q0 /= norm;
    q1 /= norm;
    q2 /= norm;
    q3 /= norm;
  } else {
    q0 = 1;
    q1 = 0;
    q2 = 0;
    q3 = 0;
  }

  return {
    ok: true,
    q: [q0, q1, q2, q3],
    norm,
  };
}

function quaternionToEulerDeg(q) {
  const [w, x, y, z] = q;

  const sinrCosp = 2 * (w * x + y * z);
  const cosrCosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinrCosp, cosrCosp) * 180 / Math.PI;

  let sinp = 2 * (w * y - z * x);
  sinp = Math.max(-1, Math.min(1, sinp));
  const pitch = Math.asin(sinp) * 180 / Math.PI;

  const sinyCosp = 2 * (w * z + x * y);
  const cosyCosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(sinyCosp, cosyCosp) * 180 / Math.PI;

  return { roll, pitch, yaw };
}

function parseImuCsvLine(line) {
  const clean = cleanLine(line);
  if (!clean.startsWith('IMU,')) return null;

  const parts = clean.split(',').map((part) => part.trim());
  if (parts.length < 10) {
    return { ok: false, reason: `IMU field count ${parts.length} < 10`, cleanLine: clean };
  }

  const numberAt = (index, label, required = true) => {
    const value = Number(parts[index]);
    if (!Number.isFinite(value)) {
      if (required) throw new Error(`${label} is not numeric`);
      return undefined;
    }
    return value;
  };

  try {
    const q0 = numberAt(1, 'q0');
    const q1 = numberAt(2, 'q1');
    const q2 = numberAt(3, 'q2');
    const q3 = numberAt(4, 'q3');
    const roll = numberAt(5, 'roll');
    const pitch = numberAt(6, 'pitch');
    const yaw = numberAt(7, 'yaw');
    const timestamp = numberAt(8, 'timestamp');
    const seq = numberAt(9, 'seq');
    const qerrDeg = numberAt(10, 'qerr_deg', false);
    const wx = numberAt(11, 'wx', false);
    const wy = numberAt(12, 'wy', false);
    const wz = numberAt(13, 'wz', false);
    const RPM1 = numberAt(14, 'RPM1', false);
    const RPM2 = numberAt(15, 'RPM2', false);
    const RPM3 = numberAt(16, 'RPM3', false);
    const RPMcmd1 = numberAt(17, 'RPMcmd1', false);
    const RPMcmd2 = numberAt(18, 'RPMcmd2', false);
    const RPMcmd3 = numberAt(19, 'RPMcmd3', false);
    const PWM1 = numberAt(20, 'PWM1', false);
    const PWM2 = numberAt(21, 'PWM2', false);
    const PWM3 = numberAt(22, 'PWM3', false);
    const TbodycmdX = numberAt(23, 'Tbodycmd_x_Nm', false);
    const TbodycmdY = numberAt(24, 'Tbodycmd_y_Nm', false);
    const TbodycmdZ = numberAt(25, 'Tbodycmd_z_Nm', false);
    const Tmotor1 = numberAt(26, 'Tmotor1_Nm', false);
    const Tmotor2 = numberAt(27, 'Tmotor2_Nm', false);
    const Tmotor3 = numberAt(28, 'Tmotor3_Nm', false);

    return {
      ok: true,
      cleanLine: clean,
      source: 'Remote_ESPNOW_IMU',
      q: [q0, q1, q2, q3],
      roll_deg: roll,
      pitch_deg: pitch,
      yaw_deg: yaw,
      qerrDeg: Number.isFinite(qerrDeg) ? qerrDeg : undefined,
      qerr_deg: Number.isFinite(qerrDeg) ? qerrDeg : undefined,
      qerrSource: Number.isFinite(qerrDeg) ? 'satellite telemetry' : '',
      wx: Number.isFinite(wx) ? wx : undefined,
      wy: Number.isFinite(wy) ? wy : undefined,
      wz: Number.isFinite(wz) ? wz : undefined,
      angularRateSource: [wx, wy, wz].every(Number.isFinite) ? 'satellite body rate' : '',
      RPM1: Number.isFinite(RPM1) ? RPM1 : undefined,
      RPM2: Number.isFinite(RPM2) ? RPM2 : undefined,
      RPM3: Number.isFinite(RPM3) ? RPM3 : undefined,
      RPMcmd1: Number.isFinite(RPMcmd1) ? RPMcmd1 : undefined,
      RPMcmd2: Number.isFinite(RPMcmd2) ? RPMcmd2 : undefined,
      RPMcmd3: Number.isFinite(RPMcmd3) ? RPMcmd3 : undefined,
      PWM1: Number.isFinite(PWM1) ? PWM1 : undefined,
      PWM2: Number.isFinite(PWM2) ? PWM2 : undefined,
      PWM3: Number.isFinite(PWM3) ? PWM3 : undefined,
      Tbodycmd_x_Nm: Number.isFinite(TbodycmdX) ? TbodycmdX : undefined,
      Tbodycmd_y_Nm: Number.isFinite(TbodycmdY) ? TbodycmdY : undefined,
      Tbodycmd_z_Nm: Number.isFinite(TbodycmdZ) ? TbodycmdZ : undefined,
      Tmotor1_Nm: Number.isFinite(Tmotor1) ? Tmotor1 : undefined,
      Tmotor2_Nm: Number.isFinite(Tmotor2) ? Tmotor2 : undefined,
      Tmotor3_Nm: Number.isFinite(Tmotor3) ? Tmotor3 : undefined,
      control_mode: parts[29] ?? '',
      EBIMU_status: parts[30] ?? '',
      logging_status: parts[31] ?? '',
      ebimu_timestamp_ms: timestamp,
      seq,
      rxCount: seq,
    };
  } catch (err) {
    return { ok: false, reason: err?.message || 'IMU CSV parse failed', cleanLine: clean };
  }
}

function parseTelCsvLine(line) {
  const clean = cleanLine(line);
  if (!clean.startsWith('TEL,')) return null;

  const parts = clean.split(',').map((part) => part.trim());

  // Supported formats:
  // 1) Compact TEL:
  //    TEL,q0,q1,q2,q3,qerr_deg,wx,wy,wz,RPM1,RPM2,RPM3,RPMcmd1,RPMcmd2,RPMcmd3,timestamp,seq,control_mode,EBIMU_status,logging_status
  // 2) Extended TEL with PWM / torque fields:
  //    TEL,q0,q1,q2,q3,qerr_deg,wx,wy,wz,RPM1,RPM2,RPM3,RPMcmd1,RPMcmd2,RPMcmd3,PWM1,PWM2,PWM3,Tbodycmd_x,Tbodycmd_y,Tbodycmd_z,Tmotor1,Tmotor2,Tmotor3,timestamp,seq,...
  if (parts.length < 20) {
    return { ok: false, reason: `TEL field count ${parts.length} < 20`, cleanLine: clean };
  }

  const numberAt = (index, label, required = true) => {
    const value = Number(parts[index]);
    if (!Number.isFinite(value)) {
      if (required) throw new Error(`${label} is not numeric`);
      return undefined;
    }
    return value;
  };

  try {
    const q0 = numberAt(1, 'q0');
    const q1 = numberAt(2, 'q1');
    const q2 = numberAt(3, 'q2');
    const q3 = numberAt(4, 'q3');
    const qerrDeg = numberAt(5, 'qerr_deg', false);
    const wx = numberAt(6, 'wx', false);
    const wy = numberAt(7, 'wy', false);
    const wz = numberAt(8, 'wz', false);
    const RPM1 = numberAt(9, 'RPM1', false);
    const RPM2 = numberAt(10, 'RPM2', false);
    const RPM3 = numberAt(11, 'RPM3', false);
    const RPMcmd1 = numberAt(12, 'RPMcmd1', false);
    const RPMcmd2 = numberAt(13, 'RPMcmd2', false);
    const RPMcmd3 = numberAt(14, 'RPMcmd3', false);

    const hasExtendedFields = parts.length >= 27;
    const PWM1 = hasExtendedFields ? numberAt(15, 'PWM1', false) : undefined;
    const PWM2 = hasExtendedFields ? numberAt(16, 'PWM2', false) : undefined;
    const PWM3 = hasExtendedFields ? numberAt(17, 'PWM3', false) : undefined;
    const TbodycmdX = hasExtendedFields ? numberAt(18, 'Tbodycmd_x_Nm', false) : undefined;
    const TbodycmdY = hasExtendedFields ? numberAt(19, 'Tbodycmd_y_Nm', false) : undefined;
    const TbodycmdZ = hasExtendedFields ? numberAt(20, 'Tbodycmd_z_Nm', false) : undefined;
    const Tmotor1 = hasExtendedFields ? numberAt(21, 'Tmotor1_Nm', false) : undefined;
    const Tmotor2 = hasExtendedFields ? numberAt(22, 'Tmotor2_Nm', false) : undefined;
    const Tmotor3 = hasExtendedFields ? numberAt(23, 'Tmotor3_Nm', false) : undefined;
    const timestampIndex = hasExtendedFields ? 24 : 15;
    const seqIndex = hasExtendedFields ? 25 : 16;
    const statusIndex = hasExtendedFields ? 26 : 17;
    const timestamp = numberAt(timestampIndex, 'timestamp', false);
    const seq = numberAt(seqIndex, 'seq', false);

    const packet = {
      ok: true,
      cleanLine: clean,
      source: 'Remote_ESPNOW_TEL',
      q: [q0, q1, q2, q3],
      qerrDeg,
      qerr_deg: qerrDeg,
      qerrSource: Number.isFinite(qerrDeg) ? 'satellite telemetry' : '',
      wx,
      wy,
      wz,
      angularRateSource: [wx, wy, wz].every(Number.isFinite) ? 'satellite body rate' : '',
      RPM1,
      RPM2,
      RPM3,
      RPMcmd1,
      RPMcmd2,
      RPMcmd3,
      PWM1,
      PWM2,
      PWM3,
      Tbodycmd_x_Nm: TbodycmdX,
      Tbodycmd_y_Nm: TbodycmdY,
      Tbodycmd_z_Nm: TbodycmdZ,
      Tmotor1_Nm: Tmotor1,
      Tmotor2_Nm: Tmotor2,
      Tmotor3_Nm: Tmotor3,
      ebimu_timestamp_ms: Number.isFinite(timestamp) ? timestamp : 0,
      seq: Number.isFinite(seq) ? seq : 0,
      rxCount: Number.isFinite(seq) ? seq : 0,
      control_mode: parts[statusIndex] ?? '',
      EBIMU_status: parts[statusIndex + 1] ?? '',
      logging_status: parts[statusIndex + 2] ?? '',
    };

    const encoderStart = statusIndex + 3;
    if (parts.length > encoderStart && parts.length < encoderStart + 3) {
      throw new Error('TEL encoder extension is incomplete');
    }
    if (parts.length >= encoderStart + 3) {
      const encoderValues = {
        enc_x_deg: numberAt(encoderStart, 'enc_x_deg'),
        enc_y_deg: numberAt(encoderStart + 1, 'enc_y_deg'),
        enc_z_deg: numberAt(encoderStart + 2, 'enc_z_deg'),
        encoderUpdatedAt: Date.now(),
        encoderSource: 'TEL packet',
      };
      if (parts.length > encoderStart + 3 && parts.length < encoderStart + 7) {
        throw new Error('TEL encoder quaternion extension is incomplete');
      }
      if (parts.length >= encoderStart + 7) {
        encoderValues.enc_q0 = numberAt(encoderStart + 3, 'enc_q0');
        encoderValues.enc_q1 = numberAt(encoderStart + 4, 'enc_q1');
        encoderValues.enc_q2 = numberAt(encoderStart + 5, 'enc_q2');
        encoderValues.enc_q3 = numberAt(encoderStart + 6, 'enc_q3');
      }
      Object.assign(packet, makeEncoderFields(encoderValues));
    }

    return packet;
  } catch (err) {
    return { ok: false, reason: err?.message || 'TEL CSV parse failed', cleanLine: clean };
  }
}

function parseRemoteStatusLine(line) {
  const clean = cleanLine(line);
  const satMatch = clean.match(/^(\d+)\s*\/\s*sat=\[\s*([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s*\].*?rx=(\d+)/);
  if (!satMatch) return null;

  const timestamp = Number(satMatch[1]);
  const q0 = Number(satMatch[2]);
  const q1 = Number(satMatch[3]);
  const q2 = Number(satMatch[4]);
  const q3 = Number(satMatch[5]);
  const rxCount = Number(satMatch[6]);

  if ([timestamp, q0, q1, q2, q3, rxCount].some((value) => !Number.isFinite(value))) {
    return { ok: false, reason: 'remote status parse number error', cleanLine: clean };
  }

  const euler = quaternionToEulerDeg([q0, q1, q2, q3]);
  return {
    ok: true,
    cleanLine: clean,
    source: 'REMOTE_STATUS',
    q: [q0, q1, q2, q3],
    roll_deg: euler.roll,
    pitch_deg: euler.pitch,
    yaw_deg: euler.yaw,
    ebimu_timestamp_ms: timestamp,
    seq: rxCount,
    rxCount,
  };
}

function parseRxDebugLine(line) {
  const clean = cleanLine(line);
  if (!clean.startsWith('[RX]')) return null;

  const qMatch = clean.match(/q=\[\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\]/);
  const rpyMatch = clean.match(/RPY=\[\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\]/);
  const seqMatch = clean.match(/seq=(\d+)/);
  const tsMatch = clean.match(/ebimu_ts=(\d+)/);
  const rxMatch = clean.match(/rxCount=(\d+)/);

  if (!qMatch) {
    return { ok: false, reason: '[RX] line without q=[...]', cleanLine: clean };
  }

  const q = [Number(qMatch[1]), Number(qMatch[2]), Number(qMatch[3]), Number(qMatch[4])];
  if (q.some((value) => !Number.isFinite(value))) {
    return { ok: false, reason: '[RX] q contains non-numeric field', cleanLine: clean };
  }

  let euler = quaternionToEulerDeg(q);
  if (rpyMatch) {
    const r = Number(rpyMatch[1]);
    const p = Number(rpyMatch[2]);
    const y = Number(rpyMatch[3]);
    if ([r, p, y].every(Number.isFinite)) {
      euler = { roll: r, pitch: p, yaw: y };
    }
  }

  const seq = seqMatch ? Number(seqMatch[1]) : 0;
  const timestamp = tsMatch ? Number(tsMatch[1]) : 0;
  const rxCount = rxMatch ? Number(rxMatch[1]) : seq;

  return {
    ok: true,
    cleanLine: clean,
    source: 'RX_DEBUG',
    q,
    roll_deg: euler.roll,
    pitch_deg: euler.pitch,
    yaw_deg: euler.yaw,
    ebimu_timestamp_ms: timestamp,
    seq,
    rxCount,
  };
}

function parseEncCsvLine(line) {
  const clean = cleanLine(line);
  if (!clean.startsWith('ENC,')) return null;

  const parts = clean.split(',').map((part) => part.trim());
  if (![4, 8, 11].includes(parts.length)) {
    return { ok: false, reason: `ENC field count ${parts.length} is not supported`, cleanLine: clean };
  }

  const numberAt = (index, label) => {
    const value = Number(parts[index]);
    if (!Number.isFinite(value)) throw new Error(`${label} is not numeric`);
    return value;
  };

  try {
    const encoderValues = {
      enc_x_deg: numberAt(1, 'enc_x_deg'),
      enc_y_deg: numberAt(2, 'enc_y_deg'),
      enc_z_deg: numberAt(3, 'enc_z_deg'),
      encoderUpdatedAt: Date.now(),
      encoderSource: 'encoder packet',
    };
    if (parts.length >= 8) {
      encoderValues.enc_q0 = numberAt(4, 'enc_q0');
      encoderValues.enc_q1 = numberAt(5, 'enc_q1');
      encoderValues.enc_q2 = numberAt(6, 'enc_q2');
      encoderValues.enc_q3 = numberAt(7, 'enc_q3');
    }
    if (parts.length >= 11) {
      encoderValues.enc_timer_x = numberAt(8, 'enc_timer_x');
      encoderValues.enc_timer_y = numberAt(9, 'enc_timer_y');
      encoderValues.enc_timer_z = numberAt(10, 'enc_timer_z');
    }

    return {
      ok: true,
      encoderOnly: true,
      cleanLine: clean,
      raw: clean,
      source: 'ENC_CSV',
      ...makeEncoderFields(encoderValues),
    };
  } catch (err) {
    return { ok: false, reason: err?.message || 'ENC CSV parse failed', cleanLine: clean };
  }
}

function parseSerialLine(line) {
  const clean = cleanLine(line);
  if (!clean) return { ok: false, ignored: true, reason: 'empty line', cleanLine: '' };

  const parsers = [parseTelCsvLine, parseImuCsvLine, parseEncCsvLine, parseRxDebugLine, parseRemoteStatusLine];

  for (const parser of parsers) {
    const parsed = parser(clean);
    if (parsed == null) continue;
    return parsed;
  }

  if (/^(ACK|WARN|ERR|INFO|# STAT|\[SERIAL\]|\[STAT\])/.test(clean)) {
    return { ok: false, warning: true, reason: clean, cleanLine: clean };
  }

  return { ok: false, ignored: true, reason: 'ignored non-IMU line', cleanLine: clean };
}

function makeInitialEncoder() {
  return makeEncoderFields();
}

export default function useEsp32Serial() {
  const [isSupported] = useState(
    typeof navigator !== 'undefined' && typeof navigator.serial !== 'undefined'
  );
  const [isConnected, setIsConnected] = useState(false);
  const [baudRate, setBaudRate] = useState(BAUD_RATE);
  const [error, setError] = useState('');
  const [lastRawLine, setLastRawLine] = useState('');
  const [lastInvalidReason, setLastInvalidReason] = useState('');
  const [lastReceivedAt, setLastReceivedAt] = useState(null);
  const [latestPacket, setLatestPacket] = useState(DEFAULT_PACKET);
  const [recentPackets, setRecentPackets] = useState([]);
  const [chartData, setChartData] = useState([]);
  const [validCount, setValidCount] = useState(0);
  const [invalidCount, setInvalidCount] = useState(0);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [warningCount, setWarningCount] = useState(0);
  const [encoderCount, setEncoderCount] = useState(0);
  const [lastCommand, setLastCommand] = useState('');

  const portRef = useRef(null);
  const readerRef = useRef(null);
  const keepReadingRef = useRef(false);
  const decoderRef = useRef(new TextDecoder());
  const encoderRef = useRef(new TextEncoder());
  const bufferRef = useRef('');
  const prevQRef = useRef([1, 0, 0, 0]);
  const latestEncoderRef = useRef(makeInitialEncoder());
  const commandBusyRef = useRef(false);

  const latestPacketRef = useRef(DEFAULT_PACKET);
  const recentPacketsRef = useRef([]);
  const chartDataRef = useRef([]);
  const countersRef = useRef({ valid: 0, invalid: 0, ignored: 0, warning: 0 });
  const lastRawLineRef = useRef('');
  const lastInvalidReasonRef = useRef('');
  const lastReceivedAtRef = useRef(null);
  const pendingUiFlushRef = useRef(false);
  const droppedBufferCountRef = useRef(0);
  const encoderCountRef = useRef(0);

  const validRatio = useMemo(() => {
    const total = validCount + invalidCount;
    return total > 0 ? validCount / total : 0;
  }, [validCount, invalidCount]);

  const markPendingUiFlush = useCallback(() => {
    pendingUiFlushRef.current = true;
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (!pendingUiFlushRef.current) return;
      pendingUiFlushRef.current = false;

      setLatestPacket(latestPacketRef.current);
      setRecentPackets([...recentPacketsRef.current]);
      setChartData([...chartDataRef.current]);
      setValidCount(countersRef.current.valid);
      setInvalidCount(countersRef.current.invalid);
      setIgnoredCount(countersRef.current.ignored);
      setWarningCount(countersRef.current.warning);
      setEncoderCount(encoderCountRef.current);
      setLastRawLine(lastRawLineRef.current);
      setLastInvalidReason(lastInvalidReasonRef.current);
      setLastReceivedAt(lastReceivedAtRef.current);
    }, UI_FLUSH_INTERVAL_MS);

    return () => clearInterval(timer);
  }, []);

  const registerValidPacketRefOnly = useCallback((parsed) => {
    if (parsed.encoderOnly) {
      const now = parsed.encoderUpdatedAt || Date.now();
      const encoderFields = makeEncoderFields({ ...parsed, encoderUpdatedAt: now, encoderSource: parsed.encoderSource || 'encoder packet' }, latestEncoderRef.current);
      latestEncoderRef.current = encoderFields;
      encoderCountRef.current += 1;
      countersRef.current.valid += 1;

      const currentPacket = latestPacketRef.current || DEFAULT_PACKET;
      const attitudePacketExists = Boolean(currentPacket?.updatedAt);
      latestPacketRef.current = mergeEncoderIntoPacket({
        ...currentPacket,
        raw: parsed.cleanLine || currentPacket.raw || '',
        updatedAt: attitudePacketExists ? now : currentPacket.updatedAt,
      }, encoderFields);

      if (attitudePacketExists) {
        recentPacketsRef.current = [latestPacketRef.current, ...recentPacketsRef.current.slice(1)].slice(0, MAX_RECENT_PACKETS);
        const chartPoint = {
          time: new Date(now).toLocaleTimeString('ko-KR', { hour12: false, minute: '2-digit', second: '2-digit' }),
          roll: latestPacketRef.current.roll_deg,
          pitch: latestPacketRef.current.pitch_deg,
          yaw: latestPacketRef.current.yaw_deg,
          encX: encoderFields.enc_x_deg,
          encY: encoderFields.enc_y_deg,
          encZ: encoderFields.enc_z_deg,
        };
        chartDataRef.current = [...chartDataRef.current, chartPoint].slice(-MAX_CHART_POINTS);
      }

      lastRawLineRef.current = parsed.cleanLine || '';
      lastReceivedAtRef.current = now;
      lastInvalidReasonRef.current = '';
      markPendingUiFlush();
      return;
    }

    const normalized = normalizeQuaternion(parsed.q);
    if (!normalized.ok) {
      countersRef.current.warning += 1;
      lastInvalidReasonRef.current = normalized.reason;
      lastRawLineRef.current = parsed.cleanLine || '';
      markPendingUiFlush();
      return;
    }

    let q = normalized.q;
    const prevQ = prevQRef.current;
    const dot = prevQ[0] * q[0] + prevQ[1] * q[1] + prevQ[2] * q[2] + prevQ[3] * q[3];
    if (dot < 0) q = q.map((value) => -value);
    prevQRef.current = q;

    const euler = quaternionToEulerDeg(q);
    const now = Date.now();
    const encoderFields = hasEncoderAngles(parsed)
      ? makeEncoderFields({
          ...parsed,
          encoderUpdatedAt: parsed.encoderUpdatedAt || now,
          encoderSource: parsed.encoderSource || 'telemetry packet',
        }, latestEncoderRef.current)
      : makeEncoderFields(latestEncoderRef.current);
    const packet = {
      source: parsed.source || 'serial',
      pc_time_ms: now,
      q0: q[0],
      q1: q[1],
      q2: q[2],
      q3: q[3],
      q,
      usedQuaternion: true,
      norm: normalized.norm,
      roll_deg: euler.roll,
      pitch_deg: euler.pitch,
      yaw_deg: euler.yaw,
      rollSource: 'computed_from_quaternion',
      remoteRollDeg: Number.isFinite(parsed.roll_deg) ? parsed.roll_deg : undefined,
      remotePitchDeg: Number.isFinite(parsed.pitch_deg) ? parsed.pitch_deg : undefined,
      remoteYawDeg: Number.isFinite(parsed.yaw_deg) ? parsed.yaw_deg : undefined,
      qerr_deg: Number.isFinite(parsed.qerr_deg) ? parsed.qerr_deg : undefined,
      qerrDeg: Number.isFinite(parsed.qerrDeg) ? parsed.qerrDeg : undefined,
      qerrSource: parsed.qerrSource || '',
      wx: Number.isFinite(parsed.wx) ? parsed.wx : undefined,
      wy: Number.isFinite(parsed.wy) ? parsed.wy : undefined,
      wz: Number.isFinite(parsed.wz) ? parsed.wz : undefined,
      angularRateSource: parsed.angularRateSource || '',
      RPM1: Number.isFinite(parsed.RPM1) ? parsed.RPM1 : undefined,
      RPM2: Number.isFinite(parsed.RPM2) ? parsed.RPM2 : undefined,
      RPM3: Number.isFinite(parsed.RPM3) ? parsed.RPM3 : undefined,
      RPMcmd1: Number.isFinite(parsed.RPMcmd1) ? parsed.RPMcmd1 : undefined,
      RPMcmd2: Number.isFinite(parsed.RPMcmd2) ? parsed.RPMcmd2 : undefined,
      RPMcmd3: Number.isFinite(parsed.RPMcmd3) ? parsed.RPMcmd3 : undefined,
      PWM1: Number.isFinite(parsed.PWM1) ? parsed.PWM1 : undefined,
      PWM2: Number.isFinite(parsed.PWM2) ? parsed.PWM2 : undefined,
      PWM3: Number.isFinite(parsed.PWM3) ? parsed.PWM3 : undefined,
      Tbodycmd_x_Nm: Number.isFinite(parsed.Tbodycmd_x_Nm) ? parsed.Tbodycmd_x_Nm : undefined,
      Tbodycmd_y_Nm: Number.isFinite(parsed.Tbodycmd_y_Nm) ? parsed.Tbodycmd_y_Nm : undefined,
      Tbodycmd_z_Nm: Number.isFinite(parsed.Tbodycmd_z_Nm) ? parsed.Tbodycmd_z_Nm : undefined,
      Tmotor1_Nm: Number.isFinite(parsed.Tmotor1_Nm) ? parsed.Tmotor1_Nm : undefined,
      Tmotor2_Nm: Number.isFinite(parsed.Tmotor2_Nm) ? parsed.Tmotor2_Nm : undefined,
      Tmotor3_Nm: Number.isFinite(parsed.Tmotor3_Nm) ? parsed.Tmotor3_Nm : undefined,
      control_mode: parsed.control_mode ?? '',
      EBIMU_status: parsed.EBIMU_status ?? '',
      logging_status: parsed.logging_status ?? '',
      ebimu_timestamp_ms: Number.isFinite(parsed.ebimu_timestamp_ms) ? parsed.ebimu_timestamp_ms : 0,
      seq: Number.isFinite(parsed.seq) ? parsed.seq : 0,
      rxCount: Number.isFinite(parsed.rxCount) ? parsed.rxCount : 0,
      ...encoderFields,
      raw: parsed.cleanLine || '',
      updatedAt: now,
    };

    packet.rollDeg = packet.roll_deg;
    packet.pitchDeg = packet.pitch_deg;
    packet.yawDeg = packet.yaw_deg;
    packet.ebimuTimestampMs = packet.ebimu_timestamp_ms;
    latestEncoderRef.current = makeEncoderFields(packet, latestEncoderRef.current);

    const normalizedPacket = normalizeLivePacket(packet, 'admin-web-serial') || packet;
    const commonPacket = {
      ...packet,
      ...normalizedPacket,
      source: 'admin-web-serial',
      sourceLabel: 'Admin Web Serial Bridge',
      enc_x_deg: packet.enc_x_deg,
      enc_y_deg: packet.enc_y_deg,
      enc_z_deg: packet.enc_z_deg,
      enc_q0: packet.enc_q0,
      enc_q1: packet.enc_q1,
      enc_q2: packet.enc_q2,
      enc_q3: packet.enc_q3,
      enc_timer_x: packet.enc_timer_x,
      enc_timer_y: packet.enc_timer_y,
      enc_timer_z: packet.enc_timer_z,
      encoderXDeg: packet.encoderXDeg,
      encoderYDeg: packet.encoderYDeg,
      encoderZDeg: packet.encoderZDeg,
      encoderQ0: packet.encoderQ0,
      encoderQ1: packet.encoderQ1,
      encoderQ2: packet.encoderQ2,
      encoderQ3: packet.encoderQ3,
      encoderTimerX: packet.encoderTimerX,
      encoderTimerY: packet.encoderTimerY,
      encoderTimerZ: packet.encoderTimerZ,
      encoderUpdatedAt: packet.encoderUpdatedAt,
      encoderSource: packet.encoderSource,
      encoder: packet.encoder,
      raw: packet.raw,
      updatedAt: now,
    };

    latestPacketRef.current = commonPacket;
    lastReceivedAtRef.current = now;
    lastRawLineRef.current = commonPacket.raw;
    lastInvalidReasonRef.current = '';
    countersRef.current.valid += 1;

    recentPacketsRef.current = [commonPacket, ...recentPacketsRef.current].slice(0, MAX_RECENT_PACKETS);

    const chartPoint = {
      time: new Date(now).toLocaleTimeString('ko-KR', { hour12: false, minute: '2-digit', second: '2-digit' }),
      roll: commonPacket.roll_deg,
      pitch: commonPacket.pitch_deg,
      yaw: commonPacket.yaw_deg,
      encX: commonPacket.enc_x_deg ?? commonPacket.encoderXDeg,
      encY: commonPacket.enc_y_deg ?? commonPacket.encoderYDeg,
      encZ: commonPacket.enc_z_deg ?? commonPacket.encoderZDeg,
    };
    chartDataRef.current = [...chartDataRef.current, chartPoint].slice(-MAX_CHART_POINTS);

    if (typeof window !== 'undefined') {
      window.__CUBLI_SERIAL_PACKET = commonPacket;
    }

    markPendingUiFlush();
  }, [markPendingUiFlush]);

  const registerInvalidLineRefOnly = useCallback((parsed) => {
    if (parsed.warning) {
      countersRef.current.warning += 1;
      lastRawLineRef.current = parsed.cleanLine || cleanLine(parsed.raw || '');
      lastInvalidReasonRef.current = parsed.reason || 'remote status line';
      markPendingUiFlush();
      return;
    }

    if (parsed.ignored) {
      countersRef.current.ignored += 1;
      lastRawLineRef.current = parsed.cleanLine || cleanLine(parsed.raw || '');
      lastInvalidReasonRef.current = parsed.reason || 'ignored non-telemetry line';
      markPendingUiFlush();
      // 무시되는 ACK/INFO/WARN 라인까지 화면에 계속 반영하면 read loop가 느려진다.
      // raw line은 valid IMU/ENC 또는 실제 parse error가 있을 때만 갱신한다.
      return;
    }

    countersRef.current.invalid += 1;
    lastRawLineRef.current = parsed.cleanLine || cleanLine(parsed.raw || '');
    lastInvalidReasonRef.current = parsed.reason || 'parse failed';
    markPendingUiFlush();
  }, [markPendingUiFlush]);

  const handleLine = useCallback((line) => {
    const parsed = parseSerialLine(line);
    if (parsed.ok) registerValidPacketRefOnly(parsed);
    else registerInvalidLineRefOnly(parsed);
  }, [registerInvalidLineRefOnly, registerValidPacketRefOnly]);

  const processChunk = useCallback((text) => {
    bufferRef.current += text;

    if (bufferRef.current.length > MAX_BUFFER_LENGTH) {
      const lastNewline = bufferRef.current.lastIndexOf('\n');
      if (lastNewline >= 0) {
        bufferRef.current = bufferRef.current.slice(lastNewline + 1);
      } else {
        bufferRef.current = bufferRef.current.slice(-1024);
      }
      droppedBufferCountRef.current += 1;
      countersRef.current.warning += 1;
      lastInvalidReasonRef.current = `local line buffer trimmed ${droppedBufferCountRef.current}x`;
      markPendingUiFlush();
    }

    let newlineIndex;
    // split()으로 긴 배열을 매 chunk마다 만드는 것보다 하나씩 잘라 처리하는 편이 더 가볍다.
    while ((newlineIndex = bufferRef.current.search(/\r?\n/)) >= 0) {
      const line = bufferRef.current.slice(0, newlineIndex);
      const nextStart = bufferRef.current[newlineIndex] === '\r' && bufferRef.current[newlineIndex + 1] === '\n'
        ? newlineIndex + 2
        : newlineIndex + 1;
      bufferRef.current = bufferRef.current.slice(nextStart);

      const trimmed = line.trim();
      if (trimmed) handleLine(trimmed);
    }
  }, [handleLine, markPendingUiFlush]);

  const readLoop = useCallback(async () => {
    if (!portRef.current) return;

    keepReadingRef.current = true;

    // Web Serial read errors such as "Buffer overrun" can be non-fatal.
    // Chrome's recommended pattern is to release the reader and reacquire a new
    // reader while port.readable is still available, instead of stopping forever.
    while (keepReadingRef.current && portRef.current?.readable) {
      const reader = portRef.current.readable.getReader();
      readerRef.current = reader;

      try {
        while (keepReadingRef.current) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length > 0) {
            processChunk(decoderRef.current.decode(value, { stream: true }));
          }
        }
      } catch (err) {
        if (!keepReadingRef.current) break;

        const msg = err?.message || 'Serial read error';
        const isRecoverable = /buffer overrun|break condition|framing error|parity error/i.test(msg);

        if (isRecoverable) {
          countersRef.current.warning += 1;
          lastInvalidReasonRef.current = `${msg} - reader recovered`;
          markPendingUiFlush();
          // Do not set fatal error or disconnect. Release the reader below,
          // wait briefly, and reacquire the new readable stream.
          await new Promise((resolve) => setTimeout(resolve, 25));
        } else {
          setError(msg);
          break;
        }
      } finally {
        try { reader.releaseLock(); } catch (_) {}
        if (readerRef.current === reader) readerRef.current = null;
      }

      // If the stream ended normally because of disconnect/cancel, leave loop.
      if (!keepReadingRef.current) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }, [markPendingUiFlush, processChunk]);

  const connect = useCallback(async () => {
    if (!isSupported) {
      setError('이 브라우저는 Web Serial API를 지원하지 않습니다. Chrome 또는 Edge에서 실행해 주세요.');
      return false;
    }

    try {
      setError('');
      const port = await navigator.serial.requestPort();
      await port.open({
        baudRate: BAUD_RATE,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
        bufferSize: READ_BUFFER_SIZE,
      });

      portRef.current = port;
      setBaudRate(BAUD_RATE);
      setIsConnected(true);
      readLoop();
      return true;
    } catch (err) {
      setError(err?.message || 'Serial port open failed');
      try { if (portRef.current) await portRef.current.close(); } catch (_) {}
      portRef.current = null;
      setIsConnected(false);
      return false;
    }
  }, [isSupported, readLoop]);

  const disconnect = useCallback(async () => {
    keepReadingRef.current = false;

    try { if (readerRef.current) await readerRef.current.cancel(); } catch (_) {}

    try {
      if (portRef.current) await portRef.current.close();
    } catch (err) {
      setError(err?.message || 'Serial disconnect failed');
    } finally {
      portRef.current = null;
      readerRef.current = null;
      setIsConnected(false);
    }
  }, []);

  const sendLine = useCallback(async (line) => {
    if (!portRef.current?.writable || !isConnected) {
      setError('Serial receiver가 연결되어 있지 않습니다.');
      return false;
    }

    if (commandBusyRef.current) {
      setError('명령 전송 중입니다. 잠시 후 다시 시도하세요.');
      return false;
    }

    commandBusyRef.current = true;
    let writer;
    try {
      const normalizedLine = String(line).trim();
      writer = portRef.current.writable.getWriter();
      await writer.write(encoderRef.current.encode(`${normalizedLine}\n`));
      setLastCommand(normalizedLine);
      setError('');
      return true;
    } catch (err) {
      setError(err?.message || 'command send failed');
      return false;
    } finally {
      try { writer?.releaseLock(); } catch (_) {}
      commandBusyRef.current = false;
    }
  }, [isConnected]);

  const sendCommand = useCallback((command) => {
    const body = String(command || '').trim();
    if (!body) return Promise.resolve(false);

    if (body.toUpperCase() === 'TARE') return sendLine('TARE');
    if (body.toUpperCase() === 'STOP') return sendLine('STOP');
    if (body.toUpperCase() === 'START') return sendLine('START');
    return sendLine(body);
  }, [sendLine]);

  const sendControllerCommand = useCallback((commandType, target1 = 0, target2 = 0, target3 = 0) => {
    const type = Number(commandType);
    const v1 = Number(target1) || 0;
    const v2 = Number(target2) || 0;
    const v3 = Number(target3) || 0;
    return sendLine(`${type} ${v1} ${v2} ${v3}`);
  }, [sendLine]);

  const sendTare = useCallback(() => sendControllerCommand(2, 0, 0, 0), [sendControllerCommand]);
  const sendStop = useCallback(() => sendControllerCommand(0, 0, 0, 0), [sendControllerCommand]);
  const sendTarget = useCallback((roll, pitch, yaw) => sendControllerCommand(1, roll, pitch, yaw), [sendControllerCommand]);

  const clearStats = useCallback(() => {
    bufferRef.current = '';
    prevQRef.current = [1, 0, 0, 0];
    latestEncoderRef.current = makeInitialEncoder();
    latestPacketRef.current = DEFAULT_PACKET;
    recentPacketsRef.current = [];
    chartDataRef.current = [];
    countersRef.current = { valid: 0, invalid: 0, ignored: 0, warning: 0 };
    lastRawLineRef.current = '';
    lastInvalidReasonRef.current = '';
    lastReceivedAtRef.current = null;
    pendingUiFlushRef.current = true;
    droppedBufferCountRef.current = 0;
    encoderCountRef.current = 0;

    setLastRawLine('');
    setLastInvalidReason('');
    setLastReceivedAt(null);
    setLatestPacket(DEFAULT_PACKET);
    setRecentPackets([]);
    setChartData([]);
    setValidCount(0);
    setInvalidCount(0);
    setIgnoredCount(0);
    setWarningCount(0);
    setEncoderCount(0);
    setLastCommand('');
  }, []);

  useEffect(() => {
    return () => {
      keepReadingRef.current = false;
      try { readerRef.current?.cancel(); } catch (_) {}
      try { portRef.current?.close(); } catch (_) {}
    };
  }, []);

  return {
    // 최신 packet을 React state 갱신 주기와 분리해서 3D render loop가 직접 읽을 수 있게 한다.
    // 이 ref는 packet이 들어오는 즉시 바뀌므로, 3D 자세는 UI flush(100ms)에 묶이지 않는다.
    latestPacketRef,
    isSupported,
    isConnected,
    baudRate,
    error,
    lastRawLine,
    lastInvalidReason,
    lastReceivedAt,
    latestPacket,
    recentPackets,
    chartData,
    validCount,
    invalidCount,
    ignoredCount,
    warningCount,
    encoderCount,
    validRatio,
    lastCommand,
    connect,
    disconnect,
    sendLine,
    sendCommand,
    sendControllerCommand,
    sendTare,
    sendStop,
    sendTarget,
    clearStats,
  };
}
