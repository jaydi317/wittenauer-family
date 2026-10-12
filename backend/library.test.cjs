const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const values = {}, keys = ['archive-test-key', 'trip-test-key'];
let calls = 0;
let bucketStatus = 200;
const response = data => ({getContentText: () => JSON.stringify(data), getResponseCode: () => bucketStatus});
const context = {
  CacheService: {getScriptCache: () => ({get: k => values[k], getAll: ks => Object.fromEntries(ks.map(k => [k, values[k]])), putAll: data => Object.assign(values, data)})},
  PropertiesService: {getScriptProperties: () => ({getProperty: k => k === 'IMMICH_SHARES' ? JSON.stringify(keys) : 'https://immich.test'})},
  UrlFetchApp: {
    fetch(url) {
      calls++;
      if (url.includes('/shared-links/me')) return response({album: {id: url.includes(keys[0]) ? 'archive' : 'trip', albumName: 'Album'}});
      return response(url.includes('albumId=archive') ? [{timeBucket: '2026-09'}] : []);
    },
    fetchAll: () => [response({id: ['photo', 'video', 'trashed'], fileCreatedAt: ['2026-09-19T18:00:00Z', '2026-09-20T01:00:00', '2026-09-19T20:00:00Z'], localOffsetHours: [-4, -4, -4], isImage: [true, false, true], ratio: [1.5, 0.75, 1], duration: ['', '00:01:00', ''], isTrashed: [false, false, true], latitude: [1, 2, 3], originalFileName: ['private.jpg', 'private.mov', 'private.jpg']})]
  }
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(__dirname + '/library.gs', 'utf8'), context);
const result = context.library();
assert.equal(result.ok, true);
assert.deepEqual(Array.from(result.shares, s => s.count), [2, 0]);
assert.equal(result.shares[0].a[0][1], '2026-09-19T14:00');
assert.equal(result.shares[0].a[1][2], 0);
assert.equal(result.shares[0].a[1][1], '2026-09-19T21:00');
const text = JSON.stringify(result);
for (const value of [...keys, 'latitude', 'originalFileName', 'private.jpg']) assert.ok(!text.includes(value));
const firstCalls = calls;
assert.equal(JSON.stringify(context.library()), text);
assert.equal(calls, firstCalls);
const big = {data: 'x'.repeat(200000)};
context.cachePutBig_(context.CacheService.getScriptCache(), 'large', big, 600);
assert.equal(context.cacheGetBig_(context.CacheService.getScriptCache(), 'large').data, big.data);
delete values.large_1;
assert.equal(context.cacheGetBig_(context.CacheService.getScriptCache(), 'large'), null);
for (const key of Object.keys(values)) delete values[key];
bucketStatus = 503;
assert.equal(context.library().ok, false);
assert.equal(values.witt_library_v2_n, undefined);
console.log('PASS: ordered shares, UTC dates without Z preserve evening local date, photo/video flags, trash exclusion, metadata/key exclusion, chunk cache and failed reads never cached.');
