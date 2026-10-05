import { extractAdfText } from '../src/utils/adf';

describe('extractAdfText', () => {
  it('should return empty string for null, undefined, or empty doc', () => {
    expect(extractAdfText(null)).toBe('');
    expect(extractAdfText(undefined)).toBe('');
    expect(extractAdfText({})).toBe('');
  });

  it('should extract text from simple paragraph', () => {
    const doc = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Hello World' }
          ]
        }
      ]
    };
    expect(extractAdfText(doc)).toBe('Hello World');
  });

  it('should extract text from multiple paragraphs with spacing', () => {
    const doc = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'First line.' }]
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Second line.' }]
        }
      ]
    };
    expect(extractAdfText(doc)).toBe('First line. Second line.');
  });

  it('should handle mentions and links', () => {
    const doc = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Assigned to ' },
            { type: 'mention', attrs: { text: '@john.doe' } },
            { type: 'text', text: ' please check.' }
          ]
        }
      ]
    };
    expect(extractAdfText(doc)).toBe('Assigned to @john.doe please check.');
  });

  it('should truncate text longer than maxChars with an ellipsis', () => {
    const longText = 'A'.repeat(150);
    const doc = {
      type: 'doc',
      version: 1,
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: longText }]
        }
      ]
    };
    const result = extractAdfText(doc, 120);
    expect(result.length).toBe(121); // 120 chars + '…'
    expect(result.endsWith('…')).toBe(true);
    expect(result.startsWith('A'.repeat(120))).toBe(true);
  });
});
