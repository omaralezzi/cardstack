import Service from '@ember/service';

import {
  Format,
  CardJSONResponse,
  CardEnv,
  CardOperation,
} from '@cardstack/core/src/interfaces';
import CardModel from '@cardstack/core/src/card-model';
import config from 'cardhost/config/environment';

// @ts-ignore @ember/component doesn't declare setComponentTemplate...yet!
import { setComponentTemplate } from '@ember/component';
import Component from '@glimmer/component';
import { hbs } from 'ember-cli-htmlbars';
import { tracked } from '@glimmer/tracking';
import type LocalRealm from 'cardhost/lib/local-realm';
import { fetchJSON } from 'cardhost/lib/jsonapi-fetch';
import { LOCAL_REALM } from 'cardhost/lib/local-realm';

const { cardServer } = config as any; // Environment types arent working

export default class Cards extends Service {
  private localRealmURL = LOCAL_REALM;

  async load(url: string, format: Format): Promise<CardModel> {
    let cardResponse: CardJSONResponse;
    if (this.inLocalRealm(url)) {
      let localRealm = await this.localRealm();
      cardResponse = await localRealm.load(url, format);
    } else {
      cardResponse = await fetchJSON<CardJSONResponse>(
        this.buildCardURL(url, format)
      );
    }
    let { component, Model } = await this.codeForCard(cardResponse);
    return Model.fromResponse(this.cardEnv(), cardResponse, component);
  }

  async loadForRoute(pathname: string): Promise<CardModel> {
    let url = `${cardServer}cardFor${pathname}`;
    let cardResponse = await fetchJSON<CardJSONResponse>(url);
    let { component, Model } = await this.codeForCard(cardResponse);
    return Model.fromResponse(this.cardEnv(), cardResponse, component);
  }

  private inLocalRealm(cardURL: string): boolean {
    return cardURL.startsWith(this.localRealmURL);
  }

  private cardEnv(): CardEnv {
    return {
      load: this.load.bind(this),
      send: this.send.bind(this),
      prepareComponent: this.prepareComponent.bind(this),
      tracked: tracked as unknown as CardEnv['tracked'], // ¯\_(ツ)_/¯
    };
  }

  private _localRealmPromise: Promise<LocalRealm> | undefined;

  async localRealm(): Promise<LocalRealm> {
    if (this._localRealmPromise) {
      return this._localRealmPromise;
    }
    let resolve: any, reject: any;
    this._localRealmPromise = new Promise((r, e) => {
      resolve = r;
      reject = e;
    });
    try {
      let { default: LocalRealm } = await import('../lib/local-realm');
      let localRealm = new LocalRealm(this.localRealmURL, this);
      resolve(localRealm);
      return localRealm;
    } catch (err) {
      reject(err);
      throw err;
    }
  }

  private async send(op: CardOperation): Promise<CardJSONResponse> {
    if (this.operationIsLocal(op)) {
      let localRealm = await this.localRealm();
      return await localRealm.send(op);
    }

    if ('create' in op) {
      return await fetchJSON<CardJSONResponse>(
        this.buildNewURL(op.create.targetRealm, op.create.parentCardURL),
        {
          method: 'POST',
          body: JSON.stringify(op.create.payload),
        }
      );
    } else if ('update' in op) {
      return await fetchJSON<CardJSONResponse>(
        this.buildCardURL(op.update.cardURL),
        {
          method: 'PATCH',
          body: JSON.stringify(op.update.payload),
        }
      );
    } else {
      throw assertNever(op);
    }
  }

  private operationIsLocal(op: CardOperation): boolean {
    if ('create' in op) {
      return this.inLocalRealm(op.create.targetRealm);
    } else if ('update' in op) {
      return this.inLocalRealm(op.update.cardURL);
    } else {
      throw assertNever(op);
    }
  }

  private buildNewURL(realm: string, parentCardURL: string): string {
    return [
      cardServer,
      'cards/',
      encodeURIComponent(realm) + '/',
      encodeURIComponent(parentCardURL),
    ].join('');
  }

  private buildCardURL(url: string, format?: Format): string {
    let fullURL = [cardServer, 'cards/', encodeURIComponent(url)];
    if (format) {
      fullURL.push('?' + new URLSearchParams({ format }).toString());
    }
    return fullURL.join('');
  }

  private prepareComponent(cardModel: CardModel, component: unknown): unknown {
    return setComponentTemplate(
      hbs`<this.component @model={{this.data}} @set={{this.set}} />`,
      class extends Component {
        component = component;
        get data() {
          return cardModel.data;
        }
        set = cardModel.setters;
      }
    );
  }

  private async codeForCard(
    card: CardJSONResponse
  ): Promise<{ component: unknown; Model: typeof CardModel }> {
    let componentModule = card.data?.meta?.componentModule;
    if (!componentModule) {
      throw new Error('No componentModule to load');
    }
    let module = await this.loadModule<{
      default: unknown;
      Model: typeof CardModel;
    }>(componentModule);
    return {
      component: module.default,
      Model: module.Model,
    };
  }

  async loadModule<T extends object>(moduleIdentifier: string): Promise<T> {
    if (moduleIdentifier.startsWith('@cardstack/compiled/')) {
      // module was built by webpack, use webpack's implementation of `await
      // import()`
      moduleIdentifier = moduleIdentifier.replace('@cardstack/compiled/', '');
      return await import(
        /* webpackExclude: /schema\.js$/ */
        `@cardstack/compiled/${moduleIdentifier}`
      );
    } else if (moduleIdentifier.startsWith('@cardstack/core/src/')) {
      // module was built by webpack, use webpack's implementation of `await
      // import()`
      moduleIdentifier = moduleIdentifier.replace('@cardstack/core/src/', '');
      return await import(
        /* webpackExclude: /schema\.js$/ */
        `@cardstack/core/src/${moduleIdentifier}`
      );
    } else if (
      moduleIdentifier.startsWith('@cardstack/local-realm-compiled/')
    ) {
      // module was built by our LocalRealm, so ask LocalRealm for it
      let localRealm = await this.localRealm();
      return await localRealm.loadModule<T>(moduleIdentifier);
    } else {
      throw new Error(
        `don't know how to load compiled card code for ${moduleIdentifier}`
      );
    }
  }
}

function assertNever(value: never) {
  throw new Error(`unsupported operation ${value}`);
}
