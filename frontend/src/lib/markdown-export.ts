import { ReviewNote } from "@/lib/types";
import { CATEGORIES, CATEGORY_LABEL_TEXT, SEVERITY_LABELS } from "@/lib/review-config";

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function generateMarkdown(notes: ReviewNote[], scores: Record<string, number>): string {
  let md = "# Whiteboard Architect — セッションレポート\n\n";
  md += `生成日時: ${dateFormatter.format(new Date())}\n\n`;

  md += "## スコアサマリー\n\n";
  md += "| カテゴリ | スコア (0-10) |\n|---|---|\n";
  for (const cat of CATEGORIES) {
    md += `| ${CATEGORY_LABEL_TEXT[cat]} | ${scores[cat]} |\n`;
  }
  md += "\n";

  md += "## レビューノート\n\n";
  for (const cat of CATEGORIES) {
    const catNotes = notes.filter((n) => n.category === cat);
    if (catNotes.length === 0) continue;
    md += `### ${CATEGORY_LABEL_TEXT[cat]}\n\n`;
    for (const note of catNotes) {
      md += `- **[${SEVERITY_LABELS[note.severity] ?? note.severity}]** ${note.finding}\n`;
      if (note.recommendation) {
        md += `  - 推奨: ${note.recommendation}\n`;
      }
    }
    md += "\n";
  }

  return md;
}

export function downloadMarkdown(notes: ReviewNote[], scores: Record<string, number>) {
  const md = generateMarkdown(notes, scores);
  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `whiteboard-review-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
