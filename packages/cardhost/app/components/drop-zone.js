import Component from '@glimmer/component';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { inject as service } from '@ember/service';

export default class DropZone extends Component {
  @tracked dropZoneStatus = 'outside';

  @service draggable;

  get stubField() {
    let field = this.draggable.getField();
    let type = field.coreType || field.type;

    return {
      type,
      name: field.name || 'new field',
      label: field.label || 'New Field',
      preview: true,
    };
  }

  get isOverDropZone() {
    return this.dropZoneStatus === 'dragging';
  }

  @action
  updateStatus(status, event) {
    let draggedField = this.draggable.getField();

    // either no dragged field, or mouse event triggered by a human
    if (!draggedField || (event.isTrusted && (event.type === 'mouseenter' || event.type === 'mouseleave'))) {
      return;
    }

    this.dropZoneStatus = status;

    if (this.args.toggleStubField) {
      this.args.toggleStubField(this.stubField, this.args.position, this.isOverDropZone);
    }
  }

  @action dragOver(event) {
    event.preventDefault();
  }
}
