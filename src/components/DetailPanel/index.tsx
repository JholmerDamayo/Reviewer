import type { CSSProperties } from 'react';
import { getAverage } from '../../utils/helpers';
import type { StatCardData } from '../StatCard';

type DetailPanelProps = {
  stat: StatCardData | null;
  onClose: () => void;
  onViewReport: (stat: StatCardData) => void;
};

function DetailPanel({ stat, onClose, onViewReport }: DetailPanelProps) {
  const isOpen = Boolean(stat);
  const average = stat ? getAverage(stat.breakdown) : 0;

  return (
    <section className={`detail-panel glass-panel ${isOpen ? 'open' : ''}`}>
      {stat && (
        <>
          <div className="detail-header">
            <div>
              <span className="detail-pill" style={{ '--accent': stat.accent } as CSSProperties}>
                {stat.icon} {stat.title}
              </span>
              <h3>{stat.title} Breakdown</h3>
              <p>Average component score: {average}%</p>
            </div>
            <button className="detail-close" onClick={onClose} type="button">
              ✕
            </button>
          </div>

          <div className="detail-grid">
            <div className="bar-chart">
              {stat.breakdown.map((item) => (
                <div className="bar-row" key={item.label}>
                  <div className="bar-label-row">
                    <span>{item.label}</span>
                    <strong>{item.value}%</strong>
                  </div>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{
                        width: `${item.value}%`,
                        background: `linear-gradient(90deg, ${stat.accent}, rgba(255,255,255,0.8))`
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="detail-table-shell">
              <table className="detail-table">
                <thead>
                  <tr>
                    <th>Module</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stat.breakdown.map((item) => (
                    <tr key={item.label}>
                      <td>{item.label}</td>
                      <td>{item.value >= 85 ? 'Strong' : item.value >= 75 ? 'Stable' : 'Needs review'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <button className="report-link" onClick={() => onViewReport(stat)} type="button">
            View Full Report →
          </button>
        </>
      )}
    </section>
  );
}

export default DetailPanel;
