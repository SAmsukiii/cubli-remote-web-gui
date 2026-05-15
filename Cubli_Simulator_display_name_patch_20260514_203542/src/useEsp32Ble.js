import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { normalizeLivePacket } from './telemetryNormalize';

const DEVICE_NAME_PRIMARY = 'CUBLI__EBIMU_SENDER';
const DEVICE_NAME_FALLBACK = 'CUBLI_EBIMU_SENDER';
const SERVICE_UUID = '12345678-1234-1234-1234-1234567890ab';
const NOTIFY_CHAR_UUID = '12345678-1234-1234-1234-1234567890ac';
const COMMAND_CHAR_UUID = '12345678-1234-1234-1234-1234567890ad';
const STALE_TIMEOUT_MS = 500;
const MAX_RECENT_PACKETS = 12;


function detectBleEnvironment() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return {
      isSecureContext: false,
      hasBluetoothApi: false,
      isAndroid: false,
      isIOS: false,
      isMobile: false,
      userAgent: '',
      accessHint: '브라우저 환경을 확인할 수 없습니다.',
    };
  }

  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isMobile = isAndroid || isIOS || /Mobi/i.test(ua);
  const isSecureContext = Boolean(window.isSecureContext);
  const hasBluetoothApi = Boolean(navigator.bluetooth);

  let accessHint = 'Chrome 또는 Edge에서 HTTPS 또는 localhost로 접속하면 Web Bluetooth를 사용할 수 있습니다.';
  if (isIOS && hasBluetoothApi && isSecureContext) {
    accessHint = 'iPhone에서 Web BLE 전용 브라우저(예: Bluefy)로 접속한 상태로 보입니다. Broad Scan / Bluefy Connect 버튼으로 연결하세요.';
  } else if (isIOS && !hasBluetoothApi) {
    accessHint = 'iPhone/iPad Safari와 일반 iOS Chrome은 Web Bluetooth를 지원하지 않는 경우가 많습니다. Bluefy 같은 Web BLE 전용 브라우저에서 HTTPS 주소로 접속하세요.';
  } else if (isIOS && !isSecureContext) {
    accessHint = 'iPhone/Bluefy에서도 HTTPS 주소가 필요합니다. ngrok, Cloudflare Tunnel, Vercel, Netlify 같은 HTTPS 주소로 접속하세요.';
  } else if (isAndroid && !isSecureContext) {
    accessHint = 'Android 휴대폰에서는 http://PC_IP:3000 접속이 보안 컨텍스트가 아니어서 BLE가 막힙니다. HTTPS 배포, ngrok, Cloudflare Tunnel 등을 사용하세요.';
  } else if (isAndroid && hasBluetoothApi) {
    accessHint = 'Android Chrome에서 Web Bluetooth 사용 가능 상태입니다. 버튼을 눌러 장치를 선택하세요.';
  } else if (!hasBluetoothApi) {
    accessHint = '현재 브라우저에 navigator.bluetooth가 없습니다. Android Chrome/Edge, 데스크톱 Chrome/Edge, 또는 iPhone의 Bluefy를 사용하세요.';
  }

  return {
    isSecureContext,
    hasBluetoothApi,
    isAndroid,
    isIOS,
    isMobile,
    userAgent: ua,
    accessHint,
  };
}

const DEFAULT_PACKET = {
  source: 'ble-sender',
  packetType: 'none',
  from: DEVICE_NAME_PRIMARY,
  rxHz: 0,
  seq: 0,
  mode: 'BLE_QUAT',
  q: [1, 0, 0, 0],
  q0: 1,
  q1: 0,
  q2: 0,
  q3: 0,
  norm: 1,
  normalized: false,
  usedQuaternion: true,
  eulerFallback: false,
  rollDeg: 0,
  pitchDeg: 0,
  yawDeg: 0,
  roll_deg: 0,
  pitch_deg: 0,
  yaw_deg: 0,
  ebimuTimestampMs: 0,
  ebimu_timestamp_ms: 0,
  ebimuOk: 0,
  invalid: 0,
  overflow: 0,
  rxCount: 0,
  badLen: 0,
  ignoredMac: 0,
  packetCount: 0,
  pc_time_ms: 0,
  raw: '',
  warning: '',
  updatedAt: 0,
};

function cleanText(text) {
  return String(text || '')
    .replace(/[\u0000]/g, '')
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, '')
    .trim();
}

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeQuatScalarFirst(q) {
  const qw = numberOrZero(q?.[0]);
  const qx = numberOrZero(q?.[1]);
  const qy = numberOrZero(q?.[2]);
  const qz = numberOrZero(q?.[3]);
  const norm = Math.sqrt(qw * qw + qx * qx + qy * qy + qz * qz);

  if (!Number.isFinite(norm) || norm <= 0) {
    return { ok: false, q: [1, 0, 0, 0], norm: 0, normalized: false, reason: 'BLE quaternion norm is zero or invalid' };
  }

  if (norm < 0.5 || norm > 1.5) {
    return { ok: false, q: [qw, qx, qy, qz], norm, normalized: false, reason: `BLE quaternion norm ${norm.toFixed(4)} is outside 0.5~1.5` };
  }

  return {
    ok: true,
    q: [qw / norm, qx / norm, qy / norm, qz / norm],
    norm,
    normalized: Math.abs(norm - 1) > 1e-4,
    reason: '',
  };
}

function applySignContinuity(q, prevQ) {
  if (!prevQ || prevQ.length !== 4) return q;
  const dot = q[0] * prevQ[0] + q[1] * prevQ[1] + q[2] * prevQ[2] + q[3] * prevQ[3];
  if (dot < 0) return q.map((v) => -v);
  return q;
}

function extractNumbersFromLine(line) {
  const cleanLine = cleanText(line);
  if (!cleanLine) return [];

  // 1순위: CSV 토큰 기반. ATT, IMU, [BLE] 같은 접두어가 있어도 숫자 토큰만 남긴다.
  const commaTokens = cleanLine.split(',').map((token) => token.trim());
  const numericTokens = commaTokens
    .map((token) => token.replace(/^\[?BLE\]?\s*/i, '').replace(/^IMU\s*/i, '').replace(/^ATT\s*/i, '').trim())
    .filter((token) => /^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?$/.test(token))
    .map(Number);

  if (numericTokens.length >= 9) return numericTokens;

  // 2순위: CSV 토큰이 아니라 q=[...] 같이 들어온 경우를 대비한 보조 추출.
  // BLE notify에는 보통 숫자 9개만 들어오므로, 여기서는 처음 9개 숫자를 사용한다.
  const regexNumbers = cleanLine.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!regexNumbers) return numericTokens;
  return regexNumbers.map(Number);
}

function parseBleCsvLine(line, previousQuat = [1, 0, 0, 0], deviceName = DEVICE_NAME_PRIMARY) {
  const cleanLine = cleanText(line);
  if (!cleanLine) return { ok: false, reason: 'empty BLE notify line', cleanLine };

  // JSON line도 들어오면 처리 가능하게 둔다.
  if (cleanLine.startsWith('{')) {
    try {
      const obj = JSON.parse(cleanLine);
      const qRaw = Array.isArray(obj.q) ? obj.q : [obj.q0, obj.q1, obj.q2, obj.q3];
      const normalizedResult = normalizeQuatScalarFirst(qRaw);
      if (!normalizedResult.ok) return { ok: false, reason: normalizedResult.reason, cleanLine };
      const q = applySignContinuity(normalizedResult.q, previousQuat);
      const rpy = Array.isArray(obj.rpy) ? obj.rpy : [obj.roll, obj.pitch, obj.yaw];
      const packetCount = numberOrZero(obj.packetCount ?? obj.seq ?? obj.count);
      const ebimuTimestampMs = numberOrZero(obj.timestamp ?? obj.ebimu_ts ?? obj.ebimuTimestampMs);
      const now = Date.now();
      return {
        ok: true,
        packet: {
          ...DEFAULT_PACKET,
          from: obj.from || deviceName,
          packetType: 'ble-json',
          q,
          q0: q[0],
          q1: q[1],
          q2: q[2],
          q3: q[3],
          norm: normalizedResult.norm,
          normalized: normalizedResult.normalized,
          rollDeg: numberOrZero(rpy?.[0]),
          pitchDeg: numberOrZero(rpy?.[1]),
          yawDeg: numberOrZero(rpy?.[2]),
          roll_deg: numberOrZero(rpy?.[0]),
          pitch_deg: numberOrZero(rpy?.[1]),
          yaw_deg: numberOrZero(rpy?.[2]),
          ebimuTimestampMs,
          ebimu_timestamp_ms: ebimuTimestampMs,
          ebimuOk: packetCount,
          rxCount: packetCount,
          seq: packetCount,
          packetCount,
          pc_time_ms: now,
          raw: cleanLine,
          warning: normalizedResult.normalized ? `BLE quaternion normalized. raw norm=${normalizedResult.norm.toFixed(4)}` : '',
          updatedAt: now,
        },
      };
    } catch (err) {
      return { ok: false, reason: `BLE JSON parse failed: ${err?.message || err}`, cleanLine };
    }
  }

  const nums = extractNumbersFromLine(cleanLine);
  if (nums.length < 9) {
    return { ok: false, reason: `BLE notify numeric field count ${nums.length}; need 9`, cleanLine };
  }

  const qRaw = nums.slice(0, 4);
  const normalizedResult = normalizeQuatScalarFirst(qRaw);
  if (!normalizedResult.ok) {
    return { ok: false, reason: normalizedResult.reason, cleanLine };
  }

  const q = applySignContinuity(normalizedResult.q, previousQuat);
  const rollDeg = numberOrZero(nums[4]);
  const pitchDeg = numberOrZero(nums[5]);
  const yawDeg = numberOrZero(nums[6]);
  const ebimuTimestampMs = numberOrZero(nums[7]);
  const packetCount = numberOrZero(nums[8]);
  const now = Date.now();

  return {
    ok: true,
    packet: {
      ...DEFAULT_PACKET,
      from: deviceName || DEVICE_NAME_PRIMARY,
      packetType: 'ble-csv',
      q,
      q0: q[0],
      q1: q[1],
      q2: q[2],
      q3: q[3],
      norm: normalizedResult.norm,
      normalized: normalizedResult.normalized,
      rollDeg,
      pitchDeg,
      yawDeg,
      roll_deg: rollDeg,
      pitch_deg: pitchDeg,
      yaw_deg: yawDeg,
      ebimuTimestampMs,
      ebimu_timestamp_ms: ebimuTimestampMs,
      ebimuOk: packetCount,
      invalid: 0,
      overflow: 0,
      rxCount: packetCount,
      seq: packetCount,
      packetCount,
      pc_time_ms: now,
      raw: cleanLine,
      warning: normalizedResult.normalized ? `BLE quaternion normalized. raw norm=${normalizedResult.norm.toFixed(4)}` : '',
      updatedAt: now,
    },
  };
}

export default function useEsp32Ble() {
  const bleEnvironment = useMemo(() => detectBleEnvironment(), []);
  // iPhone Safari/일반 iOS Chrome에는 navigator.bluetooth가 없지만,
  // Bluefy 같은 Web BLE 전용 브라우저는 iOS에서도 navigator.bluetooth를 제공한다.
  // 따라서 iOS 여부로 막지 말고, 실제 API 존재 여부와 보안 컨텍스트만 본다.
  const [isSupported] = useState(
    Boolean(bleEnvironment.hasBluetoothApi && bleEnvironment.isSecureContext)
  );
  const [isConnected, setIsConnected] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [error, setError] = useState('');
  const [commandWarning, setCommandWarning] = useState('');
  const [lastRawLine, setLastRawLine] = useState('');
  const [lastInvalidReason, setLastInvalidReason] = useState('');
  const [lastReceivedAt, setLastReceivedAt] = useState(null);
  const [latestPacket, setLatestPacket] = useState(DEFAULT_PACKET);
  const [recentPackets, setRecentPackets] = useState([]);
  const [validCount, setValidCount] = useState(0);
  const [invalidCount, setInvalidCount] = useState(0);
  const [warningCount, setWarningCount] = useState(0);
  const [isStale, setIsStale] = useState(false);
  const [hasCommandCharacteristic, setHasCommandCharacteristic] = useState(false);
  const [hasNotifyCharacteristic, setHasNotifyCharacteristic] = useState(false);
  const [connectionStep, setConnectionStep] = useState('Idle');

  const deviceRef = useRef(null);
  const serverRef = useRef(null);
  const notifyCharRef = useRef(null);
  const commandCharRef = useRef(null);
  const textDecoderRef = useRef(new TextDecoder());
  const textEncoderRef = useRef(new TextEncoder());
  const bufferRef = useRef('');
  const latestQuatRef = useRef([1, 0, 0, 0]);
  // 3D Cubli render loop가 React state flush를 기다리지 않고 최신 BLE quaternion을 바로 읽을 수 있게 한다.
  const latestPacketRef = useRef(DEFAULT_PACKET);

  const validRatio = useMemo(() => {
    const total = validCount + invalidCount;
    if (total === 0) return 0;
    return validCount / total;
  }, [validCount, invalidCount]);

  const connectionStatus = useMemo(() => {
    if (!isSupported) return 'unsupported';
    if (!isConnected) return 'disconnected';
    if (isStale) return 'stale';
    return 'connected';
  }, [isConnected, isStale, isSupported]);

  const cleanupRefs = useCallback(() => {
    notifyCharRef.current = null;
    commandCharRef.current = null;
    serverRef.current = null;
    deviceRef.current = null;
    bufferRef.current = '';
    setHasCommandCharacteristic(false);
    setHasNotifyCharacteristic(false);
  }, []);

  const handleDisconnected = useCallback(() => {
    setConnectionStep('BLE disconnected');
    setIsConnected(false);
    setIsStale(false);
    cleanupRefs();
  }, [cleanupRefs]);

  const registerValidPacket = useCallback((packet) => {
    const normalizedPacket = normalizeLivePacket(packet, 'ble') || packet;
    const commonPacket = {
      ...packet,
      ...normalizedPacket,
      source: 'ble',
      sourceLabel: 'Admin BLE',
      packetType: packet.packetType,
      from: packet.from,
      raw: packet.raw,
      warning: packet.warning,
      updatedAt: packet.updatedAt,
    };

    latestQuatRef.current = commonPacket.q;
    latestPacketRef.current = commonPacket;
    setLatestPacket(commonPacket);
    setLastRawLine(commonPacket.raw);
    setLastInvalidReason(commonPacket.warning || '');
    setLastReceivedAt(commonPacket.updatedAt);
    setValidCount((prev) => prev + 1);
    if (commonPacket.warning) setWarningCount((prev) => prev + 1);
    setRecentPackets((prev) => [commonPacket, ...prev].slice(0, MAX_RECENT_PACKETS));
    if (typeof window !== 'undefined') {
      window.__CUBLI_BLE_PACKET = commonPacket;
    }
  }, []);

  const registerInvalidPacket = useCallback((line, reason) => {
    setInvalidCount((prev) => prev + 1);
    setLastRawLine(cleanText(line));
    setLastInvalidReason(reason || 'BLE packet parse failed');
  }, []);

  const handleLine = useCallback(
    (line) => {
      const parsed = parseBleCsvLine(line, latestQuatRef.current, deviceName || DEVICE_NAME_PRIMARY);
      if (parsed.ok) registerValidPacket(parsed.packet);
      else registerInvalidPacket(line, parsed.reason);
    },
    [deviceName, registerInvalidPacket, registerValidPacket]
  );

  const processNotifyText = useCallback(
    (text) => {
      const incoming = cleanText(text);
      if (!incoming) return;

      // 일반적인 경우: ESP32가 \n을 붙여서 notify한다.
      if (/\r|\n/.test(text)) {
        bufferRef.current += text;
        const lines = bufferRef.current.split(/\r?\n/);
        bufferRef.current = lines.pop() ?? '';
        lines.forEach((line) => {
          const trimmed = cleanText(line);
          if (trimmed) handleLine(trimmed);
        });
        return;
      }

      // 일부 펌웨어는 notify 하나에 완성된 CSV 한 줄을 보내지만 \n을 안 붙인다.
      // 이 경우 field가 충분하면 바로 한 packet으로 처리한다.
      const numbers = extractNumbersFromLine(incoming);
      if (numbers.length >= 9 || incoming.startsWith('{')) {
        if (bufferRef.current) {
          const candidate = cleanText(bufferRef.current + incoming);
          const candidateNumbers = extractNumbersFromLine(candidate);
          if (candidateNumbers.length >= 9 || candidate.startsWith('{')) {
            bufferRef.current = '';
            handleLine(candidate);
            return;
          }
        }
        handleLine(incoming);
        return;
      }

      // MTU 조각 등으로 잘린 경우를 대비해 버퍼에 누적한다.
      bufferRef.current += incoming;
      const bufferedNumbers = extractNumbersFromLine(bufferRef.current);
      if (bufferedNumbers.length >= 9 || cleanText(bufferRef.current).startsWith('{')) {
        const completed = cleanText(bufferRef.current);
        bufferRef.current = '';
        handleLine(completed);
      }
    },
    [handleLine]
  );

  const handleNotifyChanged = useCallback(
    (event) => {
      try {
        const text = textDecoderRef.current.decode(event.target.value);
        processNotifyText(text);
      } catch (err) {
        registerInvalidPacket('', err?.message || 'BLE notify decode failed');
      }
    },
    [processNotifyText, registerInvalidPacket]
  );

  const connect = useCallback(async (options = {}) => {
    const { broadScan = false, preferBluefy = false } = options || {};

    if (!bleEnvironment.isSecureContext) {
      setError('Web Bluetooth는 HTTPS 또는 localhost 같은 보안 컨텍스트에서만 동작합니다. 휴대폰에서 PC IP로 접속했다면 HTTPS 터널/ngrok/Cloudflare Tunnel 또는 실제 HTTPS 배포를 사용하세요.');
      setConnectionStep('Blocked: insecure context');
      return false;
    }

    if (!bleEnvironment.hasBluetoothApi) {
      setError(bleEnvironment.accessHint || '이 브라우저는 Web Bluetooth를 지원하지 않습니다. Android Chrome/Edge, 데스크톱 Chrome/Edge, 또는 iPhone의 Bluefy를 사용하세요.');
      setConnectionStep('Blocked: Web Bluetooth unavailable');
      return false;
    }

    if (!isSupported) {
      setError('이 브라우저는 Web Bluetooth를 지원하지 않습니다. localhost/HTTPS에서 실행하고, iPhone은 Bluefy 같은 Web BLE 전용 브라우저로 접속하세요.');
      return false;
    }

    try {
      setError('');
      setCommandWarning('');
      setLastInvalidReason('');
      setConnectionStep(
        preferBluefy
          ? 'Opening Bluefy/iPhone BLE picker...'
          : broadScan
            ? 'Opening broad BLE device picker...'
            : 'Opening BLE device picker...'
      );

      let availability = true;
      if (typeof navigator.bluetooth.getAvailability === 'function') {
        try {
          availability = await navigator.bluetooth.getAvailability();
        } catch (_) {
          availability = true;
        }
      }
      if (!availability) {
        setError('브라우저가 Bluetooth adapter를 사용할 수 없다고 보고했습니다. 휴대폰 Bluetooth를 켜고 위치/근처 기기 권한을 허용한 뒤 다시 시도하세요.');
        setConnectionStep('Bluetooth adapter unavailable');
        return false;
      }

      const requestOptions = (broadScan || preferBluefy)
        ? {
            // Bluefy/iOS Web BLE wrapper는 이름 filter보다 acceptAllDevices가 더 안정적인 경우가 많다.
            // service 접근을 위해 optionalServices에는 반드시 SERVICE_UUID를 넣는다.
            acceptAllDevices: true,
            optionalServices: [SERVICE_UUID],
          }
        : {
            filters: [
              { name: DEVICE_NAME_PRIMARY },
              { name: DEVICE_NAME_FALLBACK },
              { namePrefix: 'CUBLI' },
            ],
            optionalServices: [SERVICE_UUID],
          };

      const device = await navigator.bluetooth.requestDevice(requestOptions);

      deviceRef.current = device;
      setDeviceName(device.name || DEVICE_NAME_PRIMARY);
      setConnectionStep(`Device selected: ${device.name || '(unnamed)'}`);
      device.addEventListener('gattserverdisconnected', handleDisconnected);

      setConnectionStep('Connecting GATT server...');
      const server = await device.gatt.connect();
      serverRef.current = server;

      if (!server || !device.gatt.connected) {
        throw new Error('GATT 연결 직후 연결이 끊어졌습니다. ESP32 BLE 서버 또는 휴대폰 Bluetooth 상태를 확인하세요.');
      }

      setConnectionStep('Finding BLE service...');
      const service = await server.getPrimaryService(SERVICE_UUID);

      setConnectionStep('Finding notify characteristic...');
      const notifyChar = await service.getCharacteristic(NOTIFY_CHAR_UUID);
      notifyCharRef.current = notifyChar;
      setHasNotifyCharacteristic(true);

      setConnectionStep('Starting notifications...');
      notifyChar.addEventListener('characteristicvaluechanged', handleNotifyChanged);
      await notifyChar.startNotifications();

      try {
        setConnectionStep('Finding command characteristic...');
        const commandChar = await service.getCharacteristic(COMMAND_CHAR_UUID);
        commandCharRef.current = commandChar;
        setHasCommandCharacteristic(true);
      } catch (err) {
        commandCharRef.current = null;
        setHasCommandCharacteristic(false);
        setCommandWarning('BLE command characteristic을 찾지 못했습니다. 데이터 수신은 가능하지만 TARE/STOP BLE 전송은 안 됩니다. 송신기 코드에 12345678-1234-1234-1234-1234567890ad characteristic을 추가해야 합니다.');
      }

      setConnectionStep('Notifications started. Waiting for data...');
      setIsConnected(true);
      setIsStale(false);
      return true;
    } catch (err) {
      console.error('BLE connect error:', err);
      const message = err?.message || 'BLE 연결 실패';
      const bluefyHint = bleEnvironment.isIOS
        ? ' iPhone에서는 Safari가 아니라 Bluefy에서 HTTPS 주소로 접속해야 하며, 장치 선택은 Broad Scan / Bluefy Connect가 더 안정적입니다.'
        : '';
      setError(`${message}${bluefyHint}`);
      setConnectionStep(`BLE connect failed: ${message}`);
      setIsConnected(false);
      cleanupRefs();
      return false;
    }
  }, [bleEnvironment, cleanupRefs, handleDisconnected, handleNotifyChanged, isSupported]);

  const disconnect = useCallback(async () => {
    try {
      setConnectionStep('Disconnecting BLE...');
      if (notifyCharRef.current) {
        try {
          notifyCharRef.current.removeEventListener('characteristicvaluechanged', handleNotifyChanged);
          await notifyCharRef.current.stopNotifications();
        } catch (err) {
          // 일부 브라우저/펌웨어는 stopNotifications 중 에러를 낼 수 있으므로 연결 해제는 계속 진행한다.
        }
      }
      if (deviceRef.current?.gatt?.connected) {
        deviceRef.current.gatt.disconnect();
      }
    } catch (err) {
      console.warn('BLE disconnect warning:', err);
    } finally {
      setIsConnected(false);
      setIsStale(false);
      setConnectionStep('Disconnected');
      cleanupRefs();
    }
  }, [cleanupRefs, handleNotifyChanged]);

  const sendCommand = useCallback(async (command) => {
    if (!isConnected || !commandCharRef.current) {
      setError('BLE command characteristic이 연결되지 않았습니다. BLE 재연결 또는 송신기 펌웨어의 write characteristic 추가가 필요합니다.');
      return false;
    }

    const body = String(command || '').trim();
    if (!body) return false;

    try {
      setError('');
      const payload = textEncoderRef.current.encode(`${body}\n`);
      const characteristic = commandCharRef.current;
      if (typeof characteristic.writeValueWithoutResponse === 'function') {
        await characteristic.writeValueWithoutResponse(payload);
      } else if (typeof characteristic.writeValueWithResponse === 'function') {
        await characteristic.writeValueWithResponse(payload);
      } else {
        await characteristic.writeValue(payload);
      }
      setConnectionStep(`BLE command sent: ${body}`);
      return true;
    } catch (err) {
      console.error('BLE command write error:', err);
      setError(err?.message || 'BLE command 전송 실패');
      return false;
    }
  }, [isConnected]);

  const sendTare = useCallback(() => sendCommand('TARE'), [sendCommand]);
  const sendStop = useCallback(() => sendCommand('STOP'), [sendCommand]);
  const sendStart = useCallback(() => sendCommand('START'), [sendCommand]);

  const clearStats = useCallback(() => {
    latestQuatRef.current = [1, 0, 0, 0];
    latestPacketRef.current = DEFAULT_PACKET;
    bufferRef.current = '';
    setLatestPacket(DEFAULT_PACKET);
    setRecentPackets([]);
    setLastRawLine('');
    setLastInvalidReason('');
    setLastReceivedAt(null);
    setValidCount(0);
    setInvalidCount(0);
    setWarningCount(0);
    setIsStale(false);
  }, []);

  useEffect(() => {
    if (!isConnected) {
      setIsStale(false);
      return undefined;
    }

    const timer = window.setInterval(() => {
      setIsStale(Boolean(lastReceivedAt && Date.now() - lastReceivedAt > STALE_TIMEOUT_MS));
    }, 120);

    return () => window.clearInterval(timer);
  }, [isConnected, lastReceivedAt]);

  useEffect(() => {
    return () => {
      if (notifyCharRef.current) {
        try {
          notifyCharRef.current.removeEventListener('characteristicvaluechanged', handleNotifyChanged);
        } catch (err) {
          // ignore cleanup errors
        }
      }
      if (deviceRef.current?.gatt?.connected) {
        deviceRef.current.gatt.disconnect();
      }
    };
  }, [handleNotifyChanged]);

  return {
    latestPacketRef,
    isSupported,
    bleEnvironment,
    isConnected,
    connectionStatus,
    isStale,
    deviceName,
    expectedDeviceNames: [DEVICE_NAME_PRIMARY, DEVICE_NAME_FALLBACK],
    serviceUuid: SERVICE_UUID,
    notifyCharUuid: NOTIFY_CHAR_UUID,
    commandCharUuid: COMMAND_CHAR_UUID,
    connectionStep,
    error,
    commandWarning,
    lastRawLine,
    lastInvalidReason,
    lastReceivedAt,
    latestPacket,
    recentPackets,
    validCount,
    invalidCount,
    warningCount,
    validRatio,
    hasNotifyCharacteristic,
    hasCommandCharacteristic,
    connect,
    disconnect,
    sendCommand,
    sendTare,
    sendStop,
    sendStart,
    clearStats,
  };
}
