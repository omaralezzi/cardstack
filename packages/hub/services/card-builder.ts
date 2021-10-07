import { Builder as BuilderInterface, RawCard, CompiledCard } from '@cardstack/core/src/interfaces';
import { Compiler } from '@cardstack/core/src/compiler';

import { transformSync } from '@babel/core';
import { NODE, BROWSER } from '../interfaces';
import { JS_TYPE } from '@cardstack/core/src/utils/content';
import { inject } from '../di/dependency-injection';
import walkSync from 'walk-sync';
import { serverLog as logger } from '../utils/logger';

export default class CardBuilder implements BuilderInterface {
  realmManager = inject('realm-manager', { as: 'realmManager' });
  cache = inject('card-cache', { as: 'cache' });

  logger = logger;

  private compiler = new Compiler({
    builder: this,
  });

  async primeCache(): Promise<void> {
    let promises = [];

    for (let realm of this.realmManager.realms) {
      let cards = walkSync(realm.directory, { globs: ['**/card.json'] });
      for (let cardPath of cards) {
        let fullCardUrl = new URL(cardPath.replace('card.json', ''), realm.url).href;
        this.logger.log(`--> Priming cache for ${fullCardUrl}`);
        promises.push(this.buildCard(fullCardUrl));
      }
    }

    await Promise.all(promises);
    this.logger.log(`--> Cache primed`);
  }

  async define(cardURL: string, localPath: string, type: string, source: string): Promise<string> {
    switch (type) {
      case JS_TYPE:
        this.cache.setModule(BROWSER, cardURL, localPath, source);
        return this.cache.setModule(NODE, cardURL, localPath, this.transformToCommonJS(localPath, source));
      default:
        return this.cache.writeAsset(cardURL, localPath, source);
    }
  }

  private transformToCommonJS(moduleURL: string, source: string): string {
    let out = transformSync(source, {
      configFile: false,
      babelrc: false,
      filenameRelative: moduleURL,
      plugins: ['@babel/plugin-proposal-class-properties', '@babel/plugin-transform-modules-commonjs'],
    });
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return out!.code!;
  }

  async getRawCard(url: string): Promise<RawCard> {
    url = url.replace(/\/$/, '');
    return this.realmManager.getRawCard(url);
  }

  async getCompiledCard(url: string): Promise<CompiledCard> {
    let compiledCard = this.cache.getCard(url);

    if (compiledCard) {
      return compiledCard;
    }

    return this.buildCard(url);
  }

  async buildCard(url: string): Promise<CompiledCard> {
    let rawCard = await this.getRawCard(url);
    let compiledCard = await this.compileCardFromRaw(rawCard);

    return compiledCard;
  }

  private async compileCardFromRaw(rawCard: RawCard): Promise<CompiledCard> {
    let compiledCard = await this.compiler.compile(rawCard);
    this.cache.setCard(rawCard.url, compiledCard);

    return compiledCard;
  }

  async deleteCard(cardURL: string) {
    await this.cache.deleteCard(cardURL);
    await this.realmManager.deleteCard(cardURL);
  }
}

declare module '@cardstack/hub/di/dependency-injection' {
  interface KnownServices {
    'card-builder': CardBuilder;
  }
}
