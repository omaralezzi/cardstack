import Component from '@glimmer/component';
// @ts-ignore
import { dasherize } from '@ember/string';
// @ts-ignore
import { tracked } from '@glimmer/tracking';
import { Card } from '@cardstack/core/card';

export default class ScaffoldComponent extends Component<{
  card: Card;
  feature: string;
}> {
  @tracked componentName!: string | undefined;
  // Warning--async in the loading of feature components can lead to jank in the
  // card-renderer. If you are searching for the cause of jank, careful
  // attention should be paid to any async necessary to load features that are
  // components.

  constructor(owner: unknown, args: any) {
    super(owner, args);

    let csId = this.args.card.csId || this.args.card.adoptsFromId?.csId;
    this.componentName = `scaffolding/${dasherize(csId!)}/${dasherize(this.args.feature)}`;
  }
}
