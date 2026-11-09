const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch',
  ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya', є: 'ye', і: 'i', ї: 'yi', ґ: 'g',
};

const PUNCTUATION: Record<string, string> = {
  '—': '-', '–': '-', '«': '"', '»': '"', '“': '"', '”': '"', '„': '"', '‘': "'", '’': "'",
  '…': '...', '→': '->', '←': '<-', '×': 'x', '•': '*', '·': '-', '✓': 'v', '✔': 'v', '✗': 'x', '✘': 'x',
  ' ': ' ',
};

/** The Bar's fonts are printable ASCII only: transliterate Cyrillic, flatten accents and typography, drop the rest. */
export function toAscii(text: string) {
  const mapped = [...text]
    .map((ch) => {
      const lower = ch.toLowerCase();
      const latin = CYRILLIC[lower];

      if (latin === undefined) {
        return PUNCTUATION[ch] ?? ch;
      }

      return ch === lower || !latin ? latin : latin[0].toUpperCase() + latin.slice(1);
    })
    .join('');

  return mapped
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/ {2,}/g, ' ');
}

/** Markdown → plain prose: no code blocks, tables, headings, list markers, emphasis or link targets. */
function plain(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, '')
    .replace(/(\*\*|__|\*|_|`)/g, '');
}

/** The first sentences of an answer, cut at a sentence end (or a word) to fit `max` characters. */
export function summarize(answer: string, max: number) {
  const paragraphs = plain(answer)
    .split(/\n\s*\n/)
    .map((p) => toAscii(p.replace(/\s+/g, ' ').trim()))
    .filter((p) => p.length > 0);
  const text = paragraphs.join(' ');

  if (text.length <= max) {
    return text;
  }

  const head = text.slice(0, max);
  const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '));

  if (sentenceEnd > max * 0.4) {
    return head.slice(0, sentenceEnd + 1);
  }

  const wordEnd = head.lastIndexOf(' ');

  return `${head.slice(0, wordEnd > 0 ? wordEnd : max - 3).trimEnd()}...`;
}

/** Greedy word wrap into at most `lines` lines of `width` characters. */
export function wrap(text: string, width: number, lines: number) {
  const out: string[] = [];
  let line = '';

  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;

    if (candidate.length <= width) {
      line = candidate;
      continue;
    }

    if (line) {
      out.push(line);
    }

    line = word.length > width ? `${word.slice(0, width - 1)}-` : word;

    if (out.length === lines) {
      break;
    }
  }

  if (line && out.length < lines) {
    out.push(line);
  }

  if (out.length === lines && out.join(' ').length < text.length) {
    out[lines - 1] = `${out[lines - 1].slice(0, width - 3).trimEnd()}...`;
  }

  return out;
}
