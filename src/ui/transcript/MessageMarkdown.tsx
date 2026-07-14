import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';

/**
 * Shared renderer for agent output. Model text is rendered as sanitized Markdown —
 * rehype-sanitize strips any HTML/script so provider output can never inject markup
 * (spec §21). Styled via the global `.markdown` class so the transcript and the
 * conversation timeline render identically from one source.
 */
export function MessageMarkdown({ content }: { content: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown rehypePlugins={[rehypeSanitize]}>{content}</ReactMarkdown>
    </div>
  );
}
