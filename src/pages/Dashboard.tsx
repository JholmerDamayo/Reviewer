import { useMemo, useState } from 'react';
import type { PageKey } from '../App';
import ActivityFeed from '../components/ActivityFeed';
import DetailPanel from '../components/DetailPanel';
import Header from '../components/Header';
import Modal from '../components/Modal';
import QuickStart from '../components/QuickStart';
import StatCard, { type StatCardData } from '../components/StatCard';

type DashboardProps = {
  onQuickNavigate: (page: PageKey) => void;
};

const statCards: StatCardData[] = [
  {
    id: 'quiz',
    title: 'Quiz Score',
    icon: '🧩',
    value: 84,
    max: 100,
    label: 'Last Quiz · 3 days ago',
    accent: '#22d3c5',
    trend: [65, 72, 74, 81, 84],
    breakdown: [
      { label: 'Recall', value: 88 },
      { label: 'Accuracy', value: 82 },
      { label: 'Speed', value: 79 }
    ]
  },
  {
    id: 'practice',
    title: 'Practice Score',
    icon: '📝',
    value: 91,
    max: 100,
    label: 'Last Practice · Yesterday',
    accent: '#f4ba5d',
    trend: [73, 78, 85, 89, 91],
    breakdown: [
      { label: 'Completion', value: 96 },
      { label: 'Conceptual fit', value: 90 },
      { label: 'Consistency', value: 87 }
    ]
  },
  {
    id: 'exam',
    title: 'Exam Score',
    icon: '📋',
    value: 78,
    max: 100,
    label: 'Midterm Exam · 1 week ago',
    accent: '#ff8f8a',
    trend: [62, 70, 74, 76, 78],
    breakdown: [
      { label: 'Problem solving', value: 81 },
      { label: 'Time management', value: 72 },
      { label: 'Written response', value: 79 }
    ]
  },
  {
    id: 'overall',
    title: 'Overall Average',
    icon: '📊',
    value: 84.3,
    decimals: 1,
    suffix: '%',
    label: 'Across all activities',
    accent: '#a58bff',
    trend: [76, 79, 81, 83, 84.3],
    breakdown: [
      { label: 'Quizzes', value: 84 },
      { label: 'Practice', value: 91 },
      { label: 'Exams', value: 78 }
    ]
  }
];

function Dashboard({ onQuickNavigate }: DashboardProps) {
  const [selectedStat, setSelectedStat] = useState<StatCardData | null>(null);
  const [modalStat, setModalStat] = useState<StatCardData | null>(null);
  const flashcardsReport = useMemo(
    () => ({
      title: 'Flashcard Review Queue',
      message:
        'Flashcards are queued as the next learning module. This prototype keeps the entry point visible while the full review engine is still being wired in.'
    }),
    []
  );
  const [showFlashcardsModal, setShowFlashcardsModal] = useState(false);

  return (
    <div className="dashboard-page">
      <Header />

      <section className="stats-section">
        <div className="stats-grid">
          {statCards.map((stat) => (
            <StatCard key={stat.id} onSelect={setSelectedStat} stat={stat} />
          ))}
        </div>

        <DetailPanel
          onClose={() => setSelectedStat(null)}
          onViewReport={(stat) => setModalStat(stat)}
          stat={selectedStat}
        />
      </section>

      <section className="dashboard-lower">
        <ActivityFeed />
        <QuickStart
          onFlashcards={() => setShowFlashcardsModal(true)}
          onNavigate={onQuickNavigate}
        />
      </section>

      <Modal
        onClose={() => setModalStat(null)}
        open={Boolean(modalStat)}
        title={modalStat ? `${modalStat.title} Report` : 'Report'}
      >
        {modalStat && (
          <div className="modal-report">
            <p>
              <strong>{modalStat.title}</strong> is currently tracking at{' '}
              {modalStat.value}
              {modalStat.suffix ?? ''}
              {modalStat.max ? ` / ${modalStat.max}` : ''}.
            </p>
            <p>
              The strongest signal is in the top-scoring module, while the
              lowest-scoring module is the best next review target.
            </p>
            <ul className="modal-list">
              {modalStat.breakdown.map((item) => (
                <li key={item.label}>
                  {item.label}: {item.value}%
                </li>
              ))}
            </ul>
          </div>
        )}
      </Modal>

      <Modal
        onClose={() => setShowFlashcardsModal(false)}
        open={showFlashcardsModal}
        title={flashcardsReport.title}
      >
        <p>{flashcardsReport.message}</p>
      </Modal>
    </div>
  );
}

export default Dashboard;
