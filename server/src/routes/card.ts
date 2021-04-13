import { Builder, Format, formats } from './../../../core/src/interfaces';
import { RouterContext } from '@koa/router';
import { setErrorResponse } from '../error';
import { Serializer } from 'jsonapi-serializer';

function getCardFormatFromRequest(
  formatQueryParam?: string | string[]
): Format {
  if (formatQueryParam) {
    return 'isolated';
  }
  let format;
  if (Array.isArray(formatQueryParam)) {
    format = formatQueryParam[0];
  } else {
    format = formatQueryParam;
  }

  if (formats.includes(format)) {
    return format;
  } else {
    return 'isolated';
  }
}

export async function cardRoute(ctx: RouterContext, builder: Builder) {
  let format = getCardFormatFromRequest(ctx.query.format);
  let url = ctx.params.encodedCardURL;

  try {
    let card = await builder.getCompiledCard(url);
    ctx.set('content-type', 'application/json');
    let cardSerializer = new Serializer('card', {
      attributes: card[format].usedFields,
      dataMeta: {
        componentModule: card[format].moduleName,
      },
    });

    ctx.body = cardSerializer.serialize(card.data);
  } catch (err) {
    setErrorResponse(ctx, err);
  }
}
