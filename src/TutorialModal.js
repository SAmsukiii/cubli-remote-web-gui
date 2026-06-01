import React, { useEffect, useMemo, useState } from 'react';
import { Button, ButtonGroup, Modal } from 'react-bootstrap';
import {
  GUIDE_MODES,
  TUTORIAL_GUIDES,
  TUTORIAL_VERSION,
  normalizeTutorialGuideMode,
} from './tutorialSteps';

export default function TutorialModal({
  show,
  guideMode,
  onGuideModeChange,
  onHide,
  onDontShowAgain,
}) {
  const activeGuideMode = normalizeTutorialGuideMode(guideMode);
  const activeGuide = TUTORIAL_GUIDES[activeGuideMode] || TUTORIAL_GUIDES.viewer;
  const [stepIndex, setStepIndex] = useState(0);
  const [imageExpanded, setImageExpanded] = useState(false);
  const steps = activeGuide.steps || [];
  const currentStep = steps[Math.min(stepIndex, steps.length - 1)] || steps[0];

  useEffect(() => {
    if (!show) return;
    setStepIndex(0);
    setImageExpanded(false);
  }, [activeGuideMode, show]);

  const stepCountText = useMemo(() => (
    steps.length > 0 ? `${stepIndex + 1} / ${steps.length}` : '0 / 0'
  ), [stepIndex, steps.length]);

  const selectGuide = (mode) => {
    const nextMode = normalizeTutorialGuideMode(mode);
    onGuideModeChange?.(nextMode);
    setStepIndex(0);
    setImageExpanded(false);
  };

  const goPrevious = () => {
    setStepIndex((index) => Math.max(0, index - 1));
    setImageExpanded(false);
  };

  const goNext = () => {
    setStepIndex((index) => Math.min(steps.length - 1, index + 1));
    setImageExpanded(false);
  };

  return (
    <Modal show={show} onHide={onHide} centered size="xl" contentClassName="tutorial-modal">
      <Modal.Header closeButton className="tutorial-modal-header">
        <div>
          <Modal.Title className="h5 fw-bold">Cubli Web GUI Tutorial</Modal.Title>
          <div className="tutorial-version">Version {TUTORIAL_VERSION}</div>
        </div>
      </Modal.Header>
      <Modal.Body className="tutorial-modal-body">
        <div className="tutorial-guide-switch">
          <ButtonGroup size="sm" aria-label="Tutorial guide mode">
            <Button
              type="button"
              variant={activeGuideMode === GUIDE_MODES.viewer ? 'info' : 'outline-info'}
              onClick={() => selectGuide(GUIDE_MODES.viewer)}
            >
              Viewer Guide
            </Button>
            <Button
              type="button"
              variant={activeGuideMode === GUIDE_MODES.admin ? 'info' : 'outline-info'}
              onClick={() => selectGuide(GUIDE_MODES.admin)}
            >
              Admin Guide
            </Button>
          </ButtonGroup>
          <div className="tutorial-guide-summary">{activeGuide.summary}</div>
        </div>

        {currentStep ? (
          <>
            <div className="tutorial-progress-row">
              <div>
                <div className="tutorial-step-index">Step {stepIndex + 1}</div>
                <div className="tutorial-step-title">{currentStep.title}</div>
              </div>
              <div className="tutorial-step-count">{stepCountText}</div>
            </div>

            <div className={`tutorial-current-step ${imageExpanded ? 'is-expanded' : ''}`}>
              <button
                type="button"
                className="tutorial-image-shell"
                onClick={() => setImageExpanded((expanded) => !expanded)}
                aria-label="Toggle larger tutorial image preview"
              >
                <img src={currentStep.image} alt={`${currentStep.title} screenshot`} />
              </button>
              <div className="tutorial-copy">
                <ul>
                  {currentStep.body.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <div className="tutorial-note">
                  이미지를 클릭하면 미리보기 크기가 바뀐다.
                </div>
              </div>
            </div>
          </>
        ) : null}
      </Modal.Body>
      <Modal.Footer className="tutorial-modal-footer">
        <Button variant="outline-warning" size="sm" onClick={onDontShowAgain}>
          다시 보지 않기
        </Button>
        <div className="tutorial-footer-spacer" />
        <Button variant="outline-light" size="sm" onClick={goPrevious} disabled={stepIndex <= 0}>
          Previous
        </Button>
        <Button variant="outline-light" size="sm" onClick={goNext} disabled={stepIndex >= steps.length - 1}>
          Next
        </Button>
        <Button variant="info" size="sm" onClick={onHide}>
          확인
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
