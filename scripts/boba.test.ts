import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  addRoute,
  generateComponent,
  generateService,
  handleMcp,
  manifest,
} from './boba.ts';

const MAIN = `const router = Router.getInstance();
router.registerRoute({ path: '/', component: 'home-page' });
router.start();
`;

describe('boba CLI', () => {
  let root: string;
  const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'boba-'));
    fs.mkdirSync(path.join(root, 'src/components/home-page'), {
      recursive: true,
    });
    fs.writeFileSync(path.join(root, 'src/main.ts'), MAIN);
    fs.writeFileSync(
      path.join(root, 'package.json'),
      '{"name":"demo","version":"2.3.4"}'
    );
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('generate component scaffolds the three files', () => {
    const files = generateComponent(root, 'user-card');
    assert.deepStrictEqual(files, [
      'src/components/user-card/user-card.ts',
      'src/components/user-card/user-card.html',
      'src/components/user-card/user-card.css',
    ]);
    assert.match(read(files[0]), /class UserCardComponent extends Base/);
    assert.match(read(files[0]), /static tagName = 'user-card'/);
  });

  test('generate component rejects invalid tag names and overwrites', () => {
    assert.throws(() => generateComponent(root, 'card'), /valid tag name/);
    generateComponent(root, 'user-card');
    assert.throws(() => generateComponent(root, 'user-card'), /already exists/);
  });

  test('generate service scaffolds a service whose test passes', () => {
    generateService(root, 'cart-service');
    assert.match(read('src/services/cart-service.ts'), /function cartService/);
    const run = spawnSync(process.execPath, [
      '--test',
      path.join(root, 'src/services/cart-service.test.ts'),
    ]);
    assert.strictEqual(run.status, 0, String(run.stdout));
  });

  test('add route registers after the last route', () => {
    generateComponent(root, 'user-card');
    addRoute(root, '/card/:id', 'user-card');
    assert.strictEqual(
      read('src/main.ts'),
      MAIN.replace(
        'router.start',
        "router.registerRoute({ path: '/card/:id', component: 'user-card' });\nrouter.start"
      )
    );
    assert.throws(() => addRoute(root, '/card/:id', 'user-card'), /already/);
    assert.throws(() => addRoute(root, '/x', 'no-such'), /No component/);
  });

  test('manifest lists components, services and routes', () => {
    generateService(root, 'cart-service');
    assert.deepStrictEqual(manifest(root), {
      name: 'demo',
      version: '2.3.4',
      components: [
        { tag: 'home-page', path: 'src/components/home-page/home-page.ts' },
      ],
      services: ['src/services/cart-service.ts'],
      routes: [{ path: '/', component: 'home-page' }],
    });
  });

  test('mcp serves the tools over JSON-RPC', () => {
    const isRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value);

    const expectResult = (
      method: string,
      params?: { name?: string; arguments?: Record<string, string> }
    ): Record<string, unknown> => {
      const response = handleMcp(root, { id: 1, method, params });
      assert.ok(
        response !== undefined &&
          'result' in response &&
          isRecord(response.result)
      );
      return response.result;
    };

    const init = expectResult('initialize');
    assert.deepStrictEqual(init.capabilities, { tools: {} });
    assert.ok(isRecord(init.serverInfo));
    assert.strictEqual(init.serverInfo.version, '2.3.4');

    const listed = expectResult('tools/list');
    assert.ok(Array.isArray(listed.tools));
    assert.strictEqual(listed.tools.length, 4);

    assert.strictEqual(
      handleMcp(root, { method: 'notifications/initialized' }),
      undefined
    );

    const unknown = handleMcp(root, { id: 1, method: 'nope' });
    assert.ok(unknown !== undefined && 'error' in unknown);
    assert.strictEqual(unknown.error.code, -32601);

    const created = expectResult('tools/call', {
      name: 'generate_component',
      arguments: { name: 'user-card' },
    });
    assert.strictEqual(created.isError, false);
    assert.ok(fs.existsSync(path.join(root, 'src/components/user-card')));

    const failed = expectResult('tools/call', {
      name: 'add_route',
      arguments: { path: '/x', component: 'no-such' },
    });
    assert.strictEqual(failed.isError, true);
    assert.ok(Array.isArray(failed.content));
    const firstBlock = failed.content[0];
    assert.ok(isRecord(firstBlock) && typeof firstBlock.text === 'string');
    assert.match(firstBlock.text, /No component/);
  });
});
