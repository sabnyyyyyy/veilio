/** Parse RFC 4180-style CSV fields, including quoted delimiters and newlines. */
export function parseCsvRows(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let insideQuotes = false;
  let afterQuote = false;

  for (let index = 0; index < text.length; index++) {
    const char = text[index];

    if (insideQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index++;
        } else {
          insideQuotes = false;
          afterQuote = true;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (afterQuote && char !== ',' && char !== '\r' && char !== '\n') {
      throw new Error('Unexpected character after a quoted CSV field.');
    }

    if (char === '"') {
      if (field.length > 0 || afterQuote) throw new Error('Unexpected quote in CSV field.');
      insideQuotes = true;
      continue;
    }

    if (char === ',') {
      row.push(field);
      field = '';
      afterQuote = false;
      continue;
    }

    if (char === '\r' || char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      afterQuote = false;
      if (char === '\r' && text[index + 1] === '\n') index++;
      continue;
    }

    field += char;
  }

  if (insideQuotes) throw new Error('Unclosed quoted CSV field.');
  if (field.length > 0 || row.length > 0 || afterQuote) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((candidate) => candidate.some((value) => value.trim().length > 0));
}
