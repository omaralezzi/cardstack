import { expect } from 'chai';
import tmp from 'tmp';
import { ensureDirSync, outputJSONSync } from 'fs-extra';
import { join } from 'path';
import { HubServer } from '../main';
import { createCardCacheDir, createMinimalPackageJSON } from './helpers/cache';
import { Project } from 'scenario-tester';

if (process.env.COMPILER) {
  describe('Server boot', function () {
    it('Errors if cacheDir doesnt have a package.json in cardCarchDir', async function () {
      let tmpDir = tmp.dirSync().name;
      let cardCacheDir = join(tmpDir, 'node_modules', '@cardstack', 'compiled');
      ensureDirSync(cardCacheDir);

      expect(
        HubServer.create({
          cardCacheDir,
        })
      ).to.be.rejectedWith(/package.json is required in cardCacheDir/);
    });

    it('Errors if cacheDirs package.json does not have proper exports', async function () {
      let tmpDir = tmp.dirSync().name;
      let cardCacheDir = join(tmpDir, 'node_modules', '@cardstack', 'compiled');
      ensureDirSync(cardCacheDir);
      outputJSONSync(join(cardCacheDir, 'package.json'), {
        name: '@cardstack/compiled',
        exports: { foo: 'bar.js ' },
      });

      expect(
        HubServer.create({
          cardCacheDir,
        })
      ).to.be.rejectedWith(/package.json of cardCacheDir does not have properly configured exports/);

      outputJSONSync(join(cardCacheDir, 'package.json'), {
        name: '@cardstack/compiled',
        exports: { '.': { deno: '*' }, './*': { deno: '*' } },
      });

      expect(
        HubServer.create({
          cardCacheDir,
        })
      ).to.be.rejectedWith(/package.json of cardCacheDir does not have properly configured exports/);
    });

    it('Errors if configured routing card does not have routeTo methods', async function () {
      let realm = new Project('my-realm', {
        files: {
          routes: {
            'card.json': JSON.stringify({
              schema: 'schema.js',
            }),
            'schema.js': `
              export default class Routes {
                goToThisCardPLS(path) {
                  if (path === 'homepage') {
                    return 'https://my-realm/welcome';
                  }

                  if (path === 'about') {
                    return 'https://my-realm/about';
                  }
                }
              }
            `,
          },
        },
      });
      realm.writeSync();

      let { cardCacheDir } = createCardCacheDir();
      createMinimalPackageJSON(cardCacheDir);

      expect(
        HubServer.create({
          cardCacheDir,
          routeCard: 'https://my-realm/routes',
        })
      ).to.be.rejectedWith(/Route Card's Schema does not have proper routing method defined/);
    });
  });
}
