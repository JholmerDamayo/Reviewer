import type { CSSProperties } from 'react';
import { useCounter } from '../../hooks/useCounter';
import { createSparklinePath, type BreakdownItem } from '../../utils/helpers';

export type StatCardData = {
  id: string;
  title: string;
  icon: string;
  value: number;
  max?: number;
  decimals?: number;
  suffix?: string;
  label: string;
  accent: string;
  trend: number[];
  breakdown: BreakdownItem[];
};

type StatCardProps = {
  stat: StatCardData;
  onSelect: (stat: StatCardData) => void;
};

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function StatCard({ stat, onSelect }: StatCardProps) {
  const count = useCounter(stat.value, 1300, stat.decimals ?? 0);
  const progress = Math.min(stat.value / (stat.max ?? 100), 1);
  const strokeOffset = CIRCUMFERENCE - progress * CIRCUMFERENCE;
  const sparkline = createSparklinePath(stat.trend);

  return (
    <button
      className="stat-card glass-panel"
      onClick={(event) => {
        event.currentTarget.classList.remove('is-pressed');
        void event.currentTarget.offsetWidth;
        event.currentTarget.classList.add('is-pressed');
        onSelect(stat);
      }}
      style={{ '--card-accent': stat.accent } as CSSProperties}
      type="button"
    >
      <div className="stat-card-top">
        <div className="stat-icon">{stat.icon}</div>
        <span className="stat-chip">{Math.round(progress * 100)}%</span>
      </div>

      <div className="stat-card-body">
        <p className="stat-title">{stat.title}</p>
        <strong>
          {count}
          {stat.suffix ? stat.suffix : ''}
          {stat.max ? ` / ${stat.max}` : ''}
        </strong>
        <p className="stat-label">{stat.label}</p>
      </div>

      <div className="stat-card-foot">
        <svg className="sparkline" viewBox="0 0 132 44" preserveAspectRatio="none">
          <path d={sparkline} />
        </svg>

        <div className="progress-ring">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle className="ring-base" cx="50" cy="50" r={RADIUS} />
            <circle
              className="ring-progress"
              cx="50"
              cy="50"
              r={RADIUS}
              style={{
                strokeDasharray: CIRCUMFERENCE,
                strokeDashoffset: strokeOffset
              }}
            />
          </svg>
          <span>{Math.round(progress * 100)}%</span>
        </div>
      </div>
    </button>
  );
}

export default StatCard;
