export type DiffCommentMarkdownInput = {
  repoRelativePath: string;
  filePath: string;
  lineNumber: string | number;
  body: string;
  codeLine?: string | null;
};

export function workspaceCommentPath(
  comment: Pick<DiffCommentMarkdownInput, 'repoRelativePath' | 'filePath'>,
  repoCount: number,
): string {
  if (repoCount <= 1 || comment.repoRelativePath === '.') {
    return comment.filePath;
  }
  return `${comment.repoRelativePath}/${comment.filePath}`;
}

export function formatReviewCommentsMarkdown(
  comments: DiffCommentMarkdownInput[],
  repoCount: number,
): string {
  const header = `## Review Comments (${comments.length})\n\n`;
  return (
    header +
    comments
      .map((comment) => formatReviewCommentMarkdown(comment, repoCount))
      .join('\n')
  );
}

function formatReviewCommentMarkdown(
  comment: DiffCommentMarkdownInput,
  repoCount: number,
): string {
  const path = escapeMarkdownText(workspaceCommentPath(comment, repoCount));
  const codeLine = formatCodeLine(comment.codeLine);
  const quotedBody = quoteMarkdown(comment.body.trim());

  if (codeLine) {
    return `**${path}** (Line ${comment.lineNumber})\n${codeLine}\n\n${quotedBody}\n`;
  }
  return `**${path}** (Line ${comment.lineNumber})\n\n${quotedBody}\n`;
}

function formatCodeLine(line?: string | null): string {
  const trimmed = line?.trim();
  if (!trimmed) return '';
  if (trimmed.includes('`')) {
    return `\`\`\`\n${trimmed}\n\`\`\``;
  }
  return `\`${trimmed}\``;
}

function quoteMarkdown(value: string): string {
  if (!value) return '> ';
  return value
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
}

function escapeMarkdownText(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+.!|-])/g, '\\$1');
}
