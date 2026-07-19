const SEVERITY_ICON = { high: "🔴", medium: "🟠", low: "🟡", none: "⚪" };

/**
 * Turns the raw output of diffSpecs() into a markdown comment.
 *
 * `ai` is optional: { summary: string, notes: Map<location, note> } from
 * Phase 3's explainChanges(), or null/undefined if no AI explanation was
 * available (missing API keys, provider outage, etc). When null, this
 * produces exactly Phase 2's output - the AI layer only ever adds
 * information on top of the deterministic diff, never replaces it.
 */
export function formatComment(result, specPath, ai = null) {
  const { breakingChanges, nonBreakingChanges } = result;

  if (breakingChanges.length === 0 && nonBreakingChanges.length === 0) {
    return `✅ **API Guardian** checked \`${specPath}\` — no changes detected.`;
  }

  const lines = [];

  lines.push(`## API Guardian report for \`${specPath}\``);
  lines.push("");

  if (ai?.summary) {
    lines.push(ai.summary);
    lines.push("");
  }

  if (breakingChanges.length > 0) {
    lines.push(`### 🚨 ${breakingChanges.length} breaking change${breakingChanges.length === 1 ? "" : "s"}`);
    lines.push("");
    for (const change of sortBySeverity(breakingChanges)) {
      lines.push(formatChangeLine(change));
      const note = ai?.notes?.get(change.location);
      if (note) {
        lines.push(`  - 💡 ${note}`);
      }
    }
    lines.push("");
  }

  if (nonBreakingChanges.length > 0) {
    lines.push(
      `<details><summary>${nonBreakingChanges.length} non-breaking change${nonBreakingChanges.length === 1 ? "" : "s"} (click to expand)</summary>`
    );
    lines.push("");
    for (const change of nonBreakingChanges) {
      lines.push(formatChangeLine(change));
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  if (breakingChanges.length > 0) {
    lines.push(
      "_This PR has unacknowledged breaking changes. (Merge-blocking and acknowledgment land in Phase 4.)_"
    );
  }

  return lines.join("\n");
}

function formatChangeLine(change) {
  const icon = SEVERITY_ICON[change.severity] || "⚪";
  return `- ${icon} **${change.location}** — ${change.message}`;
}

function sortBySeverity(changes) {
  const order = { high: 0, medium: 1, low: 2, none: 3 };
  return [...changes].sort((a, b) => order[a.severity] - order[b.severity]);
}
