import React from 'react';

/**
 * Parses markdown-formatted AI responses into beautifully styled React elements.
 * Supports bold, italic, inline code, code blocks, bullet & numbered lists, headings, and blockquotes.
 */
export default function FormattedAnswer({ text }) {
  if (!text) return null;

  const lines = text.split('\n');
  const blocks = [];
  let currentList = null;
  let currentCode = null;
  let currentQuote = null;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Code blocks
    if (trimmed.startsWith('```')) {
      if (currentCode) {
        blocks.push({ type: 'code', lang: currentCode.lang, code: currentCode.lines.join('\n') });
        currentCode = null;
      } else {
        flushCurrent();
        const lang = trimmed.slice(3).trim();
        currentCode = { lang, lines: [] };
      }
      continue;
    }
    if (currentCode) {
      currentCode.lines.push(rawLine);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const quoteText = trimmed.replace(/^>\s*/, '');
      if (currentQuote) {
        currentQuote.lines.push(quoteText);
      } else {
        flushCurrent();
        currentQuote = { type: 'quote', lines: [quoteText] };
      }
      continue;
    } else if (currentQuote) {
      blocks.push(currentQuote);
      currentQuote = null;
    }

    // List item (bullet or numbered)
    const listMatch = trimmed.match(/^([-*]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const isOrdered = /^\d+\./.test(listMatch[1]);
      const content = listMatch[2];
      if (!currentList || currentList.ordered !== isOrdered) {
        flushCurrent();
        currentList = { type: 'list', ordered: isOrdered, items: [content] };
      } else {
        currentList.items.push(content);
      }
      continue;
    } else if (currentList) {
      blocks.push(currentList);
      currentList = null;
    }

    // Headings (#, ##, ###)
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushCurrent();
      blocks.push({ type: 'heading', level: headingMatch[1].length, text: headingMatch[2] });
      continue;
    }

    // Empty blank line
    if (!trimmed) {
      flushCurrent();
      continue;
    }

    // Normal paragraph line
    blocks.push({ type: 'paragraph', text: rawLine });
  }

  function flushCurrent() {
    if (currentList) { blocks.push(currentList); currentList = null; }
    if (currentQuote) { blocks.push(currentQuote); currentQuote = null; }
    if (currentCode) { blocks.push({ type: 'code', lang: currentCode.lang, code: currentCode.lines.join('\n') }); currentCode = null; }
  }
  flushCurrent();

  return (
    <div className="formatted-answer">
      {blocks.map((block, idx) => {
        if (block.type === 'code') {
          return (
            <div key={idx} className="answer-code-wrapper">
              {block.lang && <span className="code-lang-tag">{block.lang}</span>}
              <pre className="answer-code-block">
                <code>{block.code}</code>
              </pre>
            </div>
          );
        }
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul';
          return (
            <Tag key={idx} className={`answer-list ${block.ordered ? 'ordered' : 'unordered'}`}>
              {block.items.map((item, itemIdx) => (
                <li key={itemIdx}>{renderInline(item)}</li>
              ))}
            </Tag>
          );
        }
        if (block.type === 'quote') {
          return (
            <blockquote key={idx} className="answer-quote">
              {block.lines.map((l, qIdx) => (
                <p key={qIdx}>{renderInline(l)}</p>
              ))}
            </blockquote>
          );
        }
        if (block.type === 'heading') {
          const HeadingTag = block.level <= 2 ? 'h3' : 'h4';
          return (
            <HeadingTag key={idx} className={`answer-heading level-${block.level}`}>
              {renderInline(block.text)}
            </HeadingTag>
          );
        }
        return (
          <p key={idx} className="answer-para">
            {renderInline(block.text)}
          </p>
        );
      })}
    </div>
  );
}

function renderInline(text) {
  if (!text) return null;

  // Regex matching inline tokens:
  // 1. Links: [label](url)
  // 2. Bold: **text**
  // 3. Inline code: `code`
  // 4. Italic: *text* or _text_
  const tokenRegex = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
  const parts = [];
  let lastIndex = 0;
  let match;
  let key = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index));
    }
    const token = match[0];
    if (token.startsWith('[') && token.includes('](') && token.endsWith(')')) {
      const closeBracket = token.indexOf('](');
      const label = token.slice(1, closeBracket);
      const url = token.slice(closeBracket + 2, -1);
      parts.push(
        <a key={key++} href={url} target="_blank" rel="noopener noreferrer" className="answer-link">
          {label}
        </a>
      );
    } else if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(<code key={key++} className="inline-code">{token.slice(1, -1)}</code>);
    } else if ((token.startsWith('*') && token.endsWith('*')) || (token.startsWith('_') && token.endsWith('_'))) {
      parts.push(<em key={key++}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

