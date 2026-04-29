const activityItems = [
  { title: 'Completed Algebra practice set', time: '09:20 AM', tag: 'Practice' },
  { title: 'Scored 84 on Logical Reasoning quiz', time: 'Yesterday', tag: 'Quiz' },
  { title: 'Reviewed flashcards for Biology', time: '2 days ago', tag: 'Revision' },
  { title: 'Finished essay outline checkpoint', time: '3 days ago', tag: 'Writing' },
  { title: 'Midterm exam analytics synced', time: '1 week ago', tag: 'Exam' }
];

function ActivityFeed() {
  return (
    <section className="feed-panel glass-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Recent Activity</span>
          <h3>Momentum Snapshot</h3>
        </div>
      </div>

      <div className="feed-list">
        {activityItems.map((item) => (
          <article className="feed-item" key={`${item.title}-${item.time}`}>
            <div className="feed-indicator" />
            <div className="feed-copy">
              <strong>{item.title}</strong>
              <span>{item.time}</span>
            </div>
            <span className="feed-tag">{item.tag}</span>
          </article>
        ))}
      </div>
    </section>
  );
}

export default ActivityFeed;
