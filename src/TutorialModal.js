import React, { useEffect, useState } from 'react';
import { Button, ButtonGroup, Modal } from 'react-bootstrap';
import { GUIDE_MODES, TUTORIAL_GUIDES, normalizeTutorialGuideMode } from './tutorialSteps';

export default function TutorialModal({ show, guideMode, onGuideModeChange, onHide, onDontShowAgain }) {
  const mode = normalizeTutorialGuideMode(guideMode);
  const sections = TUTORIAL_GUIDES[mode];
  const steps = sections.flatMap(section => section.steps);
  const [stepIndex, setStepIndex] = useState(0);
  const [captureIndex, setCaptureIndex] = useState(0);
  const [imageExpanded, setImageExpanded] = useState(false);
  const step = steps[stepIndex] ?? steps[0];
  const capture = step.captures[captureIndex] ?? step.captures[0];

  useEffect(() => {
    if (show) {
      setStepIndex(0);
      setCaptureIndex(0);
      setImageExpanded(false);
    }
  }, [mode, show]);

  function selectStep(index) {
    setStepIndex(index);
    setCaptureIndex(0);
    setImageExpanded(false);
  }

  return (
    <Modal show={show} onHide={onHide} centered size="xl" scrollable contentClassName="tutorial-modal" aria-labelledby="cubli-tutorial-title">
      <Modal.Header closeButton closeLabel="닫기" className="tutorial-modal-header">
        <Modal.Title className="h5 fw-bold" id="cubli-tutorial-title">Cubli 사용법</Modal.Title>
      </Modal.Header>
      <Modal.Body className="tutorial-modal-body">
        <div className="tutorial-guide-switch">
          <ButtonGroup size="sm" aria-label="사용자 유형">
            <Button variant={mode === GUIDE_MODES.viewer ? 'info' : 'outline-info'} aria-pressed={mode === GUIDE_MODES.viewer}
              onClick={() => onGuideModeChange?.(GUIDE_MODES.viewer)}>Viewer</Button>
            <Button variant={mode === GUIDE_MODES.admin ? 'info' : 'outline-info'} aria-pressed={mode === GUIDE_MODES.admin}
              onClick={() => onGuideModeChange?.(GUIDE_MODES.admin)}>관리자</Button>
          </ButtonGroup>
        </div>
        <div className="tutorial-layout">
          <nav className="tutorial-topics" aria-label="기능별 사용법">
            {sections.map(section => <div key={section.title}>
              <h2>{section.title}</h2>
              {section.steps.map(item => {
                const index = steps.indexOf(item);
                return <button type="button" key={item.title} aria-current={step === item ? 'step' : undefined}
                  onClick={() => selectStep(index)}>{item.title}</button>;
              })}
            </div>)}
          </nav>
          <section className="tutorial-lesson" aria-labelledby="cubli-tutorial-step">
            <h2 id="cubli-tutorial-step" className="tutorial-step-title" aria-live="polite">{step.title}</h2>
            <ul className="tutorial-copy">{step.body.map(line => <li key={line}>{line}</li>)}</ul>
            {step.captures.length > 1 && <div className="tutorial-captures" role="group" aria-label="이 기능의 캡처">
              {step.captures.map((item, index) => <Button type="button" key={item.image} size="sm" aria-pressed={capture === item}
                variant={capture === item ? 'info' : 'outline-secondary'} onClick={() => {
                  setCaptureIndex(index);
                  setImageExpanded(false);
                }}>{item.label}</Button>)}
            </div>}
            <button type="button" className={`tutorial-image-shell ${imageExpanded ? 'is-expanded' : ''}`}
              aria-label={imageExpanded ? '캡처 축소' : '캡처 확대'} aria-pressed={imageExpanded}
              onClick={() => setImageExpanded(expanded => !expanded)}>
              <img src={capture.image} alt={`${capture.label} 화면`}/>
            </button>
          </section>
        </div>
      </Modal.Body>
      <Modal.Footer className="tutorial-modal-footer">
        <Button variant="outline-secondary" size="sm" onClick={onDontShowAgain}>자동으로 열지 않기</Button>
        <div className="tutorial-footer-spacer" />
        <Button variant="outline-light" size="sm" onClick={() => selectStep(stepIndex - 1)} disabled={stepIndex === 0}>이전</Button>
        <Button variant="outline-light" size="sm" onClick={() => selectStep(stepIndex + 1)} disabled={stepIndex >= steps.length - 1}>다음</Button>
        <Button variant="info" size="sm" onClick={onHide}>확인</Button>
      </Modal.Footer>
    </Modal>
  );
}
