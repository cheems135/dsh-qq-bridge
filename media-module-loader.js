const MEDIA_MODULE_FILES = Object.freeze([
  ['reader', 'video-reader.js'],
  ['bilibili', 'bilibili-service.js'],
  ['capabilities', 'agent-capabilities.js'],
  ['tool', 'bilibili-tool.js'],
  ['links', 'bilibili-video-link.js'],
]);

const MEDIA_MODULE_NAMES = new Set(MEDIA_MODULE_FILES.map(([, filename]) => filename));
const BASE_PROTOCOLS = new Set(['file:', 'http:', 'https:']);
const MAX_REVISION_LENGTH = 256;

function checkedRevision(revision) {
  if (
    typeof revision !== 'string'
    || revision.trim() === ''
    || revision.length > MAX_REVISION_LENGTH
    || /[\u0000-\u001f\u007f]/.test(revision)
  ) {
    throw new TypeError('revision must be a non-empty, bounded string without control characters');
  }
  return revision.trim();
}

function checkedBaseUrl(baseUrl) {
  let base;
  try {
    base = baseUrl instanceof URL ? new URL(baseUrl.href) : new URL(baseUrl);
  } catch {
    throw new TypeError('baseUrl must be an absolute URL');
  }
  if (!BASE_PROTOCOLS.has(base.protocol) || base.username || base.password) {
    throw new TypeError('baseUrl must be a file, http, or https URL without credentials');
  }
  return base;
}

export function versionedMediaUrl(baseUrl, filename, revision) {
  if (typeof filename !== 'string' || !MEDIA_MODULE_NAMES.has(filename)) {
    throw new TypeError('filename must name an allowed media module');
  }
  const url = new URL(filename, checkedBaseUrl(baseUrl));
  url.search = '';
  url.hash = '';
  url.searchParams.set('mediaRevision', checkedRevision(revision));
  return url;
}

export async function loadVideoModules(
  baseUrl,
  revision,
  {importModule = url => import(url.href)} = {},
) {
  if (typeof importModule !== 'function') {
    throw new TypeError('importModule must be a function');
  }
  const version = checkedRevision(revision);
  const loaded = await Promise.all(
    MEDIA_MODULE_FILES.map(([, filename]) =>
      importModule(versionedMediaUrl(baseUrl, filename, version))),
  );
  return {
    [MEDIA_MODULE_FILES[0][0]]: loaded[0],
    [MEDIA_MODULE_FILES[1][0]]: loaded[1],
    [MEDIA_MODULE_FILES[2][0]]: loaded[2],
    [MEDIA_MODULE_FILES[3][0]]: loaded[3],
    [MEDIA_MODULE_FILES[4][0]]: loaded[4],
    version,
  };
}
