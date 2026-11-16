export const TUTORIAL_VERSION = 'tutorial-v3';

export const TUTORIAL_STORAGE_KEYS = Object.freeze({
  dontShowAgain: 'cubliTutorialDontShowAgain',
  guideMode: 'cubliTutorialGuideMode',
  version: 'cubliTutorialVersion',
});

export const GUIDE_MODES = Object.freeze({ viewer: 'viewer', admin: 'admin' });

export function normalizeTutorialGuideMode(mode) {
  return mode === GUIDE_MODES.admin ? GUIDE_MODES.admin : GUIDE_MODES.viewer;
}

export function getTutorialGuideModeForRole(role) {
  return String(role || '').toLowerCase() === 'admin' ? GUIDE_MODES.admin : GUIDE_MODES.viewer;
}

const part = (title, captures, ...body) => ({
  title,
  body,
  captures: (typeof captures === 'string' ? [[captures, title]] : captures)
    .map(([file, label]) => ({ image: `/tutorial/v3/${file}.jpg`, label })),
});

const screens = [
  part('첫 화면과 3D 보기', 'overview',
    '처음 열면 Viewer로 들어옵니다. 이름은 Change Name에서 바꿉니다.',
    '3D 화면은 드래그로 돌리고 Zoom In과 Zoom Out으로 크기를 바꿉니다. 오른쪽 슬라이더로 패널 폭을 조절합니다.'),
  part('서버 연결', [['server', '서버 주소'], ['receiver', '수신 상태']],
    'Server URL을 확인하고 Test Connection을 누릅니다.',
    'Connected가 뜨면 Receiver Info에서 송신자와 수신 상태를 봅니다. 3D 화면은 IMU 자세를 표시합니다.'),
  part('데이터 선택과 실시간 그래프', [['data', '데이터 선택'], ['plot', '실시간 그래프']],
    'Data View에서 Preset을 고르고 Data Selector에서 보고 싶은 항목을 선택합니다.',
    'Live Plot은 실시간 추이를, Wheel Speed Graph는 휠 속도와 명령값을 보여 줍니다.'),
  part('CSV 기록', 'csv',
    'Start CSV Logging을 눌러 기록을 시작합니다.',
    'Stop & Download Telemetry CSV는 IMU/TEL을, Stop & Download Encoder CSV는 엔코더 값을 저장합니다.'),
];

const connections = [
  part('관리자 로그인과 USB 연결', [['login', '로그인'], ['serial', 'USB 연결']],
    'Server에서 Admin Login을 열어 로그인합니다.',
    'Remote MCU를 USB로 연결합니다. Web Serial 탭에서 Connect Receiver를 눌러 해당 포트를 선택합니다.'),
  part('BLE 연결', 'ble',
    '관리자 화면에서 BLE 탭을 열고 Connect BLE IMU를 눌러 장치를 선택합니다.',
    '자세 표시 소스로 쓰려면 BLE 입력 사용을 켭니다.'),
  part('휴대폰 센서', 'phone',
    'Phone 탭에서 휴대폰 센서를 켭니다. 브라우저가 물으면 센서 접근을 허용합니다.',
    '휴대폰을 기준 자세에 둔 뒤 영점을 맞춥니다.'),
];

const admin = [
  part('공유와 송신자', 'sharing',
    'USB 연결 뒤 Server Sharing에서 Auto Sharing과 Active Publisher 상태를 확인합니다.',
    '다른 관리자가 송신 중이면 먼저 연결 상태를 확인합니다. 송신 PC를 교체할 때 Force Take Over Publisher를 사용합니다.'),
  part('제어권 부여', 'clients',
    'Client List / Viewer List를 엽니다. 해당 사용자에게 제어권을 주거나 Revoke Control로 회수합니다.'),
  part('자세와 휠 제어', [['control', '영점·정지'], ['commands', '목표 자세'], ['rpm', '휠 속도'], ['pid', 'PID 이득']],
    'Control에서 자세 초기화, 엔코더 영점, 정지를 합니다.',
    'Target Attitude에서 축별 각도를 지정합니다. Wheel RPM Command에서 휠 속도를, Attitude PID Gain에서 이득을 설정합니다.'),
  part('IMU 설정과 직접 전송', [
    ['imu', '스트림'], ['magnetometer', '자기계'], ['gyro', '자이로'], ['accelerometer', '가속도계'],
    ['direct-command', '직접 전송'], ['source', '데이터 소스'],
  ],
    'EBIMU Stream에서 수신을 시작하거나 멈춥니다. Magnetometer, Gyro Range, Accelerometer에서 센서를 설정합니다.',
    'USB 연결 PC에서 직접 보낼 때는 Local Web Serial Command를 엽니다.'),
  part('3D 표시 설정', [['visual', '3D 표시'], ['rpy', 'RPY 순서']],
    '3D Visual Settings에서 기준축, 거울 반전, 휠 표시를 조정합니다. 자세 각도 순서는 Server의 RPY Display Convention에서 고릅니다.'),
];

const mass = [
  part('질량중심 측정', [['cg', '측정·예상값'], ['cg-diagram', 'CG 도식']],
    '판과 지지발을 올린 상태로 저울 영점을 맞춥니다. 물체를 올리고 P1·P2·P3 값을 넣으면 중심 편차와 총 질량이 나옵니다.',
    '판 질량과 기준물체 질량을 넣으면 각각의 예상값과 영점 전 합계가 나옵니다.'),
  part('관성·마찰 측정', [['inertia', '입력·결과'], ['inertia-graph', '속도 그래프']],
    '측정 축, 낙하추 질량, 유효 반경을 입력하고 엔코더 CSV를 넣습니다.',
    '시간 열과 각도 단위를 확인한 뒤 관성·마찰 계산을 누릅니다.'),
  part('질량특성 기록과 비교', 'records',
    '측정 화면에서 기록을 저장합니다. 기록·비교에서 이전 측정과 비교하거나 JSON으로 내보냅니다.'),
];

export const TUTORIAL_GUIDES = {
  viewer: [
    { title: '화면·데이터', steps: screens },
    { title: '질량특성', steps: mass },
  ],
  admin: [
    { title: '장치 연결', steps: connections },
    { title: '공유·제어', steps: admin },
    { title: '화면·데이터', steps: screens },
    { title: '질량특성', steps: mass },
  ],
};
