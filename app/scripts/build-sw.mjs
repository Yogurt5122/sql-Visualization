import { createHash } from 'node:crypto';
import {
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(dist)
  .filter((path) => !path.endsWith(`${sep}sw.js`))
  .sort();

if (files.length === 0) {
  throw new Error('dist 为空，无法生成 Service Worker');
}

const hash = createHash('sha256');
for (const file of files) {
  hash.update(relative(dist, file).split(sep).join('/'));
  hash.update(readFileSync(file));
}
const SW_STRATEGY = 'network-first-1';
const version = `sql-xray-${pkg.version}-${hash.digest('hex').slice(0, 10)}-${SW_STRATEGY}`;
const precache = files.map((file) => `./${relative(dist, file).split(sep).join('/')}`);

const sw = `/* SQL 透视镜 Service Worker：只缓存静态产物，不缓存 SQL。 */
const CACHE_VERSION = ${JSON.stringify(version)};
const PRECACHE = ${JSON.stringify(precache, null, 2)};
const BASE = self.registration.scope;
const INDEX = new URL('index.html', BASE).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      cache.addAll(PRECACHE.map((path) => new URL(path, BASE).href)),
    ),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    // 网络优先：避免 iOS 回收缓存后旧 SW 只读缓存、直接 503。
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches
              .open(CACHE_VERSION)
              .then((cache) => cache.put(INDEX, copy))
              .catch(() => undefined);
          }
          return response;
        })
        .catch(() =>
          caches
            .match(INDEX, { ignoreSearch: true })
            .then((cached) => cached || caches.match(request, { ignoreSearch: true }))
            .then(
              (cached) =>
                cached ||
                new Response('离线缓存尚不可用，请联网后重试', {
                  status: 503,
                  headers: { 'Content-Type': 'text/plain; charset=utf-8' },
                }),
            ),
        ),
    );
    return;
  }

  // 静态资源缓存优先；未命中时回网络，避免新 hash 资源被旧 SW 阻断。
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then(
      (cached) =>
        cached ||
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              void caches
                .open(CACHE_VERSION)
                .then((cache) => cache.put(request, copy))
                .catch(() => undefined);
            }
            return response;
          })
          .catch(
            () =>
              new Response('资源未缓存，请联网后重试', {
                status: 503,
                headers: { 'Content-Type': 'text/plain; charset=utf-8' },
              }),
          ),
    ),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
`;

writeFileSync(join(dist, 'sw.js'), sw, 'utf8');
console.log(`Service Worker：${version}，预缓存 ${precache.length} 个文件`);
