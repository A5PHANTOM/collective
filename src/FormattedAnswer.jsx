import React from 'react';
import { Icon } from './ui.jsx';

/**
 * FormattedAnswer:
 * Converts Markdown AI responses into motion graphics style UI.
 * Detects task listings, highlights overdue deadlines, and renders motion cards.
 * Clicking 'View' or the card opens the task sheet in-place (no new tab / page reload).
 */
export default function FormattedAnswer({ text, onOpenTask }) {
  if (!text) return null;

  const lines = text.split('\n');
  const blocks = [];
  let currentList = null;
  let currentCode = null;
  let currentQuote = null;
  let taskCardCount = 0;

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

    // Check if line is a task card with a task link
    const taskCardData = parseTaskLine(trimmed);
    if (taskCardData) {
      flushCurrent();
      blocks.push({ type: 'task-card', ...taskCardData, cardIdx: taskCardCount++ });
      continue;
    }

    // List item (bullet -, *, •, ▪ or numbered 1.)
    const listMatch = trimmed.match(/^([-*•▪]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const isOrdered = /^\d+\./.test(listMatch[1]);
      const content = listMatch[2];
      const taskInList = parseTaskLine(content);
      if (taskInList) {
        flushCurrent();
        blocks.push({ type: 'task-card', ...taskInList, cardIdx: taskCardCount++ });
        continue;
      }
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

    // Standalone bold line acting as section title (e.g. **Your Tasks for Today**)
    const boldTitleMatch = trimmed.match(/^\*\*([^*]+)\*\*$/);
    if (boldTitleMatch) {
      flushCurrent();
      blocks.push({ type: 'heading', level: 3, text: boldTitleMatch[1] });
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

  const handleOpen = (taskId) => {
    if (!taskId) return;
    if (onOpenTask) {
      onOpenTask(taskId);
    } else {
      window.location.search = `?task=${taskId}`;
    }
  };

  const hasOverdue = blocks.some((b) => b.type === 'task-card' && b.isOverdue);

  return (
    <div className="formatted-answer">
      {hasOverdue && (
        <div className="ai-overdue-alert-banner" role="alert">
          <div className="alert-banner-icon" aria-hidden="true">
            <Icon name="clock" size={16} />
          </div>
          <div className="alert-banner-text">
            <strong>Action Required: Deadline Passed</strong>
            <p>Unfinished work is overdue. Review and update the tasks below.</p>
          </div>
        </div>
      )}

      {blocks.map((block, idx) => {
        if (block.type === 'task-card') {
          return (
            <div
              key={idx}
              className={`motion-task-card ${block.isOverdue ? 'is-overdue' : ''}`}
              style={{ '--card-idx': block.cardIdx || 0 }}
              onClick={() => handleOpen(block.taskId)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleOpen(block.taskId); }}
            >
              <div className={`motion-task-icon ${block.isOverdue ? 'icon-overdue' : ''}`} aria-hidden="true">
                <Icon name={block.isOverdue ? 'clock' : 'check'} size={13} />
              </div>
              <div className="motion-task-details">
                <div className="motion-task-header-row">
                  <strong className="motion-task-title">{renderInline(block.title, handleOpen)}</strong>
                  {block.isOverdue && (
                    <span className="motion-badge-overdue">
                      <Icon name="clock" size={10} /> Overdue
                    </span>
                  )}
                </div>
                <div className="motion-task-meta">
                  {block.assignee && (
                    <span className="motion-meta-item motion-assignee">
                      <Icon name="people" size={11} /> {renderInline(block.assignee, handleOpen)}
                    </span>
                  )}
                  {block.friendlyDue && (
                    <span className={`motion-meta-item motion-due ${block.isOverdue ? 'due-overdue' : ''}`}>
                      <Icon name="clock" size={11} /> {block.friendlyDue} {block.isOverdue ? '(Passed deadline)' : ''}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                className={`motion-task-view-btn ${block.isOverdue ? 'btn-overdue' : ''}`}
                aria-label={`View task ${block.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handleOpen(block.taskId);
                }}
              >
                <span>View</span>
                <Icon name="chevron" size={11} />
              </button>
            </div>
          );
        }
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
                <li key={itemIdx}>{renderInline(item, handleOpen)}</li>
              ))}
            </Tag>
          );
        }
        if (block.type === 'quote') {
          return (
            <blockquote key={idx} className="answer-quote">
              {block.lines.map((l, qIdx) => (
                <p key={qIdx}>{renderInline(l, handleOpen)}</p>
              ))}
            </blockquote>
          );
        }
        if (block.type === 'heading') {
          const HeadingTag = block.level <= 2 ? 'h3' : 'h4';
          return (
            <HeadingTag key={idx} className={`answer-heading level-${block.level}`}>
              {renderInline(block.text, handleOpen)}
            </HeadingTag>
          );
        }
        return (
          <p key={idx} className="answer-para">
            {renderInline(block.text, handleOpen)}
          </p>
        );
      })}
    </div>
  );
}

/**
 * Parses lines that reference a task like:
 * "• **Update Instagram page – due 2026-11-18 12:30 UTC** (assigned to **Arjun**) – [View](/?task=UUID)"
 */
function parseTaskLine(str) {
  if (!str) return null;

  // Match links like [View](/?task=UUID), [View](/tasks/UUID), [View](UUID)
  const linkMatch = str.match(/\[([^\]]+)\]\((?:[^)]*?(?:task[=_]|\/tasks\/))?([a-f0-9-]{36})[^)]*\)/i) ||
                    str.match(/\[(View|Open|Task|Edit|Details)[^\]]*\]\(([^)]+)\)/i);
  if (!linkMatch) return null;

  let taskId = linkMatch[2];
  if (taskId.includes('task=')) {
    const m = taskId.match(/task=([a-f0-9-]+)/i);
    if (m) taskId = m[1];
  } else if (taskId.includes('/tasks/')) {
    const m = taskId.match(/\/tasks\/([a-f0-9-]+)/i);
    if (m) taskId = m[1];
  }

  // Strip the link out of the text
  let cleanLine = str.replace(linkMatch[0], '').trim();

  // Strip leading bullet chars or dashes
  cleanLine = cleanLine.replace(/^[-*•▪\s]+/, '').replace(/[–—\-\s]+$/, '').trim();

  let title = cleanLine;
  let friendlyDue = null;
  let isOverdue = /overdue/i.test(cleanLine);
  let assignee = null;

  // Extract due date: handle "due 2026-11-18 12:30 UTC**" or "due **2026-11-18**"
  const dueMatch = cleanLine.match(/[–—\-]?\s*due\s+[*_]*([0-9A-Za-z:+\-()T\s,]+)[*_]*/i);
  if (dueMatch) {
    const rawDue = dueMatch[1].trim();
    const parsed = formatFriendlyDate(rawDue);
    friendlyDue = parsed.friendlyDue;
    if (parsed.isOverdue) isOverdue = true;
    title = title.replace(dueMatch[0], '').trim();
  }

  // Extract assignee: handles "(assigned to ...)" or "(... in workspace ...)" even with nested parens
  const assigneeMatch = title.match(/\((.+)\)$/);
  if (assigneeMatch) {
    assignee = assigneeMatch[1].replace(/^(?:assigned to\s+)?/i, '').trim();
    title = title.slice(0, assigneeMatch.index).trim();
  } else {
    const inlineAssignee = title.match(/[–—\-]\s*assigned to ([^–—\n]+)/i);
    if (inlineAssignee) {
      assignee = inlineAssignee[1].trim();
      title = title.replace(inlineAssignee[0], '').trim();
    }
  }

  // Clean trailing and leading punctuation, asterisks, or dashes
  title = title.replace(/^[–—\-\s*•]+/, '').replace(/[–—\-\s*]+$/, '').trim();

  return {
    taskId,
    title: title || 'Task',
    friendlyDue,
    assignee,
    isOverdue
  };
}

function formatFriendlyDate(raw) {
  if (!raw) return { friendlyDue: null, isOverdue: false };
  let cleaned = raw.replace(/\([^)]*\)/g, '').replace(/[*_~`]/g, '').trim();
  const hasTime = cleaned.includes(':');
  const d = new Date(cleaned);
  let isOverdue = false;
  if (!isNaN(d.getTime())) {
    const now = new Date();
    isOverdue = d.getTime() < now.getTime();
    const isToday = d.toDateString() === now.toDateString();
    const tomorrow = new Date(now);
    tomorrow.setDate(now.getDate() + 1);
    const isTomorrow = d.toDateString() === tomorrow.toDateString();

    const timeStr = hasTime ? ` at ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
    let dateStr = '';
    if (isToday) dateStr = `Today${timeStr}`;
    else if (isTomorrow) dateStr = `Tomorrow${timeStr}`;
    else dateStr = d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + timeStr;

    return { friendlyDue: dateStr, isOverdue };
  }
  return { friendlyDue: cleaned, isOverdue: false };
}

function renderInline(text, onOpenTask) {
  if (!text) return null;

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

      // Check if it's an internal task link
      const taskMatch = url.match(/(?:task=|\/tasks\/)([a-f0-9-]+)/i);
      if (taskMatch && onOpenTask) {
        const taskId = taskMatch[1];
        parts.push(
          <button
            key={key++}
            type="button"
            className="inline-task-view-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onOpenTask(taskId);
            }}
          >
            <span>{label}</span>
            <Icon name="chevron" size={11} />
          </button>
        );
      } else {
        parts.push(
          <a key={key++} href={url} target="_blank" rel="noopener noreferrer" className="answer-link">
            {label}
          </a>
        );
      }
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
