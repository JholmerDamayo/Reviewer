import type { PageKey } from '../../App';

type QuickStartProps = {
  onNavigate: (page: PageKey) => void;
  onFlashcards: () => void;
};

function QuickStart({ onNavigate, onFlashcards }: QuickStartProps) {
  return (
    <section className="quickstart-panel glass-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Quick Start</span>
          <h3>Launch a Focus Session</h3>
        </div>
      </div>

      <div className="quickstart-grid">
        <button className="quick-action" onClick={() => onNavigate('practices')} type="button">
          <span>📝</span>
          <strong>Start Practice</strong>
          <small>Warm up with guided problems</small>
        </button>
        <button className="quick-action" onClick={() => onNavigate('quizzes')} type="button">
          <span>🧩</span>
          <strong>Take a Quiz</strong>
          <small>Challenge your recall speed</small>
        </button>
        <button className="quick-action" onClick={onFlashcards} type="button">
          <span>🪄</span>
          <strong>Review Flashcards</strong>
          <small>Adaptive revision is on the way</small>
        </button>
      </div>
    </section>
  );
}

export default QuickStart;
