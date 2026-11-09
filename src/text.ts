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

const SENTENCES = new Intl.Segmenter('en', { granularity: 'sentence' });

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
  const text = paragraphs.join(' ')
    .replace(/^(?:(?:sure|of course|absolutely|okay|ok)[.!] +)+/i, '');

  if (text.length <= max) {
    return text;
  }

  let sentenceEnd = 0;

  for (const { index, segment } of SENTENCES.segment(text)) {
    const end = index + segment.trimEnd().length;

    if (end > max) {
      break;
    }

    sentenceEnd = end;
  }

  if (sentenceEnd > max * 0.4) {
    return text.slice(0, sentenceEnd);
  }

  const head = text.slice(0, max - 3);
  const wordEnd = head.lastIndexOf(' ');

  return `${(wordEnd > 0 ? head.slice(0, wordEnd) : head).trimEnd()}...`;
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

    if (out.length === lines) {
      const last = out[lines - 1].replace(/\.{3}$/, '');
      const fitting = last.length <= width - 3 ? last : last.slice(0, width - 3).replace(/\s+\S*$/, '');
      out[lines - 1] = `${fitting.trimEnd()}...`;

      return out;
    }

    line = word.length > width ? `${word.slice(0, width - 3)}...` : word;
  }

  if (line && out.length < lines) {
    out.push(line);
  }

  return out;
}
