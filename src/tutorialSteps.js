export const TUTORIAL_VERSION = 'tutorial-v2';

export const TUTORIAL_STORAGE_KEYS = Object.freeze({
  dontShowAgain: 'cubliTutorialDontShowAgain',
  guideMode: 'cubliTutorialGuideMode',
  version: 'cubliTutorialVersion',
});

export const GUIDE_MODES = Object.freeze({
  viewer: 'viewer',
  admin: 'admin',
});

const image = (filename) => `/tutorial/${filename}`;

export function normalizeTutorialGuideMode(mode) {
  return mode === GUIDE_MODES.admin ? GUIDE_MODES.admin : GUIDE_MODES.viewer;
}

export function getTutorialGuideModeForRole(role) {
  return String(role || '').toLowerCase() === 'admin' ? GUIDE_MODES.admin : GUIDE_MODES.viewer;
}

export const TUTORIAL_GUIDES = Object.freeze({
  viewer: Object.freeze({
    label: 'Viewer Guide',
    summary: 'Monitoring flow for users who watch shared telemetry.',
    steps: Object.freeze([
      Object.freeze({
        title: 'Start Screen / Login',
        image: image('login.png'),
        body: Object.freeze([
          '처음 접속하면 Viewer 상태로 들어온다.',
          'Admin Login은 관리자만 사용한다.',
          'Viewer는 데이터 모니터링 중심이다.',
        ]),
      }),
      Object.freeze({
        title: '3D Cubli View',
        image: image('cubli-zoom.png'),
        body: Object.freeze([
          '왼쪽 3D Cubli는 IMU/TEL quaternion 기준으로 표시된다.',
          'Zoom In / Zoom Out으로 모델 크기를 조정할 수 있다.',
          'Encoder quaternion은 reference용이며 3D attitude를 덮어쓰지 않는다.',
        ]),
      }),
      Object.freeze({
        title: 'Layout Resize',
        image: image('layout-resize.png'),
        body: Object.freeze([
          '화면 오른쪽 패널 폭을 조정할 수 있다.',
          '3D 화면과 데이터 UI를 보기 좋게 나눠서 사용한다.',
        ]),
      }),
      Object.freeze({
        title: 'Data View',
        image: image('data-view-selector.png'),
        body: Object.freeze([
          'Data View에서 원하는 데이터만 숫자로 관측할 수 있다.',
          '기본 preset은 IMU vs Encoder Basic이다.',
          'IMU/TEL attitude와 Gimbal Encoder Reference를 좌우로 비교한다.',
        ]),
      }),
      Object.freeze({
        title: 'Live Plot',
        image: image('live-plot.png'),
        body: Object.freeze([
          'Live Plot은 실시간 그래프를 보여준다.',
          '필요하지 않을 때는 Show 토글을 꺼서 화면 부담을 줄인다.',
          '화면 느림이나 멈춤이 있으면 Live Plot을 먼저 꺼본다.',
        ]),
      }),
      Object.freeze({
        title: 'CSV Logging',
        image: image('csv-logging.png'),
        body: Object.freeze([
          'Start CSV Logging으로 저장을 시작한다.',
          'Stop & Download CSV로 저장된 데이터를 다운로드한다.',
          'CSV는 telemetry timestamp 기준으로 정렬된다.',
          'ENC-only row는 encoder reference update로 저장된다.',
        ]),
      }),
      Object.freeze({
        title: 'Command Access',
        image: image('command-panel.png'),
        body: Object.freeze([
          'Viewer는 기본적으로 Command를 사용할 수 없다.',
          'Admin이 Controller 권한을 부여하면 일부 command를 사용할 수 있다.',
          'Command는 서버 queue를 통해 Admin Web Serial Bridge로 전달된다.',
        ]),
      }),
    ]),
  }),
  admin: Object.freeze({
    label: 'Admin Guide',
    summary: 'Bridge flow for Web Serial, sharing, and command relay.',
    steps: Object.freeze([
      Object.freeze({
        title: 'Admin Login',
        image: image('login.png'),
        body: Object.freeze([
          'Admin Login 후 Web Serial, Server Sharing, Command 기능을 사용할 수 있다.',
          'Admin credentials 안내 문구는 tutorial에 직접 노출하지 않는다.',
          '실제 계정 정보는 UI에 표시하지 않는다.',
        ]),
      }),
      Object.freeze({
        title: 'Open Web Serial Tab',
        image: image('web-serial-tab.png'),
        body: Object.freeze([
          'Web Serial 탭으로 이동한다.',
          'ESP32 Remote MCU를 USB로 연결한 PC에서 사용한다.',
        ]),
      }),
      Object.freeze({
        title: 'Connect Receiver',
        image: image('connect-receiver.png'),
        body: Object.freeze([
          'Connect Receiver를 눌러 ESP32 Remote MCU의 serial port를 연결한다.',
          '연결되면 Web Serial connected 상태가 된다.',
          '3D Cubli는 연결 전에도 fallback identity로 표시되어야 한다.',
        ]),
      }),
      Object.freeze({
        title: 'Use as Admin Direct Bridge Source',
        image: image('connect-receiver.png'),
        body: Object.freeze([
          'Admin이 Receiver와 연결한 뒤 Admin Direct Bridge source를 사용할 수 있다.',
          '이 상태에서 Web Serial data를 서버로 공유할 준비가 된다.',
        ]),
      }),
      Object.freeze({
        title: 'Enable Server Sharing',
        image: image('server-sharing.png'),
        body: Object.freeze([
          'Server Sharing을 켜면 Admin Web Serial data가 서버로 publish된다.',
          'Viewer와 Controller는 서버를 통해 같은 telemetry를 본다.',
          'Command 창은 Server Sharing / Active Publisher 상태가 정상일 때 안정적으로 사용된다.',
        ]),
      }),
      Object.freeze({
        title: 'Active Publisher and Force Take Over',
        image: image('force-takeover.png'),
        body: Object.freeze([
          'Active Publisher는 현재 서버에 telemetry를 publish하는 Admin이다.',
          '다른 Admin이 잘못 잡고 있거나 stale 상태이면 Force Take Over Publisher를 사용한다.',
          'Force Take Over는 이전 publisher data와 새 session data가 섞이지 않게 하는 기능이다.',
          '일반 상황에서는 남용하지 않는다.',
        ]),
      }),
      Object.freeze({
        title: 'Receiver Info / Bridge Status',
        image: image('server-sharing.png'),
        body: Object.freeze([
          'Active publisher, heartbeat, bridge 상태를 확인한다.',
          'heartbeat 숫자 변화로 UI가 흔들리지 않도록 고정폭 text UI를 사용한다.',
          'Receiver Info를 열면 publisher/bridge/drop counter 정보를 확인할 수 있다.',
        ]),
      }),
      Object.freeze({
        title: 'Command Panel',
        image: image('command-panel.png'),
        body: Object.freeze([
          'Command는 Control, Local Web Serial Command, Target Attitude, Wheel RPM Command, PID Gain, EBIMU Stream 등으로 나뉜다.',
          'Server Command Queue는 Controller 권한 사용자를 통해서도 요청될 수 있다.',
          'Local Web Serial Command는 Admin-only이며 서버 상태와 무관하게 직접 serial write를 수행한다.',
        ]),
      }),
      Object.freeze({
        title: 'Data View',
        image: image('data-view-selector.png'),
        body: Object.freeze([
          'IMU quaternion/RPY와 Encoder reference를 비교한다.',
          'Encoder는 motor encoder가 아니라 3-axis gimbal rotary encoder reference이다.',
          'Encoder quaternion/RPY는 monitoring용이며 IMU attitude를 덮어쓰지 않는다.',
        ]),
      }),
      Object.freeze({
        title: 'Live Plot',
        image: image('live-plot.png'),
        body: Object.freeze([
          '그래프는 실시간 확인용이다.',
          '성능이 느려지면 Show 토글을 끈다.',
          '중요한 실험 데이터는 CSV Logging으로 저장한다.',
        ]),
      }),
      Object.freeze({
        title: 'CSV Logging',
        image: image('csv-logging.png'),
        body: Object.freeze([
          'CSV 저장은 Start CSV Logging 이후부터 수행된다.',
          'Stop & Download CSV로 다운로드한다.',
          'CSV 저장은 UI 렌더링 주기와 분리해서 수신된 valid Serial sample을 가능한 전부 저장한다.',
          '실제로 수신되지 않은 가짜 row를 만들지 않는다.',
        ]),
      }),
    ]),
  }),
});
