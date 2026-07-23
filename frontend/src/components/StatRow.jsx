export function StatRow({ stats }) {
  return (
    <div className="stat-row">
      <div className="stat-card clay">
        <div className="stat-number">{stats.totalChanges}</div>
        <div className="stat-label">Changes reviewed</div>
      </div>
      <div className="stat-card breaking clay">
        <div className="stat-number">{stats.breakingChangeCount}</div>
        <div className="stat-label">Breaking</div>
      </div>
      <div className="stat-card pending clay">
        <div className="stat-number">{stats.pendingAcknowledgments}</div>
        <div className="stat-label">Awaiting acknowledgment</div>
      </div>
      <div className="stat-card clean clay">
        <div className="stat-number">{stats.cleanChangeCount}</div>
        <div className="stat-label">Clean</div>
      </div>
    </div>
  );
}
