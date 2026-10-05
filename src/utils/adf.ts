interface AdfNode {
  type?: string;
  text?: string;
  attrs?: {
    text?: string;
    [key: string]: unknown;
  };
  content?: AdfNode[];
}

export function extractAdfText(doc: unknown, maxChars: number = 120): string {
  if (!doc || typeof doc !== 'object') {
    return '';
  }

  const textParts: string[] = [];

  function traverse(node: AdfNode): void {
    if (!node) return;

    if (node.type === 'text' && typeof node.text === 'string') {
      textParts.push(node.text);
    } else if (node.type === 'mention' && node.attrs?.text) {
      textParts.push(node.attrs.text);
    }

    if (Array.isArray(node.content)) {
      for (const child of node.content) {
        traverse(child);
      }
    }
  }

  traverse(doc as AdfNode);

  const fullText = textParts.join(' ').replace(/\s+/g, ' ').trim();
  if (fullText.length <= maxChars) {
    return fullText;
  }

  return fullText.slice(0, maxChars) + '…';
}
