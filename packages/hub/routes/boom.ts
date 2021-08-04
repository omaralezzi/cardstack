import Koa from 'koa';
import { inject } from '../di/dependency-injection';
import { AuthenticationUtils } from '../utils/authentication';
import packageJson from '../package.json';
import autoBind from 'auto-bind';
import * as Sentry from '@sentry/node';

export default class BoomRoute {
  authenticationUtils: AuthenticationUtils = inject('authentication-utils', { as: 'authenticationUtils' });
  constructor() {
    autoBind(this);
  }

  get(ctx: Koa.Context) {
    if (ctx.state.userAddress) {
      Sentry.setUser({
        userAddress: ctx.state.userAddress,
      });
    } else {
      Sentry.setUser({
        userAddress: null,
      });
    }
    ctx.status = 500;
    ctx.body = {
      errors: [
        {
          meta: {
            version: packageJson.version,
          },
          status: '500',
          title: 'This endpoint fails intentionally',
        },
      ],
    };
    ctx.type = 'application/vnd.api+json';
    throw new Error('Boom route fails intentionally');
  }
}

declare module '@cardstack/hub/di/dependency-injection' {
  interface KnownServices {
    'boom-route': BoomRoute;
  }
}
