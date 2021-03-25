import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';
import { action } from '@ember/object';
import { inject as service } from '@ember/service';

export default class CardSpaceNewController extends Controller {
  @service('edges') edges;
  @service('cardstack-session') cardstackSession;
  @tracked isSelected = false;

  @action updateEdges() {
    this.edges.updateDisplayLeftEdge(this.cardstackSession.isAuthenticated);
    this.edges.hasLightTheme();
  }

  @action toggleSelect() {
    this.isSelected = !this.isSelected;
  }
}
