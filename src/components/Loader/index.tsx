type LoaderProps = {
  label?: string;
};

function Loader({ label = 'This section is coming soon' }: LoaderProps) {
  return (
    <div className="loader-stack">
      <div className="loading-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <p>{label}</p>
      <div className="skeleton-grid" aria-hidden="true">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
    </div>
  );
}

export default Loader;
