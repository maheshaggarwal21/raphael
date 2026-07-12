import yaml from 'js-yaml';

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseLessonFile(content) {
  const m = FM_RE.exec(content);
  if (!m) throw new Error('E-FRONTMATTER: file has no ---frontmatter--- block');
  // JSON_SCHEMA keeps dates as plain strings instead of Date objects
  const data = yaml.load(m[1], { schema: yaml.JSON_SCHEMA });
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('E-FRONTMATTER: frontmatter is not a YAML mapping');
  }
  return { data, body: m[2] ?? '' };
}

export function serializeLessonFile(data, body = '') {
  const y = yaml.dump(data, { lineWidth: 100, noRefs: true, sortKeys: false });
  return `---\n${y}---\n${body ? '\n' + body : ''}`;
}
