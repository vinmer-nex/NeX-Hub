import { escapeHTML } from './dom.js';

// Простой безопасный подсветчик синтаксиса (один проход регэкспом).
// Не библиотека — покрывает популярные языки «на глаз»: комментарии, строки,
// числа, ключевые слова, теги, свойства.

const JS_KW = 'abstract|arguments|as|async|await|break|case|catch|class|const|continue|declare|default|delete|do|else|enum|export|extends|finally|for|from|function|get|if|implements|import|in|infer|instanceof|interface|is|keyof|let|module|namespace|new|of|override|package|private|protected|public|readonly|require|return|satisfies|set|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield|exports';

const C_KW = 'abstract|and|as|asm|assert|async|await|begin|bool|boolean|break|byte|case|catch|char|class|const|constexpr|continue|def|default|defer|delete|do|double|dyn|elif|else|end|enum|except|explicit|export|extends|extern|false|final|finally|float|fn|for|foreach|from|func|global|go|goto|if|impl|implements|import|in|inline|instanceof|int|interface|internal|is|lambda|let|long|loop|match|mod|move|mut|namespace|native|new|nil|nonlocal|not|null|nullptr|operator|or|override|package|pass|private|protected|pub|public|raise|range|readonly|ref|register|return|self|short|signed|sizeof|static|struct|super|switch|synchronized|template|then|this|throw|trait|transient|true|try|type|typedef|typename|typeof|union|unless|unsafe|unsigned|use|using|val|var|virtual|void|volatile|where|while|with|yield';

const PY_KW = 'and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield|match|case|self|cls|print';

const SH_KW = 'if|then|else|elif|fi|for|while|do|done|case|esac|function|return|in|export|local|readonly|declare|echo|printf|cd|source|alias|unalias|set|unset|exit|sudo|true|false';

const SQL_KW = 'select|from|where|insert|into|values|update|set|delete|create|drop|alter|table|index|view|join|left|right|inner|outer|on|group|by|order|having|limit|offset|union|all|distinct|as|and|or|not|null|is|in|like|between|exists|case|when|then|else|end|primary|key|foreign|references|default|constraint|int|integer|varchar|text|boolean|date|timestamp|serial|asc|desc|count|sum|avg|min|max';

const FAMILY_BY_EXT = {
  js: 'js', mjs: 'js', cjs: 'js', jsx: 'js',
  ts: 'js', tsx: 'js',
  json: 'json', jsonc: 'json', json5: 'json',
  html: 'html', htm: 'html', xhtml: 'html', xml: 'html', svg: 'html', vue: 'html', svelte: 'html',
  astro: 'html', pug: 'html', jade: 'html', hbs: 'html', handlebars: 'html', mustache: 'html', twig: 'html',
  css: 'css', scss: 'css', sass: 'css', less: 'css', styl: 'css',
  py: 'py', pyw: 'py', rb: 'py', nim: 'py', ex: 'py', exs: 'py',
  sh: 'sh', bash: 'sh', zsh: 'sh', ps1: 'sh', bat: 'sh', cmd: 'sh',
  sql: 'sql',
  yml: 'yaml', yaml: 'yaml', toml: 'yaml', ini: 'yaml', conf: 'yaml', env: 'yaml', properties: 'yaml',
  graphql: 'yaml', gql: 'yaml',
  java: 'c', c: 'c', h: 'c', cpp: 'c', cc: 'c', cxx: 'c', hpp: 'c', cs: 'c',
  go: 'c', rs: 'c', swift: 'c', kt: 'c', kts: 'c', php: 'c', scala: 'c', dart: 'c',
  lua: 'c', pl: 'c', r: 'c', m: 'c', groovy: 'c', gradle: 'c', pas: 'c', sol: 'c',
  zig: 'c', proto: 'c', clj: 'c', hs: 'c', ml: 'c', erl: 'c'
};

const SLASH = { line: '\\/\\/[^\\n]*', block: '\\/\\*[\\s\\S]*?\\*\\/' };
const HASH = { line: '#[^\\n]*', block: '' };
const NONE = { line: '', block: '' };

function familyConfig(fam) {
  switch (fam) {
    case 'js': return { kw: JS_KW, comment: SLASH };
    case 'c': return { kw: C_KW, comment: SLASH };
    case 'css': return { kw: '', comment: SLASH, props: true };
    case 'json': return { kw: '', comment: NONE, keys: true };
    case 'html': return { kw: '', comment: NONE, tags: true };
    case 'py': return { kw: PY_KW, comment: HASH };
    case 'sh': return { kw: SH_KW, comment: HASH };
    case 'sql': return { kw: SQL_KW, comment: SLASH };
    case 'yaml': return { kw: '', comment: HASH, props: true };
    default: return { kw: '', comment: SLASH };
  }
}

const MAX_HIGHLIGHT = 200000; // длиннее — рендерим без подсветки, чтобы не подвесить вкладку

function buildRegex(cfg) {
  const src = [
    cfg.comment.block ? '(?<block>' + cfg.comment.block + ')' : null,
    '(?<htmlcomment><!--[\\s\\S]*?-->)',
    cfg.comment.line ? '(?<line>' + cfg.comment.line + ')' : null,
    '(?<string>"(?:\\\\.|[^"\\\\\\n])*"|\'(?:\\\\.|[^\'\\\\\\n])*\'|`(?:\\\\.|[^`\\\\])*`)',
    cfg.tags ? '(?<tag><\\/?[A-Za-z][\\w:.-]*|\\/?>)' : null,
    '(?<number>\\b(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)\\b)',
    '(?<bool>\\b(?:true|false|null|undefined|None|True|False|nil|NaN|Infinity)\\b)',
    cfg.kw ? '(?<kw>\\b(?:' + cfg.kw + ')\\b)' : null,
    '(?<func>[A-Za-z_$][\\w$]*(?=\\s*\\())',
    '(?<prop>[A-Za-z_][\\w$-]*(?=\\s*:))',
    '(?<punct>[{}()\\[\\];,.])'
  ].filter(Boolean).join('|');
  return new RegExp(src, 'g');
}

function classFor(m, cfg, code) {
  const g = m.groups || {};
  if (g.block || g.line || g.htmlcomment) return 'tok-comment';
  if (g.string) {
    if (cfg.keys) {
      const rest = code.slice(m.index + m[0].length);
      if (/^\s*:/.test(rest)) return 'tok-key';
    }
    return 'tok-string';
  }
  if (g.tag) return 'tok-tag';
  if (g.number) return 'tok-number';
  if (g.bool) return 'tok-bool';
  if (g.kw) return 'tok-keyword';
  if (g.func) return 'tok-function';
  if (g.prop) return cfg.props ? 'tok-prop' : (cfg.keys ? 'tok-key' : 'tok-key');
  if (g.punct) return 'tok-punct';
  return '';
}

export function isHighlightable(ext) {
  return !!FAMILY_BY_EXT[(ext || '').toLowerCase()];
}

export function highlightCode(code, ext) {
  const text = code || '';
  const fam = FAMILY_BY_EXT[(ext || '').toLowerCase()];
  if (!fam || text.length > MAX_HIGHLIGHT) return escapeHTML(text);

  const cfg = familyConfig(fam);
  const re = buildRegex(cfg);
  let out = '';
  let last = 0;
  let m;

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out += escapeHTML(text.slice(last, m.index));
    const cls = classFor(m, cfg, text);
    const token = escapeHTML(m[0]);
    out += cls ? '<span class="' + cls + '">' + token + '</span>' : token;
    last = re.lastIndex;
    if (m[0].length === 0) re.lastIndex++;
  }
  out += escapeHTML(text.slice(last));
  return out;
}
