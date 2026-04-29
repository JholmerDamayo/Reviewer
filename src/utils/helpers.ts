export type BreakdownItem = {
  label: string;
  value: number;
};

export function formatToday() {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date());
}

export function createSparklinePath(points: number[], width = 132, height = 44) {
  if (!points.length) {
    return '';
  }

  const max = Math.max(...points);
  const min = Math.min(...points);
  const range = Math.max(max - min, 1);

  return points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * width;
      const y = height - ((point - min) / range) * height;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

export function getAverage(items: BreakdownItem[]) {
  if (!items.length) {
    return 0;
  }

  const total = items.reduce((sum, item) => sum + item.value, 0);
  return Math.round((total / items.length) * 10) / 10;
}
