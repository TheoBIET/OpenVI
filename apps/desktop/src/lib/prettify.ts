/** Monaco language for a document, from its name or, failing that, its first characters. */
export function languageOf(name: string, text: string): string {
  const extension = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
  if (['xml', 'meta', 'ymt', 'rel', 'dat'].includes(extension) && text.trimStart().startsWith('<')) return 'xml';
  if (['json', 'geojson'].includes(extension)) return 'json';
  if (['ini', 'cfg', 'config', 'conf'].includes(extension)) return 'ini';
  const start = text.trimStart();
  if (start.startsWith('<')) return 'xml';
  // Unnamed fragments: an XML piece cut at its start still has tags on its first line.
  const firstLine = start.slice(0, start.indexOf('\n') === -1 ? undefined : start.indexOf('\n'));
  if (/<\/?[\w:.-]+[^>]*>|\/>/.test(firstLine)) return 'xml';
  if (start.startsWith('{') || start.startsWith('[')) return 'json';
  return 'plaintext';
}

/** Languages {@link prettify} can lay out. */
export function canPrettify(language: string): boolean {
  return language === 'xml' || language === 'json';
}

/** Lays `text` out with two-space indentation. Throws when JSON does not parse; XML is laid out tag by tag. */
export function prettify(text: string, language: string): string {
  if (language === 'json') return `${JSON.stringify(JSON.parse(text), null, 2)}\n`;
  if (language === 'xml') return prettifyXml(text);
  return text;
}

const xmlToken = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]*>|[^<]+/g;

/** One tag or text run per line, indented by depth; an element holding only text stays on one line. */
function prettifyXml(xml: string): string {
  const tokens = (xml.match(xmlToken) ?? []).map((token) => token.trim()).filter((token) => token !== '');
  const lines: string[] = [];
  let depth = 0;
  const indent = () => '  '.repeat(Math.max(depth, 0));
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? '';
    const isTag = token.startsWith('<');
    const isClosing = token.startsWith('</');
    const isOpening =
      isTag && !isClosing && !token.startsWith('<?') && !token.startsWith('<!') && !token.endsWith('/>');
    const text = tokens[index + 1];
    const closing = tokens[index + 2];
    if (isOpening && text !== undefined && !text.startsWith('<') && closing?.startsWith('</')) {
      lines.push(`${indent()}${token}${text}${closing}`);
      index += 2;
    } else if (isClosing) {
      depth -= 1;
      lines.push(`${indent()}${token}`);
    } else {
      lines.push(`${indent()}${token}`);
      if (isOpening) depth += 1;
    }
  }
  return `${lines.join('\n')}\n`;
}
