import React, { useEffect, useMemo, useState } from 'react';
import { Accordion, Badge, Button, Col, Form, Row } from 'react-bootstrap';

const DEFAULT_PRESET = 'imu_encoder_basic';

const IMU_GROUP_SELECTION_FIELDS = Object.freeze([
  'imu_q0', 'imu_q1', 'imu_q2', 'imu_q3',
  'q0', 'q1', 'q2', 'q3',
  'imu_roll_deg', 'imu_pitch_deg', 'imu_yaw_deg',
  'rollDeg', 'pitchDeg', 'yawDeg',
  'qerr_deg', 'wx', 'wy', 'wz',
  'timestamp', 'seq', 'source', 'commandType',
  'imuEulerSequence', 'angularRateSource',
]);

const GIMBAL_GROUP_SELECTION_FIELDS = Object.freeze([
  'enc_q0', 'enc_q1', 'enc_q2', 'enc_q3',
  'enc_q0_raw', 'enc_q1_raw', 'enc_q2_raw', 'enc_q3_raw',
  'enc_q0_aligned', 'enc_q1_aligned', 'enc_q2_aligned', 'enc_q3_aligned',
  'encoderQ0', 'encoderQ1', 'encoderQ2', 'encoderQ3',
  'encoder_roll_deg', 'encoder_pitch_deg', 'encoder_yaw_deg',
  'encoderRollDeg', 'encoderPitchDeg', 'encoderYawDeg',
  'enc_roll_raw_deg', 'enc_pitch_raw_deg', 'enc_yaw_raw_deg',
  'enc_roll_aligned_deg', 'enc_pitch_aligned_deg', 'enc_yaw_aligned_deg',
  'dot_raw', 'dot_abs', 'theta_err_deg', 'enc_age_ms', 'enc_valid',
  'encoder_alignment_source',
  'encoder_alignment_updated_at_ms',
  'encoder_alignment_sat_seq',
  'encoder_alignment_sat_timestamp_us',
  'enc_timer_x', 'enc_timer_y', 'enc_timer_z',
  'enc_age_x', 'enc_age_y', 'enc_age_z',
  'encoder_status', 'encoderStatus',
  'encoder_quat_source', 'encoderQuatSource',
  'encoder_rpy_source', 'encoderRpySource',
  'encoderEulerSequence', 'encoderSource',
]);

const FIELD_GROUPS = Object.freeze([
  {
    id: 'imu',
    label: 'IMU / Attitude',
    fields: [
      'q0', 'q1', 'q2', 'q3', 'rollDeg', 'pitchDeg', 'yawDeg',
      'imuEulerSequence', 'qerr_deg', 'source', 'timestamp', 'seq', 'commandType',
    ],
  },
  {
    id: 'rate',
    label: 'Angular Rate',
    fields: ['wx', 'wy', 'wz', 'angularRateSource'],
  },
  {
    id: 'encoder',
    label: 'Gimbal Encoder',
    fields: [
      'enc_q0', 'enc_q1', 'enc_q2', 'enc_q3',
      'enc_q0_raw', 'enc_q1_raw', 'enc_q2_raw', 'enc_q3_raw',
      'enc_q0_aligned', 'enc_q1_aligned', 'enc_q2_aligned', 'enc_q3_aligned',
      'encoderRollDeg', 'encoderPitchDeg', 'encoderYawDeg',
      'enc_roll_raw_deg', 'enc_pitch_raw_deg', 'enc_yaw_raw_deg',
      'enc_roll_aligned_deg', 'enc_pitch_aligned_deg', 'enc_yaw_aligned_deg',
      'dot_raw', 'dot_abs', 'theta_err_deg', 'enc_age_ms', 'enc_valid',
      'encoder_alignment_source',
      'encoderEulerSequence', 'encoderStatus', 'encoderSource',
      'encoderQuatSource', 'encoderRpySource',
      'enc_timer_x', 'enc_timer_y', 'enc_timer_z',
      'enc_age_x', 'enc_age_y', 'enc_age_z',
    ],
  },
  {
    id: 'wheel',
    label: 'Wheel Motor',
    fields: [
      'RPM1', 'RPM2', 'RPM3', 'RPMcmd1', 'RPMcmd2', 'RPMcmd3',
      'PWM1', 'PWM2', 'PWM3',
      'Tmotor1_Nm', 'Tmotor2_Nm', 'Tmotor3_Nm',
      'Tbodycmd_x_Nm', 'Tbodycmd_y_Nm', 'Tbodycmd_z_Nm',
    ],
  },
  {
    id: 'command',
    label: 'Command / Target',
    fields: [
      'desired_roll_deg', 'desired_pitch_deg', 'desired_yaw_deg',
      'targetQd0', 'targetQd1', 'targetQd2', 'targetQd3',
      'lastCommandLabel', 'lastCommandStatus',
    ],
  },
  {
    id: 'debug',
    label: 'Server / Debug',
    adminOnly: true,
    fields: ['publishStatus', 'failedPublishCount', 'serverUrl', 'latestSharedPacketAgeMs', 'rawPrefix', 'packetKey'],
  },
]);

const PRESETS = Object.freeze([
  {
    id: DEFAULT_PRESET,
    label: 'IMU vs Encoder Basic',
    fields: [
      'q0', 'q1', 'q2', 'q3', 'rollDeg', 'pitchDeg', 'yawDeg', 'imuEulerSequence',
      'qerr_deg', 'source', 'timestamp', 'seq',
      'enc_q0', 'enc_q1', 'enc_q2', 'enc_q3',
      'enc_q0_raw', 'enc_q1_raw', 'enc_q2_raw', 'enc_q3_raw',
      'enc_q0_aligned', 'enc_q1_aligned', 'enc_q2_aligned', 'enc_q3_aligned',
      'encoderRollDeg', 'encoderPitchDeg', 'encoderYawDeg',
      'enc_roll_aligned_deg', 'enc_pitch_aligned_deg', 'enc_yaw_aligned_deg',
      'dot_raw', 'dot_abs', 'theta_err_deg', 'enc_age_ms', 'enc_valid',
      'encoderEulerSequence', 'encoderStatus', 'encoderSource',
      'encoderQuatSource',
      'enc_timer_x', 'enc_timer_y', 'enc_timer_z',
      'enc_age_x', 'enc_age_y', 'enc_age_z',
      'wx', 'wy', 'wz',
      'RPM1', 'RPM2', 'RPM3', 'RPMcmd1', 'RPMcmd2', 'RPMcmd3',
    ],
  },
  {
    id: 'demo_basic',
    label: 'Demo Basic',
    fields: ['rollDeg', 'pitchDeg', 'yawDeg', 'qerr_deg', 'encoderRollDeg', 'encoderPitchDeg', 'encoderYawDeg', 'encoderStatus', 'RPM1', 'RPM2', 'RPM3'],
  },
  {
    id: 'control',
    label: 'Control',
    fields: ['qerr_deg', 'desired_roll_deg', 'desired_pitch_deg', 'desired_yaw_deg', 'RPMcmd1', 'RPMcmd2', 'RPMcmd3', 'lastCommandLabel', 'lastCommandStatus'],
  },
  {
    id: 'encoder',
    label: 'Encoder',
    fields: [
      'enc_q0', 'enc_q1', 'enc_q2', 'enc_q3',
      'enc_q0_raw', 'enc_q1_raw', 'enc_q2_raw', 'enc_q3_raw',
      'enc_q0_aligned', 'enc_q1_aligned', 'enc_q2_aligned', 'enc_q3_aligned',
      'encoderRollDeg', 'encoderPitchDeg', 'encoderYawDeg',
      'enc_roll_raw_deg', 'enc_pitch_raw_deg', 'enc_yaw_raw_deg',
      'enc_roll_aligned_deg', 'enc_pitch_aligned_deg', 'enc_yaw_aligned_deg',
      'dot_raw', 'dot_abs', 'theta_err_deg', 'enc_age_ms', 'enc_valid',
      'encoder_alignment_source',
      'encoderEulerSequence', 'encoderStatus', 'encoderSource',
      'encoderQuatSource',
      'enc_timer_x', 'enc_timer_y', 'enc_timer_z',
      'enc_age_x', 'enc_age_y', 'enc_age_z',
    ],
  },
  {
    id: 'motor',
    label: 'Motor',
    fields: ['RPM1', 'RPM2', 'RPM3', 'RPMcmd1', 'RPMcmd2', 'RPMcmd3', 'PWM1', 'PWM2', 'PWM3', 'Tmotor1_Nm', 'Tmotor2_Nm', 'Tmotor3_Nm'],
  },
  {
    id: 'debug',
    label: 'Debug',
    adminOnly: true,
    fields: ['publishStatus', 'failedPublishCount', 'serverUrl', 'latestSharedPacketAgeMs', 'rawPrefix', 'packetKey', 'source', 'timestamp', 'seq'],
  },
]);

const FIELD_META = Object.freeze({
  q0: { label: 'q0 / qw', section: 'imu', digits: 6, value: (p) => p.imu_q0 ?? p.q0 },
  q1: { label: 'q1 / qx', section: 'imu', digits: 6, value: (p) => p.imu_q1 ?? p.q1 },
  q2: { label: 'q2 / qy', section: 'imu', digits: 6, value: (p) => p.imu_q2 ?? p.q2 },
  q3: { label: 'q3 / qz', section: 'imu', digits: 6, value: (p) => p.imu_q3 ?? p.q3 },
  rollDeg: { label: 'Roll', section: 'imu', unit: 'deg', digits: 2, value: (p) => p.imu_roll_deg ?? p.roll_deg ?? p.Roll_deg ?? p.rollDeg },
  pitchDeg: { label: 'Pitch', section: 'imu', unit: 'deg', digits: 2, value: (p) => p.imu_pitch_deg ?? p.pitch_deg ?? p.Pitch_deg ?? p.pitchDeg },
  yawDeg: { label: 'Yaw', section: 'imu', unit: 'deg', digits: 2, value: (p) => p.imu_yaw_deg ?? p.yaw_deg ?? p.Yaw_deg ?? p.yawDeg },
  imuEulerSequence: { label: 'IMU RPY sequence', section: 'imu', value: (p) => p.imuEulerSequence || 'ZYX' },
  qerr_deg: { label: 'qerr_deg', section: 'imu', unit: 'deg', digits: 2, value: (p) => p.qerr_deg ?? p.qerrDeg },
  source: { label: 'Source', section: 'imu', value: (p) => p.sample_type || p.sampleType || p.rawPrefix || p.sourceLabel || p.source },
  timestamp: { label: 'timestamp', section: 'imu', digits: 0, value: (p) => p.timestamp ?? p.ebimu_timestamp_ms ?? p.ebimuTimestampMs },
  seq: { label: 'seq', section: 'imu', digits: 0, value: (p) => p.seq ?? p.rxCount },
  commandType: { label: 'commandType', section: 'imu', digits: 0, value: (p) => p.commandType ?? p.command_type },

  wx: { label: 'wx', section: 'motor', unit: 'rad/s', digits: 4, value: (p) => p.wx },
  wy: { label: 'wy', section: 'motor', unit: 'rad/s', digits: 4, value: (p) => p.wy },
  wz: { label: 'wz', section: 'motor', unit: 'rad/s', digits: 4, value: (p) => p.wzRaw ?? p.wz },
  angularRateSource: { label: 'angular rate source', section: 'motor', value: (p) => p.angularRateSource },

  enc_x_deg: { label: 'Legacy Enc X', section: 'encoder', unit: 'deg', digits: 2, value: (p) => p.enc_x_deg ?? p.encoderXDeg ?? p.encoder?.x },
  enc_y_deg: { label: 'Legacy Enc Y', section: 'encoder', unit: 'deg', digits: 2, value: (p) => p.enc_y_deg ?? p.encoderYDeg ?? p.encoder?.y },
  enc_z_deg: { label: 'Legacy Enc Z', section: 'encoder', unit: 'deg', digits: 2, value: (p) => p.enc_z_deg ?? p.encoderZDeg ?? p.encoder?.z },
  enc_q0: { label: 'enc_q0', section: 'encoder', digits: 6, value: (p) => p.enc_q0 ?? p.encoderQ0 ?? p.encoder?.q0 },
  enc_q1: { label: 'enc_q1', section: 'encoder', digits: 6, value: (p) => p.enc_q1 ?? p.encoderQ1 ?? p.encoder?.q1 },
  enc_q2: { label: 'enc_q2', section: 'encoder', digits: 6, value: (p) => p.enc_q2 ?? p.encoderQ2 ?? p.encoder?.q2 },
  enc_q3: { label: 'enc_q3', section: 'encoder', digits: 6, value: (p) => p.enc_q3 ?? p.encoderQ3 ?? p.encoder?.q3 },
  enc_q0_raw: { label: 'enc_q0 raw', section: 'encoder', digits: 6, value: (p) => p.enc_q0_raw ?? p.encoderQ0Raw ?? p.encoder?.q0Raw ?? p.enc_q0 ?? p.encoderQ0 ?? p.encoder?.q0 },
  enc_q1_raw: { label: 'enc_q1 raw', section: 'encoder', digits: 6, value: (p) => p.enc_q1_raw ?? p.encoderQ1Raw ?? p.encoder?.q1Raw ?? p.enc_q1 ?? p.encoderQ1 ?? p.encoder?.q1 },
  enc_q2_raw: { label: 'enc_q2 raw', section: 'encoder', digits: 6, value: (p) => p.enc_q2_raw ?? p.encoderQ2Raw ?? p.encoder?.q2Raw ?? p.enc_q2 ?? p.encoderQ2 ?? p.encoder?.q2 },
  enc_q3_raw: { label: 'enc_q3 raw', section: 'encoder', digits: 6, value: (p) => p.enc_q3_raw ?? p.encoderQ3Raw ?? p.encoder?.q3Raw ?? p.enc_q3 ?? p.encoderQ3 ?? p.encoder?.q3 },
  enc_q0_aligned: { label: 'enc_q0 aligned', section: 'encoder', digits: 6, value: (p) => p.enc_q0_aligned ?? p.encoderQ0Aligned ?? p.encoder?.q0Aligned },
  enc_q1_aligned: { label: 'enc_q1 aligned', section: 'encoder', digits: 6, value: (p) => p.enc_q1_aligned ?? p.encoderQ1Aligned ?? p.encoder?.q1Aligned },
  enc_q2_aligned: { label: 'enc_q2 aligned', section: 'encoder', digits: 6, value: (p) => p.enc_q2_aligned ?? p.encoderQ2Aligned ?? p.encoder?.q2Aligned },
  enc_q3_aligned: { label: 'enc_q3 aligned', section: 'encoder', digits: 6, value: (p) => p.enc_q3_aligned ?? p.encoderQ3Aligned ?? p.encoder?.q3Aligned },
  encoderRollDeg: { label: 'Encoder Roll', section: 'encoder', unit: 'deg', digits: 2, unavailableWithoutQuat: true, value: (p) => p.encoder_roll_deg ?? p.encoderRollDeg ?? p.encoder?.rollDeg },
  encoderPitchDeg: { label: 'Encoder Pitch', section: 'encoder', unit: 'deg', digits: 2, unavailableWithoutQuat: true, value: (p) => p.encoder_pitch_deg ?? p.encoderPitchDeg ?? p.encoder?.pitchDeg },
  encoderYawDeg: { label: 'Encoder Yaw', section: 'encoder', unit: 'deg', digits: 2, unavailableWithoutQuat: true, value: (p) => p.encoder_yaw_deg ?? p.encoderYawDeg ?? p.encoder?.yawDeg },
  enc_roll_raw_deg: { label: 'Encoder Roll raw', section: 'encoder', unit: 'deg', digits: 2, unavailableWithoutQuat: true, value: (p) => p.enc_roll_raw_deg ?? p.encoderRollDeg ?? p.encoder?.rollDeg },
  enc_pitch_raw_deg: { label: 'Encoder Pitch raw', section: 'encoder', unit: 'deg', digits: 2, unavailableWithoutQuat: true, value: (p) => p.enc_pitch_raw_deg ?? p.encoderPitchDeg ?? p.encoder?.pitchDeg },
  enc_yaw_raw_deg: { label: 'Encoder Yaw raw', section: 'encoder', unit: 'deg', digits: 2, unavailableWithoutQuat: true, value: (p) => p.enc_yaw_raw_deg ?? p.encoderYawDeg ?? p.encoder?.yawDeg },
  enc_roll_aligned_deg: { label: 'Encoder Roll aligned', section: 'encoder', unit: 'deg', digits: 2, value: (p) => p.enc_roll_aligned_deg ?? p.encoderRollAlignedDeg ?? p.encoder?.rollAlignedDeg },
  enc_pitch_aligned_deg: { label: 'Encoder Pitch aligned', section: 'encoder', unit: 'deg', digits: 2, value: (p) => p.enc_pitch_aligned_deg ?? p.encoderPitchAlignedDeg ?? p.encoder?.pitchAlignedDeg },
  enc_yaw_aligned_deg: { label: 'Encoder Yaw aligned', section: 'encoder', unit: 'deg', digits: 2, value: (p) => p.enc_yaw_aligned_deg ?? p.encoderYawAlignedDeg ?? p.encoder?.yawAlignedDeg },
  dot_raw: { label: 'dot_raw', section: 'encoder', digits: 6, value: (p) => p.dot_raw ?? p.dotRaw ?? p.encoder?.dotRaw },
  dot_abs: { label: 'dot_abs', section: 'encoder', digits: 6, value: (p) => p.dot_abs ?? p.dotAbs ?? p.encoder?.dotAbs },
  theta_err_deg: { label: 'theta_err_deg', section: 'encoder', unit: 'deg', digits: 3, value: (p) => p.theta_err_deg ?? p.thetaErrDeg ?? p.encoder?.thetaErrDeg },
  enc_age_ms: { label: 'enc_age_ms', section: 'encoder', unit: 'ms', digits: 0, value: (p) => p.enc_age_ms ?? p.encAgeMs ?? p.encoder?.alignmentAgeMs },
  enc_valid: { label: 'enc_valid', section: 'encoder', digits: 0, value: (p) => p.enc_valid ?? p.encValid ?? (p.encoder?.alignmentValid === true ? 1 : p.encoder?.alignmentValid === false ? 0 : undefined) },
  encoder_alignment_source: { label: 'alignment source', section: 'encoder', value: (p) => p.encoder_alignment_source ?? p.encoderAlignmentSource ?? p.encoder?.alignmentSource },
  encoder_alignment_updated_at_ms: { label: 'alignment updated', section: 'encoder', unit: 'ms', digits: 0, value: (p) => p.encoder_alignment_updated_at_ms ?? p.encoderAlignmentUpdatedAtMs ?? p.encoder?.alignmentUpdatedAtMs },
  encoder_alignment_sat_seq: { label: 'alignment TEL seq', section: 'encoder', digits: 0, value: (p) => p.encoder_alignment_sat_seq ?? p.encoderAlignmentSatSeq ?? p.encoder?.alignmentSatSeq },
  encoder_alignment_sat_timestamp_us: { label: 'alignment TEL timestamp', section: 'encoder', digits: 0, value: (p) => p.encoder_alignment_sat_timestamp_us ?? p.encoderAlignmentSatTimestampUs ?? p.encoder?.alignmentSatTimestampUs },
  encoderAlignmentSource: { label: 'alignment source', section: 'encoder', value: (p) => p.encoder_alignment_source ?? p.encoderAlignmentSource ?? p.encoder?.alignmentSource },
  encoderAlignmentUpdatedAtMs: { label: 'alignment updated', section: 'encoder', unit: 'ms', digits: 0, value: (p) => p.encoder_alignment_updated_at_ms ?? p.encoderAlignmentUpdatedAtMs ?? p.encoder?.alignmentUpdatedAtMs },
  encoderAlignmentSatSeq: { label: 'alignment TEL seq', section: 'encoder', digits: 0, value: (p) => p.encoder_alignment_sat_seq ?? p.encoderAlignmentSatSeq ?? p.encoder?.alignmentSatSeq },
  encoderAlignmentSatTimestampUs: { label: 'alignment TEL timestamp', section: 'encoder', digits: 0, value: (p) => p.encoder_alignment_sat_timestamp_us ?? p.encoderAlignmentSatTimestampUs ?? p.encoder?.alignmentSatTimestampUs },
  encoderAngleToQuatSequence: { label: 'Legacy angle sequence', section: 'encoder', value: (p) => p.encoderAngleToQuatSequence ?? p.encoder?.angleToQuatSequence ?? 'ZYX' },
  encoderEulerSequence: { label: 'Encoder RPY sequence', section: 'encoder', value: (p) => p.encoderEulerSequence ?? p.encoder?.eulerSequence ?? 'ZYX' },
  encoderStatus: { label: 'Encoder status', section: 'encoder', value: (p) => p.encoder_status ?? p.encoderStatus ?? p.encoder?.status },
  encoderSource: { label: 'Encoder source', section: 'encoder', value: (p) => p.encoderSource ?? p.encoder?.source },
  encoderQuatSource: { label: 'Encoder quat source', section: 'encoder', value: (p) => p.encoder_quat_source ?? p.encoderQuatSource ?? p.encoder?.quatSource },
  encoderRpySource: { label: 'Encoder RPY source', section: 'encoder', value: (p) => p.encoder_rpy_source ?? p.encoderRpySource ?? p.encoder?.rpySource },
  enc_timer_x: { label: 'timer X', section: 'encoder', digits: 0, value: (p) => p.enc_timer_x ?? p.encoderTimerX ?? p.encoder?.timerX ?? p.encoder?.timer_x },
  enc_timer_y: { label: 'timer Y', section: 'encoder', digits: 0, value: (p) => p.enc_timer_y ?? p.encoderTimerY ?? p.encoder?.timerY ?? p.encoder?.timer_y },
  enc_timer_z: { label: 'timer Z', section: 'encoder', digits: 0, value: (p) => p.enc_timer_z ?? p.encoderTimerZ ?? p.encoder?.timerZ ?? p.encoder?.timer_z },
  enc_age_x: { label: 'age X', section: 'encoder', unit: 'ms', digits: 0, value: (p) => p.enc_age_x ?? p.encoderAgeX ?? p.encoder?.ageX ?? p.encoder?.age_x },
  enc_age_y: { label: 'age Y', section: 'encoder', unit: 'ms', digits: 0, value: (p) => p.enc_age_y ?? p.encoderAgeY ?? p.encoder?.ageY ?? p.encoder?.age_y },
  enc_age_z: { label: 'age Z', section: 'encoder', unit: 'ms', digits: 0, value: (p) => p.enc_age_z ?? p.encoderAgeZ ?? p.encoder?.ageZ ?? p.encoder?.age_z },

  RPM1: { label: 'RPM1', section: 'motor', digits: 1, value: (p) => p.RPM1 },
  RPM2: { label: 'RPM2', section: 'motor', digits: 1, value: (p) => p.RPM2 },
  RPM3: { label: 'RPM3', section: 'motor', digits: 1, value: (p) => p.RPM3 },
  RPMcmd1: { label: 'RPMcmd1', section: 'motor', digits: 1, value: (p) => p.RPMcmd1 },
  RPMcmd2: { label: 'RPMcmd2', section: 'motor', digits: 1, value: (p) => p.RPMcmd2 },
  RPMcmd3: { label: 'RPMcmd3', section: 'motor', digits: 1, value: (p) => p.RPMcmd3 },
  PWM1: { label: 'PWM1', section: 'motor', digits: 1, value: (p) => p.PWM1 },
  PWM2: { label: 'PWM2', section: 'motor', digits: 1, value: (p) => p.PWM2 },
  PWM3: { label: 'PWM3', section: 'motor', digits: 1, value: (p) => p.PWM3 },
  Tmotor1_Nm: { label: 'Tmotor1', section: 'motor', unit: 'Nm', digits: 5, value: (p) => p.Tmotor1_Nm },
  Tmotor2_Nm: { label: 'Tmotor2', section: 'motor', unit: 'Nm', digits: 5, value: (p) => p.Tmotor2_Nm },
  Tmotor3_Nm: { label: 'Tmotor3', section: 'motor', unit: 'Nm', digits: 5, value: (p) => p.Tmotor3_Nm },
  Tbodycmd_x_Nm: { label: 'Tbodycmd X', section: 'motor', unit: 'Nm', digits: 5, value: (p) => p.Tbodycmd_x_Nm },
  Tbodycmd_y_Nm: { label: 'Tbodycmd Y', section: 'motor', unit: 'Nm', digits: 5, value: (p) => p.Tbodycmd_y_Nm },
  Tbodycmd_z_Nm: { label: 'Tbodycmd Z', section: 'motor', unit: 'Nm', digits: 5, value: (p) => p.Tbodycmd_z_Nm },

  desired_roll_deg: { label: 'desired roll', section: 'extra', unit: 'deg', digits: 2, value: (p) => p.desired_roll_deg ?? p.desiredRollDeg },
  desired_pitch_deg: { label: 'desired pitch', section: 'extra', unit: 'deg', digits: 2, value: (p) => p.desired_pitch_deg ?? p.desiredPitchDeg },
  desired_yaw_deg: { label: 'desired yaw', section: 'extra', unit: 'deg', digits: 2, value: (p) => p.desired_yaw_deg ?? p.desiredYawDeg },
  targetQd0: { label: 'qd0', section: 'extra', digits: 6, value: (p) => p.targetQd0 ?? p.qd0 },
  targetQd1: { label: 'qd1', section: 'extra', digits: 6, value: (p) => p.targetQd1 ?? p.qd1 },
  targetQd2: { label: 'qd2', section: 'extra', digits: 6, value: (p) => p.targetQd2 ?? p.qd2 },
  targetQd3: { label: 'qd3', section: 'extra', digits: 6, value: (p) => p.targetQd3 ?? p.qd3 },
  lastCommandLabel: { label: 'last command', section: 'extra', value: (p, s) => p.lastCommandLabel || s.lastCommandInfo?.label || s.lastCommand || '-' },
  lastCommandStatus: { label: 'command status', section: 'extra', value: (p, s) => s.lastCommandInfo?.reason || (p.lastCommandDenied ? 'denied' : '-') },

  publishStatus: { label: 'publish status', section: 'extra', adminOnly: true, value: (p, s) => s.liveStatus || '-' },
  failedPublishCount: { label: 'failed publish count', section: 'extra', adminOnly: true, value: (p, s) => s.failedPublishCount ?? '-' },
  serverUrl: { label: 'server URL', section: 'extra', adminOnly: true, value: (p, s) => s.serverUrl || '-' },
  latestSharedPacketAgeMs: { label: 'shared age', section: 'extra', adminOnly: true, unit: 'ms', digits: 0, value: (p, s) => s.latestSharedPacketAgeMs ?? s.ageMs },
  rawPrefix: { label: 'raw prefix', section: 'extra', adminOnly: true, value: (p) => p.rawPrefix || p.raw_prefix || '-' },
  packetKey: { label: 'packet key', section: 'extra', adminOnly: true, value: (p) => p.packet_key || p.packetKey || '-' },
});

function getPreset(id) {
  return PRESETS.find((preset) => preset.id === id) || PRESETS[0];
}

function safeReadSelection(storageKey) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.fields) ? parsed.fields.filter((key) => FIELD_META[key]) : null;
  } catch (_) {
    return null;
  }
}

function safeWriteSelection(storageKey, fields) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({ preset: 'custom', fields }));
  } catch (_) {}
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatValue(value, meta, packet) {
  if (meta.unavailableWithoutQuat && !Boolean(packet.encoderHasQuaternion)) return 'unavailable';
  const number = finiteNumber(value);
  if (number !== null) {
    const digits = Number.isInteger(meta.digits) ? meta.digits : 3;
    return `${number.toFixed(digits)}${meta.unit ? ` ${meta.unit}` : ''}`;
  }
  if (value === null || value === undefined || value === '') return '-';
  return String(value);
}

function valueRows(fields, latest, status, section, isAdmin) {
  return fields
    .map((key) => [key, FIELD_META[key]])
    .filter(([, meta]) => meta && meta.section === section && (!meta.adminOnly || isAdmin))
    .map(([key, meta]) => ({
      key,
      label: meta.label,
      value: formatValue(meta.value(latest, status), meta, latest),
    }));
}

function ValueGrid({ title, rows }) {
  return (
    <div className="serial-value-card telemetry-data-card rounded p-2">
      <div className="serial-section-title mb-2">{title}</div>
      {rows.length ? rows.map((row) => (
        <div key={row.key || row.label} className="serial-value-row d-flex justify-content-between gap-2">
          <span style={{ minWidth: 0 }}>{row.label}</span>
          <strong style={{ minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word', textAlign: 'right' }}>{row.value}</strong>
        </div>
      )) : <div className="server-small-note">No fields selected.</div>}
    </div>
  );
}

function CompactGrid({ rows }) {
  return (
    <div className="serial-value-card telemetry-data-card rounded p-2">
      <div className="serial-section-title mb-2">Angular Rate / Wheel RPM</div>
      <div className="telemetry-compact-grid">
        {rows.length ? rows.map((row) => (
          <div key={row.key || row.label} className="telemetry-compact-item">
            <span>{row.label}</span>
            <strong>{row.value}</strong>
          </div>
        )) : <div className="server-small-note">No fields selected.</div>}
      </div>
    </div>
  );
}

export default function TelemetryDataView({
  latest = {},
  status = {},
  isAdmin = false,
  storageKey = 'cubliTelemetryDataView',
}) {
  const defaultFields = getPreset(DEFAULT_PRESET).fields;
  const [selectedFields, setSelectedFields] = useState(() => safeReadSelection(storageKey) || defaultFields);
  const [presetId, setPresetId] = useState(DEFAULT_PRESET);

  const visiblePresets = useMemo(() => PRESETS.filter((preset) => !preset.adminOnly || isAdmin), [isAdmin]);
  const visibleGroups = useMemo(() => FIELD_GROUPS.filter((group) => !group.adminOnly || isAdmin), [isAdmin]);
  const selectedSet = useMemo(() => new Set(selectedFields.filter((key) => FIELD_META[key] && (!FIELD_META[key].adminOnly || isAdmin))), [isAdmin, selectedFields]);
  const fields = useMemo(() => Array.from(selectedSet), [selectedSet]);

  useEffect(() => {
    safeWriteSelection(storageKey, fields);
  }, [fields, storageKey]);

  const handlePresetChange = (nextPresetId) => {
    const preset = getPreset(nextPresetId);
    setPresetId(preset.id);
    setSelectedFields(preset.fields.filter((key) => FIELD_META[key] && (!FIELD_META[key].adminOnly || isAdmin)));
  };

  const toggleField = (fieldKey) => {
    setPresetId('custom');
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) next.delete(fieldKey);
      else next.add(fieldKey);
      return Array.from(next);
    });
  };

  const setFieldGroupSelected = (fieldKeys, selected) => {
    const allowedKeys = fieldKeys.filter((key) => FIELD_META[key] && (!FIELD_META[key].adminOnly || isAdmin));
    setPresetId('custom');
    setSelectedFields((prev) => {
      const next = new Set(prev.filter((key) => FIELD_META[key] && (!FIELD_META[key].adminOnly || isAdmin)));
      allowedKeys.forEach((key) => {
        if (selected) next.add(key);
        else next.delete(key);
      });
      return Array.from(next);
    });
  };

  const imuRows = valueRows(fields, latest, status, 'imu', isAdmin);
  const encoderRows = valueRows(fields, latest, status, 'encoder', isAdmin);
  const motorRows = valueRows(fields, latest, status, 'motor', isAdmin);
  const extraRows = valueRows(fields, latest, status, 'extra', isAdmin);

  return (
    <div className="telemetry-data-view mb-3">
      <div className="serial-control-card rounded p-3 mb-3">
        <div className="d-flex justify-content-between align-items-center gap-2 mb-2">
          <div>
            <div className="serial-section-title">Data View</div>
            <div className="server-small-note">
              Raw ENC is the Remote quaternion; aligned ENC is a comparison value that flips q/-q as one whole quaternion to match TEL sign.
            </div>
          </div>
          <Badge bg="info">{fields.length}</Badge>
        </div>
        <Row className="g-2 align-items-end">
          <Col xs={12} md={6}>
            <Form.Label className="serial-mini-label">Preset</Form.Label>
            <Form.Select size="sm" value={presetId} onChange={(event) => handlePresetChange(event.target.value)}>
              {presetId === 'custom' ? <option value="custom">Custom</option> : null}
              {visiblePresets.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.label}</option>
              ))}
            </Form.Select>
          </Col>
          <Col xs={12} md={6}>
            <Button size="sm" variant="outline-light" className="w-100" onClick={() => handlePresetChange(DEFAULT_PRESET)}>
              Reset to IMU vs Encoder Basic
            </Button>
          </Col>
        </Row>
        <Accordion className="command-accordion mt-3" flush>
          <Accordion.Item eventKey="selector" className="command-accordion-item">
            <Accordion.Header>Data Selector</Accordion.Header>
            <Accordion.Body>
              <div className="data-selector-actions d-flex flex-wrap gap-2 mb-3">
                <Button size="sm" variant="outline-info" onClick={() => setFieldGroupSelected(IMU_GROUP_SELECTION_FIELDS, true)}>
                  Select all IMU
                </Button>
                <Button size="sm" variant="outline-secondary" onClick={() => setFieldGroupSelected(IMU_GROUP_SELECTION_FIELDS, false)}>
                  Clear IMU
                </Button>
                <Button size="sm" variant="outline-info" onClick={() => setFieldGroupSelected(GIMBAL_GROUP_SELECTION_FIELDS, true)}>
                  Select all GIMBAL
                </Button>
                <Button size="sm" variant="outline-secondary" onClick={() => setFieldGroupSelected(GIMBAL_GROUP_SELECTION_FIELDS, false)}>
                  Clear GIMBAL
                </Button>
              </div>
              <Row className="g-2">
                {visibleGroups.map((group) => (
                  <Col xs={12} md={6} key={group.id}>
                    <div className="serial-subsection-title mb-2">{group.label}</div>
                    <div className="d-grid gap-1">
                      {group.fields.filter((fieldKey) => FIELD_META[fieldKey]).map((fieldKey) => (
                        <Form.Check
                          key={fieldKey}
                          type="checkbox"
                          id={`${storageKey}-${fieldKey}`}
                          label={FIELD_META[fieldKey].label}
                          checked={selectedSet.has(fieldKey)}
                          onChange={() => toggleField(fieldKey)}
                        />
                      ))}
                    </div>
                  </Col>
                ))}
              </Row>
            </Accordion.Body>
          </Accordion.Item>
        </Accordion>
      </div>

      <Row className="g-2 mb-2">
        <Col xs={12} xl={6}><ValueGrid title="IMU / TEL Attitude" rows={imuRows} /></Col>
        <Col xs={12} xl={6}><ValueGrid title="Gimbal Encoder Reference" rows={encoderRows} /></Col>
      </Row>
      <CompactGrid rows={motorRows} />
      {extraRows.length ? (
        <Row className="g-2 mt-2">
          <Col xs={12}><ValueGrid title={isAdmin ? 'Command / Debug' : 'Command / Target'} rows={extraRows} /></Col>
        </Row>
      ) : null}
    </div>
  );
}
