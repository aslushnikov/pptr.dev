/**
 * Copyright 2018 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the 'License');
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an 'AS IS' BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

const os = require('os');
const path = require('path');
const fs = require('fs');
const pptr = require('puppeteer');
const {injectManifest} = require('workbox-build');
const UglifyJS = require("uglify-es");
const csso = require('csso');

// These are build outputs.
const SCRIPT_PATH = path.join(__dirname, 'dist', 'script.js');
const STYLE_PATH = path.join(__dirname, 'dist', 'style.css');
const SW_PATH = path.join(__dirname, 'sw.js');
const INDEX_PATH = path.join(__dirname, 'index.html');

const BUILD_OUTPUTS = [
  SCRIPT_PATH,
  STYLE_PATH,
  SW_PATH,
  INDEX_PATH
];

if (os.platform() === 'win32') {
  console.error('ERROR: build is not supported on Win32');
  process.exit(1);
  return;
}

(async () => {
  // 1. Launch browser, extract scripts/links and generate index.html
  let timeLabel = 'Generated index.html';
  console.time(timeLabel);
  const browser = await pptr.launch();
  const [page] = await browser.pages();
  await page.setJavaScriptEnabled(false);
  await page.goto('file://' + path.join(__dirname, 'unminified.html'), {waitUnit: 'domcontentloaded'});
  const {scriptPaths, stylePaths} = await page.evaluate(() => {
    const $$ = selector => Array.from(document.querySelectorAll(selector));
    const scripts = $$('script[src]').filter(script => script.src.startsWith('file://'));
    const scriptPaths = scripts.map(script => script.src.substring('file://'.length));
    if (scripts.length) {
      // Use first script to reference /dist/script.js
      const dist = scripts.shift();
      dist.src = '/dist/script.js';
      scripts.forEach(script => script.remove());
    }
    const links = $$('link[rel=stylesheet]').filter(link => link.href.startsWith('file://'));
    const stylePaths = links.map(link => link.href.substring('file://'.length));
    if (links.length) {
      // Use first link to reference /dist/style.css
      const dist = links.shift();
      dist.href = '/dist/style.css';
      links.forEach(link => link.remove());
    }
    return {scriptPaths, stylePaths};
  });
  const INDEX_CONTENT = '<!-- THIS FILE IS GENERATED BY build.js -->\n\n' + (await page.content()).split('\n').filter(line => !/^\s*$/.test(line)).join('\n');
  await browser.close();
  console.timeEnd(timeLabel);

  // 2. Minify Javascript
  timeLabel = 'Generated dist/script.js';
  console.time(timeLabel);
  const scripts = scriptPaths.map(scriptPath => fs.readFileSync(scriptPath, 'utf8'));
  const result = UglifyJS.minify(scripts.join(''));
  if (result.error) {
    console.error('JS Minification failed: ' + result.error);
    process.exit(1);
    return;
  }
  const SCRIPT_CONTENT = '/* THIS FILE IS GENERATED BY build.js */\n\n' + result.code;
  console.timeEnd(timeLabel);

  // 3. Minify CSS
  timeLabel = 'Generated dist/style.css';
  console.time(timeLabel);
  const styles = stylePaths.map(stylePath => fs.readFileSync(stylePath, 'utf8'));
  const STYLE_CONTENT = '/* THIS FILE IS GENERATED BY build.js */\n\n' + csso.minify(styles.join('\n'), {restructure: false}).css;
  console.timeEnd(timeLabel);

  // 4. Cleanup all previous artifacts and write new ones.
  for (const output of BUILD_OUTPUTS) {
    if (fs.existsSync(output))
      fs.unlinkSync(output);
  }
  fs.writeFileSync(INDEX_PATH, INDEX_CONTENT, 'utf8');
  fs.writeFileSync(SCRIPT_PATH, SCRIPT_CONTENT, 'utf8');
  fs.writeFileSync(STYLE_PATH, STYLE_CONTENT, 'utf8');

  // 4. Generate Service Worker.
  timeLabel = 'Generated sw.js';
  console.time(timeLabel);
  const {count, size} = await injectManifest({
    swSrc: path.join(__dirname, 'sw-template.js'),
    swDest: SW_PATH,
    globDirectory: '.',
    globPatterns: ['images/*', 'favicons/*', 'dist/*', 'index.html'],
  });
  console.timeEnd(timeLabel);
  const kbSize = Math.round(size / 1024 * 100) / 100;
  console.log(`  - precaches ${count} files, totaling ${kbSize} Kb.`);
})();

