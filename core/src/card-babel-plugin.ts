import {
  ImportDeclaration,
  ImportSpecifier,
  variableDeclaration,
  variableDeclarator,
  identifier,
  Identifier,
  StringLiteral,
  objectPattern,
  objectProperty,
  callExpression,
  isDecorator,
  stringLiteral,
  isClassProperty,
  isStringLiteral,
  isIdentifier,
  CallExpression,
  isCallExpression,
  isClassDeclaration,
} from '@babel/types';
import { NodePath } from '@babel/traverse';

const VALID_FIELD_DECORATORS = {
  hasMany: true,
  belongsTo: true,
  contains: true,
  containsMany: true,
};
type FieldType = keyof typeof VALID_FIELD_DECORATORS;

export type FieldMeta = {
  cardURL: string;
  type: FieldType;
};
export type FieldsMeta = {
  [name: string]: FieldMeta;
};
export type ParentMeta = {
  cardURL: string;
};

export function getMeta(
  obj: Object
): {
  fields: FieldsMeta;
  parent?: ParentMeta;
} {
  let meta = metas.get(obj);
  if (!meta) {
    // throw new Error(
    //   `tried to getMeta for something that was not passed as card-babel-plugin's options`
    // );
    // NOTE: Base cards, like string, don't have fields. Feels like it should not error
    return { fields: {} };
  }
  return meta;
}

const metas = new WeakMap<
  object,
  {
    parent?: ParentMeta;
    fields: FieldsMeta;
  }
>();

function error(path: NodePath<any>, message: string) {
  return path.buildCodeFrameError(message, CompilerError);
}

class CompilerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompilerError';
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    } else if (!this.stack) {
      this.stack = new Error(message).stack;
    }
  }
}

export default function main() {
  return {
    visitor: {
      ImportDeclaration(
        path: NodePath<ImportDeclaration>,
        state: { opts: object }
      ) {
        if (path.node.source.value === '@cardstack/types') {
          let specifiers = path.node.specifiers.filter(
            (specifier) => specifier.type === 'ImportSpecifier'
          ) as ImportSpecifier[];

          storeMeta(state.opts, specifiers, path);

          path.replaceWith(
            variableDeclaration('const', [
              variableDeclarator(
                objectPattern(
                  specifiers.map((s) =>
                    objectProperty(s.imported, s.local, false, true)
                  )
                ),
                callExpression(identifier('require'), [
                  stringLiteral('@cardstack/core'),
                ])
              ),
            ])
          );
          return;
        }
      },
    },
  };
}

function name(node: StringLiteral | Identifier): string {
  if (isIdentifier(node)) {
    return node.name;
  } else {
    return node.value;
  }
}

function storeMeta(
  opts: object,
  specifiers: ImportSpecifier[],
  path: NodePath<any>
) {
  let fields: FieldsMeta = {};
  let parent: ParentMeta | undefined;

  specifiers.forEach((specifier) => {
    let {
      local: { name: localName },
    } = specifier;
    let specifierName = name(specifier.imported);

    if ((VALID_FIELD_DECORATORS as any)[specifierName]) {
      validateUsageAndGetFieldMeta(
        path,
        fields,
        localName,
        specifierName as FieldType
      );
    }

    if (specifierName === 'adopts') {
      parent = validateUsageAndGetParentMeta(path, localName);
    }
  });

  metas.set(opts, { fields, parent });
}

function validateUsageAndGetFieldMeta(
  path: NodePath,
  fields: FieldsMeta,
  localName: string,
  actualName: FieldType
) {
  for (let fieldIdentifier of path.scope.bindings[localName].referencePaths) {
    if (
      !isCallExpression(fieldIdentifier.parent) ||
      fieldIdentifier.parent.callee !== fieldIdentifier.node
    ) {
      throw error(
        fieldIdentifier,
        `the @${localName} decorator must be called`
      );
    }

    if (
      !isDecorator(fieldIdentifier.parentPath.parent) ||
      fieldIdentifier.parentPath.parent.expression !== fieldIdentifier.parent
    ) {
      throw error(
        fieldIdentifier,
        `the @${localName} decorator must be used as a decorator`
      );
    }

    if (!isClassProperty(fieldIdentifier.parentPath.parentPath.parent)) {
      throw error(
        fieldIdentifier,
        `the @${localName} decorator can only go on class properties`
      );
    }

    if (fieldIdentifier.parentPath.parentPath.parent.computed) {
      throw error(
        fieldIdentifier,
        'field names must not be dynamically computed'
      );
    }

    if (
      !isIdentifier(fieldIdentifier.parentPath.parentPath.parent.key) &&
      !isStringLiteral(fieldIdentifier.parentPath.parentPath.parent.key)
    ) {
      throw error(
        fieldIdentifier,
        'field names must be identifiers or string literals'
      );
    }

    let fieldName = name(fieldIdentifier.parentPath.parentPath.parent.key);
    let { cardURL } = extractDecoratorArguments(
      fieldIdentifier.parentPath as NodePath<CallExpression>,
      localName
    );

    fields[fieldName] = { cardURL, type: actualName };
  }
}

function validateUsageAndGetParentMeta(
  path: NodePath,
  localName: string
): ParentMeta {
  let adoptsIdentifer = path.scope.bindings[localName].referencePaths[0];

  if (!isClassDeclaration(adoptsIdentifer.parentPath.parentPath.parent)) {
    throw error(
      adoptsIdentifer,
      '@adopts decorator can only be used on a class'
    );
  }

  return extractDecoratorArguments(
    adoptsIdentifer.parentPath as NodePath<CallExpression>,
    localName
  );
}

function extractDecoratorArguments(
  callExpression: NodePath<CallExpression>,
  localName: string
) {
  if (callExpression.node.arguments.length !== 1) {
    throw error(
      callExpression,
      `@${localName} decorator accepts exactly one argument`
    );
  }

  let cardTypePath = callExpression.get('arguments')[0];
  let cardType = cardTypePath.node;
  if (!isIdentifier(cardType)) {
    throw error(cardTypePath, `@${localName} argument must be an identifier`);
  }

  let definition = cardTypePath.scope.getBinding(cardType.name)?.path;
  if (!definition) {
    throw error(cardTypePath, `@${localName} argument is not defined`);
  }
  if (!definition.isImportDefaultSpecifier()) {
    throw error(
      definition,
      `@${localName} argument must come from a module default export`
    );
  }

  return {
    cardURL: (definition.parent as ImportDeclaration).source.value,
  };
}
